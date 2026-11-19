# Meta campaign 001 — "Monroe, meet Tucker." (Monroe, MI)

Status: **creative produced; not launched.** Nothing has been uploaded to Meta, and no tracking code has been added to the site.

## 1. Brand audit (what existed before this campaign)

| Asset | Finding |
|---|---|
| Mascot | Round-3 master and Higgsfield character element `tucker-master` (`450b677d-…`). Blue cap with cream front panel, blue work shirt, off-white name patch. The brand log had it "not approved until G3"; **the founder approved it for paid ads on 2026-11-19** (with this campaign's credit cap). |
| Logo | **No "t." logo with an orange period existed.** The site uses a provisional dark "t" mark and the wordmark "tucker" with a dark CSS nose-period. Built here, at the founder's request, as vectors: `brand/assets/tucker-wordmark*.svg` and `tucker-t-mark*.svg`. Lettering is Sora 700 (the site's display face) converted to outlines. The period is the bear's nose (rounded top narrowing to a rounded point) in orange `#EE6A24`. **Proposed; needs founder sign-off** before it replaces the site mark. |
| Colors / type | Site: ink `#101828`, brand blue `#1D3FD8`, save green `#067647`. Fonts are Sora (display) and Inter (text). The campaign uses only these, plus the orange period and the scene's warm greige. |
| Instagram materials | **None in the project.** Not reproduced; send them if they should inform round 2. |
| Tracking | First-party only. The site records page views, CTA clicks, preview and handoff events. Each lead stores `utm_*` and the click ID (`fbclid` included). **No Meta Pixel and no Conversions API**; the site's content security policy would block the Pixel as configured. |
| Image generation | Higgsfield (Ultra plan). Requested Nano Banana Pro; jobs report Nano Banana 2, as in earlier rounds. |

## 2. Concepts

