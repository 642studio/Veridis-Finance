const test = require('node:test');
const assert = require('node:assert');
const { limitState } = require('../src/services/copilot/usageService');

test('bajo el límite: permitido', () => {
  const s = limitState({ requestsToday: 10, tokensMonth: 1000, dailyRequests: 300, monthlyTokens: 15000000 });
  assert.strictEqual(s.allowed, true);
});
test('límite diario de consultas alcanzado: bloquea con mensaje claro', () => {
  const s = limitState({ requestsToday: 300, tokensMonth: 0, dailyRequests: 300, monthlyTokens: 15000000 });
  assert.strictEqual(s.allowed, false);
  assert.ok(/diario/.test(s.reason));
});
test('límite mensual de tokens alcanzado: bloquea', () => {
  const s = limitState({ requestsToday: 1, tokensMonth: 15000000, dailyRequests: 300, monthlyTokens: 15000000 });
  assert.strictEqual(s.allowed, false);
  assert.ok(/mensual/.test(s.reason));
});
