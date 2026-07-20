const test = require('node:test');
const assert = require('node:assert');

const {
  obligacionesForPeriod,
  obligacionesConEstado,
  diasRestantes,
  estadoObligacion,
  buildAlertas,
} = require('../src/services/escritorioFiscalService');

test('obligaciones del periodo vencen el mes siguiente (IVA/ISR día 17, DIOT fin de mes)', () => {
  const o = obligacionesForPeriod(2026, 7); // julio → vencen en agosto
  const iva = o.find((x) => x.clave === 'iva');
  const diot = o.find((x) => x.clave === 'diot');
  assert.strictEqual(iva.vence, '2026-08-17');
  assert.strictEqual(diot.vence, '2026-08-31');
});

test('diciembre rueda al enero siguiente', () => {
  const o = obligacionesForPeriod(2026, 12);
  assert.strictEqual(o.find((x) => x.clave === 'iva').vence, '2027-01-17');
  assert.strictEqual(o.find((x) => x.clave === 'diot').vence, '2027-01-31');
});

test('diasRestantes y estado', () => {
  assert.strictEqual(diasRestantes('2026-08-17', '2026-08-10'), 7);
  assert.strictEqual(diasRestantes('2026-08-17', '2026-08-20'), -3);
  assert.strictEqual(estadoObligacion(-1), 'vencida');
  assert.strictEqual(estadoObligacion(5), 'proxima');
  assert.strictEqual(estadoObligacion(20), 'ok');
});

test('obligacionesConEstado marca vencida/próxima según hoy', () => {
  const o = obligacionesConEstado(2026, 7, '2026-08-15'); // 2 días para el 17
  assert.strictEqual(o.find((x) => x.clave === 'iva').estado, 'proxima');
  const o2 = obligacionesConEstado(2026, 7, '2026-09-01'); // ya vencieron
  assert.ok(o2.every((x) => x.estado === 'vencida'));
});

test('buildAlertas prioriza descuadre, EFOS y vencidas', () => {
  const alertas = buildAlertas({
    balanza: { cuadra: false },
    conc: { cfdi: { sin_poliza: 3 } },
    efosDefinitivos: 1,
    obligaciones: [{ estado: 'vencida' }, { estado: 'ok' }],
  });
  assert.ok(alertas.some((a) => a.nivel === 'error' && /balanza/i.test(a.texto)));
  assert.ok(alertas.some((a) => /EFOS/i.test(a.texto)));
  assert.ok(alertas.some((a) => /sin póliza/i.test(a.texto)));
  assert.ok(alertas.some((a) => /vencida/i.test(a.texto)));
});
