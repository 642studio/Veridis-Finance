/**
 * SAT Descarga Masiva — orchestration + secure e.firma vault + ledger import.
 *
 * This is the connector that reads a taxpayer's COMPLETE fiscal history from the
 * SAT (every CFDI issued or received, any PAC, any year) and folds it into the
 * unified reconcilable ledger (finance.invoices).
 *
 * Lifecycle (SAT is asynchronous):
 *   createRequest → authenticate + SolicitaDescarga  (status: accepted)
 *   checkRequest  → VerificaSolicitudDescarga; when ready, download every
 *                   package, parse it and upsert into the ledger  (completed)
 *
 * Secrets (cer/key/password) are AES-256-GCM encrypted at rest and never leave
 * the server. The SOAP handshake requires a real e.firma against SAT servers;
 * the FIEL validation, encryption, ZIP/metadata parsing and ledger import are
 * all independently verified.
 */

const { XMLParser } = require('fast-xml-parser');

const pool = require('../db/pool');
const { encrypt, decrypt } = require('../lib/crypto');
const { loadFiel, isCurrentlyValid } = require('./sat/fiel');
const { readZipEntries } = require('./sat/zip');
const soap = require('./sat/soap');
const invoicesService = require('./invoicesService');
const { parseCfdi40 } = require('./cfdiParserService');

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
});

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}
function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

// ---------------------------------------------------------------------------
// e.firma vault
// ---------------------------------------------------------------------------

