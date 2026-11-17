# 15 — Legacy website retirement and consolidation under Tucker

**Status (2026-11-17): built and tested, not deployed.** The live site runs `b8b6c50` (Tucker name, trytucker.com canonical, Monroe fiber homepage at `/`, savings pages at `/savings`). This change reaches customers at the next deploy, **including any saved Render setting** (for example switching `LEGACY_REDIRECTS` on).

**Restore point:** commit `b8b6c50` is the last commit before this change. Reverting the consolidation commit (or redeploying `b8b6c50` from Render → Manual Deploy → pick commit) brings back the old homepage and URLs. No data or schema changed, so a rollback needs no database work.

## What changed, in one paragraph

Tucker's national household savings experience is now the homepage. A visitor enters what they pay for internet, mobile, TV and electricity and sees an illustrative saving at once, with no contact details. The Monroe fiber page is no longer the homepage or the default; it is an optional regional campaign page at `/internet/monroe`, loaded only when someone visits it. Old URLs redirect to their replacement in one step, and URLs with no replacement return a real 404.

## Inventory

| Classification | Component | Notes |
|---|---|---|
| **Retain** | Cost engine (`shared/finance`), offer and provenance model, ranking, eligibility (`shared/offers`) | Unchanged apart from the new `benchmark` source type |
| **Retain** | Leads, consent records, scheduling and booking, email outbox, calendar files | Shared by the savings flow and regional pages |
| **Retain** | Admin: Leads, Appointments, Opportunities, Assessments, Locations, Service areas | Unchanged |
| **Retain** | Database and migrations 1–7, security middleware, rate limits, health check, backups script | No schema change in this work |
| **Retain** | ZIP availability check, service areas, location data (provider, plans, prices, verified-on date) | Feeds both the regional page and internet options in savings results |
| **Refactor** | Homepage | Was the Monroe fiber page; now Tucker's national home with the quick preview (`src/platform/pages/Home.tsx`) |
| **Refactor** | Fiber landing page | Moved from `src/pages/Landing.tsx` to `src/internet/RegionalPage.tsx` (+ `src/internet/components/`), served at `/internet/<location>`, lazy-loaded |
| **Refactor** | Savings analysis | Adds the owner's benchmarks where no real plan is on file (`shared/platform/benchmarks.ts`) |
| **Refactor** | Routing, sitemap, page metadata, structured data, share images, favicon, resource hints | See "SEO" below |
| **Refactor** | Customer emails | Requests from the savings flow now say "savings review"; regional fiber requests keep their fiber wording |
| **Refactor** | Privacy notice | Describes household services, not fiber only |
| **Archive** | Old fiber homepage at `/` and location pages at `/<location>` | Kept in git history (`b8b6c50`); URLs redirect (below) |
| **Archive** | `/savings` landing page | Merged into `/`; URL redirects |
| **Archive** | `PLATFORM_ENABLED` flag | No longer read; the savings experience is always on. The Render variable can be deleted at any time |
| **Archive** | Docs 00–13 | Historical record of earlier phases; this page and the README table are current |
| **Remove** | Location switcher and "default location" behaviour on the homepage | The homepage no longer depends on any location |
| **Remove** | Hero photo preload on non-regional pages | It is now sent only on `/internet/<location>` |
| **Remove** | Old names ("Fiber Connect", "LiveFiberConnect") in pages, emails, calendar files, share images | A browser test fails if one reappears |

Nothing was deleted from the database, and no migration was added.

## Application structure

```
/                         Tucker national home + quick preview      src/platform/pages/Home.tsx
/savings/assess           Full savings preview (4 steps)            src/platform/pages/Assess.tsx
/savings/results/:id      Private results (noindex)                 src/platform/pages/Results.tsx
/internet/:location       Regional internet campaign page           src/internet/RegionalPage.tsx
/privacy                  Privacy notice                            src/pages/Privacy.tsx
/admin/*                  Team area                                 src/pages/admin/*
/savings/design           Internal style guide (noindex)            src/platform/pages/DesignSystem.tsx
anything else             404 page with a way back
```

Service modules: `shared/finance` (math), `shared/offers` (offers, provenance, ranking), `shared/platform` (assessment, analysis, benchmarks, opportunities, brand), `src/platform` (savings UI), `src/internet` (regional internet UI), `server/` (API, HTML shell, redirects, email).

## Benchmarks (comparison assumptions)

| Category | Benchmark |
|---|---|
| Home internet | $55 a month |
| Mobile | $45 a month per line, excluding device financing |
| TV / streaming | $75 a month |
| Electricity with solar (illustrative, homeowners) | $200 a month |

