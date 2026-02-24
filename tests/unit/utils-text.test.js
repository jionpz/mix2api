const test = require('node:test');
const assert = require('node:assert/strict');

const { truncateTextKeepTail, truncateTextKeepHeadAndTail } = require('../../utils/text');

test('truncateTextKeepTail keeps tail with marker', () => {
  const out = truncateTextKeepTail('abcdefghij', 8, '[x]');
  assert.match(out, /^\[x\]\n/);
  assert.ok(out.includes('ghij'));
});

test('truncateTextKeepHeadAndTail keeps both sides', () => {
  const out = truncateTextKeepHeadAndTail('abcdefghijklmnopqrstuvwxyz', 14, '[cut]');
  assert.match(out, /\[cut\]/);
  assert.ok(out.startsWith('abc'));
  assert.ok(out.endsWith('xyz'));
});
