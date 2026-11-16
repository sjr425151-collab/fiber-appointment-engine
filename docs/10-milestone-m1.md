# 10 — Milestone M1: parent platform foundation + first household assessment

_Approved by the owner on 2026-11-16 ("proceed with Phase 0 and the first independently deployable milestone"). Production deploys still require separate approval._

**Goal:** a working, staging-only parent platform where a household completes an assessment, sees a deterministic cost analysis with clearly labelled verified, pending and sample alternatives, and can hand off to an advisor — creating a lead that the existing admin can see. The live fiber site is untouched.

## Guardrails
- Everything ships behind `PLATFORM_ENABLED` (default **off**) and `SAMPLE_DATA_ENABLED` (default **off**). Production has neither set, so platform routes return 404 there and sample data can never load. A test enforces this.
- All commits carry `[skip render]` until the owner approves a production deploy.
- `render.yaml` (the production blueprint) is not modified. Staging uses a separate blueprint file that Render only reads if someone creates a Blueprint from it.

## Stages, dependencies and acceptance criteria

| # | Stage | Depends on | Acceptance criteria |
|---|---|---|---|
| S1 | **Staging & safety workflow** — typed environment flags, `render.staging.yaml`, staging banner + `noindex`, sample-data gate | — | With the flags unset: every platform route and API returns 404 and no sample offer is reachable (tested). Production blueprint unchanged. Staging runs locally with `APP_ENV=staging`. |
| S2 | **Design system** — light, finance-grade tokens; accessible components (button, field, currency input, choice cards, stepper, status chip, money, charts with table equivalents); living style guide page | S1 | Components keyboard-operable with visible focus; text contrast ≥ 4.5:1; used by S3 and S5 rather than duplicated; documented in `09-design-system.md`. |
| S3 | **Household assessment** — Zod schema shared by client and server; 5 steps (location, categories, current services, priorities, review); category fields for internet, mobile, TV, electricity, solar; "I don't know" allowed; local progress saving only with consent; server persistence returning an unguessable results token | S1, S2 | Invalid input blocked with linked error messages; back navigation keeps answers; completes on a 375 px phone; API validates and stores; results not readable without the token (tested). |
| S4 | **Engine connection** — map answers → cost streams (pure, tested); offer catalog = real Monroe Omni Fiber offers + labelled sample offers (staging only); per-category ranking; immutable analysis snapshot with assumption and engine versions | S3, `shared/finance`, `shared/offers` | Same input → identical snapshot; unknown costs → "incomplete" rather than a guess; sample offers never mixed with real ones or marked verified; energy/solar produce no savings claims (legal hold). |
| S5 | **Results dashboard** — spend overview, biggest opportunities, per-category breakdown, alternatives grouped by status, 1/5/10-year projections under labelled hypothetical scenarios, switching costs + break-even, assumptions, recommended next steps; interactive scenario/horizon/alternative controls computed by the same engine in the browser | S4 | In-browser recalculation equals the server snapshot (tested); charts have table equivalents; every number shows its data-quality label; mobile layout without horizontal scroll. |
| S6 | **Conversion & admin integration** — contact + consent from results (callback / advisor / appointment) creates a lead linked to the assessment; booking reuses the existing scheduler; admin shows the assessment on the lead plus an Assessments list; funnel events | S3–S5, existing leads/consent/outbox | Lead has consent record, attribution and assessment link; admin endpoints require a session (tested); booking works end to end in a browser. |
| S7 | **Validation & staging preview** — full test suite, typecheck, lint, build; fiber site regression (E2E + Lighthouse); platform Lighthouse; independent accessibility review; running staging preview; docs | all | All green; fiber Lighthouse unchanged; staging preview reachable; changes documented. |

## Outcome (2026-11-16)

**Status: built and tested on a local staging server. Not deployed:** production is unchanged, and Render staging is not created yet (see below).

