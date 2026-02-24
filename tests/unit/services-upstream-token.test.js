const test = require('node:test');
const assert = require('node:assert/strict');

const { createManagedUpstreamTokenService } = require('../../services/upstream-token');

function makeJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
    clone() {
      return this;
    }
  };
}

function createService(fetchImpl) {
  return createManagedUpstreamTokenService({
    fetch: fetchImpl,
    httpAgent: {},
    httpsAgent: {},
    config: {
      UPSTREAM_API_BASE: 'https://upstream.example',
      UPSTREAM_TOKEN_URL: '',
      UPSTREAM_TOKEN_PATH: '/token',
      UPSTREAM_TOKEN_METHOD: 'POST',
      UPSTREAM_TOKEN_HEADERS_JSON: {},
      UPSTREAM_TOKEN_BODY_JSON: { grant_type: 'client_credentials' },
      UPSTREAM_TOKEN_FIELD: 'access_token',
      UPSTREAM_TOKEN_EXPIRES_IN_FIELD: 'expires_in',
      UPSTREAM_TOKEN_TIMEOUT_MS: 1000,
      UPSTREAM_TOKEN_EXPIRY_SKEW_MS: 10
    },
    helpers: {
      base64UrlToJson: () => null,
      redactSensitiveText: (s) => String(s || ''),
      fingerprint: () => 'fp',
      extractErrorFromUpstreamResponse: (obj) => obj && obj.error && obj.error.message
    }
  });
}

test('getManagedUpstreamToken fetches token and reuses cache', async () => {
  let calls = 0;
  const service = createService(async () => {
    calls++;
    return makeJsonResponse(200, { access_token: 'token-1', expires_in: 3600 });
  });

  const first = await service.getManagedUpstreamToken({ requestId: 'req-1', forceRefresh: false });
  const second = await service.getManagedUpstreamToken({ requestId: 'req-1', forceRefresh: false });

  assert.equal(first, 'token-1');
  assert.equal(second, 'token-1');
  assert.equal(calls, 1);
});

test('clearManagedUpstreamToken forces refresh next time', async () => {
  let calls = 0;
  const service = createService(async () => {
    calls++;
    return makeJsonResponse(200, { access_token: `token-${calls}`, expires_in: 3600 });
  });

  const first = await service.getManagedUpstreamToken({ requestId: 'req-1', forceRefresh: false });
  service.clearManagedUpstreamToken('test', 'req-1');
  const second = await service.getManagedUpstreamToken({ requestId: 'req-1', forceRefresh: false });

  assert.equal(first, 'token-1');
  assert.equal(second, 'token-2');
  assert.equal(calls, 2);
});

test('shouldRecoverManagedTokenFromResponse matches status and error message', async () => {
  const service = createService(async () => makeJsonResponse(200, { access_token: 't', expires_in: 1 }));

  assert.equal(await service.shouldRecoverManagedTokenFromResponse(makeJsonResponse(401, { error: { message: 'x' } })), true);
  assert.equal(await service.shouldRecoverManagedTokenFromResponse(makeJsonResponse(200, { error: { message: 'token expired' } })), true);
  assert.equal(await service.shouldRecoverManagedTokenFromResponse(makeJsonResponse(200, { error: { message: 'other' } })), false);
});
