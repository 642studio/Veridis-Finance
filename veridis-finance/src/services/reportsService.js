const pool = require('../db/pool');

function toAmount(value) {
  return Number.parseFloat(value || '0');
}

async function getMonthlyReport({ organization_id, year, month }) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const summaryQuery = {
    text: `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net_profit,
        COUNT(*)::int AS transaction_count
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND transaction_date < $3
        AND deleted_at IS NULL
    `,
    values: [organization_id, periodStart, periodEnd],
  };

  const byCategoryQuery = {
    text: `
      SELECT
        category,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net_profit,
        COUNT(*)::int AS transaction_count
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND transaction_date < $3
        AND deleted_at IS NULL
      GROUP BY category
      ORDER BY category ASC
    `,
    values: [organization_id, periodStart, periodEnd],
  };

  const [summaryResult, byCategoryResult] = await Promise.all([
    pool.query(summaryQuery),
    pool.query(byCategoryQuery),
  ]);

  const summary = summaryResult.rows[0];

  return {
    organization_id,
    year,
    month,
    total_income: toAmount(summary.total_income),
    total_expense: toAmount(summary.total_expense),
    net_profit: toAmount(summary.net_profit),
    transaction_count: summary.transaction_count,
    by_category: byCategoryResult.rows.map((row) => ({
      category: row.category,
      total_income: toAmount(row.total_income),
      total_expense: toAmount(row.total_expense),
      net_profit: toAmount(row.net_profit),
      transaction_count: row.transaction_count,
    })),
  };
}

/**
 * DIOT groundwork: monthly IVA by supplier RFC, from uploaded received CFDIs.
 * Aggregates the structured tax fields persisted since migration 007 —
 * invoices uploaded before it lack RFC/taxes and are reported under
 * `unclassified_count` so the accountant knows the coverage.
 */
async function getDiotReport({ organization_id, year, month }) {
  const { rows } = await pool.query(
    `
      SELECT
        emitter_rfc,
        max(emitter) AS emitter_name,
        count(*)::int AS invoice_count,
        COALESCE(SUM(subtotal), 0) AS base_total,
        COALESCE(SUM((taxes->>'total_trasladados')::numeric), 0) AS iva_trasladado,
        COALESCE(SUM((taxes->>'total_retenidos')::numeric), 0) AS iva_retenido,
        COALESCE(SUM(total), 0) AS total
      FROM finance.invoices
      WHERE organization_id = $1
        AND date_part('year', invoice_date) = $2
        AND date_part('month', invoice_date) = $3
        AND emitter_rfc IS NOT NULL
        AND direction = 'received'
      GROUP BY emitter_rfc
      ORDER BY total DESC
    `,
    [organization_id, year, month]
  );

  const { rows: missing } = await pool.query(
    `
      SELECT count(*)::int AS unclassified_count
      FROM finance.invoices
      WHERE organization_id = $1
        AND date_part('year', invoice_date) = $2
        AND date_part('month', invoice_date) = $3
        AND emitter_rfc IS NULL
    `,
    [organization_id, year, month]
  );

  return {
    year,
    month,
    suppliers: rows.map((row) => ({
      rfc: row.emitter_rfc,
      name: row.emitter_name,
      invoice_count: row.invoice_count,
      base_total: Number(row.base_total),
      iva_trasladado: Number(row.iva_trasladado),
      iva_retenido: Number(row.iva_retenido),
      total: Number(row.total),
    })),
    // Invoices uploaded before the structured parser; re-upload to include them.
    unclassified_count: missing[0]?.unclassified_count || 0,
  };
}

/**
 * DIOT batch file (carga masiva): the classic 23-field pipe-delimited layout
 * the SAT's DIOT applet imports. One line per national supplier:
 *
 *   1  Tipo de tercero          04 = proveedor nacional
 *   2  Tipo de operación        85 = otros
 *   3  RFC
 *   4  ID fiscal (extranjero)   —
 *   5  Nombre del extranjero    —
 *   6  País de residencia       —
 *   7  Nacionalidad             —
 *   8  Base IVA 16%             (valor de actos pagados a la tasa general)
 *   9..15                       otras tasas (fronteriza, importación, 0%…) — vacías
 *   16 IVA exento               —
 *   17 IVA retenido             (redondeado a pesos)
 *   18..23                      devoluciones y campos finales — vacíos
 *
 * Amounts are whole pesos (the applet rejects decimals). Suppliers without RFC
 * can't go in the DIOT; they stay in the report's unclassified_count.
 */
async function getDiotBatchFile({ organization_id, year, month }) {
  const report = await getDiotReport({ organization_id, year, month });

  const lines = report.suppliers
    .filter((s) => s.rfc)
    .map((s) => {
      const fields = new Array(23).fill('');
      fields[0] = '04';
      fields[1] = '85';
      fields[2] = String(s.rfc).trim().toUpperCase();
      fields[7] = String(Math.round(s.base_total || 0));
      fields[16] = s.iva_retenido ? String(Math.round(s.iva_retenido)) : '';
      return fields.join('|');
    });

  return {
    filename: `DIOT_${year}_${String(month).padStart(2, '0')}.txt`,
    content: lines.join('\r\n') + (lines.length ? '\r\n' : ''),
    supplier_count: lines.length,
    unclassified_count: report.unclassified_count,
  };
}

