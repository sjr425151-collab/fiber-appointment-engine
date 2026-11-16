# 01 — Target architecture, decisions & data model

_Status: **Proposed** unless marked Built. Owner decisions marked ⚑._

## 1. Shape

A **modular monolith** on the existing stack, split into clear modules with one-way dependencies. No microservices, no new framework: the current stack already meets the performance and reliability targets, and a second codebase would double the surface area a small team must secure.

```
                    ┌──────────── apps (one deployable, multiple front doors) ────────────┐
                    │  parent brand site (assessment, results)   fiber funnels (/:market) │
                    │  admin / sales workspace (role-gated)                              │
                    └───────────────────────────────┬───────────────────────────────────┘
                                                    │ HTTP JSON (Zod-validated)
 ┌──────────────────────────────────────── server modules ────────────────────────────────────────┐
 │ assessment ─▶ analysis (shared/finance) ─▶ offers (shared/offers) ─▶ recommendations           │
 │ leads/opportunities ─▶ pipeline (stages, assignments, orders, installs, activations, commissions)│
 │ scheduling · notifications (outbox) · consent & privacy · identity & RBAC · audit log · events │
 │ ai (explanations only; optional) · provider adapters (manual, partner APIs)                    │
 └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                  │ repository layer (all SQL in one place)
                                     SQLite today ─┴─ Postgres when needed (ADR-002)
```

**Rules:** pure, deterministic logic lives in `shared/` (no I/O, fully unit-tested). Server modules own I/O. AI never computes prices, eligibility or totals.

## 2. Architecture decision records

| # | Decision | Status | Rationale / consequences |
|---|---|---|---|
| ADR-001 | Keep the modular monolith (React + Express + Zod, TypeScript end-to-end) | Accepted | Working, fast (Lighthouse 100), small dependency set. Modules get explicit boundaries instead of new services. |
| ADR-002 | Stay on SQLite for the pilot; move to **Render Postgres** before multi-instance, multi-user sales operations or > ~50k leads | Accepted | SQLite is reliable for one instance but blocks zero-downtime deploys, horizontal scaling and point-in-time recovery. All SQL is already isolated in `server/repo.ts`, so the move is a repository rewrite, not an app rewrite. Trigger the move at Phase 5. |
| ADR-003 | Money = integer cents; rates = basis points; one versioned assumption set per analysis | **Built** | `shared/finance/money.ts`, `ASSUMPTIONS_V1`. No floats in totals. Stored analyses record `assumptionsVersion`. |
| ADR-004 | Provenance-first offers: consumer-facing status is *derived* from provenance + time, never typed in | **Built** | `publicStatus()` downgrades stale/expired data automatically. "Verified" requires a provider document or authorized API. |
| ADR-005 | Ranking is commission-blind by construction | **Built** | `rankOffers()` has no compensation input; four labelled lenses with inspectable criteria. |
| ADR-006 | AI = explanation and extraction layer only, behind a schema-validated, optional interface | Accepted | Results render fully without AI. AI receives only structured, PII-minimized facts; outputs are checked against source numbers before display. |
| ADR-007 | Parent brand and fiber funnels ship from **one codebase**, routed by hostname | Proposed ⚑ | Shared engine, admin, consent and attribution. The parent domain serves the assessment; `livefiberconnect.com` keeps the fiber funnel. Requires the brand/domain decision. |
| ADR-008 | Separate **staging** Render service from a `staging` branch; production deploys from `main` only after review | Proposed ⚑ | Today every push deploys to production (≈1 min outage). Needs owner approval (cost ≈ $7.25/mo) and a branch-policy change. |
| ADR-009 | Provider data enters only through adapters using authorized access (manual entry, provider documents, partner APIs) | **Built** (interface) | No scraping of prohibited sources; failing adapters are isolated with timeouts. |
| ADR-010 | Consent is append-only evidence | **Built**, not deployed | `consents` table + DB triggers; resubmissions never overwrite (security finding H1). |

## 3. Data model proposal

