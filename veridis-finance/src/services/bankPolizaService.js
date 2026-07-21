/**
 * Pólizas de flujo desde el banco (Sprint 22).
 *
 * El CFDI ya registró el DEVENGADO (Cliente/Ingreso, Gasto/Proveedor). Cuando un
 * movimiento bancario se concilia contra ese CFDI, falta el FLUJO: el cobro o el
 * pago que mueve la cuenta por cobrar/pagar a Bancos. Esta póliza NO vuelve a
 * registrar el ingreso/gasto — solo el efectivo:
 *
 *   Cobro de cliente (depósito):   Cargo 102.01 Bancos / Abono 105.01 Clientes
 *   Pago a proveedor (retiro):     Cargo 201.01 Proveedores / Abono 102.01 Bancos
 *
 * Idempotente por (source='bank', source_ref='<transaction_id>'). Así conviven
 * devengado y flujo enlazados, sin duplicar el resultado.
 */

const pool = require('../db/pool');
const accounting = require('./accountingService');

const BANCOS = '102.01';
const CLIENTES = '105.01';
const PROVEEDORES = '201.01';

/** Líneas de la póliza de flujo (puro). income=cobro, expense=pago. */
function linesForBankMovement({ type, amount }) {
  const monto = Number(amount);
  if (!(monto > 0)) return null;
  if (type === 'income') {
    return {
      entry_type: 'ingreso',
      lines: [
        { account_code: BANCOS, debit: monto, description: 'Cobro (depósito)' },
        { account_code: CLIENTES, credit: monto, description: 'Cancela cuenta por cobrar' },
      ],
    };
  }
  return {
    entry_type: 'egreso',
    lines: [
      { account_code: PROVEEDORES, debit: monto, description: 'Cancela cuenta por pagar' },
      { account_code: BANCOS, credit: monto, description: 'Pago (retiro)' },
    ],
  };
}

/**
 * Genera las pólizas de cobro/pago de los movimientos CONCILIADOS del periodo
 * (los que ya están ligados a un CFDI). Idempotente.
 */
async function generateForPeriod(organizationId, { year, month, createdBy }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows: txns } = await pool.query(
    `SELECT t.id, t.type, t.amount, t.transaction_date, t.description,
            i.emitter, i.receiver
       FROM finance.transactions t
       JOIN finance.invoices i
         ON i.organization_id = t.organization_id
        AND i.payment_reference = 'bank_txn:' || t.id::text
      WHERE t.organization_id = $1 AND t.deleted_at IS NULL
        AND t.transaction_date >= $2::date AND t.transaction_date < ($2::date + interval '1 month')
      ORDER BY t.transaction_date ASC`,
    [organizationId, start]
  );

  // Cuáles ya tienen póliza de flujo (idempotencia).
  const { rows: existing } = await pool.query(
    `SELECT source_ref FROM finance.journal_entries
      WHERE organization_id = $1 AND source = 'bank' AND source_ref = ANY($2)`,
    [organizationId, txns.map((t) => t.id)]
  );
  const done = new Set(existing.map((r) => r.source_ref));

  let posted = 0;
  let skipped = 0;
  const errors = [];
  for (const t of txns) {
    if (done.has(t.id)) { skipped += 1; continue; }
    const built = linesForBankMovement(t);
    if (!built) { skipped += 1; continue; }
    const quien = t.type === 'income' ? (t.receiver || 'cliente') : (t.emitter || 'proveedor');
    try {
      // eslint-disable-next-line no-await-in-loop
      await accounting.createEntry(organizationId, {
        entry_type: built.entry_type,
        entry_date: new Date(t.transaction_date).toISOString().slice(0, 10),
        concept: `${t.type === 'income' ? 'Cobro' : 'Pago'} ${quien}`.trim(),
        source: 'bank',
        source_ref: t.id,
        created_by: createdBy || null,
        lines: built.lines,
      });
      posted += 1;
    } catch (err) {
      if (err.code === '23505') { skipped += 1; continue; }
      errors.push({ transaction_id: t.id, error: err.message });
    }
  }
  return { conciliados: txns.length, posted, skipped, errors };
}

module.exports = { generateForPeriod, linesForBankMovement };
