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
  email: {
    /** Resend API key. Without it, emails are logged instead of sent. */
    resendApiKey: string;
    /** Sender, e.g. "Fiber Connect <hello@mail.livefiberconnect.com>" — must be on a domain verified in Resend. */
    from: string;
    /** Fallback team inboxes when a location has none configured. */
    teamEmails: string[];
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  let sessionSecret = env.SESSION_SECRET ?? '';
  let adminPasswordHash = env.ADMIN_PASSWORD_HASH ?? '';
  // Hosting dashboards (Render, etc.) store secrets encrypted, so a plain
  // ADMIN_PASSWORD is accepted too; it's hashed in memory and never stored.
  const plainPassword = env.ADMIN_PASSWORD ?? '';
  if (!adminPasswordHash && plainPassword) {
    if (isProduction && plainPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    adminPasswordHash = hashPassword(plainPassword);
  }
  const adminEmail = (env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();

  if (isProduction) {
    if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set (>= 32 chars) in production');
    if (!adminPasswordHash) throw new Error('Set ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) in production');
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
    email: {
      resendApiKey: env.RESEND_API_KEY ?? '',
      from: env.EMAIL_FROM || `Fiber Connect <notifications@${new URL(env.SITE_URL || 'http://localhost').hostname}>`,
      teamEmails: (env.TEAM_NOTIFY_EMAIL ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
    },
    isProduction,
  };
}
