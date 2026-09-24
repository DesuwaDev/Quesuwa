import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { normalizeDefinition } from '../shared/schema.js';
import legacyStatuses from '../i18n/legacy-statuses.json' with { type: 'json' };

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
function addColumn(db, table, name, definition) {
  if (!columns(db, table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
const tableExists = (db, name) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));

// Each step is idempotent so databases created by any earlier release upgrade in place.
const migrations = [
  db => {
    db.exec(`CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, state TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id), snapshot TEXT NOT NULL, answers TEXT NOT NULL, attachments TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, created_at);`);
    addColumn(db, 'forms', 'deleted_at', 'TEXT');
    addColumn(db, 'responses', 'deleted_at', 'TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_cleanup (id TEXT PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS responses_active ON responses(form_id, deleted_at, created_at);`);
  },
  db => {
    db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, expires_at);
      CREATE TABLE IF NOT EXISTS webhook_deliveries (id INTEGER PRIMARY KEY, form_id TEXT NOT NULL, created_at TEXT NOT NULL, event TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS webhook_form ON webhook_deliveries(form_id, id);`);
    // The single legacy administrator becomes the first owner account.
    if (tableExists(db, 'admin_credential') && !db.prepare('SELECT count(*) AS n FROM users').get().n) {
      const legacy = db.prepare('SELECT salt,hash FROM admin_credential WHERE id=1').get();
      if (legacy) db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,created_at) VALUES (?,'admin','','owner',?,?,?)").run(randomUUID(), legacy.salt, legacy.hash, new Date().toISOString());
    }
    db.exec('DROP TABLE IF EXISTS admin_sessions; DROP TABLE IF EXISTS admin_credential;');
    addColumn(db, 'audit', 'actor', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'audit', 'detail', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'forms', 'created_by', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'forms', 'updated_by', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'responses', 'starred', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'responses', 'duration_ms', 'INTEGER');
    addColumn(db, 'responses', 'locale', "TEXT NOT NULL DEFAULT ''");
    db.exec('CREATE INDEX IF NOT EXISTS responses_created ON responses(created_at)');
    // Canonicalize stored definitions (legacy conditions become logic rules).
    const update = db.prepare('UPDATE forms SET definition=? WHERE id=?');
    for (const row of db.prepare('SELECT id, definition FROM forms').all()) {
      try { update.run(JSON.stringify(normalizeDefinition(JSON.parse(row.definition))), row.id); }
      catch { /* Keep definitions that cannot be normalized; editors will report the problem on save. */ }
    }
  },
  db => {
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
];

export function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'report.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let index = current; index < migrations.length; index++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migrations[index](db);
      db.exec(`PRAGMA user_version=${index + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  // Older releases stored localized status labels; map any that remain (e.g. restored backups).
  const migrateStatus = db.prepare('UPDATE responses SET status=? WHERE status=?');
  for (const [legacy, code] of Object.entries(legacyStatuses)) migrateStatus.run(code, legacy);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
