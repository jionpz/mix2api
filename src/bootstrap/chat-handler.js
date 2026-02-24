function createChatHandler(deps) {
  const {
    uuidv4,
    envInt,
    envBool,
    sendOpenAIError,
    setRequestEndReason,
    setRequestUpstreamStatus,
    resolveInboundToken,
    resolveUpstreamToken,
    inspectTokenInfo,
    prepareChatRequestContext,
    normalizeOpenAIRequestTooling,
    validateTrailingToolBackfill,
    resolveModelProfile,
    resolveTokenBudgetDecision,
    sessionKeyService,
    managedUpstreamTokenService,
    chatOrchestrationService,
    observeBudgetDecision,
    upstreamRequestService,
    UPSTREAM_AUTH_RECOVERY_RETRY,
    upstreamReadService,
    toolResponseService,
    openAIResponseService,
    startUpstreamStreamBridge,
    sessionStoreService,
    redactSensitiveText,
    fingerprint,
    extractIdsFromUpstream,
    convertUpstreamToOpenAI,
    base64UrlToJson
  } = deps;

  return async function handleChatCompletion(req, res) {
    const requestId = req.requestId || String(res.getHeader('x-request-id') || uuidv4());
    if (!res.getHeader('x-request-id')) res.setHeader('x-request-id', requestId);
    try {
      const requestBody = req.body;
      const authHeader = req.headers.authorization;
      const inboundAuthMode = String(process.env.INBOUND_AUTH_MODE || 'bearer').toLowerCase();
      const upstreamAuthMode = String(process.env.UPSTREAM_AUTH_MODE || 'pass_through').toLowerCase();
      const expectedInboundToken = process.env.INBOUND_BEARER_TOKEN || null;
      const staticUpstreamToken = process.env.UPSTREAM_BEARER_TOKEN || null;

      const streamId = `chatcmpl-${uuidv4()}`;

      const inboundAuth = resolveInboundToken({ authHeader, inboundAuthMode, expectedInboundToken });
      if (!inboundAuth.ok) {
        setRequestEndReason(res, inboundAuth.endReason);
        return sendOpenAIError(res, inboundAuth.status, inboundAuth.payload);
      }
      const inboundToken = inboundAuth.inboundToken;

      const requestContext = prepareChatRequestContext({
        req,
        res,
        requestBody,
        requestId,
        normalizeOpenAIRequestTooling,
        validateTrailingToolBackfill,
        resolveModelProfile,
        resolveTokenBudgetDecision,
        sessionKeyService
      });
      if (!requestContext.ok) {
        setRequestEndReason(res, requestContext.endReason);
        return sendOpenAIError(res, requestContext.status, requestContext.payload);
      }
      const openaiRequest = requestContext.openaiRequest;
      const modelProfile = requestContext.modelProfile;
      const outputBudgetBase = requestContext.outputBudgetBase;
      const clientWantsStream = requestContext.clientWantsStream;

      const upstreamAuth = await resolveUpstreamToken({
        upstreamAuthMode,
        inboundToken,
        staticUpstreamToken,
        requestId,
        managedUpstreamTokenService
      });
      if (!upstreamAuth.ok) {
        setRequestEndReason(res, upstreamAuth.endReason);
        return sendOpenAIError(res, upstreamAuth.status, upstreamAuth.payload);
      }
      let upstreamToken = upstreamAuth.upstreamToken;

      const tokenInfo = inspectTokenInfo({
        upstreamToken,
        logTokenInfoEnabled: envBool('LOG_TOKEN_INFO', false),
        base64UrlToJson
      });
      if (!tokenInfo.ok) {
        setRequestEndReason(res, tokenInfo.endReason);
        return res.status(tokenInfo.status).json(tokenInfo.rawJson);
      }

      const sessionContext = await chatOrchestrationService.resolveSessionContext({
        req,
        openaiRequest,
        inboundToken,
        sessionKeyService,
        sessionStoreService
      });
      let sessionId = sessionContext.sessionId;
      let exchangeId = sessionContext.exchangeId;
      const storeKey = sessionContext.storeKey;
      let storedSession = sessionContext.storedSession;

      const personaId = requestContext.personaId;

      const orchestration = chatOrchestrationService.prepareUpstreamRequest({
        openaiRequest,
        sessionId,
        exchangeId,
        personaId,
        storedSession,
        modelProfile,
        outputBudgetBase,
        requestId
      });
      let upstreamRequest = orchestration.upstreamRequest;
      let toolMode = orchestration.toolMode;
      let hasToolResults = orchestration.hasToolResults;
      const contextManagement = orchestration.contextManagement;
      const effectiveTokenBudgetDecision = orchestration.effectiveTokenBudgetDecision;
      observeBudgetDecision(res, requestId, openaiRequest.model, effectiveTokenBudgetDecision, contextManagement);
      if (effectiveTokenBudgetDecision.action === 'reject') {
        setRequestEndReason(res, 'invalid_request');
        return sendOpenAIError(res, 400, {
          message: (
            `Input exceeds available input budget (${effectiveTokenBudgetDecision.estimatedInputTokens} > ` +
            `${effectiveTokenBudgetDecision.availableInputTokens}); reduce messages/tools or max_tokens`
          ),
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          param: 'messages'
        });
      }

      console.log(`[${requestId}] 🔧 toolMode=${toolMode}, hasToolResults=${hasToolResults}, stream=${upstreamRequest.stream}, turnCount=${storedSession ? storedSession.turnCount : 0}`);

      const logBodies = envBool('LOG_BODIES', false);
      if (logBodies) {
        console.log(`[${requestId}] OpenAI Request:`, JSON.stringify(openaiRequest, null, 2));
        console.log(`[${requestId}] Upstream Request:`, JSON.stringify(upstreamRequest, null, 2));
      } else {
        console.log(`[${requestId}] toolMode=${toolMode} stream(client)=${clientWantsStream} stream(upstream)=${upstreamRequest.stream} model=${openaiRequest.model}`);
      }

      const timeoutMs = envInt('UPSTREAM_TIMEOUT_MS', 180_000);
      const retryCount = envInt('UPSTREAM_RETRY_COUNT', 0);
      const retryBaseMs = envInt('UPSTREAM_RETRY_BASE_MS', 250);

      const upstreamCall = await upstreamRequestService.fetchWithAuthRecovery({
        requestId,
        upstreamRequest,
        upstreamToken,
        upstreamAuthMode,
        authRecoveryRetry: UPSTREAM_AUTH_RECOVERY_RETRY,
        timeoutMs,
        retryCount,
        retryBaseMs,
        shouldRecover: (response) => managedUpstreamTokenService.shouldRecoverManagedTokenFromResponse(response),
        clearManagedToken: (reason, rid) => managedUpstreamTokenService.clearManagedUpstreamToken(reason, rid),
        refreshManagedToken: ({ requestId: rid, forceRefresh }) => managedUpstreamTokenService.getManagedUpstreamToken({ requestId: rid, forceRefresh })
      });
      upstreamToken = upstreamCall.upstreamToken;
      const response = upstreamCall.response;
      setRequestUpstreamStatus(res, response.status);
      console.log(`[${requestId}] Upstream Response: status=${response.status}, content-type=${response.headers.get('content-type')}`);

      if (!response.ok) {
        const error = await response.text();
        console.error(`[${requestId}] Upstream API Error:`, redactSensitiveText(error));
        setRequestEndReason(res, 'upstream_error');
        return sendOpenAIError(res, response.status, {
          message: `Upstream API error: ${response.statusText || response.status}`,
          type: 'api_error',
          code: 'upstream_http_error',
          param: null
        });
      }

      const upstreamContentType = String(response.headers.get('content-type') || '').toLowerCase();
      const useDirectStreamBridge = clientWantsStream && upstreamRequest.stream && upstreamContentType.includes('text/event-stream');

      if (useDirectStreamBridge) {
        startUpstreamStreamBridge({
          req,
          res,
          response,
          requestId,
          storeKey,
          model: openaiRequest.model,
          streamId,
          logBodies,
          sessionStoreService,
          setRequestEndReason,
          redactSensitiveText,
          fingerprint,
          extractIdsFromUpstream,
          convertUpstreamToOpenAI
        });
      } else {
        let text = '';
        let upstreamSessionId = null;
        let upstreamExchangeId = null;
        if (upstreamContentType.includes('text/event-stream')) {
          const result = await upstreamReadService.readUpstreamStream(response);
          text = result.text;
          upstreamSessionId = result.sessionId || null;
          upstreamExchangeId = result.exchangeId || null;
        } else {
          const nonStreamResult = await upstreamReadService.readNonStreamJsonResponse(response, { requestId, logBodies });
          const upstreamError = nonStreamResult.upstreamError;
          if (upstreamError) {
            console.error(`[${requestId}] ❌ Upstream error:`, upstreamError);
            setRequestEndReason(res, 'upstream_error');
            return sendOpenAIError(res, 502, {
              message: `Upstream error: ${upstreamError}`,
              type: 'api_error',
              code: 'upstream_error',
              param: null
            });
          }
          upstreamSessionId = nonStreamResult.upstreamSessionId || upstreamSessionId;
          upstreamExchangeId = nonStreamResult.upstreamExchangeId || upstreamExchangeId;
          text = nonStreamResult.text;
        }

        if (upstreamSessionId) {
          await sessionStoreService.updateStoredSession(storeKey, upstreamSessionId, upstreamExchangeId);
        }
        if (upstreamSessionId && !res.getHeader('x-session-id')) {
          res.setHeader('x-session-id', upstreamSessionId);
        }

        const toolResponse = toolResponseService.evaluate({
          text,
          toolMode,
          tools: openaiRequest.tools,
          logToolParse: envBool('LOG_TOOL_PARSE', false),
          requestId
        });

        if (toolResponse.type === 'tool_calls') {
          return openAIResponseService.renderToolCalls({
            res,
            clientWantsStream,
            streamId,
            model: openaiRequest.model,
            toolCalls: toolResponse.toolCalls,
            upstreamSessionId,
            fallbackSessionId: sessionId
          });
        }

        const finalText = toolResponse.finalText;
        return openAIResponseService.renderFinalText({
          res,
          clientWantsStream,
          streamId,
          model: openaiRequest.model,
          finalText,
          upstreamSessionId,
          fallbackSessionId: sessionId
        });
      }
    } catch (error) {
      const isAbort = error && (error.name === 'AbortError' || error.type === 'aborted' || String(error.message || '').toLowerCase().includes('aborted'));
      if (isAbort) {
        console.warn('Upstream request aborted (timeout):', error && error.message ? error.message : String(error));
        setRequestEndReason(res, 'timeout');
        return sendOpenAIError(res, 504, {
          message: 'Upstream timeout',
          type: 'api_error',
          code: 'upstream_timeout',
          param: null
        });
      }

      const safeError = redactSensitiveText(error && error.message ? error.message : String(error));
      console.error('Adapter error:', safeError);
      setRequestEndReason(res, 'adapter_error');
      const expose = envBool('EXPOSE_STACK', false);
      return sendOpenAIError(res, 500, {
        message: safeError || 'Internal server error',
        type: 'server_error',
        code: 'internal_server_error',
        param: null,
        ...(expose ? { stack: error && error.stack ? error.stack : String(error) } : {})
      });
    }
  };
}

module.exports = {
  createChatHandler
};
