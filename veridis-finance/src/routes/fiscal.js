const { z } = require('zod');

const efosService = require('../services/efosService');
const notificationsService = require('../services/notificationsService');
const evidenceService = require('../services/evidenceService');
const ivaFlowService = require('../services/ivaFlowService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

const WRITE = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];
const READ = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];

/**
 * Fiscal alerting routes: EFOS 69-B monitoring, the in-app notification
 * center, and CFDI evidence (materialidad, CFF 49 Bis). Self-contained so it
 * composes cleanly with the CFDI/SAT routes.
 */
async function fiscalRoutes(app) {
  // ---- EFOS (69-B) ----
  app.get('/fiscal/efos/status', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    resolveOrganizationId(request);
    reply.send({ data: await efosService.status() });
  });

  app.post('/fiscal/efos/refresh', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const refreshed = await efosService.refreshFromSat();
    const { hits } = await efosService.check(organizationId);
    reply.send({ data: { ...refreshed, hits } });
  });

  app.post('/fiscal/efos/upload', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Se espera multipart/form-data con el CSV 69-B' });
    }
    let buffer;
    for await (const part of request.parts()) {
      if (part.type === 'file') buffer = await part.toBuffer();
    }
    if (!buffer) return reply.status(400).send({ error: 'Falta el archivo CSV' });
    const refreshed = await efosService.refreshFromUpload(buffer);
    const { hits } = await efosService.check(organizationId);
    reply.send({ data: { ...refreshed, hits } });
  });

  app.get('/fiscal/efos/hits', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    reply.send({ data: await efosService.hits(organizationId) });
  });

  // ---- Notificaciones ----
  app.get('/notifications', { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { unread } = request.query || {};
    const [items, count] = await Promise.all([
      notificationsService.list(organizationId, { unreadOnly: unread === 'true' }),
      notificationsService.unreadCount(organizationId),
    ]);
    reply.send({ data: { items, unread_count: count } });
  });

  app.post('/notifications/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const organizationId = resolveOrganizationId(request);
    await notificationsService.markRead(organizationId, id);
    reply.send({ ok: true });
  });

  app.post('/notifications/read-all', { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    await notificationsService.markAllRead(organizationId);
    reply.send({ ok: true });
  });

  // ---- Conciliación IVA/ISR base flujo ----
  app.get('/fiscal/iva', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }).parse(request.query || {});
    reply.send({ data: await ivaFlowService.compute({ organization_id: organizationId, year, month }) });
  });

  app.post('/fiscal/iva/override', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const payload = z.object({
      uuid: z.string().min(30).max(40),
      excluded: z.boolean(),
      reason: z.string().max(300).optional(),
    }).parse(request.body || {});
    reply.send({ data: await ivaFlowService.setOverride({ organization_id: organizationId, ...payload }) });
  });

  // ---- Materialidad (49 Bis): evidencia por CFDI ----
  app.get('/fiscal/cfdi/:id/evidence', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    reply.send({ data: await evidenceService.list(organizationId, request.params.id) });
  });

  app.post('/fiscal/cfdi/:id/evidence', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Se espera multipart/form-data' });
    }
    let fileBuffer; let filename = 'evidencia'; let mimeType = 'application/octet-stream'; let note = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        filename = part.filename || filename;
        mimeType = part.mimetype || mimeType;
      } else if (part.fieldname === 'note') {
        note = String(part.value || '').slice(0, 1000) || null;
      }
    }
    if (!fileBuffer) return reply.status(400).send({ error: 'Falta el archivo' });
    const saved = await evidenceService.upload(organizationId, request.params.id, {
      filename, mimeType, content: fileBuffer, note, uploadedBy: request.user?.user_id || null,
    });
    reply.status(201).send({ data: saved });
  });

  app.get('/fiscal/cfdi/:id/evidence/:evidenceId', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const file = await evidenceService.download(organizationId, request.params.id, request.params.evidenceId);
    if (!file) return reply.status(404).send({ error: 'Evidencia no encontrada' });
    reply
      .header('Content-Type', file.mime_type)
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.content);
  });

  app.delete('/fiscal/cfdi/:id/evidence/:evidenceId', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const ok = await evidenceService.remove(organizationId, request.params.id, request.params.evidenceId);
    if (!ok) return reply.status(404).send({ error: 'Evidencia no encontrada' });
    reply.send({ ok: true });
  });
}

module.exports = fiscalRoutes;
