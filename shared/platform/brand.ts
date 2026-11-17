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
  title: `${PLATFORM.name} | Preview Potential Savings on Your Household Bills`,
  description:
    'See how your internet, mobile, TV and electricity bills compare with Tucker’s illustrative benchmarks. Explore potential household savings and discover available options.',
};

/** Share image for Tucker's own pages (regional internet pages keep theirs). */
/** The one primary call to action, used in the header, the home page and the not-found page. */
export const PRIMARY_CTA = 'Preview My Savings';

export const PLATFORM_OG_IMAGE = '/og-tucker.jpg';

/** National structured data for the homepage: the business and the website, with no location or provider. */
export function platformStructuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${siteUrl}/#org`, name: PLATFORM.name, legalName: PLATFORM.operator, url: `${siteUrl}/`, description: PLATFORM.descriptor },
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: PLATFORM.name, publisher: { '@id': `${siteUrl}/#org` } },
    ],
  };
}
