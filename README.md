# Fiber Appointment Engine

**Fiber Connect** — an organic lead-generation, appointment-setting and AI marketing platform operated by **Spotlight Marketing LLC**. Multi-location by design: launching with **Omni Fiber in Monroe, Michigan**, with new cities added from the admin panel.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Public availability landing page, lead capture, database, appointment scheduling, secure admin | ✅ Built & tested |
| 1.5 | Cinematic hero, parallax, conversion tracking & attribution, technical SEO, performance | ✅ Built & tested (Lighthouse 100/100/100/100) |
| 1.6 | Multi-location: per-city pages, plans, phone, provider links, calendars and SEO | ✅ Built & tested |
| 2 | Sales & installation tracking, configurable commissions | 🧱 DB tables in place (`sales`, `commission_rules`, `commissions`) |
| 3 | AI-generated daily Facebook content | 🧱 DB table in place (`content_posts`) |
| 4 | Higgsfield visual generation | Planned |

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite, React Router
- **API:** Express 5, Zod validation (schemas shared with the client in `shared/`)
- **Database:** SQLite via Node's built-in `node:sqlite` — zero cost, no external service. All SQL lives in `server/repo.ts` so it can move to Postgres/Supabase later.
- **Tests:** Vitest + Supertest; **lint:** oxlint
- **Fonts:** self-hosted Inter + Sora (variable), preloaded, metric-matched fallbacks (zero layout shift)

## Quick start

```bash
npm install
cp .env.example .env     # optional in development
npm run dev              # web on http://localhost:5173, API on :3001
```

If `ADMIN_PASSWORD_HASH` isn't set, the dev server prints a temporary admin password to the console on startup. Sign in at `/admin`.

To set a permanent admin password:

```bash
npm run admin:hash -- "your-long-password"
# paste the printed ADMIN_PASSWORD_HASH=... line into .env
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + web with hot reload |
| `npm test` | API, scheduling, security, tracking and SEO tests |
| `npm run lint` | oxlint (correctness + a11y + hooks rules) |
| `npm run check` | typecheck + lint + tests |
| `scripts/build-media.sh` | Rebuild all hero video/poster/image renditions from `media/source` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm start` | Production server (serves API + `dist/`). Requires `SESSION_SECRET` (≥32 chars) and `ADMIN_PASSWORD_HASH`. |

## How it works

**Visitor flow:** ZIP check → details form (with TCPA consent) → pick a consultation slot → confirmation.

- **Availability** comes from the `service_areas` table, editable at **Admin → Service areas**. Statuses: `available`, `verify` (in the build area, address must be confirmed), `coming_soon`, `not_serviceable`.
- **Leads** capture UTM parameters (`?utm_source=facebook&utm_campaign=...`) so organic campaigns can be attributed. A resubmission with the same email + phone updates the existing lead instead of duplicating it.
- **Scheduling** defaults: Mon–Sat, 9am–7pm Eastern, 60-min slots, 2 reps per slot, 12h minimum notice, 21 days ahead (see the `settings` table). Bookings run in a write transaction so a slot can never be overbooked; booking again reschedules instead of double-booking.

**Admin (`/admin`):** lead list with search/filter, stats, CSV export, lead detail with pipeline stages (new → contacted → appointment set → sold → install scheduled → installed / lost), notes and activity log, appointment board (complete / no-show / cancel), service-area management.

## Locations (multi-market)

Everything that differs between cities is a **location** (`shared/market.ts`), managed in **Admin → Locations**:

| Setting | Effect |
|---|---|
| City, state, region, coverage note | Headline, badges, ZIP-form note, SEO title/description, structured data |
| Provider | Copy, consent wording (recorded per lead), disclosures |
| Plans + "verified on" date | Plans section, hero "from" price, FAQ, meta description |
| Phone (call & text) | Every click-to-call / text button |
| Provider checker + Broadband Facts URLs | Official exact-address check and FCC label links |
| Schedule (days, hours, slot length, reps per slot, notice, horizon, timezone) | That location's own appointment calendar and capacity |
| Live / Default | Live locations are public at `/<url>`; the default location is the home page `/` (`/<default-url>` 301-redirects to `/`) |

- **ZIP routing:** each ZIP in Service areas belongs to a location. A visitor who enters a ZIP served by another location (same provider) is told so, and their lead and appointment go to that location's calendar.
- **SEO per location:** the server renders each page's title, description, canonical, Open Graph, JSON-LD and embedded location data; the sitemap lists every live location.
- **Admin:** leads, funnel, CSV export and appointments can be filtered by location; appointments display in each location's timezone.
- **New locations start hidden** — review the page via "View page" after making it live.

## Cinematic hero & motion

