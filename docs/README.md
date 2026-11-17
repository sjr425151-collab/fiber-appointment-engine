# Project documentation

**Tucker** (livefiberconnect.com): a home-service savings broker — household bill optimization and service brokerage — internet, mobile, TV and electricity/solar. The per-location fiber pages are one acquisition channel into it.

| Doc | Contents |
|---|---|
| [00-audit.md](00-audit.md) | Verified production state, current architecture, route map, reusable assets, functionality to preserve, missing systems |
| [01-architecture.md](01-architecture.md) | Target architecture, architecture decision records, data-model proposal, migration plan, AI layer design |
| [02-product-and-design.md](02-product-and-design.md) | Positioning & trust rules, route/IA map, assessment UX, design-system direction, Higgsfield creative brief outline |
| [03-roadmap.md](03-roadmap.md) | Phases with exit criteria, first deployable milestone, operating costs, **owner decisions needed** |
| [07-risk-register.md](07-risk-register.md) | Security findings with remediation status; compliance items needing legal review |
| [08-operations.md](08-operations.md) | Environments, deploying (and `[skip render]`), staging, feature flags, migrations, backups, rollback, configuration |
| [09-design-system.md](09-design-system.md) | Household-platform tokens, components, accessibility patterns, style isolation from the fiber site |
| [10-milestone-m1.md](10-milestone-m1.md) | Milestone M1 stages, acceptance criteria and validation results |
| [11-creative-production.md](11-creative-production.md) | Higgsfield production package: art direction, storyboard, prompts, delivery, performance and accessibility limits, budget gates (proposed) |
| [../brand/README.md](../brand/README.md) | **TUCKER brand system**: decision log, Phase 0 audit, brand strategy, three creative territories, mascot production plan (proposed; awaiting founder approval) |
| [13-transition.md](13-transition.md) | Short map of the move from fiber appointment engine to the LiveFiberConnect platform: reusable, adapted, still fiber-specific, next |
| [12-phase3-readiness.md](12-phase3-readiness.md) | Phase 3: verified customer journey, solar alternative, fixes, test inventory, risks, costs, pilot readiness, approvals |

## Implementation status at a glance (2026-11-16, after the production deploy of `79b37cb`)

| Capability | Status |
|---|---|
| Fiber funnel, locations, booking, admin, SEO | **Live** |
| Email notifications (outbox, alerts, confirmations, reminders) | **Live** in code; **not sending** until `RESEND_API_KEY` is set |
| Security fixes H1, H2, H3 (partial), M2, M3 (notice), lows | **Live** (deployed 2026-11-16) |
| Ops: JSON error logs + request ids, DB-backed `/api/health` (shows the deployed commit), `npm run db:backup` | **Live**; backup schedule and off-site copy need approval |
| Household platform: assessment, results, solar estimates, advisor booking, opportunities + admin pipeline | **Live** at `/savings` since 2026-11-16 (owner set `PLATFORM_ENABLED=true`; live commit `5c3a008`) |
| Location-driven internet offers, free bill-review requests, bill insights, address capture, price-freshness warning | **Live** as `50d7982` (found live on 2026-11-17; deployed by a Render action, not by a push — see `08-operations.md` on `[skip render]`). Smoke-checked read-only: home, `/savings`, assessment and admin login load with no errors |
| Site name **Tucker** everywhere (titles, wordmark with the nose period, emails, calendar files, share images) | **Built & tested, not deployed.** The live site still says LiveFiberConnect until the founder approves a deploy (or a Render setting is saved). No schema change |
| Real solar program terms | **Missing**: without them, electricity results offer an advisor estimate, not a number |
| Staging service, monitoring/alerting, off-site backups | Proposed — need approval |

**Turning the household platform on in production:** Render → fiber-connect → Environment → add `PLATFORM_ENABLED` = `true` → Save (Render restarts the service, about 1 minute). Do **not** set `SAMPLE_DATA_ENABLED` in production (the server refuses to start with it). To turn the platform off again, delete the variable.

## Tests

`npm run check` runs typecheck, lint and all unit/API/DB tests (153 at the time of writing); `npm run test:e2e` builds and runs the browser suite (17 tests: journey, edge cases, responsive, axe-core, fiber production mode). Files:
`tests/api.test.ts` (API, security regressions, locations), `tests/notify.test.ts` (email outbox), `tests/finance.test.ts` (cost engine), `tests/offers.test.ts` (provenance, eligibility, ranking, adapters), `tests/platform-safety.test.ts` (flags, production isolation), `tests/platform-analysis.test.ts` (assessment → analysis), `tests/platform-api.test.ts` (assessment, results token, contact → lead, admin), `tests/platform-opportunities.test.ts` (opportunities, authorization), `tests/db-migrations.test.ts` (upgrade of a production-shaped DB, backups), `tests/infra.test.ts` (health, logs, config), `tests/e2e/*` (browser).