Existing tables stay. New tables (Postgres-compatible types; SQLite during the pilot):

### Households & assessments
| Table | Key columns | Notes |
|---|---|---|
| `households` | id, zip, market_id, address_hash, created_at | Address stored on `leads`/`assessments`; hash for dedupe without exposing PII |
| `assessments` | id, household_id, lead_id?, status (`draft`/`submitted`), answers JSON (validated), consent_id?, source/utm…, created_at | Draft persistence only with consent (Section 3B) |
| `assessment_services` | id, assessment_id, category, provider_name, monthly_cents, quality (`user_reported`/`customer_bill`), details JSON (speed, lines, promo end…) | One row per current service |
| `analyses` | id, assessment_id, assumptions_version, engine_version, input_hash, result JSON, created_at | Immutable snapshot → reproducible |

### Provider intelligence
| Table | Key columns | Notes |
|---|---|---|
| `providers` | id, name, categories, website | |
| `provider_partnerships` | provider_id, status, documented_at, reference, compensation JSON | Admin/finance only; never read by ranking |
| `offers` | id, provider_id, category, plan_name, attributes JSON, pricing JSON (cost-stream format), contract_months, eligibility JSON, restrictions JSON, disclosure_url, active | Validated by `offerSchema` |
| `offer_provenance` | id, offer_id, source_type, reference, recorded_by, verified_at, effective_from, expires_at, review, gaps JSON | **Append-only history**; latest row is current |
| `offer_geographies` | offer_id, zip / market_id | Indexed lookup |
| `coverage_evidence` | id, provider_id, level, subject (zip or address hash), source…, checked_at | Map data can never be `address_confirmed` |

### Sales operations
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email, name, role (`admin`/`manager`/`rep`), password_hash, mfa_secret?, active | Replaces the single env-var admin |
| `sessions` | id, user_id, created_at, expires_at, revoked_at, ip, user_agent | Server-side, revocable (finding M5) |
| `pipeline_stages` | id, key, label, order, terminal | Configurable (Section 9) |
| `opportunities` | id, lead_id, household_id, category, offer_id?, stage_id, owner_user_id, value_cents_est, created_at… | Replaces lead-status-as-pipeline |
| `orders` | id, opportunity_id, provider_id, order_ref, status, installed_at, activated_at, cancelled_at | `sales` table (unused) is superseded |
| `commissions` | (exists) + `expected_cents`, `received_cents`, status, clawback… | Forecast vs actual |
| `audit_log` | id, actor_user_id, action, entity, entity_id, before JSON, after JSON, ip, at | Append-only; consequential changes |
| `consents` | **Built** | One row per submission; immutable |
| `data_requests` | id, subject_email/phone hash, type (`access`/`delete`/`opt_out`), status, handled_by, at | Privacy workflow |

## 4. Migration plan

1. **Every schema change is an append-only migration** in `server/db/schema.ts` (never edit a shipped migration). Additive only (new tables/columns, backfills); destructive changes require a two-step expand → migrate → contract release.
2. **Rehearse against production-shaped data:** create a DB with the currently deployed commit, run the new code against it, verify invariants (done for migration 5 — see `08-operations.md`).
3. **Back up before deploy** (`VACUUM INTO` snapshot; see operations) — required once backups exist.
4. Deploy to staging, smoke-test, then production with approval.
5. SQLite → Postgres (ADR-002): introduce a repository interface, run both implementations against the same test suite, migrate data with a verified row-count/hash check, cut over during a quiet window, keep the SQLite file as rollback for 30 days.

## 5. AI layer (Phase 6, design)

`explain(analysisSnapshot) → { summary, bullets[], caveats[] }` with: provider-agnostic interface, JSON-schema-validated output, 8 s timeout, one retry, per-request token/cost logging, daily spend cap, PII stripped (no names, phone, email, street; ZIP and numbers only), external text (offer restrictions, provider pages) wrapped as untrusted data, and a post-check that every dollar figure in the output exists in the snapshot. On any failure the deterministic results render alone.
