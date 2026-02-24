const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractJsonObjectsFromText,
  extractJsonFromText,
  extractFinalFromTextProtocol
} = require('../../utils/json-text');

test('extractJsonObjectsFromText finds multiple json objects', () => {
  const text = 'a {"x":1} b {"y":2}';
  assert.deepEqual(extractJsonObjectsFromText(text), ['{"x":1}', '{"y":2}']);
});

test('extractJsonFromText supports fenced and brace-based json', () => {
  const fenced = '```json\n{"a":1}\n```';
  assert.equal(extractJsonFromText(fenced), '{"a":1}');
  const inline = 'prefix {"b":2} suffix';
  assert.equal(extractJsonFromText(inline), '{"b":2}');
});

test('extractFinalFromTextProtocol extracts final field', () => {
  const text = '{"tool_call":{}}\n{"final":"done"}';
  assert.equal(extractFinalFromTextProtocol(text), 'done');
  assert.equal(extractFinalFromTextProtocol('plain text'), null);
});
