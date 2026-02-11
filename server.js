// mix2api 上游适配器
// 将 OpenAI Chat Completions 请求转换为上游模型网站的请求格式

const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { createClient } = require('redis');

const app = express();
app.disable('x-powered-by');

function normalizeRequestId(value) {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  if (!id) return null;
  if (id.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

app.use((req, res, next) => {
  const headerValue = Array.isArray(req.headers['x-request-id'])
    ? req.headers['x-request-id'][0]
    : req.headers['x-request-id'];
  const requestId = normalizeRequestId(headerValue) || uuidv4();
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.locals.endReason = 'unknown';
  res.locals.upstreamStatus = null;
  res.locals.client = 'unknown';
  res.locals.stream = 'unknown';
  res.locals.toolsPresent = 'unknown';
  res.setHeader('x-request-id', requestId);
  next();
});

app.use(express.json({ limit: process.env.BODY_SIZE_LIMIT || '5mb' }));
app.use((err, req, res, next) => {
  if (!err) return next();

  if (err.type === 'entity.parse.failed') {
    return sendOpenAIError(res, 400, {
      message: 'Invalid JSON body',
      type: 'invalid_request_error',
      code: 'invalid_json',
      param: null
    });
  }
  if (err.type === 'entity.too.large') {
    return sendOpenAIError(res, 413, {
      message: 'Request body too large',
      type: 'invalid_request_error',
      code: 'request_too_large',
      param: null
    });
  }
  return next(err);
});

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function envJson(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  try {
    return JSON.parse(String(raw));
  } catch {
    console.warn(`⚠ Invalid JSON in ${name}, fallback to default value`);
    return fallback;
  }
}

function redactHeaders(headers) {
  const out = { ...headers };
  if (out.authorization) out.authorization = 'Bearer ***';
  if (out['proxy-authorization']) out['proxy-authorization'] = '***';
  return out;
}

function redactSensitiveText(text) {
  if (text === undefined || text === null) return '';
  let output = String(text);
  output = output.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, 'Bearer ***');
  output = output.replace(/("?(access_?token|refresh_?token|id_?token|token)"?\s*[:=]\s*")([^"]*)"/gi, '$1***"');
  output = output.replace(/\b(token=)[^&\s]+/gi, '$1***');
  return output;
}

function setRequestEndReason(res, reason) {
  if (!res || !res.locals || !reason) return;
  res.locals.endReason = String(reason);
}

function setRequestUpstreamStatus(res, status) {
  if (!res || !res.locals) return;
  if (status === undefined || status === null || status === '') return;
  res.locals.upstreamStatus = Number.isFinite(Number(status)) ? Number(status) : String(status);
}

function base64UrlToJson(b64url) {
  try {
    let s = String(b64url || '');
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    // pad
    while (s.length % 4 !== 0) s += '=';
    const buf = Buffer.from(s, 'base64');
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  // OpenAI 新版可能是多段内容数组：[{type:'text', text:'...'}]
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return '';
      })
      .join('')
      .trim();
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

// 请求日志中间件
app.use((req, res, next) => {
  const logHeaders = envBool('LOG_HEADERS', false);
  const requestId = req.requestId || String(res.getHeader('x-request-id') || uuidv4());
  const startedAt = Date.now();
  console.log(`[${new Date().toISOString()}] [${requestId}] request.received method=${req.method} path=${req.url}`);
  if (logHeaders) {
    console.log(`[${new Date().toISOString()}] [${requestId}] headers=${JSON.stringify(redactHeaders(req.headers), null, 2)}`);
  }
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const endReason = res.locals && res.locals.endReason ? res.locals.endReason : 'unknown';
    const upstreamStatus = res.locals && res.locals.upstreamStatus != null ? res.locals.upstreamStatus : 'none';
    const client = res.locals && res.locals.client != null ? res.locals.client : 'unknown';
    const stream = res.locals && res.locals.stream != null ? res.locals.stream : 'unknown';
    const toolsPresent = res.locals && res.locals.toolsPresent != null ? res.locals.toolsPresent : 'unknown';
    console.log(`[${new Date().toISOString()}] [${requestId}] request.completed http_status=${res.statusCode} duration_ms=${durationMs} client=${client} stream=${stream} tools_present=${toolsPresent} end_reason=${endReason} upstream_status=${upstreamStatus}`);
  });
  next();
});

// 配置
const UPSTREAM_API_BASE = String(process.env.UPSTREAM_API_BASE || '').trim(); // e.g. https://your-upstream.example
const UPSTREAM_CHAT_PATH = String(process.env.UPSTREAM_CHAT_PATH || '/v2/chats').trim(); // e.g. /v1/chat/completions
const UPSTREAM_REFERER = String(process.env.UPSTREAM_REFERER || '').trim();
const UPSTREAM_ACCEPT_LANGUAGE = String(process.env.UPSTREAM_ACCEPT_LANGUAGE || 'zh-CN,zh;q=0.9,en;q=0.8').trim();
const PORT = process.env.PORT || 3001;
const DEFAULT_MODEL_IDS = ['mix/qwen-3-235b-instruct', 'mix/claude-sonnet-4-5'];
const UPSTREAM_TOKEN_URL = String(process.env.UPSTREAM_TOKEN_URL || '').trim();
const UPSTREAM_TOKEN_PATH = String(process.env.UPSTREAM_TOKEN_PATH || '/v2/token').trim();
const UPSTREAM_TOKEN_METHOD = String(process.env.UPSTREAM_TOKEN_METHOD || 'POST').trim().toUpperCase();
const UPSTREAM_TOKEN_HEADERS_JSON = envJson('UPSTREAM_TOKEN_HEADERS_JSON', {});
const UPSTREAM_TOKEN_BODY_JSON = envJson('UPSTREAM_TOKEN_BODY_JSON', null);
const UPSTREAM_TOKEN_FIELD = String(process.env.UPSTREAM_TOKEN_FIELD || 'access_token').trim();
const UPSTREAM_TOKEN_EXPIRES_IN_FIELD = String(process.env.UPSTREAM_TOKEN_EXPIRES_IN_FIELD || 'expires_in').trim();
const UPSTREAM_TOKEN_TIMEOUT_MS = envInt('UPSTREAM_TOKEN_TIMEOUT_MS', 10000);
const UPSTREAM_TOKEN_EXPIRY_SKEW_MS = envInt('UPSTREAM_TOKEN_EXPIRY_SKEW_MS', 60_000);
const UPSTREAM_AUTH_RECOVERY_RETRY = envInt('UPSTREAM_AUTH_RECOVERY_RETRY', 1);
const SESSION_SCHEMA_VERSION = 1;
const SESSION_STORE_MODE = String(process.env.SESSION_STORE_MODE || 'redis').trim().toLowerCase(); // redis | auto | memory
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const REDIS_CONNECT_TIMEOUT_MS = envInt('REDIS_CONNECT_TIMEOUT_MS', 2000);
const REDIS_SESSION_PREFIX = String(process.env.REDIS_SESSION_PREFIX || 'mix2api:session').trim();

// ===== Session Store =====
// 上游会话管理：
// - 首次请求无 sessionId，响应 START 帧返回 sessionId
// - 后续请求在顶层带 sessionId = 上次响应的 sessionId
// - OpenCode 不原生支持 session 透传，因此适配器自动管理
const SESSION_TTL_MS = envInt('SESSION_TTL_MS', 30 * 60 * 1000); // 默认 30 分钟
const sessionStore = new Map(); // key -> { schemaVersion, sessionId, exchangeId, timestamp, turnCount }
let redisSessionClient = null;
let redisSessionInitPromise = null;
let redisSessionDisabledReason = null;
let redisSessionNextRetryAt = 0;

function shouldUseRedisSessionStore() {
  return SESSION_STORE_MODE === 'redis' || SESSION_STORE_MODE === 'auto';
}

function redisSessionStoreKey(key) {
  const prefix = REDIS_SESSION_PREFIX.replace(/:+$/, '');
  return `${prefix}:${key}`;
}

