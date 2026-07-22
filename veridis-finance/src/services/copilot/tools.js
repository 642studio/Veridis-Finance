/**
 * Catálogo de herramientas del copiloto (Sprint 25 — solo lectura).
 *
 * Cada herramienta = { name, description, input_schema, read, handler }.
 * El handler recibe (organizationId, input) y devuelve datos reales del tenant,
 * reutilizando los servicios existentes. TODO corre con la organización del
 * usuario: aislamiento y permisos automáticos. `read: true` = segura, auto-corre.
 */

const pool = require('../../db/pool');
const escritorio = require('../escritorioFiscalService');
const reportes = require('../reportesContablesService');
const ivaFlow = require('../ivaFlowService');
const efos = require('../efosService');
const deducibilidad = require('../deducibilidadService');
const reconciliation = require('../reconciliationService');
const autoPoliza = require('../autoPolizaService');
const bankPoliza = require('../bankPolizaService');
const fixedAssets = require('../fixedAssetsService');
const cierre = require('../cierreService');
const reports = require('../reportsService');

const periodProps = {
  year: { type: 'integer', description: 'Año, p.ej. 2026' },
  month: { type: 'integer', description: 'Mes 1-12' },
};

const TOOLS = [
  {
    name: 'buscar_cliente',
    description: 'Busca clientes/contactos por nombre o RFC. Úsalo para resolver a quién se refiere el usuario antes de pedir su reporte.',
    read: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre o RFC parcial' } },
      required: ['query'],
    },
    async handler(org, { query }) {
      const { rows } = await pool.query(
        `SELECT id, name, rfc, email FROM finance.contacts
          WHERE organization_id = $1 AND (name ILIKE '%'||$2||'%' OR rfc ILIKE '%'||$2||'%')
          ORDER BY name LIMIT 10`,
        [org, String(query || '').slice(0, 60)]
      );
      return { clientes: rows };
    },
  },
  {
    name: 'reporte_cliente',
    description: 'Reporte de un cliente en un rango de meses: facturado, cobrado (conciliado), por cobrar, y sus CFDIs. Pasa el nombre o RFC del cliente.',
    read: true,
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre o RFC del cliente' },
        year: periodProps.year,
        month_desde: { type: 'integer', description: 'Mes inicial 1-12 (opcional; default todo el año)' },
        month_hasta: { type: 'integer', description: 'Mes final 1-12 (opcional)' },
      },
      required: ['cliente', 'year'],
    },
    async handler(org, { cliente, year, month_desde = 1, month_hasta = 12 }) {
      const start = `${year}-${String(month_desde).padStart(2, '0')}-01`;
      const endBase = `${year}-${String(month_hasta).padStart(2, '0')}-01`;
      const { rows } = await pool.query(
        `SELECT uuid_sat, receiver, receiver_rfc, total, status, invoice_date, payment_reference
           FROM finance.invoices
          WHERE organization_id = $1 AND direction = 'issued'
            AND (receiver ILIKE '%'||$2||'%' OR receiver_rfc ILIKE '%'||$2||'%')
            AND invoice_date >= $3::date AND invoice_date < ($4::date + interval '1 month')
          ORDER BY invoice_date DESC LIMIT 200`,
        [org, String(cliente || '').slice(0, 60), start, endBase]
      );
      let facturado = 0; let cobrado = 0; let porCobrar = 0;
      for (const r of rows) {
        const t = Number(r.total || 0);
        facturado += t;
        if (r.status === 'paid' || r.payment_reference) cobrado += t; else porCobrar += t;
      }
      const round2 = (v) => Math.round(v * 100) / 100;
      return {
        cliente, periodo: { year, month_desde, month_hasta },
        facturado: round2(facturado), cobrado: round2(cobrado), por_cobrar: round2(porCobrar),
        cfdis: rows.length,
        facturas: rows.slice(0, 25).map((r) => ({
          uuid: r.uuid_sat, receptor: r.receiver, total: Number(r.total),
          estatus: r.payment_reference || r.status === 'paid' ? 'cobrada' : 'pendiente',
          fecha: r.invoice_date,
        })),
      };
    },
  },
  {
    name: 'listar_facturas',
    description: 'Lista facturas (CFDI) por dirección (emitidas/recibidas), estatus y periodo.',
    read: true,
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['issued', 'received'], description: 'emitidas o recibidas' },
        year: periodProps.year, month: periodProps.month,
        estatus: { type: 'string', enum: ['pending', 'paid'], description: 'opcional' },
      },
      required: ['year', 'month'],
    },
    async handler(org, { direction, year, month, estatus }) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const params = [org, start];
      let where = `organization_id = $1 AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')`;
      if (direction) { params.push(direction); where += ` AND direction = $${params.length}`; }
      if (estatus) { params.push(estatus); where += ` AND status = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT uuid_sat, emitter, receiver, total, status, invoice_date, direction
           FROM finance.invoices WHERE ${where} ORDER BY invoice_date DESC LIMIT 50`, params);
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return { total_monto: Math.round(total * 100) / 100, cuenta: rows.length, facturas: rows };
    },
  },
  {
    name: 'listar_movimientos',
    description: 'Lista movimientos bancarios del periodo, con su estado de conciliación (conciliado/sin conciliar/payout Stripe).',
    read: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    async handler(org, { year, month }) {
      const r = await reconciliation.reviewList({ organization_id: org, year, month });
      return { resumen: r.resumen, movimientos: r.items.slice(0, 40) };
    },
  },
  {
    name: 'escritorio_fiscal',
    description: 'Cockpit del mes: IVA a cargo/favor, ISR estimado, si la balanza cuadra, CFDIs sin póliza, EFOS y próximas obligaciones con fechas límite.',
    read: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    async handler(org, { year, month }) {
      return escritorio.compute(org, { year, month });
    },
  },
  {
    name: 'reporte_contable',
    description: 'Reportes contables del periodo: balanza, estado de resultados o balance general.',
    read: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['balanza', 'estado_resultados', 'balance_general'] },
        ...periodProps,
      },
      required: ['tipo', 'year', 'month'],
    },
    async handler(org, { tipo, year, month }) {
      if (tipo === 'estado_resultados') return reportes.estadoResultados(org, { year, month });
      if (tipo === 'balance_general') return reportes.balanceGeneral(org, { year, month });
      return reportes.balanzaComprobacion(org, { year, month });
    },
  },
  {
    name: 'iva_periodo',
    description: 'IVA del periodo base flujo: trasladado (cobrado), acreditable (pagado) e IVA a cargo o a favor.',
    read: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    async handler(org, { year, month }) {
      const d = await ivaFlow.compute({ organization_id: org, year, month });
      return { iva_a_cargo: d.iva_a_cargo, trasladado: d.trasladado.iva_total, acreditable: d.acreditable.iva_total, isr: d.isr };
    },
  },
  {
    name: 'gastos_sin_cfdi',
    description: 'Gastos pagados sin factura conciliada (riesgo de deducibilidad) del periodo.',
    read: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    async handler(org, { year, month }) {
      const d = await deducibilidad.gastosSinCfdi(org, { year, month });
      return { resumen: d.resumen, faltantes: d.faltantes.slice(0, 30) };
    },
  },
  {
    name: 'cuentas_por_cobrar',
    description: 'Cartera por cobrar: CFDIs emitidos pendientes de cobro por antigüedad (0-30/31-60/61-90/90+ días) y por pagar a proveedores. Úsala cuando pregunten por utilidad, cobranza, cartera o "cuánto me deben".',
    read: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    async handler(org) {
      const r = await reports.getAgingReport({ organization_id: org });
      return r;
    },
  },
  {
    name: 'revisar_efos',
    description: 'Coincidencias de proveedores/clientes contra la lista negra EFOS 69-B del SAT.',
    read: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    async handler(org) {
      const hits = await efos.hits(org);
      return { coincidencias: hits.length, detalle: hits.slice(0, 20) };
    },
  },
];