| # | Stage | Status | Evidence |
|---|---|---|---|
| S1 | Staging & safety | Built & tested | `tests/platform-safety.test.ts`: production-default flags, 404s, sample data refused, reserved slugs, CSS/code isolation |
| S2 | Design system | Built & tested | `/savings/design`; `09-design-system.md`; axe-core clean |
| S3 | Assessment | Built & tested | Browser E2E: validation, linked error summary, back navigation, consented draft, 320 px reflow |
| S4 | Engine connection | Built & tested | `tests/platform-analysis.test.ts` (determinism, incomplete inputs, sample isolation, energy/solar hold) |
| S5 | Results dashboard | Built & tested | Client recalculation equals the snapshot (tested); horizon/scenario/option controls verified in a browser; live-region announcements |
| S6 | Conversion & admin | Built & tested | `tests/platform-api.test.ts`; browser E2E from contact to consent to slot to booking, then admin Assessments list and lead panel |
| S7 | Validation | Done | See results below |

### Validation results
- `npm run check`: typecheck, lint (no errors) and **123 tests passing** across 7 files.
- `npm run build`: passes.
  - Fiber site entry CSS is **63.90 kB / 11.07 kB gzip, identical to before**, because platform styles ship separately (4.3 kB gzip, loaded only on `/savings`).
  - Main JS 296 kB / 93 kB gzip, against 293 / 92 before.
- **Fiber regression:** a production-mode server with the flags unset ran the full funnel E2E with no console errors. It covered the ZIP check, form validation, booking, attribution and the admin funnel.
  - `/savings` and `/api/platform/*` returned 404, and robots.txt was unchanged.
- **Fiber Lighthouse** (mobile, simulated throttling, A/B interleaved on the same machine against the previous commit):
  - Performance 96–97 in both.
  - FCP about 1.6 s in both.
  - LCP 2.53–2.60 s against a baseline of 2.52–2.54 s.
  - Accessibility, best practices and SEO 100. Desktop 100 in all four.
- **Migration rehearsal:** migrations 5–6 applied on a DB created by the deployed commit `624aa58`, with data preserved and an idempotent reopen. The new code then ran the fiber funnel on that DB (see `08-operations.md`).
- **Platform Lighthouse** (mobile, simulated slow 4G):
  - Home: performance 96, accessibility 100, best practices 100, LCP 2.6 s, CLS 0.
  - Assess: performance 94, accessibility 100, best practices 100, LCP 2.7 s, CLS 0.
  - Desktop home: 100.
  - SEO is lower by design, because staging is `noindex`.
  - The server preloads the platform chunk, its CSS and the page chunk from Vite's manifest on `/savings` pages only. That cut LCP from 2.9 / 3.2 s.
  - Home: performance 95, accessibility 100, best practices 100.
  - Assess: performance 91, accessibility 100, best practices 100.
  - SEO is lower by design, because staging is `noindex`.
- **Accessibility:** an independent review found 3 major and 11 minor issues plus 2 UX items. All were fixed:
  - reflow at 320 px
  - live region for recalculated totals
  - focus after submit and booking
  - linked error summary
  - DOM order of the action buttons
  - table semantics
  - ChoiceCards descriptions
  - option names
  - page titles
  - landmarks
  - visible status details
  - slot-loading errors
  - reduced motion
  - "Save and back to review"
  - chart label size

  After the fixes, axe-core (WCAG 2.2 AA plus best practices) reports **0 violations** across 14 states, from home through every assessment step and results to the slot picker.

### Known limits and follow-ups
- **Platform mobile LCP is 2.6–2.7 s, against a 2.5 s target.** The main bundle still contains the fiber landing page's code, which platform pages download but don't use. Fix in M2: split the landing page into its own preloaded chunk, measured A/B on the fiber site first, or prerender the platform hero.
- The fiber site's mobile LCP sits right at the 2.5 s target under Lighthouse's simulated slow 4G; that was already true before M1. The LCP element is the hero heading, which waits on the CSS and the font. Recommendation: inline critical CSS for the hero (next milestone).
- The platform is a working name ("Household Savings") and is labelled Preview; brand and domain are an owner decision.
- Consent text `platform-2026-11-16` and the energy/solar wording need legal review before any production launch.
