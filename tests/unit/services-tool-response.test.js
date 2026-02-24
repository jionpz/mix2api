const test = require('node:test');
const assert = require('node:assert/strict');

const { createToolResponseService } = require('../../services/tool-response');

function createService(overrides = {}) {
  return createToolResponseService({
    helpers: {
      extractTextFromUpstreamResponse: (text) => String(text || ''),
      parseToolCallFromText: () => null,
      normalizeToolCallArguments: (calls) => calls,
      validateAndFilterToolCalls: (calls) => calls,
      extractFinalFromTextProtocol: () => null,
      looksLikeToolCallPayload: () => false,
      ensureSafeFinalText: (text) => String(text || '').trim() || 'fallback',
      ...overrides
    }
  });
}

test('evaluate returns text when tool parsing is not required', () => {
  const service = createService();
  const out = service.evaluate({ text: 'hello', toolMode: false, tools: null, logToolParse: false, requestId: 'r1' });
  assert.equal(out.type, 'text');
  assert.equal(out.finalText, 'hello');
});

test('evaluate returns tool_calls when parsed and validated', () => {
  const service = createService({
    parseToolCallFromText: () => ({ toolCalls: [{ name: 'read', arguments: {} }] }),
    validateAndFilterToolCalls: (calls) => calls
  });
  const out = service.evaluate({ text: 'x', toolMode: true, tools: [{ type: 'function', function: { name: 'read' } }], logToolParse: false, requestId: 'r2' });
  assert.equal(out.type, 'tool_calls');
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'read');
});

test('evaluate falls back to final text when tool calls are filtered out', () => {
  const service = createService({
    parseToolCallFromText: () => ({ toolCalls: [{ name: 'read', arguments: {} }], final: 'done' }),
    validateAndFilterToolCalls: () => []
  });
  const out = service.evaluate({ text: 'x', toolMode: true, tools: [], logToolParse: false, requestId: 'r3' });
  assert.equal(out.type, 'text');
  assert.equal(out.finalText, 'done');
});
