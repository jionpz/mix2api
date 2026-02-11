const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('redis');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => resolve(address.port));
    });
  });
}

async function waitForExit(proc, timeoutMs) {
  if (!proc) return true;
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => proc.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false)
  ]);
}

async function stopProc(proc) {
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  proc.kill('SIGTERM');
  const exited = await waitForExit(proc, 1000);
  if (exited) return;

  proc.kill('SIGKILL');
  await waitForExit(proc, 1000);
}

const HAS_REDIS_SERVER = (() => {
  try {
    const probe = spawnSync('redis-server', ['--version'], { encoding: 'utf8' });
    return probe.status === 0;
  } catch {
    return false;
  }
})();

async function waitForRedisReady({ port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch {
      // ignore
    }
    if (Date.now() > deadline) {
      throw new Error(`redis did not become ready within ${timeoutMs}ms on 127.0.0.1:${port}`);
    }
    await sleep(50);
  }
}

async function startRedisServer(port) {
  if (!HAS_REDIS_SERVER) {
    throw new Error('redis-server binary not found');
  }
  const proc = spawn('redis-server', [
    '--save', '',
    '--appendonly', 'no',
    '--port', String(port),
    '--bind', '127.0.0.1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForRedisReady({ port, timeoutMs: 5000 });
  return proc;
}

function sanitizeKeyPartForTest(value, fallback = 'unknown') {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return fallback;
  const normalized = s.replace(/[^a-z0-9._:-]/g, '_').slice(0, 80);
  return normalized || fallback;
}

function inferClientIdForTest(headers) {
  const explicitClient = headers['x-client'] || headers['x-client-id'] || headers['x-client_name'];
  if (explicitClient) return sanitizeKeyPartForTest(explicitClient, 'unknown');
  const ua = String(headers['user-agent'] || '').toLowerCase();
  if (ua.includes('opencode')) return 'opencode';
  if (ua.includes('claude code') || ua.includes('claude-code') || ua.includes('claudecode')) return 'claude-code';
  return 'unknown';
}

function getSessionStoreKeyForTest({ model, token, headers }) {
  const modelPart = sanitizeKeyPartForTest(model || '_default', '_default');
  const authPart = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 12);
  const clientPart = inferClientIdForTest(headers || {});
  return `${authPart}::${modelPart}::${clientPart}`;
}

async function waitForHealthy({ port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health`;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore until timeout
    }
    if (Date.now() > deadline) {
      throw new Error(`server did not become healthy within ${timeoutMs}ms: ${url}`);
    }
    await sleep(50);
  }
}

async function startMockUpstream(port, {
  forceJsonForStream = false,
  omitSessionStart = false,
  forceStatus = null,
  forceBusinessError = false,
  streamDelayAfterFirstDeltaMs = 0,
  delayBeforeAnyResponseMs = 0,
  forceStreamDropAfterFirstDelta = false,
  nonStreamContent = 'mocked upstream answer'
} = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk.toString('utf8');
    });
    req.on('end', () => {
      let parsedBody = null;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        parsedBody = null;
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText,
        body: parsedBody
      });

      if (req.method === 'POST' && req.url === '/v2/chats') {
        const handleChat = () => {
          if (forceStatus !== null) {
            res.writeHead(forceStatus, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'mocked upstream failure' } }));
            return;
          }

          if (forceBusinessError) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'mocked upstream business error' } }));
            return;
          }

          if (!forceJsonForStream && parsedBody && parsedBody.stream === true) {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            if (!omitSessionStart) {
              res.write(`data: ${JSON.stringify({
                type: 'start',
                messageMetadata: {
                  sessionId: 'sess-stream',
                  exchangeId: 'ex-stream'
                }
              })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: 'mocked ' })}\n\n`);
            if (forceStreamDropAfterFirstDelta) {
              res.destroy(new Error('mock upstream stream dropped'));
              return;
            }
            const writeRest = () => {
              res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: 'stream answer' })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'finish' })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            };
            if (streamDelayAfterFirstDeltaMs > 0) {
              setTimeout(writeRest, streamDelayAfterFirstDeltaMs);
            } else {
              writeRest();
            }
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            content: nonStreamContent,
            messageMetadata: {
              sessionId: 'sess-json',
              exchangeId: 'ex-json'
            }
          }));
        };

        if (delayBeforeAnyResponseMs > 0) {
          setTimeout(handleChat, delayBeforeAnyResponseMs);
        } else {
          handleChat();
        }
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, requests };
}

async function startMockUpstreamWithManagedAuth(port, {
  issuedTokens = ['managed-token'],
  invalidTokens = [],
  authErrorStatus = 401,
  authErrorMessage = 'token expired'
} = {}) {
  const requests = [];
  const invalidTokenSet = new Set(invalidTokens);
  let issueIndex = 0;

  const server = http.createServer(async (req, res) => {
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk.toString('utf8');
    });
    req.on('end', () => {
      let parsedBody = null;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        parsedBody = null;
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText,
        body: parsedBody
      });

      if (req.method === 'POST' && req.url === '/v2/token') {
        const token = issuedTokens[Math.min(issueIndex, issuedTokens.length - 1)] || 'managed-token';
        issueIndex += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          access_token: token,
          expires_in: 3600
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v2/chats') {
        const m = String(req.headers.authorization || '').match(/^\s*Bearer\s+(.+)\s*$/i);
        const token = m ? m[1] : null;
        if (!token || invalidTokenSet.has(token)) {
          res.writeHead(authErrorStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: authErrorMessage
            }
          }));
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          content: 'mocked upstream answer',
          messageMetadata: {
            sessionId: 'sess-json',
            exchangeId: 'ex-json'
          }
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, requests };
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function startAdapter({ port, upstreamPort, env: envOverrides = {}, collectLogs = false }) {
  const entry = path.resolve('server.js');
  const env = {
    ...process.env,
    PORT: String(port),
    UPSTREAM_API_BASE: `http://127.0.0.1:${upstreamPort}`,
    UPSTREAM_CHAT_PATH: '/v2/chats',
    INBOUND_AUTH_MODE: 'bearer',
    INBOUND_BEARER_TOKEN: 'inbound-test-token',
    UPSTREAM_AUTH_MODE: 'none',
    LOG_HEADERS: 'false',
    LOG_BODIES: 'false',
    ...envOverrides
  };
  const proc = spawn(process.execPath, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (collectLogs) {
    proc.__stdout = '';
    proc.__stderr = '';
    proc.stdout.on('data', (chunk) => {
      proc.__stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk) => {
      proc.__stderr += chunk.toString('utf8');
    });
  }

  await waitForHealthy({ port, timeoutMs: 5000 });
  return proc;
}

