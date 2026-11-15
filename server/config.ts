import { randomBytes } from 'node:crypto';
import { hashPassword } from './lib/auth';

export interface AppConfig {
  port: number;
  databasePath: string;
  sessionSecret: string;
  adminEmail: string;
  adminPasswordHash: string;
  timezone: string;
  /** Public origin used for canonical URLs, OG tags and the sitemap. */
  siteUrl: string;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  let sessionSecret = env.SESSION_SECRET ?? '';
  let adminPasswordHash = env.ADMIN_PASSWORD_HASH ?? '';
  const adminEmail = (env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();

  if (isProduction) {
    if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set (>= 32 chars) in production');
    if (!adminPasswordHash) throw new Error('ADMIN_PASSWORD_HASH must be set in production');
  } else {
    if (!sessionSecret || sessionSecret.startsWith('change-me')) sessionSecret = randomBytes(32).toString('hex');
    if (!adminPasswordHash) {
      const pw = randomBytes(9).toString('base64url');
      adminPasswordHash = hashPassword(pw);
      console.warn(
        '\n[dev] ADMIN_PASSWORD_HASH not set. Temporary admin login for this run:\n' +
          '      email:    ' + adminEmail + '\n' +
          '      password: ' + pw + '\n' +
          '      Set a permanent one with: npm run admin:hash -- "your-password"\n',
      );
    }
  }

  return {
    port: Number(env.PORT ?? 3001),
    databasePath: env.DATABASE_PATH ?? './data/fiber.db',
    sessionSecret,
    adminEmail,
    adminPasswordHash,
    timezone: env.APP_TIMEZONE ?? 'America/Detroit',
    siteUrl: (env.SITE_URL ?? 'http://localhost:' + (env.PORT ?? 3001)).replace(/\/+$/, ''),
    isProduction,
  };
}
