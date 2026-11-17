# Round 1 — mascot concept stills (2026-11-17)

Experimental images for review. **None is an approved brand asset.** The images live in the Higgsfield account; they are referenced here by job ID and are not committed to the repository.

| Field | Value |
|---|---|
| Tool | Higgsfield image generation (batch) |
| Model | Requested `nano_banana_pro`; jobs report `nano_banana_2` |
| Settings | 2k; 1:1 for heads and icons, 3:4 for full body; no reference images |
| Cost | 2 credits each, 24 in total (cap 300). Balance 3,000 → 2,976 |
| License | Per the account's Higgsfield plan terms; commercial-use terms still to be confirmed by counsel |
| Shared prompt | The skeleton in `higgsfield/mascot-production-plan.md`, with a chambray cap and jacket, a blank patch and the exclusion list. Full prompts are stored with each job |

| # | Job ID | Variable tested | Review |
|---|---|---|---|
| 1 | `d57ae3f4-2aae-4941-a1ab-89c8cc401f56` | Head, round and soft | Friendly but generic; reads young |
| 2 | `c397cb51-b34f-48b5-b8ec-69d979887aab` | Head, blocky | **Reject:** outlined sticker style in a round crop, too close to a badge mascot |
| 3 | `9d13bbe1-83a0-41f1-b019-8282c108bf27` | Head, tall | **Shortlist:** adult, calm, distinctive tall head |
| 4 | `95f86097-1ced-486c-8e65-f88d0f6a42e1` | Head, rugged, notched ear | **Shortlist:** most character; brow reads slightly stern, soften it |
| 5 | `9a6ee354-63f4-4846-a862-e68aed923bff` | Full body, round | Reject: childlike proportions |
| 6 | `0b40396c-e1ca-447c-855a-ce85ad72a8b7` | Full body, blocky | **Shortlist:** strongest silhouette; jacket came out a brighter blue than specified |
| 7 | `dbdec487-1cb1-45d9-872e-0d3ce94795f0` | Full body, tall | Good posture; more illustrative than graphic |
| 8 | `fab8799e-ae72-4246-b5d7-144870ca4d60` | Full body, rugged | **Shortlist:** consistent with #4; ear notch visible |
| 9 | `f5d2451a-a6a5-4cad-a2c5-afc54f498643` | Dimensional head, round | Reject as a direction: the generic animated-film bear |
| 10 | `af95a015-cdc5-4397-85e7-6cc3f5e96faf` | Dimensional head, blocky | **Shortlist:** shows the block shape survives in the dimensional finish |
| 11 | `dd76118b-7927-4643-9eaf-9b9512c73b88` | Icon, round | **Shortlist:** clean and legible at 32 px |
| 12 | `68adf438-2121-4daa-be6b-958757400d35` | Icon, blocky | Reject: the muzzle shape breaks |

## Findings

- Wardrobe held in all twelve: cap, jacket and blank patch are correct, with no text, no red and no badge circles except the crop in #2.
- Paws vary in digit count between images. This needs a fixed rule in refinement.
- Patch color and jacket blue drift between images, as expected without a reference.
- The two shapes worth pursuing are the **rugged** head (#4, #8) and the **block** head (#6, #10). The round variants are the least ownable.

## Recommendation for G2

Refine a single character that takes the block silhouette of #6 and #10 and the brow, ear notch and attitude of #4, softened one step toward friendly. Use #11 as the starting point for the icon.
