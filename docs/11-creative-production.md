# 11 — Creative production package: household platform hero (+ Fiber Connect refresh)

_Status: **Proposed**. Nothing in this document has been generated, purchased, encoded or deployed. Generation needs **owner approval of the brief and a credit budget** (⚑). Higgsfield access and paid credits are **not assumed to be configured**._

This package expands the outline in [02-product-and-design.md §5](02-product-and-design.md) into something a production operator can execute. It covers art direction, the storyboard, copy-paste prompts, mobile compositions, posters, delivery, performance, accessibility, budget and approvals. It reuses the conventions already proven on the live fiber hero (`src/components/HeroMedia.tsx`, `src/lib/motion.ts`, `scripts/build-media.sh`), so integrating the result is an engineering task rather than a redesign.

---

## 1. Purpose, scope and status

**Purpose.** The household platform (working name **"Household Savings"**, status _preview_, operated by **Spotlight Marketing LLC**; see `shared/platform/brand.ts`) needs one calm, cinematic hero. In a few seconds it should say "this is about your home and the bills that run it, made clear." The product does the explaining. The footage only sets the mood.

**In scope**

| Deliverable | Notes |
|---|---|
| Household-platform homepage hero loop | 12 s seamless loop, 5 shots, no audio, no baked-in text |
| Desktop 16:9 renditions | 1080p and 720p, H.264 + AV1 |
| Mobile renditions | 4:5 panel (recommended) and an optional 9:16 full-bleed variant |
| Poster frames | Per breakpoint, AVIF/WebP/JPEG |
| Provenance & licensing record | Manifest with prompts, seeds, model names, checksums |
| Optional: Fiber Connect hero refresh brief | §11; drops into the existing file names |

**Out of scope:** supporting category stills and social cut-downs (listed in 02 §5; brief them separately after the hero is approved), any audio, any change to production environment variables, DNS, Render services or data, and any code change. Integration code is described in §7.6 as **proposed** work only.

**Status ladder for this work** (use these words exactly when reporting):

| Stage | Meaning | Current |
|---|---|---|
| Proposed | Brief written | **Yes — this document** |
| Approved | Owner approved brief + budget cap (CP0, §10) | No ⚑ |
| Generated | Key frames and clips exist and passed review | No |
| Built | Encodes, posters and manifest committed (with `[skip render]`) | No |
| Tested | Lighthouse, axe, reduced-motion, Save-Data and loop checks passed on staging | No |
| Deployed | Live in production after a separately approved deploy | No |

The platform runs behind `PLATFORM_ENABLED`, which is **off in production**. Any platform hero therefore reaches staging first, and production only through a separately approved deploy.

---

## 2. Brand art direction

### 2.1 Positioning in one line
*An honest, clear look at the household you already have.* The tone is calm, competent, warm and plain. It is not aspirational luxury, not "money rain", and not a stressed person at a laptop.

### 2.2 Mood
- Quiet evening at home. Blue hour outside, warm lamps inside.
- **Before → after** without drama: a scattered table becomes a tidy one.
- Clarity metaphors: light finding a path along a cable, papers squared into one stack, a home lit evenly.
- Unglamorous and real: lived-in rooms, mid-priced furniture, Midwestern housing stock.

### 2.3 Colour palette mapped to existing tokens

The platform is light-themed (`src/platform/platform.css`). Following 02 §4 ("dark for marketing hero only"), the hero footage runs under a **dark scrim built from `pf-ink`**. The grade should feel native next to the light page below it.

| Role in footage | Token | Hex | Direction for the grade |
|---|---|---|---|
| Shadows / scrim base | `--color-pf-ink` | `#101828` | Shadows fall toward deep blue-black, never pure black or brown |
| Warm highlights (paper, walls, lamp spill) | `--color-pf-bg` | `#f6f5f1` | Off-white, warm paper; highlights roll off softly |
| Mid-tone neutrals (wood, linen, siding) | `--color-pf-line` | `#d9d6ce` | Warm greige; low saturation |
| Cool ambient (blue-hour sky, window light) | `--color-pf-info` / `--color-pf-brand` | `#175cd3` / `#1d3fd8` | A *hint* of this blue in the sky and rim light only. Never a saturated blue wash |
| Secondary neutrals | `--color-pf-muted` / `--color-pf-subtle` | `#475467` / `#5d6b82` | Slate shadows in exterior foliage and roof |
| **Reserved — do not use as a light colour** | `--color-pf-save` | `#067647` | Green means "savings" in the UI. No green glows, green LEDs or money-green casts |
| **Reserved** | `--color-pf-cost` | `#b42318` | Red means "extra cost" or error. No red LEDs, red warning lights or red-tinted bills |
| **Reserved** | `--color-pf-sample` | `#5b37b8` | Violet means "sample data". Avoid violet casts. This also keeps the platform visually distinct from the fiber site's violet `#8b5cf6` |

Practical lamps: 2700–3000 K. Exterior ambient: about 8000–10000 K blue hour. Overall saturation is low, and contrast is gentle with no crushed blacks, because a scrim sits on top.

### 2.4 Typography
- **Sora** (display) and **Inter** (body) are already self-hosted (`src/index.css` `@font-face`, redeclared in `platform.css`). Hero type is always **live HTML**, using the existing classes (`font-display`, `text-4xl sm:text-5xl`).
- **No typography is ever baked into footage or posters.** This keeps text translatable, accessible and selectable, and ensures text is never compressed into the video.

### 2.5 Lighting
- Motivated, soft and low-contrast. A key light from a practical lamp or window, plus a gentle cool rim from the window side.
- No hard sun, no lens-flare streaks, no light leaks and no blinking lights. Status LEDs are steady (see 2.3.1 in §9).
- Exterior: true blue hour (sky still holds detail), warm windows, an optional porch light.
- Continuity: every shot is the same evening. Interior window backgrounds show blue-hour dusk.

### 2.6 Lens and camera language

| Shot type | Full-frame-equivalent lens | Aperture | Height / angle |
|---|---|---|---|
| Exterior wide | 24–28 mm | f/4–f/5.6 | Eye height, across the street, level horizon |
| Interior table | 40–50 mm | f/2.8 | Just above table height, 25–35° down |
| Detail / macro | 85–100 mm | f/2.8 | Level with the object |

**Motion rules:** slow dolly or slider moves only, covering 2–4 % of the frame per shot. No zooms, whip-pans, handheld shake, drone swoops, orbit moves or speed ramps. The camera never rotates (no roll). Motion and detail live in the **subject side** of the frame. The text side stays calm.

### 2.7 Texture
- Natural detail (wood grain, linen, knit), slight film-like highlight roll-off.
- **Grain only in the archived master, never in web encodes.** Grain multiplies bitrate. Denoise lightly before the web encode (§7.4) or the byte budget in §8 will not be met.

### 2.8 Casting and people
- **Hero: hands only, no faces.** One person's hands appear in shots 2 and 4. This keeps the person non-identifiable, avoids implying a real customer, and avoids the stock "relieved smile".
- **Hand styling (lock for consistency):** medium-brown skin, short unpainted nails, no rings or watches, oatmeal-coloured knit sweater sleeves.
- Across the wider asset set (later supporting stills), vary skin tone, age, body type and household type naturally (a single parent, an older couple, roommates), and avoid tokenism.
- **AI-generated people** must not resemble any real person or celebrity. Do not use "influencer" or avatar characters. Do not depict an "advisor" or staff member, which would imply a real employee.
- **Real people**, if a photo shoot ever replaces AI: signed model releases covering web and paid use, stored with the manifest (§7.7).

### 2.9 Set and prop rules

| Prop | Rule |
|---|---|
| Household bills / envelopes | **Printed sides face down, or folded closed.** Only blank paper backs and plain envelopes are visible. No letterheads, logos, numerals, barcodes or legible text |
| Router | Plain matte white, no markings, no logo, no label sticker, no antenna brand. Two small **steady** soft-white status lights |
| Smartphone | Face-down by default. If face-up (optional, §4 shot 4), the screen shows **ILLUSTRATIVE UI only**: soft blank blocks with no numbers, words, icons or logos. No camera-bump brand shapes and no logo on the back |
| TV (if visible) | Off, or soft out-of-focus abstract colour. No channel bugs, shows or streaming logos |
| Thermostat | Generic round or square, display dark or blurred |
| Rooftop solar | All-black residential modules mounted flush on an asphalt-shingle roof plane of a Midwestern home (two-storey vinyl-siding colonial, ranch or bungalow). No installer signage, no yard signs, no battery/inverter branding |
| House | Generic, not a real identifiable property. **No house numbers, street signs, mailboxes with names, licence plates or yard signs** |
| Setting | Flat terrain, mature maples and oaks, late summer to early autumn, no snow (avoids seasonal staleness) |
| Never on set | Cash, coins, piggy banks, calculators, credit cards, "SALE" or "%" signage, utility meters with readable dials, provider vans or uniforms, award badges |

