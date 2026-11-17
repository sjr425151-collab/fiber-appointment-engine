# Project documentation

**Tucker** (trytucker.com; previously livefiberconnect.com): a home-service savings broker — household bill optimization and service brokerage — internet, mobile, TV and electricity/solar. The per-location fiber pages are one acquisition channel into it.

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
| [15-consolidation.md](15-consolidation.md) | **Current structure.** Legacy site retirement: inventory (retain / refactor / archive / remove), URL map and redirects, benchmarks, SEO, test evidence, known gaps, deploy checklist |
| [14-domain-migration.md](14-domain-migration.md) | Move to trytucker.com: what the code does, dependency audit, owner's manual steps, verification checklists, rollback |
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
| Site name **Tucker** everywhere (titles, wordmark with the nose period, emails, calendar files, share images) | **Live** as `b8b6c50` (found live on 2026-11-17, deployed from Render) |
| Domain migration to **trytucker.com** (canonical URLs, sitemap, `www` handling, switchable 301s from the old domain) | **Live** as `b8b6c50` with `SITE_URL=https://trytucker.com`; checked read-only on 2026-11-17: canonical links, robots and sitemap use trytucker.com, `www` redirects. Old-domain redirects are still **off** (`LEGACY_REDIRECTS`) |
| Consolidation under Tucker: national home with an instant benchmark preview at `/`, fiber page moved to `/internet/<location>`, retired URLs redirected, benchmarks in results | **Built & tested, not deployed** (`15-consolidation.md`). Restore point `b8b6c50`. No schema change |
| Real solar, mobile and TV offer terms | **Missing**: those categories show labelled benchmarks ($200 solar for homeowners, $45 per mobile line, $75 TV), never a quoted price |
| Staging service, monitoring/alerting, off-site backups | Proposed — need approval |

**The savings experience is always on** once the consolidation is deployed; `PLATFORM_ENABLED` is no longer read and can be deleted from Render. Do **not** set `SAMPLE_DATA_ENABLED` in production (the server refuses to start with it).

## Tests

`npm run check` runs typecheck, lint and all unit/API/DB tests (179 at the time of writing); `npm run test:e2e` builds and runs the browser suite (20 tests: journey, edge cases, responsive, axe-core, production settings, regional page and retired URLs). Files:
`tests/api.test.ts` (API, security regressions, locations), `tests/notify.test.ts` (email outbox), `tests/finance.test.ts` (cost engine), `tests/offers.test.ts` (provenance, eligibility, ranking, adapters), `tests/platform-safety.test.ts` (flags, production isolation), `tests/platform-analysis.test.ts` (assessment → analysis), `tests/platform-api.test.ts` (assessment, results token, contact → lead, admin), `tests/platform-opportunities.test.ts` (opportunities, authorization), `tests/db-migrations.test.ts` (upgrade of a production-shaped DB, backups), `tests/infra.test.ts` (health, logs, config), `tests/e2e/*` (browser).
