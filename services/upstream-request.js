const { lookup } = require('node:dns').promises;

function createUpstreamRequestService({ fetch, httpAgent, httpsAgent, config, helpers }) {
  const {
    UPSTREAM_API_BASE,
    UPSTREAM_CHAT_PATH,
    UPSTREAM_ACCEPT_LANGUAGE,
    UPSTREAM_REFERER
  } = config;

  const { redactSensitiveText } = helpers;

  function parseBooleanEnv(rawValue, fallback = false) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
    const text = String(rawValue).trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes' || text === 'on';
  }

  function isLikelyIpLiteral(hostname) {
    return /^[0-9.:]+$/.test(String(hostname || ''));
  }

  function isLoopbackHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
  }

  function isPrivateIpv4(hostname) {
    const host = String(hostname || '').trim();
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    if (![a, b, c, d].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 0) return true;
    return false;
  }

  function isPrivateIpv6(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    if (!host.includes(':')) return false;
    if (host === '::1') return true;
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice('::ffff:'.length);
      if (mapped.includes(':')) return true;
      return isPrivateIpv4(mapped);
    }
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('fe80:')) return true;
    return false;
  }

  function isPrivateOrLoopback(hostname) {
    return isLoopbackHost(hostname) || isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
  }

  async function resolveHostAddresses(hostname) {
    if (helpers && typeof helpers.resolveHostAddresses === 'function') {
      return await helpers.resolveHostAddresses(hostname);
    }
    const resolved = await lookup(String(hostname || ''), { all: true, verbatim: true });
    return Array.isArray(resolved) ? resolved.map((item) => String(item.address || '')).filter(Boolean) : [];
  }

  async function assertSafeUpstreamTarget(url, requestId) {
    const allowPrivate = parseBooleanEnv(process.env.UPSTREAM_BASE_ALLOW_PRIVATE, false);
    if (allowPrivate) return;

    const parsed = new URL(url);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (!hostname) return;

    if (isPrivateOrLoopback(hostname)) {
      throw new Error('Invalid upstream target: private or loopback host is not allowed');
    }

    if (isLikelyIpLiteral(hostname)) {
      return;
    }

    let addresses = [];
    try {
      addresses = await resolveHostAddresses(hostname);
    } catch (error) {
      const safeMessage = redactSensitiveText(error && error.message ? error.message : String(error));
      console.warn(`[${requestId}] DNS resolve failed for upstream host=${hostname}: ${safeMessage}`);
      return;
    }

    if (addresses.some((addr) => isPrivateOrLoopback(addr))) {
      throw new Error('Invalid upstream target: resolved DNS address is private or loopback');
    }
  }

  async function fetchWithRetry({ requestId, upstreamRequest, upstreamBaseUrl, upstreamToken, timeoutMs, retryCount, retryBaseMs }) {
    let attempt = 0;
    while (true) {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const upstreamBase = String(upstreamBaseUrl || UPSTREAM_API_BASE || '').trim();
        if (!upstreamBase) {
          throw new Error('Missing upstream base URL (set UPSTREAM_API_BASE or provide x-upstream-base-url/upstream_base_url)');
        }
        const base = upstreamBase.replace(/\/+$/, '');
        const path = UPSTREAM_CHAT_PATH ? `/${UPSTREAM_CHAT_PATH.replace(/^\/+/, '')}` : '';
        const url = `${base}${path}`;
        if (upstreamBaseUrl) {
          await assertSafeUpstreamTarget(url, requestId);
        }
        const headers = {
          accept: 'text/event-stream',
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

  async function fetchWithAuthRecovery({
    requestId,
    upstreamRequest,
    upstreamBaseUrl,
    upstreamToken,
    upstreamAuthMode,
    authRecoveryRetry,
    timeoutMs,
    retryCount,
    retryBaseMs,
    shouldRecover,
    clearManagedToken,
    refreshManagedToken
  }) {
    if (upstreamAuthMode === 'managed' && upstreamBaseUrl && !process.env.UPSTREAM_TOKEN_URL) {
      throw new Error('Dynamic upstream_base_url requires UPSTREAM_TOKEN_URL when UPSTREAM_AUTH_MODE=managed');
    }

    let authRecoveryAttempt = 0;
    let token = upstreamToken;
    while (true) {
      const response = await fetchWithRetry({
        requestId,
        upstreamRequest,
        upstreamBaseUrl,
        upstreamToken: token,
        timeoutMs,
        retryCount,
        retryBaseMs
      });

      if (upstreamAuthMode !== 'managed' || authRecoveryAttempt >= authRecoveryRetry) {
        return { response, upstreamToken: token };
      }

      const recover = await shouldRecover(response);
      if (!recover) {
        return { response, upstreamToken: token };
      }

      authRecoveryAttempt++;
      clearManagedToken('upstream_auth_error', requestId);
      try {
        token = await refreshManagedToken({ requestId, forceRefresh: true });
      } catch (error) {
        const safeMessage = redactSensitiveText(error && error.message ? error.message : String(error));
        console.error(`[${requestId}] Managed token recovery failed: ${safeMessage}`);
        return { response, upstreamToken: token };
      }
      console.warn(`[${requestId}] Retrying upstream request after managed token recovery (${authRecoveryAttempt}/${authRecoveryRetry})`);
    }
  }

  return {
    fetchWithAuthRecovery
  };
}

module.exports = {
  createUpstreamRequestService
};
