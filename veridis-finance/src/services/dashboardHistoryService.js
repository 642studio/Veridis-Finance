const pool = require('../db/pool');

// Return a narrow, organization-scoped history. Never present a truncated ledger
// as a complete dashboard. This boundary can become SQL aggregates as volume grows.
async function getDashboardHistory(organizationId) {
  const limit = 20001;
  const [transactions, invoices] = await Promise.all([
    pool.query(`SELECT t.id, t.transaction_date, t.type, t.amount, t.currency,
      t.status, t.category, t.description, t.source, a.name AS account_name
      FROM finance.transactions t
      LEFT JOIN finance.accounts a ON a.id=t.account_id AND a.organization_id=t.organization_id
      WHERE t.organization_id=$1 AND t.deleted_at IS NULL
      ORDER BY t.transaction_date DESC, t.id LIMIT $2`, [organizationId, limit]),
    pool.query(`SELECT id, invoice_date, total, currency, direction, status,
      sat_estado, comprobante_type, emitter, receiver, source, uuid_sat
      FROM finance.invoices WHERE organization_id=$1
      ORDER BY invoice_date DESC, id LIMIT $2`, [organizationId, limit]),
  ]);
  if (transactions.rows.length === limit || invoices.rows.length === limit) {
    const error = new Error('El histórico supera el límite de consulta. Se requiere un reporte agregado antes de mostrar los totales.');
    error.statusCode = 422;
    throw error;
  }
  return { transactions: transactions.rows, invoices: invoices.rows, generated_at: new Date().toISOString() };
}
module.exports = { getDashboardHistory };