| | A · Brand introduction (second test ad) | B · Bill awareness (**lead ad, founder's pick**) | C · Convenience |
|---|---|---|---|
| Headline | MONROE, MEET TUCKER. | WHEN DID YOU LAST COMPARE YOUR BILLS? | FOUR BILLS. ONE PLACE TO COMPARE. |
| Support | Your bills might be higher than they need to be. Internet / Mobile / TV & streaming / Electricity | Internet, mobile, TV and electricity. Explore your options with Tucker. | See a preliminary savings preview with Tucker. (+ four service tiles) |
| Scene | Tucker waving, studio backdrop (`scenes/r1-1.jpg`) | Tucker at a kitchen table reading a blank bill (`scenes/r2-7.jpg`) | Tucker presenting, four service tiles (`scenes/r1-5.jpg`) |
| Files | `exports/` (4:5, 9:16, 1:1) | `exports/` (4:5, 9:16, 1:1) | `previews/` (4:5) |

Every headline that ends in a full stop uses the orange nose period. The bottom band carries the wordmark and "See your savings preview → trytucker.com". It is a caption band, not a fake button. The site name appears in plain text, and Meta's own CTA button does the clicking.

## 3. Scorecard (1–10; clarity, trust, brand consistency and conversion intent weighted ×1.5)

| Criterion | A | B | C |
|---|---|---|---|
| First-second attention | 8 | 8 | 6 |
| Brand memorability | 9 | 7 | 6 |
| Message clarity ×1.5 | 9 | 8 | 8 |
| Mobile readability | 8 | 8 | 7 |
| Visual sophistication | 8 | 9 | 6 |
| Consumer trust ×1.5 | 9 | 8 | 7 |
| Local relevance | 9 | 6 | 6 |
| Conversion intent ×1.5 | 7 | 8 | 8 |
| Brand consistency ×1.5 | 9 | 8 | 7 |
| Meta suitability | 9 | 8 | 7 |
| **Weighted score** | **8.5** | **7.8** | **6.9** |

- **Founder's decision (2026-11-19): B is the lead ad** ("This is the best one so far"). A runs alongside it as the second test ad. My weighted score had A slightly ahead for a pure introduction. B's warmth and relatability are its strengths; the live test will show which brings better leads.
- **A** does the campaign's first job, introducing a recognizable character to Monroe, with one message and lots of space. Weakness: the action is softer, because the band and Meta's button carry it. The service list is secondary text and too small to read at 25% size.
- **B** is the most relatable and most "premium photo" of the three. Weaknesses: the local cue is only the small eyebrow, and Tucker is a smaller part of the frame.
- **C** explains the product best, but the tiles make it look like an app screenshot and weaken the character. Keep it in reserve for retargeting people who already know Tucker.

**Fixed during QA:**
- A: supporting copy over Tucker's face.
- B: headline over the face, then a zoom that cut out the bill. A new scene was generated with headroom.
- C: headline collided with the cap; there was a hard edge at the scene's border.
- Story: logo and CTA had sat inside the Reels interface zone.
- Square: a one-word last line.

## 4. Meta ad copy

| | A · Meet Tucker | B · Compare your bills | C · Four bills |
|---|---|---|---|
| Primary text | Monroe, meet Tucker. We help households take a fresh look at what they pay for internet, mobile, TV and electricity. Enter your bills, see a free preliminary savings preview, and talk to a person only if you want to. | When did you last compare your bills? Many households set up internet, phone and TV once and rarely look again. Tucker gives you a quick preliminary comparison for your home: free, no account needed. | Internet, mobile, TV and electricity, in one place. Enter what you pay and Tucker shows a preliminary savings preview in about a minute. Want help? A Tucker representative can check real prices for your address. |
| Headline | See your savings preview | Compare your household bills | Four bills, one place to compare |
| Description | Free. Takes about a minute. | A preview, not a quote. | No contact details needed to preview. |
| CTA button | Learn More | Learn More | Learn More |
| Hook | A friendly local introduction; curiosity about a new name | A question that triggers recall ("when did I last check?") | Convenience: one place instead of four providers |
| Intended response | "Who's Tucker? What could it find for us?" | "It's been years. Let me see." | "That's easy enough to try." |
| Objection addressed | "Another sales pitch": free, no account, a person only if asked | "Comparing is a hassle": quick and free | "Too much effort": one place, about a minute, no contact details |

"Learn More" rather than "Get Quote": the site gives a preliminary preview, not a quote. No copy claims a resident overpays, states a savings amount, implies city endorsement or promises availability.

**UTM tags per ad:** `?utm_source=facebook&utm_medium=paid_social&utm_campaign=monroe-001&utm_content=A-meet-tucker` (B: `B-compare-bills`, C: `C-four-bills`). The site saves these and `fbclid` on every lead, so representatives' outcomes in the Agent Workspace can be reported per ad.

## 5. Launch recommendations (hypotheses, not verified performance)

- **Objective:** Leads, with the conversion location set to Website, optimized for a "Lead" event once the Pixel and Conversions API are in place (section 6).
  - Until then, a Traffic campaign optimized for link clicks is the only website option. It sends cheaper but less intent-rich clicks.
  - Meta Instant Forms would bypass the site, and nothing yet carries those leads into the Agent Workspace.
- **Geography:** Monroe County, Michigan (people living in the location), excluding Ohio, so Toledo-area audiences aren't bought for Michigan-specific providers.
- **Audience:** broad (Advantage+ audience), adults 25+. The area is small, so don't split it into interest audiences; one ad set lets Meta learn.
- **Placements:** Advantage+ placements, with the 4:5 asset for feeds, 9:16 for Stories and Reels, and 1:1 where square is preferred.
- **Creative test:** one campaign, one ad set, two ads: **B (lead)** and A, each with its matching copy. Add C later for retargeting.
- **Budget (hypothesis):** about $25–35 a day for 14 days. Judge creatives by cost per lead and the representative-qualified rate, not by clicks alone. No cost per lead can be promised before data exists.
- **KPIs, along the funnel:**
  - impression → landing page view (CTR, click-to-landing rate)
  - preview started (`preview_view`)
  - lead submitted (`handoff_submit`), and cost per lead
  - representative contacted, qualified and sale: Agent Workspace dispositions, filtered by `utm_content`
- **Lead quality:** a weekly report per ad of contacted %, qualified % and won (verified).
- **Retargeting:** needs the Pixel. Target people who viewed the preview but didn't submit (last 30 days), using C or a testimonial once real customers exist. Keep frequency under about 3 a week.
- **Optimization triggers:**
  - after about 7 days, or once spend reaches about 2× the cost per lead you'd accept, pause an ad that has no leads
  - refresh the creative when frequency passes about 3 or CTR drops by half
  - if leads come in but few qualify, change the copy before raising the budget

## 6. Landing page and tracking readiness

**Verified:**
- The ad promises a savings preview, and the homepage gives one instantly with no contact details.
- Representative handoff, lead creation, routing and the Agent Workspace are covered by tests.
- UTM tags and `fbclid` are saved on leads.
- Phone load is about 2.2 s on a throttled phone.

**Fix before launch, in priority order:**
1. **Meta Pixel and Conversions API: not installed.** Needed for the Leads objective, retargeting and accurate attribution.
   - Requires: your Meta Business account and Pixel ID, a Conversions API token stored as a server secret, a content-security-policy change, and a consent and privacy decision.
   - Proposed events: PageView, ViewContent (preview shown) and Lead (handoff submitted). Lead would be deduplicated between the browser and the server, with hashed contact data only with consent.
   - I'd build this on your approval.
2. **Privacy notice is out of date:** it still names Omni Fiber and doesn't cover the chat, representatives or advertising pixels. Meta reviews landing pages. Update it before ads run, and before the Pixel goes in.
3. **Homepage headline "50% or more":** the ad avoids savings claims, but the landing headline makes one. It needs substantiation or a softer version for paid traffic. This affects both Meta review and consumer-protection risk.
4. **Team readiness:** at least one representative account accepting leads (otherwise leads wait in the queue), team alert emails confirmed in production, and the header phone number (734) 731-1946 answered during ad hours.
5. **Customer IP address:** probably recorded wrongly behind Cloudflare (production audit finding 3). It affects consent records, so fix it before volume grows.
6. Optional: a light "Hi, Monroe" touch on the landing page for `utm_campaign=monroe-001`, for closer message match.

## 7. Files

| Path | What |
|---|---|
| `exports/tucker_monroe-001_B-compare-your-bills_{feed-4x5,story-9x16,square-1x1}.png/.jpg` | **Lead ad**, all three sizes (story keeps key content inside the Reels safe area) |
| `exports/tucker_monroe-001_A-meet-tucker_feed-4x5_1080x1350.png/.jpg` | Second ad, feed |
| `exports/tucker_monroe-001_A-meet-tucker_story-9x16_1080x1920.png/.jpg` | Final Stories/Reels asset (key content inside the Reels safe area) |
| `exports/tucker_monroe-001_A-meet-tucker_square-1x1_1080x1080.png/.jpg` | Final square asset |
| `previews/…C-four-bills…` | Concept preview (4:5), held in reserve |
| `source/compose.cjs` | Editable layouts: every word, position and size; re-render with `node brand/campaigns/monroe-001/source/compose.cjs <outDir>` |
| `source/logo.py` | Builds the vector logo files in `brand/assets/` |
| `source/scenes/*.jpg` | Generated scenes (high-quality JPEG copies). The originals can be re-downloaded from Higgsfield by job ID |

**Generation log:** 8 images, **16 credits** of the 60 approved.

| Scene | Job | Used |
|---|---|---|
| r1-1 | `a55d8956-f009-4413-beff-158fefd2485b` | A (all sizes) |
| r1-2 | `c0212476-06bc-4096-88a2-1d2667f0d500` | — |
| r1-3 | `1b8d6471-d6ba-4abf-b8a6-083524106942` | — (replaced by r2-7) |
| r1-4 | `a58162cb-05d6-4c72-a0e2-67dd337209d9` | — |
| r1-5 | `4e3486b8-3112-47a9-9997-990fd3277b0b` | C |
| r1-6 | `953e193a-1760-427d-b67b-ab5fb4863630` | — |
| r2-7 | `888e0858-8a2d-4a40-b8e7-c905e13fec98` | B, all sizes |
| r2-8 | `2d2ef9fe-9842-4605-b1b3-213623202a29` | — |
