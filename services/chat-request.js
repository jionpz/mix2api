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
    personaId: resolvePersonaId(req, openaiRequest)
  };
}

module.exports = {
  validateRequestBody,
  resolvePersonaId,
  prepareChatRequestContext
};
