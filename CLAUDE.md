# Working on this repository

Read `docs/README.md` first — it links the audit, architecture, roadmap, risk register and operations guide, and shows what is Live vs Built vs Proposed.

## Production safety (most important)
- **Pushing to `claude/busy-bohr-j8rie0` deploys to production (livefiberconnect.com) with ~1 minute of downtime.** Put `[skip render]` in the commit message for anything that is not an approved deploy.
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
