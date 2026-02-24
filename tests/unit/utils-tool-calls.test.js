const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAndFilterToolCalls,
  normalizeToolCallArguments,
  toOpenAIToolCallsForChunk,
  toOpenAIToolCallsForMessage
} = require('../../utils/tool-calls');

test('validateAndFilterToolCalls keeps only declared function tools', () => {
  const toolCalls = [{ name: 'read', arguments: {} }, { name: 'write', arguments: {} }];
  const validTools = [{ type: 'function', function: { name: 'read' } }, { type: 'mcp', name: 'x' }];
  const filtered = validateAndFilterToolCalls(toolCalls, validTools);
  assert.deepEqual(filtered, [{ name: 'read', arguments: {} }]);
});

test('normalizeToolCallArguments parses stringified json arguments', () => {
  const out = normalizeToolCallArguments([{ name: 'read', arguments: '{"filePath":"/tmp/a"}' }]);
  assert.deepEqual(out[0].arguments, { filePath: '/tmp/a' });
});

test('toOpenAIToolCallsForChunk and message produce compatible shapes', () => {
  const source = [{ name: 'read', arguments: { filePath: '/tmp/a' } }];
  const chunk = toOpenAIToolCallsForChunk(source);
  const message = toOpenAIToolCallsForMessage(source);

  assert.equal(chunk.length, 1);
  assert.equal(message.length, 1);
  assert.equal(chunk[0].type, 'function');
  assert.equal(message[0].type, 'function');
  assert.equal(chunk[0].function.name, 'read');
  assert.equal(message[0].function.name, 'read');
  assert.ok(typeof chunk[0].id === 'string' && chunk[0].id.startsWith('call_'));
  assert.ok(typeof message[0].id === 'string' && message[0].id.startsWith('call_'));
  assert.ok(typeof chunk[0].index === 'number');
  assert.equal(message[0].index, undefined);
});
