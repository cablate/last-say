const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync, backup } = require('node:sqlite');
const { SCHEMA_VERSION, PROJECT_ROOT } = require('../db');
const { version: APP_VERSION } = require('../../package.json');

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolvedExplicit(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} requires an explicit path`);
  return path.resolve(value);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertBackupOutput(outputDir) {
  const resolved = resolvedExplicit(outputDir, 'Backup output');
  if (isWithin(PROJECT_ROOT, resolved)) {
    const allowed = [path.join(PROJECT_ROOT, 'outputs'), path.join(PROJECT_ROOT, 'data')];
    if (!allowed.some((root) => isWithin(root, resolved))) throw new Error('Backup output inside the repository must be under ignored outputs/ or data/');
  }
  return resolved;
}

function sqliteEvidence(db) {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
  if (foreignKeyViolations.length) throw new Error(`SQLite foreign key check failed: ${foreignKeyViolations.length} violation(s)`);
  return { integrity, foreign_key_violations: 0, schema_version: schemaVersion };
}

function sourceArtifacts(db, bundleDir, roots) {
  const allowedRoots = roots.map((root) => path.resolve(root));
  const rows = db.prepare("SELECT source_key, source_file FROM sources WHERE source_file <> '' AND artifact_status = 'available'").all();
  const artifacts = [];
  const targetRoot = path.join(bundleDir, 'sources');
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const row of rows) {
    const sourcePath = path.resolve(PROJECT_ROOT, row.source_file);
    const allowedRoot = allowedRoots.find((root) => isWithin(root, sourcePath));
    if (!allowedRoot || !fs.existsSync(sourcePath)) {
      artifacts.push({ source_key: row.source_key, status: 'missing', path_hint: row.source_file });
      continue;
    }
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Source artifact is not a regular non-symlink file: ${row.source_file}`);
    const extension = path.extname(sourcePath).slice(0, 12);
    const relativePath = path.join('sources', `${row.source_key}${extension}`);
    const target = path.join(bundleDir, relativePath);
    fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
    artifacts.push({ source_key: row.source_key, status: 'included', relative_path: relativePath.replaceAll('\\', '/'), sha256: sha256File(target), bytes: stat.size });
  }
  return artifacts;
}

function verifyBundledArtifacts(bundleDir, sourceArtifactsManifest) {
  if (!Array.isArray(sourceArtifactsManifest)) return sourceArtifactsManifest;
  return sourceArtifactsManifest.map((artifact) => {
    if (artifact.status !== 'included') return artifact;
    const artifactPath = path.resolve(bundleDir, artifact.relative_path || '');
    if (!isWithin(bundleDir, artifactPath) || !fs.existsSync(artifactPath)) throw new Error(`Bundled source artifact is missing or escapes the bundle: ${artifact.source_key}`);
    if (fs.lstatSync(artifactPath).isSymbolicLink()) throw new Error(`Bundled source artifact cannot be a symlink: ${artifact.source_key}`);
    if (sha256File(artifactPath) !== artifact.sha256) throw new Error(`Bundled source artifact hash mismatch: ${artifact.source_key}`);
    return { ...artifact, verified: true };
  });
}

function readBackupManifest(manifestPath) {
  const input = resolvedExplicit(manifestPath, 'Backup manifest');
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error('Backup manifest does not exist or is not a file');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(input, 'utf8')); }
  catch (error) { throw new Error(`Backup manifest is not valid JSON: ${error.message}`); }
  if (manifest.format !== 'last-say-backup/v1') throw new Error('Unsupported backup manifest format');
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version > SCHEMA_VERSION) throw new Error(`Backup schema ${manifest.schema_version} is newer than supported schema ${SCHEMA_VERSION}`);
  return { input, manifest, bundleDir: path.dirname(input) };
}

function verifyFinanceBackup({ manifestPath, maxAgeHours = null, now = new Date() }) {
  const { input, manifest, bundleDir } = readBackupManifest(manifestPath);
  const createdAt = Date.parse(manifest.created_at);
  if (!Number.isFinite(createdAt)) throw new Error('Backup manifest created_at is invalid');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Backup verification time is invalid');
  const ageHours = (nowMs - createdAt) / 3600000;
  if (ageHours < -(5 / 60)) throw new Error('Backup manifest created_at is unexpectedly in the future');
  if (maxAgeHours !== null && (!Number.isFinite(Number(maxAgeHours)) || Number(maxAgeHours) <= 0)) throw new Error('maxAgeHours must be a positive number');

  const backupPath = path.resolve(bundleDir, manifest.database?.relative_path || '');
  if (!isWithin(bundleDir, backupPath) || !fs.existsSync(backupPath)) throw new Error('Backup database path is missing or escapes its bundle');
  if (sha256File(backupPath) !== manifest.database?.sha256) throw new Error('Backup database hash mismatch');
  const verifiedArtifacts = verifyBundledArtifacts(bundleDir, manifest.source_artifacts);
  const backupDb = new DatabaseSync(backupPath);
  let evidence;
  try {
    backupDb.exec('PRAGMA foreign_keys = ON');
    evidence = sqliteEvidence(backupDb);
  } finally {
    backupDb.close();
  }
  if (evidence.schema_version !== manifest.schema_version) throw new Error('Manifest and database schema versions differ');
  const freshness = maxAgeHours !== null && ageHours > Number(maxAgeHours) ? 'stale' : 'current';
  return {
    status: freshness,
    manifest_path: input,
    bundle_dir: bundleDir,
    created_at: manifest.created_at,
    age_hours: Math.max(0, Number(ageHours.toFixed(3))),
    max_age_hours: maxAgeHours === null ? null : Number(maxAgeHours),
    mode: manifest.mode,
    app_version: manifest.app_version,
    schema_version: evidence.schema_version,
    integrity: evidence.integrity,
    foreign_key_violations: evidence.foreign_key_violations,
    database_sha256_verified: true,
    source_artifacts: Array.isArray(verifiedArtifacts)
      ? { included: verifiedArtifacts.filter((item) => item.status === 'included').length, missing: verifiedArtifacts.filter((item) => item.status === 'missing').length, verified: true }
      : verifiedArtifacts,
    warning: manifest.warning,
  };
}

