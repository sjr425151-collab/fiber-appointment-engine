import { randomBytes } from 'node:crypto';
import { hashPassword } from './lib/auth';

export type AppEnv = 'development' | 'staging' | 'production';

/** Feature flags. All default OFF so production behaves exactly as before. */
export interface Flags {
  env: AppEnv;
  /** Parent household-savings platform (/savings, /api/platform). */
  platform: boolean;
  /** Clearly-labelled illustrative offers. Never allowed in production. */
  sampleData: boolean;
}

export interface AppConfig {
  port: number;
  flags: Flags;
  databasePath: string;
  sessionSecret: string;
  adminEmail: string;
  adminPasswordHash: string;
  timezone: string;
  /** Public origin used for canonical URLs, OG tags and the sitemap. */
  /** Canonical public origin, e.g. https://trytucker.com (no trailing slash). */
  siteUrl: string;
  /**
   * Domain migration. `legacyHosts` are older domains that still reach this
   * app (e.g. livefiberconnect.com). They are served normally until
   * `legacyRedirects` is switched on; then page requests get a permanent
   * redirect to the same path and query on the canonical origin.
   */
  domains?: { legacyHosts: string[]; legacyRedirects: boolean };
  /** Website chat assistant. Without an API key the chat runs on rules only. */
  chat?: { apiKey: string; model: string; timeoutMs: number };
  isProduction: boolean;
  email: {
    /** Resend API key. Without it, emails are logged instead of sent. */
    resendApiKey: string;
    /** Sender, e.g. "Tucker <hello@mail.trytucker.com>" — must be on a domain verified in Resend. */
    from: string;
    /** Fallback team inboxes when a location has none configured. */
    teamEmails: string[];
    /** Max customer-facing emails per rolling 24h (Resend free tier: 100/day). Team alerts are never capped. */
    dailyCustomerLimit: number;
    /**
     * Outside production, customer emails go ONLY to these addresses (or @domains);
     * everything else is skipped, so staging can never email real customers.
     */
    nonProductionAllowlist: string[];
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

  const appEnv = (env.APP_ENV ?? (isProduction ? 'production' : 'development')) as AppEnv;
  if (!['development', 'staging', 'production'].includes(appEnv)) throw new Error(`APP_ENV must be development, staging or production (got "${appEnv}")`);
  const flag = (name: string) => {
    const v = (env[name] ?? '').trim().toLowerCase();
    if (v && !['true', 'false', '1', '0'].includes(v)) throw new Error(`${name} must be true or false`);
    return v === 'true' || v === '1';
  };
  // Tucker's household savings experience is the application, so `platform` is always on.
  // (PLATFORM_ENABLED was the launch switch; it is no longer read.)
  const flags: Flags = { env: appEnv, platform: true, sampleData: flag('SAMPLE_DATA_ENABLED') };
  if (flags.sampleData && appEnv === 'production') throw new Error('SAMPLE_DATA_ENABLED cannot be used when APP_ENV=production');

  return {
    port: Number(env.PORT ?? 3001),
    flags,
    databasePath: env.DATABASE_PATH ?? './data/fiber.db',
    sessionSecret,
    adminEmail,
    adminPasswordHash,
    timezone: env.APP_TIMEZONE ?? 'America/Detroit',
    siteUrl: (env.SITE_URL ?? 'http://localhost:' + (env.PORT ?? 3001)).replace(/\/+$/, ''),
    domains: {
      legacyHosts: (env.LEGACY_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter((h) => /^[a-z0-9.-]+$/.test(h)),
      // Lenient on purpose: a typo here must never stop the site from starting. Anything but true/1 is off.
      legacyRedirects: ['true', '1'].includes((env.LEGACY_REDIRECTS ?? '').trim().toLowerCase()),
    },
    chat: {
      apiKey: (env.ANTHROPIC_API_KEY ?? '').trim(),
      model: (env.CHAT_MODEL ?? '').trim() || 'claude-opus-5-5',
      timeoutMs: Math.min(Math.max(Number(env.CHAT_TIMEOUT_MS ?? 12000) || 12000, 3000), 30000),
    },
    email: {
      resendApiKey: env.RESEND_API_KEY ?? '',
      from: env.EMAIL_FROM || `Tucker <notifications@${new URL(env.SITE_URL || 'http://localhost').hostname}>`,
      teamEmails: (env.TEAM_NOTIFY_EMAIL ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
      dailyCustomerLimit: Math.max(0, Number(env.EMAIL_DAILY_CUSTOMER_LIMIT ?? 80) || 0),
      nonProductionAllowlist: (env.STAGING_EMAIL_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    },
    isProduction,
  };
}