### 2.10 Do / don't (tied to the trust rules)

| Do | Don't | Trust rule it protects |
|---|---|---|
| Show calm, generic homes and objects | Show a real company's logo, product design or trademark (no Omni Fiber logo, no utility logos, no phone-maker logos) | No real logos/trademarks, no implied endorsement |
| Keep all papers and screens unreadable or blank | Show any price, dollar figure, percentage, kWh, Mbps or chart, even blurred-but-legible | No on-screen numbers that could read as a quote; no fake figures |
| Let HTML copy carry every message | Bake "Save $X", "Guaranteed" or any slogan into the footage | No guaranteed-savings language; no baked text |
| Hands only, non-identifiable | Faces, celebrity look-alikes, identifiable real people, customer "testimonial" framing | No identifiable people; no fabricated testimonials |
| Show solar panels as part of an ordinary house | Show solar as a money machine (sun-burst + cash, glowing meter, "free energy") | Solar is an estimate needing a site assessment; legal hold C5 |
| Mark any UI as **ILLUSTRATIVE** in this brief and the manifest | Depict the real product UI, star ratings, review cards or "4.9 ★" | No fabricated reviews or ratings; UI must be generic |
| Keep the mood plain and real | Show staged luxury, distress or "bill shock" melodrama | Honest positioning (02 §1) |
| Record AI provenance in the manifest | Present a generated home as a real customer's home | No fabricated data; AI disclosure |

---

## 3. Homepage hero storyboard (household platform)

**Format:** 12.0 s seamless loop. Five shots joined by 0.4 s dissolves, at a constant frame rate (§7.4). The timeline matches the existing `build-media.sh` loop length (12 s).

**Layout assumptions** (proposed, not built; see §7.6). On desktop (≥ 1024 px), the hero copy sits in the **left column, 0–48 % of the width**. The "What you'll get" card currently on the right of `Home.tsx` moves below the hero, so the subject on the right is visible. That is an owner and design decision (⚑). On mobile, the copy sits at the **top** (see §5 for the two mobile options).

### 3.1 Shot list

| # | Time (s) | Dur. | Framing | Motion | Purpose | Text-safe area (desktop 16:9) |
|---|---|---|---|---|---|---|
| S1 | 0.0–2.6 | 2.6 s | Exterior wide, blue hour. Two-storey Midwestern house with warm windows and flush rooftop solar; house at 55–90 % of width | Very slow dolly-in (≈ 3 %), level | "This is about *your home*." Establish place, warmth, evening | Left 0–48 % is low-detail sky, lawn and tree silhouette. Top 12 % stays dark (header) |
| S2 | 2.6–5.0 | 2.4 s | Interior, kitchen table, medium-close. Scattered face-down papers and envelopes, mug, face-down phone; hands enter from the right | Slow left-to-right slide (≈ 2 %). Hands nudge one envelope | The problem, gently: bills are scattered | Left 0–45 % is out-of-focus wall and table edge in shadow |
| S3 | 5.0–7.0 | 2.0 s | Detail, 85 mm. Plain white router on an oak shelf; one soft line of light travels along its cable | Slow push-in (≈ 2 %). A single light trace moves left to right once, then settles | Services (internet) and the "clarity" metaphor | Left 0–50 % is warm bokeh only. The light trace starts at ≥ 40 % width so nothing moves under the headline |
| S4 | 7.0–9.6 | 2.6 s | Same table as S2, same lens and light. Papers now one squared stack under a closed notebook; hands withdraw | Very slow push-in (≈ 2 %). Hand lifts and exits right | Resolution: organised, calm, handled | Same as S2 |
| S5 | 9.6–12.0 | 2.4 s | Exterior, same as S1 | Slow **pull-back that ends exactly on the S1 opening frame** (made by reversing a dolly-in clip; §4.6) | Return home and close the loop invisibly | Same as S1 |

**Transitions:** S1→S2 dissolves through the warm window (motivated). The others are 0.4 s cross-dissolves. The loop seam S5→S1 needs no dissolve because S5 ends on S1's first frame. Add a 6-frame safety dissolve only if QA sees a pop.

**Poster:** frame 0 of the final loop, which is the approved S1 key frame (§6).

### 3.2 Negative-space map (desktop 16:9, 1920×1080 master)

```
 0%                        48%                    90% 100%
 ┌──────────────────────────┬──────────────────────┬────┐  0%
 │  header-safe: dark, calm (top 12 %, ≈ 130 px)              │
 ├──────────────────────────┬──────────────────────┬────┤ 12%
 │                          │                      │    │
 │  TEXT-SAFE               │   SUBJECT ZONE       │edge│
 │  low detail, low motion, │   house / table /    │    │
 │  luma ≤ ~35 % (pre-scrim)│   router lives here  │    │
 │  H1 + lede + 2 CTAs      │   all motion here    │    │
 │                          │                      │    │
 ├──────────────────────────┴──────────────────────┴────┤ 88%
 │  bottom 12 %: calm (pause control sits bottom-right)  │
 └───────────────────────────────────────────────────────┘ 100%
```

Rules: no bright practicals, high-contrast edges or moving elements inside the text-safe box. The brightest highlight anywhere in the text-safe box, measured before the scrim, should be no more than about 70 % luma, so the scrim spec in §9.5 holds.

---

## 4. Scene-by-scene Higgsfield prompts

### 4.0 Before you generate (operator checklist)
1. **CP0 must be signed** (§10). Confirm the credit cap.
2. In the Higgsfield UI, **confirm the current model names, resolutions, durations and credit price per generation**. This document deliberately does not name models, because names and prices change. Record what you used in the manifest.
3. Choose a **photoreal still-image model** ("Higgsfield image model of choice") for key frames. Choose an **image-to-video** model that accepts a start image, at **1080p, 5 s** (or the closest option). If a start-and-end-frame option exists, note it, because §4.6 can use it.
4. Commercial-use rights depend on the plan tier. Confirm and record the terms in force on the generation date (§7.7).
5. **Workflow:** stills first (cheap) → owner approves key frames (CP1) → one motion test (CP2) → remaining clips. Never start video on an unapproved still.

### 4.1 Shared blocks (paste into every prompt)

**STYLE block** (append to every still prompt):
```
Photorealistic cinematic documentary photograph, full-frame camera, natural and unglamorous, a real lived-in Midwestern American home, calm quiet evening mood, soft motivated lighting, warm 2700K practical lamps against cool blue-hour ambient light, warm off-white paper-like highlights, deep blue-black shadows, low saturation, gentle contrast, soft highlight roll-off, fine natural texture, no text anywhere, no logos, no people's faces.
```

**GLOBAL NEGATIVE** (paste into the negative-prompt field; if there is none, append it as "Avoid: …"):
```
text, letters, words, numbers, digits, prices, dollar signs, percent signs, handwriting, labels, stickers, barcodes, QR codes, logos, brand names, trademarks, watermarks, signatures, signage, house numbers, street signs, licence plates, yard signs, user interface, app screens, charts, graphs, star ratings, faces, identifiable people, celebrities, extra fingers, fused fingers, deformed hands, warped architecture, bent window frames, wavy roof lines, melting objects, duplicated objects, floating objects, oversaturated colours, HDR look, neon, lens flare streaks, light leaks, flashing lights, blinking lights, strobe, glitch, cartoon, illustration, CGI render look, stock-photo smile, cash, coins, piggy bank, calculator, credit card, green glow, red warning light, purple tint
```

**MOTION block** (append to every image-to-video prompt):
```
Locked-off cinematic camera with only the slow move described, perfectly smooth, no shake, no zoom, no rotation, no cuts, no speed changes. Lighting stays constant, with no flicker and no blinking. Realistic physics. The left side of the frame stays calm and still.
```

**MOTION NEGATIVE:**
```
camera shake, handheld, fast motion, zoom, whip pan, orbit, rotation, cut, morphing, warping, flicker, strobing, blinking lights, sudden brightness change, objects appearing or disappearing, extra fingers, text appearing, logo appearing
```

