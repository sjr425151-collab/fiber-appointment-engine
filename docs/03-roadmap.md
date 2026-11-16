# 03 — Roadmap, first milestone, costs & decisions

_Status legend: **Live** · **Built** (tested, not deployed) · **Next** · **Planned**._

## 1. Phases (vertical slices, each demoable on staging)

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 Audit & foundation | Audit, architecture, risks, ops docs; finance engine; offer model; security fixes | Docs merged; 94 tests green; security fixes built | **Built** (this session) |
| 0.5 Production hardening | Deploy security fixes; Turnstile on lead form; backups; staging service; real client IP behind Cloudflare | No open High findings; daily restorable backup; staging live | **Next** ⚑ |
| 1 Product shell | Parent brand, design tokens v2, homepage, `/how-it-works`, `/how-we-make-money`, SEO base | Lighthouse ≥ 95 all categories on mobile; content legal-reviewed | Planned ⚑ brand |
| 2 Assessment | Internet + mobile assessment, consented draft persistence, completion tracking | Validated multi-step flow; a11y audit pass; abandonment events | Planned |
| 3 Savings engine UI | Wire `shared/finance` to results dashboard; scenario controls; assumption display; stored immutable analyses | Snapshot tests; results reproducible by `assumptionsVersion` | Planned (engine **Built**) |
| 4 Provider intelligence | Offer/provenance tables + admin, re-verification queue, Omni Fiber pilot seeded from `shared/offers/seed.ts` | Stale data auto-downgraded in UI; audit trail on edits | Planned (model **Built**) |
| 5 Sales operations | Users/roles, revocable sessions + MFA, opportunities, configurable stages, orders/installs/activations, commissions, audit log; Postgres (ADR-002) | Reps see only assigned records (tests); commission forecast vs actual | Planned |
| 6 AI enrichment | Grounded explanations, plan-detail extraction from user text, advisor assist, cost logging | Output numbers verified against snapshot; works with AI disabled | Planned |
| 7 Creative & CRO | Higgsfield assets, landing variants, A/B infrastructure | Variant assignment + significance reporting; CWV maintained | Planned ⚑ spend |
| 8 Launch hardening | Security review, a11y audit, perf audit, E2E suite, monitoring, rollback drill | Checklist signed off | Planned |

Mobile, TV, electricity and solar categories follow the internet slice through Phases 2–4; **electricity and solar ship only after legal review** (risk register C4/C5).

## 2. First independently deployable milestone (after approval)

**"M1 — Hardened fiber funnel + internet savings preview (staging)"**

1. Deploy the built security fixes (H1/H2/H3/M2/lows) to production with a pre-deploy backup.
2. Create the staging service + `staging` branch (ADR-008).
3. On staging only: `/assess/internet` (ZIP, current provider, monthly cost, speed, equipment fee, promo end) → results page computed by `shared/finance` + ranked Omni Fiber offers from `shared/offers`, showing data-quality labels, assumptions, switching costs, break-even and the commission disclosure. Address-level eligibility shows "needs address check" (true today).
4. CTA hands off to the existing booking flow (same lead, consent, attribution, emails).

Demonstrates the core value loop end-to-end on real data without touching the live funnel.

## 3. Dependencies & operating costs (monthly, estimates)

| Item | Cost | Status |
|---|---|---|
| Render web service (Starter) + 1 GB disk — production | ≈ $7.25 | Live |
| Render staging service + disk | ≈ $7.25 | Needs approval ⚑ |
| Render Postgres (Phase 5) | from ≈ $6 + storage | Later |
| Domain(s) — livefiberconnect.com (+ parent domain) | ≈ $11–15/yr each | Parent domain needs decision ⚑ |
| Cloudflare DNS + Turnstile (bot protection) | $0 (free tiers) | Next |
| Resend email | $0 up to 100/day, 3,000/mo; $20/mo for 50k | Account not yet created ⚑ |
| Off-site backups (e.g. object storage) | < $1 at current size | Next ⚑ provider choice |
| Error monitoring (e.g. Sentry free tier) | $0 at pilot volume | Next |
| AI explanations (Phase 6) | Usage-based; measure per analysis, enforce a daily cap | Later — pricing to be confirmed at build time |
| Higgsfield creative | Subscription/credits; prior quote ≈ 104–128 credits per 8 s 1080p clip | Needs approval ⚑ |
| SMS (Twilio or similar) | Number + per-message + 10DLC registration fees | Optional, later ⚑ |

## 4. Decisions needed from the owner ⚑

1. **Approve deploying the security fixes** (H1 is a live lead/consent-takeover issue). Recommended: immediately, outside business hours (≈ 1 min downtime).
2. **Approve a staging environment** (≈ $7.25/mo) and the branch policy (staging branch auto-deploys staging; production deploys only on approval).
3. **Parent brand name and domain.**
4. **Resend account** + sending subdomain DNS (enables lead alerts — currently none are sent) and a team alert inbox for Monroe.
5. **Cloudflare Turnstile** on the lead form (free; needs a site key from the Cloudflare dashboard).
6. **Backup destination** (e.g. Cloudflare R2 or S3 bucket) for nightly database snapshots.
7. **Legal review** engagement for the items in the risk register's compliance section before energy/solar or any outbound SMS.
