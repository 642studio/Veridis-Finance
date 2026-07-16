/**
 * Generic Mexican bank statement parser.
 *
 * Most MX bank statements (Banorte, BBVA, HSBC, Banamex, ...) share the same
 * tabular shape: a header row with "FECHA ... DESCRIPCION ... (DEPOSITO/ABONO)
 * (RETIRO/CARGO) SALDO", followed by movement rows that begin with a date and
 * end with two money tokens (the movement amount and the running balance).
 *
 * Instead of hand-tuning a regex parser per bank (which needs real sample PDFs
 * to get right), this parser relies on the bank-agnostic running-balance delta:
 * for each row it reads the last two money tokens as (amount, balance) and infers
 * income/expense from how the balance moved. This is the same core heuristic the
 * Santander parser uses, generalised. It is intentionally conservative and throws
 * a 400 when it cannot confidently locate the movement table.
 */

const SPANISH_MONTHS = Object.freeze({
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
});

const MONEY_TOKEN_REGEX = /(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}/g;
const TRANSACTION_START_REGEX = /^(\d{2}[\/-](?:\d{2}|[A-Z]{3})[\/-]\d{2,4})(.*)$/i;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeBankText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function compactNormalizedText(text) {
  return normalizeBankText(text).replace(/\s+/g, '');
}

