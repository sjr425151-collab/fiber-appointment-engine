# Dynamic Construction MI website preview

`previews/dynamicconstruction/` is a static export of the Dynamic Construction MI
website preview (source: `sjr425151-collab/chris-pribyl`, `npm run build` → `out/`).

`server/previews.ts` serves it **only** at `/preview/dynamicconstruction/` and
**only** on `livefiberconnect.com` / `www.livefiberconnect.com` (override with
`PREVIEW_HOSTS`). Every other host — including trytucker.com — and every other
path falls through to Tucker unchanged. Pages are sent with `X-Robots-Tag: noindex`
and have no access to Tucker's API, cookies or data. Covered by `tests/previews.test.ts`.

To update: rebuild in the source repo and replace the folder. To remove: delete the
folder (the route switches itself off when `index.html` is missing).
