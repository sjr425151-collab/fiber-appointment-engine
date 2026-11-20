# Client website previews

Static site exports served at `/preview/<name>/` by `server/previews.ts`.
They are isolated from Tucker: their own security headers, always `noindex`,
and no access to Tucker's API, cookies or data.

| Path | Source |
| --- | --- |
| `/preview/dynamicconstruction/` | `sjr425151-collab/chris-pribyl` (Next.js static export, `npm run build` → `out/`) |

To update a preview, rebuild it in its source repo and replace the folder.
To remove one, delete its folder.
