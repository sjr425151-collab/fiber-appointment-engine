# 12 — Phase 3: integration, QA and product readiness (2026-11-16)

**Status: built and tested on local staging servers. Not deployed.** Production (livefiberconnect.com) is unchanged: every commit carries `[skip render]`, `render.yaml` is untouched, and the platform stays off in production (tested).

## 1. Customer journey: verified end to end

The journey is exercised in a real browser on a phone viewport (`tests/e2e/journey.e2e.ts`), and at the API and database level (`tests/platform-opportunities.test.ts`).

| # | Step | Evidence |
|---|---|---|
| 1 | Customer enters the site (`/savings`) | Page renders; title; no console errors |
| 2 | Starts the assessment | "Find My Savings" leads to step 1; ZIP validated |
| 3 | Enters recurring expenses | Internet (bill + equipment), mobile (lines, cost) and electricity (bill, own/rent, roof sun); ownership required for solar |
| 4 | Deterministic engine analyzes | Server snapshot; the browser recomputes identically (unit-tested); integer cents |
| 5 | Dashboard shows results and assumptions | Totals checked ($450/mo); "How we calculated this" lists the solar estimate disclosure |
| 6 | Available vs unverified offers are distinguished | "Needs address check" (real Omni Fiber plans), "Sample data" and "Estimate" (solar) chips, each asserted |
| 7 | Customer requests assistance | Consent enforced; contact sends the customer's selections; booking through the scheduler |
| 8 | Opportunity persisted | One row per service as selected (e.g. 2 Gig, not our default 1 Gig), with figures re-derived on the server |
| 9 | Authorized admin manages it | Admin → Opportunities: row shown with a SAMPLE label where relevant; status changed; audit note on the lead timeline |

## 2. Electricity → solar

Rooftop solar is the electricity alternative (owner direction, 2026-11-16).

- **Model:** `shared/platform/solar.ts`. Each household's alternative is calculated from program terms, then ranked and projected like any other offer:
  - **Remaining utility bill:** the fixed charge plus the uncovered share of usage. It follows the price-increase scenario.
  - **Solar payment:** covered kWh × the contract rate, rising by the contract escalator. The engine gained `escalatorBps` on recurring charges for this.
- **Honesty rules:**
  - Results are always labelled "Estimate", and every assumption is listed.
  - No incentives or tax credits are assumed.
  - Owners only. A heavily shaded roof gives an explanation, not a number.
  - When solar costs more, it says so and isn't pre-selected.
- **Production has no solar program terms** (`SOLAR_PROGRAMS = []`). It therefore shows "Solar could lower your electricity costs… an advisor can prepare a free site-specific estimate" and records an advisor opportunity. It shows no number until real terms are supplied. Staging shows a clearly labelled sample program.
- Older assessments that used the separate "solar" category are upgraded automatically: schema preprocess, drafts and edit hand-offs.

## 3. What was broken or incomplete before this phase

| Area | Problem | Fix |
|---|---|---|
| Application state | The customer's option choices on the results page never reached the server; admins saw our default picks | Contact sends `selections`; the server recomputes and stores opportunities (unknown ids fall back to the default; prices are never taken from the request) |
| Data model | No opportunity entity: admins couldn't track per-service work | Migration 7 `opportunities` (FKs, CHECK constraints, cascade); repository functions; admin API and UI |
| Electricity | No alternative compared; solar was a separate screen | Solar is now the electricity comparison (see §2) |
| Option prices | "Monthly price" left out recurring charges (e.g. the sample cable plan showed $55 instead of $70 with its modem) | `firstMonthPrice` includes charges that start immediately |
| Booking | Clicking the already-selected date cleared the times and never reloaded them ("Loading times…" forever) | Re-selecting the current date is a no-op |
| Validation | "12.345" showed "Enter your monthly bill" instead of the format message | Format errors are kept |
| Accessibility | Error-summary links were 17 px tall (WCAG 2.5.8) | Taller targets |
| Admin on phones | Nav links overlapped and couldn't be tapped | Nav gets its own scrollable row |
| UX | Advisor CTA only at the bottom; no empty state; bare "Loading…"; no retry on network errors; heading focus box visible to mouse users; "tv" lower-cased; ranking badges on single options (including "Easiest switch" on a 25-year solar contract); contradictory solar note on staging | CTA after the opportunities; empty-state card; skeleton; Try again; focus box removed for programmatic focus; label fixed; badges only when there's a choice; note shown only when relevant |
| Operations | Errors logged as raw objects; no request ids; health check didn't touch the DB; staging could email real customers if given a key; no backup tooling | JSON logs, `X-Request-Id`, DB-backed `/api/health` (503 on failure), staging email allow-list + `[STAGING]` subjects, `npm run db:backup` |
| Tests | Browser checks were ad-hoc scratch scripts | Committed E2E suite (`npm run test:e2e`) |