test('POST /v1/chat/completions stream=false returns OpenAI compatible non-stream response', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    })
  });

  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(json.object, 'chat.completion');
  assert.equal(json.model, 'mix/qwen-3-235b-instruct');
  assert.equal(Array.isArray(json.choices), true);
  assert.equal(json.choices[0].message.role, 'assistant');
  assert.equal(typeof json.choices[0].message.content, 'string');
  assert.equal(json.choices[0].finish_reason, 'stop');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/v2/chats');
});

test('POST /v1/chat/completions stream=true returns SSE chunks with DONE signal', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'hello stream' }]
    })
  });

  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  assert.equal(res.headers.get('x-session-id'), 'sess-stream');
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

  const body = await res.text();
  assert.match(body, /chat\.completion\.chunk/);
  assert.match(body, /"content":"mocked "/);
  assert.match(body, /"content":"stream answer"/);
  assert.match(body, /data: \[DONE\]/);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body?.stream, true);
});

test('POST /v1/chat/completions stream=true keeps SSE output when upstream replies JSON', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort, { forceJsonForStream: true });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'fallback stream' }]
    })
  });

  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

  const body = await res.text();
  assert.match(body, /chat\.completion\.chunk/);
  assert.match(body, /mocked upstream answer/);
  assert.match(body, /data: \[DONE\]/);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body?.stream, true);
});

