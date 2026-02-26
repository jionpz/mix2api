const { createClient } = require('redis');

function createSessionStoreService({
  config,
  helpers
}) {
  const {
    SESSION_STORE_MODE,
    REDIS_URL,
    REDIS_CONNECT_TIMEOUT_MS,
    REDIS_SESSION_PREFIX,
    SESSION_SCHEMA_VERSION,
    SESSION_TTL_MS
  } = config;

  const {
    redactSensitiveText,
    redactRedisUrl,
    fingerprint
  } = helpers;

  const sessionStore = new Map();
  let redisSessionClient = null;
  let redisSessionInitPromise = null;
  let redisSessionDisabledReason = null;
  let redisSessionNextRetryAt = 0;

  function getStoreHealth() {
    const redisExpected = shouldUseRedisSessionStore();
    const mode = redisExpected ? 'redis' : 'memory';
    const degraded = redisExpected && (!redisSessionClient || Boolean(redisSessionDisabledReason));
    return {
      mode,
      degraded,
      reason: redisSessionDisabledReason,
      connected: Boolean(redisSessionClient)
    };
  }

  function shouldUseRedisSessionStore() {
    if (SESSION_STORE_MODE === 'redis') return true;
    if (SESSION_STORE_MODE === 'auto') return Boolean(REDIS_URL);
    return false;
  }

  function redisSessionStoreKey(key) {
    const prefix = REDIS_SESSION_PREFIX.replace(/:+$/, '');
    return `${prefix}:${key}`;
  }

  function logSessionSchemaMiss(key, source, reason) {
    console.warn(`⚠ Session schema miss: key=${key} source=${source} reason=${reason}`);
  }

  function normalizeSessionRecord(rawValue, key, source) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      logSessionSchemaMiss(key, source, 'invalid_type');
      return null;
    }

    const schemaVersion = Number(rawValue.schemaVersion);
    if (schemaVersion !== SESSION_SCHEMA_VERSION) {
      logSessionSchemaMiss(key, source, `unsupported_schema_version:${String(rawValue.schemaVersion)}`);
      return null;
    }

    const sessionId = rawValue.sessionId ? String(rawValue.sessionId) : null;
    if (!sessionId) {
      logSessionSchemaMiss(key, source, 'missing_session_id');
      return null;
    }

    const timestamp = Number(rawValue.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      logSessionSchemaMiss(key, source, 'invalid_timestamp');
      return null;
    }

    const turnCountRaw = Number(rawValue.turnCount);
    const turnCount = Number.isFinite(turnCountRaw) && turnCountRaw > 0 ? Math.floor(turnCountRaw) : 1;
    const exchangeId = rawValue.exchangeId ? String(rawValue.exchangeId) : null;

    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      exchangeId,
      timestamp,
      turnCount
    };
  }

  async function initRedisSessionClient() {
    if (!shouldUseRedisSessionStore()) return null;
    if (redisSessionClient) return redisSessionClient;
    if (redisSessionDisabledReason && Date.now() < redisSessionNextRetryAt) return null;
    if (redisSessionDisabledReason && Date.now() >= redisSessionNextRetryAt) {
      redisSessionDisabledReason = null;
    }
    if (redisSessionInitPromise) return redisSessionInitPromise;

    redisSessionInitPromise = (async () => {
      if (!REDIS_URL) {
        redisSessionDisabledReason = 'missing REDIS_URL';
        redisSessionNextRetryAt = Number.POSITIVE_INFINITY;
        console.warn(`⚠ Redis session store disabled: ${redisSessionDisabledReason}, fallback to memory`);
        return null;
      }

      const client = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS
        }
      });
      client.on('error', (err) => {
        const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
        console.warn(`⚠ Redis session client error: ${safeMessage}`);
      });

      await client.connect();
      redisSessionClient = client;
      redisSessionDisabledReason = null;
      redisSessionNextRetryAt = 0;
      console.log(`✅ Redis session store connected: ${redactRedisUrl(REDIS_URL)}`);
      return redisSessionClient;
    })().catch((err) => {
      const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
      redisSessionDisabledReason = safeMessage || 'connect_failed';
      redisSessionNextRetryAt = Date.now() + 5000;
      console.warn(`⚠ Redis session store unavailable, fallback to memory: ${safeMessage}`);
      return null;
    }).finally(() => {
      redisSessionInitPromise = null;
    });

    return redisSessionInitPromise;
  }

  async function getStoredSession(key) {
    if (!key) return null;

    const redisClient = await initRedisSessionClient();
    if (redisClient) {
      const rKey = redisSessionStoreKey(key);
      try {
        const raw = await redisClient.get(rKey);
        if (raw == null) {
          sessionStore.delete(key);
          return null;
        }

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          logSessionSchemaMiss(key, 'redis', 'invalid_json');
          sessionStore.delete(key);
          await redisClient.del(rKey);
          return null;
        }

        const record = normalizeSessionRecord(parsed, key, 'redis');
        if (!record) {
          sessionStore.delete(key);
          await redisClient.del(rKey);
          return null;
        }

        if (Date.now() - record.timestamp > SESSION_TTL_MS) {
          sessionStore.delete(key);
          await redisClient.del(rKey);
          console.log(`⏰ Session expired for key=${key}`);
          return null;
        }

        sessionStore.set(key, record);
        return record;
      } catch (err) {
        const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
        console.warn(`⚠ Redis session read failed, fallback to memory: ${safeMessage}`);
        redisSessionClient = null;
        redisSessionDisabledReason = safeMessage || 'read_failed';
        redisSessionNextRetryAt = Date.now() + 1000;
      }
    }

    const entry = sessionStore.get(key);
    if (!entry) return null;
    const record = normalizeSessionRecord(entry, key, 'memory');
    if (!record) {
      sessionStore.delete(key);
      return null;
    }
    if (Date.now() - record.timestamp > SESSION_TTL_MS) {
      sessionStore.delete(key);
      console.log(`⏰ Session expired for key=${key}`);
      return null;
    }
    return record;
  }

  async function updateStoredSession(key, sessionId, exchangeId) {
    if (!key || !sessionId) return;
    const existing = await getStoredSession(key);
    const turnCount = existing && existing.sessionId === sessionId ? (existing.turnCount || 0) + 1 : 1;
    const nextExchangeId = exchangeId || ((existing && existing.sessionId === sessionId) ? existing.exchangeId : null);
    const record = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: String(sessionId),
      exchangeId: nextExchangeId || null,
      timestamp: Date.now(),
      turnCount
    };

    sessionStore.set(key, record);

    const redisClient = await initRedisSessionClient();
    if (redisClient) {
      const rKey = redisSessionStoreKey(key);
      try {
        await redisClient.set(rKey, JSON.stringify(record), { PX: SESSION_TTL_MS });
      } catch (err) {
        const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
        console.warn(`⚠ Redis session write failed (key=${key}): ${safeMessage}`);
        redisSessionClient = null;
        redisSessionDisabledReason = safeMessage || 'write_failed';
        redisSessionNextRetryAt = Date.now() + 1000;
      }
    }

    console.log(`📌 Session stored: key=${key}, session_fp=${fingerprint(sessionId)}, exchange_fp=${nextExchangeId ? fingerprint(nextExchangeId) : 'none'}, turnCount=${turnCount}`);
  }

  async function clearStoredSession(key) {
    if (!key) return;
    sessionStore.delete(key);
    const redisClient = await initRedisSessionClient();
    if (redisClient) {
      const rKey = redisSessionStoreKey(key);
      try {
        await redisClient.del(rKey);
      } catch (err) {
        const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
        console.warn(`⚠ Redis session clear failed (key=${key}): ${safeMessage}`);
        redisSessionClient = null;
        redisSessionDisabledReason = safeMessage || 'clear_failed';
        redisSessionNextRetryAt = Date.now() + 1000;
      }
    }
    console.log(`🗑 Session cleared: key=${key}`);
  }

  return {
    initRedisSessionClient,
    getStoredSession,
    updateStoredSession,
    clearStoredSession,
    getStoreHealth
  };
}

module.exports = {
  createSessionStoreService
};
