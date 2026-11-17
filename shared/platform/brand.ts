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
    'See what your household could save on internet, mobile, TV and electricity. Enter your bills for a free savings preview in about a minute. No account, no contact details.',
};

/** Share image for Tucker's own pages (regional internet pages keep theirs). */
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
