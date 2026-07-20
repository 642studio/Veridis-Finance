/**
 * Motor de contabilidad de partida doble (paridad COI/Contpaqi).
 *
 * - Catálogo de cuentas con código agrupador SAT + naturaleza deudora/acreedora.
 * - Pólizas (journal_entries) con partidas (journal_lines) balanceadas: la
 *   suma de cargos DEBE igualar la suma de abonos, validado en transacción.
 * - Periodos contables con bloqueo (no se registra en periodo cerrado).
 *
 * Este módulo entrega los fundamentos (S8): catálogo, póliza manual y balanza
 * básica. Las pólizas automáticas (S9) y reportes (S10) se apoyan aquí.
 */

const pool = require('../db/pool');
const { money, round } = require('../lib/money');

// round() devuelve string con 2 decimales; num() lo entrega como número para JSON.
const num = (v) => Number(round(v));

// Catálogo base estándar (subconjunto práctico del código agrupador del SAT).
// Se siembra la primera vez que un tenant abre Contabilidad.
const BASE_CATALOG = [
  // code, name, type, nature, sat_grouping, postable
  ['101.01', 'Caja', 'activo', 'deudora', '101.01', true],
  ['102.01', 'Bancos nacionales', 'activo', 'deudora', '102.01', true],
  ['105.01', 'Clientes nacionales', 'activo', 'deudora', '105.01', true],
  ['118.01', 'IVA acreditable pagado', 'activo', 'deudora', '118.01', true],
  ['119.01', 'IVA acreditable pendiente (PPD)', 'activo', 'deudora', '119.01', true],
  ['201.01', 'Proveedores nacionales', 'pasivo', 'acreedora', '201.01', true],
  ['209.01', 'Otras cuentas por pagar', 'pasivo', 'acreedora', '209.01', true],
  ['213.01', 'IVA trasladado no cobrado (PPD)', 'pasivo', 'acreedora', '213.01', true],
  ['216.01', 'IVA trasladado cobrado', 'pasivo', 'acreedora', '216.01', true],
  ['210.01', 'ISR retenido por pagar', 'pasivo', 'acreedora', '210.01', true],
  ['301.01', 'Capital social', 'capital', 'acreedora', '301.01', true],
  ['305.01', 'Resultado del ejercicio', 'capital', 'acreedora', '305.01', true],
  ['401.01', 'Ingresos por servicios', 'ingreso', 'acreedora', '401.01', true],
  ['402.01', 'Ingresos por ventas', 'ingreso', 'acreedora', '402.01', true],
  ['501.01', 'Costo de ventas', 'costo', 'deudora', '501.01', true],
  ['601.01', 'Sueldos y salarios', 'gasto', 'deudora', '601.01', true],
  ['601.06', 'Publicidad y propaganda', 'gasto', 'deudora', '601.06', true],
  ['601.10', 'Renta', 'gasto', 'deudora', '601.10', true],
  ['601.16', 'Servicios (luz, agua, internet)', 'gasto', 'deudora', '601.16', true],
  ['601.24', 'Software y suscripciones', 'gasto', 'deudora', '601.24', true],
  ['601.84', 'Otros gastos generales', 'gasto', 'deudora', '601.84', true],
  ['602.01', 'Comisiones bancarias', 'gasto', 'deudora', '602.01', true],
  ['701.01', 'Otros gastos', 'gasto', 'deudora', '701.01', true],
];

function mapAccount(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    account_type: r.account_type,
    nature: r.nature,
    sat_grouping_code: r.sat_grouping_code,
    is_postable: r.is_postable,
    active: r.active,
    balance: r.balance != null ? Number(r.balance) : undefined,
  };
}

async function seedCatalogIfEmpty(organizationId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.chart_of_accounts WHERE organization_id = $1`,
    [organizationId]
  );
  if (rows[0].n > 0) return { seeded: 0 };
  const values = [];
  const params = [organizationId];
  BASE_CATALOG.forEach((a, i) => {
    const base = i * 6;
    values.push(`($1,$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    params.push(a[0], a[1], a[2], a[3], a[4], a[5]);
  });
  await pool.query(
    `INSERT INTO finance.chart_of_accounts
       (organization_id, code, name, account_type, nature, sat_grouping_code, is_postable)
     VALUES ${values.join(',')}
     ON CONFLICT (organization_id, code) DO NOTHING`,
    params
  );
  return { seeded: BASE_CATALOG.length };
}

