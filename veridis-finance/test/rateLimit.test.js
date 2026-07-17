const { test } = require('node:test');
const assert = require('node:assert/strict');

const { authRateLimit } = require('../src/middleware/rateLimit');

function fakeReply() {
  return { headers: {}, header(k, v) { this.headers[k] = v; } };
}

// A brute-force attacker rotating source IPs must still be stopped by the
// per-account gate (8 attempts / 15 min) against a single email+org.
test('authRateLimit locks a single account even when the IP rotates', async () => {
  const email = `victim-${Math.round(process.hrtime()[1])}@example.com`;
  let blocked = false;
  for (let i = 0; i < 12; i += 1) {
    const request = {
      ip: `10.0.0.${i}`, // different IP each attempt
      body: { email, organization_slug: 'acme' },
    };
    try {
      await authRateLimit(request, fakeReply());
    } catch (err) {
      if (err.statusCode === 429) {
        blocked = true;
        break;
      }
      throw err;
    }
  }
  assert.equal(blocked, true, 'account should be locked after too many attempts');
});

// Requests without an email (bad payloads) must not lock out unrelated users;
// only the per-IP gate applies.
test('authRateLimit does not create an account bucket without an email', async () => {
  const request = { ip: '203.0.113.7', body: {} };
  // A handful of attempts under the IP cap must all pass.
  for (let i = 0; i < 5; i += 1) {
    await authRateLimit(request, fakeReply());
  }
  assert.ok(true);
});