/** Non-secret view of the stored e.firma (safe to return to clients). */
function toPublicCredentials(row) {
  if (!row) return null;
  const validTo = row.valid_to ? new Date(row.valid_to) : null;
  return {
    rfc: row.rfc,
    legal_name: row.legal_name,
    cert_serial: row.cert_serial,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    expired: validTo ? validTo.getTime() < Date.now() : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getCredentialsRow(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.sat_credentials
      WHERE organization_id = $1 AND is_active = true
      ORDER BY created_at DESC LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

async function getCredentialsPublic(organizationId) {
  return toPublicCredentials(await getCredentialsRow(organizationId));
}

/**
 * Validate and store an e.firma. Validation (password opens the key, key matches
 * cert, RFC readable) happens BEFORE anything is written, so the user gets
 * immediate, honest feedback on a bad upload.
 */
async function saveCredentials(organizationId, cerBuffer, keyBuffer, password) {
  const fiel = loadFiel(cerBuffer, keyBuffer, password); // throws 400 on bad input
  if (!isCurrentlyValid(fiel)) {
    throw badRequest(
      `La e.firma está fuera de vigencia (válida ${fiel.validFrom
        .toISOString()
        .slice(0, 10)} a ${fiel.validTo.toISOString().slice(0, 10)}).`
    );
  }

  // Single active vault per org: deactivate any prior one, insert the new.
  await pool.query(
    `UPDATE finance.sat_credentials SET is_active = false, updated_at = now()
      WHERE organization_id = $1 AND is_active = true`,
    [organizationId]
  );

  const { rows } = await pool.query(
    `INSERT INTO finance.sat_credentials
       (organization_id, rfc, legal_name, cert_serial, valid_from, valid_to,
        cer_enc, key_enc, password_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      organizationId,
      fiel.rfc,
      fiel.legalName,
      fiel.serial,
      fiel.validFrom,
      fiel.validTo,
      encrypt(cerBuffer.toString('base64')),
      encrypt(keyBuffer.toString('base64')),
      encrypt(String(password)),
    ]
  );
  return toPublicCredentials(rows[0]);
}

async function deleteCredentials(organizationId) {
  await pool.query(
    `UPDATE finance.sat_credentials SET is_active = false, updated_at = now()
      WHERE organization_id = $1 AND is_active = true`,
    [organizationId]
  );
  return { deleted: true };
}

/** Internal: decrypt the stored e.firma back into a usable FIEL object. */
async function loadActiveFiel(organizationId) {
  const row = await getCredentialsRow(organizationId);
  if (!row) {
    throw badRequest('No hay e.firma configurada. Sube tu .cer, .key y contraseña primero.');
  }
  const cerBuffer = Buffer.from(decrypt(row.cer_enc), 'base64');
  const keyBuffer = Buffer.from(decrypt(row.key_enc), 'base64');
  const password = decrypt(row.password_enc);
  return loadFiel(cerBuffer, keyBuffer, password);
}

// ---------------------------------------------------------------------------
// SOAP flow
// ---------------------------------------------------------------------------

function firstDeep(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = firstDeep(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Find the first node in a parsed SOAP response that carries a given attribute.
 * The SAT wraps its answer in operation-specific elements
 * (SolicitaDescargaEmitidosResult, SolicitaDescargaRecibidosResult, …) and puts
 * the real payload — IdSolicitud, CodEstatus, Mensaje, EstadoSolicitud — in
 * ATTRIBUTES. Searching by attribute is robust to the element name.
 */
function findNodeWithAttr(obj, attr) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, attr)) return obj;
  for (const v of Object.values(obj)) {
    const found = findNodeWithAttr(v, attr);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Map a SAT CodEstatus + Mensaje into a readable line. */
function satStatusLine(cod, mensaje) {
  const c = cod ? `[${cod}] ` : '';
  return `${c}${mensaje || 'sin mensaje del SAT'}`.trim();
}

/**
 * Best-effort extraction of a human-readable reason from a SAT SOAP response.
 * SAT errors surface as SOAP faults (faultstring / Reason / Text) or, on a bad
 * signature, as a bare HTTP 500 with an HTML/text body. We return whatever is
 * most informative so the UI stops showing a naked "HTTP 500".
 */
function extractFault(parsed, body, status) {
  const candidates = ['faultstring', 'Text', 'Reason', 'Mensaje', 'ExceptionMessage', 'Message'];
  for (const key of candidates) {
    const val = firstDeep(parsed, key);
    if (val && typeof val === 'string' && val.trim()) return val.trim();
  }
  // Fall back to a cleaned snippet of the raw body (strip tags/whitespace).
  const snippet = String(body || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (snippet) return `HTTP ${status}: ${snippet.slice(0, 240)}`;
  return `HTTP ${status}`;
}

/** Authenticate and return a bearer token (valid ~5 min). */
async function authenticate(fiel, env = 'production') {
  const envelope = soap.buildAuthEnvelope(fiel);
  const { status, body } = await soap.postSoap(
    soap.endpoints(env).auth,
    soap.SOAP_ACTIONS.auth,
    envelope
  );
  const parsed = xml.parse(body);
  const token = firstDeep(parsed, 'AutenticaResult');
  if (!token || !String(token).trim()) {
    const err = new Error(`Autenticación SAT falló — ${extractFault(parsed, body, status)}`);
    err.statusCode = 502;
    throw err;
  }
  return String(token).trim();
}

/**
 * Start a Descarga Masiva request. Returns the created request row.
 * @param {object} opts { requestType:'issued'|'received', downloadType:'CFDI'|'Metadata',
 *                        dateFrom:'YYYY-MM-DD', dateTo:'YYYY-MM-DD' }
 */
async function createRequest(organizationId, opts, env = 'production') {
  const requestType = opts.requestType === 'received' ? 'received' : 'issued';
  const downloadType = opts.downloadType === 'CFDI' ? 'CFDI' : 'Metadata';
  if (!opts.dateFrom || !opts.dateTo) throw badRequest('Falta el rango de fechas.');

  const fiel = await loadActiveFiel(organizationId);

  const { rows: created } = await pool.query(
    `INSERT INTO finance.sat_download_requests
       (organization_id, request_type, download_type, date_from, date_to, status)
     VALUES ($1,$2,$3,$4,$5,'requested')
     RETURNING *`,
    [organizationId, requestType, downloadType, opts.dateFrom, opts.dateTo]
  );
  const req = created[0];

  try {
    const token = await authenticate(fiel, env);
    const envelope = soap.buildSolicitaEnvelope(fiel, {
      requestType,
      downloadType,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    });
    const { status, body } = await soap.postSoap(
      soap.endpoints(env).solicita,
      soap.solicitaAction(requestType),
      envelope,
      { Authorization: `WRAP access_token="${token}"` }
    );
    const parsed = xml.parse(body);
    // The split operations return SolicitaDescarga{Emitidos,Recibidos}Result;
    // find the node by attribute rather than a fixed element name.
    const result =
      findNodeWithAttr(parsed, '@_IdSolicitud') ||
      findNodeWithAttr(parsed, '@_CodEstatus') ||
      {};
    const idSolicitud = result['@_IdSolicitud'];
    const cod = result['@_CodEstatus'];
    const mensaje = result['@_Mensaje'];

    if (!idSolicitud) {
      const reason = cod || mensaje ? satStatusLine(cod, mensaje) : extractFault(parsed, body, status);
      return updateRequest(req.id, {
        status: 'failed',
        sat_status_code: cod || null,
        sat_message: `Solicitud rechazada — ${reason}`.slice(0, 400),
      });
    }
    return updateRequest(req.id, {
      status: 'accepted',
      sat_request_id: idSolicitud,
      sat_status_code: cod || null,
      sat_message: String(mensaje).slice(0, 400),
    });
  } catch (error) {
    return updateRequest(req.id, {
      status: 'failed',
      sat_message: String(error.message || error).slice(0, 400),
    });
  }
}

/**
 * Re-import a finished/failed request WITHOUT opening a new SAT solicitud: the
 * SAT keeps the packages of a terminada solicitud available, and re-verifying
 * returns the same package ids. Used to recover data dropped by an importer
 * bug (e.g. the BOM issue) — resets the row to 'accepted' and re-runs the
 * normal check flow with the fixed importer. Idempotent: dedupe by uuid.
 */
async function reimportRequest(organizationId, requestId, env = 'production') {
  const { rows } = await pool.query(
    `SELECT * FROM finance.sat_download_requests WHERE id = $1 AND organization_id = $2`,
    [requestId, organizationId]
  );
  const req = rows[0];
  if (!req) throw notFound('Solicitud no encontrada.');
  if (!req.sat_request_id) throw badRequest('La solicitud no tiene folio del SAT; crea una nueva.');

  await updateRequest(req.id, {
    status: 'accepted',
    package_ids: '[]',
    cfdi_imported: 0,
    sat_message: 'Reimportando desde el SAT…',
  });
  // Advance immediately so the user sees movement without waiting for the loop.
  return checkRequest(organizationId, requestId, env);
}

/**
 * Poll a request. When the SAT reports it ready, download every package, parse
 * and import into the ledger, and mark completed. Idempotent — safe to call
 * repeatedly; imports dedupe by (org, uuid_sat).
 */
async function checkRequest(organizationId, requestId, env = 'production') {
  const { rows } = await pool.query(
    `SELECT * FROM finance.sat_download_requests WHERE id = $1 AND organization_id = $2`,
    [requestId, organizationId]
  );
  const req = rows[0];
  if (!req) throw notFound('Solicitud no encontrada.');
  if (req.status === 'completed') return req;
  if (!req.sat_request_id) throw badRequest('La solicitud no tiene folio del SAT (revisa el estado).');

  // Wall-clock budget so a big download never blows the serverless limit
  // (Vercel maxDuration 60s; each SOAP call is capped at 20s). We stop early and
  // resume the remaining packages on the next check/cron.
  const deadline = Date.now() + 30000;

  const fiel = await loadActiveFiel(organizationId);

  let token;
  try {
    token = await authenticate(fiel, env);
  } catch (err) {
    // Transient SAT unavailability (timeout / 5xx at their end) must not blow
    // up the check: note it on the request and let auto-verify/cron retry.
    if (err.statusCode === 502 || err.statusCode === 504) {
      return updateRequest(req.id, {
        sat_message: `SAT sin respuesta ahora mismo (${String(err.message).slice(0, 200)}). Se reintenta solo.`,
      });
    }
    throw err;
  }

  // Resume: a request already 'downloading' has its remaining package ids
  // stored; keep pulling those instead of re-verifying.
  if (req.status === 'downloading' && Array.isArray(req.package_ids) && req.package_ids.length) {
    const { imported, doneIds, files } = await downloadAndImport(
      organizationId, fiel, token, req.package_ids, req.request_type, env, deadline
    );
    const remaining = req.package_ids.filter((id) => !doneIds.includes(id));
    const totalImported = (req.cfdi_imported || 0) + imported;
    return updateRequest(req.id, {
      status: remaining.length ? 'downloading' : 'completed',
      package_ids: JSON.stringify(remaining),
      cfdi_imported: totalImported,
      sat_message: remaining.length
        ? `Descargando: faltan ${remaining.length} paquete(s)…`
        : totalImported > 0
          ? `Importación terminada: ${totalImported} factura(s) al libro.`
          : `0 facturas importadas. Contenido del paquete: ${describeFiles(files)}`.slice(0, 400),
    });
  }

  const envelope = soap.buildVerificaEnvelope(fiel, req.sat_request_id);
  let body;
  try {
    ({ body } = await soap.postSoap(
      soap.endpoints(env).verifica,
      soap.SOAP_ACTIONS.verifica,
      envelope,
      { Authorization: `WRAP access_token="${token}"` }
    ));
  } catch (err) {
    if (err.statusCode === 502 || err.statusCode === 504) {
      return updateRequest(req.id, {
        sat_message: `SAT sin respuesta ahora mismo (${String(err.message).slice(0, 200)}). Se reintenta solo.`,
      });
    }
    throw err;
  }
  const parsed = xml.parse(body);
  const result =
    findNodeWithAttr(parsed, '@_EstadoSolicitud') ||
    findNodeWithAttr(parsed, '@_CodEstatus') ||
    {};
  const estado = String(result['@_EstadoSolicitud'] || '');
  const numCfdi = parseInt(result['@_NumeroCFDIs'] || '0', 10) || 0;
  const mensaje = result['@_Mensaje'] || '';

  // EstadoSolicitud: 1 aceptada, 2 en proceso, 3 terminada, 4 error, 5 rechazada, 6 vencida
  const packageIds = collectPackageIds(result);

  if (estado === '3' && packageIds.length) {
    await updateRequest(req.id, {
      status: 'downloading',
      sat_status_code: estado,
      sat_message: String(mensaje).slice(0, 400),
      package_ids: JSON.stringify(packageIds),
      cfdi_found: numCfdi,
    });
    const { imported, doneIds, files } = await downloadAndImport(
      organizationId, fiel, token, packageIds, req.request_type, env, deadline
    );
    const remaining = packageIds.filter((id) => !doneIds.includes(id));
    return updateRequest(req.id, {
      status: remaining.length ? 'downloading' : 'completed',
      package_ids: JSON.stringify(remaining),
      cfdi_imported: imported,
      sat_message: remaining.length
        ? `Descargando: faltan ${remaining.length} paquete(s)…`
        : imported > 0
          ? `Importación terminada: ${imported} factura(s) al libro (${packageIds.length} paquete(s) del SAT).`
          : `0 facturas importadas. Contenido del paquete: ${describeFiles(files)}`.slice(0, 400),
    });
  }

  if (estado === '3' && !packageIds.length) {
    // Terminada sin paquetes = no hubo CFDI en el rango.
    return updateRequest(req.id, {
      status: 'completed',
      sat_status_code: estado,
      sat_message: 'Sin facturas en el rango solicitado.',
      cfdi_found: 0,
      cfdi_imported: 0,
    });
  }

  if (estado === '4' || estado === '5' || estado === '6') {
    return updateRequest(req.id, {
      status: 'failed',
      sat_status_code: estado,
      sat_message: String(mensaje || `EstadoSolicitud ${estado}`).slice(0, 400),
    });
  }

  // Still processing (1 or 2).
  return updateRequest(req.id, {
    status: 'in_progress',
    sat_status_code: estado,
    sat_message: String(mensaje || 'En proceso').slice(0, 400),
    cfdi_found: numCfdi,
  });
}

function collectPackageIds(result) {
  const ids = firstDeep(result, 'IdsPaquetes');
  if (!ids) return [];
  return (Array.isArray(ids) ? ids : [ids])
    .map((v) => String(v).trim())
    .filter(Boolean);
}

async function downloadAndImport(organizationId, fiel, token, packageIds, requestType, env, deadline = Infinity) {
  let imported = 0;
  const doneIds = [];
  const files = [];
  for (const packageId of packageIds) {
    // Stop before the serverless budget runs out; the rest resume next round.
    if (Date.now() > deadline) break;
    const envelope = soap.buildDescargaEnvelope(fiel, packageId);
    const { body } = await soap.postSoap(
      soap.endpoints(env).descarga,
      soap.SOAP_ACTIONS.descarga,
      envelope,
      { Authorization: `WRAP access_token="${token}"` }
    );
    const parsed = xml.parse(body);
    const paqueteB64 = firstDeep(parsed, 'Paquete');
    doneIds.push(packageId); // consumed even if empty, so we don't loop forever
    if (!paqueteB64) {
      // Surface WHY the SAT sent no package (fault, CodEstatus, Mensaje…).
      const respuesta = findNodeWithAttr(parsed, '@_CodEstatus') || {};
      const reason =
        respuesta['@_CodEstatus'] || respuesta['@_Mensaje']
          ? satStatusLine(respuesta['@_CodEstatus'], respuesta['@_Mensaje'])
          : extractFault(parsed, body, 200);
      files.push({ name: `(sin paquete: ${String(reason).slice(0, 160)})`, size: 0 });
      continue;
    }
    const zipBuf = Buffer.from(String(paqueteB64), 'base64');
    const result = await importPackage(organizationId, zipBuf, requestType);
    imported += result.imported;
    files.push(...result.files);
  }
  return { imported, doneIds, files };
}

/**
 * Human-readable summary of what a download round contained — shown when 0 rows
 * import so nobody has to guess whether the packages were empty or unreadable.
 */
function describeFiles(files) {
  if (!files.length) return 'el SAT no devolvió contenido';
  return files
    .slice(0, 5)
    .map((f) => `${f.name} (${f.size} B)`)
    .join(', ');
}

/** Import one downloaded ZIP (CFDI xml files or a Metadata text file). */
async function importPackage(organizationId, zipBuf, requestType) {
  let entries;
  try {
    entries = readZipEntries(zipBuf);
  } catch {
    return { imported: 0, files: [{ name: '(zip ilegible)', size: zipBuf.length }] };
  }
  if (!entries.length) {
    return { imported: 0, files: [{ name: '(zip sin archivos reconocibles)', size: zipBuf.length }] };
  }
  let imported = 0;
  const files = [];
  for (const entry of entries) {
    const name = (entry.name || '').toLowerCase();
    files.push({ name: entry.name || '(sin nombre)', size: entry.data.length });
    try {
      if (name.endsWith('.xml')) {
        imported += (await importCfdiXml(organizationId, entry.data, requestType)) ? 1 : 0;
      } else if (name.endsWith('.txt') || name.endsWith('.csv') || !name.includes('.')) {
        imported += await importMetadata(organizationId, entry.data, requestType);
      }
    } catch {
      /* one bad entry never aborts the package */
    }
  }
  return { imported, files };
}

async function importCfdiXml(organizationId, buffer, requestType) {
  const parsed = parseCfdi40(buffer.toString('utf8'));
  await invoicesService.upsertFromCfdi({
    organization_id: organizationId,
    uuid_sat: parsed.uuid_sat,
    emitter: parsed.emitter,
    receiver: parsed.receiver,
    total: parsed.total,
    status: 'pending',
    invoice_date: parsed.invoice_date,
    emitter_rfc: parsed.emitter_rfc,
    receiver_rfc: parsed.receiver_rfc,
    subtotal: parsed.subtotal,
    currency: parsed.currency,
    comprobante_type: parsed.comprobante_type,
    forma_pago: parsed.forma_pago,
    metodo_pago: parsed.metodo_pago,
    taxes: parsed.taxes,
    concepts: parsed.concepts,
    direction: requestType === 'received' ? 'received' : 'issued',
    source: 'sat_download',
  });
  return true;
}

/**
 * Parse a SAT metadata file (pure, no DB). Header row + '~'-delimited data
 * rows: Uuid~RfcEmisor~NombreEmisor~RfcReceptor~NombreReceptor~RfcPac~
 * FechaEmision~FechaCertificacionSat~Monto~EfectoComprobante~Estatus~….
 * Robust to the UTF-8 BOM the SAT's generator prepends (without stripping it,
 * the first header cell reads "\uFEFFuuid" and NOTHING imports).
 */
function parseMetadataRows(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0]
    .split('~')
    .map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iUuid = idx(['uuid']);
  const iEmisorRfc = idx(['rfcemisor']);
  const iEmisorName = idx(['nombreemisor']);
  const iReceptorRfc = idx(['rfcreceptor']);
  const iReceptorName = idx(['nombrereceptor']);
  const iFecha = idx(['fechaemision']);
  const iMonto = idx(['monto']);
  if (iUuid < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('~');
    const uuid = (cols[iUuid] || '').trim();
    if (!uuid) continue;
    const monto =
      iMonto >= 0 ? Number((cols[iMonto] || '0').replace(/[^0-9.\-]/g, '')) : 0;
    rows.push({
      uuid,
      emitterRfc: iEmisorRfc >= 0 ? (cols[iEmisorRfc] || '').trim() || null : null,
      receiverRfc: iReceptorRfc >= 0 ? (cols[iReceptorRfc] || '').trim() || null : null,
      emitterName: iEmisorName >= 0 ? (cols[iEmisorName] || '').trim() : '',
      receiverName: iReceptorName >= 0 ? (cols[iReceptorName] || '').trim() : '',
      fecha: iFecha >= 0 ? (cols[iFecha] || '').trim() || null : null,
      monto: Number.isFinite(monto) ? monto : 0,
    });
  }
  return rows;
}

/** Import a SAT metadata file into the ledger. Returns rows imported. */
async function importMetadata(organizationId, buffer, requestType) {
  const rows = parseMetadataRows(buffer.toString('utf8'));
  let count = 0;
  for (const row of rows) {
    const { uuid, emitterRfc, receiverRfc, emitterName, receiverName, fecha, monto } = row;
    await invoicesService.upsertFromCfdi({
      organization_id: organizationId,
      uuid_sat: uuid,
      emitter: emitterName || emitterRfc || 'SAT',
      receiver: receiverName || receiverRfc || 'SAT',
      total: monto,
      status: 'pending',
      invoice_date: fecha ? new Date(fecha) : new Date(),
      emitter_rfc: emitterRfc,
      receiver_rfc: receiverRfc,
      currency: 'MXN',
      direction: requestType === 'received' ? 'received' : 'issued',
      source: 'sat_download',
    });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Request persistence
// ---------------------------------------------------------------------------

async function updateRequest(id, fields) {
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    vals.push(v);
    cols.push(`${k} = $${vals.length}`);
  }
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE finance.sat_download_requests
        SET ${cols.join(', ')}, updated_at = now()
      WHERE id = $${vals.length}
      RETURNING *`,
    vals
  );
  return rows[0];
}

async function listRequests(organizationId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, sat_request_id, request_type, download_type, date_from, date_to,
            status, sat_status_code, sat_message, cfdi_found, cfdi_imported,
            created_at, updated_at
       FROM finance.sat_download_requests
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [organizationId, limit]
  );
  return rows;
}

module.exports = {
  getCredentialsPublic,
  saveCredentials,
  deleteCredentials,
  createRequest,
  checkRequest,
  reimportRequest,
  listRequests,
  // exported for tests
  importMetadata,
  importPackage,
  extractFault,
  parseMetadataRows,
};
