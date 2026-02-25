const { sanitizeSlug } = require('../services/organizationService');

function parseTenantSlugFromHost(hostname) {
  const host = String(hostname || '')
    .split(':')[0]
    .trim()
    .toLowerCase();

  if (!host || host === 'localhost' || host.includes('127.0.0.1')) {
    return null;
  }

  const segments = host.split('.').filter(Boolean);
  if (segments.length < 3) {
    return null;
  }

  // Future-ready convention: <tenant>.finance.veridis.app
  if (segments[1] === 'finance') {
    return sanitizeSlug(segments[0]) || null;
  }

  return null;
}

module.exports = {
  parseTenantSlugFromHost,
};
