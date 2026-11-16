# 09 — Design system (household platform)

Applies to the parent platform under `/savings`. The fiber site keeps its own dark theme and is not affected. The living style guide is at **`/savings/design`** on staging and in development.

## Where things live

| What | File |
|---|---|
| Tokens (`--color-pf-*`, shadows) and the `.pf` scope | `src/platform/platform.css` |
| Components | `src/platform/ds/index.tsx` |
| Charts | `src/platform/ds/charts.tsx` |
| Style guide page | `src/platform/pages/DesignSystem.tsx` |

**Isolation:** platform styles live in their own stylesheet, imported only by the lazily loaded `PlatformApp` chunk. The fiber site's CSS excludes `src/platform` (`@source not './platform'` in `src/index.css`), so the live site never downloads platform styles. `tests/platform-safety.test.ts` enforces this: no `pf-` classes outside `src/platform`, and a lazy import only.

**Loading:** on `/savings` pages only, the server adds `<link rel="stylesheet">` and `modulepreload` hints for the platform chunk and the current page's chunk. It reads them from `dist/.vite/manifest.json` (`server/preload.ts`), so they download in parallel with the main bundle.

## Colour tokens

Light, finance-grade palette. Contrast was measured against white and against the matching `*-soft` background. All text pairs are ≥ 4.5:1; the lowest is `pf-subtle` on `pf-brand-soft` at 4.70:1.

| Token | Hex | Use |
|---|---|---|
| `pf-ink` | #101828 | Primary text |
| `pf-muted` | #475467 | Secondary text (7.7:1) |
| `pf-subtle` | #5d6b82 | Tertiary text (5.4:1) |
| `pf-field` | #7a8499 | Input borders, chart "now" bars (≥ 3:1 non-text) |
| `pf-line` | #d9d6ce | Decorative dividers only |
| `pf-brand` / `-strong` / `-soft` | #1d3fd8 / #162fa3 / #eaefff | Actions, focus ring, selection |
| `pf-save` / `-soft` | #067647 / #e6f4ec | Savings |
| `pf-cost` / `-soft` | #b42318 / #fdecea | Extra cost, errors |
| `pf-warn` / `-soft` | #8a3a0c / #fef3e2 | Warnings, estimates |
| `pf-sample` / `-soft` | #5b37b8 / #f3eeff | Sample data, preview banner |
| `pf-info` / `-soft` | #175cd3 / #eaf2ff | Information, "needs address check" |

Typography uses Sora (display) and Inter (body), the same self-hosted fonts as the fiber site, so nothing extra is downloaded. Money uses `.tnum` (tabular figures).

## Components and their rules

- **Button**: primary, secondary or ghost; at least 44 px tall; `loading` sets `aria-busy`; the spinner animates only with `motion-safe`.
- **Field**: label, hint and error wiring through a render prop: `aria-describedby` lists the error and then the hint, and `aria-invalid` is set on error. Pass `id` when an error summary must link to the field.
- **CurrencyInput**: values are integer cents only (`parseDollars`); a wrong format reports an error but never stores a guess. An empty field means "unknown", stored as `null`.
- **ChoiceCards**: a fieldset with a legend. The hint and the error are both in `aria-describedby`; the inputs get `aria-invalid` on error; `id` targets the first input.
- **SegmentedControl**: native radios (arrow-key navigation built in).
- **Stepper**: a `role="group"` showing "Step N of M" text, with `aria-current="step"`.
- **StatusChip**: the data-quality label, always an icon plus a word, never colour alone. Statuses come from provenance (`publicStatus`), never hand-set. `detail` is screen-reader-only, so show anything important as visible text too.
- **Money**: `kind="savings"` always prints a direction word ("less", "more" or "no change") next to the colour.
- **Callout**: info, warn, sample or save tones.
- **Charts**: plain SVG marked `aria-hidden`, each with a real data table. CumulativeChart has a "Show data table" toggle; BarCompare has a three-column table for assistive tech. On narrow screens the SVG switches to a smaller coordinate space so its labels stay about 12 px. Hidden tables sit inside an `sr-only` div, because `sr-only` doesn't clip a `<table>`.

## Page patterns

- **Focus management:**
  - Focus moves to the step `h1` when the step changes, and to the error summary when Continue fails.
  - Focus moves to the results `h1` when results load, to the slot-picker intro after the contact form, and to the confirmation after booking.
- **Error summary:** a snapshot taken when Continue is pressed. It doesn't change as you type. Each item links to and focuses its field. It has no `role="alert"`, because focus already announces it.
- **Live updates:** results announce recalculated totals in a single debounced `role="status"` region. They announce only after the person changes something, not on load.
- **Option cards:** each radio's name is short (plan and price); the details are its description. The whole card is clickable through a label pseudo-element, and links inside it sit above that layer.
- **Titles:** `document.title` reflects the page and the assessment step.
- **Reflow:** no horizontal scroll at 320 px. The header hides the Preview chip below `sm`; the staging banner stays visible.

## Acceptance checks (M1)

- axe-core on every assessment step, the results page and the slot picker: no violations after the fixes.
- Keyboard-only completion from start to booking.
- Mobile Lighthouse accessibility 100 on `/savings` and `/savings/assess`.
