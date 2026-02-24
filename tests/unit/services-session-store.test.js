const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStoreService } = require('../../services/session-store');

test('session store memory mode supports set/get/clear with schema guard', async () => {
  const service = createSessionStoreService({
    config: {
      SESSION_STORE_MODE: 'memory',
      REDIS_URL: '',
      REDIS_CONNECT_TIMEOUT_MS: 100,
      REDIS_SESSION_PREFIX: 'mix2api:test',
      SESSION_SCHEMA_VERSION: 1,
      SESSION_TTL_MS: 1000
    },
    helpers: {
      redactSensitiveText: (s) => String(s || ''),
      redactRedisUrl: () => 'redis://***',
      fingerprint: () => 'fp'
    }
  });

  await service.updateStoredSession('k1', 's1', 'e1');
  const got = await service.getStoredSession('k1');
  assert.equal(got.sessionId, 's1');
  assert.equal(got.exchangeId, 'e1');
  assert.equal(got.schemaVersion, 1);

  await service.clearStoredSession('k1');
  const miss = await service.getStoredSession('k1');
  assert.equal(miss, null);
});
