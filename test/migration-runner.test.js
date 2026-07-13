const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, initializeDatabase, SCHEMA_VERSION } = require('../lib/db');
const { runMigrations } = require('../lib/db/migration-runner');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-migrations-')); }

test('migration ledger is idempotent and rejects changed checksums', () => {
  const dir=tempDir();const db=openDatabase(path.join(dir,'test.sqlite'));
  try {
    const migration={version:91,name:'fixture',source:'v1',apply(database){database.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY)');}};
    db.exec('BEGIN IMMEDIATE');runMigrations(db,[migration],{appVersion:'test'});db.exec('COMMIT');
    db.exec('BEGIN IMMEDIATE');runMigrations(db,[migration],{appVersion:'test'});db.exec('COMMIT');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE version=91').get().count,1);
    const changed={...migration,source:'v2'};
    db.exec('BEGIN IMMEDIATE');
    assert.throws(()=>runMigrations(db,[changed],{appVersion:'test'}),/checksum mismatch/);
    db.exec('ROLLBACK');
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('migration runner refuses ledger versions unknown to this application', () => {
  const dir=tempDir();const db=openDatabase(path.join(dir,'test.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    runMigrations(db,[{version:1,name:'known',source:'v1',apply(){}}],{appVersion:'test'});
    db.prepare("INSERT INTO schema_migrations(version,name,checksum,app_version)VALUES(99,'future','future','future')").run();
    db.exec('COMMIT');
    db.exec('BEGIN IMMEDIATE');
    assert.throws(()=>runMigrations(db,[{version:1,name:'known',source:'v1',apply(){}}],{appVersion:'test'}),/unknown\/newer migration 99/);
    db.exec('ROLLBACK');
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('frozen v0.2.3 fixture upgrades without changing legacy evidence', () => {
  const dir=tempDir();const legacyPath=path.join(dir,'legacy.sqlite');
  let db;
  try {
    execFileSync(process.execPath,['scripts/fixtures/financial-data/build-legacy-v0.2.3.mjs','--output',legacyPath],{cwd:path.join(__dirname,'..')});
    db=new DatabaseSync(legacyPath);db.exec('PRAGMA foreign_keys=ON');
    const before={transactions:db.prepare('SELECT id,dedupe_key,classification_source,reviewed FROM transactions ORDER BY id').all(),corrections:db.prepare('SELECT transaction_id,field_name,old_value,new_value FROM correction_log').all(),rules:db.prepare('SELECT id,match_key,category_value FROM classification_rules').all()};
    initializeDatabase(db);const after={transactions:db.prepare('SELECT id,dedupe_key,classification_source,reviewed FROM transactions ORDER BY id').all(),corrections:db.prepare('SELECT transaction_id,field_name,old_value,new_value FROM correction_log').all(),rules:db.prepare('SELECT id,match_key,category_value FROM classification_rules').all()};
    assert.deepEqual(after,before);assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,SCHEMA_VERSION);
    initializeDatabase(db);assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,SCHEMA_VERSION);
  } finally {if(db)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
