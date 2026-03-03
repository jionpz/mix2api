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
      redactSensitiveText: (s) => String(s || ''),
      resolveHostAddresses: async () => ['203.0.113.10']
    }
  });
}

function createServiceWithHelpers(fetchImpl, helperOverrides = {}) {
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
      redactSensitiveText: (s) => String(s || ''),
      resolveHostAddresses: async () => ['203.0.113.10'],
      ...helperOverrides
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

test('fetchWithAuthRecovery prefers per-request upstreamBaseUrl when provided', async () => {
  let seenUrl = null;
  const service = createService(async (url) => {
    seenUrl = String(url);
    return makeResponse(200, { ok: true });
  });

  await service.fetchWithAuthRecovery({
    requestId: 'req-3',
    upstreamRequest: { a: 1 },
    upstreamBaseUrl: 'https://override.example/base',
    upstreamToken: null,
    upstreamAuthMode: 'none',
    authRecoveryRetry: 0,
    timeoutMs: 1000,
    retryCount: 0,
    retryBaseMs: 1,
    shouldRecover: async () => false,
    clearManagedToken: () => {},
    refreshManagedToken: async () => null
  });

  assert.equal(seenUrl, 'https://override.example/base/v2/chats');
});

test('fetchWithAuthRecovery falls back to env-configured upstream base when override missing', async () => {
  let seenUrl = null;
  const service = createService(async (url) => {
    seenUrl = String(url);
    return makeResponse(200, { ok: true });
  });

  await service.fetchWithAuthRecovery({
    requestId: 'req-4',
    upstreamRequest: { a: 1 },
    upstreamToken: null,
    upstreamAuthMode: 'none',
    authRecoveryRetry: 0,
    timeoutMs: 1000,
    retryCount: 0,
    retryBaseMs: 1,
    shouldRecover: async () => false,
    clearManagedToken: () => {},
    refreshManagedToken: async () => null
  });

  assert.equal(seenUrl, 'https://upstream.example/v2/chats');
});

test('fetchWithAuthRecovery blocks DNS-resolved private addresses when UPSTREAM_BASE_ALLOW_PRIVATE=false', async () => {
  const saved = process.env.UPSTREAM_BASE_ALLOW_PRIVATE;
  process.env.UPSTREAM_BASE_ALLOW_PRIVATE = 'false';
  const service = createServiceWithHelpers(async () => makeResponse(200, { ok: true }), {
    resolveHostAddresses: async () => ['127.0.0.1']
  });

  try {
    await assert.rejects(
      () => service.fetchWithAuthRecovery({
        requestId: 'req-5',
        upstreamRequest: { a: 1 },
        upstreamBaseUrl: 'https://public.example',
        upstreamToken: null,
        upstreamAuthMode: 'none',
        authRecoveryRetry: 0,
        timeoutMs: 1000,
        retryCount: 0,
        retryBaseMs: 1,
        shouldRecover: async () => false,
        clearManagedToken: () => {},
        refreshManagedToken: async () => null
      }),
      /resolved DNS address is private or loopback/
    );
  } finally {
    process.env.UPSTREAM_BASE_ALLOW_PRIVATE = saved;
  }
});

test('fetchWithAuthRecovery allows dynamic upstream in managed mode only when UPSTREAM_TOKEN_URL configured', async () => {
  const savedTokenUrl = process.env.UPSTREAM_TOKEN_URL;
  const service = createService(async () => makeResponse(200, { ok: true }));

  try {
    process.env.UPSTREAM_TOKEN_URL = '';
    await assert.rejects(
      () => service.fetchWithAuthRecovery({
        requestId: 'req-6',
        upstreamRequest: { a: 1 },
        upstreamBaseUrl: 'https://override.example',
        upstreamToken: 't',
        upstreamAuthMode: 'managed',
        authRecoveryRetry: 0,
        timeoutMs: 1000,
        retryCount: 0,
        retryBaseMs: 1,
        shouldRecover: async () => false,
        clearManagedToken: () => {},
        refreshManagedToken: async () => 't2'
      }),
      /requires UPSTREAM_TOKEN_URL/
    );

    process.env.UPSTREAM_TOKEN_URL = 'https://token.example/v2/token';
    const out = await service.fetchWithAuthRecovery({
      requestId: 'req-7',
      upstreamRequest: { a: 1 },
      upstreamBaseUrl: 'https://override.example',
      upstreamToken: 't',
      upstreamAuthMode: 'managed',
      authRecoveryRetry: 0,
      timeoutMs: 1000,
      retryCount: 0,
      retryBaseMs: 1,
      shouldRecover: async () => false,
      clearManagedToken: () => {},
      refreshManagedToken: async () => 't2'
    });
    assert.equal(out.response.status, 200);
  } finally {
    process.env.UPSTREAM_TOKEN_URL = savedTokenUrl;
  }
});
