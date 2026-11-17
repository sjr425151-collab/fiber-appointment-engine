# Phase 0 — Project and tool audit (2026-11-17)

Nothing in the live product was changed for this audit.

## 1. Technical inventory

| Area | What exists (verified in the repo and on the live site) |
|---|---|
| Stack | React 19, TypeScript, Tailwind v4, Vite; Express 5; SQLite; no UI or animation libraries |
| Hosting | Render (Docker, one service, persistent disk), Cloudflare DNS; live commit `5c3a008`; newest pushed commit `50d7982` is **not deployed** |
| Customer journeys (live) | Fiber landing → ZIP check → lead → booking; household assessment → results → advisor request → booking |
| Engine | Deterministic cost engine in integer cents; provenance-based data labels; commission-blind ranking |
| Admin | Leads, Opportunities, Assessments, Appointments, Locations, Service areas; one shared login |
| Categories with data | Internet (admin-managed per location). Mobile, TV, solar: no verified offers; customers get a free bill review |
| Not built | Home security, home phone, AI assistant, provider integrations, SMS, automated content |
| Quality | 159 unit/API/DB tests, 19 browser tests (journeys, responsive, axe-core); mobile Lighthouse 96, LCP 2.6 s |

## 2. Brand migration risk

| Touchpoint | Finding | Effort |
|---|---|---|
| Brand name | One constant (`BRAND.name`), read in 21 places; 5 remaining literal strings in 4 files | Low |
| Platform colors | 23 tokens in `src/platform/platform.css`; no raw color values in components | Low: a palette is a token swap |
| Fiber landing | Dark theme written with direct utility classes, not tokens | Medium: needs its own pass or retirement |
| Fonts | Sora and Inter, self-hosted, preloaded, with tuned fallback metrics | Medium: new display face needs the same tuning to keep layout shift at 0 |
| Logo assets | `favicon.svg`, touch icon, share images, wordmark component: all fiber-era | Low once the identity is approved |
| Hero video | Fiber-themed loop and posters under `public/media` | Replace only if a new hero is approved (directive §39) |
| Email sender | Name comes from a Render environment variable | Owner change |
| Domain and search | Everything is indexed under livefiberconnect.com | Needs a redirect plan before any rename |
| Legal copy | Consent, privacy and disclosures name the operator (Spotlight Marketing LLC), not the brand | Brand rename doesn't invalidate consent records; counsel should confirm wording |

**Pending-commit risk.** `50d7982` renames the public site to "LiveFiberConnect". It would go live the next time a Render setting is saved. With TUCKER approved, that rename is now an interim name at best (decision O6 in the log).

## 3. Higgsfield capabilities (checked, read-only)

| Capability | Status |
|---|---|
| Connection from this environment | Working |
| Plan and balance | Ultra, 3,000 credits |
| Image generation with reference images | Available (several models) |
| Reusable character references ("Elements") | Available; none created yet. Supported by GPT Image 2.6, Nano Banana Pro/2, Seedream 4.5/5 lite, Cinema Studio Image 2.5; video: Cinema Studio Video 2/3.0, Seedance 2.0, Kling 3.0 (needs a start frame) |
| Video generation, image-to-video, motion transfer | Available |
| Character-sheet workflow | Listed by the connector |
| Asset retrieval, credit balance | Available |
| Per-generation price before generating | **Not exposed by the model listing.** Must be read from the first quote or the Higgsfield UI |

## 4. Budget assumptions

- Tooling target stays at about $300/month. Recurring infrastructure is about $8/month today.
- The 3,000 credits already on the account are the round-1 budget; no purchase or plan change is proposed.
- Only known price point from this project: about 104–128 credits for an 8-second 1080p clip. If every credit went to such clips, that is roughly 23–28 clips. Still-image prices are unknown until the first quote.
- Rule: no batch starts without a quoted cost and a cap (see the production plan).

## 5. Who does what

| Role | Responsible for |
|---|---|
| Claude | Strategy, briefs, prompt engineering, critical review against the quality list, provenance records, code |
| Higgsfield | Mascot stills, reference sheets, expression and pose libraries, motion tests, ad footage |
| Code | Tokens, wordmark and patch as SVG, the canonical vector Tucker for product use, integration behind a staging flag |
| Founder | Creative approval at gates G1–G5; nothing is "approved" without an entry in the decision log |
| Counsel | Trademark and slogan clearance, mascot similarity, savings and solar claims, consent wording |
| Product testing | Existing suites plus brand checks: contrast, layout shift with new fonts, load time with any new media |

## 6. Roadmap: what can be built now, what waits

**Safe now (no creative approval needed):**
1. Make the fiber landing page token-driven so one theme file restyles the whole product.
2. A brand slot for the wordmark and mascot in the header, results and loading states (renders today's assets).
3. Tone-mode copy pass on existing product text (no name change).
4. Experiment plumbing for mascot-vs-no-mascot and message tests.
5. Provenance log format for generated assets; redirect plan for a new domain.

**Waits for approval:** wordmark, colors and type in the product (G3); any mascot imagery (G2–G3); hero video and ads (G4); public rename, domain cutover and slogan use (G5).
