const { z } = require('zod');

const accounting = require('../services/accountingService');
const autoPoliza = require('../services/autoPolizaService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

const WRITE = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];
const READ = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];

const accountSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  account_type: z.enum(['activo', 'pasivo', 'capital', 'ingreso', 'costo', 'gasto', 'orden']),
  nature: z.enum(['deudora', 'acreedora']).optional(),
  sat_grouping_code: z.string().max(30).optional(),
  is_postable: z.boolean().optional(),
});

const lineSchema = z.object({
  account_id: z.string().uuid().optional(),
  account_code: z.string().max(30).optional(),
  debit: z.coerce.number().min(0).optional(),
  credit: z.coerce.number().min(0).optional(),
  description: z.string().max(300).optional(),
  cfdi_uuid: z.string().max(40).optional(),
});

const entrySchema = z.object({
  entry_type: z.enum(['ingreso', 'egreso', 'diario']).optional(),
  entry_date: z.string(),
  concept: z.string().min(1).max(300),
  period_year: z.coerce.number().int().optional(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  lines: z.array(lineSchema).min(2),
});

async function accountingRoutes(app) {
  // ---- Catálogo de cuentas ----
  app.get('/accounting/accounts', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const withBalance = (request.query || {}).with_balance === 'true';
    reply.send({ data: await accounting.listAccounts(organizationId, { withBalance }) });
  });

  app.post('/accounting/accounts', { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const payload = accountSchema.parse(request.body);
    reply.status(201).send({ data: await accounting.createAccount(organizationId, payload) });
  });

  // ---- Pólizas ----
  app.get('/accounting/entries', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const q = z.object({
      year: z.coerce.number().int().optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query || {});
    reply.send({ data: await accounting.listEntries(organizationId, q) });
  });

  app.get('/accounting/entries/:id', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const data = await accounting.getEntry(organizationId, request.params.id);
    if (!data) return reply.status(404).send({ error: 'Póliza no encontrada' });
    reply.send({ data });
  });

  app.post('/accounting/entries', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const payload = entrySchema.parse(request.body);
    const data = await accounting.createEntry(organizationId, { ...payload, created_by: request.user?.user_id });
    reply.status(201).send({ data });
  });

  app.post('/accounting/entries/:id/cancel', { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const ok = await accounting.cancelEntry(organizationId, request.params.id);
    if (!ok) return reply.status(404).send({ error: 'Póliza no encontrada o ya cancelada' });
    reply.send({ ok: true });
  });

  // ---- Pólizas automáticas desde CFDIs del periodo ----
  app.post('/accounting/auto-generate', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = z.object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
    }).parse(request.body || {});
    const data = await autoPoliza.generateForPeriod(organizationId, {
      year, month, createdBy: request.user?.user_id,
    });
    reply.send({ data });
  });

  // ---- Balanza (fundamento; el reporte formal es S10) ----
  app.get('/accounting/trial-balance', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = z.object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
    }).parse(request.query || {});
    reply.send({ data: await accounting.trialBalance(organizationId, { year, month }) });
  });
}

module.exports = accountingRoutes;
