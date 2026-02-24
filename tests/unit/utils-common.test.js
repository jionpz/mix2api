const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRequestId,
  redactHeaders,
  redactSensitiveText,
  extractMessageText,
  base64UrlToJson,
  redactRedisUrl,
  fingerprint,
  sanitizeKeyPart,
  toPositiveInt
} = require('../../utils/common');

test('normalizeRequestId accepts safe ids and rejects invalid ids', () => {
  assert.equal(normalizeRequestId('req-1_2:3'), 'req-1_2:3');
  assert.equal(normalizeRequestId(''), null);
  assert.equal(normalizeRequestId('bad space'), null);
});

test('redactHeaders masks auth token and session-like headers', () => {
  const out = redactHeaders({ Authorization: 'Bearer abc', cookie: 'k=v', 'x-session-id': 's1', plain: 'ok' });
  assert.equal(out.Authorization, 'Bearer ***');
  assert.equal(out.cookie, '***');
  assert.equal(out['x-session-id'], '***');
  assert.equal(out.plain, 'ok');
});

test('redactSensitiveText masks token/session patterns', () => {
  const out = redactSensitiveText('Bearer abc token=xyz {"access_token":"abc","sessionId":"sid"}');
  assert.match(out, /Bearer \*\*\*/);
  assert.match(out, /token=\*\*\*/);
  assert.match(out, /"access_token":"\*\*\*"/);
  assert.match(out, /"sessionId":"\*\*\*"/);
});

test('extractMessageText supports string and OpenAI content arrays', () => {
  assert.equal(extractMessageText('hello'), 'hello');
  assert.equal(extractMessageText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
});

test('base64UrlToJson decodes valid payload and rejects invalid payload', () => {
  const encoded = 'eyJhIjoxfQ';
  assert.deepEqual(base64UrlToJson(encoded), { a: 1 });
  assert.equal(base64UrlToJson('@@@'), null);
});

test('redactRedisUrl masks credentials and falls back on invalid url', () => {
  const masked = redactRedisUrl('redis://user:pass@localhost:6379/0');
  assert.match(masked, /\*\*\*/);
  assert.equal(redactRedisUrl('not-a-url'), 'redis://***');
});

test('fingerprint and sanitizeKeyPart are stable and bounded', () => {
  assert.equal(fingerprint(null), 'none');
  assert.equal(fingerprint('abc').length, 12);
  assert.equal(sanitizeKeyPart(' A:B /C ', 'x'), 'a:b__c');
  assert.equal(sanitizeKeyPart('', 'x'), 'x');
});

test('toPositiveInt returns floored positive int or null', () => {
  assert.equal(toPositiveInt(12.9), 12);
  assert.equal(toPositiveInt('3'), 3);
  assert.equal(toPositiveInt(0), null);
  assert.equal(toPositiveInt('bad'), null);
});
