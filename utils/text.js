function truncateTextKeepTail(text, maxChars, marker) {
  if (typeof text !== 'string') return '';
  if (!maxChars || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  const m = marker || '[已截断]';
  const keep = Math.max(0, maxChars - m.length - 1);
  return `${m}\n${text.slice(text.length - keep)}`;
}

function truncateTextKeepHeadAndTail(text, maxChars, marker, headRatio = 0.6) {
  if (typeof text !== 'string') return '';
  if (!maxChars || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;

  const m = marker || '[已截断]';
  const ratio = (typeof headRatio === 'number' && headRatio > 0 && headRatio < 1) ? headRatio : 0.6;

  const budget = maxChars - m.length - 2;
  if (budget <= 0) return m.slice(0, Math.max(0, maxChars));

  const headBudget = Math.max(0, Math.floor(budget * ratio));
  const tailBudget = Math.max(0, budget - headBudget);
  const headText = text.slice(0, headBudget).trimEnd();
  const tailText = tailBudget > 0 ? text.slice(text.length - tailBudget).trimStart() : '';
  if (!tailText) {
    return truncateTextKeepTail(text, maxChars, m);
  }
  return `${headText}\n${m}\n${tailText}`;
}

module.exports = {
  truncateTextKeepTail,
  truncateTextKeepHeadAndTail
};