### 4.2 S1 — Exterior, blue hour (key frame = loop start = poster)

| Setting | Value |
|---|---|
| Still | Image model of choice, **16:9**, highest native resolution ≥ 1920×1080 (upscale only if needed). Generate 6–8 candidates |
| Video | Image-to-video, start image = approved S1 still, **1080p, 5 s** |
| Mobile | 4:5 crop from 16:9 (default). Native **9:16** still + clip only for mobile option M-A (§5) |

**Still prompt (16:9):**
```
Wide exterior view at blue hour of a modest two-storey Midwestern American house with light grey vinyl siding, white trim, a covered front porch with a soft porch light, and a mature maple tree beside it, on a quiet flat residential street in late summer. Warm light glows from two downstairs windows and one upstairs window. A neat row of all-black residential solar panels sits flush on the south-facing asphalt-shingle roof plane, softly reflecting the deep blue sky. The house sits in the right half of the frame, between 55 and 90 percent of the image width; the left 45 percent of the frame is calm, dark, low-detail sky, lawn and soft tree silhouettes, empty space reserved for a headline. Camera at eye height from across the street, 24mm lens, f/4, level horizon, slight soft focus on the foreground lawn. [STYLE block]
```
Shot-specific negative (add to GLOBAL): `mailbox, car in driveway, people, pets, streetlight glare, snow, christmas lights, solar installer sign, power lines across the house`

**Still prompt (9:16, M-A only):**
```
Same blue-hour Midwestern two-storey house with grey vinyl siding, porch light, maple tree and flush black rooftop solar panels, composed vertically: the house sits low in the frame between 58 and 86 percent of the image height; the upper 55 percent is calm deep-blue dusk sky with soft tree-branch silhouettes at the edges, empty space for text; the bottom 12 percent is dark lawn. Eye-height camera from across the street, 28mm lens, f/4, level horizon. [STYLE block]
```

**Image-to-video prompt:**
```
Very slow, steady dolly-in toward the house, travelling about three percent of the frame over the whole clip, camera level. The maple leaves sway very gently in a light breeze. Window light and porch light stay perfectly steady. The sky stays the same deep blue. Nothing else moves. [MOTION block]
```

**Iteration notes**
- Reject clips where the **window count, roof lines or panel grid shift** during the move. This is the most common failure. Lower the motion strength if the UI exposes it.
- If the panels read as glowing or "hero", regenerate the still with `solar panels are matte and subtle, a minor detail of the roof`.
- Keep the **seed of the approved still**, and use that still as the style reference for S2–S4.

### 4.3 S2 — Kitchen table, scattered

| Setting | Value |
|---|---|
| Still | 16:9, 6–8 candidates. Style reference = S1 still. Also save one **"no hands" variant** as a fallback |
| Video | Image-to-video, 1080p, 5 s. Budget 4–6 attempts (hands are high-risk) |

**Still prompt (16:9):**
```
Medium close-up interior of a light oak kitchen table in the evening, lit by a warm pendant lamp overhead. Loose sheets of paper and plain white envelopes lie casually scattered across the right half of the table, every sheet turned printed-side down or folded closed so only blank paper backs are visible. A plain ceramic mug and a smartphone lying face-down sit among them. A person's hands enter from the right edge, medium-brown skin, short unpainted nails, no rings, oatmeal knit sweater sleeves, resting near a sheet; no face visible. In the soft background, a window shows deep blue dusk. The left 45 percent of the frame is a softly out-of-focus wall and table edge in gentle shadow, very low detail, empty space for a headline. 50mm lens, f/2.8, camera just above table height angled 30 degrees down. [STYLE block]
```
Shot-specific negative: `readable paper, printed text, invoice, receipt, laptop, calculator, pen writing, coffee spill, clutter on left side, face, phone screen visible`

**Image-to-video prompt:**
```
Slow lateral camera slide from left to right, about two percent of the frame. The hands calmly slide one envelope toward the others, a single unhurried natural movement, then rest. A faint wisp of steam rises from the mug. The pendant light stays steady. [MOTION block]
```

**Iteration notes**
- Hands are the main risk. Reject any frame with extra or fused fingers or a sleeve that changes colour. After 3 failed attempts, switch to the **no-hands fallback**: same table, with the slide move only and steam as the only motion.
- Reject if any sheet becomes legible or gains text-like scribbles. If the papers keep rendering text, regenerate the still with `papers are plain blank white`.
- Save the approved frame as the **reference image for S4** (table, mug, lamp, hands).

### 4.4 S3 — Router detail with a light trace

| Setting | Value |
|---|---|
| Still | 16:9, 6 candidates. Style reference = S1 still |
| Video | Image-to-video, 1080p, 5 s, 3–4 attempts |

**Still prompt (16:9):**
```
Close-up of a plain matte-white home Wi-Fi router with no markings, no logo and no labels, standing upright on a light oak bookshelf beside a small green potted plant and a neatly coiled white cable that runs left along the shelf. Two tiny soft-white status lights glow steadily on its front. Evening: a warm lamp off-frame left casts soft warm light, and cool blue window light from the right gives the router a gentle rim highlight. The router sits between 62 and 78 percent of the frame width; the left half of the frame is soft out-of-focus shelf with gentle warm bokeh, very low detail, empty space for a headline. 85mm lens, f/2.8, shallow depth of field, camera level with the shelf. [STYLE block]
```
Shot-specific negative: `antenna brand, ethernet port labels, blinking LEDs, green LED, red LED, blue neon, cables tangled across the frame, books with titles`

**Image-to-video prompt:**
```
Very slow push-in toward the router, about two percent of the frame. Once during the clip, a faint thin line of soft pale-blue light travels smoothly along the white cable from the middle of the frame toward the router and gently fades into it, like light finding its way; it moves slowly and does not sparkle or flash. The router's status lights stay perfectly steady and do not blink. [MOTION block]
```

**Iteration notes**
- **Accessibility gate:** the light trace must be slow and low-contrast, with no bursts. Reject any clip with sparkles or a brightness pulse (§9.3).
- The trace must **not start left of about 40 % width** (text-safe area). If it does, mirror the still so the cable runs into frame from the right edge and regenerate.
- If the plant reads as a "green savings" accent, desaturate it in the grade. Don't regenerate just for that.

### 4.5 S4 — Same table, resolved

| Setting | Value |
|---|---|
| Still | 16:9, 4–6 candidates. **Reference image = approved S2 frame** (keep table, mug, lamp, hands, lens) |
| Video | Image-to-video, 1080p, 5 s, 3–5 attempts |

**Still prompt (16:9):**
```
The same light oak kitchen table, the same warm pendant lamp, the same mug and the same evening blue window as the reference image, now calm and organised: the papers are squared into one neat stack, printed-side down, with the envelopes closed beneath a closed fabric-covered notebook; the smartphone lies face-down beside the stack. The same hands, medium-brown skin and oatmeal knit sleeves, rest lightly on top of the stack at the right edge. The left 45 percent of the frame is the same soft out-of-focus wall and table edge in gentle shadow, empty space for a headline. 50mm lens, f/2.8, same camera position and angle as the reference. [STYLE block]
```
Shot-specific negative: as S2, plus `messy papers, open notebook, writing in notebook`

**Optional variant — ILLUSTRATIVE UI (needs owner sign-off at CP1).** Replace "the smartphone lies face-down" with: `the smartphone lies face-up showing a soft, blurred, abstract screen of pale rounded blocks, with no words, no numbers, no icons and no logos`. Mark this shot `ILLUSTRATIVE UI` in the manifest. **Reject** the clip if anything number-like or text-like appears on the screen in any frame. The default (face-down) is safer and is recommended.

**Image-to-video prompt:**
```
Very slow push-in, about two percent of the frame. The hands lift gently from the stack and withdraw out of frame to the right in one calm, natural movement. Then everything is still except a faint wisp of steam from the mug. The pendant light stays steady. [MOTION block]
```

**Iteration notes:** compare S2 and S4 side by side. The mug position, lamp and grain direction must match. If the reference feature drifts the table colour, correct it in the grade (§7.4) rather than spending credits.

### 4.6 S5 — Return home (closes the loop)

S5 needs **no new still**, which saves credits. Make it from the S1 key frame:

