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

  // Import the location's historical CRM invoices (paid ones stamp or queue).
  app.post(
    '/integrations/crm/import-history',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      reply.send({ data: await ghlService.importCrmHistory(organizationId) });
    }
  );

  // Dismiss a stale pending invoice (e.g. old test events showing as "—").
  app.post(
    '/integrations/crm/pending/:id/dismiss',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      const dismissed = await ghlService.dismissPending(organizationId, request.params.id);
      if (!dismissed) return reply.status(404).send({ error: 'Evento pendiente no encontrado' });
      reply.send({ data: { dismissed: true } });
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

    // Prefer the signed state (our "Conectar" button flow): it binds the
    // install to the org that clicked. GHL sometimes drops state (draft-app
    // installs) — in that case store the install unbound and let the user
    // claim it from their session (see /integrations/crm/claim).
    let organizationId = null;
    try {
      if (state) organizationId = jwt.verify(state, process.env.JWT_SECRET).org;
    } catch {
      organizationId = null;
    }

    const install = await ghlService.exchangeCode(code, organizationId);

    // Send the browser back to the app so the user sees the result instead of
    // raw JSON. When the org is unknown, the app claims the install in-session.
    const front =
      process.env.GHL_POST_INSTALL_REDIRECT ||
      `${process.env.FRONTEND_URL || 'https://veridis-finance-adrian-yepizs-projects.vercel.app'}/dashboard/cfdi`;
    const url = new URL(front);
    if (organizationId) {
      url.searchParams.set('crm', 'connected');
    } else {
      url.searchParams.set('crm', 'claim');
      if (install?.location_id) url.searchParams.set('location_id', install.location_id);
    }
    return reply.redirect(url.toString());
  });

  // Claim an unbound install (OAuth completed without state) for the caller's
  // org. Only installs with no organization can be claimed — an install bound
  // to another org can never be taken over from here (rebinding requires
  // completing OAuth again, which proves control of the GHL account).
  app.post(
    '/integrations/crm/claim',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      const locationId = String(request.body?.location_id || '').trim();
      if (!locationId) return reply.status(400).send({ error: 'location_id is required' });

      const claimed = await ghlService.claimInstall(organizationId, locationId);
      if (!claimed) {
        return reply.status(409).send({
          error:
            'Esta instalación no está disponible para reclamar. Vuelve a conectar desde el botón "Conectar 642 CRM".',
        });
      }
      reply.send({ data: { connected: true, location_id: claimed.location_id } });
    }
  );

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
