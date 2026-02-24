function extractJsonObjectsFromText(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString && ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function extractJsonFromText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    return fenced[1];
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function extractFinalFromTextProtocol(text) {
  if (typeof text !== 'string' || !text) return null;
  const objects = extractJsonObjectsFromText(text);
  for (const jsonText of objects) {
    try {
      const obj = JSON.parse(jsonText);
      if (obj && typeof obj.final === 'string' && obj.final) return obj.final;
    } catch {}
  }
  return null;
}

module.exports = {
  extractJsonObjectsFromText,
  extractJsonFromText,
  extractFinalFromTextProtocol
};