- **Art:** generated with Higgsfield (GPT Image 2.6, 2K) — a Monroe-style town at blue hour with fiber light threading into homes. Sources in `media/source/`.
- **Video:** 12-second seamless loop rendered from the still with a sine-period camera drift (last frame flows into the first). Encoded as AV1 + H.264 fallback at 1920×1080, 1280×720 and a 720×1280 mobile crop (0.8–3.3 MB).
- **Loading:** the art-directed poster `<picture>` (AVIF/WebP/JPEG, 23–89 KB) is the LCP image and is preloaded per viewport. The video loads only after the page is idle, fades in once playing, pauses off-screen / in background tabs, and is skipped entirely for reduced-motion, Save-Data, slow (2g/3g) or low-memory devices. Any video failure leaves the poster as the static fallback.
- **Parallax:** three depths (media 0.3×, animated fiber lines 0.15×, content 1×). One `requestAnimationFrame` per scroll burst, transform-only writes, no React re-renders, paused when the hero is off-screen, disabled for reduced motion / constrained devices.
- **Upgrading to a true AI video:** generate a clip, then `HERO_VIDEO=clip.mp4 scripts/build-media.sh` — same file names, no code changes.

## Conversion tracking

- First-party, cookie-free events (`page_view`, `cta_click`, `zip_check`, `form_start`, `lead_submit`, `appointment_booked`, `booking_skipped`, `call_click`) → `POST /api/events` (allow-listed, rate-limited). Leads and bookings are recorded **server-side** so ad blockers can't hide conversions.
- Every event is also pushed to `window.dataLayer`, ready for Google Tag Manager / Meta Pixel if added later.
- Leads store `utm_source/medium/campaign/content/term`, click ID (`gclid`/`fbclid`/`msclkid`/`ttclid`), referrer, landing page and session. Attribution is first-touch for 30 days unless a new campaign link is used.
- Admin dashboard shows a 30-day funnel and top lead sources.
- Click-to-call and text buttons (header, hero, sticky mobile bar, menu, final CTA, footer, confirmation) are tracked as `call_click` / `sms_click`; outbound links to Omni Fiber's checker and Broadband Facts labels as `outbound_click`.

## SEO

Title/description, canonical, Open Graph + Twitter cards with a custom 1200×630 image, JSON-LD (`Organization`, `WebSite`, `Service`, `FAQPage` — generated from the same FAQ shown on the page), `robots.txt`, `sitemap.xml`, `noindex` on admin. The public origin is injected at runtime from `SITE_URL`, so one build works on any domain.

## Deployment

The app is a single Node process with a SQLite file — it needs one small server/container with a **persistent disk**.

```bash
docker build -t fiber-engine .
docker run -d -p 3001:3001 -v fiber-data:/data \
  -e SITE_URL=https://your-domain.com \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_EMAIL=you@yourdomain.com \
  -e ADMIN_PASSWORD_HASH='scrypt:...' \
  -e TRUST_PROXY=1 \
  fiber-engine
```

Put it behind HTTPS (the host's TLS or a reverse proxy). Health check: `GET /api/health`. Without Docker: `npm ci && npm run build && npm start` with the same environment variables.

## Security

- Admin password stored as a scrypt hash; sessions are HMAC-signed, `HttpOnly`, `SameSite=Strict`, `Secure` in production, 12h expiry
- Admin mutations require an `X-Requested-With` header (CSRF defence in depth)
- Booking requires a per-lead random token (only its SHA-256 hash is stored)
- Rate limits on lead submission, booking and login; honeypot field for bots
- Helmet security headers with a strict Content-Security-Policy
- CSV export neutralises spreadsheet formula injection
- Consent text, version, timestamp, IP and user agent stored with each lead as a TCPA record

## Before going live — needs your input

0. **Domain.** Planned: **`livefiberconnect.com`** (available as of Nov 15, 2026). `fiberconnect.com` is privately held since 1999 and `fiberconnect.co` is parked for resale on Afternic. Set `SITE_URL=https://livefiberconnect.com` when deploying.
1. **Coverage.** Exact-address coverage is confirmed with Omni Fiber's official checker (linked on the site). The ZIP statuses in Admin → Service areas only control the on-site message; keep Monroe at `verify` unless Omni confirms a whole ZIP.
2. **Confirm brand & disclosure wording** in `shared/content.ts` (the working site name "Monroe Fiber Connect", the partner disclosure, the consent text and the team phone number) with Omni Fiber and, ideally, counsel.
3. **Hosting.** Nothing is deployed yet — see *Deployment* above.
4. **Plans & phone.** Monroe plans (500 Mbps $50/mo, 1 Gig $50/mo, 2 Gig $70/mo) and the team phone (734) 731-1946 are edited in Admin → Locations (seed values in `shared/market.ts`). Update the "verified on" date whenever pricing changes.

## Project layout

```
server/            Express API
  app.ts           routes, auth middleware, error handling
  repo.ts          all SQL / data access
  scheduling.ts    slot generation + transactional booking
  db/              connection, migrations, seed data
  lib/             auth (scrypt, signed sessions) and timezone helpers
shared/            Zod schemas, types and copy shared by client + server
src/               React app (landing page + admin)
  components/      HeroMedia (video/poster), SignupFlow, landing chrome
  lib/             api client, analytics (attribution + events), motion (parallax)
media/source/      original generated artwork
public/media/      optimized video, posters and images (built by scripts/build-media.sh)
tests/             Vitest API tests
```
