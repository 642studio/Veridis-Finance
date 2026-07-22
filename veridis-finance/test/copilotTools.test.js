const test = require('node:test');
const assert = require('node:assert');
const { TOOLS, WRITE_TOOLS, toolSpecs, isWriteTool, getTool } = require('../src/services/copilot/tools');

test('las acciones están marcadas write y tienen resumen + formatResult', () => {
  assert.ok(WRITE_TOOLS.length >= 5);
  for (const t of WRITE_TOOLS) {
    assert.strictEqual(t.write, true, t.name);
    assert.strictEqual(typeof t.resumen, 'function', t.name);
    assert.strictEqual(typeof t.formatResult, 'function', t.name);
    assert.ok(/ACCIÓN/.test(t.description), t.name);
  }
});
test('toolSpecs incluye lectura + acciones; isWriteTool distingue', () => {
  const names = toolSpecs().map((t) => t.name);
  assert.ok(names.includes('iva_periodo') && names.includes('generar_polizas_cfdi'));
  assert.strictEqual(isWriteTool('generar_polizas_cfdi'), true);
  assert.strictEqual(isWriteTool('iva_periodo'), false);
  assert.strictEqual(getTool('cerrar_periodo').write, true);
});
test('formatResult produce resúmenes humanos', () => {
  const g = getTool('generar_polizas_cfdi');
  assert.ok(/5 nueva/.test(g.formatResult({ posted: 5, skipped: 2, invoices: 7, errors: [] })));
  const c = getTool('conciliar_automaticamente');
  assert.ok(/pagos en bolsa/.test(
    c.formatResult({
      auto: { matched: 3, scanned: 80, ambiguous: 10 },
      byClient: { matched_1a1: 5, matched_bolsa: 2, invoices_conciliadas: 8 },
    })
  ));
});
test('runTool rechaza ejecutar acciones directo (sin confirmación)', async () => {
  const { runTool } = require('../src/services/copilot/tools');
  const r = await runTool('generar_polizas_cfdi', 'org-x', { year: 2026, month: 6 });
  assert.ok(/confirmación/.test(r.error));
});
