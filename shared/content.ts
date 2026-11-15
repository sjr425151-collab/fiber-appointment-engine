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
  phoneDisplay: '(734) 731-1946',
  phoneE164: '+17347311946',
};

/** Official Omni Fiber resources. Coverage is authoritative only on Omni Fiber's own checker. */
export const OMNI_LINKS = {
  availability: 'https://www.omnifiber.com/',
  broadbandLabels: 'https://www.omnifiber.com/broadbandlabels/',
};

/**
 * FCC broadband consumer label disclosure. Labels are published by the ISP
 * (Omni Fiber) per plan; we link to them rather than reproducing their figures.
 */
export const BROADBAND_DISCLOSURE =
  `${BRAND.provider} is the internet service provider for all plans shown. As required by the FCC, ${BRAND.provider} publishes a ` +
  'Broadband Facts label for each plan with its monthly price, any one-time or recurring fees, typical download and upload ' +
  'speeds, typical latency and network-management practices. Review the label for your plan before ordering.'

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
    'Omni Fiber in Monroe, MI: 1 Gig for $50/mo or 2 Gig for $70/mo with free installation, free equipment and no contracts. Check your address and book a free consultation.',
};

/** Shown on the page AND emitted as FAQPage structured data — keep them identical. */
export const FAQ: { q: string; a: string }[] = [
  { q: 'Is the consultation really free?', a: 'Yes. There’s no cost and no obligation — it’s a conversation to confirm availability at your address and answer your questions.' },
  { q: 'How do I know if fiber is available at my house?', a: 'Coverage is confirmed address by address using Omni Fiber’s official availability checker. Enter your ZIP here for a quick read on your area and book a consultation — your specialist runs the official check for your exact address with you.' },
  { q: 'What are the plans and prices?', a: 'In Monroe, Omni Fiber offers 1 Gig for $50/mo and 2 Gig for $70/mo, with free installation, free equipment, no extra taxes or fees, and no contracts. Availability is confirmed for your exact address, and each plan’s official Broadband Facts label is published by Omni Fiber.' },
  { q: 'Is there a contract or installation fee?', a: 'No. There are no contracts, installation is free, and the equipment is included at no extra charge.' },
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
