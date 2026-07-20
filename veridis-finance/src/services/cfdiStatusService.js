/**
 * Validación automática de comprobantes (paridad Siigo Fiscal).
 *
 * Consulta el estatus de cada CFDI ante el SAT (Vigente / Cancelado /
 * No Encontrado) usando el servicio público ConsultaCFDI (SOAP, sin
 * autenticación). Detecta cancelaciones posteriores y levanta alertas en el
 * centro de notificaciones — el caso que duele: una factura que tu proveedor
 * o cliente canceló después del cierre.
 */

const pool = require('../db/pool');
const notifications = require('./notificationsService');

const CONSULTA_URL =
  process.env.SAT_CONSULTA_URL ||
  'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc';

const SOAP_ACTION = 'http://tempuri.org/IConsultaCFDIService/Consulta';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build the SAT "expresión impresa" query for one CFDI. */
function buildExpresion({ emisorRfc, receptorRfc, total, uuid }) {
  const tt = Number(total || 0).toFixed(6);
  return `?re=${emisorRfc}&rr=${receptorRfc}&tt=${tt}&id=${uuid}`;
}

function soapEnvelope(expresion) {
  return (
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<s:Body><Consulta xmlns="http://tempuri.org/">' +
    `<expresionImpresa>${esc(expresion)}</expresionImpresa>` +
    '</Consulta></s:Body></s:Envelope>'
  );
}

function pick(xml, tag) {
  const m = xml.match(new RegExp(`<[^>]*:?${tag}[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
}

/** Ask the SAT for one CFDI's estado. Returns {estado, es_cancelable, estatus_cancelacion}. */
async function consulta({ emisorRfc, receptorRfc, total, uuid }) {
  const res = await fetch(CONSULTA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: SOAP_ACTION,
    },
    body: soapEnvelope(buildExpresion({ emisorRfc, receptorRfc, total, uuid })),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = new Error(`SAT ConsultaCFDI respondió ${res.status}`);
    err.statusCode = 502;
    throw err;
  }
  const xml = await res.text();
  return {
    estado: pick(xml, 'Estado'),
    es_cancelable: pick(xml, 'EsCancelable'),
    estatus_cancelacion: pick(xml, 'EstatusCancelacion'),
  };
}

/** Invoices worth checking: with UUID+RFCs, never checked or stale (and not already canceled). */
async function pendingRows(organizationId, limit) {
  const { rows } = await pool.query(
    `SELECT id, uuid_sat, emitter, receiver, emitter_rfc, receiver_rfc, total,
            direction, sat_estado
       FROM finance.invoices
      WHERE organization_id = $1
        AND uuid_sat IS NOT NULL AND length(uuid_sat) >= 30
        AND emitter_rfc IS NOT NULL AND receiver_rfc IS NOT NULL
        AND COALESCE(sat_estado, '') <> 'Cancelado'
        AND (sat_estado_checked_at IS NULL OR sat_estado_checked_at < now() - interval '7 days')
      ORDER BY sat_estado_checked_at ASC NULLS FIRST, invoice_date DESC
      LIMIT $2`,
    [organizationId, limit]
  );
  return rows;
}

/**
 * Verify a batch of the tenant's CFDIs against the SAT. Sequential with a small
 * budget so it fits a serverless invocation. Raises an alert when a previously
 * vigente (or unknown) CFDI turns out Cancelado.
 */
async function verifyBatch(organizationId, { limit = 25 } = {}) {
  const rows = await pendingRows(organizationId, limit);
  const result = { checked: 0, vigentes: 0, cancelados: 0, no_encontrados: 0, nuevos_cancelados: 0, errors: 0 };

  for (const row of rows) {
    let estado;
    try {
      // eslint-disable-next-line no-await-in-loop
      estado = await consulta({
        emisorRfc: row.emitter_rfc,
        receptorRfc: row.receiver_rfc,
        total: row.total,
        uuid: row.uuid_sat,
      });
    } catch {
      result.errors += 1;
      continue;
    }
    result.checked += 1;
    if (/vigente/i.test(estado.estado || '')) result.vigentes += 1;
    else if (/cancelado/i.test(estado.estado || '')) result.cancelados += 1;
    else result.no_encontrados += 1;

    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `UPDATE finance.invoices
          SET sat_estado = $3, sat_estado_checked_at = now(),
              sat_es_cancelable = $4, sat_estatus_cancelacion = $5
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, row.id, estado.estado || 'No Encontrado', estado.es_cancelable, estado.estatus_cancelacion]
    );

    const wasCanceled = /cancelado/i.test(row.sat_estado || '');
    if (/cancelado/i.test(estado.estado || '') && !wasCanceled) {
      result.nuevos_cancelados += 1;
      const who = row.direction === 'received' ? row.emitter : row.receiver;
      // eslint-disable-next-line no-await-in-loop
      await notifications.notify(organizationId, {
        type: 'cfdi_canceled',
        severity: 'critical',
        title: `CFDI cancelado ante el SAT: ${String(row.uuid_sat).slice(0, 13)}…`,
        body: `${row.direction === 'received' ? 'Tu proveedor' : 'El CFDI a'} ${who || ''} por $${Number(row.total).toLocaleString('es-MX')} aparece CANCELADO. Revisa su efecto en IVA y contabilidad.`,
        ref_type: 'cfdi',
        ref_id: row.uuid_sat,
        email: true,
      });
    }
  }
  return result;
}

/** Summary of estados for the tenant (for the validation card). */
async function statusSummary(organizationId) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE uuid_sat IS NOT NULL)::int                          AS con_uuid,
       count(*) FILTER (WHERE sat_estado = 'Vigente')::int                        AS vigentes,
       count(*) FILTER (WHERE sat_estado = 'Cancelado')::int                      AS cancelados,
       count(*) FILTER (WHERE sat_estado IS NOT NULL
                          AND sat_estado NOT IN ('Vigente', 'Cancelado'))::int    AS no_encontrados,
       count(*) FILTER (WHERE uuid_sat IS NOT NULL AND sat_estado IS NULL)::int   AS sin_verificar,
       max(sat_estado_checked_at)                                                 AS last_checked_at
     FROM finance.invoices
     WHERE organization_id = $1`,
    [organizationId]
  );
  return rows[0];
}

module.exports = { consulta, verifyBatch, statusSummary, buildExpresion };
