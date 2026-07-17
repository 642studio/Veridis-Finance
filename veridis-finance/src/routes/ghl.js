const jwt = require('jsonwebtoken');

const ghlService = require('../services/ghlService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

/**
 * GHL integration routes. Encapsulated so we can attach a raw-body JSON parser
 * (needed to verify the Ed25519 webhook signature) without affecting the rest
 * of the API.
 */
async function ghlRoutes(app) {
  // Keep the raw body available for webhook signature verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body;
      try {
        done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
      } catch {
        done(null, {});
      }
    }
  );

  // Start the install: returns the GHL authorize URL with a signed state.
  app.get(
    '/integrations/crm/install',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      const state = jwt.sign({ org: organizationId }, process.env.JWT_SECRET, { expiresIn: '15m' });
      reply.send({ url: ghlService.buildInstallUrl(state) });
    }
  );

  // Connection status for the tenant.
  app.get(
    '/integrations/crm/status',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      const install = await ghlService.getInstallForOrg(organizationId);
      reply.send({
        data: {
          connected: Boolean(install),
          location_id: install?.location_id || null,
          scope: install?.scope || null,
          installed_at: install?.installed_at || null,
        },
      });
    }
  );

  // Pull invoices from the connected GHL location.
  app.get(
    '/integrations/crm/invoices',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      reply.send({ data: await ghlService.listInvoices(organizationId) });
    }
  );

  // Pull contacts from the connected GHL location.
  app.get(
    '/integrations/crm/contacts',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      reply.send({ data: await ghlService.listContacts(organizationId) });
    }
  );

  // Invoices paid in the CRM that are waiting on the client's CSF.
  app.get(
    '/integrations/crm/pending',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      reply.send({ data: await ghlService.listPending(organizationId) });
    }
  );

  // Retry stamping a pending invoice (after its CSF was uploaded).
  app.post(
    '/integrations/crm/pending/:id/retry',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    async (request, reply) => {
      resolveOrganizationId(request);
      try {
        const result = await ghlService.retryPending(request.params.id);
        reply.send(result);
      } catch (err) {
        reply
          .status(err.pendingCsf ? 422 : err.statusCode || 500)
          .send({ error: err.message });
      }
    }
  );

  // OAuth callback (GHL redirects the user's browser here).
  app.get('/integrations/crm/oauth/callback', async (request, reply) => {
    const { code, state } = request.query || {};
    if (!code) return reply.status(400).send({ error: 'Missing code' });

    // Prefer the signed state (our "Conectar" button flow). When installing a
    // DRAFT app via GHL's own Install link, there's no state — fall back to the
    // configured org so single-tenant testing works.
    let organizationId = null;
    try {
      if (state) organizationId = jwt.verify(state, process.env.JWT_SECRET).org;
    } catch {
      organizationId = null;
    }
    if (!organizationId) organizationId = process.env.GHL_FALLBACK_ORG_ID || null;

    await ghlService.exchangeCode(code, organizationId);
    const redirect = process.env.GHL_POST_INSTALL_REDIRECT;
    if (redirect) return reply.redirect(redirect);
    reply.send({ status: 'connected' });
  });

  // Webhook receiver: verify signature, dedupe, process InvoicePaid.
  app.post('/integrations/crm/webhook', async (request, reply) => {
    const signature =
      request.headers['x-ghl-signature'] || request.headers['x-wh-signature'];
    const verified = ghlService.verifyWebhookSignature(request.rawBody, signature);
    if (!verified) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const event = request.body || {};
    const { isNew, row } = await ghlService.recordWebhook(event);

    // Respond 2xx fast; only process genuinely new events.
    reply.status(200).send({ received: true, duplicate: !isNew });

    if (isNew && row && event.type === 'InvoicePaid') {
      try {
        await ghlService.markWebhook(row.id, 'processing');
        await ghlService.processInvoicePaid(event);
        await ghlService.markWebhook(row.id, 'processed');
      } catch (err) {
        await ghlService.markWebhook(
          row.id,
          err.pendingCsf ? 'pending_csf' : 'error',
          err.message
        );
      }
    } else if (isNew && row) {
      await ghlService.markWebhook(row.id, 'ignored');
    }
  });
}

module.exports = ghlRoutes;
