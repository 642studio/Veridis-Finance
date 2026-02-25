const pdfParse = require('pdf-parse');

const {
  parseStatementByBank,
  normalizeBankName,
} = require('./parserRegistry');

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

async function parseBankStatementPdf({ pdfBuffer, bank }) {
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
  if (!rawText) {
    throw badRequest('Uploaded PDF has no extractable text');
  }

  const parsed = parseStatementByBank(normalizedBank, rawText);

  return {
    bank: parsed.bank || normalizedBank,
    account_number: parsed.account_number || null,
    period_start: toDateOnlyOrNull(parsed.period_start),
    period_end: toDateOnlyOrNull(parsed.period_end),
    transactions: serializeTransactions(parsed.transactions || []),
    raw_text_length: rawText.length,
  };
}

module.exports = {
  parseBankStatementPdf,
};
