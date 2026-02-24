const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { startUpstreamStreamBridge } = require('../../services/upstream-stream');

function createReqRes() {
  const req = new EventEmitter();
  req.headers = {};

  const res = new EventEmitter();
  const headers = new Map();
  const writes = [];
  res.writableEnded = false;
  res.setHeader = (k, v) => headers.set(String(k).toLowerCase(), v);
  res.getHeader = (k) => headers.get(String(k).toLowerCase());
  res.write = (chunk) => {
    writes.push(String(chunk));
  };
  res.end = () => {
    res.writableEnded = true;
  };

  return { req, res, headers, writes };
}

test('startUpstreamStreamBridge writes chunks and DONE, sets stop end_reason', async () => {
  const reader = new EventEmitter();
  const response = { status: 200, body: reader };
  const { req, res, writes } = createReqRes();
  const endReasons = [];

  startUpstreamStreamBridge({
    req,
    res,
    response,
    requestId: 'req-1',
    storeKey: 'k1',
    model: 'm1',
    streamId: 's1',
    logBodies: false,
    sessionStoreService: { updateStoredSession: async () => {} },
    setRequestEndReason: (_res, reason) => endReasons.push(reason),
    redactSensitiveText: (s) => String(s || ''),
    fingerprint: () => 'fp',
    extractIdsFromUpstream: () => null,
    convertUpstreamToOpenAI: (upstreamData, model, id) => {
      if (upstreamData.type === 'text-delta') {
        return {
          id,
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{ index: 0, delta: { content: upstreamData.delta || '' }, finish_reason: null }]
        };
      }
      return null;
    }
  });

  reader.emit('data', Buffer.from('data: {"type":"text-delta","delta":"hi"}\n'));
  reader.emit('end');

  assert.ok(writes.some((w) => w.includes('chat.completion.chunk')));
  assert.ok(writes.some((w) => w.includes('data: [DONE]')));
  assert.deepEqual(endReasons, ['stop']);
  assert.equal(res.writableEnded, true);
});

test('startUpstreamStreamBridge captures session id and stores it', async () => {
  const reader = new EventEmitter();
  const response = { status: 200, body: reader };
  const { req, res } = createReqRes();
  const updates = [];

  startUpstreamStreamBridge({
    req,
    res,
    response,
    requestId: 'req-2',
    storeKey: 'k2',
    model: 'm2',
    streamId: 's2',
    logBodies: false,
    sessionStoreService: {
      updateStoredSession: async (...args) => {
        updates.push(args);
      }
    },
    setRequestEndReason: () => {},
    redactSensitiveText: (s) => String(s || ''),
    fingerprint: () => 'fp',
    extractIdsFromUpstream: (data) => data.ids || null,
    convertUpstreamToOpenAI: () => null
  });

  reader.emit('data', Buffer.from('data: {"ids":{"sessionId":"sid-1","exchangeId":"eid-1"}}\n'));
  reader.emit('end');

  await new Promise((r) => setImmediate(r));
  assert.equal(res.getHeader('x-session-id'), 'sid-1');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], ['k2', 'sid-1', 'eid-1']);
});
