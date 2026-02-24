const test = require('node:test');
const assert = require('node:assert/strict');

const { registerCoreMiddlewares } = require('../../middleware/register-core-middlewares');

test('registerCoreMiddlewares wires request-id, json parser, error and log middleware', () => {
  const uses = [];
  const app = {
    use(fn) {
      uses.push(fn);
    }
  };

  const createRequestIdMiddleware = () => function requestIdMw() {};
  const createJsonBodyErrorMiddleware = () => function jsonErrorMw() {};
  const createRequestLogMiddleware = () => function requestLogMw() {};
  const expressJson = ({ limit }) => function jsonMw() { return limit; };

  registerCoreMiddlewares(app, {
    createRequestIdMiddleware,
    createJsonBodyErrorMiddleware,
    createRequestLogMiddleware,
    normalizeRequestId: (v) => v,
    uuidv4: () => 'id',
    expressJson,
    bodySizeLimit: '9mb',
    sendOpenAIError: () => {},
    envBool: () => false,
    redactHeaders: (h) => h,
    maybeRecordSampleTrace: () => {}
  });

  assert.equal(uses.length, 4);
  assert.equal(typeof uses[0], 'function');
  assert.equal(typeof uses[1], 'function');
  assert.equal(typeof uses[2], 'function');
  assert.equal(typeof uses[3], 'function');
});
