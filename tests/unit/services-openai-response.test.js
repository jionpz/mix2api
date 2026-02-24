const test = require('node:test');
const assert = require('node:assert/strict');

const { createOpenAIResponseService } = require('../../services/openai-response');

function createRes() {
  const headers = new Map();
  const state = { json: null, stream: null, endReason: null };
  return {
    headers,
    state,
    setHeader(k, v) {
      headers.set(String(k).toLowerCase(), v);
    },
    json(payload) {
      state.json = payload;
      return payload;
    }
  };
}

function createService() {
  return createOpenAIResponseService({
    helpers: {
      toOpenAIToolCallsForMessage: (calls) => calls.map((c) => ({ id: 'call_1', type: 'function', function: { name: c.name, arguments: '{}' } })),
      writeToolCallStream: (res, id, model, calls) => {
        res.state.stream = { type: 'tool_calls', id, model, calls };
        return 'stream-tool';
      },
      writeFinalStream: (res, id, model, text) => {
        res.state.stream = { type: 'final', id, model, text };
        return 'stream-final';
      },
      setRequestEndReason: (res, reason) => {
        res.state.endReason = reason;
      },
      uuidv4: () => 'id-fixed'
    }
  });
}

test('renderToolCalls returns stream response when stream requested', () => {
  const service = createService();
  const res = createRes();
  const out = service.renderToolCalls({
    res,
    clientWantsStream: true,
    streamId: 's1',
    model: 'm1',
    toolCalls: [{ name: 'read' }],
    upstreamSessionId: 'u1',
    fallbackSessionId: 'f1'
  });
  assert.equal(out, 'stream-tool');
  assert.equal(res.state.endReason, 'tool_calls');
  assert.equal(res.state.stream.type, 'tool_calls');
});

test('renderToolCalls returns non-stream envelope when stream disabled', () => {
  const service = createService();
  const res = createRes();
  const out = service.renderToolCalls({
    res,
    clientWantsStream: false,
    streamId: 's1',
    model: 'm1',
    toolCalls: [{ name: 'read' }],
    upstreamSessionId: 'u1',
    fallbackSessionId: 'f1'
  });
  assert.equal(res.state.endReason, 'tool_calls');
  assert.equal(out.choices[0].finish_reason, 'tool_calls');
  assert.equal(out.session_id, 'u1');
});

test('renderFinalText returns non-stream envelope and fallback session id', () => {
  const service = createService();
  const res = createRes();
  const out = service.renderFinalText({
    res,
    clientWantsStream: false,
    streamId: 's2',
    model: 'm2',
    finalText: 'ok',
    upstreamSessionId: null,
    fallbackSessionId: 'f2'
  });
  assert.equal(res.state.endReason, 'stop');
  assert.equal(out.choices[0].message.content, 'ok');
  assert.equal(out.session_id, 'f2');
});