1. Run a **second image-to-video generation from the same S1 key frame** with a **different seed**, using the S1 dolly-in prompt (so the leaf motion differs from S1). 1080p, 5 s, 2–3 attempts.
2. **Reverse the clip in the edit.** A reversed dolly-in becomes a pull-back that **ends exactly on the key frame**, which is S1's first frame. The loop seam is then continuous, with no dissolve needed.
3. If the image-to-video model offers **start-and-end-frame** control, an alternative is to generate a pull-back with end frame = S1 key frame. Use whichever looks better.

**Iteration notes:** reversed foliage can look odd if a gust is strong. Pick the calmest take. Check that no light switches on or off (when reversed it would read as a change).

### 4.7 Seed and consistency strategy

| Mechanism | How to use it |
|---|---|
| **Seeds** | Record the seed of every accepted generation. When iterating on wording, **lock the seed** so only the wording changes. When exploring, randomise |
| **Style reference** | The approved S1 still is the style reference for S2, S3 and S4 (grade, palette, grain, lighting temperature) |
| **Content reference** | The approved S2 frame is the content reference for S4 (same table, mug, lamp, hands) |
| **Character consistency** | No faces, so no character model is needed. Hand and sleeve consistency comes from the S2 reference plus the locked hand description in §2.8. If the UI offers a character/reference feature, it may help with the hands. Not required |
| **Wording** | Do not paraphrase the STYLE and NEGATIVE blocks between shots. Identical wording is part of the consistency strategy |
| **Grade** | A single grade (one LUT or one set of adjustments) is applied to all five shots in the edit. This is the final consistency pass and costs no credits |

### 4.8 Generation log (copy for each attempt)

```
shot: S2 | attempt: 3 | type: i2v | date: 2026-__-__ | operator: __
model (as shown in UI): __ | resolution: 1080p | duration: 5 s | credits charged: __
seed: __ | start image: pf-hero-v1-S2-still-a2.png | reference(s): S1-still-a4.png
prompt: <exact text> | negative: <exact text>
result: accept / reject | reason: e.g. "6 fingers at 3.1 s"
```

---

## 5. Mobile compositions

The platform header is a solid bar, about 68 px of nav, plus about 36 px of staging banner on non-production builds (`PlatformApp.tsx`). It does not overlay the hero, so on mobile the hero starts below it. A sticky bottom CTA (the pattern from the fiber site, 02 §2) needs about 88 px plus `env(safe-area-inset-bottom)`.

### 5.1 Two options

| | **M-B: 4:5 media panel below the CTAs (recommended)** | M-A: 9:16 full-bleed behind the copy |
|---|---|---|
| Layout | Copy and CTAs sit on the solid light page at the top. A rounded 4:5 media panel follows, full width minus the 16 px gutters | Media fills the hero behind a dark scrim; copy at the top, subject low |
| LCP | The H1 or lede text stays the LCP element, as today | The poster becomes a large LCP candidate and must be preloaded |
| Contrast risk | None (no text over media) | Needs the scrim in §9.5 |
| Source | **Cropped from the 16:9 masters**, so no extra generations | Needs native 9:16 stills and clips for S1/S5, S2 and S4 |
| Credits | +0 | +6–9 clips, +10 stills (§10) |
| Fits the light platform theme | Yes | Introduces a dark block at the top of a light page |

**Recommendation:** ship **M-B** first. Consider M-A only if the owner wants a full-bleed mobile look and approves the extra spend.

### 5.2 M-B crop specification (from the 1920×1080 master)

- Crop window: **864×1080** (4:5), positioned per shot so the subject sits about centre:

| Shot | Crop x-offset (px) | Notes |
|---|---|---|
| S1 / S5 | 960 | House centred; check the roof edge is not clipped |
| S2 / S4 | 900–1000 | Keep the hands and stack in frame. Mug may clip at the right edge |
| S3 | 1000 | Router about 45 % across the panel |

- Output: **720×900** video and posters at 720×900 and 480×600. CSS width ≈ 343 px at 375 px viewport; DPR is capped at 2, as `chooseVideo()` already does.
- Subject safe area inside the panel: 10 % inset on all sides (rounded corners at 16–24 px radius clip the edges).
- No pause button overlaps the subject. Put it bottom-right inside the panel with a 12 px inset.

### 5.3 M-A layout specification (9:16, 720×1280)

| Zone (of frame height) | Content |
|---|---|
| 0–8 % | Below the header. Keep dark and calm |
| 8–55 % | **Text-safe:** H1, lede and CTAs. Sky, wall or bokeh only; luma ≤ about 35 % before the scrim |
| 58–86 % | **Subject band:** house, table or router |
| 86–100 % | Sticky-CTA and home-indicator safe area. Dark and calm (scrim ≥ 0.5) |

S3 (router) may be cropped from 16:9 for M-A: 608×1080 at x ≈ 1000, scaled to 720×1280. That is a 1.18× upscale, acceptable for a 2 s detail shot. Do not crop S1, S2, S4 or S5 for M-A; generate them natively.

### 5.4 When mobile gets a still instead of video

The poster stays and **no video is requested** when any of these hold. The first two match the existing `HeroMedia` logic.
1. `prefers-reduced-motion: reduce` (`prefersReducedMotion()`).
2. `isConstrained()`: Save-Data on; `effectiveType` 2g/3g; `deviceMemory` ≤ 2 GB; ≤ 2 CPU cores.
3. The visitor previously pressed **Pause** (remembered per browser; §9.2).
4. M-B: the panel has not entered the viewport (load the video on intersection, after `afterLoadIdle`).
5. Autoplay is refused (e.g., iOS Low Power Mode). The poster simply remains, because the video only fades in `onPlaying`.
6. The mobile clip fails QA for any reason. **A good still beats a mediocre loop.**

Landscape phones fall outside `MOBILE_QUERY` (portrait only) and receive the 720p desktop rendition. That is acceptable.

---

## 6. Poster-frame specifications

**Which frame:** **frame 0** of each final encode. It equals the approved S1 key frame, so the fade from poster to video never jumps. `build-media.sh` already extracts posters this way.

### 6.1 Dimensions and byte budgets

Budgets are for the **format a modern browser actually downloads** (AVIF, else WebP). JPEG is a fallback that rarely ships.

| File (proposed name) | Size | Breakpoint | AVIF max | WebP max | JPEG max |
|---|---|---|---|---|---|
| `pf-poster-1920` | 1920×1080 | Desktop, DPR-adjusted width > 1300 px | 100 KB | 120 KB | 260 KB |
| `pf-poster-1280` | 1280×720 | Desktop / tablet landscape | 60 KB | 80 KB | 140 KB |
| `pf-poster-768` | 768×432 | Small tablet / fallback | 30 KB | 40 KB | 60 KB |
| `pf-poster-panel-720` | 720×900 | Mobile M-B, DPR 2 | 60 KB | 80 KB | 120 KB |
| `pf-poster-panel-480` | 480×600 | Mobile M-B, DPR 1 / small | 30 KB | 45 KB | 70 KB |
| `pf-poster-mobile` | 720×1280 | Mobile M-A only | 70 KB | 80 KB | 160 KB |
| `pf-poster-mobile-480` | 480×854 | Mobile M-A only | 40 KB | 50 KB | 80 KB |

For reference, the live fiber posters are 89 KB AVIF and 138 KB WebP at 1920 (`public/media/poster-1920.*`). The platform target is slightly tighter because the platform's mobile LCP is already 2.6–2.7 s (10-milestone-m1 "Known limits").

**Quality targets.** Use the existing encoder settings as the starting point: AVIF `libaom-av1 -still-picture 1 -crf 44`, WebP `-quality 60`, JPEG `-q:v 6`. Raise the CRF or lower the quality until the size fits. Then inspect at 100 % for banding in the sky gradient. If banding appears, add a tiny amount of noise *before* the AVIF encode rather than lowering the CRF.

### 6.2 LCP rules
1. **The poster or the text is the LCP element, never the video.** The `<video>` occupies exactly the poster's box (same size, so it never registers as a *larger* candidate). It is requested only after `load` plus idle (`afterLoadIdle`).
2. **Desktop (full-bleed media):** the poster is likely LCP. It must be discoverable early. Have the server emit `<link rel="preload" as="image" imagesrcset="…" imagesizes="100vw" type="image/avif" media="(min-width: 768px)" fetchpriority="high">` for `/savings` only, the same way `server/preload.ts` already adds platform chunk hints. The `<img>` carries `fetchpriority="high"` and explicit `width`/`height`.
3. **Mobile M-B:** the H1 or lede should be LCP. Verify in Lighthouse. If the panel poster becomes LCP on tall phones, give it `fetchpriority="high"` and a mobile-only preload. Otherwise leave it at default priority and **do not lazy-load** it if it is in the first viewport.
4. Preload **only the current breakpoint's poster** (use `media` on the preload link). **Never preload video.**
5. Do not use `loading="lazy"` on a poster that is LCP.