## 4. Tests (all executed on 2026-11-16)

| Suite | Files | Tests | Result |
|---|---|---|---|
| Unit, API, DB, infra (`npm run check`, which also typechecks and lints) | 10 | 153 | **All passed**; lint: 0 errors (warnings are pre-existing style rules) |
| Browser E2E (`npm run test:e2e`) | 4 | 17 | **All passed**, two consecutive full runs plus a final run |
| Migration rehearsal on a DB created by deployed commit `624aa58` | — | — | **Passed** (1–7 applied, data preserved, idempotent) |
| Lighthouse (mobile, simulated slow 4G) | — | — | See §5 |

New coverage this phase:
- **Unit:** solar estimate, escalator compounding to the cent, legacy upgrade, opportunity derivation.
- **Database integration:** migration 1–4 database upgraded with data, immutability triggers, foreign keys and checks, idempotency, backups and rotation.
- **API:**
  - Selections honoured, and forged ids and prices ignored.
  - Advisor and general-review opportunities.
  - Honeypot and bad tokens create nothing.
  - Admin list, filter and status updates with an audit note.
  - Validation, including SQL-ish input rejected.
- **Security and authorization:**
  - Every admin GET returns 401 without a session and with a forged cookie.
  - Writes need a session and the anti-CSRF header.
  - Login doesn't reveal which credential was wrong.
  - The platform API is closed in production.
- **Infrastructure:**
  - The health check reports the database, and returns 503 when the database is down.
  - Request ids are generated, or a well-formed upstream id is reused.
  - Error logs carry no query strings or contact details.
  - Config validation works, and the staging email allow-list is enforced.
- **Browser:**
  - The full journey.
  - Edge cases:
    - invalid input
    - a linked error summary
    - Back keeps answers
    - "I don't know" leads to an incomplete result
    - draft restore and opt-out
    - renter → solar not suitable
    - wrong or missing token
    - a network failure followed by a working Try again
    - an already-contacted state
  - Responsive layout at 320, 390, 768 and 1280 px, with no horizontal scroll, including the admin.
  - axe-core on 11 states, with 0 violations.
  - Keyboard order with visible focus.
  - Reduced motion.
  - The fiber site in production mode loads no platform code, has 0 axe violations, robots allows indexing, and every platform route returns 404.

## 5. Performance (Lighthouse mobile, this machine)

| Page | Performance | LCP | CLS | Note |
|---|---|---|---|---|
| Fiber home (production mode) | 96 / 96 | 2.6 s | 0 | Unchanged from M1 (96–97, 2.5–2.6 s); desktop 100 |
| Platform home | 96 | 2.6 s | 0 | Accessibility 100 |
| Assessment | 93 | 2.9 s | 0 | Accessibility 100 |
| Results dashboard | 90–91 | 3.2 s | 0 | **Above the 2.5 s target**: the results token lives in the URL fragment (never sent to the server), so data loads only after the app and page code. Plan: start the fetch from a tiny inline script before React loads, and load the recalculation code (Zod and the engine) after the first paint |

## 6. Remaining production risks

1. **Legal review outstanding:**
   - C1: TCPA consent wording.
   - C3: savings claims.
   - C5: solar estimate wording and financing disclosures.
   - C7: compensation disclosure.

   The platform must stay off in production until these are reviewed.
