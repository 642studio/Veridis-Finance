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
  if (!token) {
    const fault = firstDeep(parsed, 'faultstring') || `HTTP ${status}`;
    const err = new Error(`SAT rechazó la autenticación: ${String(fault).slice(0, 200)}`);
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
      soap.SOAP_ACTIONS.solicita,
      envelope,
      { Authorization: `WRAP access_token="${token}"` }
    );
    const parsed = xml.parse(body);
    const result = firstDeep(parsed, 'SolicitaDescargaResult') || {};
    const idSolicitud = result['@_IdSolicitud'];
    const cod = result['@_CodEstatus'];
    const mensaje = result['@_Mensaje'] || (idSolicitud ? 'Solicitud aceptada' : `HTTP ${status}`);

    if (!idSolicitud) {
      return updateRequest(req.id, {
        status: 'failed',
        sat_status_code: cod || null,
        sat_message: String(mensaje).slice(0, 400),
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

  const fiel = await loadActiveFiel(organizationId);
  const token = await authenticate(fiel, env);

  const envelope = soap.buildVerificaEnvelope(fiel, req.sat_request_id);
  const { body } = await soap.postSoap(
    soap.endpoints(env).verifica,
    soap.SOAP_ACTIONS.verifica,
    envelope,
    { Authorization: `WRAP access_token="${token}"` }
  );
  const parsed = xml.parse(body);
  const result = firstDeep(parsed, 'VerificaSolicitudDescargaResult') || {};
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
    const imported = await downloadAndImport(organizationId, fiel, token, packageIds, req.request_type, env);
    return updateRequest(req.id, {
      status: 'completed',
      cfdi_imported: imported,
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
  return (Array.isArray(ids) ? ids : [ids]).map((v) => String(v)).filter(Boolean);
}

async function downloadAndImport(organizationId, fiel, token, packageIds, requestType, env) {
  let imported = 0;
  for (const packageId of packageIds) {
    const envelope = soap.buildDescargaEnvelope(fiel, packageId);
    const { body } = await soap.postSoap(
      soap.endpoints(env).descarga,
      soap.SOAP_ACTIONS.descarga,
      envelope,
      { Authorization: `WRAP access_token="${token}"` }
    );
    const parsed = xml.parse(body);
    const paqueteB64 = firstDeep(parsed, 'Paquete');
    if (!paqueteB64) continue;
    const zipBuf = Buffer.from(String(paqueteB64), 'base64');
    imported += await importPackage(organizationId, zipBuf, requestType);
  }
  return imported;
}

/** Import one downloaded ZIP (CFDI xml files or a Metadata text file). */
async function importPackage(organizationId, zipBuf, requestType) {
  let entries;
  try {
    entries = readZipEntries(zipBuf);
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const name = (entry.name || '').toLowerCase();
    try {
      if (name.endsWith('.xml')) {
        count += (await importCfdiXml(organizationId, entry.data, requestType)) ? 1 : 0;
      } else if (name.endsWith('.txt') || name.endsWith('.csv') || !name.includes('.')) {
        count += await importMetadata(organizationId, entry.data, requestType);
      }
    } catch {
      /* one bad entry never aborts the package */
    }
  }
  return count;
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
 * SAT metadata file: header row + '~'-delimited data rows. Columns (order):
 * Uuid, RfcEmisor, NombreEmisor, RfcReceptor, NombreReceptor, RfcPac,
 * FechaEmision, FechaCertificacionSat, Monto, EfectoComprobante, Estatus,
 * FechaCancelacion. We map each row into the ledger.
 */
async function importMetadata(organizationId, buffer, requestType) {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return 0;

  const header = lines[0].split('~').map((h) => h.trim().toLowerCase());
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
  if (iUuid < 0) return 0;

  let count = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('~');
    const uuid = (cols[iUuid] || '').trim();
    if (!uuid) continue;
    const emitterRfc = iEmisorRfc >= 0 ? (cols[iEmisorRfc] || '').trim() : null;
    const receiverRfc = iReceptorRfc >= 0 ? (cols[iReceptorRfc] || '').trim() : null;
    const emitterName = iEmisorName >= 0 ? (cols[iEmisorName] || '').trim() : '';
    const receiverName = iReceptorName >= 0 ? (cols[iReceptorName] || '').trim() : '';
    const fecha = iFecha >= 0 ? (cols[iFecha] || '').trim() : null;
    const monto = iMonto >= 0 ? Number((cols[iMonto] || '0').replace(/[^0-9.\-]/g, '')) : 0;

    await invoicesService.upsertFromCfdi({
      organization_id: organizationId,
      uuid_sat: uuid,
      emitter: emitterName || emitterRfc || 'SAT',
      receiver: receiverName || receiverRfc || 'SAT',
      total: Number.isFinite(monto) ? monto : 0,
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
  listRequests,
  // exported for tests
  importMetadata,
  importPackage,
};
