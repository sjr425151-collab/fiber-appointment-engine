/**
 * Business copy shared by the client and server. Location-specific wording is
 * generated from the market so every city reads correctly. The consent text is
 * stored verbatim with every lead as a record of what the person agreed to, so
 * bump CONSENT_VERSION whenever the wording changes.
 */
import type { Market } from './market';
import { listJoin, plansFrom } from './market-utils';

export const BRAND = {
  /** Public site name (multi-location brand). */
  name: 'Fiber Connect',
  /** Legal operator of the site and the contacting party. */
  agency: 'Spotlight Marketing LLC',
};

export const CONSENT_VERSION = '2026-11-15';

type M = Pick<Market, 'name' | 'state' | 'provider' | 'plans' | 'region'>;

export const place = (m: Pick<Market, 'name' | 'state'>) => `${m.name}, ${m.state}`;

/** "Omni Fiber Internet" / "Acme Fiber Internet" — never "Fiber Fiber". */
export const serviceName = (m: Pick<Market, 'provider'>) => (/fiber/i.test(m.provider) ? `${m.provider} Internet` : `${m.provider} Fiber Internet`);

export function consentText(m: Pick<Market, 'provider'>) {
  return (
    `By checking this box, I agree that ${BRAND.agency}, on behalf of ${m.provider}, may contact me at the ` +
    'phone number and email provided, including by calls and text messages that may use automated technology, ' +
    'about fiber internet service and my appointment. Consent is not a condition of purchase. Message and data ' +
    'rates may apply. Reply STOP to opt out of texts.'
  );
}

/** Confirm exact wording with each provider before launching a market. */
export function partnerDisclosure(m: Pick<Market, 'provider'>) {
  return (
    `${BRAND.name} is operated by ${BRAND.agency}, an independent marketing partner, and is not ${m.provider}. ` +
    `Service availability, pricing and installation are determined by ${m.provider} and confirmed per address.`
  );
}

/** FCC broadband consumer label disclosure. Labels are published by the ISP per plan. */
export function broadbandDisclosure(m: Pick<Market, 'provider'>) {
  return (
    `${m.provider} is the internet service provider for all plans shown. As required by the FCC, ${m.provider} publishes a ` +
    'Broadband Facts label for each plan with its monthly price, any one-time or recurring fees, typical download and upload ' +
    'speeds, typical latency and network-management practices. Review the label for your plan before ordering.'
  );
}

export function siteMeta(m: M) {
  const from = plansFrom(m);
  const title = `${serviceName(m)} in ${place(m)} — Check Availability & Book a Free Consultation`;
  const pricing = from ? `${listJoin(m.plans.map((p) => `${p.name} for ${p.price}`), 'or')}. ` : '';
  const description = `${m.provider} in ${place(m)}: ${pricing}Check your address and book a free, no-obligation consultation with a local fiber specialist.`;
  return { title, description: description.slice(0, 300) };
}

/** Shown on the page AND emitted as FAQPage structured data — keep them identical. */
export function faq(m: M): { q: string; a: string }[] {
  const plans = m.plans.length
    ? `In ${m.name}, ${m.provider} offers ${listJoin(m.plans.map((p) => `${p.name} for ${p.price}`))}` +
      (m.plans[0].highlights.length ? `, with ${listJoin(m.plans[0].highlights.map((h) => h.toLowerCase()))}` : '') +
      `. Availability is confirmed for your exact address, and each plan’s official Broadband Facts label is published by ${m.provider}.`
    : `Plans and current offers are set by ${m.provider} and can vary by address. Your specialist will walk you through the options available to you.`;
  return [
    { q: 'Is the consultation really free?', a: 'Yes. There’s no cost and no obligation — it’s a conversation to confirm availability at your address and answer your questions.' },
    { q: 'How do I know if fiber is available at my house?', a: `Coverage is confirmed address by address using ${m.provider}’s official availability checker. Enter your ZIP here for a quick read on your area and book a consultation — your specialist runs the official check for your exact address with you.` },
    { q: 'What are the plans and prices?', a: plans },
    ...(m.plans.some((p) => p.highlights.some((h) => /contract/i.test(h)))
      ? [{ q: 'Is there a contract or installation fee?', a: 'No. There are no contracts, installation is free, and the equipment is included at no extra charge.' }]
      : []),
    { q: 'What if my area isn’t ready yet?', a: 'Leave your details and you’ll be on the priority list. We’ll reach out as soon as service reaches your street.' },
    { q: 'Who will contact me, and how?', a: `A local specialist from ${BRAND.agency}, using the contact method you choose. You can opt out of texts at any time by replying STOP.` },
    { q: 'What do you do with my information?', a: 'We use it only to check service at your address and to contact you about fiber service and your appointment. We don’t sell your information. See our privacy notice for details.' },
  ];
}

export function structuredData(siteUrl: string, m: M, pageUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${siteUrl}/#org`, name: BRAND.agency, alternateName: BRAND.name, url: `${siteUrl}/` },
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: BRAND.name, publisher: { '@id': `${siteUrl}/#org` }, inLanguage: 'en-US' },
      {
        '@type': 'Service',
        name: `Free fiber internet availability consultation — ${place(m)}`,
        serviceType: 'Fiber internet sales consultation',
        url: pageUrl,
        provider: { '@id': `${siteUrl}/#org` },
        areaServed: { '@type': 'City', name: m.name, containedInPlace: { '@type': 'State', name: m.state } },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free, no-obligation consultation' },
      },
      { '@type': 'FAQPage', mainEntity: faq(m).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  };
}
