/**
 * Business copy shared by the client and server. The consent text is stored
 * verbatim with every lead as a record of what the person agreed to, so bump
 * CONSENT_VERSION whenever the wording changes.
 */
export const BRAND = {
  agency: 'Spotlight Marketing LLC',
  provider: 'Omni Fiber',
  market: 'Monroe, Michigan',
  phoneDisplay: '', // TODO: add the team's public phone number
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
