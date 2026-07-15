const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createFinanceBackup, verifyFinanceBackup, findLatestBackupManifest } = require('../lib/db/backup');

test('backup health verifies integrity and reports operator-defined freshness without restoring', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-backup-health-'));
  const source = path.join(dir, 'source.sqlite');
  const db = openDatabase(source);
  try {
    initializeDatabase(db);
    const backup = await createFinanceBackup({ dbPath: source, outputDir: path.join(dir, 'backups') });
    const createdAt = new Date(backup.manifest.created_at);
    const current = verifyFinanceBackup({ manifestPath: backup.manifest_path, maxAgeHours: 24, now: new Date(createdAt.getTime() + 6 * 3600000) });
    const stale = verifyFinanceBackup({ manifestPath: backup.manifest_path, maxAgeHours: 24, now: new Date(createdAt.getTime() + 30 * 3600000) });
    assert.equal(current.status, 'current');
    assert.equal(current.integrity, 'ok');
    assert.equal(current.database_sha256_verified, true);
    assert.equal(stale.status, 'stale');
    assert.equal(findLatestBackupManifest(path.join(dir, 'backups')), backup.manifest_path);
    assert.equal(fs.existsSync(path.join(dir, 'restored.sqlite')), false);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('backup health rejects hash corruption and future timestamps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-backup-health-bad-'));
  const source = path.join(dir, 'source.sqlite');
  const db = openDatabase(source);
  try {
    initializeDatabase(db);
    const backup = await createFinanceBackup({ dbPath: source, outputDir: path.join(dir, 'backups') });
    const manifest = JSON.parse(fs.readFileSync(backup.manifest_path, 'utf8'));
    manifest.database.sha256 = '0'.repeat(64);
    const corrupt = path.join(backup.bundle_dir, 'corrupt.json');
    fs.writeFileSync(corrupt, JSON.stringify(manifest));
    assert.throws(() => verifyFinanceBackup({ manifestPath: corrupt }), /hash mismatch/);
    manifest.database.sha256 = backup.manifest.database.sha256;
    manifest.created_at = '2099-01-01T00:00:00.000Z';
    const future = path.join(backup.bundle_dir, 'future.json');
    fs.writeFileSync(future, JSON.stringify(manifest));
    assert.throws(() => verifyFinanceBackup({ manifestPath: future, now: new Date('2026-07-15T00:00:00Z') }), /future/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
