const jwt = require('jsonwebtoken');

const ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  OPS: 'ops',
  VIEWER: 'viewer',
});

const VALID_ROLES = new Set(Object.values(ROLES));

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

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizePayload(payload) {
  const role = String(payload.role || '').toLowerCase();
  const organizationId = payload.organization_id;
  const userId = payload.user_id || payload.sub;

  if (!VALID_ROLES.has(role)) {
    throw forbidden('Token role is not authorized');
  }

  if (!organizationId) {
    throw unauthorized('Token must include organization_id');
  }

  if (!userId) {
    throw unauthorized('Token must include user_id');
  }

  return {
    ...payload,
    role,
    organization_id: organizationId,
    user_id: userId,
  };
}

async function authenticate(request) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    throw unauthorized('Missing Authorization header');
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Authorization header must be in format: Bearer <token>');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload || typeof payload !== 'object') {
      throw unauthorized('Invalid token payload');
    }

    request.user = normalizePayload(payload);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw unauthorized('Invalid or expired token');
  }
}

function authorize(allowedRoles) {
  return async function authorizeByRole(request) {
    if (!request.user || !VALID_ROLES.has(request.user.role)) {
      throw forbidden('Authenticated user has no valid role');
    }

    if (!allowedRoles.includes(request.user.role)) {
      throw forbidden('Insufficient role for this operation');
    }
  };
}

function resolveOrganizationId(request, organizationIdOverride) {
  const tokenOrganizationId = request.user?.organization_id;

  if (!tokenOrganizationId) {
    throw forbidden('Authenticated token is missing organization scope');
  }

  if (
    organizationIdOverride &&
    organizationIdOverride !== tokenOrganizationId
  ) {
    throw forbidden('Cannot access data outside your organization scope');
  }

  return tokenOrganizationId;
}

module.exports = {
  authenticate,
  authorize,
  resolveOrganizationId,
  ROLES,
  unauthorized,
  forbidden,
  badRequest,
};
