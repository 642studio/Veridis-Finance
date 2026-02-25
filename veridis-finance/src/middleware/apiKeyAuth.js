const crypto = require('node:crypto');

const { findActiveApiKey, touchApiKeyUsage } = require('../services/apiKeyService');

function unauthorized(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function extractApiKey(request) {
  const fromHeader = request.headers['x-api-key'];

  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }

  const authorizationHeader = request.headers.authorization;
  if (typeof authorizationHeader === 'string' && authorizationHeader.trim()) {
    const [scheme, token] = authorizationHeader.split(' ');
    if (/^ApiKey$/i.test(scheme) && token) {
      return token.trim();
    }
  }

  return null;
}

function keyFingerprint(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 12);
}

async function authenticateAutomationApiKey(request) {
  const providedApiKey = extractApiKey(request);
  if (!providedApiKey) {
    throw unauthorized('Missing automation API key');
  }

  const apiKeyRecord = await findActiveApiKey(providedApiKey);
  if (!apiKeyRecord) {
    throw unauthorized('Invalid automation API key');
  }

  request.apiKey = {
    id: apiKeyRecord.api_key_id,
    organization_id: apiKeyRecord.organization_id,
    role: String(apiKeyRecord.role || '').toLowerCase(),
    plan: apiKeyRecord.plan,
    subscription_status: apiKeyRecord.subscription_status,
  };

  request.automation = {
    source: 'automation',
    key_fingerprint: keyFingerprint(providedApiKey),
    organization_id: apiKeyRecord.organization_id,
  };

  await touchApiKeyUsage(apiKeyRecord.api_key_id);
}

function authorizeApiKeyRoles(allowedRoles) {
  return async function authorizeRoleForApiKey(request) {
    const apiRole = request.apiKey?.role;
    if (!apiRole) {
      throw unauthorized('API key is not authenticated');
    }

    if (!allowedRoles.includes(apiRole)) {
      throw forbidden('API key role is not allowed for this operation');
    }
  };
}

module.exports = {
  authenticateAutomationApiKey,
  authorizeApiKeyRoles,
  extractApiKey,
};
