/**
 * Parent platform identity. The brand name is an owner decision that hasn't
 * been made yet, so a descriptive WORKING name is used in one place only and
 * the UI marks it as a preview. Change it here when the brand is chosen.
 */
export const PLATFORM = {
  /** Working name — not a published brand. */
  name: 'Household Savings',
  status: 'preview' as const,
  operator: 'Spotlight Marketing LLC',
  tagline: 'See what your household pays for internet, mobile, TV and energy — and what you could pay instead.',
};

export const PLATFORM_META = {
  title: `${PLATFORM.name} — Analyze your household bills (preview)`,
  description:
    'Enter what you pay for internet, mobile, TV and energy. See a transparent cost breakdown, verified alternatives where available, and projections with every assumption shown.',
};
