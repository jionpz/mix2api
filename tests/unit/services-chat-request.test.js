const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateRequestBody,
  resolvePersonaId,
  resolveUpstreamBaseUrlCandidate,
  validateDynamicUpstreamBaseUrl,
  resolveDynamicUpstreamConfig,
  prepareChatRequestContext
} = require('../../services/chat-request');

test('validateRequestBody rejects invalid shape and accepts minimal valid request', () => {
  assert.equal(validateRequestBody(null).ok, false);
  assert.equal(validateRequestBody({ model: '', messages: [] }).ok, false);
  assert.equal(validateRequestBody({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }).ok, true);
});

test('resolvePersonaId resolves from header then body', () => {
  const fromHeader = resolvePersonaId({ headers: { 'x-persona-id': 'p1' } }, { persona_id: 'p2' });
  assert.equal(fromHeader, 'p1');
  const fromBody = resolvePersonaId({ headers: {} }, { persona_id: 'p2' });
  assert.equal(fromBody, 'p2');
});

test('prepareChatRequestContext sets locals and returns normalized context', () => {
  const res = { locals: {} };
  const out = prepareChatRequestContext({
    req: { headers: {}, body: null },
    res,
    requestBody: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true },
    requestId: 'r1',
    normalizeOpenAIRequestTooling: (body) => ({ ...body, tools: [] }),
    validateTrailingToolBackfill: () => null,
    resolveModelProfile: () => ({ source: 'default' }),
    resolveTokenBudgetDecision: () => ({ action: 'allow' }),
    sessionKeyService: { inferClientId: () => 'opencode' }
  });

  assert.equal(out.ok, true);
  assert.equal(out.openaiRequest.model, 'm1');
  assert.equal(out.clientWantsStream, true);
  assert.equal(res.locals.client, 'opencode');
  assert.equal(res.locals.modelProfileSource, 'default');
  assert.equal(res.locals.upstreamOverride, 'default');
  assert.equal(out.resolvedUpstreamBaseUrl, null);
});

test('resolveUpstreamBaseUrlCandidate prefers header over body fields', () => {
  const fromHeader = resolveUpstreamBaseUrlCandidate(
    { headers: { 'x-upstream-base-url': 'https://header.example' } },
    { upstream_base_url: 'https://body.example' }
  );
  assert.equal(fromHeader, 'https://header.example');

  const fromBody = resolveUpstreamBaseUrlCandidate(
    { headers: {} },
    { upstream_base_url: 'https://body.example' }
  );
  assert.equal(fromBody, 'https://body.example');

  const fromAlias = resolveUpstreamBaseUrlCandidate(
    { headers: {} },
    { upstream_api_base: 'https://alias.example' }
  );
  assert.equal(fromAlias, 'https://alias.example');

  const fromCaseVariantHeader = resolveUpstreamBaseUrlCandidate(
    { headers: { 'X-Upstream-Base-Url': 'https://header-variant.example' } },
    { upstream_base_url: 'https://body.example' }
  );
  assert.equal(fromCaseVariantHeader, 'https://header-variant.example');
});

test('resolveDynamicUpstreamConfig parses toggles and allowlist', () => {
  const cfg = resolveDynamicUpstreamConfig({
    UPSTREAM_DYNAMIC_BASE_ENABLED: 'true',
    UPSTREAM_BASE_ALLOW_HTTP: 'yes',
    UPSTREAM_BASE_ALLOW_PRIVATE: '1',
    UPSTREAM_BASE_ALLOWLIST: 'a.example, b.example '
  });
  assert.deepEqual(cfg, {
    enabled: true,
    allowHttp: true,
    allowPrivate: true,
    allowlist: ['a.example', 'b.example']
  });
});

