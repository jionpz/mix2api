function parseModelList(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  let modelCandidates = [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        modelCandidates = parsed;
      }
    } catch {
      modelCandidates = [];
    }
  }

  if (modelCandidates.length === 0) {
    modelCandidates = raw.split(/[\n,]/);
  }

  const result = [];
  const seen = new Set();
  for (const value of modelCandidates) {
    const id = String(value || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function estimateTokenByChars(chars) {
  const safeChars = Math.max(0, Number(chars) || 0);
  return Math.ceil(safeChars / 4);
}

function resolveModelIds(rawModelList, defaultModelIds) {
  const models = parseModelList(rawModelList);
  return models.length > 0 ? models : defaultModelIds;
}

module.exports = {
  parseModelList,
  estimateTokenByChars,
  resolveModelIds
};
