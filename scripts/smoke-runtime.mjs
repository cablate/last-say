import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { SCHEMA_VERSION } = require('../lib/db');
const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_DB = 'data/dev-verify-runtime.sqlite';
const REAL_DB = resolve(ROOT, 'data/finance.sqlite');
const runtimeDbPath = resolve(ROOT, RUNTIME_DB);
const requestedDbPath = process.env.FINANCE_DB_PATH
  ? resolve(ROOT, process.env.FINANCE_DB_PATH)
  : runtimeDbPath;

if (requestedDbPath !== runtimeDbPath || runtimeDbPath === REAL_DB) {
  throw new Error(
    `Runtime smoke test only permits ${RUNTIME_DB}; refusing ${process.env.FINANCE_DB_PATH || requestedDbPath}`,
  );
}

function removeRuntimeDb() {
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${runtimeDbPath}${suffix}`, { force: true });
  }
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHealth(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited before health check.\n${output.join('')}`);
    }
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}/api/health.\n${output.join('')}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

removeRuntimeDb();
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      FINANCE_DB_PATH: RUNTIME_DB,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

try {
  const healthResponse = await waitForHealth(baseUrl, child, output);
  const health = await healthResponse.json();
  if (!health.ok || health.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
  }

  const pageResponse = await fetch(`${baseUrl}/transactions?month=all`);
  if (!pageResponse.ok) {
    throw new Error(`Transactions page returned HTTP ${pageResponse.status}`);
  }
  const html = await pageResponse.text();
  if (!html.includes('Last Say')) {
    throw new Error('Transactions page did not render the Last Say application shell');
  }

  const csp = pageResponse.headers.get('content-security-policy') || '';
  if (!csp || csp.includes("'unsafe-eval'")) {
    throw new Error(`Production CSP is missing or unsafe: ${csp || '(missing)'}`);
  }

  console.log(
    `PASS runtime smoke: ${baseUrl}; schema=${health.schema_version}; transactions=${health.transactions}; production CSP excludes unsafe-eval`,
  );
} catch (error) {
  const serverOutput = output.join('').trim();
  if (serverOutput) console.error(serverOutput);
  throw error;
} finally {
  await stopChild(child);
  removeRuntimeDb();
}