test('POST /v1/chat/completions stream=true keeps DONE after chunks when upstream has no session metadata', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, { omitSessionStart: true });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'no session metadata' }]
    })
  });

  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

  const body = await res.text();
  const firstChunkIndex = body.indexOf('chat.completion.chunk');
  const doneIndex = body.indexOf('data: [DONE]');
  assert.ok(firstChunkIndex >= 0, `missing completion chunk in stream body: ${body}`);
  assert.ok(doneIndex > firstChunkIndex, `DONE must appear after completion chunks: ${body}`);
  assert.equal((body.match(/data: \[DONE\]/g) || []).length, 1);
});

test('POST /v1/chat/completions stream=true flushes first chunk before stream end when no session metadata', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, {
    omitSessionStart: true,
    streamDelayAfterFirstDeltaMs: 450
  });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const startedAt = Date.now();
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'ensure first chunk is not buffered to end' }]
    })
  });

  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

  const reader = res.body.getReader();
  let streamText = '';
  let firstChunkAt = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    streamText += Buffer.from(value).toString('utf8');
    if (!firstChunkAt && streamText.includes('chat.completion.chunk')) {
      firstChunkAt = Date.now();
    }
  }

  assert.ok(firstChunkAt !== null, `expected first chunk in stream body, got: ${streamText}`);
  assert.ok((firstChunkAt - startedAt) < 350, `first chunk should arrive before delayed finish: ${firstChunkAt - startedAt}ms`);
  assert.match(streamText, /data: \[DONE\]/);
});

test('POST /v1/chat/completions maps upstream non-2xx to OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort, { forceStatus: 503 });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'trigger upstream 503' }]
    })
  });

  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'api_error');
  assert.equal(json?.error?.code, 'upstream_http_error');
  assert.equal(json?.error?.param, null);
  assert.equal(requests.length, 1);
});

test('POST /v1/chat/completions maps upstream payload error to OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort, { forceBusinessError: true });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'trigger upstream payload error' }]
    })
  });

  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'api_error');
  assert.equal(json?.error?.code, 'upstream_error');
  assert.equal(json?.error?.param, null);
  assert.match(json?.error?.message || '', /mocked upstream business error/);
  assert.equal(requests.length, 1);
});

test('POST / and /v1/chat/completions return equivalent non-stream success semantics', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const requestBody = {
    model: 'mix/qwen-3-235b-instruct',
    stream: false,
    messages: [{ role: 'user', content: 'compat path check' }]
  };

  const v1Res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify(requestBody)
  });
  const rootRes = await fetch(`http://127.0.0.1:${adapterPort}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify(requestBody)
  });

  assert.equal(v1Res.status, 200);
  assert.equal(rootRes.status, 200);
  assert.ok(v1Res.headers.get('x-request-id'));
  assert.ok(rootRes.headers.get('x-request-id'));

  const v1Json = await v1Res.json();
  const rootJson = await rootRes.json();

  assert.equal(v1Json.object, 'chat.completion');
  assert.equal(rootJson.object, 'chat.completion');
  assert.equal(v1Json.model, rootJson.model);
  assert.equal(v1Json.choices[0].message.role, rootJson.choices[0].message.role);
  assert.equal(v1Json.choices[0].message.content, rootJson.choices[0].message.content);
  assert.equal(v1Json.choices[0].finish_reason, rootJson.choices[0].finish_reason);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/v2/chats');
  assert.equal(requests[1].url, '/v2/chats');
});

test('POST / keeps 401 auth error envelope semantics aligned with /v1/chat/completions', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const v1Res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'unauthorized v1' }]
    })
  });
  const rootRes = await fetch(`http://127.0.0.1:${adapterPort}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'unauthorized root' }]
    })
  });

  assert.equal(v1Res.status, 401);
  assert.equal(rootRes.status, 401);
  assert.ok(v1Res.headers.get('x-request-id'));
  assert.ok(rootRes.headers.get('x-request-id'));

  const v1Json = await v1Res.json();
  const rootJson = await rootRes.json();
  assert.equal(v1Json?.error?.type, 'authentication_error');
  assert.equal(rootJson?.error?.type, 'authentication_error');
  assert.equal(v1Json?.error?.code, rootJson?.error?.code);
  assert.equal(v1Json?.error?.param, rootJson?.error?.param);
  assert.equal(requests.length, 0);
});

