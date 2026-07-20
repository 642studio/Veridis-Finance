/**
 * Activos fijos y depreciación (Sprint 12) — línea recta, paridad COI/Aspel.
 *
 * Depreciación mensual = (costo − valor de rescate) × tasa_anual / 12, aplicada
 * desde el mes SIGUIENTE al de adquisición (criterio conservador MX), hasta
 * acumular la base depreciable. La póliza mensual (diario) es idempotente:
 *
 *     Cargo  601.85  Depreciación del ejercicio
 *     Abono  172.01  Depreciación acumulada (contra-activo)
 *
 * source='depreciacion', source_ref='<assetId>:<YYYY-MM>'.
 */

const pool = require('../db/pool');
const accounting = require('./accountingService');
const { round } = require('../lib/money');

const num = (v) => Number(round(v));

// Cuentas que requiere la depreciación (se crean si faltan al registrar un activo).
const DEPRECIATION_ACCOUNTS = [
  { code: '155.01', name: 'Mobiliario y equipo de oficina', account_type: 'activo', nature: 'deudora', sat: '155.01' },
  { code: '156.01', name: 'Equipo de cómputo', account_type: 'activo', nature: 'deudora', sat: '156.01' },
  { code: '172.01', name: 'Depreciación acumulada', account_type: 'activo', nature: 'acreedora', sat: '172.01' },
  { code: '601.85', name: 'Depreciación del ejercicio', account_type: 'gasto', nature: 'deudora', sat: '601.85' },
];

async function ensureDepreciationAccounts(organizationId) {
  for (const a of DEPRECIATION_ACCOUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await accounting.createAccount(organizationId, {
      code: a.code, name: a.name, account_type: a.account_type,
      nature: a.nature, sat_grouping_code: a.sat, is_postable: true,
    });
  }
}

function mapAsset(r) {
  return {
    id: r.id, name: r.name, description: r.description, category: r.category,
    acquisition_date: r.acquisition_date, cost: Number(r.cost),
    salvage_value: Number(r.salvage_value), annual_rate: Number(r.annual_rate),
    method: r.method, asset_account_code: r.asset_account_code,
    accum_account_code: r.accum_account_code, expense_account_code: r.expense_account_code,
    cfdi_uuid: r.cfdi_uuid, status: r.status, disposed_at: r.disposed_at,
  };
}

async function listAssets(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.fixed_assets WHERE organization_id = $1 ORDER BY acquisition_date DESC, name`,
    [organizationId]
  );
  return rows.map(mapAsset);
}

async function createAsset(organizationId, input) {
  await ensureDepreciationAccounts(organizationId);
  const { rows } = await pool.query(
    `INSERT INTO finance.fixed_assets
       (organization_id, name, description, category, acquisition_date, cost, salvage_value,
        annual_rate, method, asset_account_code, accum_account_code, expense_account_code, cfdi_uuid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [organizationId, input.name, input.description || null, input.category || null,
     input.acquisition_date, input.cost, input.salvage_value || 0,
     input.annual_rate != null ? input.annual_rate : 0.10, input.method || 'linea_recta',
     input.asset_account_code || '155.01', input.accum_account_code || '172.01',
     input.expense_account_code || '601.85', input.cfdi_uuid || null]
  );
  return mapAsset(rows[0]);
}

/**
 * Calendario de depreciación (puro). Línea recta desde el mes siguiente a la
 * adquisición. Devuelve [{year, month, depreciacion, acumulada, valor_libros}].
 * `upTo` (opcional) limita el calendario a ese {year, month} inclusive.
 */
function depreciationSchedule(asset, upTo = null) {
  const base = num(Number(asset.cost) - Number(asset.salvage_value || 0));
  if (base <= 0 || asset.method !== 'linea_recta') return [];
  const monthly = num((base * Number(asset.annual_rate)) / 12);
  if (monthly <= 0) return [];

  const acq = new Date(asset.acquisition_date);
  let y = acq.getUTCFullYear();
  let m = acq.getUTCMonth() + 1; // 1..12
  // Empieza el mes siguiente al de adquisición.
  m += 1; if (m > 12) { m = 1; y += 1; }

  const schedule = [];
  let acumulada = 0;
  // Límite de iteraciones = meses hasta depreciar del todo (+ colchón).
  const maxMonths = Math.ceil(base / monthly) + 2;
  for (let i = 0; i < maxMonths; i += 1) {
    if (acumulada >= base) break;
    let dep = monthly;
    if (acumulada + dep > base) dep = num(base - acumulada); // último ajuste
    acumulada = num(acumulada + dep);
    schedule.push({
      year: y, month: m, depreciacion: dep, acumulada,
      valor_libros: num(Number(asset.cost) - acumulada),
    });
    if (upTo && (y > upTo.year || (y === upTo.year && m >= upTo.month))) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return schedule;
}

/** Genera la póliza de depreciación de un periodo para todos los activos activos. */
async function runDepreciation(organizationId, { year, month, createdBy }) {
  const assets = (await listAssets(organizationId)).filter((a) => a.status === 'activo');
  let posted = 0;
  let skipped = 0;
  const errors = [];
  for (const asset of assets) {
    const sched = depreciationSchedule(asset, { year, month });
    const row = sched.find((s) => s.year === year && s.month === month);
    if (!row || row.depreciacion <= 0) { skipped += 1; continue; }
    const sourceRef = `${asset.id}:${year}-${String(month).padStart(2, '0')}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await accounting.createEntry(organizationId, {
        entry_type: 'diario',
        entry_date: `${year}-${String(month).padStart(2, '0')}-28`,
        concept: `Depreciación ${asset.name} (${month}/${year})`,
        source: 'depreciation',
        source_ref: sourceRef,
        created_by: createdBy || null,
        lines: [
          { account_code: asset.expense_account_code, debit: row.depreciacion, description: 'Depreciación del ejercicio' },
          { account_code: asset.accum_account_code, credit: row.depreciacion, description: 'Depreciación acumulada' },
        ],
      });
      posted += 1;
      // Si quedó totalmente depreciado, marca el estatus.
      if (row.acumulada >= num(Number(asset.cost) - Number(asset.salvage_value || 0))) {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(
          `UPDATE finance.fixed_assets SET status = 'totalmente_depreciado', updated_at = now()
            WHERE id = $1 AND organization_id = $2`,
          [asset.id, organizationId]
        );
      }
    } catch (err) {
      if (err.code === '23505') { skipped += 1; continue; }
      errors.push({ asset: asset.name, error: err.message });
    }
  }
  return { assets: assets.length, posted, skipped, errors };
}

module.exports = {
  listAssets, createAsset, runDepreciation, depreciationSchedule,
  ensureDepreciationAccounts,
};
