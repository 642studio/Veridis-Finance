const jwt = require('jsonwebtoken');

const receiversService = require('../services/cfdiReceiversService');
const { automationRateLimit } = require('../middleware/rateLimit');

/**
 * Public self-service CSF upload. A tenant shares a signed link; their client
 * opens it (no login) and uploads their Constancia — creating the fiscal
 * receiver profile that lets us stamp CFDIs for them.
 *
 * The token is a JWT { org, purpose: 'csf' } signed with JWT_SECRET.
 */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    if (payload.purpose !== 'csf' || !payload.org) return null;
    return payload.org;
  } catch {
    return null;
  }
}

async function publicCsfRoutes(app) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body) : {});
    } catch {
      done(null, {});
    }
  });

  // These routes are unauthenticated (token-in-URL), so rate-limit by IP to blunt
  // token brute force and PDF-parsing DoS.
  const rl = { preHandler: [automationRateLimit] };

  // Validate the link and return the org's public name.
  app.get('/public/csf/:token', rl, async (request, reply) => {
    const org = verifyToken(request.params.token);
    if (!org) return reply.status(404).send({ error: 'Enlace inválido o expirado' });
    reply.send({ data: { valid: true } });
  });

  // Parse an uploaded CSF and return prefilled data (no save).
  app.post('/public/csf/:token/preview', rl, async (request, reply) => {
    const org = verifyToken(request.params.token);
    if (!org) return reply.status(404).send({ error: 'Enlace inválido o expirado' });
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Sube tu Constancia en PDF' });
    }
    let buffer;
    for await (const part of request.parts()) {
      if (part.type === 'file') buffer = await part.toBuffer();
    }
    if (!buffer) return reply.status(400).send({ error: 'Falta el archivo PDF' });
    reply.send({ data: await receiversService.previewCsf(buffer) });
  });

  // Save the confirmed receiver for the org in the token.
  app.post('/public/csf/:token/save', rl, async (request, reply) => {
    const org = verifyToken(request.params.token);
    if (!org) return reply.status(404).send({ error: 'Enlace inválido o expirado' });
    const b = request.body || {};
    if (!b.rfc || !b.name || !b.fiscal_regime || !b.zip_code) {
      return reply.status(400).send({ error: 'Faltan datos fiscales' });
    }
    const saved = await receiversService.upsert({
      organization_id: org,
      rfc: b.rfc,
      name: b.name,
      fiscal_regime: b.fiscal_regime,
      zip_code: b.zip_code,
      cfdi_use: b.cfdi_use || 'G03',
      email: b.email || null,
      source: 'csf',
      csf_uploaded: true,
    });
    reply.status(201).send({ data: { id: saved.id, rfc: saved.rfc } });
  });
}

module.exports = publicCsfRoutes;
