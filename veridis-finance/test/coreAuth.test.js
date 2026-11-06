const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { authenticate, resolveOrganizationId } = require('../src/middleware/auth');
process.env.CORE_FINANCE_SECRET = 'test-core-bridge-secret-at-least-32-characters';
const claims = { user_id: 'staff-a', organization_id: 'org-a', role: 'ops' };
function request(extra = {}, options = {}) {
  return { headers: { authorization: 'Bearer ' + jwt.sign({ ...claims, ...extra }, process.env.CORE_FINANCE_SECRET,
    { issuer: '642-core', audience: 'veridis-finance', expiresIn: '60s', ...options }) } };
}
test('accepts short lived server bridge token with organization scope', async () => {
  const req = request(); await authenticate(req);
  assert.equal(resolveOrganizationId(req), 'org-a');
  assert.throws(() => resolveOrganizationId(req, 'org-b'), { statusCode: 403 });
});
test('rejects wrong audience, expired tokens, and owner escalation', async () => {
  for (const req of [request({}, { audience: 'other' }), request({}, { expiresIn: '-1s' }), request({ role: 'owner' })]) {
    await assert.rejects(authenticate(req), { statusCode: 401 });
  }
});
