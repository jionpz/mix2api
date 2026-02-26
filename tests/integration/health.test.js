const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

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

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForExit(proc, timeoutMs) {
  if (!proc) return true;
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => proc.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false)
  ]);
}

async function waitForHealthy({ port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health`;

  // Poll until server is ready.
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

async function stopProc(proc) {
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  proc.kill('SIGTERM');
  const exited = await waitForExit(proc, 1000);
  if (exited) return;

  proc.kill('SIGKILL');
  await waitForExit(proc, 1000);
}

function getCriticalStderrLines(stderrText) {
  const ignorable = [
    /ExperimentalWarning/i,
    /DeprecationWarning/i,
    /MaxListenersExceededWarning/i
  ];
  const critical = /(uncaught|exception|syntaxerror|referenceerror|typeerror|eaddrinuse|enoent|eacces|fatal|error:)/i;
  return stderrText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !ignorable.some((re) => re.test(line)))
    .filter((line) => critical.test(line));
}

test('GET /health returns ok JSON and does not leak x-powered-by', async (t) => {
  const port = await getFreePort();
  const entry = path.resolve('server.js');

  const proc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      LOG_HEADERS: 'false',
      LOG_BODIES: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  proc.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  t.after(async () => {
    await stopProc(proc);
  });

  await waitForHealthy({ port, timeoutMs: 5000 });

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body?.status, 'ok');
  assert.equal(body?.service, 'mix2api');
  assert.equal(body?.session_store?.degraded, false);

  const poweredBy = res.headers.get('x-powered-by');
  assert.ok(!poweredBy, `unexpected x-powered-by header: ${poweredBy}`);

  const criticalStderr = getCriticalStderrLines(stderr);
  assert.deepEqual(criticalStderr, [], `unexpected critical server stderr output:\n${stderr}`);
});

test('GET /v1/models returns OpenAI-compatible default model list', async (t) => {
  const port = await getFreePort();
  const entry = path.resolve('server.js');

  const proc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      MODEL_LIST: '',
      LOG_HEADERS: 'false',
      LOG_BODIES: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  proc.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  t.after(async () => {
    await stopProc(proc);
  });

  await waitForHealthy({ port, timeoutMs: 5000 });

  const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  assert.match(String(res.headers.get('content-type') || ''), /application\/json/i);

  const body = await res.json();
  assert.equal(body?.object, 'list');
  assert.equal(Array.isArray(body?.data), true);

  const ids = body.data.map((m) => m?.id);
  assert.deepEqual(ids, ['mix/qwen-3-235b-instruct', 'mix/claude-sonnet-4-5']);
  assert.ok(body.data.every((m) => m?.object === 'model'));
  assert.ok(body.data.every((m) => m?.owned_by === 'mix2api'));
  assert.ok(body.data.every((m) => Number.isInteger(m?.created)));

  const criticalStderr = getCriticalStderrLines(stderr);
  assert.deepEqual(criticalStderr, [], `unexpected critical server stderr output:\n${stderr}`);
});

test('GET /v1/models reflects configured MODEL_LIST values', async (t) => {
  const port = await getFreePort();
  const entry = path.resolve('server.js');

  const proc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      MODEL_LIST: 'mix/model-a,mix/model-b,\nmix/model-a,mix/model-c',
      LOG_HEADERS: 'false',
      LOG_BODIES: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  proc.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  t.after(async () => {
    await stopProc(proc);
  });

  await waitForHealthy({ port, timeoutMs: 5000 });

  const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));

  const body = await res.json();
  assert.equal(body?.object, 'list');
  const ids = body.data.map((m) => m?.id);
  assert.deepEqual(ids, ['mix/model-a', 'mix/model-b', 'mix/model-c']);

  const criticalStderr = getCriticalStderrLines(stderr);
  assert.deepEqual(criticalStderr, [], `unexpected critical server stderr output:\n${stderr}`);
});
