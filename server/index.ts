import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = createApp(config, db);

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (db: ${config.databasePath})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