/** Aging bucket for an invoice `days` old. Pure — unit tested. */
function agingBucket(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'];

/**
 * Antigüedad de saldos: pending invoices grouped by how many days old they are,
 * split into receivables (issued — clients owe us) and payables (received — we
 * owe suppliers). Fed by the unified ledger, so SAT/CRM/XML sources all count.
 */
async function getAgingReport({ organization_id }) {
  const { rows } = await pool.query(
    `SELECT COALESCE(direction, 'issued') AS direction,
            emitter, receiver, emitter_rfc, receiver_rfc, total, invoice_date,
            GREATEST(0, EXTRACT(DAY FROM now() - invoice_date))::int AS days_old
       FROM finance.invoices
      WHERE organization_id = $1
        AND status = 'pending'
      ORDER BY invoice_date ASC`,
    [organization_id]
  );

  const empty = () => ({
    total: 0,
    count: 0,
    buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, { total: 0, count: 0 }])),
    oldest: [],
  });
  const receivables = empty();
  const payables = empty();

  for (const row of rows) {
    const side = row.direction === 'received' ? payables : receivables;
    const bucket = agingBucket(row.days_old);
    const amount = Number(row.total) || 0;
    side.total += amount;
    side.count += 1;
    side.buckets[bucket].total += amount;
    side.buckets[bucket].count += 1;
    if (side.oldest.length < 10) {
      side.oldest.push({
        counterparty: row.direction === 'received' ? row.emitter : row.receiver,
        rfc: row.direction === 'received' ? row.emitter_rfc : row.receiver_rfc,
        total: amount,
        invoice_date: row.invoice_date,
        days_old: row.days_old,
      });
    }
  }

  const round = (side) => {
    side.total = Number(side.total.toFixed(2));
    for (const b of AGING_BUCKETS) side.buckets[b].total = Number(side.buckets[b].total.toFixed(2));
    return side;
  };

  return { receivables: round(receivables), payables: round(payables) };
}

/** Compose a polite es-MX collection reminder for one client. Pure. */
function composeReminderMessage({ counterparty, invoices, total }) {
  const fmt = (n) =>
    Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const lines = invoices
    .slice(0, 10)
    .map(
      (inv) =>
        `  • ${fmt(inv.total)} — factura del ${String(inv.invoice_date).slice(0, 10)} (${inv.days_old} días)`
    )
    .join('\n');
  return (
    `Hola ${counterparty}:\n\n` +
    `Te compartimos un recordatorio amistoso de tu saldo pendiente por ${fmt(total)}:\n\n` +
    `${lines}\n\n` +
    `Si ya realizaste el pago, por favor ignora este mensaje o compártenos el comprobante. ` +
    `Quedamos atentos, ¡gracias!`
  );
}

/**
 * Recordatorios de cobro: pending ISSUED invoices grouped by client, each with
 * a ready-to-send es-MX message (copy/paste to WhatsApp or email). Skips
 * synthetic CRM placeholders? No — CRM sales are real receivables too.
 */
async function getCollectionReminders({ organization_id }) {
  const { rows } = await pool.query(
    `SELECT receiver, receiver_rfc, total, invoice_date,
            GREATEST(0, EXTRACT(DAY FROM now() - invoice_date))::int AS days_old
       FROM finance.invoices
      WHERE organization_id = $1
        AND status = 'pending'
        AND COALESCE(direction, 'issued') = 'issued'
      ORDER BY invoice_date ASC`,
    [organization_id]
  );

  const byClient = new Map();
  for (const row of rows) {
    const key = `${row.receiver || '—'}|${row.receiver_rfc || ''}`;
    if (!byClient.has(key)) {
      byClient.set(key, {
        counterparty: row.receiver || row.receiver_rfc || 'Cliente',
        rfc: row.receiver_rfc || null,
        total: 0,
        invoice_count: 0,
        max_days_old: 0,
        invoices: [],
      });
    }
    const c = byClient.get(key);
    c.total += Number(row.total) || 0;
    c.invoice_count += 1;
    c.max_days_old = Math.max(c.max_days_old, row.days_old);
    if (c.invoices.length < 10) {
      c.invoices.push({
        total: Number(row.total) || 0,
        invoice_date: row.invoice_date,
        days_old: row.days_old,
      });
    }
  }

  const clients = [...byClient.values()]
    .map((c) => ({
      counterparty: c.counterparty,
      rfc: c.rfc,
      total: Number(c.total.toFixed(2)),
      invoice_count: c.invoice_count,
      max_days_old: c.max_days_old,
      message: composeReminderMessage(c),
    }))
    .sort((a, b) => b.max_days_old - a.max_days_old || b.total - a.total);

  return { clients };
}

module.exports = {
  getMonthlyReport,
  getDiotReport,
  getDiotBatchFile,
  getAgingReport,
  getCollectionReminders,
  composeReminderMessage,
  agingBucket,
};
