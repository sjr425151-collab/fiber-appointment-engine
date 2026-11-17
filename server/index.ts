import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { createNotifier } from './notify';
import { pruneEvents } from './repo';
import { pruneChats } from './repo-chat';
import { errorFields, log } from './lib/log';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDatabase(config.databasePath);
const notifier = createNotifier(db, config);
const app = createApp(config, db, { notifier });
const stopEmails = notifier.start();
console.log(
  notifier.enabled
    ? `[email] sending via Resend as ${config.email.from}`
    : '[email] RESEND_API_KEY not set — emails are logged, not sent',
);

// Daily housekeeping: keep the anonymous analytics table bounded.
const housekeeping = () => {
  try {
    pruneChats(db);
    const n = pruneEvents(db);
    if (n) console.log(`[housekeeping] pruned ${n} old analytics events`);
  } catch (err) {
    console.error('[housekeeping] failed', err);
  }
};
housekeeping();
setInterval(housekeeping, 24 * 3600_000).unref();

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (db: ${config.databasePath})`);
});

// Last-resort logging: an unexpected crash must leave a searchable trace.
process.on('unhandledRejection', (err) => log('error', 'unhandled_rejection', errorFields(err)));
process.on('uncaughtException', (err) => {
  log('error', 'uncaught_exception', errorFields(err));
  process.exit(1); // let Render restart a clean process
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopEmails();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
