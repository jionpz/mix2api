const test = require('node:test');
const assert = require('node:assert/strict');

const { envInt, envBool, envJson } = require('../../config/env');

function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prev;
    }
  }
}

test('envInt parses finite numbers and falls back', () => {
  withEnv('TEST_ENV_INT', '42', () => {
    assert.equal(envInt('TEST_ENV_INT', 7), 42);
  });
  withEnv('TEST_ENV_INT', 'bad', () => {
    assert.equal(envInt('TEST_ENV_INT', 7), 7);
  });
  withEnv('TEST_ENV_INT', undefined, () => {
    assert.equal(envInt('TEST_ENV_INT', 7), 7);
  });
});

test('envBool parses common truthy values', () => {
  withEnv('TEST_ENV_BOOL', '1', () => assert.equal(envBool('TEST_ENV_BOOL', false), true));
  withEnv('TEST_ENV_BOOL', 'true', () => assert.equal(envBool('TEST_ENV_BOOL', false), true));
  withEnv('TEST_ENV_BOOL', 'yes', () => assert.equal(envBool('TEST_ENV_BOOL', false), true));
  withEnv('TEST_ENV_BOOL', '0', () => assert.equal(envBool('TEST_ENV_BOOL', true), false));
});

test('envJson parses json and falls back on invalid values', () => {
  withEnv('TEST_ENV_JSON', '{"a":1}', () => {
    assert.deepEqual(envJson('TEST_ENV_JSON', {}), { a: 1 });
  });
  withEnv('TEST_ENV_JSON', 'oops', () => {
    assert.deepEqual(envJson('TEST_ENV_JSON', { fallback: true }), { fallback: true });
  });
  withEnv('TEST_ENV_JSON', undefined, () => {
    assert.deepEqual(envJson('TEST_ENV_JSON', { fallback: true }), { fallback: true });
  });
});
