# 17 — V2: national benchmarks, no locations, new homepage

**Status (2026-11-17): live as `1e6a422`, verified on trytucker.com.** Before this, the live site ran `9c5b590` (deployed from the Render side; it includes the representative handoff and migrations 8–9). Restore point: `9c5b590`. This adds only migration 10 (additive), rehearsed on a database created by `9c5b590`.

Migration 9 already ran in production as written in `9c5b590`, so it is kept exactly as shipped. Its commission, earnings and payout tables therefore exist in the database but are empty and unused: no code reads or writes them, and nothing shows them.

## What changed

| Area | Now |
|---|---|
| Savings engine | One national benchmark set for every household, whatever its ZIP. No location, service area or location price list is read for a preview |
| Benchmarks | Stored as versions (`benchmark_versions`, never edited or deleted). Admin → **Benchmarks**: change values with a live preview, publish (new version), restore an old version, see history and audit trail. Every analysis keeps a copy of the set it used, so saved results and requests made from them never change |
| Calculation | Difference = current bill − benchmark; annual = monthly × 12; mobile benchmark = lines × per-line price, device payments excluded. A benchmark higher than the bill is shown as a possible extra cost and left out of the savings total |
| Locations and service areas | Admin screens, regional page (`/internet/monroe`) and location pricing removed. Old Monroe links (`/monroe`, `/internet/monroe`) redirect to `/`. Historical location, area, lead and appointment records stay in the database untouched |
| Lead alerts | One central list in Admin → **Settings** (replaces the per-location alert email); falls back to the old list, then `TEAM_NOTIFY_EMAIL`. Delivery status shown there and on each lead |
| Admin navigation | Overview · Leads · Appointments · Opportunities · Assessments · Representatives · Benchmarks · Settings |
| Homepage | Cinematic hero (looping dusk-neighbourhood video), why Tucker, four categories, live preview, how it works, straight answers about the numbers, closing call to action, FAQ (also published as FAQ structured data) |
| Headings (owner) | Hero: “See if your household could save 50% or more on monthly bills.” with “Results vary and many households will save less.” beneath. Preview: “Type what you pay. We’ll find a smarter option.” |
| Representatives and commission (owner) | Customers never see a representative’s name. No commission figures anywhere; commission rules, earnings ledger and payout tables were removed from the unreleased team foundation. One compensation line remains in the footer, results and FAQ: “Tucker may receive compensation from providers.” |

## Hero video

| Item | Value |
|---|---|
| Source | Higgsfield, Seedance 2.5, 1080p, 8 s, no audio, first and last frame from one key still (Nano Banana Pro). Job `c11bce55-45fd-453e-9998-f71169e3d910`, still `3df7f28c-36a9-415d-abe7-6e9590573563` |
| Credits | 2 stills (4) + 1 video take (128) = about 132 of the approved 450 |
| Check | Frame-by-frame review: stable camera, no warping, no text or logos, first and last frames match closely; a 0.6 s cross-fade hides the seam |
| Delivery | `public/media/tucker-hero-1080.mp4` (H.264, 0.6 MB), `-720.mp4` (0.18 MB) and `-720.webm` for phones; stills 768/1280/1920 in WebP and JPEG |
| Playback | Muted, looping, inline, no controls, starts only after the page has loaded. The still shows for reduced motion, data saver and slow devices |
| Parallax | Three layers (image, glow and wash, text) moved by transform only, off for reduced motion and slow devices |

## Test evidence

- `npm run check`: 199 unit/API/DB tests pass (new: benchmark versions, publish, restore, audit, saved results unchanged, signed differences, central alerts, any ZIP is assigned).
- `npm run test:e2e`: 20 browser tests pass (home, preview, handoff, admin, results, retired addresses, layout at four widths, axe, keyboard, reduced motion).
- Lighthouse (mobile, local production build): home 91–95 performance, 100 accessibility, best practices and SEO, CLS 0; largest paint 2.9–3.0 s. Assessment 97, 2.6 s.

## Known gaps

- **Largest paint on the home page is 2.9–3.0 s** in a throttled lab test (target 2.5 s). The hero is built in the browser after the scripts load; rendering it on the server would fix this.
- **The “50% or more” headline is a savings claim.** It needs evidence (for example, a share of real households that saved that much) or legal sign-off before ads run.
- Legal review of consent and the compensation line is still outstanding.
- Email alerts do not send until the email service key is added in the hosting settings.

## Update (2026-11-17): back to the simple white homepage

At the owner's request the homepage returned to the earlier clean white layout (hero text beside the preview card, then categories, how it works, labels, footer). Kept from V2: national benchmarks from the server, signed differences, the owner's headings, the compensation line and no representative names. Removed: the background video, parallax and hero image (the files are archived outside the repository; the Higgsfield job ids above can recreate them).