test('validateDynamicUpstreamBaseUrl enforces policy guardrails', () => {
  const strictPolicy = {
    enabled: true,
    allowHttp: false,
    allowPrivate: false,
    allowlist: []
  };

  const ok = validateDynamicUpstreamBaseUrl('https://api.example/v1?q=1', strictPolicy);
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'https://api.example/v1');

  const denyHttp = validateDynamicUpstreamBaseUrl('http://api.example', strictPolicy);
  assert.equal(denyHttp.ok, false);
  assert.equal(denyHttp.payload.param, 'upstream_base_url');

  const denyLoopback = validateDynamicUpstreamBaseUrl('https://127.0.0.1:3000', strictPolicy);
  assert.equal(denyLoopback.ok, false);

  const denyIpv4MappedLoopback = validateDynamicUpstreamBaseUrl('https://[::ffff:127.0.0.1]:3000', strictPolicy);
  assert.equal(denyIpv4MappedLoopback.ok, false);

  const allowlisted = validateDynamicUpstreamBaseUrl('https://svc.allowed.example', {
    enabled: true,
    allowHttp: false,
    allowPrivate: false,
    allowlist: ['allowed.example']
  });
  assert.equal(allowlisted.ok, true);

  const denyByAllowlist = validateDynamicUpstreamBaseUrl('https://blocked.example', {
    enabled: true,
    allowHttp: false,
    allowPrivate: false,
    allowlist: ['allowed.example']
  });
  assert.equal(denyByAllowlist.ok, false);
});

test('prepareChatRequestContext validates dynamic upstream override and returns normalized value', () => {
  const saved = {
    UPSTREAM_DYNAMIC_BASE_ENABLED: process.env.UPSTREAM_DYNAMIC_BASE_ENABLED,
    UPSTREAM_BASE_ALLOW_HTTP: process.env.UPSTREAM_BASE_ALLOW_HTTP,
    UPSTREAM_BASE_ALLOW_PRIVATE: process.env.UPSTREAM_BASE_ALLOW_PRIVATE,
    UPSTREAM_BASE_ALLOWLIST: process.env.UPSTREAM_BASE_ALLOWLIST
  };

  process.env.UPSTREAM_DYNAMIC_BASE_ENABLED = 'true';
  process.env.UPSTREAM_BASE_ALLOW_HTTP = 'false';
  process.env.UPSTREAM_BASE_ALLOW_PRIVATE = 'false';
  process.env.UPSTREAM_BASE_ALLOWLIST = 'allowed.example';

  try {
    const res = { locals: {} };
    const out = prepareChatRequestContext({
      req: { headers: { 'x-upstream-base-url': 'https://api.allowed.example/v2/chats?x=1' }, body: null },
      res,
      requestBody: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: false },
      requestId: 'r1',
      normalizeOpenAIRequestTooling: (body) => ({ ...body, tools: [] }),
      validateTrailingToolBackfill: () => null,
      resolveModelProfile: () => ({ source: 'default' }),
      resolveTokenBudgetDecision: () => ({ action: 'allow' }),
      sessionKeyService: { inferClientId: () => 'opencode' }
    });

    assert.equal(out.ok, true);
    assert.equal(out.resolvedUpstreamBaseUrl, 'https://api.allowed.example/v2/chats');
    assert.equal(res.locals.upstreamOverride, 'allowlist');

    const denied = prepareChatRequestContext({
      req: { headers: { 'x-upstream-base-url': 'https://evil.example' }, body: null },
      res: { locals: {} },
      requestBody: { model: 'm1', messages: [{ role: 'user', content: 'hi' }] },
      requestId: 'r2',
      normalizeOpenAIRequestTooling: (body) => ({ ...body, tools: [] }),
      validateTrailingToolBackfill: () => null,
      resolveModelProfile: () => ({ source: 'default' }),
      resolveTokenBudgetDecision: () => ({ action: 'allow' }),
      sessionKeyService: { inferClientId: () => 'opencode' }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 400);
    assert.equal(denied.payload.param, 'upstream_base_url');
  } finally {
    process.env.UPSTREAM_DYNAMIC_BASE_ENABLED = saved.UPSTREAM_DYNAMIC_BASE_ENABLED;
    process.env.UPSTREAM_BASE_ALLOW_HTTP = saved.UPSTREAM_BASE_ALLOW_HTTP;
    process.env.UPSTREAM_BASE_ALLOW_PRIVATE = saved.UPSTREAM_BASE_ALLOW_PRIVATE;
    process.env.UPSTREAM_BASE_ALLOWLIST = saved.UPSTREAM_BASE_ALLOWLIST;
  }
});
