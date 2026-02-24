const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test('repo baseline files exist', () => {
  const requiredFiles = [
    'README.md',
    'package.json',
    'package-lock.json',
    'server.js',
    'src/app.js',
    'src/server.js',
    'src/bootstrap/chat-handler.js',
    'src/bootstrap/observability.js',
    'Dockerfile',
    'docker-compose.yml',
    '.env.example',
    '.gitignore',
    '.dockerignore'
  ];

  const missing = requiredFiles.filter((p) => !exists(path.resolve(p)));
  assert.deepEqual(missing, []);
});

test('package.json has minimal start script', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg?.name, 'mix2api');
  assert.equal(pkg?.private, true);
  assert.equal(pkg?.scripts?.start, 'node src/server.js');
});

test('.gitignore blocks .env files from being committed', () => {
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
});