test('POST / keeps 400 validation error envelope semantics aligned with /v1/chat/completions', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const invalidBody = {
    model: 'mix/qwen-3-235b-instruct',
    stream: false,
    messages: []
  };

  const v1Res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify(invalidBody)
  });
  const rootRes = await fetch(`http://127.0.0.1:${adapterPort}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify(invalidBody)
  });

  assert.equal(v1Res.status, 400);
  assert.equal(rootRes.status, 400);

  const v1Json = await v1Res.json();
  const rootJson = await rootRes.json();
  assert.equal(v1Json?.error?.type, 'invalid_request_error');
  assert.equal(rootJson?.error?.type, 'invalid_request_error');
  assert.equal(v1Json?.error?.code, rootJson?.error?.code);
  assert.equal(v1Json?.error?.param, rootJson?.error?.param);
  assert.equal(requests.length, 0);
});

test('POST /v1/chat/completions without auth returns 401 OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    })
  });

  assert.equal(res.status, 401);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'authentication_error');
  assert.equal(json?.error?.code, 'unauthorized');
  assert.equal(json?.error?.param, null);
  assert.equal(requests.length, 0);
});

test('POST /v1/chat/completions with wrong bearer token returns 401 OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer wrong-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    })
  });

  assert.equal(res.status, 401);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'authentication_error');
  assert.equal(json?.error?.code, 'unauthorized');
  assert.equal(json?.error?.param, 'authorization');
  assert.equal(requests.length, 0);
});

test('POST /v1/chat/completions with empty messages returns 400 OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: []
    })
  });

  assert.equal(res.status, 400);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'invalid_request_error');
  assert.equal(json?.error?.code, 'invalid_request');
  assert.equal(json?.error?.param, 'messages');
});

test('POST /v1/chat/completions with malformed JSON returns 400 OpenAI error envelope', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: '{"model":"mix/qwen-3-235b-instruct","messages":['
  });

  assert.equal(res.status, 400);
  assert.ok(res.headers.get('x-request-id'));
  assert.match(String(res.headers.get('content-type') || ''), /application\/json/i);

  const json = await res.json();
  assert.equal(typeof json?.error?.message, 'string');
  assert.equal(json?.error?.type, 'invalid_request_error');
  assert.equal(json?.error?.code, 'invalid_json');
  assert.equal(json?.error?.param, null);
  assert.equal(requests.length, 0);
});

test('POST /v1/chat/completions reuses explicitly provided session_id across turns', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const explicitSessionId = 'sess-explicit-123';
  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer inbound-test-token',
    'user-agent': 'OpenCode/1.0'
  };

  const requestBody = {
    model: 'mix/qwen-3-235b-instruct',
    stream: false,
    session_id: explicitSessionId,
    messages: [{ role: 'user', content: 'keep this explicit session' }]
  };

  const first = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });
  const second = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body?.session_id, explicitSessionId);
  assert.equal(requests[1].body?.session_id, explicitSessionId);
});

test('POST /v1/chat/completions isolates auto-session by auth+model+client key', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const baseBody = {
    model: 'mix/qwen-3-235b-instruct',
    stream: false,
    messages: [{ role: 'user', content: 'session isolation test' }]
  };

  const openCodeHeaders = {
    'content-type': 'application/json',
    authorization: 'Bearer inbound-test-token',
    'user-agent': 'OpenCode/1.0'
  };
  const claudeHeaders = {
    'content-type': 'application/json',
    authorization: 'Bearer inbound-test-token',
    'user-agent': 'Claude Code/1.0'
  };

  const first = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: openCodeHeaders,
    body: JSON.stringify(baseBody)
  });
  const second = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: claudeHeaders,
    body: JSON.stringify(baseBody)
  });
  const third = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: openCodeHeaders,
    body: JSON.stringify(baseBody)
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(requests.length, 3);

  // 第 1 次请求（OpenCode）无历史 session，应不携带 session_id
  assert.equal(requests[0].body?.session_id, undefined);
  // 第 2 次请求（Claude Code）应按 client 隔离，不复用 OpenCode 的 session
  assert.equal(requests[1].body?.session_id, undefined);
  // 第 3 次请求（OpenCode）应复用第 1 次写入的 session（mock upstream 返回 sess-json）
  assert.equal(requests[2].body?.session_id, 'sess-json');
  // 第 3 次请求（OpenCode）应复用第 1 次写入的 exchange_id（mock upstream 返回 ex-json）
  assert.equal(requests[2].body?.exchange_id, 'ex-json');
});

test('POST /v1/chat/completions with managed auth fetches upstream token when cache is empty', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const issuedToken = 'managed-token-secret-a';
  const { server: upstreamServer, requests } = await startMockUpstreamWithManagedAuth(upstreamPort, {
    issuedTokens: [issuedToken]
  });
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    collectLogs: true,
    env: {
      UPSTREAM_AUTH_MODE: 'managed',
      UPSTREAM_TOKEN_URL: `http://127.0.0.1:${upstreamPort}/v2/token`,
      UPSTREAM_TOKEN_BODY_JSON: JSON.stringify({ grant_type: 'client_credentials' })
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'managed auth token fetch' }]
    })
  });

  assert.equal(res.status, 200);
  const tokenRequests = requests.filter((item) => item.url === '/v2/token');
  const chatRequests = requests.filter((item) => item.url === '/v2/chats');
  assert.equal(tokenRequests.length, 1);
  assert.equal(chatRequests.length, 1);
  assert.equal(chatRequests[0].headers.authorization, `Bearer ${issuedToken}`);
  assert.equal(tokenRequests[0].body?.grant_type, 'client_credentials');

  await sleep(50);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.equal(logs.includes(issuedToken), false);
});

