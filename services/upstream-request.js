function createUpstreamRequestService({ fetch, httpAgent, httpsAgent, config, helpers }) {
  const {
    UPSTREAM_API_BASE,
    UPSTREAM_CHAT_PATH,
    UPSTREAM_ACCEPT_LANGUAGE,
    UPSTREAM_REFERER
  } = config;

  const { redactSensitiveText } = helpers;

  async function fetchWithRetry({ requestId, upstreamRequest, upstreamToken, timeoutMs, retryCount, retryBaseMs }) {
    let attempt = 0;
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
    let authRecoveryAttempt = 0;
    let token = upstreamToken;
    while (true) {
      const response = await fetchWithRetry({
        requestId,
        upstreamRequest,
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
