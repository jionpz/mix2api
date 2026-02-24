function normalizeRequestId(value) {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  if (!id) return null;
  if (id.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

function redactHeaders(headers) {
  const src = (headers && typeof headers === 'object') ? headers : {};
  const out = { ...src };
  const redactValue = (key, value) => {
    const k = String(key || '').toLowerCase();
    const isAuth = k.includes('authorization');
    const isCookie = k.includes('cookie');
    const isToken = k.includes('token') || k.includes('api-key') || k.includes('apikey') || k.includes('x-api-key');
    const isSession = k.includes('session') || k.includes('exchange');
    if (isAuth) return 'Bearer ***';
    if (isCookie || isToken || isSession) return '***';
    return value;
  };
  for (const key of Object.keys(out)) {
    const val = out[key];
    if (Array.isArray(val)) {
      out[key] = val.map((v) => redactValue(key, v));
    } else {
      out[key] = redactValue(key, val);
    }
  }
  return out;
}

function redactSensitiveText(text) {
  if (text === undefined || text === null) return '';
  let output = String(text);
  output = output.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, 'Bearer ***');
  output = output.replace(/("?(access_?token|refresh_?token|id_?token|token)"?\s*[:=]\s*")([^"]*)"/gi, '$1***"');
  output = output.replace(/("?(sessionId|session_id|exchangeId|exchange_id)"?\s*[:=]\s*")([^"]*)"/gi, '$1***"');
  output = output.replace(/\b(token=)[^&\s]+/gi, '$1***');
  return output;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
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

function base64UrlToJson(b64url) {
  try {
    let s = String(b64url || '');
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    const buf = Buffer.from(s, 'base64');
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
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

function fingerprint(input) {
  if (input === undefined || input === null) return 'none';
  return require('crypto')
    .createHash('sha256')
    .update(String(input))
    .digest('hex')
    .slice(0, 12);
}

function sanitizeKeyPart(value, fallback = 'unknown') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(/[^a-z0-9._:-]/g, '_').slice(0, 80);
  return normalized || fallback;
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

module.exports = {
  normalizeRequestId,
  redactHeaders,
  redactSensitiveText,
  extractMessageText,
  base64UrlToJson,
  redactRedisUrl,
  fingerprint,
  sanitizeKeyPart,
  toPositiveInt
};