test('POST /v1/chat/completions with managed auth refreshes token and retries after auth failure', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const expiredToken = 'managed-token-expired-secret';
  const freshToken = 'managed-token-fresh-secret';
  const { server: upstreamServer, requests } = await startMockUpstreamWithManagedAuth(upstreamPort, {
    issuedTokens: [expiredToken, freshToken],
    invalidTokens: [expiredToken],
    authErrorMessage: 'token expired'
  });
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    collectLogs: true,
    env: {
      UPSTREAM_AUTH_MODE: 'managed',
      UPSTREAM_TOKEN_URL: `http://127.0.0.1:${upstreamPort}/v2/token`
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'managed auth refresh retry' }]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url, '/v2/token');
  assert.equal(requests[1].url, '/v2/chats');
  assert.equal(requests[2].url, '/v2/token');
  assert.equal(requests[3].url, '/v2/chats');
  assert.equal(requests[1].headers.authorization, `Bearer ${expiredToken}`);
  assert.equal(requests[3].headers.authorization, `Bearer ${freshToken}`);

  await sleep(50);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.equal(logs.includes(expiredToken), false);
  assert.equal(logs.includes(freshToken), false);
});

test('POST /v1/chat/completions preserves inbound x-request-id and forwards it upstream', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort, collectLogs: true });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const inboundRequestId = 'req-client-12345';
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token',
      'x-request-id': inboundRequestId
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'request id passthrough' }]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id'), inboundRequestId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['x-request-id'], inboundRequestId);

  await sleep(50);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /\[req-client-12345\] request\.received/);
  assert.match(logs, /\[req-client-12345\] request\.completed/);
});

test('POST /v1/chat/completions regenerates invalid inbound x-request-id', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const invalidInboundRequestId = 'bad id with spaces';
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token',
      'x-request-id': invalidInboundRequestId
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'invalid request id should be replaced' }]
    })
  });

  assert.equal(res.status, 200);
  const generatedRequestId = String(res.headers.get('x-request-id') || '');
  assert.notEqual(generatedRequestId, invalidInboundRequestId);
  assert.match(generatedRequestId, /^[A-Za-z0-9._:-]{1,128}$/);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['x-request-id'], generatedRequestId);
});

