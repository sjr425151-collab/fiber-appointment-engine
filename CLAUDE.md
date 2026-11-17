# Working on this repository

**Tucker** is a home-service savings broker: a household bill optimization and service brokerage platform (internet, mobile, TV, electricity/solar), operated by Spotlight Marketing LLC. "Tucker" is the only public name; never show "LiveFiberConnect" or "Fiber Connect" to customers (the domain is still livefiberconnect.com). It grew out of a fiber appointment engine; home internet is now one category, and the per-location fiber landing pages are one acquisition channel. Don't add provider- or city-specific logic to shared code: providers, plans and prices come from admin-managed data (`shared/platform/market-offers.ts`).

The brand system (wordmark "tucker." with a nose-shaped period, the Working Bear mascot, colors, type) and its approval gates live in `brand/README.md`. The name is live; the rest of the visual identity is not applied to the product until the founder approves it there.

Read `docs/README.md` first — it links the audit, architecture, roadmap, risk register and operations guide, and shows what is Live vs Built vs Proposed. `docs/13-transition.md` is the short map of what is reusable, adapted and next.

## Production safety (most important)
- **Pushing to `claude/busy-bohr-j8rie0` deploys to production (livefiberconnect.com) with ~1 minute of downtime.** Put `[skip render]` in the commit message for anything that is not an approved deploy.
- **`[skip render]` only skips the automatic deploy.** Saving an environment variable or clicking Manual Deploy in Render deploys the newest pushed commit, skipped or not (this happened on 2026-11-16). So everything pushed must be production-safe and fully tested.
- The household platform is **live** in production (`PLATFORM_ENABLED=true`). Changes under `src/platform`, `shared/platform` and `server/platform.ts` reach real customers on the next deploy.
- Never modify production environment variables, DNS, Render services or data without explicit owner approval.
- Migrations are append-only and additive; rehearse new ones against a DB created by the deployed commit (see `docs/08-operations.md`).

## Engineering standards
- TypeScript strict; Zod at every input boundary; all SQL in `server/repo.ts` (parameterized only).
- Money is integer cents (`shared/finance/money.ts`), rates are basis points; never use floats for totals.
- Consumer-facing data quality is derived from provenance (`shared/offers/model.ts → publicStatus`), never hand-set.
- Ranking must stay commission-blind (`shared/offers/rank.ts` takes no compensation input).
- AI may explain results; it must never compute prices, eligibility or totals, and the product must work without it.
- No fabricated data: incomplete inputs produce an "incomplete" result, not a guess. Synthetic records only in dev/staging, clearly marked.
- Escape all user-provided text in HTML, emails and calendar files; keep PII out of logs.
- Accessibility (WCAG 2.2 AA) and mobile performance (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) are acceptance criteria.

## Checks before committing
`npm run check` (typecheck + lint + tests) and `npm run build`. Report status precisely: proposed / built / tested / deployed.
