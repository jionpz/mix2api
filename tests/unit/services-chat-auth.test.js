const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveInboundToken, resolveUpstreamToken, inspectTokenInfo } = require('../../services/chat-auth');

test('resolveInboundToken validates bearer header and expected token', () => {
  const ok = resolveInboundToken({
    authHeader: 'Bearer abc',
    inboundAuthMode: 'bearer',
    expectedInboundToken: 'abc'
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.inboundToken, 'abc');

  const missing = resolveInboundToken({ authHeader: null, inboundAuthMode: 'bearer', expectedInboundToken: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);
});

test('resolveUpstreamToken handles pass_through static managed and invalid mode', async () => {
  const managed = {
    getManagedUpstreamToken: async () => 'managed-token'
  };

  const pass = await resolveUpstreamToken({
    upstreamAuthMode: 'pass_through',
    inboundToken: 'in',
    staticUpstreamToken: null,
    requestId: 'r1',
    managedUpstreamTokenService: managed
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.upstreamToken, 'in');

  const stat = await resolveUpstreamToken({
    upstreamAuthMode: 'static',
    inboundToken: null,
    staticUpstreamToken: 'st',
    requestId: 'r2',
    managedUpstreamTokenService: managed
  });
  assert.equal(stat.ok, true);
  assert.equal(stat.upstreamToken, 'st');

  const man = await resolveUpstreamToken({
    upstreamAuthMode: 'managed',
    inboundToken: null,
    staticUpstreamToken: null,
    requestId: 'r3',
    managedUpstreamTokenService: managed
  });
  assert.equal(man.ok, true);
  assert.equal(man.upstreamToken, 'managed-token');

  const bad = await resolveUpstreamToken({
    upstreamAuthMode: 'bad-mode',
    inboundToken: null,
    staticUpstreamToken: null,
    requestId: 'r4',
    managedUpstreamTokenService: managed
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 500);
});

test('inspectTokenInfo returns raw 401 payload when token expired', () => {
  const nowSec = Math.floor(Date.now() / 1000) - 60;
  const payloadObj = { exp: nowSec };
  const b64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const token = `h.${b64}.s`;

  const result = inspectTokenInfo({
    upstreamToken: token,
    logTokenInfoEnabled: true,
    base64UrlToJson: (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64').toString('utf8'))
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.rawJson.error.message, 'Token expired');
});
