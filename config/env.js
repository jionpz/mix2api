function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function envJson(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  try {
    return JSON.parse(String(raw));
  } catch {
    console.warn(`⚠ Invalid JSON in ${name}, fallback to default value`);
    return fallback;
  }
}

module.exports = {
  envInt,
  envBool,
  envJson
};
