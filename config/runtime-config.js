const { envInt, envBool, envJson } = require('./env');

function loadRuntimeConfig() {
  return {
    UPSTREAM_API_BASE: String(process.env.UPSTREAM_API_BASE || '').trim(),
    UPSTREAM_CHAT_PATH: String(process.env.UPSTREAM_CHAT_PATH || '/v2/chats').trim(),
    UPSTREAM_REFERER: String(process.env.UPSTREAM_REFERER || '').trim(),
    UPSTREAM_ACCEPT_LANGUAGE: String(process.env.UPSTREAM_ACCEPT_LANGUAGE || 'zh-CN,zh;q=0.9,en;q=0.8').trim(),
    PORT: process.env.PORT || 3001,
    DEFAULT_MODEL_IDS: ['mix/qwen-3-235b-instruct', 'mix/claude-sonnet-4-5'],
    MODEL_PROFILE_DEFAULT_CONTEXT_WINDOW: Math.max(1, envInt('MODEL_PROFILE_DEFAULT_CONTEXT_WINDOW', 200000)),
    MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS: Math.max(1, envInt('MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS', 160000)),
    MODEL_PROFILE_DEFAULT_MAX_NEW_TOKENS: Math.max(1, envInt('MODEL_PROFILE_DEFAULT_MAX_NEW_TOKENS', 8192)),
    MODEL_PROFILE_FALLBACK_WARN_CACHE_SIZE: Math.max(1, envInt('MODEL_PROFILE_FALLBACK_WARN_CACHE_SIZE', 1024)),
    TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS: Math.max(1, envInt('TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS', 1024)),
    MODEL_PROFILE_JSON: envJson('MODEL_PROFILE_JSON', {}),
    UPSTREAM_TOKEN_URL: String(process.env.UPSTREAM_TOKEN_URL || '').trim(),
    UPSTREAM_TOKEN_PATH: String(process.env.UPSTREAM_TOKEN_PATH || '/v2/token').trim(),
    UPSTREAM_TOKEN_METHOD: String(process.env.UPSTREAM_TOKEN_METHOD || 'POST').trim().toUpperCase(),
    UPSTREAM_TOKEN_HEADERS_JSON: envJson('UPSTREAM_TOKEN_HEADERS_JSON', {}),
    UPSTREAM_TOKEN_BODY_JSON: envJson('UPSTREAM_TOKEN_BODY_JSON', null),
    UPSTREAM_TOKEN_FIELD: String(process.env.UPSTREAM_TOKEN_FIELD || 'access_token').trim(),
    UPSTREAM_TOKEN_EXPIRES_IN_FIELD: String(process.env.UPSTREAM_TOKEN_EXPIRES_IN_FIELD || 'expires_in').trim(),
    UPSTREAM_TOKEN_TIMEOUT_MS: envInt('UPSTREAM_TOKEN_TIMEOUT_MS', 10000),
    UPSTREAM_TOKEN_EXPIRY_SKEW_MS: envInt('UPSTREAM_TOKEN_EXPIRY_SKEW_MS', 60_000),
    UPSTREAM_AUTH_RECOVERY_RETRY: envInt('UPSTREAM_AUTH_RECOVERY_RETRY', 1),
    SESSION_SCHEMA_VERSION: 1,
    SESSION_STORE_MODE: String(process.env.SESSION_STORE_MODE || 'auto').trim().toLowerCase(),
    REDIS_URL: String(process.env.REDIS_URL || '').trim(),
    REDIS_CONNECT_TIMEOUT_MS: envInt('REDIS_CONNECT_TIMEOUT_MS', 2000),
    REDIS_SESSION_PREFIX: String(process.env.REDIS_SESSION_PREFIX || 'mix2api:session').trim(),
    TRACE_SAMPLING_ENABLED: envBool('TRACE_SAMPLING_ENABLED', false),
    TRACE_SAMPLING_RATE: Math.max(0, Math.min(1, Number(process.env.TRACE_SAMPLING_RATE || 0))),
    TRACE_RETENTION_MS: Math.max(1, envInt('TRACE_RETENTION_MS', 24 * 60 * 60 * 1000)),
    TRACE_MAX_ENTRIES: Math.max(1, envInt('TRACE_MAX_ENTRIES', 1000)),
    TRACE_CLEANUP_INTERVAL_MS: Math.max(10, envInt('TRACE_CLEANUP_INTERVAL_MS', 60 * 1000)),
    SESSION_TTL_MS: envInt('SESSION_TTL_MS', 30 * 60 * 1000)
  };
}

module.exports = {
  loadRuntimeConfig
};