function findLatestBackupManifest(directory) {
  const root = resolvedExplicit(directory, 'Backup directory');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Backup directory does not exist or is not a directory');
  const candidates = [];
  const direct = path.join(root, 'manifest.json');
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) candidates.push(direct);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifestPath = path.join(root, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) candidates.push(manifestPath);
  }
  const supported = candidates.map((manifestPath) => {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const createdAt = manifest.format === 'last-say-backup/v1' ? Date.parse(manifest.created_at) : NaN;
      return Number.isFinite(createdAt) ? { manifestPath, createdAt } : null;
    } catch { return null; }
  }).filter(Boolean);
  if (!supported.length) throw new Error('No supported backup manifest found in directory');
  supported.sort((a, b) => b.createdAt - a.createdAt || b.manifestPath.localeCompare(a.manifestPath));
  return supported[0].manifestPath;
}

async function createFinanceBackup({ dbPath, outputDir, includeSources = false, sourceRoots = [path.join(PROJECT_ROOT, 'uploads'), path.join(PROJECT_ROOT, 'outputs')] }) {
  const sourcePath = resolvedExplicit(dbPath, 'Database');
  const destinationRoot = assertBackupOutput(outputDir);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('Database path does not exist or is not a file');
  fs.mkdirSync(destinationRoot, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const bundleDir = path.join(destinationRoot, `last-say-backup-${stamp}`);
  fs.mkdirSync(bundleDir, { recursive: false });
  const backupPath = path.join(bundleDir, 'finance.sqlite');
  const sourceDb = new DatabaseSync(sourcePath);
  try {
    sourceDb.exec('PRAGMA foreign_keys = ON');
    const sourceEvidence = sqliteEvidence(sourceDb);
    await backup(sourceDb, backupPath, { rate: 64 });
    const backupDb = new DatabaseSync(backupPath);
    let backupEvidence;
    try { backupDb.exec('PRAGMA foreign_keys = ON'); backupEvidence = sqliteEvidence(backupDb); }
    finally { backupDb.close(); }
    const artifacts = includeSources ? sourceArtifacts(sourceDb, bundleDir, sourceRoots) : [];
    const manifest = {
      format: 'last-say-backup/v1', app_version: APP_VERSION, schema_version: backupEvidence.schema_version,
      created_at: new Date().toISOString(), mode: includeSources ? 'full-bundle' : 'db-only',
      database: { relative_path: 'finance.sqlite', sha256: sha256File(backupPath), bytes: fs.statSync(backupPath).size, ...backupEvidence },
      source_database: sourceEvidence,
      source_artifacts: includeSources ? artifacts : { included: false, reason: 'DB-only backup does not include original source artifacts.' },
      warning: 'This backup contains sensitive financial data and is not encrypted by Last Say.',
    };
    const manifestPath = path.join(bundleDir, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return { bundle_dir: bundleDir, manifest_path: manifestPath, manifest };
  } catch (error) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
    throw error;
  } finally {
    sourceDb.close();
  }
}

async function restoreFinanceBackup({ manifestPath, targetPath }) {
  const input = resolvedExplicit(manifestPath, 'Backup manifest');
  const target = resolvedExplicit(targetPath, 'Restore target');
  if (fs.existsSync(target)) throw new Error('Restore target already exists; active replacement is not allowed by this command');
  const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (manifest.format !== 'last-say-backup/v1') throw new Error('Unsupported backup manifest format');
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version > SCHEMA_VERSION) throw new Error(`Backup schema ${manifest.schema_version} is newer than supported schema ${SCHEMA_VERSION}`);
  const bundleDir = path.dirname(input);
  const backupPath = path.resolve(bundleDir, manifest.database?.relative_path || '');
  if (!isWithin(bundleDir, backupPath) || !fs.existsSync(backupPath)) throw new Error('Backup database path is missing or escapes its bundle');
  if (sha256File(backupPath) !== manifest.database.sha256) throw new Error('Backup database hash mismatch');
  const verifiedArtifacts = verifyBundledArtifacts(bundleDir, manifest.source_artifacts);
  const backupDb = new DatabaseSync(backupPath);
  try {
    backupDb.exec('PRAGMA foreign_keys = ON');
    const evidence = sqliteEvidence(backupDb);
    if (evidence.schema_version !== manifest.schema_version) throw new Error('Manifest and database schema versions differ');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await backup(backupDb, target, { rate: 64 });
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  } finally {
    backupDb.close();
  }
  const restored = new DatabaseSync(target);
  try {
    restored.exec('PRAGMA foreign_keys = ON');
    return { target_path: target, ...sqliteEvidence(restored), source_artifacts: verifiedArtifacts };
  } catch (error) {
    restored.close();
    fs.rmSync(target, { force: true });
    throw error;
  } finally {
    try { restored.close(); } catch { /* already closed after validation failure */ }
  }
}

module.exports = { sha256File, createFinanceBackup, restoreFinanceBackup, verifyFinanceBackup, findLatestBackupManifest, sqliteEvidence, isWithin, verifyBundledArtifacts };
