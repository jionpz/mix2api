function validateRequestBody(requestBody) {
  if (!requestBody || typeof requestBody !== 'object') {
    return {
      ok: false,
      endReason: 'invalid_request',
      status: 400,
      payload: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: null
      }
    };
  }
  if (typeof requestBody.model !== 'string' || !requestBody.model.trim()) {
    return {
      ok: false,
      endReason: 'invalid_request',
      status: 400,
      payload: {
        message: 'Invalid request: model must be a non-empty string',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'model'
      }
    };
  }
  if (!Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
    return {
      ok: false,
      endReason: 'invalid_request',
      status: 400,
      payload: {
        message: 'Invalid request: messages must be a non-empty array',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'messages'
      }
    };
  }
  return { ok: true };
}

function parseBooleanEnv(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const text = String(rawValue).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function resolveFirstHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const target = String(name || '').toLowerCase();
  let value = headers[name];
  if (value === undefined && target) {
    const key = Object.keys(headers).find((k) => String(k || '').toLowerCase() === target);
    value = key ? headers[key] : undefined;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  return value;
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

function parseAllowlist(rawAllowlist) {
  if (!rawAllowlist) return [];
  return String(rawAllowlist)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowedByAllowlist(hostname, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function resolveDynamicUpstreamConfig(env = process.env) {
  return {
    enabled: parseBooleanEnv(env.UPSTREAM_DYNAMIC_BASE_ENABLED, false),
    allowHttp: parseBooleanEnv(env.UPSTREAM_BASE_ALLOW_HTTP, false),
    allowPrivate: parseBooleanEnv(env.UPSTREAM_BASE_ALLOW_PRIVATE, false),
    allowlist: parseAllowlist(env.UPSTREAM_BASE_ALLOWLIST)
  };
}

function resolveUpstreamBaseUrlCandidate(req, openaiRequest) {
  const headers = (req && req.headers && typeof req.headers === 'object') ? req.headers : {};
  const fromHeader = resolveFirstHeaderValue(headers, 'x-upstream-base-url');
  const fromBody = openaiRequest && typeof openaiRequest === 'object'
    ? (openaiRequest.upstream_base_url || openaiRequest.upstream_api_base || null)
    : null;
  return (fromHeader || fromBody || null);
}

function validateDynamicUpstreamBaseUrl(rawValue, policy) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { ok: true, value: null };
  }

  if (!policy || policy.enabled !== true) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Dynamic upstream base is disabled by server policy',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  const value = String(rawValue).trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: must be an absolute URL',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: only http/https protocols are allowed',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  if (protocol === 'http:' && !policy.allowHttp) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: http protocol is not allowed by policy',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  const hostname = String(parsed.hostname || '').trim().toLowerCase();
  if (!hostname) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: hostname is required',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  const privateByDefault = isLoopbackHost(hostname)
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname);
  if (privateByDefault && !policy.allowPrivate) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: private or loopback host is not allowed',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  if (isLikelyIpLiteral(hostname) && policy.allowlist.length > 0) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: IP literals are not allowed when UPSTREAM_BASE_ALLOWLIST is configured',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  if (!hostAllowedByAllowlist(hostname, policy.allowlist)) {
    return {
      ok: false,
      status: 400,
      payload: {
        message: 'Invalid upstream_base_url: host is not in allowlist',
        type: 'invalid_request_error',
        code: 'invalid_request',
        param: 'upstream_base_url'
      }
    };
  }

  parsed.hash = '';
  parsed.search = '';
  return { ok: true, value: parsed.toString().replace(/\/+$/, '') };
}

function resolvePersonaId(req, openaiRequest) {
  return (
    req.headers['x-persona-id']
    || req.headers['x-persona_id']
    || (openaiRequest && (openaiRequest.persona_id || openaiRequest.personaId))
    || (openaiRequest && openaiRequest.request && (openaiRequest.request.persona_id || openaiRequest.request.personaId))
  ) || null;
}

function prepareChatRequestContext({
  req,
  res,
  requestBody,
  requestId,
  normalizeOpenAIRequestTooling,
  validateTrailingToolBackfill,
  resolveModelProfile,
  resolveTokenBudgetDecision,
  sessionKeyService
}) {
  const basic = validateRequestBody(requestBody);
  if (!basic.ok) return basic;

  const openaiRequest = normalizeOpenAIRequestTooling(requestBody);
  const toolingBackfillError = validateTrailingToolBackfill(openaiRequest.messages);
  if (toolingBackfillError) {
    return {
      ok: false,
      endReason: 'invalid_request',
      status: 400,
      payload: {
        message: toolingBackfillError.message,
        type: 'invalid_request_error',
        code: toolingBackfillError.code,
        param: toolingBackfillError.param
      }
    };
  }

  const dynamicUpstreamPolicy = resolveDynamicUpstreamConfig(process.env || {});
  const upstreamBaseCandidate = resolveUpstreamBaseUrlCandidate(req, openaiRequest);
  const upstreamBaseDecision = validateDynamicUpstreamBaseUrl(upstreamBaseCandidate, dynamicUpstreamPolicy);
  if (!upstreamBaseDecision.ok) {
    return {
      ok: false,
      endReason: 'invalid_request',
      status: upstreamBaseDecision.status,
      payload: upstreamBaseDecision.payload
    };
  }

  if (upstreamBaseDecision.value && dynamicUpstreamPolicy.allowlist.length > 0) {
    res.locals.upstreamOverride = 'allowlist';
  } else if (upstreamBaseDecision.value) {
    res.locals.upstreamOverride = 'dynamic';
  } else {
    res.locals.upstreamOverride = 'default';
  }

  const modelProfile = resolveModelProfile(openaiRequest.model, requestId);
  const outputBudgetBase = resolveTokenBudgetDecision(
    openaiRequest,
    modelProfile,
    requestId,
    0,
    { logDecision: false, suppressWarnings: true }
  );

  const requestClient = sessionKeyService.inferClientId(req);
  const clientWantsStream = openaiRequest.stream !== false;
  const toolsPresent = Array.isArray(openaiRequest.tools) && openaiRequest.tools.length > 0;
  res.locals.client = requestClient;
  res.locals.stream = String(clientWantsStream);
  res.locals.toolsPresent = String(toolsPresent);
  res.locals.model = String(openaiRequest.model || 'unknown');
  res.locals.modelProfileSource = modelProfile.source;

  return {
    ok: true,
    openaiRequest,
    modelProfile,
    outputBudgetBase,
    clientWantsStream,
    personaId: resolvePersonaId(req, openaiRequest),
    resolvedUpstreamBaseUrl: upstreamBaseDecision.value
  };
}

module.exports = {
  validateRequestBody,
  resolvePersonaId,
  resolveUpstreamBaseUrlCandidate,
  validateDynamicUpstreamBaseUrl,
  resolveDynamicUpstreamConfig,
  prepareChatRequestContext
};
