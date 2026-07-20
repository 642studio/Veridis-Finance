/**
 * Contabilidad electrónica (Sprint 11) — genera los XML del SAT (Anexo 24):
 *
 *   - Catálogo de cuentas (namespace catalogocuentas 1.3): cada cuenta con su
 *     código agrupador, nivel y naturaleza. Se sintetizan las cuentas de mayor
 *     (nivel 1) a partir del primer segmento del código agrupador para que la
 *     jerarquía quede completa (SubCtaDe).
 *   - Balanza de comprobación mensual (namespace BCE 1.3): saldo inicial, debe,
 *     haber y saldo final por cuenta, derivados del mayor real.
 *
 * También valida los prerequisitos (RFC del emisor, agrupador presente, que la
 * balanza cuadre) y expone el enlace póliza↔CFDI (journal_lines.cfdi_uuid) para
 * el detalle de pólizas que el SAT puede requerir.
 */

const pool = require('../db/pool');
const { round } = require('../lib/money');
const reportes = require('./reportesContablesService');
const { getActiveIssuer } = require('./cfdiIssuersService');

const money2 = (v) => round(v || 0); // string con 2 decimales

// Nombres de las cuentas de mayor (nivel 1) del código agrupador SAT (Anexo 24).
const MAJOR_NAMES = {
  '101': 'Caja', '102': 'Bancos', '103': 'Inversiones', '105': 'Clientes',
  '107': 'Cuentas por cobrar', '108': 'Deudores diversos', '118': 'IVA acreditable',
  '119': 'IVA pendiente de acreditar', '201': 'Proveedores',
  '205': 'Acreedores diversos', '206': 'Cuentas por pagar',
  '209': 'Otras cuentas por pagar', '210': 'Impuestos y derechos por pagar',
  '213': 'IVA trasladado no cobrado', '216': 'IVA trasladado',
  '301': 'Capital social', '305': 'Resultado de ejercicios anteriores',
  '401': 'Ingresos', '402': 'Ventas y/o servicios', '501': 'Costo de venta',
  '601': 'Gastos generales', '602': 'Gastos financieros', '701': 'Otros gastos',
};

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function naturByAccountNature(nature) {
  return nature === 'acreedora' ? 'A' : 'D';
}

/** RFC del emisor o error 400 accionable. */
async function requireRfc(organizationId) {
  const issuer = await getActiveIssuer(organizationId);
  if (!issuer || !issuer.rfc) {
    const err = new Error('Configura el RFC del emisor (Emisor fiscal) antes de generar los XML del SAT.');
    err.statusCode = 400;
    throw err;
  }
  return issuer.rfc;
}

/** Cuentas del catálogo con jerarquía sintetizada (mayor + detalle). */
async function buildAccountTree(organizationId) {
  const { rows } = await pool.query(
    `SELECT code, name, nature, COALESCE(sat_grouping_code, code) AS agrup
       FROM finance.chart_of_accounts
      WHERE organization_id = $1 AND active = true
      ORDER BY code`,
    [organizationId]
  );
  const majors = new Map(); // code -> {code, name, natur}
  const detail = [];
  for (const r of rows) {
    const agrup = r.agrup;
    const major = agrup.split('.')[0];
    if (!majors.has(major)) {
      majors.set(major, {
        numCta: major, codAgrup: major, desc: MAJOR_NAMES[major] || r.name,
        nivel: 1, natur: naturByAccountNature(r.nature), subCtaDe: null,
      });
    }
    detail.push({
      numCta: r.code, codAgrup: agrup, desc: r.name,
      nivel: agrup.includes('.') ? 2 : 1,
      natur: naturByAccountNature(r.nature),
      subCtaDe: agrup.includes('.') ? major : null,
    });
  }
  // Nivel 1 primero, luego detalle por código.
  const all = [...majors.values(), ...detail.filter((d) => d.nivel > 1)];
  // Evita duplicar cuando una cuenta de detalle es también nivel 1 (código sin punto).
  const seen = new Set(all.map((a) => a.numCta));
  for (const d of detail) if (d.nivel === 1 && !seen.has(d.numCta)) { all.push(d); seen.add(d.numCta); }
  return all.sort((a, b) => a.numCta.localeCompare(b.numCta));
}

/** Construye el XML del Catálogo (puro). `cuentas` = salida de buildAccountTree. */
function catalogoXmlFromTree({ rfc, year, month, cuentas }) {
  const ns = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<catalogocuentas:Catalogo xmlns:catalogocuentas="${ns}"`,
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    ` xsi:schemaLocation="${ns} http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas/CatalogoCuentas_1_3.xsd"`,
    ` Version="1.3" RFC="${xmlEscape(rfc)}" Mes="${String(month).padStart(2, '0')}" Anio="${year}">`,
  ];
  for (const c of cuentas) {
    const sub = c.subCtaDe ? ` SubCtaDe="${xmlEscape(c.subCtaDe)}"` : '';
    lines.push(
      `  <catalogocuentas:Ctas CodAgrup="${xmlEscape(c.codAgrup)}" NumCta="${xmlEscape(c.numCta)}"` +
      ` Desc="${xmlEscape(c.desc)}"${sub} Nivel="${c.nivel}" Natur="${c.natur}"/>`
    );
  }
  lines.push('</catalogocuentas:Catalogo>');
  return lines.join('\n');
}

/** Construye el XML de la Balanza (puro). `cuentas` = balanzaComprobacion().cuentas. */
function balanzaXmlFromReport({ rfc, year, month, tipoEnvio = 'N', cuentas }) {
  const ns = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion';
  const tipo = tipoEnvio === 'C' ? 'C' : 'N';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<BCE:Balanza xmlns:BCE="${ns}"`,
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    ` xsi:schemaLocation="${ns} http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion/BalanzaComprobacion_1_3.xsd"`,
    ` Version="1.3" RFC="${xmlEscape(rfc)}" Mes="${String(month).padStart(2, '0')}" Anio="${year}" TipoEnvio="${tipo}">`,
  ];
  for (const c of cuentas) {
    lines.push(
      `  <BCE:Ctas NumCta="${xmlEscape(c.code)}" SaldoIni="${money2(Math.abs(c.saldo_inicial))}"` +
      ` Debe="${money2(c.cargos)}" Haber="${money2(c.abonos)}" SaldoFin="${money2(Math.abs(c.saldo_final))}"/>`
    );
  }
  lines.push('</BCE:Balanza>');
  return lines.join('\n');
}

