const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRequestBody, resolvePersonaId, prepareChatRequestContext } = require('../../services/chat-request');

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
});
