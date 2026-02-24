function createToolResponseService({ helpers }) {
  const {
    extractTextFromUpstreamResponse,
    parseToolCallFromText,
    normalizeToolCallArguments,
    validateAndFilterToolCalls,
    extractFinalFromTextProtocol,
    looksLikeToolCallPayload,
    ensureSafeFinalText
  } = helpers;

  function buildFallbackText(parsed, actualText, rawText) {
    const rawFinalText = (parsed && parsed.final)
      ? parsed.final
      : (
        extractFinalFromTextProtocol(actualText)
        || (typeof actualText === 'string' && !looksLikeToolCallPayload(actualText) ? actualText : null)
        || (() => {
          const extracted = extractTextFromUpstreamResponse(rawText);
          return looksLikeToolCallPayload(extracted) ? null : extracted;
        })()
      );
    return ensureSafeFinalText(rawFinalText);
  }

  function evaluate({ text, toolMode, tools, logToolParse, requestId }) {
    const shouldParseTools = toolMode || (Array.isArray(tools) && tools.length > 0);
    if (!shouldParseTools) {
      return {
        type: 'text',
        finalText: extractTextFromUpstreamResponse(text)
      };
    }

    if (logToolParse) {
      console.log(`[${requestId}] 📝 Raw text from upstream:`, String(text || '').substring(0, 500));
    }
    const actualText = extractTextFromUpstreamResponse(text);
    if (logToolParse) {
      console.log(`[${requestId}] 📄 Extracted text:`, String(actualText || '').substring(0, 300));
    }
    const parsed = parseToolCallFromText(actualText);
    if (logToolParse) {
      console.log(`[${requestId}] 🔍 Parsed result:`, JSON.stringify(parsed));
    }

    if (parsed && parsed.toolCalls) {
      console.log(`✅ Parsed tool calls: ${parsed.toolCalls.map((t) => t.name).join(', ')}`);
      const normalizedToolCalls = normalizeToolCallArguments(parsed.toolCalls);
      const validToolCalls = validateAndFilterToolCalls(normalizedToolCalls, tools);
      if (validToolCalls.length > 0) {
        console.log(`✅ Valid tool calls: ${validToolCalls.map((t) => t.name).join(', ')}`);
        return {
          type: 'tool_calls',
          toolCalls: validToolCalls
        };
      }
      console.warn('⚠ All tool calls filtered out (invalid tools), treating as text response');
      return {
        type: 'text',
        finalText: buildFallbackText(parsed, actualText, text)
      };
    }

    if (!parsed) {
      console.warn('⚠ Tool mode: no tool_call parsed, fallback to final response');
    }

    return {
      type: 'text',
      finalText: buildFallbackText(parsed, actualText, text)
    };
  }

  return {
    evaluate
  };
}

module.exports = {
  createToolResponseService
};
