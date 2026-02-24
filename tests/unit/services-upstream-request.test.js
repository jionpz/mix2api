const test = require('node:test');
const assert = require('node:assert/strict');

const { createUpstreamRequestService } = require('../../services/upstream-request');

function makeResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    },
    async text() {
      return JSON.stringify(payload || {});
    },
    async json() {
      return payload || {};
    },
    clone() {
      return this;
    }
  };
}

function createService(fetchImpl) {
  return createUpstreamRequestService({
    fetch: fetchImpl,
    httpAgent: {},
    httpsAgent: {},
    config: {
      UPSTREAM_API_BASE: 'https://upstream.example',
      UPSTREAM_CHAT_PATH: '/v2/chats',
      UPSTREAM_ACCEPT_LANGUAGE: 'en',
      UPSTREAM_REFERER: 'https://ref.example'
    },
    helpers: {
      redactSensitiveText: (s) => String(s || '')
    }
  });
}

test('fetchWithAuthRecovery returns success response directly', async () => {
  const service = createService(async () => makeResponse(200, { ok: true }));
  const out = await service.fetchWithAuthRecovery({
    requestId: 'req-1',
    upstreamRequest: { a: 1 },
    upstreamToken: 't1',
    upstreamAuthMode: 'pass_through',
    authRecoveryRetry: 1,
    timeoutMs: 1000,
    retryCount: 0,
    retryBaseMs: 1,
    shouldRecover: async () => false,
    clearManagedToken: () => {},
    refreshManagedToken: async () => 't2'
  });
  assert.equal(out.response.status, 200);
  assert.equal(out.upstreamToken, 't1');
});

test('fetchWithAuthRecovery retries with refreshed token when recoverable', async () => {
  let call = 0;
  const service = createService(async () => {
    call++;
    if (call === 1) return makeResponse(401, { error: { message: 'token expired' } });
    return makeResponse(200, { ok: true });
  });

  let cleared = false;
  const out = await service.fetchWithAuthRecovery({
    requestId: 'req-2',
    upstreamRequest: { a: 1 },
    upstreamToken: 'old',
    upstreamAuthMode: 'managed',
    authRecoveryRetry: 1,
    timeoutMs: 1000,
    retryCount: 0,
    retryBaseMs: 1,
    shouldRecover: async (response) => response.status === 401,
    clearManagedToken: () => {
      cleared = true;
    },
    refreshManagedToken: async () => 'new-token'
  });

  assert.equal(call, 2);
  assert.equal(cleared, true);
  assert.equal(out.response.status, 200);
  assert.equal(out.upstreamToken, 'new-token');
});
