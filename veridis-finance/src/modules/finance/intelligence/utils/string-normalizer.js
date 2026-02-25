const COMMON_WORDS = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y']);

function normalizeString(input) {
  const sanitized = String(input || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return [];
  }

  return sanitized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !COMMON_WORDS.has(token));
}

module.exports = {
  normalizeString,
  COMMON_WORDS,
};
