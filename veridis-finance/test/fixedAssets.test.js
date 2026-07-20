const test = require('node:test');
const assert = require('node:assert');

const { depreciationSchedule } = require('../src/services/fixedAssetsService');

test('línea recta: depreciación mensual = base × tasa / 12', () => {
  const s = depreciationSchedule({
    cost: 12000, salvage_value: 0, annual_rate: 0.10, method: 'linea_recta',
    acquisition_date: '2026-01-15',
  }, { year: 2026, month: 12 });
  // base 12000 × 10% / 12 = 100/mes; empieza en febrero (mes siguiente).
  assert.strictEqual(s[0].year, 2026);
  assert.strictEqual(s[0].month, 2);
  assert.strictEqual(s[0].depreciacion, 100);
  assert.strictEqual(s[0].acumulada, 100);
  assert.strictEqual(s[0].valor_libros, 11900);
});

test('equipo de cómputo 30% anual', () => {
  const s = depreciationSchedule({
    cost: 24000, salvage_value: 0, annual_rate: 0.30, method: 'linea_recta',
    acquisition_date: '2026-06-10',
  }, { year: 2026, month: 12 });
  // 24000 × 30% / 12 = 600/mes; empieza julio.
  assert.strictEqual(s[0].month, 7);
  assert.strictEqual(s[0].depreciacion, 600);
});

test('el calendario completo acumula exactamente la base depreciable', () => {
  const asset = { cost: 1000, salvage_value: 100, annual_rate: 0.5, method: 'linea_recta', acquisition_date: '2026-01-31' };
  const full = depreciationSchedule(asset); // sin upTo = calendario completo
  const total = full.reduce((s, r) => s + r.depreciacion, 0);
  assert.ok(Math.abs(total - 900) < 0.005); // base = 1000 - 100
  assert.strictEqual(full[full.length - 1].acumulada, 900);
});

test('valor de rescate ≥ costo ⇒ sin depreciación', () => {
  const s = depreciationSchedule({
    cost: 500, salvage_value: 500, annual_rate: 0.1, method: 'linea_recta', acquisition_date: '2026-01-01',
  });
  assert.strictEqual(s.length, 0);
});

const { buildCedula } = require('../src/services/fixedAssetsService');

test('cédula: depreciación acumulada y valor en libros a la fecha de corte', () => {
  // Equipo de cómputo 30%, costo 36000, adquirido junio → deprecia desde julio (600/mes).
  const c = buildCedula([
    { id: '1', name: 'MacBook', cost: 36000, salvage_value: 0, annual_rate: 0.30,
      method: 'linea_recta', acquisition_date: '2026-06-15', status: 'activo' },
  ], { year: 2026, month: 8 });
  const a = c.activos[0];
  // 36000 × 30% / 12 = 900/mes; jul + ago = 2 meses = 1800 acumulado; valor 34200.
  assert.strictEqual(a.depreciacion_mes, 900);
  assert.strictEqual(a.depreciacion_acumulada, 1800);
  assert.strictEqual(a.valor_en_libros, 34200);
  assert.strictEqual(c.totales.valor_en_libros, 34200);
});

test('cédula: antes de iniciar depreciación, acumulada 0 y valor = costo', () => {
  const c = buildCedula([
    { id: '1', name: 'Equipo', cost: 10000, salvage_value: 0, annual_rate: 0.10,
      method: 'linea_recta', acquisition_date: '2026-06-15', status: 'activo' },
  ], { year: 2026, month: 6 });
  assert.strictEqual(c.activos[0].depreciacion_acumulada, 0);
  assert.strictEqual(c.activos[0].valor_en_libros, 10000);
});
