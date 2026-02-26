const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createUpstreamReadService } = require('../../services/upstream-read');

function makeService() {
  return createUpstreamReadService({
    helpers: {
      extractIdsFromUpstream: (obj) => obj && obj.ids ? obj.ids : null,
      extractErrorFromUpstreamResponse: (obj) => obj && obj.error ? obj.error.message : null,
      redactSensitiveText: (s) => String(s || ''),
      fingerprint: () => 'fp'
    }
  });
}

test('readUpstreamStream reads text-delta and captures ids', async () => {
  const service = makeService();
  const reader = new EventEmitter();
  const response = { body: reader };

  const promise = service.readUpstreamStream(response, { timeoutMs: 5000, requestId: 'r-stream', redactLine: (s) => s });
  reader.emit('data', Buffer.from('data: {"ids":{"sessionId":"s1","exchangeId":"e1"}}\n\n'));
  reader.emit('data', Buffer.from('data: {"type":"text-delta","delta":"hi"}\n\n'));
  reader.emit('end');

  const result = await promise;
  assert.equal(result.text, 'hi');
  assert.equal(result.sessionId, 's1');
  assert.equal(result.exchangeId, 'e1');
});

test('readNonStreamJsonResponse returns error and text/session values', async () => {
  const service = makeService();
  const okResponse = {
    async json() {
      return { content: 'hello', ids: { sessionId: 's2', exchangeId: 'e2' } };
    }
  };
  const errorResponse = {
    async json() {
      return { error: { message: 'boom' } };
    }
  };

  const ok = await service.readNonStreamJsonResponse(okResponse, { requestId: 'r1', logBodies: false });
  assert.equal(ok.upstreamError, null);
  assert.equal(ok.text, 'hello');
  assert.equal(ok.upstreamSessionId, 's2');
  assert.equal(ok.upstreamExchangeId, 'e2');

  const bad = await service.readNonStreamJsonResponse(errorResponse, { requestId: 'r2', logBodies: false });
  assert.equal(bad.upstreamError, 'boom');
  assert.equal(bad.text, null);
});