test('POST /v1/chat/completions stream timeout is classified as end_reason=timeout', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, {
    delayBeforeAnyResponseMs: 500
  });
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    collectLogs: true,
    env: {
      UPSTREAM_TIMEOUT_MS: '80',
      UPSTREAM_RETRY_COUNT: '0'
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'trigger timeout end_reason' }]
    })
  });

  assert.equal(res.status, 504);
  const body = await res.json();
  assert.equal(body?.error?.code, 'upstream_timeout');

  await sleep(80);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /request\.completed[^\n]*end_reason=timeout/);
});

test('POST /v1/chat/completions stream upstream HTTP error is classified as end_reason=upstream_error', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, { forceStatus: 503 });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort, collectLogs: true });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'trigger upstream error end_reason' }]
    })
  });

  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json?.error?.code, 'upstream_http_error');

  await sleep(80);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /request\.completed[^\n]*end_reason=upstream_error/);
  assert.match(logs, /request\.completed[^\n]*upstream_status=503/);
});

test('POST /v1/chat/completions stream client abort is classified as end_reason=client_abort', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, {
    omitSessionStart: true,
    streamDelayAfterFirstDeltaMs: 900
  });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort, collectLogs: true });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      messages: [{ role: 'user', content: 'abort stream from client side' }]
    })
  });

  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  controller.abort();
  try {
    await reader.read();
  } catch {
    // expected when client aborts
  }

  await sleep(200);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /stream\.terminated end_reason=client_abort/);

  // abort 后服务仍应可用
  const health = await fetch(`http://127.0.0.1:${adapterPort}/health`);
  assert.equal(health.status, 200);
});

test('POST /v1/chat/completions request.completed logs fixed dimensions for success', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort, collectLogs: true });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token',
      'user-agent': 'OpenCode/1.0'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        }
      }],
      messages: [{ role: 'user', content: 'check metrics dimensions' }]
    })
  });

  assert.equal(res.status, 200);
  await sleep(80);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /request\.completed[^\n]*client=opencode/);
  assert.match(logs, /request\.completed[^\n]*stream=true/);
  assert.match(logs, /request\.completed[^\n]*tools_present=true/);
  assert.match(logs, /request\.completed[^\n]*end_reason=stop/);
  assert.match(logs, /request\.completed[^\n]*http_status=200/);
  assert.match(logs, /request\.completed[^\n]*upstream_status=200/);
});

test('POST /v1/chat/completions request.completed logs fixed dimensions for upstream errors', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, { forceStatus: 503 });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort, collectLogs: true });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token',
      'user-agent': 'Claude Code/1.0'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      messages: [{ role: 'user', content: 'trigger metrics error dimensions' }]
    })
  });

  assert.equal(res.status, 503);
  await sleep(80);
  const logs = `${adapterProc.__stdout || ''}\n${adapterProc.__stderr || ''}`;
  assert.match(logs, /request\.completed[^\n]*client=claude-code/);
  assert.match(logs, /request\.completed[^\n]*stream=false/);
  assert.match(logs, /request\.completed[^\n]*tools_present=false/);
  assert.match(logs, /request\.completed[^\n]*end_reason=upstream_error/);
  assert.match(logs, /request\.completed[^\n]*http_status=503/);
  assert.match(logs, /request\.completed[^\n]*upstream_status=503/);
});

test('POST /v1/chat/completions forwards tools schema fields without losing key parameters', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    env: {
      SEND_UPSTREAM_TOOLS: 'true',
      TOOL_KEEP_ALL: 'true'
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read local file content',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              encoding: { type: 'string', enum: ['utf8', 'base64'] }
            },
            required: ['path']
          }
        }
      }],
      messages: [{ role: 'user', content: 'read README file' }]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.stream, false);
  assert.equal(Array.isArray(requests[0].body.tools), true);
  assert.equal(requests[0].body.tools.length, 1);
  assert.equal(requests[0].body.tools[0].type, 'function');
  assert.equal(requests[0].body.tools[0].function.name, 'read_file');
  assert.equal(requests[0].body.tools[0].function.description, 'Read local file content');
  assert.equal(requests[0].body.tools[0].function.strict, true);
  assert.equal(requests[0].body.tools[0].function.parameters.properties.path.type, 'string');
  assert.deepEqual(requests[0].body.tools[0].function.parameters.required, ['path']);
});

