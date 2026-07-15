import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 3127;

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}
export function portFromEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?PORT\s*=\s*(.*)$/);
    if (match) return unquote(match[1]);
  }
  return null;
}

export function validatePort(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new RangeError(`PORT must be an integer from 1 to 65535; received ${text || '(empty)'}`);
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new RangeError(`PORT must be an integer from 1 to 65535; received ${text}`);
  return port;
}

export function resolvePort({ root = process.cwd(), mode = 'development', environment = process.env } = {}) {
  if (environment.PORT !== undefined && String(environment.PORT).trim() !== '') return validatePort(environment.PORT);
  const candidates = [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env'];
  for (const name of candidates) {
    const value = portFromEnvFile(path.join(root, name));
    if (value !== null && value !== '') return validatePort(value);
  }
  return DEFAULT_PORT;
}

export function runNextLocal(command, options = {}) {
  if (!['dev', 'start'].includes(command)) throw new Error('Usage: node scripts/run-next-local.mjs <dev|start>');
  const root = options.root || process.cwd();
  const mode = command === 'dev' ? 'development' : 'production';
  const port = resolvePort({ root, mode, environment: options.environment || process.env });
  const require = createRequire(import.meta.url);
  const nextCli = require.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextCli, command, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root,
    env: options.environment || process.env,
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { if (!child.killed) child.kill(signal); });
  }
  child.once('error', (error) => {
    process.stderr.write(`Failed to start Next.js: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
  });
  return { child, port };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try { runNextLocal(process.argv[2]); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
