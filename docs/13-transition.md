# 13 — Transition: fiber appointment engine → LiveFiberConnect platform (2026-11-16)

The product is the household bill optimization and service brokerage platform. This page is the short map; details live in the other docs.

> **Superseded in part (2026-11-17):** the name is now Tucker, the homepage is the national savings home, and the fiber page lives at `/internet/<location>`. "Build next" items 2 and 4 are done. See `15-consolidation.md`.

## Functional today

| Piece | Status |
|---|---|
| Assessment (internet, mobile, TV, electricity), cost engine, results dashboard, projections | **Live** at `/savings` |
| Lead capture with consent, booking, email outbox, admin (Leads, Opportunities, Assessments, Locations, Service areas) | **Live** |
| Per-location fiber landing pages (`/`, `/:location`) | **Live**; now an acquisition channel that links to the bill analysis |

## Reused unchanged (already category-agnostic)

`shared/finance` (engine), `shared/offers` (offer, provenance, eligibility, ranking), `shared/platform/opportunity.ts`, leads/consent/scheduling/notifications, admin shell, design system.

## Adapted in this change (built & tested; see README for deploy status)

| Outdated assumption | Now |
|---|---|
| Real internet offers hard-coded to Omni Fiber in two Monroe ZIPs (`shared/offers/seed.ts`) | Offers are derived from each admin-managed location: provider, plans, prices, "verified on" date, label link (`shared/platform/market-offers.ts`). The offers a customer saw are stored with their snapshot. The seed remains only as a fallback for snapshots made before this. |
| Categories with no verified offers ended in "nothing found" and created no opportunity | They default to a free advisor bill review (the customer can opt out), which becomes an opportunity; each service also shows facts from the customer's own numbers (equipment cost per year, promo increase, cost per line). |
| Contact form never asked for the address the internet plans need | Optional service address when a selected plan needs an address check. |
| Two brands ("Fiber Connect", "Household Savings (working name) · Preview") | One: LiveFiberConnect (`BRAND.name`; the platform reads it). |
| Prices could silently disappear from results after 30 days | Admin banner warns 7 days before and when hidden; fix by updating "Prices verified on" in Locations. |

## Still fiber- or Omni-specific (known, intentionally left)

- Fiber landing page copy and structured data (`shared/content.ts`, `src/pages/Landing.tsx`): correct for that channel.
- Location presets named "Omni Fiber standard/Monroe pricing" (`shared/market.ts`): convenience presets in the admin.
- A location holds one provider and internet plans only. Mobile, TV and solar offers have no admin data model yet.
- Lead email templates and the booking confirmation say "fiber consultation".
- Repository and Render service names (`fiber-appointment-engine`, `fiber-connect`): cosmetic.

## Build next (in order)

1. **Offer data for the other categories:** admin-managed mobile, TV and solar programs with provenance and expiry (tables + review queue), so those categories show verified numbers instead of a review request. Needs real terms from the owner.
2. **Homepage decision:** make `/` the household platform home and move the fiber page to its location URL (owner decision; SEO redirect plan needed).
3. **Bill upload** for advisor reviews (photo/PDF attached to the lead; storage and privacy review first).
4. Category-neutral email templates and consultation wording.
5. Carried over: legal review, scheduled off-site backups, monitoring, individual admin logins with MFA, results-page speed.
