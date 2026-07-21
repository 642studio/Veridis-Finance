/**
 * Bank reconciliation — match imported bank movements against invoices/CFDI.
 *
 * This is the differentiator Siigo/Aspel don't do well: instead of manually
 * ticking off payments, we score each candidate invoice against a bank
 * transaction by amount closeness, date proximity and name overlap, and surface
 * ranked suggestions the user can confirm in one click.
 *
 * `scoreMatch` is pure and unit-tested; `findInvoiceCandidates` runs the DB
 * query and ranks. Confirming a match reuses the existing invoice payment path.
 */

const pool = require('../db/pool');
const invoicesService = require('./invoicesService');
const { money } = require('../lib/money');

const DAY_MS = 24 * 60 * 60 * 1000;
// Only invoices within this amount tolerance and date window are candidates.
const AMOUNT_TOLERANCE = 0.02; // 2%
const DATE_WINDOW_DAYS = 45;

function normalizeTokens(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function nameOverlap(a, b) {
  const ta = new Set(normalizeTokens(a));
  const tb = new Set(normalizeTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

// Mexican RFC pattern — bank SPEI descriptions often carry the counterparty's
// RFC verbatim ("… CONCEPTO FACT 4 RFC HIN120905SE4"). Matching it against the
// invoice's RFC is near-proof of identity, far stronger than name overlap.
const RFC_RE = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g;

function extractRfcs(text) {
  const found = String(text || '').toUpperCase().match(RFC_RE);
  return found ? new Set(found) : new Set();
}

/**
 * Score how well an invoice matches a bank transaction. Returns 0..1 plus the
 * component breakdown. Amount is weighted highest, then date, then name; an
 * RFC found verbatim in the bank description adds a decisive bonus and sets
 * `rfc_match` for the auto-reconciler's tie-breaking.
 *
 * @param {{amount:number|string, date:Date|string, description?:string}} transaction
 * @param {{total:number|string, invoice_date:Date|string, emitter?:string, receiver?:string, emitter_rfc?:string, receiver_rfc?:string, payment_reference?:string}} invoice
 */
function scoreMatch(transaction, invoice) {
  const txnAmount = money(transaction.amount);
  const invTotal = money(invoice.total);

  const diff = txnAmount.minus(invTotal).abs();
  const rel = invTotal.greaterThan(0)
    ? Number(diff.dividedBy(invTotal))
    : diff.greaterThan(0)
      ? 1
      : 0;
  const amountScore = rel <= AMOUNT_TOLERANCE ? 1 - rel / AMOUNT_TOLERANCE / 2 : 0;

  const txnDate = new Date(transaction.date);
  const invDate = new Date(invoice.invoice_date);
  const daysApart = Number.isNaN(txnDate.getTime()) || Number.isNaN(invDate.getTime())
    ? DATE_WINDOW_DAYS
    : Math.abs(txnDate.getTime() - invDate.getTime()) / DAY_MS;
  const dateScore = Math.max(0, 1 - daysApart / DATE_WINDOW_DAYS);

  const nameScore = Math.max(
    nameOverlap(transaction.description, invoice.receiver),
    nameOverlap(transaction.description, invoice.emitter),
    invoice.payment_reference
      ? nameOverlap(transaction.description, invoice.payment_reference)
      : 0
  );

  const descriptionRfcs = extractRfcs(transaction.description);
  const rfcMatch =
    (invoice.emitter_rfc && descriptionRfcs.has(String(invoice.emitter_rfc).toUpperCase())) ||
    (invoice.receiver_rfc && descriptionRfcs.has(String(invoice.receiver_rfc).toUpperCase()));

  const base = 0.6 * amountScore + 0.3 * dateScore + 0.1 * nameScore;
  const score = Math.min(1, base + (rfcMatch ? 0.1 : 0));
  return {
    score: Number(score.toFixed(4)),
    amountScore: Number(amountScore.toFixed(4)),
    dateScore: Number(dateScore.toFixed(4)),
    nameScore: Number(nameScore.toFixed(4)),
    rfc_match: Boolean(rfcMatch),
    days_apart: Math.round(daysApart),
    is_amount_candidate: amountScore > 0,
  };
}

async function getTransaction({ organization_id, transaction_id }) {
  const { rows } = await pool.query(
    `SELECT id, amount, transaction_date, type, description, entity
       FROM finance.transactions
      WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [organization_id, transaction_id]
  );
  return rows[0] || null;
}

/**
 * Ranked invoice candidates for a bank transaction. Pending invoices only,
 * within the amount tolerance and date window, best score first.
 */
async function findInvoiceCandidates({ organization_id, transaction_id, limit = 5 }) {
  const txn = await getTransaction({ organization_id, transaction_id });
  if (!txn) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  const amount = money(txn.amount);
  const lo = Number(amount.times(1 - AMOUNT_TOLERANCE));
  const hi = Number(amount.times(1 + AMOUNT_TOLERANCE));

  // Direction-aware: bank INCOME reconciles against invoices we ISSUED
  // (clients paying us); bank EXPENSE against invoices we RECEIVED (paying
  // suppliers). Legacy invoices without a direction are treated as issued so
  // uploaded-XML receivables keep matching income.
  const direction = txn.type === 'expense' ? 'received' : 'issued';

  const { rows } = await pool.query(
    `SELECT id, uuid_sat, emitter, receiver, emitter_rfc, receiver_rfc,
            total, status, invoice_date, payment_reference
       FROM finance.invoices
      WHERE organization_id = $1
        AND status = 'pending'
        AND COALESCE(direction, 'issued') = $5
        AND total BETWEEN $2 AND $3
        AND invoice_date BETWEEN $4::timestamp - INTERVAL '${DATE_WINDOW_DAYS} days'
                             AND $4::timestamp + INTERVAL '${DATE_WINDOW_DAYS} days'
      LIMIT 50`,
    [organization_id, lo, hi, txn.transaction_date, direction]
  );

  const candidates = rows
    .map((inv) => ({
      invoice_id: inv.id,
      uuid_sat: inv.uuid_sat,
      emitter: inv.emitter,
      receiver: inv.receiver,
      total: Number(inv.total),
      invoice_date: inv.invoice_date,
      match: scoreMatch(
        { amount: txn.amount, date: txn.transaction_date, description: txn.description || txn.entity },
        inv
      ),
    }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);

  return { transaction_id, count: candidates.length, candidates };
}

/**
 * Confirm a reconciliation: mark the invoice paid and stamp the bank reference.
 * Reuses invoicesService so the existing idempotent payment path applies.
 */
async function confirmMatch({ organization_id, transaction_id, invoice_id }) {
  const txn = await getTransaction({ organization_id, transaction_id });
  if (!txn) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }
  return invoicesService.updateInvoiceStatus({
    organization_id,
    invoice_id,
    status: 'paid',
    payment_reference: `bank_txn:${transaction_id}`,
  });
}

// Auto-match thresholds: high confidence AND a clear winner (ambiguity guard).
// The gap must be reachable by the name signal alone (its weight caps the
// possible gap at ~0.10 when amount+date tie), otherwise same-amount candidates
// could never auto-match even with a perfect name hit.
const AUTO_MIN_SCORE = 0.85;
const AUTO_MIN_GAP = 0.08;

/**
 * Bulk auto-reconciliation: scan bank transactions that no invoice references
 * yet, score their candidates, and confirm only unambiguous high-confidence
 * matches (score >= 0.85 and clearly better than the runner-up). Everything
 * else is left for the 1-click manual flow. Runs under a time budget so it
 * never blows the serverless limit; call again to continue.
 */
async function autoReconcile({ organization_id, max_transactions = 100 }) {
  const deadline = Date.now() + 25000;

  // Transactions not yet referenced by any invoice payment.
  const { rows: txns } = await pool.query(
    `SELECT t.id, t.amount, t.transaction_date, t.type, t.description, t.entity
       FROM finance.transactions t
      WHERE t.organization_id = $1
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM finance.invoices i
           WHERE i.organization_id = t.organization_id
             AND i.payment_reference = 'bank_txn:' || t.id::text
        )
      ORDER BY t.transaction_date DESC
      LIMIT $2`,
    [organization_id, max_transactions]
  );

  const summary = { scanned: 0, matched: 0, ambiguous: 0, no_match: 0, remaining: 0 };
  const matches = [];
  const usedInvoices = new Set();

  for (const txn of txns) {
    if (Date.now() > deadline) {
      summary.remaining = txns.length - summary.scanned;
      break;
    }
    summary.scanned += 1;

    const amount = money(txn.amount);
    const lo = Number(amount.times(1 - AMOUNT_TOLERANCE));
    const hi = Number(amount.times(1 + AMOUNT_TOLERANCE));
    const direction = txn.type === 'expense' ? 'received' : 'issued';

    const { rows: invs } = await pool.query(
      `SELECT id, uuid_sat, emitter, receiver, emitter_rfc, receiver_rfc,
              total, invoice_date, payment_reference
         FROM finance.invoices
        WHERE organization_id = $1
          AND status = 'pending'
          AND COALESCE(direction, 'issued') = $5
          AND total BETWEEN $2 AND $3
          AND invoice_date BETWEEN $4::timestamp - INTERVAL '${DATE_WINDOW_DAYS} days'
                               AND $4::timestamp + INTERVAL '${DATE_WINDOW_DAYS} days'
        LIMIT 50`,
      [organization_id, lo, hi, txn.transaction_date, direction]
    );

    const ranked = invs
      .filter((inv) => !usedInvoices.has(inv.id))
      .map((inv) => ({
        inv,
        match: scoreMatch(
          { amount: txn.amount, date: txn.transaction_date, description: txn.description || txn.entity },
          inv
        ),
      }))
      .sort((a, b) => b.match.score - a.match.score);

    if (!ranked.length) {
      summary.no_match += 1;
      continue;
    }

    // Decision, two paths:
    //  a) RFC evidence: the bank description carries the invoice's RFC verbatim
    //     (near-proof of identity). Among RFC-matching candidates only a small
    //     gap is needed — date proximity settles which invoice of that party.
    //  b) Generic: high score AND clearly better than the runner-up. Note that
    //     with identical amount+date the name signal alone caps the gap at
    //     ~0.10, so the generic gap must stay below that ceiling.
    const rfcGroup = ranked.filter((r) => r.match.rfc_match);
    let best = null;
    if (
      rfcGroup.length &&
      rfcGroup[0].match.score >= 0.8 &&
      rfcGroup[0].match.is_amount_candidate &&
      (!rfcGroup[1] || rfcGroup[0].match.score - rfcGroup[1].match.score >= 0.05)
    ) {
      best = rfcGroup[0];
    } else {
      const top = ranked[0];
      const second = ranked[1];
      const clearWinner = !second || top.match.score - second.match.score >= AUTO_MIN_GAP;
      if (top.match.score >= AUTO_MIN_SCORE && top.match.is_amount_candidate && clearWinner) {
        best = top;
      }
    }

    if (best) {
      await invoicesService.updateInvoiceStatus({
        organization_id,
        invoice_id: best.inv.id,
        status: 'paid',
        payment_method: 'conciliacion_auto',
        payment_reference: `bank_txn:${txn.id}`,
      });
      usedInvoices.add(best.inv.id);
      summary.matched += 1;
      matches.push({
        transaction_id: txn.id,
        invoice_id: best.inv.id,
        uuid_sat: best.inv.uuid_sat,
        emitter: best.inv.emitter,
        total: Number(best.inv.total),
        score: best.match.score,
      });
    } else {
      summary.ambiguous += 1;
    }
  }

  return { ...summary, matches };
}

/**
 * Estado de conciliación de una transacción (puro). Un movimiento está
 * conciliado si un CFDI lo referencia (payment_reference = 'bank_txn:<id>').
 * "parcial" cuando el monto del CFDI no cubre el del movimiento (o viceversa).
 */
function reconciliationState(txnAmount, invoiceTotal) {
  if (invoiceTotal == null) return 'sin_conciliar';
  const t = money(txnAmount).abs();
  const i = money(invoiceTotal).abs();
  const diff = t.minus(i).abs();
  const rel = i.greaterThan(0) ? Number(diff.dividedBy(i)) : (diff.greaterThan(0) ? 1 : 0);
  return rel <= AMOUNT_TOLERANCE ? 'conciliado' : 'parcial';
}

/**
 * Bandeja de conciliación: movimientos bancarios del periodo con su estado y el
 * CFDI ligado (si lo hay). Alimenta la vista para confirmar/deshacer.
 */
async function reviewList({ organization_id, year, month, limit = 500 }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_date, t.type, t.amount, t.description, t.original_description,
            t.category, t.match_confidence, t.match_method,
            i.id AS invoice_id, i.uuid_sat, i.emitter, i.receiver, i.total AS invoice_total,
            i.direction AS invoice_direction
       FROM finance.transactions t
       LEFT JOIN finance.invoices i
         ON i.organization_id = t.organization_id
        AND i.payment_reference = 'bank_txn:' || t.id::text
      WHERE t.organization_id = $1 AND t.deleted_at IS NULL
        AND t.transaction_date >= $2::date AND t.transaction_date < ($2::date + interval '1 month')
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT $3`,
    [organization_id, start, limit]
  );

  let conciliadoN = 0;
  let pendienteN = 0;
  let montoConciliado = 0;
  let montoPendiente = 0;
  const items = rows.map((r) => {
    const estado = reconciliationState(r.amount, r.invoice_total);
    const amount = Number(r.amount);
    if (estado === 'sin_conciliar') { pendienteN += 1; montoPendiente += amount; }
    else { conciliadoN += 1; montoConciliado += amount; }
    return {
      id: r.id, date: r.transaction_date, type: r.type, amount,
      concepto: r.description || null,
      descripcion: r.original_description || r.description || null,
      categoria: r.category || null,
      estado,
      match_confidence: r.match_confidence != null ? Number(r.match_confidence) : null,
      match_method: r.match_method || null,
      cfdi: r.invoice_id ? {
        invoice_id: r.invoice_id, uuid_sat: r.uuid_sat,
        emitter: r.emitter, receiver: r.receiver, total: Number(r.invoice_total),
      } : null,
    };
  });

  return {
    year, month,
    resumen: {
      total: items.length,
      conciliados: conciliadoN,
      sin_conciliar: pendienteN,
      monto_conciliado: Number(money(montoConciliado).toFixed(2)),
      monto_pendiente: Number(money(montoPendiente).toFixed(2)),
      pct_conciliado: items.length ? Math.round((conciliadoN / items.length) * 100) : 0,
    },
    items,
  };
}

/**
 * Deshacer una conciliación: regresa el CFDI ligado a 'pending' y limpia la
 * referencia. Anti-duplicado: al liberar el CFDI vuelve a ser candidato.
 */
async function unmatch({ organization_id, transaction_id }) {
  const { rowCount } = await pool.query(
    `UPDATE finance.invoices
        SET status = 'pending', payment_reference = NULL, paid_at = NULL, updated_at = now()
      WHERE organization_id = $1 AND payment_reference = $2`,
    [organization_id, `bank_txn:${transaction_id}`]
  );
  return { unmatched: rowCount > 0 };
}

module.exports = {
  scoreMatch,
  findInvoiceCandidates,
  confirmMatch,
  autoReconcile,
  reviewList,
  unmatch,
  reconciliationState,
  AMOUNT_TOLERANCE,
  DATE_WINDOW_DAYS,
};
