const test = require('node:test');
const assert = require('node:assert/strict');

const { parseModelList, estimateTokenByChars, resolveModelIds } = require('../../config/model-utils');

test('parseModelList supports json array and csv/newline formats', () => {
  assert.deepEqual(parseModelList('["a","b","a"]'), ['a', 'b']);
  assert.deepEqual(parseModelList('a,b\nc'), ['a', 'b', 'c']);
  assert.deepEqual(parseModelList(''), []);
});

test('estimateTokenByChars returns ceil(chars/4)', () => {
  assert.equal(estimateTokenByChars(0), 0);
  assert.equal(estimateTokenByChars(1), 1);
  assert.equal(estimateTokenByChars(4), 1);
  assert.equal(estimateTokenByChars(5), 2);
});

test('resolveModelIds returns parsed list or defaults', () => {
  assert.deepEqual(resolveModelIds('a,b', ['x']), ['a', 'b']);
  assert.deepEqual(resolveModelIds('', ['x', 'y']), ['x', 'y']);
});
