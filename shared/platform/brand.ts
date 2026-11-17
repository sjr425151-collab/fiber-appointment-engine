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
  /** The brand line above the homepage headline. */
  promise: 'Tuck more money away with Tucker',
  tagline: 'See if you’re overspending on internet, mobile, TV, electricity and home security, and what you could pay instead.',
};

export const PLATFORM_META = {
  title: `${PLATFORM.name} | See If You’re Overspending on Household Bills`,
  description:
    'See if you’re overspending on internet, mobile, TV, electricity and home security. A free one-minute savings preview, no contact details needed. Results vary.',
};

/** Share image for Tucker's own pages (regional internet pages keep theirs). */
/** The one primary call to action, used in the header, the home page and the not-found page. */
export const PRIMARY_CTA = 'Explore my savings';

export const PLATFORM_OG_IMAGE = '/og-tucker.jpg';

/** Shown on the home page and published as FAQ structured data, so both always say the same thing. */
export const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: 'Is the savings figure a real offer?',
    a: 'No. It is a preliminary estimate: your bills compared with Tucker’s illustrative benchmarks. Real prices depend on what is available at your address, eligibility, current promotions, equipment or financing terms, taxes and fees. A representative confirms real options before you decide anything.',
  },
  {
    q: 'What are the benchmarks?',
    a: 'Comparison prices Tucker uses for every household: one each for home internet, mobile (per line, not counting phone payments), TV and streaming, and, for homeowners who ask, electricity with solar and home security monitoring. They are planning assumptions, not quotes from any provider.',
  },
  {
    q: 'Do I need to give my contact details to see my preview?',
    a: 'No. The preview appears as you type and nothing is sent anywhere. You only share contact details if you ask a representative to check real pricing for you.',
  },
  {
    q: 'How does the electricity and solar comparison work?',
    a: 'It is illustrative and shown for homeowners. What solar would really cost depends on your energy use, your roof, financing, the utility charges that remain and whether your home qualifies. Only a site assessment gives a real figure.',
  },
  {
    q: 'What happens if a benchmark is higher than what I pay now?',
    a: 'We show that plainly as a possible extra cost and leave it out of your savings total. Sometimes the bill you have is already a good one.',
  },
  {
    q: 'Does it cost anything, and do I have to switch?',
    a: 'The preview and the pricing review are free, and there is no obligation to switch. Tucker may receive compensation from providers.',
  },
];

/** National structured data for the homepage: the business and the website, with no location or provider. */
export function platformStructuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${siteUrl}/#org`, name: PLATFORM.name, legalName: PLATFORM.operator, url: `${siteUrl}/`, description: PLATFORM.descriptor },
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: PLATFORM.name, publisher: { '@id': `${siteUrl}/#org` } },
      { '@type': 'FAQPage', '@id': `${siteUrl}/#faq`, mainEntity: HOME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  };
}
