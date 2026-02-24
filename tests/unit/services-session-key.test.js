const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionKeyService } = require('../../services/session-key');

test('inferClientId infers from explicit header and user-agent', () => {
  const service = createSessionKeyService({
    sanitizeKeyPart: (v, fb) => (String(v || '').trim().toLowerCase() || fb),
    fingerprint: () => 'fp'
  });

  assert.equal(service.inferClientId({ headers: { 'x-client': 'Custom' } }), 'custom');
  assert.equal(service.inferClientId({ headers: { 'user-agent': 'OpenCode/1.0' } }), 'opencode');
  assert.equal(service.inferClientId({ headers: { 'user-agent': 'Claude Code' } }), 'claude-code');
  assert.equal(service.inferClientId({ headers: {} }), 'unknown');
});

test('getSessionStoreKey honors header and mode', () => {
  const service = createSessionKeyService({
    sanitizeKeyPart: (v, fb) => (String(v || '').trim().toLowerCase() || fb),
    fingerprint: () => 'fp'
  });

  const prevHeader = process.env.SESSION_KEY_HEADER;
  const prevMode = process.env.SESSION_KEY_MODE;
  process.env.SESSION_KEY_HEADER = 'x-session-key';
  process.env.SESSION_KEY_MODE = 'auth_model_client';
  try {
    assert.equal(
      service.getSessionStoreKey({ headers: { 'x-session-key': 'abc' } }, 'm1', 't1'),
      'abc::m1'
    );
    assert.equal(
      service.getSessionStoreKey({ headers: { 'user-agent': 'OpenCode' } }, 'm1', 't1'),
      'fp::m1::opencode'
    );
  } finally {
    if (prevHeader === undefined) delete process.env.SESSION_KEY_HEADER; else process.env.SESSION_KEY_HEADER = prevHeader;
    if (prevMode === undefined) delete process.env.SESSION_KEY_MODE; else process.env.SESSION_KEY_MODE = prevMode;
  }
});
