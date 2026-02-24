const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLooseToolCallsFromText,
  looksLikeToolCallPayload,
  ensureSafeFinalText
} = require('../../utils/tool-parser');

test('parseLooseToolCallsFromText parses loose tool_call payload', () => {
  const text = 'tool_call: { name: "read", arguments: { filePath: "/tmp/a" } }';
  const parsed = parseLooseToolCallsFromText(text);
  assert.ok(parsed);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, 'read');
  assert.deepEqual(parsed.toolCalls[0].arguments, { filePath: '/tmp/a' });
});

test('looksLikeToolCallPayload detects tool-call protocol text', () => {
  assert.equal(looksLikeToolCallPayload('{"tool_call":{}}'), true);
  assert.equal(looksLikeToolCallPayload('tool_calls: []'), true);
  assert.equal(looksLikeToolCallPayload('plain final answer'), false);
});

test('ensureSafeFinalText trims valid text and falls back', () => {
  assert.equal(ensureSafeFinalText('  ok  '), 'ok');
  assert.match(ensureSafeFinalText('   '), /工具调用响应格式异常/);
});
