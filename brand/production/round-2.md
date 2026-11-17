# Round 2 — refining the chosen base (2026-11-17)

**Founder decision (G2):** round-1 still #9 (dimensional, round head) is the base, with refinements added. Experimental images; none is an approved brand asset yet.

| Field | Value |
|---|---|
| Tool / model | Higgsfield image batch; requested `nano_banana_pro`, jobs report `nano_banana_2` |
| Reference | Round-1 job `f5d2451a-a6a5-4cad-a2c5-afc54f498643` (#9) as the image reference for every still |
| Settings | 2k; 1:1, and 3:4 for the full body |
| Cost | 2 credits each, 16 in total. Running total 40 of the 300 cap |

## Refinements added to #9

A notch in his left ear; thicker brows with one raised; smaller, warmer eyes; a broader jaw and muzzle; a nose shaped like a soft rounded triangle (the same shape as the wordmark's period); calmer fur; a mesh-back cap; an off-white name patch with rust stitching.

| # | Job ID | Asked for | Review |
|---|---|---|---|
| R1 | `7aa27f44-fc02-4952-9ce5-f25aa5dbf1d6` | Head with all refinements | **Keep.** Same character as #9, with the notch, brows, nose and jaw applied |
| R2 | `8a974c44-7b1e-4510-a94c-8fc857bc270e` | Blockier head | Nearly identical to R1; the mesh cap is clearer. No real shape change |
| R3 | `c548fb86-d43b-4695-93e0-aed08971bcf6` | Straight front view | **Failed the brief:** still three-quarter. The single reference dominated the camera angle |
| R4 | `c350ab1d-ecb0-42cd-b5c9-53d47922cfdd` | Full body | **Keep.** Sturdy adult proportions; face and wardrobe consistent |
| R5 | `5a01d8e0-6abe-4a69-9ba3-13d34dd06c15` | Welcoming wave | Still rendering when this was written |
| R6 | `c5afa43a-7b13-44c1-a898-254f4881feca` | Thinking, paw on chin | **Keep.** Best expression so far; the paw has human-like fingers, to be fixed by a paw rule |
| R7 | `d2719321-b8eb-4d2c-97ea-dd8eb05b5255` | Flat version for the product | **Keep.** Translates cleanly; the patch is correct here (off-white, rust stitching) |
| R8 | `8bcbf27b-e42c-4104-86a9-8443fddaa076` | App icon | **Failed the brief:** a portrait, not a simplified mark |

## Findings

- Identity holds across head, full body, expression and the flat finish. That was the main risk and it passed.
- Two instructions were ignored because one reference image fixes the camera and the level of detail: the front view and the icon.
- The name patch is grey-blue in the dimensional stills and off-white in the flat one. It must be one color (off-white with rust stitching).
- Paw construction is not yet fixed (digit count varies).

## Proposed next step (needs founder approval, Gate G3 preparation)

1. Lock **R1** as the face and **R4** as the body, and create one reusable character reference from them.
2. Regenerate the head once with the off-white patch and a fixed paw rule, so the reference is correct.
3. Turnaround views (front, profile, back) using a multi-view sheet rather than one-off prompts.
4. Ten expressions from the directive's list.
5. Draw the icon and the flat master as vector in code from R7, not by generation.

Estimated cost: 20–30 stills, about 40–60 credits.
