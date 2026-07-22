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
const recat = require('../categoryReclassifyService');
const reports = require('../reportsService');
const categoryReport = require('../categoryReportService');
const payments = require('../paymentsService');
const invoicesService = require('../invoicesService');
const cfdiConvert = require('../cfdiConvertService');
const transactionsService = require('../transactionsService');

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
      const q = String(query || '').slice(0, 60);
      // Busca en el directorio de clientes, en contactos y en los receptores de
      // facturas emitidas (que traen RFC). Une por nombre/RFC.
      const { rows } = await pool.query(
        `SELECT DISTINCT nombre, rfc FROM (
           SELECT COALESCE(business_name, name) AS nombre, NULL::text AS rfc
             FROM finance.clients WHERE organization_id = $1 AND COALESCE(business_name, name) ILIKE '%'||$2||'%'
           UNION
           SELECT name, rfc FROM finance.contacts
             WHERE organization_id = $1 AND (name ILIKE '%'||$2||'%' OR rfc ILIKE '%'||$2||'%')
           UNION
           SELECT DISTINCT receiver, receiver_rfc FROM finance.invoices
             WHERE organization_id = $1 AND direction = 'issued'
               AND (receiver ILIKE '%'||$2||'%' OR receiver_rfc ILIKE '%'||$2||'%')
         ) x
         WHERE nombre IS NOT NULL ORDER BY nombre LIMIT 12`,
        [org, q]
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
        `SELECT id, uuid_sat, receiver, receiver_rfc, total, status, invoice_date, payment_reference
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
          id: r.id, uuid: r.uuid_sat, receptor: r.receiver, total: Number(r.total),
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
        `SELECT id, uuid_sat, emitter, receiver, total, status, invoice_date, direction, source
           FROM finance.invoices WHERE ${where} ORDER BY invoice_date DESC LIMIT 50`, params);
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return { total_monto: Math.round(total * 100) / 100, cuenta: rows.length, facturas: rows };
    },
  },
  {
    name: 'listar_movimientos',
    description: 'Lista movimientos bancarios del periodo, con su estado de conciliación (conciliado/sin conciliar/payout Stripe). Para SUMAR por categoría usa mejor "resumen_movimientos"; para buscar/filtrar usa "buscar_movimientos".',
    read: true,
    input_schema: { type: 'object', properties: periodProps, required: ['year', 'month'] },
    async handler(org, { year, month }) {
      const r = await reconciliation.reviewList({ organization_id: org, year, month });
      return { resumen: r.resumen, movimientos: r.items.slice(0, 40) };
    },
  },
  {
    name: 'resumen_movimientos',
    description: 'SUMAS EXACTAS de movimientos por categoría y tipo en un rango de meses (server-side, sobre TODOS los movimientos, no una muestra). Úsala SIEMPRE que pregunten "cuánto gasté/entró/vendí en X", totales por categoría, ingresos vs gastos, flujo neto. Excluye traspasos internos de los totales.',
    read: true,
    input_schema: {
      type: 'object',
      properties: {
        year: periodProps.year,
        month_desde: { type: 'integer', description: 'Mes inicial 1-12 (default 1)' },
        month_hasta: { type: 'integer', description: 'Mes final 1-12 (default = month_desde o 12)' },
        categoria: { type: 'string', description: 'Opcional: filtra por una categoría exacta (p.ej. "Software y suscripciones")' },
      },
      required: ['year'],
    },
    async handler(org, { year, month_desde, month_hasta, categoria }) {
      const md = month_desde || 1;
      const mh = month_hasta || month_desde || 12;
      const start = `${year}-${String(md).padStart(2, '0')}-01`;
      const endBase = `${year}-${String(mh).padStart(2, '0')}-01`;
      const params = [org, start, endBase];
      let extra = '';
      if (categoria) { params.push(categoria); extra = ` AND category = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT type, COALESCE(category,'(sin categoría)') AS categoria,
                COUNT(*)::int AS n, SUM(amount)::numeric(14,2) AS total
           FROM finance.transactions
          WHERE organization_id = $1 AND deleted_at IS NULL
            AND transaction_date >= $2::date AND transaction_date < ($3::date + interval '1 month')
            ${extra}
          GROUP BY 1,2 ORDER BY 1, 4 DESC`,
        params
      );
      const NEUTRAL = 'Traspaso interno';
      let ingresos = 0; let gastos = 0; let traspasos = 0;
      const porCategoria = { ingreso: [], gasto: [] };
      for (const r of rows) {
        const total = Number(r.total);
        if (r.categoria === NEUTRAL) { traspasos += total; continue; }
        if (r.type === 'income') { ingresos += total; porCategoria.ingreso.push({ categoria: r.categoria, total, n: r.n }); }
        else { gastos += total; porCategoria.gasto.push({ categoria: r.categoria, total, n: r.n }); }
      }
      const r2 = (v) => Math.round(v * 100) / 100;
      return {
        periodo: { year, month_desde: md, month_hasta: mh },
        ingresos_total: r2(ingresos), gastos_total: r2(gastos),
        flujo_neto: r2(ingresos - gastos), traspasos_total: r2(traspasos),
        por_categoria: porCategoria,
        nota: 'Flujo de banco (dinero real). NO es utilidad; los traspasos no cuentan.',
      };
    },
  },
  {
    name: 'buscar_movimientos',
    description: 'Busca/filtra movimientos individuales por tipo, categoría, texto y/o monto, ordenados por monto o fecha. Úsala para "el gasto más grande", "pagos a X", "movimientos de software", "movimientos arriba de $10,000".',
    read: true,
    input_schema: {
      type: 'object',
      properties: {
        year: periodProps.year, month: periodProps.month,
        tipo: { type: 'string', enum: ['income', 'expense'], description: 'ingreso o gasto (opcional)' },
        categoria: { type: 'string', description: 'Categoría exacta (opcional)' },
        texto: { type: 'string', description: 'Busca en el concepto/descripción (opcional)' },
        monto_min: { type: 'number', description: 'Monto mínimo (opcional)' },
        orden: { type: 'string', enum: ['monto', 'fecha'], description: 'Ordenar por monto (mayor primero) o fecha. Default monto.' },
        limite: { type: 'integer', description: 'Máximo de resultados (default 15, máx 50)' },
      },
      required: ['year', 'month'],
    },
    async handler(org, { year, month, tipo, categoria, texto, monto_min, orden = 'monto', limite = 15 }) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const params = [org, start];
      let where = `organization_id = $1 AND deleted_at IS NULL AND transaction_date >= $2::date AND transaction_date < ($2::date + interval '1 month')`;
      if (tipo) { params.push(tipo); where += ` AND type = $${params.length}`; }
      if (categoria) { params.push(categoria); where += ` AND category = $${params.length}`; }
      if (texto) { params.push(`%${texto}%`); where += ` AND (description ILIKE $${params.length} OR original_description ILIKE $${params.length})`; }
      if (monto_min != null) { params.push(monto_min); where += ` AND amount >= $${params.length}`; }
      const order = orden === 'fecha' ? 't.transaction_date DESC' : 'amount DESC';
      const lim = Math.min(Number(limite) || 15, 50);
      const { rows } = await pool.query(
        `SELECT transaction_date::date AS fecha, type AS tipo, amount::numeric(12,2) AS monto,
                category AS categoria, LEFT(COALESCE(description,''),80) AS concepto
           FROM finance.transactions t WHERE ${where} ORDER BY ${order} LIMIT ${lim}`,
        params
      );
      return { cuenta: rows.length, movimientos: rows };
    },
  },
  {
    name: 'cartera_por_cliente',
    description: 'Cartera por cliente: por cobrar con CFDI (deuda real) vs ventas sin factura (informativo), quién debe y desde cuándo. Úsala para "quién me debe", "cartera por cliente", cobranza.',
    read: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    async handler(org) {
      return categoryReport.receivablesByClient({ organizationId: org });
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
    description: 'ACCIÓN (requiere confirmación): corre la conciliación automática banco↔CFDI en dos pases: por puntaje 1:1 y por cliente (RFC), que desempata facturas idénticas por fecha y resuelve pagos en bolsa.',
    write: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    resumen: () => 'Correr la conciliación automática banco ↔ CFDI (puntaje + por cliente)',
    handler: async (org) => {
      const auto = await reconciliation.autoReconcile({ organization_id: org, max_transactions: 300 });
      const byClient = await reconciliation.reconcileByClient({ organization_id: org, max_transactions: 300 });
      return { auto, byClient };
    },
    formatResult: (r) => `✅ Conciliación: ${r.auto.matched} por puntaje + ${r.byClient.matched_1a1} exactas + ${r.byClient.matched_bolsa} pagos en bolsa (${r.byClient.invoices_conciliadas} facturas). ${r.auto.ambiguous} ambiguas quedan para revisión manual.`,
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
    name: 'recategorizar_gastos',
    description: 'ACCIÓN (requiere confirmación): re-categoriza los gastos en "Por revisar" con reglas + IA a la taxonomía canónica (nómina, proveedores, retiros de socio, etc.). No cambia montos.',
    write: true,
    input_schema: { type: 'object', properties: { limit: { type: 'integer', description: 'Máximo de movimientos a revisar (default 60).' } }, required: [] },
    resumen: () => 'Re-categorizar los gastos en "Por revisar" con reglas + IA',
    handler: (org, { limit }) => recat.reclassifyReviewExpenses({ organizationId: org, limit: limit || 60, apply: true, useAI: true }),
    formatResult: (r) => `✅ Re-categorización: ${r.applied} gasto(s) clasificados (${r.byRule} por regla, ${r.byAI} por IA) de ${r.scanned} revisados; ${r.remaining} siguen en "Por revisar".`,
  },
  {
    name: 'conciliar_por_cliente',
    description: 'ACCIÓN (requiere confirmación): concilia por cliente (RFC) — empareja facturas idénticas por fecha y resuelve pagos en bolsa (un depósito que cubre varias facturas).',
    write: true,
    input_schema: { type: 'object', properties: {}, required: [] },
    resumen: () => 'Conciliar por cliente (RFC): facturas idénticas por fecha + pagos en bolsa',
    handler: (org) => reconciliation.reconcileByClient({ organization_id: org, max_transactions: 300 }),
    formatResult: (r) => `✅ Conciliación por cliente: ${r.matched_1a1} exactas + ${r.matched_bolsa} pagos en bolsa (${r.invoices_conciliadas} facturas).`,
  },
  {
    name: 'registrar_pago',
    description: 'ACCIÓN (requiere confirmación): registra un cobro/pago manual. Crea el movimiento en el flujo del banco y, si se liga a una factura pendiente, la concilia. Pide invoice_id (de listar_facturas/cartera) o cliente + monto.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'UUID de la factura/recibo a cobrar (opcional)' },
        amount: { type: 'number', description: 'Monto del pago' },
        method: { type: 'string', enum: ['transferencia', 'deposito', 'efectivo', 'tarjeta', 'stripe', 'otro'], description: 'Método (default transferencia)' },
        date: { type: 'string', description: 'Fecha AAAA-MM-DD (default hoy)' },
        reference: { type: 'string', description: 'Clave de rastreo / referencia (opcional)' },
      },
      required: ['amount'],
    },
    resumen: ({ amount, method }) => `Registrar cobro de $${Number(amount).toLocaleString('es-MX')} (${method || 'transferencia'})`,
    handler: (org, input, userId) => payments.registerPayment({
      organizationId: org, userId,
      amount: input.amount, date: input.date, invoiceId: input.invoice_id || null,
      method: input.method || 'transferencia', reference: input.reference || null,
    }),
    formatResult: (r) => `✅ Cobro registrado: movimiento creado${r.reconciled ? ' y factura conciliada' : ''}.`,
  },
  {
    name: 'cancelar_recibo',
    description: 'ACCIÓN (requiere confirmación): cancela un RECIBO del CRM (los que no llevan CFDI). No cancela CFDIs timbrados. Pide invoice_id.',
    write: true,
    input_schema: { type: 'object', properties: { invoice_id: { type: 'string', description: 'UUID del recibo' } }, required: ['invoice_id'] },
    resumen: () => 'Cancelar el recibo del CRM',
    handler: (org, { invoice_id }) => invoicesService.cancelInvoice({ organization_id: org, invoice_id }),
    formatResult: (r) => `✅ Recibo cancelado (${r.receiver}).`,
  },
  {
    name: 'convertir_a_cfdi',
    description: 'ACCIÓN (requiere confirmación): convierte un recibo del CRM en CFDI timbrado. Requiere que el cliente tenga su Constancia (CSF). Pide invoice_id.',
    write: true,
    input_schema: { type: 'object', properties: { invoice_id: { type: 'string', description: 'UUID del recibo' } }, required: ['invoice_id'] },
    resumen: () => 'Convertir el recibo en CFDI timbrado',
    handler: (org, { invoice_id }, userId) => cfdiConvert.convert({ organizationId: org, invoiceId: invoice_id, userId }),
    formatResult: (r) => `✅ Recibo convertido a CFDI a nombre de ${r.receiver}.`,
  },
  {
    name: 'recategorizar_movimiento',
    description: 'ACCIÓN (requiere confirmación): cambia la categoría de UN movimiento específico (ajuste puntual). El sistema aprende la regla. Pide transaction_id y la categoría nueva.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: 'UUID del movimiento' },
        categoria: { type: 'string', description: 'Categoría canónica nueva' },
      },
      required: ['transaction_id', 'categoria'],
    },
    resumen: ({ categoria }) => `Cambiar la categoría del movimiento a "${categoria}"`,
    handler: (org, { transaction_id, categoria }, userId) => transactionsService.updateTransaction({
      organization_id: org, transaction_id, patch: { category: categoria },
      actor_user_id: userId || null,
    }),
    formatResult: (r) => `✅ Movimiento recategorizado a "${r.category}".`,
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
