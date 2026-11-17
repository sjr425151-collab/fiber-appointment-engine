# Round 3 — character lock, views, expressions, vector master (2026-11-17)

**Founder approval:** "I approve" (next step proposed in `round-2.md`). Experimental images; none is an approved brand asset until gate G3.

| Field | Value |
|---|---|
| Tool / model | Higgsfield image batch; requested `nano_banana_pro`, jobs report `nano_banana_2` |
| Character references | Element `tucker-bear` (`489b27e2-d418-4aee-afef-422d4bc9edd5`): R1 face + R4 body. Element `tucker-master` (`450b677d-fb5c-4c3a-a49f-2e03b6c89836`): corrected master + R1. Use `tucker-master` for all future work |
| Settings | 2k; 3:4 full body, 1:1 heads, 16:9 sheet |
| Cost | 15 stills at 2 credits = 30. Running total about 70 of the 300 cap |

## Results

| # | Job ID | Asked for | Review |
|---|---|---|---|
| M | `a2b23ae7-e80d-42a9-b229-98b35892ad4d` | Corrected master: off-white patch, bear paws | **Keep.** Patch is off-white with rust stitching and reads "tucker"; paws are mitten-shaped with claws |
| T1 | `fa02701e-b5dd-4e0b-b4db-b2b504edaa7c` | Four-view sheet | **Keep.** Front, three-quarter, profile, back at one scale |
| T2 | `1b66d508-111c-4855-8604-9fd74e5bb84a` | Straight front | **Keep.** True front view (failed in round 2; the two-image reference fixed it) |
| T3 | `04b12bab-959a-4a29-96ed-f598192a4b58` | Profile | **Keep** |
| T4 | `afcbfaa6-f6fb-4fa7-a7f0-0a0a94d10cb6` | Back | **Keep.** Cap strap and short tail correct |
| E1–E10 | `1de8382f…`, `89d10f8f…`, `35f66789…`, `a625d62b…`, `887a99ec…`, `c45ec76b…`, `06467925…`, `7244e93d…`, `bd68daa0…`, `dbee31db…` | Welcome, confident, thinking, surprised, delighted, skeptical, focused, kind, laughing, wink | **Keep all ten as candidates.** Same face in each |

Review sheets: `round-3/master.jpg`, `turnaround-sheet.jpg`, `front-profile-back.jpg`, `expressions.jpg`.

## Findings

- Identity is stable across views and expressions. The reusable reference works.
- **Open issues for G3:** the ear notch appears in some stills and not others; E5 (delighted) shows a row of human-like teeth and should be redone or dropped; the patch sits lower on the chest in some heads; cap panel proportions vary slightly.
- No lettering should be generated in future stills: ask for a blank patch and add "tucker" as vector type.

## Vector master (drawn by hand in code)

- `brand/assets/tucker-flat.svg`: head and shoulders, flat, drawn from R7 with colors sampled from it. Blank patch.
- `brand/assets/tucker-icon.svg`: the same head on a rounded square; checked at 256, 120, 64 and 32 px (`round-3/icon-sizes.png`).
- **Not used in the product.** The site still shows the provisional "t" mark until the founder approves the mascot (G3).

## Next (needs founder approval, gate G3)

Approve or correct the character sheet. After approval: fix the open issues above in one pass (about 6–10 credits), then the pose library and first motion tests (video costs more; quote first).
