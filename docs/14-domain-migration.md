# 14 — Domain migration: livefiberconnect.com → trytucker.com

**Status (2026-11-17): live as `b8b6c50` with the new canonical domain; old-domain redirects still off.** Saving `LEGACY_REDIRECTS=true` in Render will also deploy the newest pushed commit (the consolidation in `15-consolidation.md`). The URL structure changed after this page was first written; `15-consolidation.md` has the full old-to-new URL map. Both domains already reach the same Render service over HTTPS. This is a domain and name change only: same service, same database, same features.

## What the code now does

| Area | Behaviour |
|---|---|
| Canonical origin | Everything public is built from `SITE_URL`: canonical links, Open Graph URL and image, structured data, `robots.txt`, `sitemap.xml`, links in emails |
| Sitemap | Lists `/`, `/savings/assess`, `/internet/<each active location>` and `/privacy` |
| `www.` of the canonical domain | Always redirects (301) to the bare domain, keeping path and query |
| Previous domain | Listed in `LEGACY_HOSTS`. Served normally while `LEGACY_REDIRECTS=false`, with canonical links already pointing at the new domain. With `LEGACY_REDIRECTS=true`, every page request redirects (301) to the same path and query on the new domain |
| Safety | Only page requests redirect (never `/api`, never form posts), the target is always the fixed canonical origin, and the canonical host never redirects, so loops and open redirects are not possible. A typo in `LEGACY_REDIRECTS` leaves redirects off; it cannot stop the site |
| Name | "Tucker" everywhere public; a browser test fails if an old name appears |

## Audit of domain dependencies

| Item | Finding |
|---|---|
| Environment variables | `SITE_URL` and `EMAIL_FROM` held the old domain. Both updated in `render.yaml`; they must also be changed in Render (below) |
| Authentication | Admin sessions are cookies tied to the exact host. No callback URLs. Admins sign in again on the new domain |
| Supabase | **Not used by this application.** Data is SQLite on the Render disk. Nothing to change |
| CORS | None configured; the browser only talks to its own origin |
| API integrations and webhooks | None call out or in by domain. Email (Resend) is not switched on yet |
| Stored data | No table stores the site's domain. Existing leads, assessments, results links, bookings and settings are unaffected |
| Private results links | Work on either domain. After the switch the browser carries the private part of the link (after `#`) across the redirect |
| Saved drafts | An unfinished assessment saved in a browser on the old domain does not follow to the new one (browser storage is per domain) |
| Calendar invites | The internal event ID keeps its old suffix so updates to existing invites still match. It is never shown |

## Manual steps for the owner

**Render** (service `fiber-connect`; the service name is internal and stays):
1. *Settings → Custom Domains:* confirm `trytucker.com` and `www.trytucker.com` are listed and verified, and leave `livefiberconnect.com` attached.
2. *Environment:* set `SITE_URL` = `https://trytucker.com`, `LEGACY_HOSTS` = `livefiberconnect.com` (its `www.` form is included automatically), `LEGACY_REDIRECTS` = `false`, and `EMAIL_FROM` = `Tucker <hello@mail.trytucker.com>`. Keep `TRUST_PROXY=1`. Saving deploys the newest commit (about 1 minute of downtime). Take a backup first: `npm run db:backup` in the Render shell.
3. After verification (below), set `LEGACY_REDIRECTS` = `true`. That restarts the service once more.

**Cloudflare:**
- Keep the `livefiberconnect.com` zone, DNS records and certificate active for as long as old links should work (a year or more is normal). If the domain lapses, its redirects stop.
- On both zones: SSL mode Full (strict) and Always Use HTTPS.
- Check that no Redirect Rule or Page Rule sends `trytucker.com` anywhere else; such a rule plus the app redirect could loop.

**Search and listings** (after redirects are on): add `trytucker.com` in Google Search Console, submit `https://trytucker.com/sitemap.xml`, and use Change of Address from the old property. Update ad destination URLs, social profiles and any business listings.

**Email** (only when email is switched on): verify `mail.trytucker.com` in Resend before adding the API key.

## Verification before switching redirects on

Run after the deploy in step 2. The read-only checks can be run from a development session on request.

- [ ] `https://trytucker.com/api/health` shows the expected commit.
- [ ] Page source on `/`, `/savings/assess`, `/internet/monroe`, `/privacy`: canonical link and share URL start with `https://trytucker.com`; site name is Tucker.
- [ ] `https://trytucker.com/robots.txt` and `/sitemap.xml` show only `trytucker.com` URLs.
- [ ] `http://trytucker.com`, `https://www.trytucker.com` and `http://www.trytucker.com` all end at `https://trytucker.com` with the path and query kept.
- [ ] `https://livefiberconnect.com/savings/assess` still loads (redirects are off) and its canonical link points to the new domain.
- [ ] `https://trytucker.com/monroe` → 301 → `/internet/monroe`; `https://trytucker.com/savings` → 301 → `/`; `https://trytucker.com/no-such-page` → 404.
- [ ] On `trytucker.com`: complete an assessment, open the results link, send a help request and book a time; sign in to the admin and find that lead and its opportunities. Use a recognisable test name and mark the lead afterwards.
- [ ] Regional page (`/internet/monroe`): ZIP check and lead form work.
- [ ] Home: the quick preview shows a figure before any contact details are asked for.

## After switching redirects on

- [ ] `https://livefiberconnect.com/savings/assess?utm_source=test` → 301 → `https://trytucker.com/savings/assess?utm_source=test` (one hop).
- [ ] `https://www.livefiberconnect.com/` ends at `https://trytucker.com/`.
- [ ] `https://livefiberconnect.com/monroe?utm_source=test` → 301 → `https://trytucker.com/internet/monroe?utm_source=test` (one hop).
- [ ] An old private results link opens the same results on the new domain.
- [ ] `https://livefiberconnect.com/api/health` still answers 200 (the API is not redirected).

## Rollback

Set `LEGACY_REDIRECTS` back to `false`. Browsers cache each redirect for one hour, so the old domain serves pages again within the hour. To undo the canonical change as well, set `SITE_URL` back. No data is touched by either step.

## Test evidence (2026-11-17)

- `tests/domain-migration.test.ts`: 12 tests covering canonical data, `www`, both legacy hosts with redirects off and on, path and query preservation, loop and open-redirect safety, API pass-through, proxy headers and configuration typos.
- Full suites: 171 unit/API/DB tests and 19 browser tests pass; production build passes.
- Local production build served as `trytucker.com`: 43 pages and assets crawled, with no dead links, no `http://` resources and no old names. Every host variant reached the canonical URL in one hop.
- Live, read-only, before deploy: both domains answer over HTTPS on the same commit; `www` and `http` variants of both already redirect correctly at the edge.
