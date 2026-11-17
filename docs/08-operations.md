# 08 — Operations: environments, deploys, migrations, backups, rollback

## Environments

| Environment | Where | Deploys from | Status |
|---|---|---|---|
| Local | `npm run dev` (web :5173, API :3001) | working tree | Live |
| Staging (local) | `npm run build`, then the server with the staging flags (below) | working tree | Used for M1 validation |
| Staging (Render) | separate service + disk from `render.staging.yaml` | any commit, **manual deploy only** | **Not created** — needs approval (ADR-008, about $7.25/mo) |
| Production | Render `fiber-connect`, livefiberconnect.com | `claude/busy-bohr-j8rie0` (auto-deploy on push) | Live |

## Deploying

- **Every push to the production branch deploys and causes ~1 minute of downtime** (persistent disk → no zero-downtime deploys).
- **`[skip render]` is not a guarantee:** saving an environment variable or using Manual Deploy in Render deploys the newest pushed commit even if it was skipped. Only push production-safe, tested commits.
- **To push without deploying**, include `[skip render]` in the commit message (Render documented feature; the skipped deploy still appears on the service's Events page).
- Before any production deploy:
  1. `npm run check` (typecheck, lint, unit, API and DB tests) and `npm run test:e2e` (build plus browser suite) must pass.
  2. Take a backup in the Render shell: `npm run db:backup`.
  3. Deploy off-peak, and announce it if leads are actively coming in.
- After deploy:
  - `GET /api/health` should return `{"ok":true,"db":"ok","version":"<commit>"}`; check the version matches the commit you meant to deploy.
  - The homepage renders, a test ZIP check works, and the admin loads.

## Staging and feature flags

| Flag | Default | Effect |
|---|---|---|
| `APP_ENV` | from `NODE_ENV` | `staging` or `development`: `noindex` on every page, robots.txt disallows all, staging banner |
| `PLATFORM_ENABLED` | retired | No longer read. The savings experience is always on (`15-consolidation.md`) |
| `SAMPLE_DATA_ENABLED` | `false` | Adds illustrative offers labelled "Sample"; **the server refuses to start** with this set when `APP_ENV=production` |

Production must never set `SAMPLE_DATA_ENABLED`; without it, categories with no real plan show labelled benchmarks.

**Run staging locally:**
```bash
npm run build
NODE_ENV=production APP_ENV=staging SAMPLE_DATA_ENABLED=true \
PORT=3200 SITE_URL=http://localhost:3200 DATABASE_PATH=./staging.db \
SESSION_SECRET=$(openssl rand -hex 32) ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-staging-only-password' \
npx tsx server/index.ts
```

**Create the Render staging service (after approval):**
1. Render dashboard → *New* → *Blueprint* → this repository.
2. Set the blueprint file to `render.staging.yaml`.
3. Fill `SITE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` with values different from production.
4. Leave `RESEND_API_KEY` unset so no email reaches real people.

It never auto-deploys. Use *Manual Deploy* for any commit, including `[skip render]` ones. Production (`render.yaml`) is unaffected.

## Database migrations

1. Add a new entry to `MIGRATIONS` (never edit shipped ones). Additive only; destructive changes use expand → migrate → contract across releases.
2. **Rehearse on production-shaped data**: build a DB with the deployed commit (git worktree), then open it with the new code and check invariants. Migration 5 was rehearsed this way: migrations 1–5 applied, 6/6 leads with exactly matching consent rows, appointments and outbox untouched, re-open idempotent. Migrations 5–7 were rehearsed on 2026-11-16 against a DB created and populated by the deployed commit `624aa58` (a real booking through the browser). Migration 7 (`opportunities`) passed the same checks: 1–7 applied, data unchanged, reopening idempotent. `tests/db-migrations.test.ts` now repeats this on every test run: a migration-1–4 database with leads, an appointment and a note is upgraded and checked for data, consent backfill, immutability triggers, idempotency and integrity constraints. For earlier rehearsals of 5–6: Results: 1–6 applied; the lead, appointment and 6 outbox rows were preserved; exactly one consent row per lead; `leads.assessment_id` NULL; reopening was idempotent. The new code then served the fiber funnel on that DB end to end, with the platform returning 404.
3. Take a backup immediately before the deploy (below).

## Backups (finding M6 — partly built)

- **Built:** `npm run db:backup [-- --keep 14 --dir /data/backups]` writes a consistent online snapshot (`VACUUM INTO`), runs `PRAGMA integrity_check` on it, keeps the newest N and logs one JSON line. It's safe while the app runs. Tested in `tests/db-migrations.test.ts`.
- **Pre-deploy (now):** run it in the Render shell before every production deploy.
- **Still needs approval ⚑:**
  - A nightly schedule. Render cron jobs are a paid service and can't mount the web service's disk, so the job would run inside the web process or be triggered externally.
  - An off-site copy, e.g. Cloudflare R2 free tier: 10 GB.
  - A same-disk snapshot doesn't survive losing the disk.
- **Restore drill** (quarterly): download a snapshot, start the app locally with `DATABASE_PATH` pointing to it, and run the smoke checks.

## Monitoring and logs

- **Health:** `/api/health` runs a database query; it returns 503 if the database fails, so Render's health check stops routing to a broken instance. Point a free external uptime monitor at it (e.g. UptimeRobot or Better Stack free tier; account needs owner approval ⚑).
- **Logs:** server errors are one JSON line each: `level`, `event`, `requestId`, `method`, `path` and the error. Query strings, request bodies, cookies and contact details are never logged. Every response carries `X-Request-Id`, and 500 responses include it, so a user report can be matched to the exact log line in Render's log search. Unhandled rejections and exceptions are logged before the process exits.
- **Not yet:** error alerting such as the Sentry free tier (approval ⚑); a log drain for retention beyond Render's built-in window.

## Testing

| Command | What runs | Needs |
|---|---|---|
| `npm run check` | Typecheck, lint, and unit, API, DB and infrastructure tests (Vitest, in-memory and temp-file SQLite) | Nothing external |
| `npm run test:e2e` | Production build, then a staging server (platform and samples on) and a production-mode server (flags off) on throwaway databases, then Chromium tests: the full customer journey, edge cases, responsive layouts (320/390/768/1280), axe-core WCAG 2.2 AA, keyboard and reduced motion, and the fiber site in production mode | Playwright Chromium (`npx playwright install chromium` outside this container); free ports 3290–3291 (`E2E_PORT_BASE` to change) |

## Names in Render

What is named what (2026-11-17):

| Thing | Current name | Seen by customers? | Safe to rename? |
|---|---|---|---|
| Render web service | `fiber-connect` | No | Yes, in the dashboard, with the steps below |
| Render disk | `fiber-data` | No | Yes, in the dashboard (label only). Leave the mount path `/data` alone |
| Database file | `/data/fiber.db` | No | **No.** Changing `DATABASE_PATH` starts an empty database; the leads would still be in the old file but the site would not show them |
| `onrender.com` address | set when the service was created | No (Cloudflare points the domains at it) | Do not try to change it |
| GitHub repository | `fiber-appointment-engine` | No | Yes, in GitHub (old links redirect) |
| Package name, staging blueprint, README | `tucker`, `tucker-staging` | No | Done in the repository |
| Session cookie, calendar event ids | `fae_session`, `…@fiber-connect` | No | Left as they are: changing them signs the team out and breaks updates to calendar invites already sent |

**Renaming the Render service (owner, about five minutes):**

1. Render → *Blueprints*. If a Blueprint lists this service, open it and switch **auto sync off** first. (If there is no Blueprint, skip this.)
2. Render → the service → *Settings* → *Name* → `tucker` → Save. Note the `onrender.com` address shown on the service page before and after. Render's documentation does not say whether it changes; if it does, update the two Cloudflare DNS records that point at it before doing anything else, and check `https://trytucker.com/api/health`.
3. Optional: *Disks* → rename `fiber-data` to `tucker-data`. Do not change the mount path.
4. Tell the developer (or change `name:` and the disk `name:` in `render.yaml` to exactly the same values) and commit with `[skip render]`. Only then switch Blueprint auto sync back on.
5. Check `https://trytucker.com/api/health` answers and the admin shows existing leads.

Why the order matters: Render matches Blueprint services by name. A name in `render.yaml` that matches no existing service can create a second service with an empty disk.

Also note: a Blueprint sync overwrites dashboard values for variables that have a `value:` in `render.yaml` (for example `LEGACY_REDIRECTS`). When a value is changed in the dashboard, change it in `render.yaml` too.

## Rollback

1. **Code:** Render dashboard → service → *Deploys* → *Rollback* to the previous deploy (or revert the commit and push). Migrations are additive, so the previous code runs against the newer schema.
2. **Data:** restore the pre-deploy snapshot only if data was corrupted (loses writes since the snapshot — export them first from the current DB).
3. Record the incident and cause in the project log.

## Configuration (environment variables)

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | prod | ≥ 32 chars; generated by Render |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` | prod | Single admin until Phase 5 |
| `SITE_URL` | prod | Canonical origin (`https://livefiberconnect.com`) |
| `DATABASE_PATH` | prod | `/data/fiber.db` on the disk |
| `TRUST_PROXY` | prod | `1` today — see finding M1 |
| `RESEND_API_KEY`, `EMAIL_FROM`, `TEAM_NOTIFY_EMAIL` | optional | Without the key, emails are logged, not sent |
| `EMAIL_DAILY_CUSTOMER_LIMIT` | optional | Default 80 (Resend free tier is 100/day) |
| `APP_TIMEZONE` | optional | Legacy default; locations carry their own timezone |
| `STAGING_EMAIL_ALLOWLIST` | staging | Comma-separated addresses or `@domains`; outside production, customer emails go only here |

Secrets are never committed; `.env` is git-ignored.

## Deploy log

| Date (UTC) | Commit | What | Approved by | Pre-deploy checks | Rollback |
|---|---|---|---|---|---|
| 2026-11-16 | this commit (includes `c0a1388`, `904682e`, `a5808e7`) | Security fixes (H1, H2, H3 partial, M2, M3 notice, lows), household platform code (**off**: `PLATFORM_ENABLED` not set), solar model, opportunities, ops logging/health, backup script. Migrations 5–7 (additive) run on first start. | Owner, in chat | `npm run check` 153 passed; `npm run test:e2e` 17 passed; clean-clone `npm ci` + build like the Dockerfile; that build started in production mode on a DB created by the live release `624aa58`: migrations applied, fiber funnel booked, `/savings` 404, robots unchanged. A Render-shell backup wasn't possible from here (the `db:backup` script ships in this release); Render's own disk snapshots are the fallback. | Render → fiber-connect → Events → Rollback to the `624aa58` deploy (migrations are additive, so the old code runs on the new schema) |
| | **Result** | Live at 18:16:34 UTC as `79b37cb` (health shows the version); about 35 s of 502s during the restart. Verified on phone and desktop: fiber home renders with no console errors and no horizontal scroll; ZIP check works; admin login renders; admin API returns 401 without a session; `/savings` and the platform API return 404; robots and sitemap unchanged; CSP and HSTS present; `X-Request-Id` on responses. No test leads were created in production. | | | |
