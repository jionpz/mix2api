function createSessionKeyService({ sanitizeKeyPart, fingerprint }) {
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

  return {
    inferClientId,
    getSessionStoreKey
  };
}

module.exports = {
  createSessionKeyService
};
