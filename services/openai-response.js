function createOpenAIResponseService({ helpers }) {
  const {
    toOpenAIToolCallsForMessage,
    writeToolCallStream,
    writeFinalStream,
    setRequestEndReason,
    uuidv4
  } = helpers;

  function resolveSessionId(upstreamSessionId, fallbackSessionId) {
    return upstreamSessionId || fallbackSessionId || null;
  }

  function renderToolCalls({ res, clientWantsStream, streamId, model, toolCalls, upstreamSessionId, fallbackSessionId }) {
    if (clientWantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      setRequestEndReason(res, 'tool_calls');
      return writeToolCallStream(res, streamId, model, toolCalls);
    }

    const openAiToolCalls = toOpenAIToolCallsForMessage(toolCalls);
    setRequestEndReason(res, 'tool_calls');
    return res.json({
      id: `chatcmpl-${uuidv4()}`,
      session_id: resolveSessionId(upstreamSessionId, fallbackSessionId),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: openAiToolCalls
        },
        finish_reason: 'tool_calls'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  }

  function renderFinalText({ res, clientWantsStream, streamId, model, finalText, upstreamSessionId, fallbackSessionId }) {
    if (clientWantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      setRequestEndReason(res, 'stop');
      return writeFinalStream(res, streamId, model, finalText);
    }

    setRequestEndReason(res, 'stop');
    return res.json({
      id: `chatcmpl-${uuidv4()}`,
      session_id: resolveSessionId(upstreamSessionId, fallbackSessionId),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: finalText
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  }

  return {
    renderToolCalls,
    renderFinalText
  };
}

module.exports = {
  createOpenAIResponseService
};
