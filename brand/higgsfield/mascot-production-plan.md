# Mascot production plan (starts after Gate G1)

Nothing here has been generated. No credits have been spent.

## Round 1 — concept stills (the first asset set)

Twelve stills under identical conditions, so the directions can be compared fairly.

| Asset IDs | Direction | Shot | Variations |
|---|---|---|---|
| `TKR-R1-A-H1/H2`, `TKR-R1-A-F1/F2` | A · Iconic | Head, three-quarter; full body standing | 2 each |
| `TKR-R1-B-H1/H2`, `TKR-R1-B-F1/F2` | B · Cinematic | Same | 2 each |
| `TKR-R1-C-H1/H2`, `TKR-R1-C-F1/F2` | C · Balanced | Same | 2 each |

### Shared brief (directive §24)

| Field | Value |
|---|---|
| Objective | Find the strongest execution of the Working Bear; test face, cap, jacket and silhouette |
| Channel | Internal review only; not approved brand assets |
| Character reference | None in round 1 (text only, so the exploration is our own) |
| Environment | Plain seamless backdrop in the territory's ground color |
| Composition | Subject centered, full figure in frame with margin; head shot from chest up |
| Camera | Eye level, three-quarter view, 50 mm equivalent, no movement |
| Lighting | Soft key from the upper left, gentle fill (B adds a warm rim light) |
| Action | Standing relaxed, one paw resting on a jacket pocket |
| Expression | Closed-mouth half smile, one brow slightly raised |
| Wardrobe | Low-crown trucker cap pushed back, curved brim; chore jacket; **blank** name patch on cap and chest (lettering is added later as vector, since generated text is unreliable) |
| Exclusions | Red cap, flat-brim or ranger hat, shovel, bare torso, necktie or bow tie, duffle coat, yellow circle badge, buck teeth, trucks, text, logos, realistic fur, plush-toy look, extra limbs, five-finger human hands |
| Aspect ratio / resolution | 1:1 for heads, 3:4 for full body; 1k–2k (lowest tier that shows the face clearly) |
| Audio / duration | Not applicable |
| Model | One reference-capable image model for all twelve (for example Nano Banana Pro or GPT Image 2.6); confirm the current name and price in Higgsfield first |
| Expected cost | Unknown until the first quote. Generate one image, read the cost, then decide on the other eleven |
| Acceptance | Reads as a brown bear at thumbnail size; cap and jacket correct; no item from the reject list; not confusable with the neighbours in the guardrails table |
| Fallback | If a direction fails twice, change one variable (framing, style block or model), record why, and retry once. No blind re-rolls |

### Prompt skeleton

> Original brand mascot character design: a friendly, confident adult brown bear named Tucker, warm cinnamon-brown fur with a cream muzzle, wearing a low-crown trucker cap pushed slightly back with a curved brim and a clean chore jacket with a blank rectangular name patch on the chest. Closed-mouth half smile, one eyebrow slightly raised, relaxed dependable posture, simple four-digit mitten paws. {SHOT}. {STYLE}. Plain {GROUND} seamless background, soft key light from upper left. No text, no logos.

| Direction | `{STYLE}` |
|---|---|
| A | Flat graphic illustration, four to five solid colors, geometric construction, bold simple shapes, no gradients, strong silhouette, professional brand illustration |
| B | Stylized dimensional character, premium animated-feature quality, simplified sculpted fur, expressive brows, warm rim light, shallow depth of field |
| C | Semi-flat illustration with soft form shading, clean shapes that would translate to a dimensional model, visible stitching on the patch and cap, restrained palette |

## Reference strategy after round 1

1. **G2:** founder picks one candidate. Refine it with that image as the reference (expected 8–12 stills).
2. Create one reusable character reference in Higgsfield from the approved three-quarter view. Every later generation uses it.
3. Redraw the approved flat Tucker as vector in code. That file, not a generated image, is the canonical master for the product.
4. Canonical sheet: front, back, both profiles, three-quarter front and rear, head, full body, seated, standing, walking. Then ten expressions.
5. Motion tests (turn, wave, walk, brow raise) only after the sheet is approved (G3). Ads only after motion is consistent (G4).

## Quality control

Each image is logged and checked before anyone sees it as a candidate.

| Reject if | Likely cause | Fix |
|---|---|---|
| Face or proportions drift between images | No reference, or too many changes at once | Use the reference; change one variable per generation |
| Cap or jacket changes | Wardrobe described loosely | Restate wardrobe first in the prompt; add to exclusions |
| Paw or limb errors | Complex pose or object handling | Simplify the action; keep paws off props |
| Unstable scale, odd walk, broken object contact (video) | Action too complex for one clip | Shorter clip, single action, fixed camera |
| Garbled text | Text requested in the image | Never request text; add lettering in vector |
| Looks like a neighbour character | Prompt drifted toward a familiar trope | Compare against the guardrails table; discard |
| Looks generic | Style block too vague | Tighten shape language; do not accept as final |

Every generation is recorded with: asset ID, prompt, tool, model and version, references, settings, aspect ratio, date, license terms, review status and approved use. Experimental images are never stored alongside approved assets.

## Budget tiers

Counts are estimates. Still-image prices are unknown until the first quote; video uses the one known price point from this project (about 104–128 credits per 8 s at 1080p, so roughly 65–128 per 5 s clip depending on how billing scales).

| Tier | Delivers | Stills | Clips | Video credits |
|---|---|---|---|---|
| **Lean** | Round 1, refinement, canonical sheet, 10 expressions, vector master in code | ~46 | 0 | 0 |
| **Standard** | Lean + pose library, 6 motion tests, 2 short ads, hero poster | ~60 | ~8 | ~520–1,020 |
| **Premium** | Standard + six campaigns and a hero loop | ~90 | ~31 | ~2,000–4,000 (above the current 3,000 balance; needs approval) |

**Round-1 cap proposed for G1:** 300 credits (10% of the balance). If the first quote implies more, stop and report.

## Approval gate

Round 1 does not start until the founder records, in the decision log: the territory (or "run all three"), acceptance of the guardrails, and the credit cap.