/** XML del Catálogo de cuentas (catalogocuentas 1.3). */
async function buildCatalogoXml(organizationId, { year, month }) {
  const rfc = await requireRfc(organizationId);
  const cuentas = await buildAccountTree(organizationId);
  return {
    xml: catalogoXmlFromTree({ rfc, year, month, cuentas }),
    filename: `${rfc}${year}${String(month).padStart(2, '0')}CT.xml`,
  };
}

/** XML de la Balanza de comprobación (BCE 1.3). tipoEnvio: 'N' normal, 'C' complementaria. */
async function buildBalanzaXml(organizationId, { year, month, tipoEnvio = 'N' }) {
  const rfc = await requireRfc(organizationId);
  const bal = await reportes.balanzaComprobacion(organizationId, { year, month });
  const tipo = tipoEnvio === 'C' ? 'C' : 'N';
  return {
    xml: balanzaXmlFromReport({ rfc, year, month, tipoEnvio: tipo, cuentas: bal.cuentas }),
    filename: `${rfc}${year}${String(month).padStart(2, '0')}B${tipo}.xml`,
    cuadra: bal.cuadra,
  };
}

/**
 * Valida prerequisitos para el envío mensual y expone el enlace póliza↔CFDI.
 * Devuelve { ok, checks: [{id, ok, level, message}], cfdi_link: {...} }.
 */
async function validate(organizationId, { year, month }) {
  const checks = [];
  let rfc = null;
  try { rfc = await requireRfc(organizationId); checks.push({ id: 'rfc', ok: true, level: 'ok', message: `Emisor ${rfc}` }); }
  catch (e) { checks.push({ id: 'rfc', ok: false, level: 'error', message: e.message }); }

  const bal = await reportes.balanzaComprobacion(organizationId, { year, month });
  checks.push({
    id: 'balanza_cuadra', ok: bal.cuadra, level: bal.cuadra ? 'ok' : 'error',
    message: bal.cuadra
      ? `Balanza cuadra: cargos ${bal.total_cargos} = abonos ${bal.total_abonos}`
      : `Balanza no cuadra: cargos ${bal.total_cargos} ≠ abonos ${bal.total_abonos}`,
  });

  const { rows: agrupRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.chart_of_accounts
      WHERE organization_id = $1 AND active = true AND (sat_grouping_code IS NULL OR sat_grouping_code = '')`,
    [organizationId]
  );
  const sinAgrup = agrupRows[0].n;
  checks.push({
    id: 'codigo_agrupador', ok: sinAgrup === 0, level: sinAgrup === 0 ? 'ok' : 'warning',
    message: sinAgrup === 0 ? 'Todas las cuentas tienen código agrupador SAT'
      : `${sinAgrup} cuenta(s) sin código agrupador SAT`,
  });

  // Enlace póliza ↔ CFDI del periodo.
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows: linkRows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE source = 'cfdi')::int AS polizas_cfdi,
        count(*)::int AS polizas_total
       FROM finance.journal_entries
      WHERE organization_id = $1 AND status = 'posted'
        AND entry_date >= $2::date AND entry_date < ($2::date + interval '1 month')`,
    [organizationId, start]
  );
  const { rows: cfdiRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.invoices
      WHERE organization_id = $1 AND uuid_sat IS NOT NULL
        AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')
        AND COALESCE(comprobante_type, 'I') NOT IN ('P', 'N')`,
    [organizationId, start]
  );
  const cfdiLink = {
    polizas_total: linkRows[0].polizas_total,
    polizas_desde_cfdi: linkRows[0].polizas_cfdi,
    cfdis_periodo: cfdiRows[0].n,
    cfdis_sin_poliza: Math.max(0, cfdiRows[0].n - linkRows[0].polizas_cfdi),
  };
  checks.push({
    id: 'cfdi_link', ok: cfdiLink.cfdis_sin_poliza === 0,
    level: cfdiLink.cfdis_sin_poliza === 0 ? 'ok' : 'warning',
    message: cfdiLink.cfdis_sin_poliza === 0
      ? `${cfdiLink.polizas_desde_cfdi} póliza(s) enlazadas a CFDI; sin pendientes`
      : `${cfdiLink.cfdis_sin_poliza} CFDI(s) del periodo sin póliza (genera pólizas automáticas)`,
  });

  return { year, month, ok: checks.every((c) => c.ok || c.level !== 'error'), checks, cfdi_link: cfdiLink };
}

module.exports = {
  buildCatalogoXml, buildBalanzaXml, validate, buildAccountTree,
  catalogoXmlFromTree, balanzaXmlFromReport, xmlEscape,
};
