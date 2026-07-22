/**
 * Registro de pago manual en tiempo real (F-B). Cuando un cliente te paga y tú
 * lo capturas al momento (comprobante de transferencia, depósito, efectivo),
 * esto crea el MOVIMIENTO en el flujo del banco y, si lo ligas a un recibo o
 * factura pendiente, lo concilia en un solo paso (marca pagado + enlazado).
 *
 * No duplica ingresos: el movimiento es el dinero real (flujo); el recibo/CFDI
 * es la otra lente y queda ligado, no sumado.
 */

const pool = require('../db/pool');
const transactionsService = require('./transactionsService');
const reconciliation = require('./reconciliationService');

const METHOD_LABEL = {
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  stripe: 'Stripe',
  otro: 'Otro',
};

async function registerPayment({
  organizationId, userId, amount, date, accountId = null, clientId = null,
  invoiceId = null, method = 'transferencia', reference = null, concept = null,
}) {
  const monto = Number(amount);
  if (!(monto > 0)) {
    const err = new Error('El monto debe ser mayor a 0.');
    err.statusCode = 400;
    throw err;
  }
  const fecha = date ? new Date(date) : new Date();
  if (Number.isNaN(fecha.getTime())) {
    const err = new Error('Fecha inválida.');
    err.statusCode = 400;
    throw err;
  }

  // Nombre del cliente para el concepto (si se ligó a un recibo/cliente).
  let clienteNombre = null;
  if (invoiceId) {
    const { rows } = await pool.query(
      `SELECT receiver, status, direction FROM finance.invoices
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, invoiceId]
    );
    if (!rows[0]) {
      const err = new Error('Recibo/factura no encontrado.');
      err.statusCode = 404;
      throw err;
    }
    if (rows[0].direction !== 'issued') {
      const err = new Error('Solo se pueden cobrar comprobantes emitidos.');
      err.statusCode = 409;
      throw err;
    }
    if (rows[0].status !== 'pending') {
      const err = new Error('Ese comprobante ya no está pendiente.');
      err.statusCode = 409;
      throw err;
    }
    clienteNombre = rows[0].receiver;
  } else if (clientId) {
    const { rows } = await pool.query(
      `SELECT business_name, name FROM finance.clients WHERE organization_id = $1 AND id = $2`,
      [organizationId, clientId]
    );
    clienteNombre = rows[0]?.business_name || rows[0]?.name || null;
  }

  const metodo = METHOD_LABEL[method] || 'Pago';
  const description = concept
    || (clienteNombre ? `Pago de ${clienteNombre} — ${metodo}` : `Cobro (${metodo})`);

  // 1) Crea el movimiento en el flujo (ingreso).
  const txn = await transactionsService.createTransaction({
    organization_id: organizationId,
    type: 'income',
    amount: monto,
    transaction_date: fecha,
    description,
    original_description: reference ? `${description} · Ref ${reference}` : description,
    category: 'Ventas y servicios',
    account_id: accountId,
    client_id: clientId,
    source: 'manual',
    status: 'posted',
    notes: reference ? `Ref: ${reference}` : null,
  }, { actor_user_id: userId || null });

  // 2) Si se ligó a un recibo/factura, concilia (paga + enlaza). Atomicidad
  // cross-service: si la conciliación falla, revierte el movimiento recién
  // creado (soft-delete) para no dejar dinero registrado sin su factura.
  let reconciled = null;
  if (invoiceId) {
    try {
      reconciled = await reconciliation.confirmMatch({
        organization_id: organizationId,
        transaction_id: txn.id,
        invoice_id: invoiceId,
      });
    } catch (err) {
      await transactionsService.deleteTransaction({
        organization_id: organizationId, transaction_id: txn.id,
        actor_user_id: userId || null, audit_source: 'rollback_pago',
      }).catch(() => {});
      throw err;
    }
  }

  return {
    ok: true,
    transaction: { id: txn.id, amount: monto, date: fecha, description },
    reconciled: reconciled ? { invoice_id: invoiceId, status: 'paid' } : null,
  };
}

module.exports = { registerPayment };