/**
 * Herramientas TRANSACCIONALES (write: true). El loop del copiloto NUNCA las
 * ejecuta directo: devuelve una acción pendiente que el usuario confirma en la
 * interfaz; solo entonces el backend corre el handler (con rol de escritura) y
 * lo registra en la bitácora. Todas reutilizan servicios idempotentes.
 *
 * Cada una define:
 *  - resumen(input): texto de la tarjeta de confirmación.
 *  - formatResult(result): resumen humano del resultado (determinista, sin IA).
 */
const WRITE_TOOLS = [
  {
    name: 'generar_polizas_cfdi',
    description: 'ACCIÓN (requiere confirmación del usuario): genera las pólizas contables del periodo desde los CFDIs (idempotente, no duplica).',
    write: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    resumen: ({ year, month }) => `Generar pólizas contables desde los CFDIs de ${month}/${year}`,
    handler: (org, { year, month }, userId) => autoPoliza.generateForPeriod(org, { year, month, createdBy: userId }),
    formatResult: (r) => `✅ Pólizas desde CFDIs: ${r.posted} nueva(s), ${r.skipped} ya existían, de ${r.invoices} CFDI(s).${r.errors?.length ? ` ⚠️ ${r.errors.length} con error.` : ''}`,
  },
  {
    name: 'generar_polizas_flujo',
    description: 'ACCIÓN (requiere confirmación): genera las pólizas de cobro/pago (flujo) de los movimientos bancarios ya conciliados del periodo.',
    write: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    resumen: ({ year, month }) => `Generar pólizas de flujo (cobro/pago) de ${month}/${year}`,
    handler: (org, { year, month }, userId) => bankPoliza.generateForPeriod(org, { year, month, createdBy: userId }),
    formatResult: (r) => `✅ Pólizas de flujo: ${r.posted} nueva(s), ${r.skipped} ya existían, de ${r.conciliados} movimiento(s) conciliado(s).`,
  },
  {
    name: 'conciliar_automaticamente',
    description: 'ACCIÓN (requiere confirmación): corre la conciliación automática banco↔CFDI (solo casa matches inequívocos de alta confianza).',
    write: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    resumen: () => 'Correr la conciliación automática banco ↔ CFDI',
    handler: (org) => reconciliation.autoReconcile({ organization_id: org, max_transactions: 200 }),
    formatResult: (r) => `✅ Conciliación automática: ${r.matched} conciliado(s) de ${r.scanned} revisados; ${r.ambiguous} ambiguos quedan para revisión manual.`,
  },
  {
    name: 'depreciar_activos',
    description: 'ACCIÓN (requiere confirmación): registra la depreciación mensual de los activos fijos del periodo (línea recta, idempotente).',
    write: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    resumen: ({ year, month }) => `Registrar la depreciación de activos fijos de ${month}/${year}`,
    handler: (org, { year, month }, userId) => fixedAssets.runDepreciation(org, { year, month, createdBy: userId }),
    formatResult: (r) => `✅ Depreciación: ${r.posted} póliza(s) nueva(s) de ${r.assets} activo(s); ${r.skipped} sin depreciación o ya registradas.`,
  },
  {
    name: 'cerrar_periodo',
    description: 'ACCIÓN (requiere confirmación): cierra el periodo contable (bloquea nuevas pólizas). Exige que la balanza cuadre. Reversible con reapertura.',
    write: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    resumen: ({ year, month }) => `Cerrar el periodo contable ${month}/${year} (bloquea nuevas pólizas)`,
    handler: (org, { year, month }) => cierre.closePeriod(org, { year, month }),
    formatResult: (r) => `✅ Periodo ${r.month}/${r.year} cerrado. Puedes reabrirlo desde Contabilidad › Cierre si necesitas corregir algo.`,
  },
];

const TOOL_BY_NAME = new Map([...TOOLS, ...WRITE_TOOLS].map((t) => [t.name, t]));

/** Formato de herramientas para la API de Anthropic (lectura + acciones). */
function toolSpecs() {
  return [...TOOLS, ...WRITE_TOOLS].map((t) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
  }));
}

/** ¿Es una herramienta transaccional (requiere confirmación)? */
function isWriteTool(name) {
  return Boolean(TOOL_BY_NAME.get(name)?.write);
}

function getTool(name) {
  return TOOL_BY_NAME.get(name) || null;
}

/** Ejecuta una herramienta de LECTURA. Las de escritura jamás pasan por aquí. */
async function runTool(name, organizationId, input) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { error: `Herramienta desconocida: ${name}` };
  if (tool.write) return { error: 'Esta acción requiere confirmación del usuario en la interfaz.' };
  try {
    return await tool.handler(organizationId, input || {});
  } catch (err) {
    return { error: String(err.message || err).slice(0, 300) };
  }
}

module.exports = { TOOLS, WRITE_TOOLS, toolSpecs, runTool, isWriteTool, getTool };
