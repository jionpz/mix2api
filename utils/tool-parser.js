function trimLooseToken(token) {
  let s = String(token == null ? '' : token).trim();
  if (!s) return '';
  s = s.replace(/^[({[\s]+/, '').replace(/[)}\],\s]+$/, '');
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith('\'') && s.endsWith('\''))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseLooseScalar(value) {
  const token = trimLooseToken(value);
  if (!token) return '';
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true';
  if (/^null$/i.test(token)) return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  return token;
}

function parseLooseArguments(rawValue) {
  if (typeof rawValue !== 'string') return {};
  let text = rawValue.trim();
  if (!text) return {};

  const tryParseJson = (input) => {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  };

  const asJson = tryParseJson(text);
  if (asJson && typeof asJson === 'object') return asJson;

  if (text.startsWith('(')) {
    text = text.slice(1);
  } else if (text.startsWith('{')) {
    text = text.slice(1);
  }
  text = text.replace(/[)}\]]+\s*$/, '').trim();
  if (!text) return {};

  const pairs = {};
  const pairRegex = /([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)\s*(?:,|$)/g;
  let m;
  while ((m = pairRegex.exec(text)) !== null) {
    const key = trimLooseToken(m[1]);
    const value = parseLooseScalar(m[2]);
    if (key) pairs[key] = value;
  }
  if (Object.keys(pairs).length > 0) {
    return pairs;
  }

  const scalar = parseLooseScalar(text);
  if (scalar && typeof scalar === 'object') {
    return scalar;
  }
  if (typeof scalar === 'string' && scalar) {
    return { value: scalar };
  }
  return {};
}

function extractLooseValue(text, startIndex) {
  if (typeof text !== 'string') return '';
  let i = Math.max(0, startIndex | 0);
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return '';

  const first = text[i];
  const closeByOpen = { '{': '}', '[': ']', '(': ')' };
  const close = closeByOpen[first];
  if (!close) {
    let end = i;
    while (end < text.length && !/[,\n\r}]/.test(text[end])) end++;
    return text.slice(i, end).trim();
  }

  let depth = 0;
  let inString = false;
  let quote = '';
  let escape = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === first) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(i, j + 1).trim();
      }
      continue;
    }
    if (first === '(' && ch === '}' && depth > 0) {
      return text.slice(i, j + 1).trim();
    }
  }
  return text.slice(i).trim();
}

function parseLooseToolCallsFromText(text) {
  if (typeof text !== 'string' || !text) return null;

  const toolCalls = [];
  const marker = /\btool_call\b\s*[:=]/ig;
  let match;
  while ((match = marker.exec(text)) !== null) {
    const segment = text.slice(match.index, Math.min(text.length, match.index + 2400));
    const nameMatch = segment.match(/\bname\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s)\]}]+)/i);
    if (!nameMatch) continue;
    const name = trimLooseToken(nameMatch[1]);
    if (!name) continue;

    const argsMarker = /\barguments\s*[:=]\s*/i.exec(segment);
    let args = {};
    if (argsMarker) {
      const rawArgs = extractLooseValue(segment, argsMarker.index + argsMarker[0].length);
      args = parseLooseArguments(rawArgs);
    }
    toolCalls.push({ name, arguments: args });
  }

  if (toolCalls.length === 0) return null;
  return { toolCalls, final: null };
}

function looksLikeToolCallPayload(text) {
  if (typeof text !== 'string' || !text) return false;
  return /"tool_call"/.test(text)
    || /\btool_call\b\s*[:=]/i.test(text)
    || /\btool_calls\b\s*[:=]/i.test(text);
}

function ensureSafeFinalText(text) {
  if (typeof text === 'string') {
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return '抱歉，工具调用响应格式异常，请重试。';
}

module.exports = {
  parseLooseToolCallsFromText,
  looksLikeToolCallPayload,
  ensureSafeFinalText
};
