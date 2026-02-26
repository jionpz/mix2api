const test = require('node:test');
const assert = require('node:assert/strict');

const { registerCoreRoutes } = require('../../routes/register-core-routes');

test('registerCoreRoutes wires expected endpoints and handlers', () => {
  const posts = [];
  const gets = [];
  const app = {
    post(path, handler) {
      posts.push({ path, handler });
    },
    get(path, handler) {
      gets.push({ path, handler });
    }
  };
  const chatHandler = () => {};

  registerCoreRoutes(app, {
    handleChatCompletion: chatHandler,
    resolveModelIds: () => ['m1'],
    defaultModelIds: ['d1'],
    sessionStoreService: {
      getStoreHealth: () => ({ mode: 'redis', degraded: false, reason: null, connected: true })
    }
  });

  assert.deepEqual(posts.map((x) => x.path), ['/v1/chat/completions', '/']);
  assert.equal(posts[0].handler, chatHandler);
  assert.equal(posts[1].handler, chatHandler);
  assert.deepEqual(gets.map((x) => x.path), ['/health', '/v1/models']);
});
