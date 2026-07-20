/**
 * Pólizas automáticas (Sprint 9) — genera asientos de partida doble desde los
 * CFDIs del libro de facturas, con reglas de mapeo cuenta↔concepto.
 *
 * Criterio (devengado, estándar contable MX):
 *   CFDI emitido (ingreso):
 *     Cargo  Clientes (total)
 *     Abono  Ingresos (subtotal)
 *     Abono  IVA trasladado (iva)        216.01 PUE / 213.01 PPD no cobrado
 *   CFDI recibido (gasto/compra):
 *     Cargo  Gasto por concepto (subtotal)
 *     Cargo  IVA acreditable (iva)        118.01 pagado / 119.01 PPD pendiente
 *     Abono  Proveedores (total)
 *
 * Idempotente por (source='cfdi', source_ref=uuid): re-ejecutar no duplica.
 * Cuando no hay regla para el gasto, cae a "601.84 Otros gastos" y se puede
 * afinar (S9 IA/entrenamiento de reglas).
 */

const pool = require('../db/pool');
const accounting = require('./accountingService');
const { ivaOfRow } = require('./ivaFlowService');

// Mapa por palabra clave del emisor/concepto -> cuenta de gasto (agrupador SAT).
const EXPENSE_KEYWORDS = [
  [/meta|facebook|instagram|google ads|tiktok|publicidad|ads\b/i, '601.06'],
  [/renta|arrendamiento|wework|oficina/i, '601.10'],
  [/sueldo|n[oó]mina|salario|payroll/i, '601.01'],
  [/software|saas|suscripci|vercel|supabase|clickup|openai|adobe|microsoft|google workspace/i, '601.24'],
  [/cfe|luz|agua|telmex|internet|energ[ií]a|electricidad/i, '601.16'],
  [/comisi[oó]n|bancaria|banco|stripe|mercado ?pago/i, '602.01'],
];

function expenseAccountFor(name) {
  const s = String(name || '');
  for (const [re, code] of EXPENSE_KEYWORDS) if (re.test(s)) return code;
  return '601.84';
}

async function ruleAccount(organizationId, matchType, matchValue) {
  const { rows } = await pool.query(
    `SELECT a.code FROM finance.accounting_rules r
       JOIN finance.chart_of_accounts a ON a.id = r.account_id
      WHERE r.organization_id = $1 AND r.match_type = $2 AND lower(r.match_value) = lower($3)`,
    [organizationId, matchType, matchValue || '']
  );
  return rows[0]?.code || null;
}

/** Build the balanced lines for one invoice. Returns {entry} or null if skippable. */
function linesForInvoice(inv) {
  const iva = ivaOfRow(inv);
  const total = Number(inv.total || 0);
  const ivaAmount = Number(iva.iva || 0);
  const subtotal = inv.subtotal != null ? Number(inv.subtotal) : Number((total - ivaAmount).toFixed(2));
  const isPPD = String(inv.metodo_pago || '').toUpperCase() === 'PPD';

  if (total <= 0) return null;

  if (inv.direction === 'issued') {
    const ivaAcct = isPPD ? '213.01' : '216.01';
    const lines = [
      { account_code: '105.01', debit: total, description: 'Cliente' },
      { account_code: '401.01', credit: subtotal, description: 'Ingreso' },
    ];
    if (ivaAmount > 0) lines.push({ account_code: ivaAcct, credit: ivaAmount, description: 'IVA trasladado' });
    // Cuadre por redondeo: ajusta el ingreso.
    fixRounding(lines);
    return { entry_type: 'ingreso', concept: `CFDI emitido ${inv.receiver || ''}`.trim(), lines, uuid: inv.uuid_sat, date: inv.invoice_date };
  }

  // received
  const ivaAcct = isPPD ? '119.01' : '118.01';
  const gasto = expenseAccountFor(inv.emitter);
  const lines = [
    { account_code: gasto, debit: subtotal, description: 'Gasto/compra' },
  ];
  if (ivaAmount > 0) lines.push({ account_code: ivaAcct, debit: ivaAmount, description: 'IVA acreditable' });
  lines.push({ account_code: '201.01', credit: total, description: 'Proveedor' });
  fixRounding(lines);
  return { entry_type: 'egreso', concept: `CFDI recibido ${inv.emitter || ''}`.trim(), lines, uuid: inv.uuid_sat, date: inv.invoice_date };
}

/** Absorb ±0.01 rounding into the first debit or credit so the entry balances. */
function fixRounding(lines) {
  const d = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const c = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const diff = Number((d - c).toFixed(2));
  if (diff === 0) return;
  if (diff > 0) {
    const target = lines.find((l) => l.credit);
    if (target) target.credit = Number((target.credit + diff).toFixed(2));
  } else {
    const target = lines.find((l) => l.debit);
    if (target) target.debit = Number((target.debit - diff).toFixed(2));
  }
}

/** Generate pólizas from the period's invoices. Returns a summary. */
async function generateForPeriod(organizationId, { year, month, createdBy }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows: invoices } = await pool.query(
    `SELECT uuid_sat, emitter, receiver, emitter_rfc, receiver_rfc, total, subtotal,
            COALESCE(metodo_pago, 'PUE') AS metodo_pago, direction, invoice_date, taxes,
            comprobante_type
       FROM finance.invoices
      WHERE organization_id = $1
        AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')
        AND uuid_sat IS NOT NULL
        AND COALESCE(comprobante_type, 'I') NOT IN ('P', 'N')
      ORDER BY invoice_date ASC`,
    [organizationId, start]
  );

  // Cuáles ya tienen póliza (idempotencia).
  const { rows: existing } = await pool.query(
    `SELECT source_ref FROM finance.journal_entries
      WHERE organization_id = $1 AND source = 'cfdi' AND source_ref = ANY($2)`,
    [organizationId, invoices.map((i) => i.uuid_sat)]
  );
  const done = new Set(existing.map((r) => r.source_ref));

  let posted = 0;
  let skipped = 0;
  const errors = [];
  for (const inv of invoices) {
    if (done.has(inv.uuid_sat)) { skipped += 1; continue; }
    const built = linesForInvoice(inv);
    if (!built) { skipped += 1; continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      await accounting.createEntry(organizationId, {
        entry_type: built.entry_type,
        entry_date: String(built.date).slice(0, 10),
        concept: built.concept,
        source: 'cfdi',
        source_ref: built.uuid,
        created_by: createdBy || null,
        lines: built.lines,
      });
      posted += 1;
    } catch (err) {
      if (err.code === '23505') { skipped += 1; continue; } // ya existe
      errors.push({ uuid: inv.uuid_sat, error: err.message });
    }
  }
  return { invoices: invoices.length, posted, skipped, errors };
}

module.exports = { generateForPeriod, linesForInvoice, expenseAccountFor };