test('POST /v1/chat/completions maps legacy functions/function_call to tools compatible structure', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    env: {
      SEND_UPSTREAM_TOOLS: 'true',
      TOOL_KEEP_ALL: 'true'
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      functions: [{
        name: 'get_weather',
        description: 'Get weather by city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string' }
          },
          required: ['city']
        }
      }],
      function_call: { name: 'get_weather' },
      messages: [{ role: 'user', content: 'weather in Shanghai' }]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.stream, false);
  assert.equal(Array.isArray(requests[0].body.tools), true);
  assert.equal(requests[0].body.tools.length, 1);
  assert.equal(requests[0].body.tools[0].type, 'function');
  assert.equal(requests[0].body.tools[0].function.name, 'get_weather');
  assert.equal(requests[0].body.tools[0].function.description, 'Get weather by city');
  assert.equal(requests[0].body.tools[0].function.parameters.properties.city.type, 'string');
  assert.deepEqual(requests[0].body.tools[0].function.parameters.required, ['city']);
  assert.deepEqual(requests[0].body.tool_choice, {
    type: 'function',
    function: { name: 'get_weather' }
  });
});

test('POST /v1/chat/completions returns unique tool_call ids for multiple tool calls (non-stream)', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, {
    nonStreamContent: JSON.stringify({
      tool_calls: [
        { name: 'read_file', arguments: { path: 'README.md' } },
        { name: 'list_files', arguments: { path: 'src' } }
      ]
    })
  });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: false,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
          }
        },
        {
          type: 'function',
          function: {
            name: 'list_files',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
          }
        }
      ],
      messages: [{ role: 'user', content: 'read README and list src files' }]
    })
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.choices[0].finish_reason, 'tool_calls');
  assert.equal(json.choices[0].message.content, null);
  assert.equal(Array.isArray(json.choices[0].message.tool_calls), true);
  assert.equal(json.choices[0].message.tool_calls.length, 2);
  assert.equal(json.choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.equal(json.choices[0].message.tool_calls[1].function.name, 'list_files');
  assert.ok(/^call_/.test(json.choices[0].message.tool_calls[0].id));
  assert.ok(/^call_/.test(json.choices[0].message.tool_calls[1].id));
  assert.notEqual(json.choices[0].message.tool_calls[0].id, json.choices[0].message.tool_calls[1].id);
});

test('POST /v1/chat/completions stream tool_calls keep unique ids when upstream ids conflict', async (t) => {
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const { server: upstreamServer } = await startMockUpstream(upstreamPort, {
    nonStreamContent: JSON.stringify({
      tool_calls: [
        { id: 'legacy-1', name: 'read_file', arguments: { path: 'README.md' } },
        { id: 'legacy-1', name: 'grep_code', arguments: { pattern: 'TODO' } }
      ]
    })
  });
  const adapterProc = await startAdapter({ port: adapterPort, upstreamPort });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
  });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer inbound-test-token'
    },
    body: JSON.stringify({
      model: 'mix/qwen-3-235b-instruct',
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
          }
        },
        {
          type: 'function',
          function: {
            name: 'grep_code',
            parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] }
          }
        }
      ],
      messages: [{ role: 'user', content: 'read and grep code' }]
    })
  });

  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

  const body = await res.text();
  const chunks = body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)));
  const toolChunk = chunks.find((chunk) => Array.isArray(chunk?.choices?.[0]?.delta?.tool_calls));
  assert.ok(toolChunk, `expected tool_calls chunk, got: ${body}`);
  const toolCalls = toolChunk.choices[0].delta.tool_calls;
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].function.name, 'read_file');
  assert.equal(toolCalls[1].function.name, 'grep_code');
  assert.equal(toolCalls[0].id, 'call_legacy-1');
  assert.ok(/^call_/.test(toolCalls[1].id));
  assert.notEqual(toolCalls[0].id, toolCalls[1].id);
  assert.match(body, /"finish_reason":"tool_calls"/);
  assert.match(body, /data: \[DONE\]/);
});

