/**
 * Convertir un RECIBO (del CRM) en un CFDI timbrado. Reúsa la emisión existente
 * (cfdiService.issueIngreso) pero valida los prerrequisitos con errores claros:
 *   - El recibo debe ser del CRM y estar pendiente (no ya facturado/cancelado).
 *   - El cliente debe tener su Constancia (CSF) cargada como cfdi_receiver con
 *     RFC, régimen y CP; si no, se pide subir la CSF primero (link de Clientes).
 *
 * Nota fiscal: el total del recibo se trata como monto CON IVA (16% estándar);
 * el subtotal se calcula dividiendo entre 1.16. Revisa el CFDI antes de usarlo
 * si tu operación maneja tasas distintas (exento, 0%, honorarios con retención).
 */

const pool = require('../db/pool');
const cfdiService = require('./cfdiService');

const IVA = 0.16;
// Clave de producto/servicio genérica para servicios (ajústala por operación).
const DEFAULT_PRODUCT_KEY = '84111506'; // Servicios de facturación / administrativos
const DEFAULT_UNIT_KEY = 'E48'; // Unidad de servicio

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function convert({ organizationId, invoiceId, userId }) {
  const { rows } = await pool.query(
    `SELECT id, source, status, receiver, receiver_rfc, total, concepts, sat_estado
       FROM finance.invoices
      WHERE organization_id = $1 AND id = $2 AND direction = 'issued'`,
    [organizationId, invoiceId]
  );
  const recibo = rows[0];
  if (!recibo) throw httpError('Recibo no encontrado.', 404);
  if (recibo.source !== 'crm') {
    throw httpError('Solo se pueden convertir recibos del CRM. Los CFDI ya están timbrados.', 409);
  }
  if (recibo.status === 'cancelled') throw httpError('El recibo está cancelado.', 409);
  if (recibo.status === 'paid' && recibo.sat_estado) {
    throw httpError('Este recibo ya tiene un CFDI asociado.', 409);
  }

  // Buscar el receptor fiscal (con CSF) del cliente: por RFC del recibo o por
  // nombre normalizado contra un cfdi_receiver que ya tenga la Constancia.
  const { rows: receivers } = await pool.query(
    `SELECT id, rfc, name, fiscal_regime, zip_code, cfdi_use, csf_uploaded
       FROM finance.cfdi_receivers
      WHERE organization_id = $1`,
    [organizationId]
  );
  const key = normName(recibo.receiver);
  const match = receivers.find((r) => (recibo.receiver_rfc && r.rfc === recibo.receiver_rfc))
    || receivers.find((r) => normName(r.name) === key);

  if (!match) {
    throw httpError(
      `El cliente "${recibo.receiver}" no está en el directorio fiscal. Pídele su Constancia (CSF) con el link de autoservicio en Clientes.`,
      409
    );
  }
  if (!match.csf_uploaded || !match.fiscal_regime || !match.zip_code) {
    throw httpError(
      `Falta la Constancia (CSF) de "${recibo.receiver}": necesito régimen fiscal y código postal. Mándale el link de CSF desde Clientes.`,
      409
    );
  }

  // Monto: el total del recibo incluye IVA; el subtotal es total / 1.16.
  const total = Number(recibo.total);
  const unitPrice = Number((total / (1 + IVA)).toFixed(2));
  const description = (Array.isArray(recibo.concepts) && recibo.concepts[0]?.description)
    || 'Servicios profesionales';

  const result = await cfdiService.issueIngreso({
    organization_id: organizationId,
    invoice_id: recibo.id,
    receiver_id: match.id,
    items: [{
      description: String(description).slice(0, 1000),
      productKey: DEFAULT_PRODUCT_KEY,
      unitKey: DEFAULT_UNIT_KEY,
      quantity: 1,
      unitPrice,
      ivaRate: IVA,
    }],
    paymentMethod: 'PUE',
    source: 'api',
    source_ref: `recibo:${recibo.id}`,
  });
  return { ok: true, cfdi: result, receiver: match.name };
}

module.exports = { convert };
