function resolveInboundToken({ authHeader, inboundAuthMode, expectedInboundToken }) {
  if (inboundAuthMode === 'none') {
    return { ok: true, inboundToken: null };
  }

  if (!authHeader) {
    return {
      ok: false,
      endReason: 'auth_error',
      status: 401,
      payload: {
        message: 'Missing authorization header',
        type: 'authentication_error',
        code: 'unauthorized',
        param: null
      }
    };
  }

  const m = String(authHeader).match(/^\s*Bearer\s+(.+)\s*$/i);
  if (!m) {
    return {
      ok: false,
      endReason: 'auth_error',
      status: 401,
      payload: {
        message: 'Invalid authorization header (expected Bearer token)',
        type: 'authentication_error',
        code: 'unauthorized',
        param: 'authorization'
      }
    };
  }

  const inboundToken = m[1];
  if (expectedInboundToken && inboundToken !== expectedInboundToken) {
    return {
      ok: false,
      endReason: 'auth_error',
      status: 401,
      payload: {
        message: 'Invalid inbound token',
        type: 'authentication_error',
        code: 'unauthorized',
        param: 'authorization'
      }
    };
  }

  return { ok: true, inboundToken };
}

async function resolveUpstreamToken({
  upstreamAuthMode,
  inboundToken,
  staticUpstreamToken,
  requestId,
  managedUpstreamTokenService
}) {
  if (upstreamAuthMode === 'pass_through') {
    if (!inboundToken) {
      return {
        ok: false,
        endReason: 'adapter_error',
        status: 500,
        payload: {
          message: 'Invalid server config: UPSTREAM_AUTH_MODE=pass_through requires inbound Bearer token',
          type: 'server_error',
          code: 'invalid_server_config',
          param: 'UPSTREAM_AUTH_MODE'
        }
      };
    }
    return { ok: true, upstreamToken: inboundToken };
  }

  if (upstreamAuthMode === 'static') {
    if (!staticUpstreamToken) {
      return {
        ok: false,
        endReason: 'adapter_error',
        status: 500,
        payload: {
          message: 'Invalid server config: UPSTREAM_AUTH_MODE=static requires UPSTREAM_BEARER_TOKEN',
          type: 'server_error',
          code: 'invalid_server_config',
          param: 'UPSTREAM_BEARER_TOKEN'
        }
      };
    }
    return { ok: true, upstreamToken: staticUpstreamToken };
  }

  if (upstreamAuthMode === 'managed') {
    try {
      const upstreamToken = await managedUpstreamTokenService.getManagedUpstreamToken({ requestId, forceRefresh: false });
      return { ok: true, upstreamToken };
    } catch (error) {
      return {
        ok: false,
        endReason: 'upstream_error',
        status: 502,
        payload: {
          message: error && error.message ? error.message : 'Failed to obtain upstream token',
          type: 'api_error',
          code: 'upstream_auth_error',
          param: null
        }
      };
    }
  }

  if (upstreamAuthMode === 'none') {
    return { ok: true, upstreamToken: null };
  }

  return {
    ok: false,
    endReason: 'adapter_error',
    status: 500,
    payload: {
      message: `Invalid UPSTREAM_AUTH_MODE: ${upstreamAuthMode}`,
      type: 'server_error',
      code: 'invalid_server_config',
      param: 'UPSTREAM_AUTH_MODE'
    }
  };
}

function inspectTokenInfo({ upstreamToken, logTokenInfoEnabled, base64UrlToJson }) {
  if (!logTokenInfoEnabled || !upstreamToken) {
    return { ok: true };
  }

  try {
    const parts = upstreamToken.split('.');
    if (parts.length !== 3) return { ok: true };

    const payload = base64UrlToJson(parts[1]);
    if (!payload) throw new Error('Invalid JWT payload');
    const exp = new Date(payload.exp * 1000);
    const now = new Date();
    console.log(`Token Info: exp=${exp.toISOString()}, remaining=${Math.floor((exp - now) / 1000 / 60)}min`);

    if (exp < now) {
      return {
        ok: false,
        endReason: 'upstream_error',
        status: 401,
        rawJson: {
          error: {
            message: 'Token expired',
            details: `Token过期时间: ${exp.toISOString()}, 当前时间: ${now.toISOString()}`
          }
        }
      };
    }
  } catch (e) {
    console.warn('⚠ Token parse failed:', e.message);
  }

  return { ok: true };
}

module.exports = {
  resolveInboundToken,
  resolveUpstreamToken,
  inspectTokenInfo
};
