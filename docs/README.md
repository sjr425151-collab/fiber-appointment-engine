# Project documentation

Household expense intelligence & service brokerage platform — starting with the **Fiber Connect** acquisition funnel (livefiberconnect.com, Monroe, MI).

| Doc | Contents |
|---|---|
| [00-audit.md](00-audit.md) | Verified production state, current architecture, route map, reusable assets, functionality to preserve, missing systems |
| [01-architecture.md](01-architecture.md) | Target architecture, architecture decision records, data-model proposal, migration plan, AI layer design |
| [02-product-and-design.md](02-product-and-design.md) | Positioning & trust rules, route/IA map, assessment UX, design-system direction, Higgsfield creative brief outline |
| [03-roadmap.md](03-roadmap.md) | Phases with exit criteria, first deployable milestone, operating costs, **owner decisions needed** |
| [07-risk-register.md](07-risk-register.md) | Security findings with remediation status; compliance items needing legal review |
| [08-operations.md](08-operations.md) | Environments, deploying (and `[skip render]`), migrations, backups, rollback, configuration |

## Implementation status at a glance (2026-11-16)

| Capability | Status |
|---|---|
| Fiber funnel, locations, booking, admin, SEO | **Live** |
| Email notifications (outbox, alerts, confirmations, reminders) | **Live** in code; **not sending** until `RESEND_API_KEY` is set |
| Security fixes H1, H2, H3 (partial), M2, M3 (notice), lows | **Built & tested, not deployed** — awaiting approval |
| Deterministic financial engine (`shared/finance`) | **Built & tested**, not wired to UI |
| Provider/offer/provenance model, eligibility, ranking, adapters (`shared/offers`) | **Built & tested**, not wired to UI or DB |
| Parent brand, assessment, results dashboard, sales ops, RBAC, AI layer | Proposed |
| Staging, backups, monitoring | Proposed — need approval |

## Tests

`npm run check` runs typecheck, lint and all tests (94 at the time of writing):
`tests/api.test.ts` (API, security regressions, locations), `tests/notify.test.ts` (email outbox), `tests/finance.test.ts` (cost engine), `tests/offers.test.ts` (provenance, eligibility, ranking, adapters).
