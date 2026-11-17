/**
 * Platform identity. Tucker is the only public name: a home-service savings
 * broker (operated by Spotlight Marketing LLC). The visual identity beyond the
 * name and wordmark is still in approval (see brand/README.md).
 */
import { BRAND } from '../content';

export const PLATFORM = {
  name: BRAND.name,
  operator: BRAND.agency,
  descriptor: 'Your home service savings broker.',
  tagline: 'See what your household pays for internet, mobile, TV and electricity — and what you could pay instead.',
};

export const PLATFORM_META = {
  title: `${PLATFORM.name} — Your home service savings broker`,
  description:
    'Tucker compares what you pay for internet, mobile, TV and electricity. See a clear cost breakdown, verified alternatives where available, a free advisor review for the rest, and projections with every assumption shown.',
};
