import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MONROE } from '../../shared/market';
import { DEFAULT_SETTINGS, MIGRATIONS, SEED_SERVICE_AREAS } from './schema';

export type DB = DatabaseSync;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
  }
}

function seed(db: DB) {
  const insertArea = db.prepare(
    'INSERT OR IGNORE INTO service_areas (zip, city, status) VALUES (?, ?, ?)',
  );
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM service_areas').get() as { n: number };
  const { m } = db.prepare('SELECT COUNT(*) AS m FROM markets').get() as { m: number };
  transaction(db, () => {
    if (m === 0) {
      const ts = new Date().toISOString();
      db.prepare('INSERT INTO markets (slug, name, state, config, active, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)').run(
        MONROE.slug, MONROE.name, MONROE.state, JSON.stringify(MONROE), ts, ts,
      );
    }
    if (n === 0) for (const a of SEED_SERVICE_AREAS) insertArea.run(a.zip, a.city, a.status);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);
  });
}

/** Run fn inside a write transaction (BEGIN IMMEDIATE takes the write lock up front). */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
