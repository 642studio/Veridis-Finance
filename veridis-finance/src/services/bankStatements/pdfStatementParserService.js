const pdfParse = require('pdf-parse');

const {
  parseStatementByBank,
  normalizeBankName,
} = require('./parserRegistry');
const {
  extractPdfJson,
} = require('../../modules/finance/intelligence/ai-provider.service');

const AI_STATEMENT_PROMPT = [
  'Extract ALL transactions from this Mexican bank statement PDF.',
  'Return STRICT JSON only, with this exact shape:',
  '{"bank": string|null, "account_number": string|null,',
  ' "period_start": "YYYY-MM-DD"|null, "period_end": "YYYY-MM-DD"|null,',
  ' "transactions": [{"transaction_date": "YYYY-MM-DD", "type": "income"|"expense",',
  '   "amount": number, "concept": string, "raw_description": string}]}',
  'Rules: amount is always POSITIVE; type is "income" for deposits/abonos and',
  '"expense" for charges/cargos/retiros; skip balance/summary rows; dates in',
  'ISO format; concept is a short cleaned label, raw_description the original line.',
].join('\n');

function normalizeAiTransactions(raw) {
  const list = Array.isArray(raw?.transactions) ? raw.transactions : [];
  return list
    .map((t) => {
      const amount = Number(t?.amount);
      const date = String(t?.transaction_date || '').slice(0, 10);
      const type = t?.type === 'income' ? 'income' : 'expense';
      if (!Number.isFinite(amount) || amount <= 0) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        transaction_date: date,
        type,
        amount: Number(amount.toFixed(2)),
        concept: String(t?.concept || '').slice(0, 255) || null,
        raw_description: String(t?.raw_description || t?.concept || '').slice(0, 500),
        folio: null,
        bank: raw?.bank || null,
      };
    })
    .filter(Boolean);
}

/**
 * AI fallback for scanned or layout-hostile statements: send the PDF itself to
 * Gemini (platform key) and get structured transactions back. Returns null when
 * AI is unavailable or found nothing — the caller keeps its original error.
 */
async function tryAiExtraction({ pdfBuffer, organizationId }) {
  if (!organizationId) return null;
  let raw;
  try {
    raw = await extractPdfJson({
      organizationId,
      pdfBase64: pdfBuffer.toString('base64'),
      prompt: AI_STATEMENT_PROMPT,
      operation: 'statement_ocr',
    });
  } catch {
    return null;
  }
  if (!raw) return null;
  const transactions = normalizeAiTransactions(raw);
  if (transactions.length === 0) return null;
  return {
    bank: raw.bank || null,
    account_number: raw.account_number || null,
    period_start: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.period_start)) ? raw.period_start : null,
    period_end: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.period_end)) ? raw.period_end : null,
    transactions,
    parse_method: 'ai',
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function toIsoDateOrNull(value) {
  if (!(value instanceof Date)) {
    return null;
  }

  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString();
}

function toDateOnlyOrNull(value) {
  const iso = toIsoDateOrNull(value);
  if (!iso) {
    return null;
  }

  return iso.slice(0, 10);
}

function serializeTransactions(transactions) {
  return transactions.map((transaction) => ({
    // Keep date-only to avoid timezone shifts in UI rendering.
    transaction_date: toDateOnlyOrNull(transaction.transaction_date),
    type: transaction.type,
    amount: transaction.amount,
    concept: transaction.concept,
    raw_description: transaction.raw_description,
    folio: transaction.folio,
    bank: transaction.bank,
  }));
}

async function parseBankStatementPdf({ pdfBuffer, bank, organization_id = null }) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw badRequest('PDF file is required');
  }

  const normalizedBank = normalizeBankName(bank);

  let parsedPdf;
  try {
    parsedPdf = await pdfParse(pdfBuffer);
  } catch (error) {
    throw badRequest('Unable to parse bank statement PDF');
  }

  const rawText = String(parsedPdf?.text || '').trim();

  // Scanned PDF (no embedded text): rules can't help — go straight to AI.
  if (!rawText) {
    const ai = await tryAiExtraction({ pdfBuffer, organizationId: organization_id });
    if (ai) {
      return { ...ai, bank: ai.bank || normalizedBank, raw_text_length: 0 };
    }
    throw badRequest(
      'El PDF no tiene texto extraíble (parece escaneado) y la extracción con IA no está disponible'
    );
  }

  let parsed;
  try {
    parsed = parseStatementByBank(normalizedBank, rawText);
  } catch (error) {
    // Layout the rules parser can't read — try the AI fallback before giving up.
    const ai = await tryAiExtraction({ pdfBuffer, organizationId: organization_id });
    if (ai) {
      return { ...ai, bank: ai.bank || normalizedBank, raw_text_length: rawText.length };
    }
    throw error;
  }

  return {
    bank: parsed.bank || normalizedBank,
    account_number: parsed.account_number || null,
    period_start: toDateOnlyOrNull(parsed.period_start),
    period_end: toDateOnlyOrNull(parsed.period_end),
    transactions: serializeTransactions(parsed.transactions || []),
    raw_text_length: rawText.length,
    parse_method: 'rules',
  };
}

module.exports = {
  parseBankStatementPdf,
};
