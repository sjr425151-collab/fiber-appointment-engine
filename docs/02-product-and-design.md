# 02 — Product, information architecture & design direction

_Status: **Proposed**. The parent brand name and domain are an owner decision (⚑); "[Parent]" is a placeholder and nothing below is published._

## 1. Positioning

[Parent] helps a household see what it spends on internet, mobile, TV and energy, compare **verified** alternatives at its address, and get human help switching. It is a broker: it can be paid by providers, so it must earn trust by being transparent about data quality and compensation.

**Trust rules that shape every screen**
- Every price shows its status: _Verified_ · _Manually verified (date)_ · _Estimate_ · _Needs address check_ · _Unavailable_.
- No "guaranteed savings". Savings are "estimated, based on what you told us and the prices on file".
- Future price increases appear only as labelled hypothetical scenarios.
- Recommendations show their criteria and a plain disclosure: "We may be paid by providers when you switch. Payment never changes how we rank options."

## 2. Route & navigation map

| Route | Purpose | Status |
|---|---|---|
| `/` | Home: what it does, categories, how it works, what's verified vs estimated, CTA **Find My Savings** | Proposed (parent domain) |
| `/assess` → `/assess/:step` | Multi-step assessment (location → categories → current services → details → contact & consent) | Proposed |
| `/results/:id` | Savings dashboard (overview, opportunities, service-by-service, alternatives by status, projections, assumptions, switching costs, next steps) | Proposed |
| `/compare/:category` | Category comparison at an address | Proposed |
| `/how-it-works`, `/how-we-make-money`, `/data-sources` | Methodology, compensation disclosure, provenance explanation | Proposed |
| `/privacy`, `/terms`, `/accessibility`, `/do-not-sell` | Legal | `/privacy` Built; others Proposed |
| `/:market` on livefiberconnect.com | Fiber acquisition funnel (existing) | **Live** |
| `/admin/*` | Command center: leads/opportunities, pipeline, providers, offers & provenance, coverage, agents, analytics, commissions, consent records, audit log, system health | Partly **Live** |
| `/rep/*` | Sales rep workspace (assigned opportunities only) | Proposed |

**Primary nav:** How it works · Categories · Data sources · **Find My Savings**. Mobile: sticky bottom CTA (pattern already proven on the fiber site).

## 3. Assessment UX (Stage B)

- 5 short steps, one decision per screen, progress indicator, back navigation, autosave **only after consent** (otherwise in-memory).
- ZIP first (determines which categories/offers exist), street address only when needed to check serviceability, with a one-line "why we ask".
- Per category: provider (typeahead), monthly cost (currency input, `inputMode="decimal"`, parsed with `parseDollars`), optional advanced details collapsed by default (speed, technology, caps, equipment fees, promo end; lines, financing; utility, usage, rate plan; homeownership for solar).
- "I don't know" is always allowed and produces an **incomplete** analysis that asks for that input, not a guess (the engine already enforces this).
- Energy and solar flows show eligibility screening and a legal-review banner until counsel approves the copy (risk register C4, C5).

## 4. Design system direction

Build on the existing token set (dark editorial palette, Sora display / Inter text, 16 px base, 8 px spacing grid, 12–24 px radii). Changes for the parent brand:
- **Light theme as the default for finance screens** (dense numbers read better), dark for marketing hero only. Dual themes only where both reach AA.
- Numeric typography: tabular figures for all money columns; negative values with a true minus and a text label, never colour alone.
- Data-viz: bar comparisons (current vs alternative), cumulative-savings line with the break-even point marked; no decorative charts. Every chart has a table equivalent.
- Status chips for data quality (icon + text) with consistent colours across the product.
- Motion: ≤ 200 ms UI transitions, no scroll-jacking; the hero is the only cinematic element.
- WCAG 2.2 AA: target sizes ≥ 24 px (44 px for primary actions), focus visible, error summaries linked to fields, no information by colour alone.

## 5. Higgsfield creative brief (outline — full prompts in Phase 7)

**Art direction:** real, warm, unglamorous homes at golden hour/blue hour; everyday technology (router, phone, thermostat, solar panel, TV) presented calmly; "clarity" metaphors — light passing through glass, tangled cables resolving into a single line, paper bills becoming a clean ledger. No stock-photo smiles, no logos, no fake UI.

**Hero video storyboard (12–15 s, seamless loop):** (1) dusk street, warm windows; (2) push-in to a kitchen table with scattered bills; (3) bills dissolve into soft light lines; (4) lines resolve into a calm, organized home at night; loop back to (1). Composed with the subject right-of-centre and negative space left for the headline; a separate 9:16 framing for mobile.

**Deliverables & specs:** 1080p+ master; web encodes AV1 + H.264 at 1080p/720p and 720×1280 mobile (≤ 1.5 MB mobile, ≤ 3.5 MB desktop); poster = frame 0 (AVIF/WebP/JPEG); muted, `playsinline`, loop, poster-only for reduced motion / Save-Data; four supporting stills (internet, mobile, TV, energy) at 4:3 and 1:1; three social concepts (9:16, 1:1).

**Process:** generate → review against an artifact checklist (warped architecture, extra fingers, text, logos, flicker) → regenerate rejects → encode with `scripts/build-media.sh` (`HERO_VIDEO=` path) → Lighthouse check. **Budget:** prior check showed ~104–128 credits per 8 s 1080p clip; the account had insufficient credits. Requires owner approval of spend (⚑).
