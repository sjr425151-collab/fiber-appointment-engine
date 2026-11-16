/**
 * Consistent online snapshot of the SQLite database (safe while the app runs).
 *
 *   npm run db:backup                    # → <db dir>/backups/fiber-YYYYMMDD-HHMMSS.db, keeps the newest 14
 *   npm run db:backup -- --keep 30 --dir /data/backups
 *
 * Run it before every production deploy (Render shell) and nightly once a
 * scheduler is approved. Snapshots on the same disk protect against bad
 * migrations or data mistakes, not against losing the disk — copy them
 * off-site (owner approval needed for a storage provider; see docs/08).
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function backupDatabase(dbPath: string, opts: { dir?: string; keep?: number; now?: Date } = {}): { file: string; bytes: number; removed: string[] } {
  const dir = resolve(opts.dir ?? join(dirname(resolve(dbPath)), 'backups'));
  const keep = Math.max(1, opts.keep ?? 14);
  mkdirSync(dir, { recursive: true });
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(dir, `fiber-${stamp}.db`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // VACUUM INTO writes a transactionally consistent, compacted copy.
    db.prepare('VACUUM INTO ?').run(file);
  } finally {
    db.close();
  }
  const check = new DatabaseSync(file, { readOnly: true });
  const ok = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  check.close();
  if (ok !== 'ok') throw new Error(`Backup failed integrity check: ${ok}`);
  const snapshots = readdirSync(dir)
    .filter((f) => /^fiber-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  const removed = snapshots.slice(keep);
  for (const f of removed) rmSync(join(dir, f));
  return { file, bytes: statSync(file).size, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dbPath = process.env.DATABASE_PATH ?? './data/fiber.db';
  const r = backupDatabase(dbPath, { dir: arg('dir'), keep: arg('keep') ? Number(arg('keep')) : undefined });
  console.log(JSON.stringify({ level: 'info', event: 'db_backup', file: r.file, bytes: r.bytes, removed: r.removed.length }));
}