function redactRedisUrl(url) {
  try {
    const u = new URL(url);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'redis://***';
  }
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

  console.log(`📌 Session stored: key=${key}, sessionId=${sessionId}, exchangeId=${nextExchangeId || 'null'}, turnCount=${turnCount}`);
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

function fingerprint(input) {
  if (input === undefined || input === null) return 'none';
  const s = String(input);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

const managedUpstreamTokenState = {
  token: null,
  expiresAt: 0,
  refreshPromise: null
};

function resolveUpstreamTokenEndpoint() {
  if (UPSTREAM_TOKEN_URL) return UPSTREAM_TOKEN_URL;
  if (!UPSTREAM_API_BASE) return '';
  const base = UPSTREAM_API_BASE.replace(/\/+$/, '');
  const path = UPSTREAM_TOKEN_PATH ? `/${UPSTREAM_TOKEN_PATH.replace(/^\/+/, '')}` : '';
  return `${base}${path}`;
}

function resolveTokenExpireAtMs(token, payload) {
  if (payload && payload[UPSTREAM_TOKEN_EXPIRES_IN_FIELD] !== undefined) {
    const raw = Number(payload[UPSTREAM_TOKEN_EXPIRES_IN_FIELD]);
    if (Number.isFinite(raw) && raw > 0) {
      return Date.now() + (raw * 1000);
    }
  }
  if (payload && payload.expires_in !== undefined) {
    const raw = Number(payload.expires_in);
    if (Number.isFinite(raw) && raw > 0) {
      return Date.now() + (raw * 1000);
    }
  }
  if (payload && payload.expiresAt !== undefined) {
    const raw = Number(payload.expiresAt);
    if (Number.isFinite(raw) && raw > Date.now()) {
      return raw;
    }
  }
  if (payload && payload.exp !== undefined) {
    const raw = Number(payload.exp);
    if (Number.isFinite(raw) && raw > 0) {
      return raw * 1000;
    }
  }
  const parts = String(token || '').split('.');
  if (parts.length === 3) {
    const jwtPayload = base64UrlToJson(parts[1]);
    if (jwtPayload && Number.isFinite(Number(jwtPayload.exp))) {
      return Number(jwtPayload.exp) * 1000;
    }
  }
  return 0;
}

function isManagedTokenUsable() {
  const token = managedUpstreamTokenState.token;
  const expiresAt = managedUpstreamTokenState.expiresAt;
  if (!token) return false;
  if (!expiresAt || expiresAt <= 0) return true;
  return (Date.now() + UPSTREAM_TOKEN_EXPIRY_SKEW_MS) < expiresAt;
}

function clearManagedUpstreamToken(reason, requestId) {
  if (!managedUpstreamTokenState.token) return;
  const fp = fingerprint(managedUpstreamTokenState.token);
  managedUpstreamTokenState.token = null;
  managedUpstreamTokenState.expiresAt = 0;
  console.warn(`[${requestId}] 🔁 Clear managed upstream token (reason=${reason}, fp=${fp})`);
}

async function requestManagedUpstreamToken(requestId) {
  const endpoint = resolveUpstreamTokenEndpoint();
  if (!endpoint) {
    throw new Error('Invalid server config: managed upstream auth requires UPSTREAM_TOKEN_URL or UPSTREAM_TOKEN_PATH');
  }

  const method = UPSTREAM_TOKEN_METHOD || 'POST';
  const extraHeaders = (
    UPSTREAM_TOKEN_HEADERS_JSON
    && typeof UPSTREAM_TOKEN_HEADERS_JSON === 'object'
    && !Array.isArray(UPSTREAM_TOKEN_HEADERS_JSON)
  ) ? UPSTREAM_TOKEN_HEADERS_JSON : {};
  const headers = {
    accept: 'application/json',
    ...extraHeaders
  };
  let body;
  if (UPSTREAM_TOKEN_BODY_JSON !== null && UPSTREAM_TOKEN_BODY_JSON !== undefined) {
    if (typeof UPSTREAM_TOKEN_BODY_JSON === 'string') {
      body = UPSTREAM_TOKEN_BODY_JSON;
    } else {
      body = JSON.stringify(UPSTREAM_TOKEN_BODY_JSON);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    }
  }

  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), UPSTREAM_TOKEN_TIMEOUT_MS) : null;
  try {
    const { httpAgent, httpsAgent } = UPSTREAM_AGENTS;
    const response = await fetch(endpoint, {
      method,
      headers,
      body,
      agent: (parsedUrl) => (parsedUrl && parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent),
      signal: controller ? controller.signal : undefined
    });

    if (!response.ok) {
      const errorText = await response.text();
      const safeError = redactSensitiveText(errorText).slice(0, 300);
      throw new Error(`Upstream token request failed: ${response.status} ${response.statusText || ''} ${safeError}`.trim());
    }

    let payload = null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    }

    const token = payload && (
      payload[UPSTREAM_TOKEN_FIELD]
      || payload.access_token
      || payload.token
      || payload.id_token
    );
    if (!token || typeof token !== 'string') {
      throw new Error(`Upstream token response missing token field: ${UPSTREAM_TOKEN_FIELD}`);
    }

    const expiresAt = resolveTokenExpireAtMs(token, payload);
    managedUpstreamTokenState.token = token;
    managedUpstreamTokenState.expiresAt = expiresAt;
    const expiresAtText = expiresAt > 0 ? new Date(expiresAt).toISOString() : 'unknown';
    console.log(`[${requestId}] 🔐 Managed upstream token refreshed (fp=${fingerprint(token)}, expiresAt=${expiresAtText})`);
    return token;
  } catch (err) {
    const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
    throw new Error(`Managed upstream token fetch failed: ${safeMessage}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function getManagedUpstreamToken({ requestId, forceRefresh = false }) {
  if (!forceRefresh && isManagedTokenUsable()) {
    return managedUpstreamTokenState.token;
  }

  if (!forceRefresh && managedUpstreamTokenState.refreshPromise) {
    return managedUpstreamTokenState.refreshPromise;
  }

  const refreshPromise = requestManagedUpstreamToken(requestId);
  managedUpstreamTokenState.refreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (managedUpstreamTokenState.refreshPromise === refreshPromise) {
      managedUpstreamTokenState.refreshPromise = null;
    }
  }
}

function isLikelyTokenInvalidMessage(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('token expired')
    || lower.includes('token invalid')
    || lower.includes('invalid token')
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
    || lower.includes('authentication failed')
    || lower.includes('jwt expired')
  );
}

async function shouldRecoverManagedTokenFromResponse(response) {
  if (!response) return false;
  if (response.status === 401 || response.status === 403) return true;

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return false;

  try {
    const payload = await response.clone().json();
    const upstreamError = extractErrorFromUpstreamResponse(payload);
    return isLikelyTokenInvalidMessage(upstreamError);
  } catch {
    return false;
  }
}

function sanitizeKeyPart(value, fallback = 'unknown') {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return fallback;
  const normalized = s.replace(/[^a-z0-9._:-]/g, '_').slice(0, 80);
  return normalized || fallback;
}

function inferClientId(req) {
  const headers = (req && req.headers) || {};
  const explicitClient = headers['x-client'] || headers['x-client-id'] || headers['x-client_name'];
  if (explicitClient) return sanitizeKeyPart(explicitClient, 'unknown');

  const ua = String(headers['user-agent'] || '').toLowerCase();
  if (ua.includes('opencode')) return 'opencode';
  if (ua.includes('claude code') || ua.includes('claude-code') || ua.includes('claudecode')) return 'claude-code';
  return 'unknown';
}

function getSessionStoreKey(req, model, token) {
  const headerName = String(process.env.SESSION_KEY_HEADER || 'x-session-key').toLowerCase();
  const headerVal = req && req.headers ? req.headers[headerName] : null;
  const modelPart = sanitizeKeyPart(model || '_default', '_default');
  if (headerVal) return `${sanitizeKeyPart(headerVal, 'session')}::${modelPart}`;

  const mode = String(process.env.SESSION_KEY_MODE || 'auth_model_client').toLowerCase();
  const authPart = fingerprint(token);
  const clientPart = inferClientId(req);

  if (mode === 'model') return modelPart;
  if (mode === 'auth' || mode === 'auth_model') return `${authPart}::${modelPart}`;
  return `${authPart}::${modelPart}::${clientPart}`;
}

function parseModelList(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  let modelCandidates = [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        modelCandidates = parsed;
      }
    } catch {
      modelCandidates = [];
    }
  }

  if (modelCandidates.length === 0) {
    modelCandidates = raw.split(/[\n,]/);
  }

  const result = [];
  const seen = new Set();
  for (const value of modelCandidates) {
    const id = String(value || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function resolveModelIds() {
  const models = parseModelList(process.env.MODEL_LIST);
  return models.length > 0 ? models : DEFAULT_MODEL_IDS;
}

// 从上游 SSE START 帧中提取 exchangeId 和 sessionId
// 参考实际响应格式：
// {"type":"start","messageMetadata":{"sessionId":"48d73bfd-...","exchangeId":"8e42f4e2-..."},"messageId":"8e42f4e2-..."}
// 后续请求的 sessionId 应使用 messageMetadata.sessionId，exchangeId 用于其他用途
function extractIdsFromUpstream(upstreamData) {
  if (!upstreamData || typeof upstreamData !== 'object') return null;
  const md = upstreamData.messageMetadata || upstreamData.metadata || null;
  const exchangeId = (
    (md && (md.exchangeId || md.exchange_id))
    || upstreamData.messageId
    || upstreamData.message_id
    || null
  );
  const sessionId = (
    (md && (md.sessionId || md.session_id))
    || null
  );
  if (!exchangeId && !sessionId) return null;
  return { exchangeId, sessionId };
}

function buildToolInstruction(tools, forceToolCall) {
  // 上游通常已经收到 tools schema（如果你选择透传 tools），这里的指令仅用于“提醒模型按协议输出”。
  // 为降低 token 压力，只在提示中保留 name/description/参数键名摘要。
  const simplifiedTools = (tools || []).map((tool) => {
    const fn = tool.function || tool;
    const params = fn.parameters || {};
    const props = (params && params.properties && typeof params.properties === 'object') ? Object.keys(params.properties) : [];
    return {
      name: fn.name,
      description: (fn.description || '').slice(0, envInt('TOOL_DESC_MAX_CHARS', 500)),
      parameters_keys: props.slice(0, 30),
      required: Array.isArray(params.required) ? params.required.slice(0, 30) : []
    };
  });

  const requirement = forceToolCall
    ? '必须选择并调用一个最合适的工具，禁止直接回答。'
    : '优先使用工具来完成任务（特别是文件读写、编辑、代码执行等操作）；只有确实不需要工具时才直接回答。';

  return [
    requirement,
    '你可以使用以下工具。需要调用工具时，请严格输出 JSON（不要加解释）：',
    '{"tool_call":{"name":"<tool_name>","arguments":{...}}}',
    '如果不需要工具，请输出：',
    '{"final":"<你的回答>"}',
    '工具列表（JSON）：',
    JSON.stringify(simplifiedTools)
  ].join('\n');
}

function truncateTextKeepTail(text, maxChars, marker) {
  if (typeof text !== 'string') return '';
  if (!maxChars || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  const m = marker || '[已截断]';
  const keep = Math.max(0, maxChars - m.length - 1);
  return `${m}\n${text.slice(text.length - keep)}`;
}

function trimMessagesForUpstream(messages) {
  // 限制发送给上游的 messages 数量与单条长度，避免触发 token 上限。
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const maxCount = envInt('UPSTREAM_MESSAGES_MAX', 20);
  const perMsgMaxChars = envInt('UPSTREAM_MESSAGE_MAX_CHARS', 8000);

  const system = messages.find((m) => m && m.role === 'system') || null;
  const nonSystem = messages.filter((m) => m && m.role !== 'system');
  const tail = maxCount > 0 ? nonSystem.slice(-maxCount) : nonSystem;
  const trimmedTail = tail.map((m) => {
    const cloned = { ...m };
    if (cloned && cloned.content != null) {
      const t = extractMessageText(cloned.content);
      cloned.content = (perMsgMaxChars > 0) ? truncateTextKeepTail(t, perMsgMaxChars, '[消息内容已截断]') : t;
    }
    return cloned;
  });
  return system ? [system, ...trimmedTail] : trimmedTail;
}

function reduceTools(tools, maxCount, descMaxChars, messages) {
  // 重要：OpenCode/类似客户端可能一次性传入很多工具（例如 30+）。
  // 如果我们仅截取前 N 个，可能把“write/edit/apply_patch”等关键工具裁掉，导致模型只能“口头说要改文件”却无法真正调用工具。
  if (!Array.isArray(tools) || tools.length === 0) return [];

  // 兼容：部分网关/客户端会塞入非 OpenAI Function 工具（例如 type="mcp" 的描述符）。
  // 当前适配器只支持 OpenAI Function 工具；其他类型先忽略，避免污染提示词与工具选择。
  const supportedTools = tools.filter((tool) => {
    if (!tool) return false;
    if (tool.type && tool.type !== 'function') {
      if (envBool('LOG_TOOL_SELECTION', false)) {
        console.warn(`⚠ Ignoring non-function tool type=${tool.type}`);
      }
      return false;
    }
    const fn = tool.function || tool;
    if (!fn || !fn.name) {
      if (envBool('LOG_TOOL_SELECTION', false)) {
        console.warn('⚠ Ignoring tool without name');
      }
      return false;
    }
    return true;
  });
  if (supportedTools.length === 0) return [];

  // TOOL_KEEP_ALL=1 时不裁剪，完整透传全部工具（仍会裁剪 description/parameters 以控 token）
  const keepAll = envBool('TOOL_KEEP_ALL', false);
  if (!keepAll && (!maxCount || maxCount <= 0)) return [];

  const toolNameOf = (tool) => {
    const fn = tool && (tool.function || tool);
    return (fn && fn.name) ? String(fn.name) : '';
  };

  const detectFileIntent = (text) => {
    if (typeof text !== 'string' || !text) return false;
    // 中英混合关键词：覆盖“编辑/修改/写入/创建文件/补丁”等典型本地文件操作诉求
    return /(编辑|修改|更新|写入|保存|创建|删除|重命名|补丁|文件|本地|apply[_-]?patch|patch|diff|edit|write|save|create|delete|rename|file)/i.test(text);
  };

  const extractLastUserText = (msgs) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'user') {
        return extractMessageText(m.content);
      }
    }
    return '';
  };

  // 不裁剪时：保留原始顺序，避免意外的工具排序副作用
  if (keepAll || maxCount >= supportedTools.length) {
    return supportedTools.map((tool) => {
      const fn = tool.function || tool;
      const description = (fn.description || '').slice(0, descMaxChars);
      return {
        ...tool,
        type: tool.type || 'function',
        function: {
          ...fn,
          name: fn.name,
          description,
          parameters: fn.parameters || {}
        }
      };
    });
  }

  const hintText = extractLastUserText(messages);
  const fileIntent = detectFileIntent(hintText);

  const scoreTool = (name, index) => {
    const n = String(name || '').toLowerCase();
    let score = 0;

    // 保底：越靠前的工具轻微加分（保持一定稳定性）
    score += Math.max(0, 50 - index);

    // 通用高频工具
    if (/(read|glob|grep|search|list|dir|ls)/.test(n)) score += 150;

    // 文件编辑意图：强烈偏向“读写编辑相关工具”
    if (fileIntent) {
      if (/(apply_patch|patch|diff)/.test(n)) score += 1200;
      if (/(edit|write|create|update|save)/.test(n)) score += 1000;
      if (/(file|path)/.test(n)) score += 700;
      if (/(read|glob|grep|search|list|dir|ls)/.test(n)) score += 600;
    }

    return score;
  };

  const ranked = supportedTools
    .map((tool, index) => {
      const name = toolNameOf(tool);
      return { tool, index, name, score: scoreTool(name, index) };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const selected = ranked.slice(0, maxCount).map((x) => x.tool);

  // 统一裁剪 description（保留完整 parameters 结构），降低 token 压力
  return selected.map((tool) => {
    const fn = tool.function || tool;
    const description = (fn.description || '').slice(0, descMaxChars);
    return {
      ...tool,
      type: tool.type || 'function',
      function: {
        ...fn,
        name: fn.name,
        description,
        parameters: fn.parameters || {}
      }
    };
  });
}

function trimSystemMessages(messages, maxChars) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const systemMessages = messages.filter((msg) => msg.role === 'system');
  if (systemMessages.length === 0) return messages;

  const firstSystem = systemMessages[0];
  // content 可能是 string 或 OpenAI 新版的多段数组；统一转成纯文本再截断
  const systemText = extractMessageText(firstSystem && firstSystem.content);
  const trimmedContent = systemText.length > maxChars
    ? `${systemText.slice(0, maxChars)}\n[系统提示已截断]`
    : systemText;

  const nonSystem = messages.filter((msg) => msg.role !== 'system');
  return [{ role: 'system', content: trimmedContent }, ...nonSystem];
}

function injectToolInstruction(messages, tools, forceToolCall) {
  if (!tools || tools.length === 0) return messages;
  const instruction = buildToolInstruction(tools, forceToolCall);
  if (messages.length > 0 && messages[0].role === 'system') {
    const existing = extractMessageText(messages[0].content);
    return [{
      role: 'system',
      content: existing ? `${existing}\n\n${instruction}` : instruction
    }, ...messages.slice(1)];
  }
  return [{ role: 'system', content: instruction }, ...messages];
}

function normalizeModelSlug(model) {
  if (!model) return 'qwen-3-235b-instruct';
  const raw = model.includes('/') ? model.split('/').pop() : model;
  const aliasMap = {
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'grok-4-1-fast': 'grok-4-1-fast'
  };
  return aliasMap[raw] || raw;
}

function findLastMessageByRole(messages, role) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === role) return m;
  }
  return null;
}

function collectTrailingToolMessages(messages) {
  // 收集消息末尾连续出现的 tool 消息（OpenAI 工具调用第二轮通常是 ... assistant(tool_calls) -> tool -> tool -> ...）
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'tool') {
      out.push(m);
      continue;
    }
    break;
  }
  return out.reverse();
}

function formatToolResultsForPrompt(toolMessages) {
  if (!Array.isArray(toolMessages) || toolMessages.length === 0) return '';
  const maxChars = envInt('TOOL_RESULT_MAX_CHARS', 20_000);
  const lines = [];
  for (const m of toolMessages) {
    const name = m.name || 'tool';
    const toolCallId = m.tool_call_id || '';
    let content = extractMessageText(m.content);
    if (maxChars > 0 && content.length > maxChars) {
      content = `${content.slice(0, maxChars)}\n[工具输出已截断]`;
    }
    const header = toolCallId ? `- 工具 ${name}（tool_call_id=${toolCallId}）输出：` : `- 工具 ${name} 输出：`;
    lines.push(header);
    lines.push(content);
  }
  return lines.join('\n');
}

function groupToolCallChains(messages) {
  // 将消息分组：识别完整的 [user → assistant(tool_calls) → tool...] 链
  const groups = [];
  let current = [];
  
  for (const m of messages) {
    if (m.role === 'user') {
      // 新的 user 消息开启新组
      if (current.length > 0) {
        groups.push({ messages: current, hasTools: current.some(x => x.role === 'tool') });
      }
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length > 0) {
    groups.push({ messages: current, hasTools: current.some(x => x.role === 'tool') });
  }
  return groups;
}

function selectImportantGroups(groups, maxTurns) {
  // 智能选择：优先保留工具调用链 + 最近对话
  if (groups.length <= maxTurns) return groups;
  
  const result = [];
  const toolGroups = groups.filter(g => g.hasTools);
  const recentGroups = groups.slice(-Math.ceil(maxTurns * 0.6)); // 最近 60% 必保留
  
  // 合并去重：工具组（最多保留最近3个）+ 最近组
  const toolGroupsToKeep = toolGroups.slice(-3);
  const combined = new Map();
  for (const g of [...toolGroupsToKeep, ...recentGroups]) {
    const key = g.messages[0] ? JSON.stringify(g.messages[0]) : Math.random();
    combined.set(key, g);
  }
  
  const selected = Array.from(combined.values());
  // 按原始顺序排序并限制数量
  return selected
    .sort((a, b) => groups.indexOf(a) - groups.indexOf(b))
    .slice(-maxTurns);
}

function formatConversationForQuery(messages) {
  // 兼容上游忽略 messages 的情况：将最近对话历史压缩拼进 query
  // 仅保留 user/assistant/tool，忽略 system（system 会单独通过 messages/instruction 注入）
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const maxTurns = envInt('CONTEXT_MAX_TURNS', 15); // Claude Sonnet 4.5 支持 200K token 上下文
  const maxChars = envInt('CONTEXT_MAX_CHARS', 20_000);
  const smartCompress = envBool('CONTEXT_SMART_COMPRESS', true);
  const preserveToolChains = envBool('CONTEXT_PRESERVE_TOOL_CHAINS', true);

  const filtered = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'));
  let tail = [];

  // 智能压缩：识别并完整保留工具调用链
  if (smartCompress && preserveToolChains && filtered.length > maxTurns) {
    const groups = groupToolCallChains(filtered);
    const selectedGroups = selectImportantGroups(groups, maxTurns);
    tail = selectedGroups.flatMap(g => g.messages);
  } else {
    tail = maxTurns > 0 ? filtered.slice(-maxTurns) : filtered;
  }

  const lines = [];
  for (const m of tail) {
    if (m.role === 'user') {
      const t = extractMessageText(m.content);
      if (t) {
        const userMax = envInt('CONTEXT_USER_MAX_CHARS', 5000);
        const truncated = userMax > 0 && t.length > userMax ? `${t.slice(0, userMax)}...` : t;
        lines.push(`User: ${truncated}`);
      }
      continue;
    }
    if (m.role === 'assistant') {
      // assistant 可能 content=null（tool_calls），尽量用简短信息表示
      const t = extractMessageText(m.content);
      if (t) {
        const asstMax = envInt('CONTEXT_ASST_MAX_CHARS', 3000);
        const truncated = asstMax > 0 && t.length > asstMax ? `${t.slice(0, asstMax)}...` : t;
        lines.push(`Assistant: ${truncated}`);
      } else if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const names = m.tool_calls.map((c) => (c && c.function && c.function.name) ? c.function.name : (c && c.name) ? c.name : 'tool').slice(0, 5);
        lines.push(`Assistant: [调用工具: ${names.join(', ')}]`);
      }
      continue;
    }
    if (m.role === 'tool') {
      const name = m.name || 'tool';
      let t = extractMessageText(m.content);
      if (t) {
        const perToolMax = envInt('TOOL_RESULT_MAX_CHARS', 20_000);
        if (perToolMax > 0 && t.length > perToolMax) {
          t = `${t.slice(0, perToolMax)}\n[工具输出已截断]`;
        }
        lines.push(`Tool(${name}): ${t}`);
      }
    }
  }

  let out = lines.join('\n');
  
  // 智能截断：如果超长，尝试保留完整的最近几轮而非简单切尾部
  if (maxChars > 0 && out.length > maxChars) {
    const reverseLines = [...lines].reverse();
    const kept = [];
    let currentLen = 0;
    const marker = '[对话历史已截断，仅保留最近关键上下文]\n';
    const budget = maxChars - marker.length;
    
    for (const line of reverseLines) {
      if (currentLen + line.length + 1 <= budget) {
        kept.unshift(line);
        currentLen += line.length + 1;
      } else {
        break;
      }
    }
    
    out = kept.length > 0 ? marker + kept.join('\n') : `${out.slice(out.length - maxChars)}\n[对话历史已截断]`;
  }
  
  return out;
}

function normalizeLegacyFunctionsToTools(functions) {
  if (!Array.isArray(functions) || functions.length === 0) return [];
  return functions
    .filter((fn) => fn && typeof fn === 'object')
    .map((fn) => {
      const name = typeof fn.name === 'string' ? fn.name.trim() : '';
      if (!name) return null;
      return {
        type: 'function',
        function: {
          ...fn,
          name
        }
      };
    })
    .filter(Boolean);
}

function normalizeLegacyFunctionCallToToolChoice(functionCall) {
  if (functionCall == null) return undefined;
  if (typeof functionCall === 'string') {
    const mode = functionCall.trim().toLowerCase();
    if (mode === 'auto' || mode === 'none' || mode === 'required') return mode;
    return undefined;
  }
  if (typeof functionCall === 'object') {
    const name = typeof functionCall.name === 'string' ? functionCall.name.trim() : '';
    if (!name) return undefined;
    return {
      type: 'function',
      function: { name }
    };
  }
  return undefined;
}

function normalizeOpenAIRequestTooling(input) {
  if (!input || typeof input !== 'object') return input;
  const normalized = { ...input };

  let normalizedTools = [];
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    normalizedTools = input.tools
      .filter((tool) => tool && typeof tool === 'object')
      .map((tool) => {
        if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
          const fnName = typeof tool.function.name === 'string' ? tool.function.name.trim() : tool.function.name;
          return {
            ...tool,
            function: {
              ...tool.function,
              ...(typeof fnName === 'string' ? { name: fnName } : {})
            }
          };
        }
        if (typeof tool.name === 'string' && tool.name.trim()) {
          return {
            type: 'function',
            function: {
              ...tool,
              name: tool.name.trim()
            }
          };
        }
        return { ...tool };
      });
  } else if (Array.isArray(input.functions) && input.functions.length > 0) {
    normalizedTools = normalizeLegacyFunctionsToTools(input.functions);
  }

  if (normalizedTools.length > 0) {
    normalized.tools = normalizedTools;
  }

  if (normalized.tool_choice == null) {
    const mappedToolChoice = normalizeLegacyFunctionCallToToolChoice(input.function_call);
    if (mappedToolChoice !== undefined) {
      normalized.tool_choice = mappedToolChoice;
    }
  }

  return normalized;
}

// OpenAI 格式转上游格式 (完整传递，支持工具调用)
function convertToUpstreamFormat(openaiRequest, sessionId, exchangeId, personaId, storedSession) {
  const lastMessage = openaiRequest.messages[openaiRequest.messages.length - 1];
  const rawTools = Array.isArray(openaiRequest.tools) ? openaiRequest.tools : [];
  
  // 工具策略：
  // - 对客户端：只要请求里带 tools，就进入 toolMode（保证“工具调用闭环”稳定）
  // - 对上游：默认不透传 tools（避免上游误以为要执行工具）；如需透传，建议仅在新会话/定期刷新时发送
  const isNewSession = !sessionId || sessionId === 'new';
  const turnCount = storedSession ? storedSession.turnCount || 0 : 0;
  const hasToolsInRequest = rawTools.length > 0;
  
  const toolMaxCount = Number(process.env.TOOL_MAX_COUNT || 15);
  const toolDescMaxChars = Number(process.env.TOOL_DESC_MAX_CHARS || 200);
  const tools = hasToolsInRequest ? reduceTools(rawTools, toolMaxCount, toolDescMaxChars, openaiRequest.messages) : [];
  const toolMode = tools.length > 0;
  const sendUpstreamTools = envBool('SEND_UPSTREAM_TOOLS', false);
  const shouldSendUpstreamTools = sendUpstreamTools && (isNewSession || (turnCount > 0 && turnCount % 20 === 0));
  
  if (shouldSendUpstreamTools && !isNewSession) {
    console.log(`🔄 Refreshing upstream tools at turn ${turnCount}`);
  }
  if (hasToolsInRequest && rawTools.length > tools.length) {
    console.log(`⚠ Tools trimmed: ${rawTools.length} -> ${tools.length}`);
  }
  if (hasToolsInRequest && envBool('LOG_TOOL_SELECTION', false)) {
    const toolNameOf = (tool) => {
      const fn = tool && (tool.function || tool);
      return (fn && fn.name) ? String(fn.name) : '';
    };
    const selectedNames = tools.map(toolNameOf).filter(Boolean);
    console.log(`🧰 Selected tools (${selectedNames.length}/${rawTools.length}): ${selectedNames.join(', ')}`);
  }
  const trailingToolMessages = collectTrailingToolMessages(openaiRequest.messages);
  const hasToolResults = trailingToolMessages.length > 0;

  // 注意：当本轮是“工具已执行完成 → 请求模型总结/回答”时，不要强制再次调用工具
  const forceToolCall = !hasToolResults && (openaiRequest.tool_choice === 'required' || process.env.FORCE_TOOL_CALL === '1');
  const toolInstruction = toolMode ? buildToolInstruction(tools, forceToolCall) : '';

  // OpenAI 工具调用闭环：如果最后一条是 tool，则 query 应该基于最后一个 user 问题 + 工具结果
  const lastUser = findLastMessageByRole(openaiRequest.messages, 'user');
  const baseUserText = extractMessageText(lastUser ? lastUser.content : (lastMessage && lastMessage.content));
  const toolResultsText = formatToolResultsForPrompt(trailingToolMessages);

  // 上下文记忆策略：
  // 1. 如果有 session_id，后端会自动记住上下文，无需在 query 里重复拼接
  // 2. 如果是新会话（无 session_id），可选择性拼接对话历史
  const hasSession = sessionId && sessionId !== 'new';
  const shouldIncludeContext = envBool('INCLUDE_CONTEXT_IN_QUERY', true) && !hasSession;
  const conversationText = shouldIncludeContext ? formatConversationForQuery(openaiRequest.messages) : '';

  if (hasSession) {
    console.log(`ℹ Using session_id=${sessionId}, context managed by backend`);
  } else if (conversationText) {
    console.log(`ℹ New session, including ${conversationText.length} chars context in query`);
  }

  let baseQuery = baseUserText;
  if (conversationText) {
    baseQuery = `[对话历史]\n${conversationText}\n\n[当前问题]\n${baseQuery}`;
  }
  if (toolResultsText) {
    baseQuery = `${baseQuery}\n\n[工具执行结果]\n${toolResultsText}\n\n请基于以上工具输出给出最终回答。`;
  }

  const toolInstructionMode = (process.env.TOOL_INSTRUCTION_MODE || 'both').toLowerCase();
  const injectIntoQuery = toolMode && (toolInstructionMode === 'query' || toolInstructionMode === 'both');
  const injectIntoMessages = toolMode && (toolInstructionMode === 'messages' || toolInstructionMode === 'both');
  const query = injectIntoQuery ? `${baseQuery}\n\n${toolInstruction}` : baseQuery;

  // query 再做一道总长度保护（很多上游对“输入文本”有硬上限，如 4096 tokens）
  const queryMaxChars = envInt('QUERY_MAX_CHARS', 30_000);
  const safeQuery = truncateTextKeepTail(query, queryMaxChars, '[query已截断]');
  if (query !== safeQuery) {
    console.warn(`⚠ Query truncated: ${query.length} -> ${safeQuery.length} chars (QUERY_MAX_CHARS=${queryMaxChars})`);
  }
  
  // 从 model 参数提取实际的模型名称
  // 例如: "mix/qwen-3-235b-instruct" -> "qwen-3-235b-instruct"
  const modelSlug = normalizeModelSlug(openaiRequest.model);
  
  // 构建基础请求
  const systemMaxChars = Number(process.env.SYSTEM_PROMPT_MAX_CHARS || 10000);
  const safeMessages = toolMode ? trimSystemMessages(openaiRequest.messages, systemMaxChars) : openaiRequest.messages;
  if (toolMode && openaiRequest.messages !== safeMessages) {
    console.log(`⚠ System prompt trimmed to ${systemMaxChars} chars to avoid token overflow`);
  }

  // 根据是否有 session 决定 messages 处理策略：
  // - 有 session：后端会管理历史，可以发送较少的 messages（最近几条即可）
  // - 无 session 且拼接了上下文：避免重复，裁剪 messages
  // - 无 session 且未拼接：发送完整 messages 让后端处理
  let upstreamMessages = safeMessages;
  if (hasSession) {
    // 有 session 时只发送最近几条消息即可，后端会自动关联历史
    upstreamMessages = trimMessagesForUpstream(safeMessages);
    console.log('ℹ Session mode: sending recent messages only');
  } else if (shouldIncludeContext) {
    // 新会话且已拼接上下文到 query，裁剪 messages 避免重复
    upstreamMessages = trimMessagesForUpstream(safeMessages);
    console.log('⚠ Context included in query, trimming messages to avoid duplication');
  }

  const resolvedPersonaId = personaId || process.env.DEFAULT_PERSONA_ID || null;

  const upstreamRequest = {
    request: {
      agent_slug: "web-general",
      model_slug: modelSlug || "qwen-3-235b",
      locale: {
        location: "Asia/Shanghai",
        language: "zh-CN"
      },
      ...(resolvedPersonaId ? { persona_id: resolvedPersonaId } : {}),
      modes: {
        search: true
      },
      query: safeQuery
    },
    is_personalized: true,
    // 工具模式/工具结果/请求中带工具时使用非流式，确保完整解析工具调用或等待总结
    stream: (toolMode || hasToolResults || hasToolsInRequest) ? false : openaiRequest.stream !== false,
    // 完整传递消息历史（注入工具说明）
    messages: injectIntoMessages ? injectToolInstruction(upstreamMessages, tools, forceToolCall) : upstreamMessages
  };
    // 传递工具调用相关字段（新会话或每20轮时）
    // 默认不向上游发送 tools，避免上游尝试“执行工具”而导致 registry 不存在
    if (shouldSendUpstreamTools && tools.length > 0) {
      upstreamRequest.tools = tools;
    }
    if (shouldSendUpstreamTools && openaiRequest.tool_choice) {
      upstreamRequest.tool_choice = openaiRequest.tool_choice;
    }
  
    // 传递其他OpenAI参数
    if (openaiRequest.temperature !== undefined) {
      upstreamRequest.temperature = openaiRequest.temperature;
    }
    if (openaiRequest.top_p !== undefined) {
      upstreamRequest.top_p = openaiRequest.top_p;
    }
    if (openaiRequest.max_tokens !== undefined) {
      upstreamRequest.max_tokens = openaiRequest.max_tokens;
    }
  
  
  // 只有在提供了有效 session_id 时才添加
  // 注意：上游请求用 session_id（下划线），响应用 sessionId（驼峰）
  if (sessionId && sessionId !== 'new') {
    upstreamRequest.session_id = sessionId;
  }
  if (exchangeId && exchangeId !== 'new') {
    upstreamRequest.exchange_id = exchangeId;
  }
  
  return { upstreamRequest, toolMode, hasToolResults };
}

function extractTextFromUpstreamResponse(input) {
  // 上游非流式响应格式（常见）：{"id":"...","parts":[{"type":"text","text":"..."},{"type":"tool-input",...}]}
  // 兼容：input 可能是 string / object
  try {
    const obj = (typeof input === 'string') ? JSON.parse(input) : input;
    if (obj && obj.parts) {
      const parts = Array.isArray(obj.parts) ? obj.parts : [obj.parts];
      const toolCalls = [];
      let textContent = '';

      // 🔧 遍历所有 parts，提取工具调用和文本内容
      for (const part of parts) {
        if (part && part.type === 'error' && part.error_text) {
          return `[Upstream Error] ${part.error_text}`;
        }
        if (part && part.type === 'tool-input' && part.tool_name && part.tool_input !== undefined) {
          toolCalls.push({
            tool_call: {
              name: part.tool_name,
              arguments: part.tool_input
            }
          });
        } else if (part && part.type === 'text' && typeof part.text === 'string') {
          textContent += part.text;
        }
      }

      // 如果有工具调用：返回 tool_call JSON（可多条）+（可选）final，用于“工具名不合法/被过滤”时降级成纯文本
      if (toolCalls.length > 0) {
        const result = toolCalls.map((tc) => JSON.stringify(tc)).join('\n');
        if (textContent) {
          return `${result}\n${JSON.stringify({ final: textContent })}`;
        }
        return result;
      }

      // 只有文本内容
      if (textContent) return textContent;
    }
  } catch (e) {
    // ignore
  }
  if (typeof input === 'string') return input;
  if (input == null) return '';
  return JSON.stringify(input);
}

function extractErrorFromUpstreamResponse(input) {
  try {
    const obj = (typeof input === 'string') ? JSON.parse(input) : input;
    if (!obj) return null;
    if (obj.error && (obj.error.message || obj.error.error_text)) {
      return obj.error.message || obj.error.error_text;
    }
    if (obj.parts) {
      const parts = Array.isArray(obj.parts) ? obj.parts : [obj.parts];
      for (const part of parts) {
        if (part && part.type === 'error' && part.error_text) {
          return part.error_text;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractFinalFromTextProtocol(text) {
  if (typeof text !== 'string' || !text) return null;
  const objects = extractJsonObjectsFromText(text);
  for (const jsonText of objects) {
    try {
      const obj = JSON.parse(jsonText);
      if (obj && typeof obj.final === 'string' && obj.final) return obj.final;
    } catch {
      // ignore
    }
  }
  return null;
}

function extractJsonFromText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    return fenced[1];
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function extractJsonObjectsFromText(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString && ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}
function parseToolCallFromText(text) {
  const jsonObjects = extractJsonObjectsFromText(text);
  if (!jsonObjects.length) {
    const jsonText = extractJsonFromText(text);
    if (!jsonText) {
      if (envBool('LOG_TOOL_PARSE', false)) {
        console.log('⚠ extractJsonFromText returned null');
      }
      return null;
    }
    jsonObjects.push(jsonText);
  }

  if (envBool('LOG_TOOL_PARSE', false)) {
    console.log('🔧 JSON objects to parse:', jsonObjects.length);
  }
  try {
    const toolCalls = [];
    let final = null;

    for (const jsonText of jsonObjects) {
      const obj = JSON.parse(jsonText);
      if (envBool('LOG_TOOL_PARSE', false)) {
        console.log('✅ JSON parsed successfully:', JSON.stringify(obj).substring(0, 300));
      }
      if (obj.tool_call) {
        toolCalls.push(obj.tool_call);
        continue;
      }
      if (Array.isArray(obj.tool_calls)) {
        toolCalls.push(...obj.tool_calls);
        continue;
      }
      if (obj.name && obj.arguments) {
        toolCalls.push({ name: obj.name, arguments: obj.arguments });
        continue;
      }
      if (obj.final) {
        final = obj.final;
      }
    }

    if (toolCalls.length > 0) {
      // 重要：保留 final（如果存在），用于“工具调用被过滤/降级成文本”场景
      return { toolCalls, final };
    }
    if (final) {
      return { toolCalls: null, final };
    }
    if (envBool('LOG_TOOL_PARSE', false)) {
      console.log('⚠ JSON parsed but no matching structure found');
    }
  } catch (e) {
    console.error('❌ JSON parse error:', e.message);
    return null;
  }
  return null;
}

function createUpstreamAgents() {
  const keepAlive = envBool('UPSTREAM_KEEP_ALIVE', true);
  return {
    httpAgent: new http.Agent({ keepAlive }),
    httpsAgent: new https.Agent({ keepAlive })
  };
}

const UPSTREAM_AGENTS = createUpstreamAgents();

function validateAndFilterToolCalls(toolCalls, validTools) {
  if (!Array.isArray(validTools) || validTools.length === 0) {
    return toolCalls;
  }
  
  const validToolNames = new Set();
  validTools.forEach(tool => {
    const fn = tool.function || tool;
    if (fn.name) validToolNames.add(fn.name);
  });
  
  const filtered = toolCalls.filter(call => {
    if (validToolNames.has(call.name)) {
      return true;
    }
    console.warn(`⚠ Tool '${call.name}' not in valid tools list, ignoring`);
    return false;
  });
  
  return filtered;
}

function normalizeToolCallArguments(toolCalls) {
  if (!Array.isArray(toolCalls)) return toolCalls;
  const isJsonLike = (s) => typeof s === 'string' && /^[\s]*[\[{]/.test(s);
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };

  return toolCalls.map((call) => {
    if (!call) return call;
    let args = call.arguments;

    if (typeof args === 'string') {
      args = tryParse(args);
    }

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const normalized = { ...args };
      for (const key of Object.keys(normalized)) {
        const val = normalized[key];
        if (isJsonLike(val)) {
          normalized[key] = tryParse(val);
        }
      }
      args = normalized;
    }

    return { ...call, arguments: args };
  });
}

function toOpenAIToolCallsForChunk(toolCalls) {
  // OpenAI 的 chunk delta 里 tool_calls 元素通常包含 index
  return toolCalls.map((call, index) => ({
    index,
    id: `call_${uuidv4()}`,
    type: 'function',
    function: {
      name: call.name,
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {})
    }
  }));
}

function toOpenAIToolCallsForMessage(toolCalls) {
  // 非流式最终消息体里一般不需要 index 字段（部分客户端对未知字段更敏感）
  return toolCalls.map((call) => ({
    id: `call_${uuidv4()}`,
    type: 'function',
    function: {
      name: call.name,
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {})
    }
  }));
}

async function readUpstreamStream(response) {
  // 将上游的 SSE/逐行 JSON 读完，拼接文本，同时捕获 sessionId（用于后续请求）
  return new Promise((resolve, reject) => {
    const reader = response.body;
    let buffer = '';
    let text = '';
    let exchangeId = null;
    let sessionId = null;

    reader.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let jsonData;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            continue;
          }
          jsonData = data;
        } else {
          jsonData = line;
        }

        try {
          const upstreamData = JSON.parse(jsonData);
          if (!sessionId) {
            const ids = extractIdsFromUpstream(upstreamData);
            if (ids) {
              exchangeId = ids.exchangeId || exchangeId;
              sessionId = ids.sessionId || ids.exchangeId || sessionId;
            }
          }
          if (upstreamData.type === 'text-delta' && upstreamData.delta) {
            text += upstreamData.delta;
          }
        } catch (e) {
          // ignore partial lines
        }
      }
    });

    reader.on('end', () => resolve({ text, sessionId, exchangeId }));
    reader.on('error', (error) => reject(error));
  });
}

function writeSseChunk(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function writeToolCallStream(res, id, model, toolCalls) {
  const openAiToolCalls = toOpenAIToolCallsForChunk(toolCalls);
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant', tool_calls: openAiToolCalls },
      finish_reason: null
    }]
  };
  writeSseChunk(res, chunk);
  const endChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'tool_calls'
    }]
  };
  writeSseChunk(res, endChunk);
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeFinalStream(res, id, model, content) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content },
      finish_reason: null
    }]
  };
  writeSseChunk(res, chunk);
  const endChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop'
    }]
  };
  writeSseChunk(res, endChunk);
  res.write('data: [DONE]\n\n');
  res.end();
}

// 上游 SSE 格式转 OpenAI SSE 格式
function convertUpstreamToOpenAI(upstreamData, model, id) {
  // 上游 API 实际返回格式：
  // {"type":"start","messageMetadata":{...},"messageId":"..."}
  // {"type":"start-step"}
  // {"type":"text-start","id":"..."}
  // {"type":"text-delta","id":"...","delta":"实际内容"}  <- 这是文本增量
  // {"type":"text-end","id":"..."}
  // {"type":"finish-step"}
  // {"type":"finish"}
  // {"type":"data-usage","data":{...}}
  
  // 只有 type=text-delta 时才返回内容
  if (upstreamData.type === 'text-delta') {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {
          content: upstreamData.delta || ''
        },
        finish_reason: null
      }]
    };
  }
  
  // type=finish 时返回结束标记
  if (upstreamData.type === 'finish') {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }]
    };
  }
  
  // 其他类型（start, start-step, text-start, text-end, finish-step, data-usage等）返回 null
  return null;
}

function sendOpenAIError(res, status, {
  message,
  type = 'invalid_request_error',
  code = null,
  param = null,
  ...extra
}) {
  return res.status(status).json({
    error: {
      message,
      type,
      code,
      param,
      ...extra
    }
  });
}

// 处理聊天完成请求的函数
async function handleChatCompletion(req, res) {
  const requestId = req.requestId || String(res.getHeader('x-request-id') || uuidv4());
  if (!res.getHeader('x-request-id')) res.setHeader('x-request-id', requestId);
  try {
    const requestBody = req.body;
    const authHeader = req.headers['authorization'];
    const inboundAuthMode = String(process.env.INBOUND_AUTH_MODE || 'bearer').toLowerCase(); // bearer | none
    const upstreamAuthMode = String(process.env.UPSTREAM_AUTH_MODE || 'pass_through').toLowerCase(); // pass_through | static | managed | none
    const expectedInboundToken = process.env.INBOUND_BEARER_TOKEN || null;
    const staticUpstreamToken = process.env.UPSTREAM_BEARER_TOKEN || null;

    const streamId = `chatcmpl-${uuidv4()}`;
    
    let inboundToken = null;
    if (inboundAuthMode !== 'none') {
      if (!authHeader) {
        setRequestEndReason(res, 'auth_error');
        return sendOpenAIError(res, 401, {
          message: 'Missing authorization header',
          type: 'authentication_error',
          code: 'unauthorized',
          param: null
        });
      }

      // 提取 Bearer token
      const m = String(authHeader).match(/^\s*Bearer\s+(.+)\s*$/i);
      if (!m) {
        setRequestEndReason(res, 'auth_error');
        return sendOpenAIError(res, 401, {
          message: 'Invalid authorization header (expected Bearer token)',
          type: 'authentication_error',
          code: 'unauthorized',
          param: 'authorization'
        });
      }
      inboundToken = m[1];

      if (expectedInboundToken && inboundToken !== expectedInboundToken) {
        setRequestEndReason(res, 'auth_error');
        return sendOpenAIError(res, 401, {
          message: 'Invalid inbound token',
          type: 'authentication_error',
          code: 'unauthorized',
          param: 'authorization'
        });
      }
    }

    // 基本请求校验（避免后续 NPE）
    if (!requestBody || typeof requestBody !== 'object') {
      setRequestEndReason(res, 'invalid_request');
      return sendOpenAIError(res, 400, {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: null
      });
    }
    if (typeof requestBody.model !== 'string' || !requestBody.model.trim()) {
      setRequestEndReason(res, 'invalid_request');
      return sendOpenAIError(res, 400, {
        message: 'Invalid request: model must be a non-empty string',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'model'
      });
    }
    if (!Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      setRequestEndReason(res, 'invalid_request');
      return sendOpenAIError(res, 400, {
        message: 'Invalid request: messages must be a non-empty array',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'messages'
      });
    }

    const openaiRequest = normalizeOpenAIRequestTooling(requestBody);

    const requestClient = inferClientId(req);
    const clientWantsStream = openaiRequest.stream !== false;
    const toolsPresent = Array.isArray(openaiRequest.tools) && openaiRequest.tools.length > 0;
    res.locals.client = requestClient;
    res.locals.stream = String(clientWantsStream);
    res.locals.toolsPresent = String(toolsPresent);

    let upstreamToken = null;
    if (upstreamAuthMode === 'pass_through') {
      if (!inboundToken) {
        setRequestEndReason(res, 'adapter_error');
        return sendOpenAIError(res, 500, {
          message: 'Invalid server config: UPSTREAM_AUTH_MODE=pass_through requires inbound Bearer token',
          type: 'server_error',
          code: 'invalid_server_config',
          param: 'UPSTREAM_AUTH_MODE'
        });
      }
      upstreamToken = inboundToken;
    } else if (upstreamAuthMode === 'static') {
      if (!staticUpstreamToken) {
        setRequestEndReason(res, 'adapter_error');
        return sendOpenAIError(res, 500, {
          message: 'Invalid server config: UPSTREAM_AUTH_MODE=static requires UPSTREAM_BEARER_TOKEN',
          type: 'server_error',
          code: 'invalid_server_config',
          param: 'UPSTREAM_BEARER_TOKEN'
        });
      }
      upstreamToken = staticUpstreamToken;
    } else if (upstreamAuthMode === 'managed') {
      try {
        upstreamToken = await getManagedUpstreamToken({ requestId, forceRefresh: false });
      } catch (error) {
        setRequestEndReason(res, 'upstream_error');
        return sendOpenAIError(res, 502, {
          message: error && error.message ? error.message : 'Failed to obtain upstream token',
          type: 'api_error',
          code: 'upstream_auth_error',
          param: null
        });
      }
    } else if (upstreamAuthMode === 'none') {
      upstreamToken = null;
    } else {
      setRequestEndReason(res, 'adapter_error');
      return sendOpenAIError(res, 500, {
        message: `Invalid UPSTREAM_AUTH_MODE: ${upstreamAuthMode}`,
        type: 'server_error',
        code: 'invalid_server_config',
        param: 'UPSTREAM_AUTH_MODE'
      });
    }
    
    // 可选：验证并解析 token（用于调试）
    if (envBool('LOG_TOKEN_INFO', false) && upstreamToken) {
      try {
        const parts = upstreamToken.split('.');
        if (parts.length === 3) {
          const payload = base64UrlToJson(parts[1]);
          if (!payload) throw new Error('Invalid JWT payload');
          const exp = new Date(payload.exp * 1000);
          const now = new Date();
          console.log(`Token Info: exp=${exp.toISOString()}, remaining=${Math.floor((exp - now) / 1000 / 60)}min`);

          if (exp < now) {
            console.error('❌ Token已过期！');
            setRequestEndReason(res, 'upstream_error');
            return res.status(401).json({
              error: {
                message: 'Token expired',
                details: `Token过期时间: ${exp.toISOString()}, 当前时间: ${now.toISOString()}`
              }
            });
          }
        }
      } catch (e) {
        console.warn('⚠ Token parse failed:', e.message);
      }
    }
    
    // session_id 获取优先级：
    // 1. 客户端显式传入（header / body）
    // 2. 适配器自动管理的 session store（OpenCode 不会传 session，所以这是主要来源）
    // 3. 无 session → 上游创建新会话
    const sessionIdFromHeader = req.headers['x-session-id'] || req.headers['x-session_id'] || null;
    const sessionIdFromBody = openaiRequest && (
      openaiRequest.session_id
      || openaiRequest.sessionId
      || (openaiRequest.metadata && (openaiRequest.metadata.session_id || openaiRequest.metadata.sessionId))
    ) || null;
    const exchangeIdFromHeader = req.headers['x-exchange-id'] || req.headers['x-exchange_id'] || null;
    const exchangeIdFromBody = openaiRequest && (
      openaiRequest.exchange_id
      || openaiRequest.exchangeId
      || (openaiRequest.metadata && (openaiRequest.metadata.exchange_id || openaiRequest.metadata.exchangeId))
    ) || null;
    let sessionId = sessionIdFromHeader || sessionIdFromBody || null;
    let exchangeId = exchangeIdFromHeader || exchangeIdFromBody || null;
    const storeKey = getSessionStoreKey(req, openaiRequest.model, inboundToken || '');

    // "new" 表示显式开始新会话
    if (sessionId === 'new') {
      await clearStoredSession(storeKey);
      sessionId = null;
      exchangeId = null;
      console.log(`ℹ Client requested new session (key=${storeKey})`);
    }

    // 如果客户端未提供 session_id，从 store 自动获取（适配 OpenCode 等不支持 session 的客户端）
    if (!sessionId) {
      const stored = await getStoredSession(storeKey);
      if (stored && stored.sessionId) {
        sessionId = stored.sessionId;
        if (!exchangeId && stored.exchangeId) {
          exchangeId = stored.exchangeId;
        }
        console.log(`ℹ Auto-session from store: sessionId=${sessionId} (key=${storeKey})`);
      }
    }

    // persona_id：允许调用方自行指定（用于上游 persona 提示词管理）
    const personaId = (
      req.headers['x-persona-id']
      || req.headers['x-persona_id']
      || (openaiRequest && (openaiRequest.persona_id || openaiRequest.personaId))
      || (openaiRequest && openaiRequest.request && (openaiRequest.request.persona_id || openaiRequest.request.personaId))
    ) || null;
    
    // 获取存储的session信息（用于判断轮次）
    let storedSession = await getStoredSession(storeKey);
    if (storedSession && sessionId && storedSession.sessionId && storedSession.sessionId !== sessionId) {
      storedSession = null;
    }
    if (storedSession && !exchangeId && storedSession.exchangeId) {
      exchangeId = storedSession.exchangeId;
    }
    
    // 转换请求格式（完整传递，支持工具调用）
    const { upstreamRequest, toolMode, hasToolResults } = convertToUpstreamFormat(openaiRequest, sessionId, exchangeId, personaId, storedSession);
    
    console.log(`[${requestId}] 🔧 toolMode=${toolMode}, hasToolResults=${hasToolResults}, stream=${upstreamRequest.stream}, turnCount=${storedSession ? storedSession.turnCount : 0}`);
    
    const logBodies = envBool('LOG_BODIES', false);
    if (logBodies) {
      console.log(`[${requestId}] OpenAI Request:`, JSON.stringify(openaiRequest, null, 2));
      console.log(`[${requestId}] Upstream Request:`, JSON.stringify(upstreamRequest, null, 2));
    } else {
      console.log(`[${requestId}] toolMode=${toolMode} stream(client)=${clientWantsStream} stream(upstream)=${upstreamRequest.stream} model=${openaiRequest.model}`);
    }

    const timeoutMs = envInt('UPSTREAM_TIMEOUT_MS', 180_000);
    const retryCount = envInt('UPSTREAM_RETRY_COUNT', 0);
    const retryBaseMs = envInt('UPSTREAM_RETRY_BASE_MS', 250);

    const { httpAgent, httpsAgent } = UPSTREAM_AGENTS;

    async function upstreamFetchWithRetry() {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          if (!UPSTREAM_API_BASE) {
            throw new Error('Missing UPSTREAM_API_BASE (set it in .env)');
          }
          const base = UPSTREAM_API_BASE.replace(/\/+$/, '');
          const path = UPSTREAM_CHAT_PATH ? `/${UPSTREAM_CHAT_PATH.replace(/^\/+/, '')}` : '';
          const url = `${base}${path}`;
          const headers = {
            'accept': 'text/event-stream',
            'accept-language': UPSTREAM_ACCEPT_LANGUAGE,
            'content-type': 'application/json',
            'cache-control': 'no-cache',
            'x-request-id': requestId
          };
          if (upstreamToken) headers.authorization = `Bearer ${upstreamToken}`;
          if (UPSTREAM_REFERER) headers.Referer = UPSTREAM_REFERER;
          const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(upstreamRequest),
            agent: (parsedUrl) => (parsedUrl && parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent),
            signal: controller ? controller.signal : undefined
          });
          if (timeout) clearTimeout(timeout);
          // 仅对临时性 5xx 做有限重试（避免对 4xx/鉴权错误重放）
          if (!resp.ok && resp.status >= 500 && resp.status <= 599 && attempt < retryCount) {
            attempt++;
            const delay = retryBaseMs * Math.pow(2, attempt - 1);
            console.warn(`[${requestId}] Upstream 5xx (${resp.status}), retrying in ${delay}ms (attempt ${attempt}/${retryCount})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return resp;
        } catch (err) {
          if (timeout) clearTimeout(timeout);
          const isAbort = err && (err.name === 'AbortError' || String(err.message || '').includes('aborted'));
          if ((isAbort || err) && attempt < retryCount) {
            attempt++;
            const delay = retryBaseMs * Math.pow(2, attempt - 1);
            console.warn(`[${requestId}] Upstream fetch failed (${err.message || err}), retrying in ${delay}ms (attempt ${attempt}/${retryCount})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    }

    async function fetchUpstreamWithAuthRecovery() {
      let authRecoveryAttempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const response = await upstreamFetchWithRetry();
        if (upstreamAuthMode !== 'managed' || authRecoveryAttempt >= UPSTREAM_AUTH_RECOVERY_RETRY) {
          return response;
        }

        const shouldRecover = await shouldRecoverManagedTokenFromResponse(response);
        if (!shouldRecover) {
          return response;
        }

        authRecoveryAttempt++;
        clearManagedUpstreamToken('upstream_auth_error', requestId);
        try {
          upstreamToken = await getManagedUpstreamToken({ requestId, forceRefresh: true });
        } catch (error) {
          const safeMessage = redactSensitiveText(error && error.message ? error.message : String(error));
          console.error(`[${requestId}] Managed token recovery failed: ${safeMessage}`);
          return response;
        }
        console.warn(`[${requestId}] Retrying upstream request after managed token recovery (${authRecoveryAttempt}/${UPSTREAM_AUTH_RECOVERY_RETRY})`);
      }
    }
    
    // 调用上游
    const response = await fetchUpstreamWithAuthRecovery();
    setRequestUpstreamStatus(res, response.status);
    console.log(`[${requestId}] Upstream Response: status=${response.status}, content-type=${response.headers.get('content-type')}`);
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`[${requestId}] Upstream API Error:`, redactSensitiveText(error));
      setRequestEndReason(res, 'upstream_error');
      return sendOpenAIError(res, response.status, {
        message: `Upstream API error: ${response.statusText || response.status}`,
        type: 'api_error',
        code: 'upstream_http_error',
        param: null
      });
    }
    
    const upstreamContentType = String(response.headers.get('content-type') || '').toLowerCase();
    // 北向 stream 语义由 clientWantsStream 决定；仅当上游也确实返回 SSE 时才走直通桥接。
    const useDirectStreamBridge = clientWantsStream && upstreamRequest.stream && upstreamContentType.includes('text/event-stream');

    // 流式响应（上游 SSE 直通转换）
    if (useDirectStreamBridge) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 关键：headers 一旦开始写 body 就会被发送。
      // 为确保流式响应也能稳定拿到 x-session-id，我们在发现 sessionId 前短暂缓存前几条 chunk。
      let capturedSessionId = null;
      let sentAny = false;
      let doneSent = false;
      const pendingChunks = [];
      const flushPending = () => {
        if (pendingChunks.length === 0) return;
        for (const s of pendingChunks) {
          res.write(s);
        }
        pendingChunks.length = 0;
        sentAny = true;
      };
      
      // 读取上游的流式响应并转换为 OpenAI 格式
      const reader = response.body;
      let buffer = '';
      let streamEndReason = 'unknown';
      let clientAborted = false;

      const finalizeStreamEndReason = (reason) => {
        if (!reason || streamEndReason !== 'unknown') return;
        streamEndReason = reason;
        setRequestEndReason(res, reason);
        console.log(`[${requestId}] stream.terminated end_reason=${reason} upstream_status=${response.status}`);
      };

      const handleClientAbort = () => {
        if (clientAborted) return;
        if (res.writableEnded) return;
        clientAborted = true;
        finalizeStreamEndReason('client_abort');
        if (reader && typeof reader.destroy === 'function' && !reader.destroyed) {
          reader.destroy();
        }
      };

      req.once('aborted', handleClientAbort);
      res.once('close', () => {
        if (!res.writableEnded) handleClientAbort();
      });
      
      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留最后不完整的行
        
        for (const line of lines) {
          if (!line.trim()) continue; // 跳过空行
          
          try {
            let jsonData;
            
            // 上游 API 可能返回两种格式：
            // 1. 纯JSON: {"type":"text-delta",...}
            // 2. SSE格式: data: {"type":"text-delta",...}
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                if (!sentAny) flushPending();
                if (!doneSent) {
                  res.write('data: [DONE]\n\n');
                  doneSent = true;
                }
                continue;
              }
              jsonData = data;
            } else {
              jsonData = line;
            }
            
            // 解析上游返回的 JSON 数据
            const upstreamData = JSON.parse(jsonData);

            // 从 START 帧捕获 session IDs（用于后续请求的 sessionId）
            if (!capturedSessionId) {
              console.log(`[${requestId}] 🔍 Checking upstream data for session:`, JSON.stringify(upstreamData, null, 2));
              const ids = extractIdsFromUpstream(upstreamData);
              console.log(`[${requestId}] 📋 Extracted IDs:`, ids);
              if (ids && (ids.sessionId || ids.exchangeId)) {
                capturedSessionId = ids.sessionId || ids.exchangeId;
                // 存入 session store，供后续请求自动使用
                updateStoredSession(storeKey, capturedSessionId, ids.exchangeId).catch((err) => {
                  const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
                  console.warn(`[${requestId}] Failed to store session from stream: ${safeMessage}`);
                });
                if (!res.getHeader('x-session-id')) res.setHeader('x-session-id', capturedSessionId);
              }
            }

            const openaiChunk = convertUpstreamToOpenAI(upstreamData, openaiRequest.model, streamId);
            
            // 只发送有效的chunk（过滤掉start、data-usage等）
            if (openaiChunk) {
              const payload = `data: ${JSON.stringify(openaiChunk)}\n\n`;
              if (!sentAny && !capturedSessionId) {
                // 还没拿到 sessionId 时先缓存；但为了保证增量可实时消费，
                // 一旦出现首个可发送 chunk（通常是 text-delta）立即刷出，避免等到流结束。
                pendingChunks.push(payload);
                flushPending();
              } else {
                if (!sentAny) flushPending();
                res.write(payload);
                sentAny = true;
              }
            }
          } catch (e) {
            console.error('Parse error:', e, 'Line:', line);
          }
        }
      });
      
      reader.on('end', () => {
        finalizeStreamEndReason('stop');
        if (!sentAny) flushPending();
        if (!doneSent) res.write('data: [DONE]\n\n');
        res.end();
      });
      
      reader.on('error', (error) => {
        if (clientAborted) return;
        const msg = String(error && error.message ? error.message : error);
        if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('timeout')) {
          finalizeStreamEndReason('timeout');
        } else {
          finalizeStreamEndReason('upstream_error');
        }
        console.error('Stream error:', error);
        res.end();
      });
      
    } else {
      // 非流式响应（用于工具调用或模型返回非SSE）
      let text = '';
      let upstreamSessionId = null;
      let upstreamExchangeId = null;
      if (upstreamContentType.includes('text/event-stream')) {
        const result = await readUpstreamStream(response);
        text = result.text;
        upstreamSessionId = result.sessionId || null;
        upstreamExchangeId = result.exchangeId || null;
      } else {
        const data = await response.json();
        console.log(`[${requestId}] 🔍 Upstream non-stream response:`, JSON.stringify(data, null, 2));
        const upstreamError = extractErrorFromUpstreamResponse(data);
        if (upstreamError) {
          const safeUpstreamError = redactSensitiveText(upstreamError);
          console.error(`[${requestId}] ❌ Upstream error:`, safeUpstreamError);
          setRequestEndReason(res, 'upstream_error');
          return sendOpenAIError(res, 502, {
            message: `Upstream error: ${safeUpstreamError}`,
            type: 'api_error',
            code: 'upstream_error',
            param: null
          });
        }
        // 非 SSE 响应也尝试提取 session IDs
        if (data) {
          const ids = extractIdsFromUpstream(data);
          console.log(`[${requestId}] 📋 Extracted IDs from non-stream:`, ids);
          if (ids && (ids.sessionId || ids.exchangeId)) {
            upstreamSessionId = ids.sessionId || ids.exchangeId;
            upstreamExchangeId = ids.exchangeId || upstreamExchangeId;
          }
        }
        text = data.content || data.text || JSON.stringify(data);
      }

      // 更新 session store
      if (upstreamSessionId) {
        await updateStoredSession(storeKey, upstreamSessionId, upstreamExchangeId);
      }
      if (upstreamSessionId && !res.getHeader('x-session-id')) {
        res.setHeader('x-session-id', upstreamSessionId);
      }

      const shouldParseTools = toolMode || (Array.isArray(openaiRequest.tools) && openaiRequest.tools.length > 0);

      if (shouldParseTools) {
        if (envBool('LOG_TOOL_PARSE', false)) {
          console.log(`[${requestId}] 📝 Raw text from upstream:`, text.substring(0, 500));
        }
        // 🔧 从上游消息对象中提取实际文本内容
        const actualText = extractTextFromUpstreamResponse(text);
        if (envBool('LOG_TOOL_PARSE', false)) {
          console.log(`[${requestId}] 📄 Extracted text:`, actualText.substring(0, 300));
        }
        const parsed = parseToolCallFromText(actualText);
        if (envBool('LOG_TOOL_PARSE', false)) {
          console.log(`[${requestId}] 🔍 Parsed result:`, JSON.stringify(parsed));
        }
        if (parsed && parsed.toolCalls) {
          console.log(`✅ Parsed tool calls: ${parsed.toolCalls.map((t) => t.name).join(', ')}`);
          const normalizedToolCalls = normalizeToolCallArguments(parsed.toolCalls);
          const validToolCalls = validateAndFilterToolCalls(normalizedToolCalls, openaiRequest.tools);
          if (validToolCalls.length === 0) {
            console.warn('⚠ All tool calls filtered out (invalid tools), treating as text response');
            const fallbackText = parsed.final
              || extractFinalFromTextProtocol(actualText)
              || (typeof actualText === 'string' && !actualText.includes('"tool_call"') ? actualText : null)
              || extractTextFromUpstreamResponse(text);
            if (clientWantsStream) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              setRequestEndReason(res, 'stop');
              return writeFinalStream(res, streamId, openaiRequest.model, fallbackText);
            }
            setRequestEndReason(res, 'stop');
            return res.json({
              id: `chatcmpl-${uuidv4()}`,
              session_id: upstreamSessionId || sessionId || null,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: openaiRequest.model,
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: fallbackText
                },
                finish_reason: 'stop'
              }],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
              }
            });
          }
          console.log(`✅ Valid tool calls: ${validToolCalls.map((t) => t.name).join(', ')}`);
          const openAiToolCalls = toOpenAIToolCallsForMessage(validToolCalls);
          if (clientWantsStream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            setRequestEndReason(res, 'tool_calls');
            return writeToolCallStream(res, streamId, openaiRequest.model, validToolCalls);
          }
          setRequestEndReason(res, 'tool_calls');
          return res.json({
            id: `chatcmpl-${uuidv4()}`,
            session_id: upstreamSessionId || sessionId || null,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: openaiRequest.model,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: openAiToolCalls
              },
              finish_reason: 'tool_calls'
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0
            }
          });
        }

        if (!parsed) {
          console.warn('⚠ Tool mode: no tool_call parsed, fallback to final response');
        }
        const finalText = (parsed && parsed.final)
          ? parsed.final
          : (extractFinalFromTextProtocol(actualText)
            || (typeof actualText === 'string' && !actualText.includes('"tool_call"') ? actualText : null)
            || extractTextFromUpstreamResponse(text));
        if (clientWantsStream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          setRequestEndReason(res, 'stop');
          return writeFinalStream(res, streamId, openaiRequest.model, finalText);
        }
        setRequestEndReason(res, 'stop');
        return res.json({
          id: `chatcmpl-${uuidv4()}`,
          session_id: upstreamSessionId || sessionId || null,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: openaiRequest.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: finalText
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        });
      }

      // 🔧 非工具模式下也需要提取文本内容
      const finalText = extractTextFromUpstreamResponse(text);
      
      if (clientWantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        setRequestEndReason(res, 'stop');
        return writeFinalStream(res, streamId, openaiRequest.model, finalText);
      }

      setRequestEndReason(res, 'stop');
      return res.json({
        id: `chatcmpl-${uuidv4()}`,
        session_id: upstreamSessionId || sessionId || null,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: openaiRequest.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: finalText
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }
    
  } catch (error) {
    const isAbort = error && (error.name === 'AbortError' || error.type === 'aborted' || String(error.message || '').toLowerCase().includes('aborted'));
    if (isAbort) {
      console.warn('Upstream request aborted (timeout):', error && error.message ? error.message : String(error));
      setRequestEndReason(res, 'timeout');
      return sendOpenAIError(res, 504, {
        message: 'Upstream timeout',
        type: 'api_error',
        code: 'upstream_timeout',
        param: null
      });
    }

    const safeError = redactSensitiveText(error && error.message ? error.message : String(error));
    console.error('Adapter error:', safeError);
    setRequestEndReason(res, 'adapter_error');
    const expose = envBool('EXPOSE_STACK', false);
    return sendOpenAIError(res, 500, {
      message: safeError || 'Internal server error',
      type: 'server_error',
      code: 'internal_server_error',
      param: null,
      ...(expose ? { stack: error && error.stack ? error.stack : String(error) } : {})
    });
  }
}

// 兼容 OpenAI 的 /v1/chat/completions 接口
app.post('/v1/chat/completions', handleChatCompletion);

// 兼容 New-API 直接访问根路径的情况
app.post('/', handleChatCompletion);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mix2api' });
});

// 模型列表（兼容 OpenAI）
app.get('/v1/models', (req, res) => {
  const modelIds = resolveModelIds();
  res.json({
    object: 'list',
    data: modelIds.map((id) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'mix2api'
    }))
  });
});

app.listen(PORT, () => {
  console.log(`mix2api adapter running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
  console.log(`OpenAI-compatible endpoint: http://localhost:${PORT}/v1/chat/completions`);
  void initRedisSessionClient();
});