async function listAccounts(organizationId, { withBalance = false } = {}) {
  await seedCatalogIfEmpty(organizationId);
  if (withBalance) {
    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(SUM(CASE WHEN c.nature = 'deudora' THEN l.debit - l.credit
                                ELSE l.credit - l.debit END), 0) AS balance
         FROM finance.chart_of_accounts a
         LEFT JOIN finance.chart_of_accounts c ON c.id = a.id
         LEFT JOIN finance.journal_lines l ON l.account_id = a.id
         LEFT JOIN finance.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
        WHERE a.organization_id = $1 AND a.active = true
        GROUP BY a.id
        ORDER BY a.code`,
      [organizationId]
    );
    return rows.map(mapAccount);
  }
  const { rows } = await pool.query(
    `SELECT * FROM finance.chart_of_accounts
      WHERE organization_id = $1 AND active = true ORDER BY code`,
    [organizationId]
  );
  return rows.map(mapAccount);
}

const NATURE_BY_TYPE = {
  activo: 'deudora', costo: 'deudora', gasto: 'deudora', orden: 'deudora',
  pasivo: 'acreedora', capital: 'acreedora', ingreso: 'acreedora',
};

async function createAccount(organizationId, input) {
  const nature = input.nature || NATURE_BY_TYPE[input.account_type] || 'deudora';
  const { rows } = await pool.query(
    `INSERT INTO finance.chart_of_accounts
       (organization_id, code, name, account_type, nature, sat_grouping_code, is_postable)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id, code) DO UPDATE SET
       name = EXCLUDED.name, account_type = EXCLUDED.account_type,
       nature = EXCLUDED.nature, sat_grouping_code = EXCLUDED.sat_grouping_code,
       is_postable = EXCLUDED.is_postable, updated_at = now()
     RETURNING *`,
    [organizationId, input.code, input.name, input.account_type, nature,
     input.sat_grouping_code || input.code, input.is_postable !== false]
  );
  return mapAccount(rows[0]);
}

/** Ensure the period exists and is open; throws if closed. */
async function assertPeriodOpen(client, organizationId, year, month) {
  const { rows } = await client.query(
    `INSERT INTO finance.accounting_periods (organization_id, year, month)
     VALUES ($1,$2,$3)
     ON CONFLICT (organization_id, year, month) DO UPDATE SET year = EXCLUDED.year
     RETURNING status`,
    [organizationId, year, month]
  );
  if (rows[0]?.status === 'closed') {
    const err = new Error(`El periodo ${month}/${year} está cerrado`);
    err.statusCode = 409;
    throw err;
  }
}

/**
 * Crea una póliza balanceada. `lines` = [{account_id|account_code, debit, credit, description, cfdi_uuid}].
 * Valida partida doble (Σcargos = Σabonos) y cuentas de detalle, en transacción.
 */
async function createEntry(organizationId, input, { client: extClient } = {}) {
  const own = !extClient;
  const client = extClient || (await pool.connect());
  try {
    if (own) await client.query('BEGIN');

    const date = new Date(input.entry_date);
    const year = input.period_year || date.getUTCFullYear();
    const month = input.period_month || date.getUTCMonth() + 1;
    await assertPeriodOpen(client, organizationId, year, month);

    // Resolver cuentas por código si vienen así, y validar que sean de detalle.
    const resolved = [];
    let totalDebit = money(0);
    let totalCredit = money(0);
    for (let i = 0; i < (input.lines || []).length; i += 1) {
      const l = input.lines[i];
      let accountId = l.account_id;
      let acc;
      if (!accountId && l.account_code) {
        const { rows } = await client.query(
          `SELECT id, is_postable FROM finance.chart_of_accounts WHERE organization_id = $1 AND code = $2`,
          [organizationId, l.account_code]
        );
        acc = rows[0];
        accountId = acc?.id;
      } else if (accountId) {
        const { rows } = await client.query(
          `SELECT id, is_postable FROM finance.chart_of_accounts WHERE organization_id = $1 AND id = $2`,
          [organizationId, accountId]
        );
        acc = rows[0];
      }
      if (!accountId || !acc) {
        const err = new Error(`Cuenta contable no encontrada en la partida ${i + 1}`);
        err.statusCode = 400;
        throw err;
      }
      if (!acc.is_postable) {
        const err = new Error(`La cuenta de la partida ${i + 1} no es de detalle (no recibe movimientos)`);
        err.statusCode = 400;
        throw err;
      }
      const debit = round(l.debit || 0);
      const credit = round(l.credit || 0);
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        const err = new Error(`La partida ${i + 1} debe ser cargo O abono (no ambos, no cero)`);
        err.statusCode = 400;
        throw err;
      }
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      resolved.push({ accountId, debit, credit, description: l.description || null, cfdi_uuid: l.cfdi_uuid || null });
    }

    if (resolved.length < 2) {
      const err = new Error('Una póliza requiere al menos dos partidas');
      err.statusCode = 400;
      throw err;
    }
    if (!totalDebit.equals(totalCredit)) {
      const err = new Error(
        `La póliza no cuadra: cargos ${totalDebit.toFixed(2)} ≠ abonos ${totalCredit.toFixed(2)}`
      );
      err.statusCode = 400;
      throw err;
    }

    // Folio consecutivo por organización.
    const { rows: folioRows } = await client.query(
      `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM finance.journal_entries WHERE organization_id = $1`,
      [organizationId]
    );
    const folio = folioRows[0].next;

    const { rows: entryRows } = await client.query(
      `INSERT INTO finance.journal_entries
         (organization_id, folio, entry_type, entry_date, concept, period_year, period_month,
          status, source, source_ref, total_debit, total_credit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8,$9,$10,$11,$12)
       RETURNING *`,
      [organizationId, folio, input.entry_type || 'diario', input.entry_date, input.concept,
       year, month, input.source || 'manual', input.source_ref || null,
       round(totalDebit.toNumber()), round(totalCredit.toNumber()), input.created_by || null]
    );
    const entry = entryRows[0];

    for (let i = 0; i < resolved.length; i += 1) {
      const l = resolved[i];
      await client.query(
        `INSERT INTO finance.journal_lines
           (organization_id, entry_id, account_id, debit, credit, description, cfdi_uuid, line_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [organizationId, entry.id, l.accountId, l.debit, l.credit, l.description, l.cfdi_uuid, i + 1]
      );
    }

    if (own) await client.query('COMMIT');
    return { id: entry.id, folio, total_debit: Number(entry.total_debit), total_credit: Number(entry.total_credit) };
  } catch (err) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (own) client.release();
  }
}

