/**
 * Platform identity. LiveFiberConnect is the household bill optimization and
 * service brokerage brand (operated by Spotlight Marketing LLC); home internet
 * is one of its service categories.
 */
import { BRAND } from '../content';

export const PLATFORM = {
  name: BRAND.name,
  operator: BRAND.agency,
  tagline: 'See what your household pays for internet, mobile, TV and electricity — and what you could pay instead.',
};

export const PLATFORM_META = {
  title: `${PLATFORM.name} — Lower your household bills`,
  description:
    'Enter what you pay for internet, mobile, TV and electricity. See a clear cost breakdown, verified alternatives where available, a free advisor review for the rest, and projections with every assumption shown.',
};