### 6.3 Art direction via `<picture>` (pattern; mirror `HeroMedia.tsx`)

```html
<!-- Mobile M-B panel (portrait phones) -->
<picture>
  <source media="(max-width: 767px) and (orientation: portrait)" type="image/avif"
          srcset="/media/platform/v1/pf-poster-panel-480.avif 480w, /media/platform/v1/pf-poster-panel-720.avif 720w"
          sizes="calc(100vw - 32px)">
  <source media="(max-width: 767px) and (orientation: portrait)" type="image/webp"
          srcset="/media/platform/v1/pf-poster-panel-480.webp 480w, /media/platform/v1/pf-poster-panel-720.webp 720w"
          sizes="calc(100vw - 32px)">
  <source media="(max-width: 767px) and (orientation: portrait)"
          srcset="/media/platform/v1/pf-poster-panel-480.jpg 480w, /media/platform/v1/pf-poster-panel-720.jpg 720w"
          sizes="calc(100vw - 32px)">
  <!-- Desktop 16:9 -->
  <source type="image/avif" srcset="/media/platform/v1/pf-poster-768.avif 768w, /media/platform/v1/pf-poster-1280.avif 1280w, /media/platform/v1/pf-poster-1920.avif 1920w" sizes="100vw">
  <source type="image/webp" srcset="/media/platform/v1/pf-poster-768.webp 768w, /media/platform/v1/pf-poster-1280.webp 1280w, /media/platform/v1/pf-poster-1920.webp 1920w" sizes="100vw">
  <img src="/media/platform/v1/pf-poster-1280.jpg"
       srcset="/media/platform/v1/pf-poster-768.jpg 768w, /media/platform/v1/pf-poster-1280.jpg 1280w, /media/platform/v1/pf-poster-1920.jpg 1920w"
       sizes="100vw" width="1920" height="1080" alt="" fetchpriority="high" decoding="async">
</picture>
```

`alt=""` is correct because the image is decorative; the meaning lives in the HTML copy (§9.4). The mobile and desktop layouts use different boxes, so the `<img>` width/height attributes describe the desktop ratio. The mobile panel container sets `aspect-ratio: 4 / 5` in CSS (§8.4).

---

## 7. Asset delivery requirements

### 7.1 File naming convention

```
pf-<asset>-<variant>[.<codec>].<ext>
  asset   : hero | poster
  variant : 1080 | 720 | panel | mobile | 1920 | 1280 | 768 | panel-720 | panel-480 | mobile-480
  codec   : av1 (omitted for H.264 / still images)
examples: pf-hero-1080.mp4, pf-hero-1080.av1.mp4, pf-hero-panel.mp4, pf-poster-1920.avif
```

This mirrors the fiber names (`hero-1080.av1.mp4`, `poster-mobile-480.webp`), so the AV1-then-H.264 fallback in `HeroMedia` (`onError` strips `.av1.`) works unchanged. Masters and intermediates use `pf-hero-v<N>-S<shot>-<still|clip>-a<attempt>.<ext>`.

### 7.2 Folder structure

```
public/media/                      ← live fiber assets: DO NOT overwrite for platform work
public/media/platform/v1/          ← platform web encodes + posters (served at /media/platform/v1/…)
media/source/                      ← existing committed fiber sources (hero-src.jpg, home-src.jpg)
media-src/platform/v1/             ← masters, edit project, ProRes, generation outputs (git-ignored: .gitignore has media-src/)
media/manifests/pf-hero-v1.json    ← provenance + checksums (small; committed)
```

**Versioning:** `/media` is served with `maxAge: '30d'` and **no content hashing** (`server/app.ts`). Never replace a platform file in place. A new cut goes in `platform/v2/`, the code reference is updated, and `v1` is deleted one release later. (For the fiber refresh, §11, the existing fixed names are kept; returning visitors may see the old poster for up to 30 days unless the names are versioned too. That is an owner choice.)

**Content Security Policy:** `mediaSrc` is `'self'` (`server/app.ts`). All media must be self-hosted under `/media`. A CDN would need a CSP change and approval.

### 7.3 Masters (archive, not served)

| Item | Spec |
|---|---|
| Raw generations | Keep every *accepted* still (PNG) and clip (as downloaded) unaltered, with any embedded Content Credentials (C2PA) intact |
| Edit master | 1920×1080 and (M-A only) 1080×1920, ProRes 422 HQ or lossless H.264 (`-crf 10` as in `build-media.sh`), Rec.709, constant frame rate, 12.0 s, no audio |
| Grade | One LUT or settings file for all shots, saved alongside |

### 7.4 Web encodes

| Property | Requirement |
|---|---|
| Container | MP4 with `+faststart` (moov atom first) |
| Primary codec | **H.264**, 8-bit `yuv420p`, Main or High profile, **Level ≤ 4.0**. This plays on every current browser and phone; Constrained Baseline is not required unless a specific legacy target appears |
| Optional codec | **AV1 in MP4** (`.av1.mp4`, `libsvtav1`), selected by `canPlayType('video/mp4; codecs="av01.0.05M.08"')` as `HeroMedia` already does. WebM/VP9 is **not needed** (no code path uses it) |
| Resolutions | Desktop 1920×1080 and 1280×720; mobile M-B 720×900; mobile M-A 720×1280 |
| Frame rate | Constant. Keep the generator's native rate (often 24 fps) for **all** shots. **Do not interpolate** (no 24→30 conversion). If shots arrive at mixed rates, conform to the most common one with frame duplication, never optical flow |
| GOP / keyframes | 2 s (`-g 48` at 24 fps, `-g 60` at 30 fps) for H.264; 4 s for AV1 |
| Duration | 12.0 s ± 1 frame |
| Loop seam | Last frame flows into frame 0 (S5 reverse, §4.6). Check: play 3 loops in Chrome and Safari; no visible luminance or position pop |
| Audio | **None.** Encode with `-an`. Verify that `ffprobe -select_streams a` prints nothing |
| Colour | Rec.709 primaries, transfer and matrix, limited (TV) range, tagged: `-color_primaries bt709 -color_trc bt709 -colorspace bt709` |
| Metadata | Strip container and stream metadata: `-map_metadata -1`. No GPS, no software tags, no prompt text |
| Pre-processing | Light denoise (e.g. `hqdn3d=1.5:1.5:3:3`) before encoding; no added grain |

**Bitrate targets** (12 s; budgets in §8):

| Rendition | H.264 CRF (start) | H.264 maxrate / bufsize | Target avg | AV1 CRF (start) |
|---|---|---|---|---|
| `pf-hero-1080` | 26 | 2.5M / 5M | ≤ 2.0 Mbps (≤ 3.0 MB) | 40 |
| `pf-hero-720` | 26 | 1.4M / 2.8M | ≤ 1.1 Mbps (≤ 1.7 MB) | 40 |
| `pf-hero-mobile` (M-A) | 27 | 1.2M / 2.4M | ≤ 1.0 Mbps (≤ 1.5 MB) | 41 |
| `pf-hero-panel` (M-B) | 27 | 0.9M / 1.8M | ≤ 0.7 Mbps (≤ 1.1 MB) | 41 |

**Encode sketch** (not yet run; adapt into a platform build script after approval):

> ⚠️ **Do not run `scripts/build-media.sh` with `HERO_VIDEO=` for platform work.** It writes the *fiber* file names into `public/media/` and would replace the live fiber hero on the next deploy.

