const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

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
  forceBusinessError = false
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
          res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: 'stream answer' })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'finish' })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
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