test('POST /v1/chat/completions reuses session mapping across adapters when sharing redis', async (t) => {
  if (!HAS_REDIS_SERVER) {
    t.skip('redis-server not available in test environment');
    return;
  }

  const redisPort = await getFreePort();
  const upstreamPort = await getFreePort();
  const adapterPortA = await getFreePort();
  const adapterPortB = await getFreePort();
  const redisProc = await startRedisServer(redisPort);
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const sharedEnv = {
    SESSION_STORE_MODE: 'redis',
    REDIS_URL: `redis://127.0.0.1:${redisPort}`
  };
  const adapterA = await startAdapter({ port: adapterPortA, upstreamPort, env: sharedEnv });
  const adapterB = await startAdapter({ port: adapterPortB, upstreamPort, env: sharedEnv });

  t.after(async () => {
    await stopProc(adapterA);
    await stopProc(adapterB);
    await closeServer(upstreamServer);
    await stopProc(redisProc);
  });

  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer inbound-test-token',
    'user-agent': 'OpenCode/1.0'
  };
  const body = {
    model: 'mix/qwen-3-235b-instruct',
    stream: false,
    messages: [{ role: 'user', content: 'redis shared session continuity' }]
  };

  const first = await fetch(`http://127.0.0.1:${adapterPortA}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(first.status, 200);

  await sleep(80);

  const second = await fetch(`http://127.0.0.1:${adapterPortB}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(second.status, 200);

  const chatRequests = requests.filter((item) => item.url === '/v2/chats');
  assert.equal(chatRequests.length, 2);
  assert.equal(chatRequests[0].body?.session_id, undefined);
  assert.equal(chatRequests[1].body?.session_id, 'sess-json');
  assert.equal(chatRequests[1].body?.exchange_id, 'ex-json');
});

test('POST /v1/chat/completions treats unknown schemaVersion in redis as miss and recreates session mapping', async (t) => {
  if (!HAS_REDIS_SERVER) {
    t.skip('redis-server not available in test environment');
    return;
  }

  const redisPort = await getFreePort();
  const upstreamPort = await getFreePort();
  const adapterPort = await getFreePort();
  const redisProc = await startRedisServer(redisPort);
  const redisClient = createClient({ url: `redis://127.0.0.1:${redisPort}` });
  await redisClient.connect();
  const { server: upstreamServer, requests } = await startMockUpstream(upstreamPort);
  const adapterProc = await startAdapter({
    port: adapterPort,
    upstreamPort,
    env: {
      SESSION_STORE_MODE: 'redis',
      REDIS_URL: `redis://127.0.0.1:${redisPort}`
    }
  });

  t.after(async () => {
    await stopProc(adapterProc);
    await closeServer(upstreamServer);
    await redisClient.quit();
    await stopProc(redisProc);
  });

  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer inbound-test-token',
    'user-agent': 'OpenCode/1.0'
  };
  const model = 'mix/qwen-3-235b-instruct';
  const body = {
    model,
    stream: false,
    messages: [{ role: 'user', content: 'schema downgrade as miss' }]
  };

  const storeKey = getSessionStoreKeyForTest({
    model,
    token: 'inbound-test-token',
    headers
  });
  const redisSessionKey = `mix2api:session:${storeKey}`;
  await redisClient.set(redisSessionKey, JSON.stringify({
    schemaVersion: 999,
    sessionId: 'sess-corrupted',
    exchangeId: 'ex-corrupted',
    timestamp: Date.now(),
    turnCount: 5
  }), { PX: 60000 });

  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(res.status, 200);

  const chatRequests = requests.filter((item) => item.url === '/v2/chats');
  assert.equal(chatRequests.length, 1);
  assert.equal(chatRequests[0].body?.session_id, undefined);
  assert.equal(chatRequests[0].body?.exchange_id, undefined);

  const recoveredRaw = await redisClient.get(redisSessionKey);
  assert.ok(recoveredRaw);
  const recovered = JSON.parse(recoveredRaw);
  assert.equal(recovered?.schemaVersion, 1);
  assert.equal(recovered?.sessionId, 'sess-json');
});
