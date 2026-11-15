# Fiber Appointment Engine

Organic lead-generation, appointment-setting and AI marketing platform built by **Spotlight Marketing LLC** for **Omni Fiber**, launching in **Monroe, Michigan**.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Public availability landing page, lead capture, database, appointment scheduling, secure admin | ✅ Built & tested |
| 2 | Sales & installation tracking, configurable commissions | 🧱 DB tables in place (`sales`, `commission_rules`, `commissions`) |
| 3 | AI-generated daily Facebook content | 🧱 DB table in place (`content_posts`) |
| 4 | Higgsfield visual generation | Planned |

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite, React Router
- **API:** Express 5, Zod validation (schemas shared with the client in `shared/`)
- **Database:** SQLite via Node's built-in `node:sqlite` — zero cost, no external service. All SQL lives in `server/repo.ts` so it can move to Postgres/Supabase later.
- **Tests:** Vitest + Supertest

## Quick start

```bash
npm install
cp .env.example .env     # optional in development
npm run dev              # web on http://localhost:5173, API on :3001
```

If `ADMIN_PASSWORD_HASH` isn't set, the dev server prints a temporary admin password to the console on startup. Sign in at `/admin`.

To set a permanent admin password:

```bash
npm run admin:hash -- "your-long-password"
# paste the printed ADMIN_PASSWORD_HASH=... line into .env
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + web with hot reload |
| `npm test` | API, scheduling and security tests |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm start` | Production server (serves API + `dist/`). Requires `SESSION_SECRET` (≥32 chars) and `ADMIN_PASSWORD_HASH`. |

## How it works

**Visitor flow:** ZIP check → details form (with TCPA consent) → pick a consultation slot → confirmation.

- **Availability** comes from the `service_areas` table, editable at **Admin → Service areas**. Statuses: `available`, `verify` (in the build area, address must be confirmed), `coming_soon`, `not_serviceable`.
- **Leads** capture UTM parameters (`?utm_source=facebook&utm_campaign=...`) so organic campaigns can be attributed. A resubmission with the same email + phone updates the existing lead instead of duplicating it.
- **Scheduling** defaults: Mon–Sat, 9am–7pm Eastern, 60-min slots, 2 reps per slot, 12h minimum notice, 21 days ahead (see the `settings` table). Bookings run in a write transaction so a slot can never be overbooked; booking again reschedules instead of double-booking.

**Admin (`/admin`):** lead list with search/filter, stats, CSV export, lead detail with pipeline stages (new → contacted → appointment set → sold → install scheduled → installed / lost), notes and activity log, appointment board (complete / no-show / cancel), service-area management.

## Security

- Admin password stored as a scrypt hash; sessions are HMAC-signed, `HttpOnly`, `SameSite=Strict`, `Secure` in production, 12h expiry
- Admin mutations require an `X-Requested-With` header (CSRF defence in depth)
- Booking requires a per-lead random token (only its SHA-256 hash is stored)
- Rate limits on lead submission, booking and login; honeypot field for bots
- Helmet security headers with a strict Content-Security-Policy
- CSV export neutralises spreadsheet formula injection
- Consent text, version, timestamp, IP and user agent stored with each lead as a TCPA record

## Before going live — needs your input

1. **Verify service areas.** Seeded ZIPs are placeholders. Monroe 48161/48162 are `verify`; surrounding towns are `coming_soon`. Don't mark anything `available` until Omni Fiber confirms it.
2. **Confirm brand & disclosure wording** in `shared/content.ts` (the working site name "Monroe Fiber Connect", the partner disclosure, the consent text and the team phone number) with Omni Fiber and, ideally, counsel.
3. **Hosting.** Nothing is deployed. The app runs as one Node process with a SQLite file, so a single small VM or container with a persistent disk is enough.

## Project layout

```
server/            Express API
  app.ts           routes, auth middleware, error handling
  repo.ts          all SQL / data access
  scheduling.ts    slot generation + transactional booking
  db/              connection, migrations, seed data
  lib/             auth (scrypt, signed sessions) and timezone helpers
shared/            Zod schemas, types and copy shared by client + server
src/               React app (landing page + admin)
tests/             Vitest API tests
```