function normalizeLines(rawText) {
  return String(rawText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeMonthToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

function normalizeYear(year) {
  const numeric = Number.parseInt(year, 10);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 100) {
    return 2000 + numeric;
  }
  return numeric;
}

function buildUtcDate(day, month, year) {
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseMexicanDate(rawDate) {
  const value = String(rawDate || '').trim().toUpperCase();

  let match = value.match(/^(\d{2})[\/-](\d{2})[\/-](\d{2,4})$/);
  if (match) {
    return buildUtcDate(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      normalizeYear(match[3])
    );
  }

  match = value.match(/^(\d{2})[\/-]([A-Z]{3})[\/-](\d{2,4})$/);
  if (!match) {
    return null;
  }

  return buildUtcDate(
    Number.parseInt(match[1], 10),
    SPANISH_MONTHS[normalizeMonthToken(match[2])],
    normalizeYear(match[3])
  );
}

function parseMoney(rawValue) {
  const input = String(rawValue || '')
    .trim()
    .replace(/\$/g, '')
    .replace(/,/g, '');

  if (!input || input === '-' || input === '--') {
    return 0;
  }

  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(Math.abs(parsed).toFixed(2));
}

function trimLength(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function approximatelyEqual(left, right, tolerance = 0.03) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= tolerance;
}

function deriveConcept(description) {
  const text = normalizeBankText(description);

  if (text.includes('spei')) return 'spei';
  if (text.includes('nomina')) return 'nomina';
  if (text.includes('stripe')) return 'stripe';
  if (text.includes('transferencia') || text.includes('traspaso')) return 'transferencia';
  if (text.includes('comision')) return 'comision';
  if (text.includes('retiro') || text.includes('cajero') || text.includes('atm')) return 'retiro';
  if (text.includes('deposito') || text.includes('abono')) return 'deposito';
  if (text.includes('pago')) return 'pago';

  return 'movimiento_bancario';
}

function removeTrailingAmountPair(text) {
  return String(text || '')
    .replace(
      /(?:\s|)(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\s*(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\s*$/,
      ''
    )
    .trim();
}

function extractAmountAndBalance(line) {
  const rawLine = String(line || '').trim().toUpperCase();
  const matches = rawLine.match(MONEY_TOKEN_REGEX) || [];
  if (matches.length < 2) {
    return null;
  }

  const amount = parseMoney(matches[matches.length - 2]);
  const balance = parseMoney(matches[matches.length - 1]);

  if (!(amount > 0) || !Number.isFinite(balance)) {
    return null;
  }

  return { amount, balance };
}

function extractAccountNumber(rawText, lines) {
  const text = String(rawText || '');
  const patterns = [
    /CUENTA\s+CLABE[:\s]*([0-9\s-]{10,30})/i,
    /CLABE[:\s]*([0-9]{18})/i,
    /(?:NUMERO|N[ÚU]MERO|NO\.?)[\s:]*DE[\s:]*CUENTA[\s:]*([0-9*\s-]{6,30})/i,
    /(?:CUENTA|CTA)[:\s]*([0-9*\s-]{6,30})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[1]) continue;
    const normalized = match[1].replace(/\s+/g, '').replace(/-/g, '');
    if (normalized.length >= 6) {
      return normalized;
    }
  }

  for (const line of lines) {
    const clabeMatch = line.match(/\b\d{18}\b/);
    if (clabeMatch) return clabeMatch[0];
  }

  for (const line of lines) {
    const match = line.match(/\b\d{10,20}\b/);
    if (match) return match[0];
  }

  return null;
}

function extractPeriod(rawText) {
  const patterns = [
    /PERIODO(?:\s*DEL)?\s*(\d{2}[\/-](?:\d{2}|[A-Z]{3})[\/-]\d{2,4})\s*(?:AL|A)\s*(\d{2}[\/-](?:\d{2}|[A-Z]{3})[\/-]\d{2,4})/i,
    /DEL\s*(\d{2}[\/-](?:\d{2}|[A-Z]{3})[\/-]\d{2,4})\s*AL\s*(\d{2}[\/-](?:\d{2}|[A-Z]{3})[\/-]\d{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = String(rawText || '').match(pattern);
    if (!match) continue;
    const start = parseMexicanDate(match[1]);
    const end = parseMexicanDate(match[2]);
    if (start && end) {
      return { period_start: start, period_end: end };
    }
  }

  return { period_start: null, period_end: null };
}

/**
 * Finds the index just after the movement-table header row. `headerTokens` are
 * lowercase, accent-free substrings that must all be present in the compacted
 * header line (e.g. ['fecha', 'descripcion', 'saldo']).
 */
function findTransactionsStart(lines, headerTokens) {
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = compactNormalizedText(lines[index]);
    if (headerTokens.every((token) => normalized.includes(token))) {
      return index + 1;
    }
  }
  return -1;
}

function shouldStopTransactions(line) {
  const normalized = compactNormalizedText(line);
  return (
    normalized.startsWith('total') ||
    normalized.startsWith('saldofinal') ||
    normalized.startsWith('saldototal') ||
    normalized.startsWith('informacionfiscal') ||
    normalized.startsWith('resumen') ||
    normalized.startsWith('leyenda') ||
    normalized.startsWith('detalledecomisiones')
  );
}

function isTransactionStartLine(line) {
  return TRANSACTION_START_REGEX.test(String(line || '').toUpperCase());
}

function parseTransactionStartLine(line) {
  const match = String(line || '').toUpperCase().match(TRANSACTION_START_REGEX);
  if (!match) return null;

  const transactionDate = parseMexicanDate(match[1]);
  if (!transactionDate) return null;

  let detailText = match[2].trim();
  let folio = '';

  const folioMatch = detailText.match(/^(\d{6,12})(.*)$/);
  if (folioMatch) {
    folio = folioMatch[1];
    detailText = folioMatch[2].trim();
  }

  const cleanedDetail = removeTrailingAmountPair(detailText);

  return {
    transaction_date: transactionDate,
    folio,
    description_lines: cleanedDetail ? [cleanedDetail] : [],
    amount: null,
    balance: null,
  };
}

function inferTypeFromDescription(description) {
  const normalized = normalizeBankText(description);
  const positiveKeywords = [
    'abono',
    'devolucion',
    'deposito',
    'recibido',
    'stripe',
    'interes',
    'rendimiento',
  ];
  const negativeKeywords = [
    'cargo',
    'pago',
    'consumo',
    'disp',
    'retiro',
    'comision',
    'administracion',
    'enviado a',
  ];

  if (positiveKeywords.some((keyword) => normalized.includes(keyword))) return 'income';
  if (negativeKeywords.some((keyword) => normalized.includes(keyword))) return 'expense';
  return null;
}

function inferType(description, amount, previousBalance, nextBalance) {
  if (Number.isFinite(previousBalance) && Number.isFinite(nextBalance)) {
    const delta = Number((nextBalance - previousBalance).toFixed(2));
    if (approximatelyEqual(delta, amount)) return 'income';
    if (approximatelyEqual(delta, -amount)) return 'expense';
  }

  const byDescription = inferTypeFromDescription(description);
  if (byDescription) return byDescription;

  if (Number.isFinite(previousBalance) && Number.isFinite(nextBalance)) {
    return nextBalance >= previousBalance ? 'income' : 'expense';
  }

  return 'expense';
}

function finalizeTransactionBlock(block, previousBalance, bankName) {
  if (!block || !(block.amount > 0) || !(block.transaction_date instanceof Date)) {
    return { transaction: null, nextBalance: previousBalance };
  }

  const rawDescription = trimLength(
    removeTrailingAmountPair(block.description_lines.join(' ').replace(/\s+/g, ' ').trim()),
    500
  );

  if (!rawDescription) {
    return { transaction: null, nextBalance: previousBalance };
  }

  const nextBalance = Number.isFinite(block.balance)
    ? Number(Number(block.balance).toFixed(2))
    : previousBalance;

  const amount = Number(Number(block.amount).toFixed(2));
  const type = inferType(rawDescription, amount, previousBalance, nextBalance);

  return {
    transaction: {
      transaction_date: block.transaction_date,
      type,
      amount,
      concept: trimLength(deriveConcept(rawDescription), 120),
      raw_description: rawDescription,
      folio: trimLength(block.folio, 120),
      bank: trimLength(bankName, 80),
    },
    nextBalance,
  };
}

/**
 * @param {string} rawText
 * @param {{ bank: string, headerTokens?: string[] }} options
 */
function parseGenericStatement(rawText, options = {}) {
  const bankName = options.bank || 'generic';
  const headerTokens =
    options.headerTokens && options.headerTokens.length
      ? options.headerTokens
      : ['fecha', 'descripcion', 'saldo'];

  const lines = normalizeLines(rawText);
  if (!lines.length) {
    throw badRequest(`${bankName} statement PDF has no readable text`);
  }

  const startIndex = findTransactionsStart(lines, headerTokens);
  if (startIndex < 0) {
    throw badRequest(`Could not find ${bankName} transaction table header`);
  }

  const accountNumber = extractAccountNumber(rawText, lines);
  const period = extractPeriod(rawText);

  const transactions = [];
  let currentBlock = null;
  let previousBalance = null;

  const flush = () => {
    if (!currentBlock) return;
    const finalized = finalizeTransactionBlock(currentBlock, previousBalance, bankName);
    if (finalized.transaction) {
      transactions.push(finalized.transaction);
      previousBalance = finalized.nextBalance;
    }
    currentBlock = null;
  };

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (shouldStopTransactions(line)) {
      flush();
      if (transactions.length) break;
      continue;
    }

    if (isTransactionStartLine(line)) {
      flush();
      currentBlock = parseTransactionStartLine(line);
      if (!currentBlock) continue;

      const inline = extractAmountAndBalance(line);
      if (inline) {
        currentBlock.amount = inline.amount;
        currentBlock.balance = inline.balance;
        flush();
      }
      continue;
    }

    if (!currentBlock) continue;

    const amountAndBalance = extractAmountAndBalance(line);
    if (amountAndBalance) {
      currentBlock.amount = amountAndBalance.amount;
      currentBlock.balance = amountAndBalance.balance;
      flush();
      continue;
    }

    currentBlock.description_lines.push(line);
  }

  flush();

  if (!transactions.length) {
    throw badRequest(`Could not parse ${bankName} transactions from statement`);
  }

  return {
    bank: bankName,
    account_number: accountNumber,
    period_start: period.period_start,
    period_end: period.period_end,
    transactions,
  };
}

module.exports = {
  parseGenericStatement,
  // exported for unit testing
  parseMexicanDate,
  parseMoney,
  inferType,
  deriveConcept,
  extractAmountAndBalance,
};
