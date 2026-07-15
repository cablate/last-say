import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyFinanceBackup, findLatestBackupManifest } = require('../lib/db/backup');

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const explicitManifest = value('--input');
const directory = value('--directory');
const maxAgeRaw = value('--max-age-hours');
if ((!explicitManifest && !directory) || (explicitManifest && directory)) {
  throw new Error('Usage: node scripts/finance-backup-check.mjs (--input <manifest> | --directory <backup-root>) [--max-age-hours <positive-number>]');
}
const maxAgeHours = maxAgeRaw === null ? null : Number(maxAgeRaw);
const manifestPath = explicitManifest || findLatestBackupManifest(directory);
const result = verifyFinanceBackup({ manifestPath, maxAgeHours });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'stale') process.exitCode = 2;
