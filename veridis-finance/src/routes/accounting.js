const { z } = require('zod');

const accounting = require('../services/accountingService');
const autoPoliza = require('../services/autoPolizaService');
const reportes = require('../services/reportesContablesService');
const contabE = require('../services/contabilidadElectronicaService');
const fixedAssets = require('../services/fixedAssetsService');
const auditoria = require('../services/auditoriaService');
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

  // ---- Reportes contables (S10) ----
  const periodQuery = z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  });

  app.get('/accounting/reports/balanza', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await reportes.balanzaComprobacion(organizationId, { year, month }) });
  });

  app.get('/accounting/reports/mayor', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month, account } = periodQuery.extend({ account: z.string().max(30).optional() })
      .parse(request.query || {});
    reply.send({ data: await reportes.libroMayor(organizationId, { year, month, accountCode: account || null }) });
  });

  app.get('/accounting/reports/diario', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await reportes.libroDiario(organizationId, { year, month }) });
  });

  app.get('/accounting/reports/estado-resultados', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await reportes.estadoResultados(organizationId, { year, month }) });
  });

  app.get('/accounting/reports/balance-general', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await reportes.balanceGeneral(organizationId, { year, month }) });
  });

  // Export CSV (para el contador). ?report=balanza|mayor|diario|estado-resultados|balance-general
  app.get('/accounting/reports/export', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month, report } = periodQuery.extend({
      report: z.enum(['balanza', 'mayor', 'diario', 'estado-resultados', 'balance-general']),
    }).parse(request.query || {});
    const { csv, filename } = await buildCsv(organizationId, report, { year, month });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(csv);
  });

  // ---- Contabilidad electrónica SAT (S11) ----
  app.get('/accounting/e-contabilidad/validate', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await contabE.validate(organizationId, { year, month }) });
  });

  app.get('/accounting/e-contabilidad/catalogo.xml', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    const { xml, filename } = await contabE.buildCatalogoXml(organizationId, { year, month });
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(xml);
  });

  app.get('/accounting/e-contabilidad/balanza.xml', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month, tipo } = periodQuery.extend({ tipo: z.enum(['N', 'C']).optional() })
      .parse(request.query || {});
    const { xml, filename } = await contabE.buildBalanzaXml(organizationId, { year, month, tipoEnvio: tipo || 'N' });
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(xml);
  });

  // ---- Activos fijos + depreciación (S12) ----
  app.get('/accounting/assets', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    reply.send({ data: await fixedAssets.listAssets(organizationId) });
  });

  app.post('/accounting/assets', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const payload = z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(500).optional(),
      category: z.string().max(60).optional(),
      acquisition_date: z.string(),
      cost: z.coerce.number().min(0),
      salvage_value: z.coerce.number().min(0).optional(),
      annual_rate: z.coerce.number().min(0).max(1).optional(),
      asset_account_code: z.string().max(30).optional(),
      accum_account_code: z.string().max(30).optional(),
      expense_account_code: z.string().max(30).optional(),
      cfdi_uuid: z.string().max(40).optional(),
    }).parse(request.body || {});
    reply.status(201).send({ data: await fixedAssets.createAsset(organizationId, payload) });
  });

  app.post('/accounting/assets/depreciate', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.body || {});
    reply.send({ data: await fixedAssets.runDepreciation(organizationId, { year, month, createdBy: request.user?.user_id }) });
  });

  // ---- Auditoría preventiva (S12) ----
  app.get('/accounting/auditoria', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { year, month } = periodQuery.parse(request.query || {});
    reply.send({ data: await auditoria.run(organizationId, { year, month }) });
  });
}

// --- Helpers de export CSV ---
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (arr) => arr.map(csvCell).join(',');

async function buildCsv(organizationId, report, { year, month }) {
  const per = `${year}-${String(month).padStart(2, '0')}`;
  if (report === 'balanza') {
    const d = await reportes.balanzaComprobacion(organizationId, { year, month });
    const lines = [csvRow(['Cuenta', 'Nombre', 'Saldo inicial', 'Cargos', 'Abonos', 'Saldo final'])];
    for (const c of d.cuentas) lines.push(csvRow([c.code, c.name, c.saldo_inicial, c.cargos, c.abonos, c.saldo_final]));
    lines.push(csvRow(['', 'TOTALES', '', d.total_cargos, d.total_abonos, '']));
    return { csv: lines.join('\n'), filename: `balanza-${per}.csv` };
  }
  if (report === 'mayor') {
    const d = await reportes.libroMayor(organizationId, { year, month });
    const lines = [csvRow(['Cuenta', 'Nombre', 'Folio', 'Fecha', 'Concepto', 'Cargo', 'Abono', 'Saldo'])];
    for (const c of d.cuentas) {
      lines.push(csvRow([c.code, c.name, '', '', 'Saldo inicial', '', '', c.saldo_inicial]));
      for (const m of c.movimientos) {
        lines.push(csvRow([c.code, c.name, m.folio, fmtDate(m.fecha), m.concepto, m.cargo, m.abono, m.saldo]));
      }
    }
    return { csv: lines.join('\n'), filename: `libro-mayor-${per}.csv` };
  }
  if (report === 'diario') {
    const d = await reportes.libroDiario(organizationId, { year, month });
    const lines = [csvRow(['Folio', 'Fecha', 'Tipo', 'Concepto', 'Cuenta', 'Nombre cuenta', 'Cargo', 'Abono'])];
    for (const p of d.polizas) {
      for (const l of p.partidas) {
        lines.push(csvRow([p.folio, fmtDate(p.fecha), p.tipo, p.concepto, l.account_code, l.account_name, l.cargo, l.abono]));
      }
    }
    return { csv: lines.join('\n'), filename: `libro-diario-${per}.csv` };
  }
  if (report === 'estado-resultados') {
    const d = await reportes.estadoResultados(organizationId, { year, month });
    const lines = [csvRow(['Concepto', 'Del mes', 'Del ejercicio'])];
    lines.push(csvRow(['Ingresos', d.ingresos.mes, d.ingresos.ejercicio]));
    lines.push(csvRow(['Costos', d.costos.mes, d.costos.ejercicio]));
    lines.push(csvRow(['Gastos', d.gastos.mes, d.gastos.ejercicio]));
    lines.push(csvRow(['Utilidad', d.utilidad.mes, d.utilidad.ejercicio]));
    return { csv: lines.join('\n'), filename: `estado-resultados-${per}.csv` };
  }
  // balance-general
  const d = await reportes.balanceGeneral(organizationId, { year, month });
  const lines = [csvRow(['Grupo', 'Cuenta', 'Nombre', 'Saldo'])];
  for (const a of d.activo) lines.push(csvRow(['Activo', a.code, a.name, a.saldo]));
  lines.push(csvRow(['Activo', '', 'TOTAL ACTIVO', d.total_activo]));
  for (const p of d.pasivo) lines.push(csvRow(['Pasivo', p.code, p.name, p.saldo]));
  lines.push(csvRow(['Pasivo', '', 'TOTAL PASIVO', d.total_pasivo]));
  for (const c of d.capital) lines.push(csvRow(['Capital', c.code, c.name, c.saldo]));
  lines.push(csvRow(['Capital', '', 'Resultado del ejercicio', d.resultado_ejercicio]));
  lines.push(csvRow(['Capital', '', 'TOTAL PASIVO + CAPITAL', d.total_pasivo_capital]));
  return { csv: lines.join('\n'), filename: `balance-general-${per}.csv` };
}

function fmtDate(v) {
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v || ''); }
}

module.exports = accountingRoutes;
