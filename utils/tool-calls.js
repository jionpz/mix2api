const { v4: uuidv4 } = require('uuid');

function validateAndFilterToolCalls(toolCalls, validTools) {
  if (!Array.isArray(validTools) || validTools.length === 0) {
    return toolCalls;
  }

  const validToolNames = new Set();
  validTools.forEach((tool) => {
    if (!tool) return;
    if (tool.type && tool.type !== 'function') return;
    const fn = tool.function || tool;
    if (fn && fn.name) validToolNames.add(fn.name);
  });

  if (validToolNames.size === 0) {
    return [];
  }

  return toolCalls.filter((call) => {
    if (validToolNames.has(call.name)) {
      return true;
    }
    console.warn(`⚠ Tool '${call.name}' not in valid tools list, ignoring`);
    return false;
  });
}

function normalizeToolCallArguments(toolCalls) {
  if (!Array.isArray(toolCalls)) return toolCalls;
  const isJsonLike = (s) => typeof s === 'string' && /^[\s]*[\[{]/.test(s);
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };

  return toolCalls.map((call) => {
    if (!call) return call;
    let args = call.arguments;

    if (typeof args === 'string') {
      args = tryParse(args);
    }

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const normalized = { ...args };
      for (const key of Object.keys(normalized)) {
        const val = normalized[key];
        if (isJsonLike(val)) {
          normalized[key] = tryParse(val);
        }
      }
      args = normalized;
    }

    return { ...call, arguments: args };
  });
}

function normalizeToolCallId(rawId) {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  return safe.startsWith('call_') ? safe : `call_${safe}`;
}

function attachStableToolCallIds(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  const seen = new Set();
  return toolCalls
    .filter((call) => call && typeof call === 'object' && typeof call.name === 'string' && call.name)
    .map((call) => {
      const preferredId = normalizeToolCallId(call.id || call.tool_call_id || call.toolCallId);
      let resolvedId = preferredId || `call_${uuidv4()}`;
      while (seen.has(resolvedId)) {
        resolvedId = `call_${uuidv4()}`;
      }
      seen.add(resolvedId);
      return {
        ...call,
        id: resolvedId
      };
    });
}

function toOpenAIToolCallsForChunk(toolCalls) {
  const callsWithIds = attachStableToolCallIds(toolCalls);
  return callsWithIds.map((call, index) => ({
    index,
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {})
    }
  }));
}

function toOpenAIToolCallsForMessage(toolCalls) {
  const callsWithIds = attachStableToolCallIds(toolCalls);
  return callsWithIds.map((call) => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {})
    }
  }));
}

module.exports = {
  validateAndFilterToolCalls,
  normalizeToolCallArguments,
  toOpenAIToolCallsForChunk,
  toOpenAIToolCallsForMessage
};
