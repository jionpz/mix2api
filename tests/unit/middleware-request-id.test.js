const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequestIdMiddleware } = require('../../middleware/request-id');

test('request-id middleware initializes new upstream observability locals', () => {
  const middleware = createRequestIdMiddleware({
    normalizeRequestId: (input) => String(input || '').trim() || null,
    uuidv4: () => 'generated-id-123'
  });

  const req = { headers: {} };
  const responseHeaders = {};
  const res = {
    locals: {},
    setHeader(name, value) {
      responseHeaders[name] = value;
    }
  };

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.requestId, 'generated-id-123');
  assert.equal(responseHeaders['x-request-id'], 'generated-id-123');
  assert.equal(res.locals.upstreamHost, 'none');
  assert.equal(res.locals.upstreamOverride, 'default');
});