2. **Backups are not automated or off-site** (M6). Run `npm run db:backup` before each deploy until a destination is approved.
3. **No error alerting or uptime monitor.** Logs only; free tiers are available but need accounts.
4. **Single admin account, no MFA** (M5). Opportunity management is not role-scoped yet.
5. **Client IP behind Cloudflare** (M1): rate limits and consent IPs may record proxy addresses.
6. **Results LCP 3.2 s** on slow mobile (§5).
7. **No real solar program terms.** Production can only offer an advisor estimate for electricity.
8. `node:sqlite` is experimental, and there's a single 1 GB disk. Postgres is planned for the sales-operations phase.

## 7. Estimated recurring infrastructure costs

| Item | Monthly | Status |
|---|---|---|
| Render web service Starter + 1 GB disk (production) | ≈ $7.25 | Live |
| Render staging service + disk | ≈ $7.25 | Needs approval ⚑ |
| Domain (livefiberconnect.com) | ≈ $1 (≈ $11–15/yr) | Live |
| Resend email | $0 up to 3,000/mo (100/day); $20 for 50k | Account not created ⚑ |
| Cloudflare DNS + Turnstile | $0 | DNS live; Turnstile needs a site key ⚑ |
| Uptime monitor (UptimeRobot/Better Stack free) | $0 | Needs account ⚑ |
| Error alerting (Sentry free tier) | $0 at pilot volume | Needs account ⚑ |
| Off-site backups (Cloudflare R2 free tier, 10 GB) | $0 | Needs account ⚑ |
| Testing tools (Vitest, Playwright, axe-core, Lighthouse) | $0 | In use |
| **Total infrastructure** | **≈ $8 today; ≈ $16 with staging; ≈ $36 if Resend's paid tier is ever needed** | |

This leaves most of the $300/month tooling target for development and creative tools (e.g. a Higgsfield plan; see `11-creative-production.md` §10 for a capped budget). Nothing paid was provisioned or activated in this phase.

## 8. Ready for a controlled pilot (after approvals)

**Ready:**
- The household assessment: internet, mobile, TV, and electricity with the solar screen.
- Deterministic results with labelled data quality.
- Real Omni Fiber Monroe plans as "needs address check".
- The advisor hand-off with consent, booking, and opportunities in the admin with a status pipeline.
- Staging isolation.

**Pilot shape:**
- Enable `PLATFORM_ENABLED` on a staging or pilot service, not production, with `SAMPLE_DATA_ENABLED=false`.
- Invite a small, known group.
- The team works opportunities from the admin.

**Not ready:**
- Public production launch, until legal review and backups are done.
- Real solar, mobile and TV offers: there are no verified terms on file.
- Multi-user sales operations.

## 9. Items requiring human approval ⚑

1. **Create the Render staging service:** ≈ $7.25/mo, using `render.staging.yaml`. Set `STAGING_EMAIL_ALLOWLIST`.
2. **Real solar program terms** to load into `SOLAR_PROGRAMS`: installer or financier, price per kWh or payment, escalator, term, upfront cost, service area, plus documentation for provenance.
3. **Legal review:** C1, C3, C5, C7, and the platform consent text `platform-2026-11-16`.
4. **Accounts (all free tiers):**
   - an uptime monitor and Sentry
   - Cloudflare R2 for off-site backups
   - Turnstile site key
   - Resend
5. **Deploy to production** with the platform off: security fixes and M1 + Phase 3 code, after a pre-deploy `npm run db:backup`, about 1 minute of downtime.
6. **Creative production:** approve the Higgsfield tier and credit cap in `11-creative-production.md` before any generation.
7. Parent brand name and domain.

## 10. Recommended next milestone — "M3: Pilot launch readiness"

1. Production deploy of everything built, with flags off, plus backups (scheduled and off-site) and uptime and error monitoring.
2. Staging service live. Pilot on staging with real (non-sample) data and a small invited group.
3. Results performance: an early data fetch and deferred recalculation code, to get the results page under 2.5 s LCP.
4. Provider data in the database: offers and solar programs move from code to tables, with an admin verification queue and expiry, so prices can change without a deploy.
5. Admin roles: individual accounts, revocable sessions, MFA, and opportunity assignment and owner. This is the first slice of sales operations.
6. Legal-review changes folded in, then a go/no-go for enabling the platform in production.