```bash
# Seamless-loop helper (if a dissolve seam is needed instead of the S5 reverse):
# edit.mov is 12.5 s; the last 0.5 s dissolves into the first 0.5 s, output 12.0 s.
ffmpeg -i edit.mov -filter_complex \
 "[0:v]split=3[a][b][c];[a]trim=0.5:12.0,setpts=PTS-STARTPTS[body];\
  [b]trim=12.0:12.5,setpts=PTS-STARTPTS[tail];[c]trim=0:0.5,setpts=PTS-STARTPTS[head];\
  [tail][head]blend=all_expr='A*(1-T/0.5)+B*(T/0.5)'[mix];[body][mix]concat=n=2:v=1[out]" \
 -map "[out]" -an -c:v prores_ks -profile:v 3 media-src/platform/v1/loop-master.mov

OUT=public/media/platform/v1; mkdir -p "$OUT"
enc() { # master scale-or-crop name h264crf maxrate bufsize av1crf gop
  ffmpeg -v error -y -i "$1" -vf "$2,hqdn3d=1.5:1.5:3:3,format=yuv420p" -an -map_metadata -1 \
    -c:v libx264 -profile:v high -level 4.0 -preset slower -crf "$4" -maxrate "$5" -bufsize "$6" -g "$8" \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "$OUT/$3.mp4"
  ffmpeg -v error -y -i "$1" -vf "$2,hqdn3d=1.5:1.5:3:3,format=yuv420p" -an -map_metadata -1 \
    -c:v libsvtav1 -preset 5 -crf "$7" -g $(( $8 * 2 )) \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "$OUT/$3.av1.mp4"
}
M=media-src/platform/v1/loop-master.mov
enc "$M" "scale=1920:1080:flags=lanczos" pf-hero-1080 26 2.5M 5M 40 48
enc "$M" "scale=1280:720:flags=lanczos"  pf-hero-720  26 1.4M 2.8M 40 48
enc "$M" "crop=864:1080:960:0,scale=720:900:flags=lanczos" pf-hero-panel 27 0.9M 1.8M 41 48
# Posters: frame 0 of each rendition, encoded exactly as build-media.sh's still() does
# (AVIF libaom -still-picture 1 -crf 44, WebP -quality 60, JPEG -q:v 6), then tuned to §6.1.
```

If S2/S4 need different crop offsets for the panel (§5.2), crop per shot **in the edit** and export a separate 4:5 master, rather than using one fixed crop.

### 7.5 Checksums and manifest

`media/manifests/pf-hero-v1.json` (committed). Example shape:

```json
{
  "version": "pf-hero-v1",
  "status": "proposed",
  "aiGenerated": true,
  "disclosure": "Background footage is AI-generated and illustrative. It shows no real home, customer or offer.",
  "illustrativeUi": false,
  "owner": "Spotlight Marketing LLC",
  "generator": { "service": "Higgsfield", "plan": "<as shown in UI>", "termsCheckedOn": "2026-__-__" },
  "shots": [
    { "id": "S1", "still": { "model": "<UI name>", "seed": 0, "prompt": "…", "negative": "…", "creditsCharged": 0 },
      "clip": { "model": "<UI name>", "seed": 0, "prompt": "…", "resolution": "1080p", "durationS": 5, "creditsCharged": 0 },
      "references": [] }
  ],
  "approvals": { "CP0": null, "CP1": null, "CP2": null, "CP3": null, "CP4": null, "CP5": null },
  "files": [ { "path": "public/media/platform/v1/pf-hero-1080.mp4", "bytes": 0, "sha256": "…" } ]
}
```

Generate checksums with `sha256sum public/media/platform/v1/* > media/manifests/pf-hero-v1.sha256` and paste the values into `files`.

### 7.6 Integration notes (proposed, not built)
- `HeroMedia.tsx` hard-codes fiber names under `/media/`. The platform needs either a parameterised version (base path, names, mobile layout) or a copy under `src/platform/`. Respect the style isolation enforced by `tests/platform-safety.test.ts`: no `pf-` classes outside `src/platform`, and the platform must remain a lazy import.
- Add a pause control (§9.2) and a stored pause preference. The **fiber hero currently has no pause control**; see §9.2.
- Server: add the poster preload for `/savings` alongside the existing chunk preloads (`server/preload.ts`).
- Commit with `[skip render]`. Validate on staging (`PLATFORM_ENABLED` on) before any production request.

### 7.7 Licensing, usage rights and provenance
- **Rights record (in the manifest):** service and plan tier; the commercial-use terms in force on the generation date (operator reads and records them; legal confirms at CP4); the account holder (should be the operating entity, Spotlight Marketing LLC); generation dates; credits charged.
- **Inputs:** only original prompts and our own approved generations as references. **No third-party photos** (no real house photos, no Street View, no stock images) as references unless licensed, with the licence stored.
- **Real people:** none in v1. If any are added later, signed model releases are stored with the manifest.
- **Provenance and disclosure:** the manifest marks every asset `aiGenerated: true`. Web encodes are re-encoded, so any Content Credentials in the raw download will not survive. Keep the raw files with their credentials in `media-src/` as the evidence copy. **Recommended (⚑ legal to confirm):** a one-line public note, e.g. in the footer or a credits/accessibility page: *"Background imagery is AI-generated and illustrative; it does not show a real customer, home or offer."* This is consistent with the project's no-fabricated-data rule.
- **Use limits:** the footage is mood imagery only. Do not reuse it in ads with copy that adds savings, solar-production or financing claims without legal review (C5).

---

## 8. Performance limits

Acceptance criteria (CLAUDE.md): **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1**. For the hero, the target is **CLS = 0**.

### 8.1 Byte budgets per asset (served format)

| Asset | Budget | Live fiber reference (`public/media`) |
|---|---|---|
| Desktop 1080p video | H.264 **≤ 3.0 MB**, AV1 **≤ 1.5 MB** | 3.25 MB / 1.41 MB. The H.264 file is **over** this target; the refresh in §11 should fix it |
| Desktop 720p video | H.264 ≤ 1.7 MB, AV1 ≤ 1.0 MB | 1.67 MB / 0.90 MB |
| Mobile M-A 9:16 video | H.264 **≤ 1.5 MB**, AV1 ≤ 0.9 MB | 1.52 MB / 0.82 MB |
| Mobile M-B 4:5 video | H.264 ≤ 1.1 MB, AV1 ≤ 0.7 MB | — |
| Poster (served format) | ≤ 120 KB at 1920; ≤ 80 KB on mobile (see §6.1) | 89 KB AVIF / 138 KB WebP at 1920 |

### 8.2 Budgets per page (hero media only)

| | Before LCP | After load + idle | Total |
|---|---|---|---|
| Desktop | ≤ 120 KB (one poster) | ≤ 3.0 MB (one video) | ≤ 3.2 MB |
| Mobile | ≤ 80 KB (one poster, or 0 if the panel is below the fold) | ≤ 1.5 MB | ≤ 1.6 MB |
| Reduced motion / Save-Data / constrained | ≤ 120 KB | 0 | ≤ 120 KB |

Exactly **one** poster and **at most one** video rendition download per visit, chosen per viewport as `chooseVideo()` does.

### 8.3 Loading rules (reuse `src/lib/motion.ts`)
1. Poster in HTML/JSX from the first render. Preloaded on desktop (§6.2).
2. Video `src` is set only inside `afterLoadIdle()`: after `load`, then `requestIdleCallback` (timeout 2.5 s).
3. **Skip video entirely** when `prefersReducedMotion()`, `isConstrained()` (Save-Data, 2g/3g, ≤ 2 GB memory, ≤ 2 cores), or the stored pause preference is set.
4. M-B: also wait for the panel to intersect the viewport.
5. `preload="auto"` only once the `src` is set (as now). Never use `<link rel="preload">` for video.
6. Pause when off-screen (IntersectionObserver) or when the tab is hidden (`visibilitychange`), as now.
7. AV1 first when `canPlayType` says `"probably"`, falling back to H.264 on error. Fade in on `onPlaying` (opacity transition, compositor-only).
8. No JavaScript animation libraries for the hero. Parallax (if any) uses the existing `attachParallax()` (transform-only, rAF-batched).

### 8.4 CLS = 0
- The hero box has fixed geometry before any media loads. Desktop uses `min-height` (e.g. `min-h-[100svh]` or a fixed `aspect-ratio: 16 / 9` with a max height). The M-B panel uses `aspect-ratio: 4 / 5`.
- Poster and video are `position: absolute; inset: 0; object-fit: cover` inside that box. The `<img>` carries `width`/`height`.
- The video fades in over the poster. It never inserts content or changes layout.
- Fonts already use metric-compatible local fallbacks (`Sora Fallback`, `Inter Fallback`). Do not add new web fonts for the hero.

