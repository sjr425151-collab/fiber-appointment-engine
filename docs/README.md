# Project documentation

Household expense intelligence & service brokerage platform — starting with the **Fiber Connect** acquisition funnel (livefiberconnect.com, Monroe, MI).

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
| [12-phase3-readiness.md](12-phase3-readiness.md) | Phase 3: verified customer journey, solar alternative, fixes, test inventory, risks, costs, pilot readiness, approvals |

## Implementation status at a glance (2026-11-16)

| Capability | Status |
|---|---|
| Fiber funnel, locations, booking, admin, SEO | **Live** |
| Email notifications (outbox, alerts, confirmations, reminders) | **Live** in code; **not sending** until `RESEND_API_KEY` is set |
| Security fixes H1, H2, H3 (partial), M2, M3 (notice), lows | **Built & tested, not deployed** — awaiting approval |
| Deterministic financial engine (`shared/finance`) | **Built & tested**, powering the platform results |
| Provider/offer/provenance model, eligibility, ranking (`shared/offers`) | **Built & tested**, used by the platform catalog (offers still in code, not the DB) |
| Household platform: assessment, analysis snapshots, results dashboard, advisor handoff/booking, admin Assessments | **Built & tested on local staging**, behind `PLATFORM_ENABLED` (off in production), **not deployed** |
| Electricity → rooftop solar estimates (labelled, assumption-based) | **Built & tested**; production has no real program terms yet, so it offers an advisor estimate |
| Opportunities (per-service, as the customer selected) + admin pipeline | **Built & tested**, not deployed |
| Ops: JSON error logs + request ids, DB health check, staging email allow-list, `npm run db:backup` | **Built & tested**, not deployed; scheduling/off-site backups need approval |
| Staging workflow: flags, `render.staging.yaml`, banner, noindex | **Built & tested**; Render staging service **not created** (needs approval, about $7.25/mo) |
| Parent brand/domain, sales ops, RBAC, AI layer | Proposed |
| Backups, monitoring | Proposed — need approval |

## Tests

`npm run check` runs typecheck, lint and all unit/API/DB tests (153 at the time of writing); `npm run test:e2e` builds and runs the browser suite (17 tests: journey, edge cases, responsive, axe-core, fiber production mode). Files:
`tests/api.test.ts` (API, security regressions, locations), `tests/notify.test.ts` (email outbox), `tests/finance.test.ts` (cost engine), `tests/offers.test.ts` (provenance, eligibility, ranking, adapters), `tests/platform-safety.test.ts` (flags, production isolation), `tests/platform-analysis.test.ts` (assessment → analysis), `tests/platform-api.test.ts` (assessment, results token, contact → lead, admin), `tests/platform-opportunities.test.ts` (opportunities, authorization), `tests/db-migrations.test.ts` (upgrade of a production-shaped DB, backups), `tests/infra.test.ts` (health, logs, config), `tests/e2e/*` (browser).