async function listEntries(organizationId, { year, month, limit = 100, offset = 0 } = {}) {
  const params = [organizationId];
  let where = 'organization_id = $1';
  if (year) { params.push(year); where += ` AND period_year = $${params.length}`; }
  if (month) { params.push(month); where += ` AND period_month = $${params.length}`; }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, folio, entry_type, entry_date, concept, status, source, source_ref,
            total_debit, total_credit, period_year, period_month
       FROM finance.journal_entries
      WHERE ${where}
      ORDER BY entry_date DESC, folio DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((r) => ({ ...r, total_debit: Number(r.total_debit), total_credit: Number(r.total_credit) }));
}

async function getEntry(organizationId, id) {
  const { rows } = await pool.query(
    `SELECT id, folio, entry_type, entry_date, concept, status, source, total_debit, total_credit
       FROM finance.journal_entries WHERE organization_id = $1 AND id = $2`,
    [organizationId, id]
  );
  if (!rows[0]) return null;
  const { rows: lines } = await pool.query(
    `SELECT l.debit, l.credit, l.description, l.cfdi_uuid, l.line_no,
            a.code AS account_code, a.name AS account_name
       FROM finance.journal_lines l
       JOIN finance.chart_of_accounts a ON a.id = l.account_id
      WHERE l.entry_id = $2 AND l.organization_id = $1
      ORDER BY l.line_no`,
    [organizationId, id]
  );
  return {
    ...rows[0],
    total_debit: Number(rows[0].total_debit),
    total_credit: Number(rows[0].total_credit),
    lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
  };
}

async function cancelEntry(organizationId, id) {
  const { rowCount } = await pool.query(
    `UPDATE finance.journal_entries SET status = 'canceled', canceled_at = now()
      WHERE organization_id = $1 AND id = $2 AND status = 'posted'`,
    [organizationId, id]
  );
  return rowCount > 0;
}

/** Balanza de comprobación por periodo (fundamento; el reporte formal es S10). */
async function trialBalance(organizationId, { year, month }) {
  const { rows } = await pool.query(
    `SELECT a.code, a.name, a.account_type, a.nature,
            COALESCE(SUM(l.debit), 0)  AS cargos,
            COALESCE(SUM(l.credit), 0) AS abonos
       FROM finance.chart_of_accounts a
       LEFT JOIN finance.journal_lines l ON l.account_id = a.id
       LEFT JOIN finance.journal_entries e ON e.id = l.entry_id
            AND e.status = 'posted' AND e.period_year = $2 AND e.period_month = $3
      WHERE a.organization_id = $1
      GROUP BY a.id
      HAVING COALESCE(SUM(l.debit),0) <> 0 OR COALESCE(SUM(l.credit),0) <> 0
      ORDER BY a.code`,
    [organizationId, year, month]
  );
  let totalCargos = 0;
  let totalAbonos = 0;
  const cuentas = rows.map((r) => {
    const cargos = Number(r.cargos);
    const abonos = Number(r.abonos);
    totalCargos += cargos;
    totalAbonos += abonos;
    const saldo = r.nature === 'deudora' ? cargos - abonos : abonos - cargos;
    return { code: r.code, name: r.name, account_type: r.account_type, nature: r.nature,
             cargos: num(cargos), abonos: num(abonos), saldo: num(saldo) };
  });
  return {
    cuentas,
    total_cargos: num(totalCargos),
    total_abonos: num(totalAbonos),
    cuadra: num(totalCargos) === num(totalAbonos),
  };
}

module.exports = {
  seedCatalogIfEmpty,
  listAccounts,
  createAccount,
  createEntry,
  listEntries,
  getEntry,
  cancelEntry,
  trialBalance,
  BASE_CATALOG,
};