### 8.5 How to verify
1. **Build and serve staging locally** with `PLATFORM_ENABLED` on (see `08-operations.md`). Run `npm run check` and `npm run build`.
2. **Lighthouse mobile** (default simulated slow 4G) on `/savings`, **5 runs, take the median**. Run it A/B against the current commit on the same machine, as M1 did. Desktop: `--preset=desktop`.
   - Pass: **LCP ≤ 2.5 s**, **CLS ≤ 0.1** (expect 0), **TBT ≤ 200 ms**, Performance ≥ 90, Accessibility 100.
   - In the report's "Largest Contentful Paint element", confirm it is the **H1/lede or the poster `<img>`, never `<video>`**.
   - Note: the platform's mobile LCP is already 2.6–2.7 s before any hero work (M1 known limits). The hero must **not make it worse**, and should ship with or after the M2 bundle-split fix.
3. **INP** is a field metric that Lighthouse lab cannot measure; TBT is only a proxy. Check it in Chrome DevTools > Performance (interactions with the CTAs and pause button while the video plays) and, on staging, with the `web-vitals` library or Chrome's live metrics panel. Target ≤ 200 ms.
4. **Conditional loading:**
   - DevTools > Rendering > emulate `prefers-reduced-motion: reduce`. The Network panel must show **no `.mp4` request**.
   - DevTools network preset "3G". Confirm `navigator.connection.effectiveType` reports `3g` in the console, then reload. No `.mp4` request.
   - With the pause preference stored: no `.mp4` request.
5. **Byte check:** `ls -l public/media/platform/v1/` against §8.1. Record the Network panel's transferred bytes for the hero on mobile and desktop.

---

## 9. Accessibility fallbacks (WCAG 2.2 AA)

### 9.1 Reduced motion
`prefers-reduced-motion: reduce` → **static poster only**; the video is never requested. If the preference changes mid-visit, the video pauses (the existing `matchMedia` listener). Any decorative overlay animation also hides with `motion-reduce:hidden`, as `FiberLines` does today.

