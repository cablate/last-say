const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('local Next launcher resolves explicit environment and dotenv precedence', async () => {
  const { resolvePort } = await import('../scripts/run-next-local.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-port-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=4100\n');
    fs.writeFileSync(path.join(dir, '.env.local'), 'PORT=4200\n');
    fs.writeFileSync(path.join(dir, '.env.development.local'), 'PORT=4300\n');
    assert.equal(resolvePort({ root: dir, mode: 'development', environment: {} }), 4300);
    assert.equal(resolvePort({ root: dir, mode: 'production', environment: {} }), 4200);
    assert.equal(resolvePort({ root: dir, mode: 'development', environment: { PORT: '4400' } }), 4400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('local Next launcher keeps 3127 default and rejects invalid ports', async () => {
  const { resolvePort, validatePort } = await import('../scripts/run-next-local.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-port-empty-'));
  try { assert.equal(resolvePort({ root: dir, environment: {} }), 3127); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => validatePort('0'), /1 to 65535/);
  assert.throws(() => validatePort('70000'), /1 to 65535/);
  assert.throws(() => validatePort('abc'), /1 to 65535/);
});
