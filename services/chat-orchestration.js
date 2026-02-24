function createChatOrchestrationService({ helpers }) {
  const {
    fingerprint,
    convertToUpstreamFormat,
    resolveTokenBudgetDecision,
    estimateUpstreamInputTokens
  } = helpers;

  async function resolveSessionContext({ req, openaiRequest, inboundToken, sessionKeyService, sessionStoreService }) {
    const sessionIdFromHeader = req.headers['x-session-id'] || req.headers['x-session_id'] || null;
    const sessionIdFromBody = openaiRequest && (
      openaiRequest.session_id
      || openaiRequest.sessionId
      || (openaiRequest.metadata && (openaiRequest.metadata.session_id || openaiRequest.metadata.sessionId))
    ) || null;
    const exchangeIdFromHeader = req.headers['x-exchange-id'] || req.headers['x-exchange_id'] || null;
    const exchangeIdFromBody = openaiRequest && (
      openaiRequest.exchange_id
      || openaiRequest.exchangeId
      || (openaiRequest.metadata && (openaiRequest.metadata.exchange_id || openaiRequest.metadata.exchangeId))
    ) || null;
    let sessionId = sessionIdFromHeader || sessionIdFromBody || null;
    let exchangeId = exchangeIdFromHeader || exchangeIdFromBody || null;
    const storeKey = sessionKeyService.getSessionStoreKey(req, openaiRequest.model, inboundToken || '');

    if (sessionId === 'new') {
      await sessionStoreService.clearStoredSession(storeKey);
      sessionId = null;
      exchangeId = null;
      console.log(`ℹ Client requested new session (key=${storeKey})`);
    }

    let storedSession = await sessionStoreService.getStoredSession(storeKey);

    if (!storedSession || !storedSession.sessionId) {
      if (sessionId || exchangeId) {
        console.log(`ℹ Session bootstrap: ignore client-provided session/exchange and request new upstream session (key=${storeKey})`);
      }
      sessionId = null;
      exchangeId = null;
    } else {
      if (!sessionId) {
        sessionId = storedSession.sessionId;
        if (!exchangeId && storedSession.exchangeId) {
          exchangeId = storedSession.exchangeId;
        }
        console.log(`ℹ Auto-session from store: session_fp=${fingerprint(sessionId)} (key=${storeKey})`);
      }
      if (storedSession && sessionId && storedSession.sessionId && storedSession.sessionId !== sessionId) {
        storedSession = null;
      }
      if (storedSession && !exchangeId && storedSession.exchangeId) {
        exchangeId = storedSession.exchangeId;
      }
    }

    return {
      sessionId,
      exchangeId,
      storeKey,
      storedSession
    };
  }

  function prepareUpstreamRequest({
    openaiRequest,
    sessionId,
    exchangeId,
    personaId,
    storedSession,
    modelProfile,
    outputBudgetBase,
    requestId
  }) {
    let {
      upstreamRequest,
      toolMode,
      hasToolResults,
      contextManagement
    } = convertToUpstreamFormat(
      openaiRequest,
      sessionId,
      exchangeId,
      personaId,
      storedSession,
      modelProfile,
      outputBudgetBase,
      requestId
    );

    const tokenBudgetDecision = resolveTokenBudgetDecision(
      openaiRequest,
      modelProfile,
      requestId,
      estimateUpstreamInputTokens(upstreamRequest)
    );

    let effectiveTokenBudgetDecision = tokenBudgetDecision;
    if (effectiveTokenBudgetDecision.action === 'reject') {
      const recovered = convertToUpstreamFormat(
        openaiRequest,
        sessionId,
        exchangeId,
        personaId,
        storedSession,
        modelProfile,
        outputBudgetBase,
        requestId,
        { mode: 'budget_recover' }
      );
      const recoveredDecision = resolveTokenBudgetDecision(
        openaiRequest,
        modelProfile,
        requestId,
        estimateUpstreamInputTokens(recovered.upstreamRequest)
      );
      contextManagement = recovered.contextManagement;
      if (recoveredDecision.action !== 'reject') {
        upstreamRequest = recovered.upstreamRequest;
        toolMode = recovered.toolMode;
        hasToolResults = recovered.hasToolResults;
        effectiveTokenBudgetDecision = recoveredDecision;
      }
    }

    return {
      upstreamRequest,
      toolMode,
      hasToolResults,
      contextManagement,
      effectiveTokenBudgetDecision
    };
  }

  return {
    resolveSessionContext,
    prepareUpstreamRequest
  };
}

module.exports = {
  createChatOrchestrationService
};
