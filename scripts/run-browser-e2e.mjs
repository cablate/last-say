import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(Number.isInteger(code) ? code : signal ? 1 : 0));
  });
}

const root = process.cwd();
const port = await freePort();
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-browser-e2e-'));
const distDir = `outputs/.next-e2e-${process.pid}`;
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
let status = 1;
try {
  status = await run(process.execPath, [cli, 'test', '--project=chromium', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_E2E_ROOT: runRoot,
      PLAYWRIGHT_E2E_DIST_DIR: distDir,
    },
  });
} finally {
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.rmSync(path.resolve(root, distDir), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
process.exitCode = status;
