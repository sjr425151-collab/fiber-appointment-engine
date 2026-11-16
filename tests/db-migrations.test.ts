/**
 * Database integration: upgrading a database shaped like production's
 * (migrations 1–4 applied by the deployed release, with real-looking data) to
 * the current schema must keep every row, backfill consent evidence exactly
 * once, keep immutability triggers working, and be safe to re-run.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { MIGRATIONS } from '../server/db/schema';

process.env.NODE_ENV = 'test';

/** Builds a file DB with only the first `upTo` migrations, as an older release would have. */
function legacyDb(upTo: number): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mig-')), 'legacy.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const m of MIGRATIONS.filter((x) => x.id <= upTo)) {
    db.exec(m.sql);
    db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, '2026-11-01T00:00:00.000Z');
  }
  const ts = '2026-11-10T15:00:00.000Z';
  const lead = db.prepare(
    `INSERT INTO leads (id, first_name, last_name, email, phone, street, city, zip, booking_token_hash, consent_text, consent_at, consent_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lead.run('lead-1', 'Taylor', 'Nguyen', 't@example.com', '7345550101', '1 Main St', 'Monroe', '48161', 'h1', 'I agree (v1)', ts, '203.0.113.5', ts, ts);
  lead.run('lead-2', 'Sam', 'Lee', 's@example.com', '7345550102', '2 Elm St', 'Monroe', '48162', 'h2', 'I agree (v1)', ts, '', ts, ts);
  db.prepare("INSERT INTO appointments (id, lead_id, start_utc, end_utc, status, created_at, updated_at) VALUES ('appt-1', 'lead-1', ?, ?, 'scheduled', ?, ?)").run(
    '2026-11-17T14:00:00.000Z',
    '2026-11-17T14:30:00.000Z',
    ts,
    ts,
  );
  db.prepare("INSERT INTO lead_notes (id, lead_id, body, author, created_at) VALUES ('n-1', 'lead-1', 'Called back', 'admin', ?)").run(ts);
  db.close();
  return path;
}

describe('migrating a production-shaped database', () => {
  it('applies the new migrations, keeps all data and backfills consent once', () => {
    const path = legacyDb(4);
    const db = openDatabase(path);
    const ids = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: number }[]).map((r) => r.id);
    expect(ids).toEqual(MIGRATIONS.map((m) => m.id));
    expect(db.prepare('SELECT id, status FROM leads ORDER BY id').all()).toEqual([
      { id: 'lead-1', status: 'new' },
      { id: 'lead-2', status: 'new' },
    ]);
    expect(db.prepare('SELECT id, status FROM appointments').all()).toEqual([{ id: 'appt-1', status: 'scheduled' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM lead_notes').get()).toMatchObject({ n: 1 });
    // One consent row per existing lead, copied verbatim.
    expect(db.prepare('SELECT lead_id, consent_text, ip FROM consents ORDER BY lead_id').all()).toEqual([
      { lead_id: 'lead-1', consent_text: 'I agree (v1)', ip: '203.0.113.5' },
      { lead_id: 'lead-2', consent_text: 'I agree (v1)', ip: '' },
    ]);
    // New columns/tables exist and are empty for old rows.
    expect(db.prepare('SELECT assessment_id, duplicate_of FROM leads WHERE id = ?').get('lead-1')).toEqual({ assessment_id: null, duplicate_of: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM assessments').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 });
    db.close();
  });

  it('is idempotent: re-opening applies nothing and changes nothing', () => {
    const path = legacyDb(4);
    const first = openDatabase(path);
    const snapshot = JSON.stringify([first.prepare('SELECT * FROM _migrations').all(), first.prepare('SELECT * FROM consents ORDER BY lead_id').all()]);
    first.close();
    const second = openDatabase(path);
    expect(JSON.stringify([second.prepare('SELECT * FROM _migrations').all(), second.prepare('SELECT * FROM consents ORDER BY lead_id').all()])).toBe(snapshot);
    second.close();
  });

  it('keeps consent evidence immutable after the upgrade', () => {
    const db = openDatabase(legacyDb(4));
    expect(() => db.prepare("UPDATE consents SET consent_text = 'edited'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE leads SET consent_text = 'edited' WHERE id = 'lead-1'").run()).toThrow(/immutable/);
    db.close();
  });

  it('enforces opportunity integrity (status values, lead/assessment links)', () => {
    const db = openDatabase(legacyDb(4));
    const ins = (status: string, lead = 'lead-1', assessment = 'missing') =>
      db
        .prepare(
          `INSERT INTO opportunities (id, lead_id, assessment_id, category, plan_name, kind, status, created_at, updated_at)
           VALUES (lower(hex(randomblob(8))), ?, ?, 'internet', 'x', 'verified', ?, 'now', 'now')`,
        )
        .run(lead, assessment, status);
    expect(() => ins('new')).toThrow(/FOREIGN KEY/); // assessment must exist
    db.prepare(
      `INSERT INTO assessments (id, token_hash, zip, categories, answers, analysis, analysis_version, assumptions_version, status, created_at, updated_at)
       VALUES ('a-1', 'h', '48161', '[]', '{}', '{}', 'v', 'v', 'complete', 'now', 'now')`,
    ).run();
    expect(() => ins('archived', 'lead-1', 'a-1')).toThrow(/CHECK/);
    ins('new', 'lead-1', 'a-1');
    // Deleting a lead removes its opportunities (no orphans with personal data links).
    db.prepare("DELETE FROM leads WHERE id = 'lead-1'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 });
    db.close();
  });
});

describe('backups', () => {
  it('writes a consistent snapshot that opens with all data, and rotates old ones', async () => {
    const { backupDatabase } = await import('../server/scripts/backup');
    const path = legacyDb(4);
    openDatabase(path).close(); // bring to current schema
    const dir = mkdtempSync(join(tmpdir(), 'bak-'));
    const days = ['2026-11-10', '2026-11-11', '2026-11-12'];
    const files = days.map((d) => backupDatabase(path, { dir, keep: 2, now: new Date(`${d}T03:00:00Z`) }));
    expect(files[2].removed).toEqual(['fiber-20261110-030000.db']);
    const snap = new DatabaseSync(files[2].file, { readOnly: true });
    expect(snap.prepare('SELECT COUNT(*) AS n FROM leads').get()).toMatchObject({ n: 2 });
    expect(snap.prepare('SELECT COUNT(*) AS n FROM _migrations').get()).toMatchObject({ n: MIGRATIONS.length });
    snap.close();
  });
});
