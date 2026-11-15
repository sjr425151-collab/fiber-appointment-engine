import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { createNotifier } from './notify';

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

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (db: ${config.databasePath})`);
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
