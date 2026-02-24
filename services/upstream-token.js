function createManagedUpstreamTokenService({
  fetch,
  httpAgent,
  httpsAgent,
  config,
  helpers
}) {
  const {
    UPSTREAM_API_BASE,
    UPSTREAM_TOKEN_URL,
    UPSTREAM_TOKEN_PATH,
    UPSTREAM_TOKEN_METHOD,
    UPSTREAM_TOKEN_HEADERS_JSON,
    UPSTREAM_TOKEN_BODY_JSON,
    UPSTREAM_TOKEN_FIELD,
    UPSTREAM_TOKEN_EXPIRES_IN_FIELD,
    UPSTREAM_TOKEN_TIMEOUT_MS,
    UPSTREAM_TOKEN_EXPIRY_SKEW_MS
  } = config;

  const {
    base64UrlToJson,
    redactSensitiveText,
    fingerprint,
    extractErrorFromUpstreamResponse
  } = helpers;

  const state = {
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
    if (!state.token) return false;
    if (!state.expiresAt || state.expiresAt <= 0) return true;
    return (Date.now() + UPSTREAM_TOKEN_EXPIRY_SKEW_MS) < state.expiresAt;
  }

  function clearManagedUpstreamToken(reason, requestId) {
    if (!state.token) return;
    const fp = fingerprint(state.token);
    state.token = null;
    state.expiresAt = 0;
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
      state.token = token;
      state.expiresAt = expiresAt;
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
      return state.token;
    }

    if (!forceRefresh && state.refreshPromise) {
      return state.refreshPromise;
    }

    const refreshPromise = requestManagedUpstreamToken(requestId);
    state.refreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (state.refreshPromise === refreshPromise) {
        state.refreshPromise = null;
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

  return {
    getManagedUpstreamToken,
    clearManagedUpstreamToken,
    shouldRecoverManagedTokenFromResponse
  };
}

module.exports = {
  createManagedUpstreamTokenService
};
