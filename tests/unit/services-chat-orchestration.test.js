const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatOrchestrationService } = require('../../services/chat-orchestration');

function createService(overrides = {}) {
  return createChatOrchestrationService({
    helpers: {
      fingerprint: (v) => `fp_${String(v || '')}`,
      convertToUpstreamFormat: (...args) => ({
        upstreamRequest: { argsLen: args.length },
        toolMode: false,
        hasToolResults: false,
        contextManagement: { mode: args[8] && args[8].mode ? args[8].mode : 'default' }
      }),
      resolveTokenBudgetDecision: () => ({ action: 'allow' }),
      estimateUpstreamInputTokens: () => 10,
      ...overrides
    }
  });
}

test('resolveSessionContext prefers store session when explicit session missing', async () => {
  const service = createService();
  const sessionStoreService = {
    clearStoredSession: async () => {},
    getStoredSession: async () => ({ sessionId: 's1', exchangeId: 'e1', turnCount: 1 })
  };
  const sessionKeyService = {
    getSessionStoreKey: () => 'k1'
  };

  const out = await service.resolveSessionContext({
    req: { headers: {} },
    openaiRequest: { model: 'm1' },
    inboundToken: 't1',
    sessionKeyService,
    sessionStoreService
  });

  assert.equal(out.storeKey, 'k1');
  assert.equal(out.sessionId, 's1');
  assert.equal(out.exchangeId, 'e1');
  assert.equal(out.storedSession.sessionId, 's1');
});

test('resolveSessionContext clears store when session is new', async () => {
  const service = createService();
  let cleared = false;
  const sessionStoreService = {
    clearStoredSession: async () => {
      cleared = true;
    },
    getStoredSession: async () => null
  };
  const sessionKeyService = {
    getSessionStoreKey: () => 'k2'
  };

  const out = await service.resolveSessionContext({
    req: { headers: { 'x-session-id': 'new' } },
    openaiRequest: { model: 'm1' },
    inboundToken: 't2',
    sessionKeyService,
    sessionStoreService
  });

  assert.equal(cleared, true);
  assert.equal(out.sessionId, null);
  assert.equal(out.exchangeId, null);
});

test('prepareUpstreamRequest applies budget recover when initial decision rejects', () => {
  const service = createService({
    resolveTokenBudgetDecision: (() => {
      let n = 0;
      return () => {
        n++;
        if (n === 1) return { action: 'reject', estimatedInputTokens: 20, availableInputTokens: 10 };
        return { action: 'allow' };
      };
    })()
  });

  const out = service.prepareUpstreamRequest({
    openaiRequest: { model: 'm' },
    sessionId: 's',
    exchangeId: 'e',
    personaId: null,
    storedSession: null,
    modelProfile: {},
    outputBudgetBase: {},
    requestId: 'r'
  });

  assert.equal(out.effectiveTokenBudgetDecision.action, 'allow');
  assert.equal(out.contextManagement.mode, 'budget_recover');
});
