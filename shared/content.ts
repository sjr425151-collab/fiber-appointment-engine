/**
 * Business copy shared by the client and server. The consent text is stored
 * verbatim with every lead as a record of what the person agreed to, so bump
 * CONSENT_VERSION whenever the wording changes.
 */
export const BRAND = {
  agency: 'Spotlight Marketing LLC',
  provider: 'Omni Fiber',
  market: 'Monroe, Michigan',
  /** Team phone. Click-to-call/text buttons appear only once both are set. */
  phoneDisplay: '', // e.g. '(734) 555-0100'
  phoneE164: '', // e.g. '+17345550100'
};

export const CONSENT_VERSION = '2026-11-15';

export const CONSENT_TEXT =
  `By checking this box, I agree that ${BRAND.agency}, on behalf of ${BRAND.provider}, may contact me at the ` +
  'phone number and email provided, including by calls and text messages that may use automated technology, ' +
  'about fiber internet service and my appointment. Consent is not a condition of purchase. Message and data ' +
  'rates may apply. Reply STOP to opt out of texts.';

/** Placeholder disclosure — confirm exact wording with Omni Fiber before launch. */
export const PARTNER_DISCLOSURE =
  `${BRAND.agency} is an independent marketing partner and is not ${BRAND.provider}. Service availability, ` +
  `pricing and installation are determined by ${BRAND.provider} and confirmed per address.`;

export const SITE = {
  name: 'Monroe Fiber Connect',
  title: 'Omni Fiber Internet in Monroe, MI — Check Availability & Book a Free Consultation',
  description:
    'See if Omni Fiber is available at your Monroe, Michigan address. Check your ZIP in seconds and book a free, no-obligation consultation with a local fiber specialist.',
};

/** Shown on the page AND emitted as FAQPage structured data — keep them identical. */
export const FAQ: { q: string; a: string }[] = [
  { q: 'Is the consultation really free?', a: 'Yes. There’s no cost and no obligation — it’s a conversation to confirm availability at your address and answer your questions.' },
  { q: 'How do I know if fiber is available at my house?', a: 'Availability is confirmed address by address. Enter your ZIP for a quick read on your area, then book a consultation for a definitive answer.' },
  { q: 'What are the plans and prices?', a: 'Plans and current offers are set by Omni Fiber and can vary by address. Your specialist will walk you through the options available to you — we never quote prices we can’t confirm.' },
  { q: 'What if my area isn’t ready yet?', a: 'Leave your details and you’ll be on the priority list. We’ll reach out as soon as service reaches your street.' },
  { q: 'Who will contact me, and how?', a: `A local specialist from ${BRAND.agency}, using the contact method you choose. You can opt out of texts at any time by replying STOP.` },
  { q: 'What do you do with my information?', a: 'We use it only to check service at your address and to contact you about fiber service and your appointment. We don’t sell your information. See our privacy notice for details.' },
];

export function structuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${siteUrl}/#org`, name: BRAND.agency, url: `${siteUrl}/` },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: SITE.name,
        publisher: { '@id': `${siteUrl}/#org` },
        inLanguage: 'en-US',
      },
      {
        '@type': 'Service',
        name: 'Free fiber internet availability consultation',
        serviceType: 'Fiber internet sales consultation',
        provider: { '@id': `${siteUrl}/#org` },
        areaServed: { '@type': 'City', name: 'Monroe', containedInPlace: { '@type': 'State', name: 'Michigan' } },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free, no-obligation consultation' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  };
}