### 9.2 Pause control (WCAG 2.2.2 Pause, Stop, Hide)
The loop plays for more than 5 s alongside other content, so a pause mechanism is **required**, even though the video is decorative.
- A real `<button>` inside the hero, **bottom-right** (desktop: 24 px inset; M-B: inside the panel, 12 px inset; M-A: above the sticky-CTA zone).
- **≥ 44×44 px** target, visible focus (the platform's 3 px `pf-brand` outline), contrast ≥ 3:1 against the scrim or panel.
- Accessible name toggles between "Pause background video" and "Play background video" (or `aria-pressed` with a constant label). Do not use `aria-hidden` on the button.
- Keyboard operable. Sits after the hero CTAs in DOM order.
- The choice persists (e.g. `localStorage`). When "paused" is stored, later visits show the poster and **do not download the video** (§8.3).
- **Existing gap:** the live fiber hero (`HeroMedia.tsx`) autoplays a 12 s loop with no pause control. Add the same control there when this work is integrated (§11).

### 9.3 No flashing (WCAG 2.3.1 Three Flashes or Below Threshold)
- No more than three flashes in any one-second period; aim for **zero**. No blinking LEDs, no lightning, no strobe, no fast light sweeps. The S3 light trace is a slow, low-contrast glide.
- Avoid large, fast luminance changes at dissolves (0.4 s minimum, similar exposure on both sides).
- Check the final encode with a photosensitivity analysis tool (e.g. the Trace Center's PEAT) and record the result in the manifest.

### 9.4 Decorative media, meaningful HTML
- `<video aria-hidden="true" tabindex="-1" muted playsinline loop disablePictureInPicture disableRemotePlayback>` (as now). The poster `<img alt="">`.
- **Every message is in HTML text:** H1, lede, CTAs, and the "no guaranteed-savings claims" line already in `Home.tsx`. The footage adds no information. That is why it needs no text alternative or audio description, but it also means it must never be the only carrier of meaning.
- Decorative media must not trap focus or receive focus.

### 9.5 Text contrast over imagery (scrim spec)
Applies to desktop full-bleed and mobile M-A (M-B has no text over media). The scrim is a static CSS gradient layer, never baked into the footage.

| Layout | Scrim (colour = `pf-ink` `#101828`) |
|---|---|
| Desktop | `linear-gradient(to right, rgb(16 24 40 / 0.88) 0%, rgb(16 24 40 / 0.78) 48%, rgb(16 24 40 / 0.20) 80%, rgb(16 24 40 / 0) 100%)`, plus a top band `rgb(16 24 40 / 0.5)` over the first 12 % |
| Mobile M-A | `linear-gradient(to bottom, rgb(16 24 40 / 0.85) 0%, rgb(16 24 40 / 0.75) 55%, rgb(16 24 40 / 0.20) 75%, rgb(16 24 40 / 0.55) 100%)` |

- **Minimum scrim opacity under any text is 0.70.** Worst case, white text over pure-white footage under a 0.70 `#101828` scrim is about **6.6:1**. At 0.60 it falls to about 4.7:1, which is the absolute floor. Below 0.60, AA fails on bright frames.
- Text colours on the scrim: headings `#ffffff`; body no dimmer than `#e4e7ec` (≈ 5.3:1 worst case at 0.70); no `pf-muted` or `pf-subtle` on the dark scrim.
- Primary CTA: the existing `pf-brand` `#1d3fd8` with white text (≈ 7.6:1). On the dark scrim, add a 1 px `rgb(255 255 255 / 0.6)` ring so the button edge reaches ≥ 3:1 (WCAG 1.4.11). Secondary CTA on dark: white text, 1 px `rgb(255 255 255 / 0.7)` border.
- **Verify on real frames:** screenshot the hero at the brightest moment of each shot (check S1's porch light and S2's lamp especially). Measure the brightest pixel behind the text box with a contrast checker. It must be ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI boundaries. A text-shadow may be added for polish but does not count toward contrast.

### 9.6 No text baked into video
No words, numbers, logos or UI in any frame (§2.10, §4 negatives). If any appear, reject the asset. Do not blur them out, because blurred numerals can still read as a figure.

### 9.7 Captions policy
v1 has **no audio track** (stripped and verified), so captions are not applicable. If any future version adds sound or voice: it must never autoplay with sound; it needs synchronised captions (WCAG 1.2.2) and a transcript; and any spoken claim goes through the same trust and legal review as page copy.

---

## 10. Budget and approval

### 10.1 Estimated generations and credits

**Assumptions** (all to be confirmed in the Higgsfield UI before CP0):
- The only price on file is the earlier check: **≈ 104–128 credits per 8 s 1080p clip** (`03-roadmap.md`). This brief uses 5 s clips. If pricing is per second, a 5 s clip might cost about 65–80 credits; if it is per clip, it may cost the full 104–128. **The range below uses 65–128 credits per clip.**
- Still-image credit cost is unknown; call it **C<sub>img</sub>** and read it from the UI.
- Acceptance rates: about 1 in 4–6 stills and about 1 in 3–4 clips (hands about 1 in 5).

| Tier | What you get | Stills | 1080p 5 s clips | Video credits (65–128 each) | Total |
|---|---|---|---|---|---|
| **T0 — Still + drift** | One approved S1 key frame animated with the existing still-drift technique (like `build-media.sh`'s zoompan), with the same posters | 8–15 | 0 | 0 | 8–15 × C<sub>img</sub> |
| **T1 — Standard (recommended)** | 5-shot loop, desktop + M-B mobile panel (cropped) | 30–45 | 15–22 | ≈ 975–2,816 | + 30–45 × C<sub>img</sub> |
| **T2 — Full** | T1 + native 9:16 mobile (M-A) for S1/S5, S2, S4 | 40–55 | 21–31 | ≈ 1,365–3,968 | + 40–55 × C<sub>img</sub> |

Per-shot clip allowance for T1: S1 3–4 · S2 4–6 · S3 3–4 · S4 3–5 · S5 2–3. Upscaling, if needed, is extra; confirm its price. **The §11 fiber refresh is a separate line:** a single continuous shot, about 4–8 stills and 3–6 clips.

**Money:** convert credits to dollars using the plan price shown at the time. The owner's stated target is about **$300/month for all project tooling**. That covers Render production (≈ $7.25), staging if approved (≈ $7.25), Resend (from $0, or $20 at 50k emails), domains and future monitoring. Creative spend must fit **within what is left in the production month**. Recommendation: the owner sets a **hard cap** at CP0 (for example, ≤ $150 for T1, to be confirmed). **Stop-loss:** if more than 50 % of the cap is spent and fewer than 2 shots are approved after CP2, stop and fall back to T0.

### 10.2 Approval checkpoints

| CP | Gate | Who | Evidence required |
|---|---|---|---|
| **CP0** | Brief, tier and credit cap approved; Higgsfield plan and commercial-use terms confirmed | Owner ⚑ | This doc; current prices recorded |
| **CP1** | Key frames approved (S1–S4 stills, 16:9; M-A 9:16 if T2). ILLUSTRATIVE UI variant accepted or declined | Owner | Contact sheet with the trust-rule checklist ticked |
| **CP2** | One motion test (S1 clip) approved for motion speed, artifacts and seam method | Owner + operator | The clip + generation log |
| **CP3** | Assembled 12 s loop, grade, all encodes and posters within budget | Operator | Byte table, `ffprobe` output, loop test |
| **CP4** | QA passed (§10.3), including legal review | Operator + counsel ⚑ | Completed checklist |
| **CP5** | Publish: commit with `[skip render]` → staging → owner approves a production deploy separately | Owner ⚑ | Staging Lighthouse/axe results |

### 10.3 QA checklist before publishing

**Trust rules**
- [ ] No text, letters, numbers, prices, %, Mbps, kWh or charts in **any frame** (scrub at 0.25× speed).
- [ ] No logos or trademarks anywhere: router, phone, TV, panels, clothing, mug, house. No Omni Fiber or utility marks.
- [ ] No faces or identifiable people; no celebrity resemblance; hands consistent and anatomically correct.
- [ ] No implied endorsement, testimonial, review or rating.
- [ ] Solar shown as an ordinary part of a house, with no savings, production or "free" connotation.
- [ ] No house numbers, street signs, licence plates or identifiable real property.
- [ ] ILLUSTRATIVE UI (if used) contains nothing number- or text-like, and is marked in the manifest.
- [ ] Hero copy next to the footage still contains no guaranteed-savings language (the page copy is unchanged by this work).

**Legal ⚑**
- [ ] Solar imagery plus adjacent copy reviewed under risk item **C5** (solar marketing and financing). Energy context under **C4**.
- [ ] Higgsfield commercial-use terms for the plan used are recorded and acceptable.
- [ ] AI-disclosure note wording approved (§7.7).

**Technical**
- [ ] `ffprobe -v error -select_streams a -show_streams <file>` prints nothing (no audio) for every video.
- [ ] `ffprobe -v error -show_entries stream=codec_name,profile,level,width,height,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries -of compact <file>` matches §7.4.
- [ ] Durations 12.0 s ± 1 frame; constant frame rate; seamless loop over 3 plays in Chrome, Safari and Firefox.
- [ ] Every file within the §6.1 and §8.1 budgets; `sha256` values recorded in the manifest.
- [ ] Metadata stripped (`-map_metadata -1`); posters carry no EXIF/XMP (check with `exiftool` or equivalent).
- [ ] Files are under `public/media/platform/v<N>/`; **no live fiber file changed** (`git status public/media`).

**Performance** (§8.5)
- [ ] Mobile and desktop Lighthouse medians: LCP ≤ 2.5 s, CLS ≤ 0.1 (expect 0), TBT ≤ 200 ms. The LCP element is text or the poster.
- [ ] Not worse than the pre-hero baseline in an A/B run.
- [ ] No `.mp4` request under reduced motion, 3G/Save-Data, or a stored pause.

**Accessibility** (§9)
- [ ] Pause button: keyboard, name, focus, 44 px, persists, stops the download on later visits.
- [ ] Photosensitivity check passed (≤ 3 flashes/s; target 0).
- [ ] Text contrast measured on the brightest frames ≥ 4.5:1 (body) and ≥ 3:1 (large text, UI boundaries).
- [ ] axe-core: 0 violations on `/savings`; Lighthouse Accessibility 100; video `aria-hidden`; poster `alt=""`.
- [ ] Reflow at 320 px with no horizontal scroll; 200 % zoom keeps the copy readable over the scrim.

---

## 11. Optional: Fiber Connect hero refresh (variant brief)

**Context.** The live fiber hero (livefiberconnect.com, Monroe, MI; provider partner Omni Fiber) is a still image (`media/source/hero-src.jpg`, fiber burst plus homes) animated as a 12 s sine-drift by `build-media.sh`. The animated `FiberLines` SVG sits on top with `mix-blend-screen`, under the scrims in `Landing.tsx`. A true generated clip can replace the drift with **no code change**: `HERO_VIDEO=path scripts/build-media.sh` keeps the same encodes, posters and file names.

**Palette (from `src/index.css`):** ink `#060914` / `#0b1020` / `#121a33` / `#1c2647`; fiber cyan `#22d3ee` / `#06b6d4`; pulse violet `#8b5cf6`. Night scene; cool and deep; cyan as the light colour, a touch of violet in the sky gradient.

**Concept (one continuous shot, cheapest and easiest to loop).** A low, slow, elevated view of a generic flat Midwestern small-city residential neighbourhood at night: tree-lined streets and warm windows. Faint thin cyan light lines glide along the streets toward the homes (stylised "fiber"), and a slow lateral drift runs left to right. Seamless loop by the reverse or dissolve method in §4.6 and §7.4.

**Composition**
- **Desktop:** the copy is on the left; the glass availability form sits on the right (`lg:grid-cols-[1.15fr_1fr]`) with backdrop blur; the scrim runs `ink-950` 95 % → 60 % → 10 % left to right. Keep the brightest light convergence around 55–75 % width, behind or just left of the form, and keep the left 45 % dark.
- **Mobile:** the copy is **bottom-aligned** (`items-end`), and the scrim runs 80 % → 35 % → solid `ink-950` from top to bottom. The subject should therefore sit in the **upper-middle 15–50 % of the 9:16 frame**.
- `build-media.sh` **centre-crops** the 16:9 clip for mobile (`scale=-2:1920,crop=1080:1920`). Either place the convergence near the horizontal centre, or (proposed script change, needs approval) add a separate `HERO_VIDEO_MOBILE` input generated natively at 9:16.
- Don't duplicate `FiberLines`: the footage's light lines should be sparse and slow, because the SVG layer already adds animated light.

**Still prompt (16:9):**
```
Elevated low-altitude night view over a generic flat Midwestern American small-city residential neighbourhood, tree-lined streets, modest one- and two-storey houses with warm glowing windows, deep navy-black night sky fading to a faint violet glow at the horizon. Very thin, faint cyan light lines run softly along the streets toward the homes, converging gently between 55 and 75 percent of the frame width. The left 45 percent of the frame is dark, calm, low-detail rooftops and trees. Cinematic, photorealistic, cool deep blue-black palette, cyan accents, low saturation except the cyan, soft glow, no text, no logos. 35mm lens, slight elevation, level horizon.
```
Negative: the GLOBAL NEGATIVE (§4.1) with `purple tint` removed, plus `recognisable landmarks, river bridge, water tower with name, billboards, utility trucks, technicians, branded vans, network equipment logos, speed numbers, Mbps, gig, fireworks, lightning, sparks, light bursts`.

**Image-to-video prompt:**
```
Very slow, smooth lateral camera drift from left to right, about three percent of the frame, altitude constant. The faint cyan light lines glide slowly along the streets toward the homes in a calm continuous flow, with no bursts, flashes or sparkles. House windows stay steady. [MOTION block]
```

**Fiber-specific trust rules:** no Omni Fiber logo, colours presented as theirs, vans or technicians; no speeds, prices or "gig" text; no identifiable Monroe landmarks (the scene is illustrative, not a coverage map, and must not imply where service is available); and no implied partnership claims beyond what the page copy says.

**Delivery:** run `HERO_VIDEO=media-src/fiber/v2/loop-master.mov scripts/build-media.sh` on a branch. Confirm that the **H.264 1080p comes in ≤ 3.0 MB** (the current file is 3.25 MB; raise CRF 26 → 27–28 if needed); check the mobile crop and posters; run the fiber Lighthouse A/B (performance 96–97 and LCP ≈ 2.5 s must not regress). Add the **pause control** from §9.2 to `HeroMedia.tsx` in the same change. Commit with `[skip render]`. Production deploys only with owner approval (pushing `claude/busy-bohr-j8rie0` deploys with about 1 minute of downtime). The existing file names are cached for 30 days, so returning visitors may see the old poster briefly unless the names are versioned (§7.2).
