import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { hashPassword } from '../../server/lib/auth';

export const ADMIN = { email: 'admin@example.com', password: 'e2e-admin-password-1' };

declare module 'vitest' {
  export interface ProvidedContext {
    stagingUrl: string;
    productionUrl: string;
    /** Production settings (what trytucker.com runs). Same server as productionUrl. */
    liveUrl: string;
    /** Production settings, used only by the Agent Workspace test (its own representatives and leads). */
    workspaceUrl: string;
  }
}

async function waitForHealth(url: string, child: ChildProcess, log: () => string) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${log()}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become healthy at ${url}:\n${log()}`);
}

export default async function setup(project: TestProject) {
  if (!existsSync('dist/index.html')) throw new Error('No production build found. Run `npm run build` (npm run test:e2e does this).');
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  const base = Number(process.env.E2E_PORT_BASE ?? 3290);
  const common = {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'e2e-'.padEnd(64, 'x'),
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD_HASH: hashPassword(ADMIN.password),
    RESEND_API_KEY: '',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
  };
  const servers: { child: ChildProcess; out: string[] }[] = [];
  const start = async (port: number, env: Record<string, string>) => {
    // A leftover server on this port would answer the health check with an old build.
    const busy = await fetch(`http://localhost:${port}/api/health`).then(
      () => true,
      () => false,
    );
    if (busy) throw new Error(`Port ${port} is already in use — stop that server or set E2E_PORT_BASE.`);
    const out: string[] = [];
    // Run node directly (not via npx) so SIGTERM reaches the server itself.
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: { ...common, PORT: String(port), SITE_URL: `http://localhost:${port}`, DATABASE_PATH: join(dir, `${port}.db`), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => out.push(String(d)));
    child.stderr?.on('data', (d) => out.push(String(d)));
    servers.push({ child, out });
    const url = `http://localhost:${port}`;
    await waitForHealth(url, child, () => out.join(''));
    return url;
  };

  const stagingUrl = await start(base, { APP_ENV: 'staging', SAMPLE_DATA_ENABLED: 'true' });
  const productionUrl = await start(base + 1, { APP_ENV: 'production' });
  project.provide('stagingUrl', stagingUrl);
  project.provide('productionUrl', productionUrl);
  project.provide('liveUrl', productionUrl); // production settings: real data and benchmarks, no samples
  project.provide('workspaceUrl', await start(base + 2, { APP_ENV: 'production' }));

  return async () => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            if (s.child.exitCode !== null) return resolve();
            s.child.once('exit', () => resolve());
            s.child.kill('SIGTERM');
            setTimeout(() => (s.child.kill('SIGKILL'), resolve()), 5000).unref();
          }),
      ),
    );
    rmSync(dir, { recursive: true, force: true });
  };
}
