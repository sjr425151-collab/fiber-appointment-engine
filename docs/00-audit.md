# 00 — Repository & production audit

_Audited 2026-11-16 against commit `624aa58` (production) and the working tree._
_Status legend: **Live** = running on livefiberconnect.com · **Built** = merged & tested, not deployed · **Proposed** = design only._

## 1. Production state (verified)

| Item | Finding | How verified |
|---|---|---|
| Domain | `livefiberconnect.com` resolves to Render (216.24.57.16/.18); DNS on Cloudflare (`ray`/`marlowe.ns.cloudflare.com`); `www` → 301 → apex | DNS-over-HTTPS + HTTP probes |
| App | Healthy (`/api/health` 200); serves the Fiber Connect funnel with Monroe pricing (500 Mbps $50, 1 Gig $50, 2 Gig $70) | `/api/markets/monroe` |
| Deploys | Render **auto-deploys every push** to `claude/busy-bohr-j8rie0` | Observed: push at ~23:52 UTC → ~60 s of HTTP 502 (`x-render-routing: dynamic-paid-error`) → new version live |
| Downtime per deploy | ~1 minute, by design: services with a persistent disk can't do zero-downtime deploys | Render docs (Persistent Disks) + observation |
| Email | `RESEND_API_KEY` **not set** in production → emails logged, not sent; Monroe has **no team alert email** configured | Admin banner logic + public market data |
| Staging | **None.** Production is the only environment | — |
| Backups | **None** in code; SQLite lives on one 1 GB Render disk | — |

> **Operational rule adopted:** commits that must not deploy carry `[skip render]` in the message (documented Render feature). See `08-operations.md`.

## 2. Current architecture

```
Browser ──HTTPS──▶ Cloudflare (DNS) ──▶ Render web service (Docker, Ohio, 1 instance)
                                          ├─ Express 5 API  (server/app.ts)
                                          ├─ Server-rendered <head> per location (server/html.ts)
                                          ├─ Static SPA bundle (Vite build → dist/)
                                          ├─ Email outbox worker (server/notify) ──▶ Resend REST API
                                          └─ SQLite (node:sqlite) on persistent disk /data
```

- **Stack:** React 19, TypeScript, Tailwind CSS v4, Vite, React Router 7 · Express 5, Zod 4, helmet, express-rate-limit, compression · `node:sqlite` (experimental in Node 22) · Vitest + Supertest · oxlint.
- **Size:** ~6.5k lines of TS/TSX before this session; 10 runtime dependencies (no ORM, no UI kit, no state library).
- **Shape:** a modular monolith. Shared Zod schemas (`shared/`) validate both client input and server boundaries.

## 3. Route map (as built)

**Public pages:** `/` (default location) · `/:market` (other live locations; default's slug 301s to `/`) · `/privacy` · `*` → landing.
**Admin pages:** `/admin/login` · `/admin` (leads + funnel) · `/admin/leads/:id` · `/admin/appointments` · `/admin/locations` · `/admin/areas`.
**Public API:** `GET /api/health`, `GET /api/markets`, `GET /api/markets/:slug`, `GET /api/availability`, `POST /api/leads`, `POST /api/events`, `GET /api/schedule/dates`, `GET /api/schedule/slots`, `POST /api/appointments`.
**Admin API (session + CSRF header):** `me`, `stats`, `conversions`, `markets` (GET/POST/PUT), `leads` (list, csv, detail, PATCH), `appointments` (list, PATCH), `service-areas` (GET/PUT/DELETE).
**SEO:** `/robots.txt`, `/sitemap.xml` (live locations).

## 4. Data (migrations 1–5)

`service_areas`, `leads`, `lead_notes`, `appointments`, `settings`, `events`, `markets`, `notifications`, `consents` (5, this session) and **unused foundation tables** `commission_rules`, `sales`, `commissions`, `content_posts` (created in migration 1, no code reads them).

## 5. Reusable assets (keep)

| Asset | Where | Reuse in the platform |
|---|---|---|
| Location/market model (per-city config, pricing presets, schedules) | `shared/market.ts`, Admin → Locations | Becomes the geography layer for all categories |
| Lead capture with TCPA consent, attribution (UTM/click IDs/referrer), first-party events | `server/app.ts`, `src/lib/analytics.ts` | Assessment submission + attribution |
| Transactional scheduling with per-location capacity | `server/scheduling.ts` | Advisor appointments |
| Email outbox (retries, idempotency, abuse caps, templates, .ics) | `server/notify/` | All lifecycle messaging |
| Admin auth, CSRF, rate limiting, CSP, server-rendered SEO head | `server/lib/auth.ts`, `server/html.ts` | Platform-wide (auth needs upgrading, see risks) |
| Hero media pipeline (AV1/H.264, posters, parallax, reduced-motion) | `scripts/build-media.sh`, `HeroMedia.tsx` | Parent brand hero |
| **New:** deterministic cost engine (integer cents, versioned assumptions) | `shared/finance/` | Savings engine (Phase 3) |
| **New:** offer/provider/provenance model, eligibility, ranking lenses, adapters | `shared/offers/` | Provider intelligence (Phase 4) |

## 6. Functionality that must be preserved

1. Fiber funnel: ZIP check → lead form (consent) → slot booking → confirmation, per location.
2. Location pages, plans, Broadband Facts links, call/text buttons, SEO tags, sitemap.
3. Admin: leads pipeline, notes, CSV, appointments, locations, service areas, funnel.
4. Email outbox behaviour (once `RESEND_API_KEY` is set).
5. Lighthouse 100/100/100/100 on mobile and desktop (last measured 2026-11-15 on the production build, locally).

## 7. Missing systems (vs. the master directive)

| Area | Status |
|---|---|
| Parent brand, domain, consumer IA | Missing — decision needed (brand name) |
| Household assessment (multi-category) | Missing |
| Savings engine | **Built** (library + tests), not wired to UI |
| Provider/offer database, provenance, verification workflow | **Built** (model + rules + tests), no DB tables/admin UI yet |
| Opportunity pipeline beyond fiber leads; orders, installs, activations, commissions | Missing (unused tables only) |
| Roles & permissions (admin / manager / rep), per-user accounts, audit log | Missing — single shared admin login |
| AI explanation layer | Missing (by design until the engine is wired) |
| Staging, backups, monitoring, error tracking, structured logs | Missing |
| Data deletion / retention workflows | Partial (event pruning only) |
| A/B testing | Missing |

## 8. Security review (summary)

An independent read-only review was run on 2026-11-16. Findings and remediation status are tracked in `07-risk-register.md`. Three **High** issues were found in production code; fixes for H1 (lead/consent takeover) and H2 (event-table disk exhaustion) and most of H3 (email abuse) are **built and tested but not deployed** pending approval.
