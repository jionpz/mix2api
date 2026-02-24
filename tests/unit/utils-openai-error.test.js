const test = require('node:test');
const assert = require('node:assert/strict');

const { sendOpenAIError } = require('../../utils/openai-error');

test('sendOpenAIError returns OpenAI error envelope', () => {
  const state = { status: 0, body: null };
  const res = {
    status(code) {
      state.status = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return payload;
    }
  };

  const payload = sendOpenAIError(res, 401, {
    message: 'unauthorized',
    type: 'authentication_error',
    code: 'unauthorized',
    param: 'authorization'
  });

  assert.equal(state.status, 401);
  assert.equal(payload.error.message, 'unauthorized');
  assert.equal(payload.error.type, 'authentication_error');
  assert.equal(payload.error.code, 'unauthorized');
  assert.equal(payload.error.param, 'authorization');
  assert.equal(state.body, payload);
});