Rules, all tested:
- Defined once in `shared/platform/benchmarks.ts` as integer cents, with a version that is stored in each analysis.
- Labelled "Benchmark" everywhere, with the disclosure that they are comparison assumptions, not offers or guarantees, and that real prices depend on availability, eligibility, promotions and other pricing factors.
- A benchmark appears only when no real plan is usable for that category at that address. Monroe's real internet plans still take priority there.
- A benchmark is selected by default only when it is lower than the current bill. The $200 solar benchmark is offered to homeowners only.
- A customer who asks for help with a benchmark creates an opportunity marked "needs an advisor quote · estimate", never a priced order.
- The homepage preview runs in the browser and sends nothing until the visitor chooses to continue.

## Legacy URL mapping

Handled in the application (`server/app.ts`), not in Cloudflare. Reasons: location addresses come from the database, the mapping needs the path, it is covered by tests, and it needs no dashboard access. **Do not add Cloudflare redirect rules for the same URLs**; two mechanisms can loop.

| Old URL | Result | New URL |
|---|---|---|
| `/` (fiber homepage) | 200, new content | `/` (Tucker home). Monroe content lives at `/internet/monroe` |
| `/monroe`, `/<active location>` | 301 | `/internet/<location>` |
| `/savings` | 301 | `/` |
| `/savings/assess` | 200 | unchanged |
| `/savings/results/:id` | 200 | unchanged (private links keep working) |
| `/internet` | 301 | `/` |
| `/privacy` | 200 | unchanged |
| `/admin/*` | 200 | unchanged |
| `/api/*` | never redirected | unchanged |
| `/<inactive or unknown location>`, `/savings/<anything else>`, any other path | 404 | none |
| `livefiberconnect.com/<path>` (and `www.`) once `LEGACY_REDIRECTS=true` | 301, one hop, query kept | `trytucker.com/<mapped path>` |
| `www.trytucker.com/<path>` | 301 | `trytucker.com/<mapped path>` |

Query strings (campaign tags) are preserved on every redirect. Redirects are cached for one hour so a mistake can be undone quickly. Form posts and the API are never redirected, so a page already open on the old domain keeps working.

No path returns 410: every retired page has a relevant replacement, and unknown paths return 404.

## SEO and brand

| Item | Now |
|---|---|
| Home title and description | "Tucker — Your home service savings broker", national description, no city or provider |
| Canonical | Always `SITE_URL` + the page's own path; regional pages are canonical at `/internet/<location>` |
| Structured data | Home: Organization + WebSite. Regional page: adds Service + FAQ for that location. Other pages: none |
| Share image | `/og-tucker.jpg` on Tucker pages; the location's own image on regional pages |
| Sitemap | `/`, `/savings/assess`, `/internet/<each active location>`, `/privacy` |
| Robots | Allows the site, disallows `/admin` and `/api/`; private results and the style guide are `noindex` |
| Favicon and touch icon | Provisional Tucker mark derived from the approved wordmark (final mark is a brand gate, `brand/README.md`) |
| Web app manifest | None exists; nothing to rename |
| Navigation and footer | Tucker only; regional page header uses the Tucker wordmark |

## Test evidence (2026-11-17)

- `npm run check`: typecheck clean, lint no errors, **179 unit/API/DB tests pass**.
- `npm run test:e2e`: **20 browser tests pass** (phone journey, edge cases, four widths, axe-core, keyboard, reduced motion, production settings, regional page, retired URLs).
- `npm run build` passes. Main script 267 kB (85 kB compressed), down from 296 kB, because the regional page is now loaded on demand.
- Crawl of the production build: no dead links or anchors, no broken images, no insecure resources, no old names.
- Lighthouse, mobile, local production build: home 98 performance, LCP 2.4 s; regional page 96, LCP 2.7 s (target 2.5 s, see below); assessment 97, LCP 2.6 s. Accessibility, best practices and SEO 100 on all three. CLS 0.

## Known gaps (not presented as working)

- **No real offers for mobile, TV or solar.** Those categories show benchmarks only; real provider terms need to be entered before a price can be quoted.
- **Benchmarks are the owner's assumptions**, not market data. Review them periodically and bump `BENCHMARKS_VERSION` on change.
- **Emails are not sending** until `RESEND_API_KEY` is set and `mail.trytucker.com` is verified.
- **Regional page LCP is 2.7 s** in the throttled lab test, 0.2 s over target. The home page meets the target.
- **Mascot and final visual identity are not in the product** (brand gates G2–G5).
- **Legal review** of consent, savings and solar wording is still outstanding.
- Repository and Render service names (`fiber-appointment-engine`, `fiber-connect`) are internal and unchanged.

## Deploy checklist

1. Owner approves the deploy. Expect about one minute of downtime.
2. Follow `14-domain-migration.md` for the Render settings (`SITE_URL`, `LEGACY_HOSTS`, `LEGACY_REDIRECTS=false`, `EMAIL_FROM`). Saving them deploys the newest commit.
3. Verify on `trytucker.com` (checklist in `14-domain-migration.md`), then set `LEGACY_REDIRECTS=true`.
4. Optional: delete the unused `PLATFORM_ENABLED` variable.
5. Update ad and listing links from `/monroe` to `/internet/monroe` when convenient; the old links keep working through the redirect.
