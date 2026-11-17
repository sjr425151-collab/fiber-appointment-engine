/**
 * Reads household bills out of a chat message without any AI: amounts, the
 * service each one belongs to, mobile lines, homeownership and intent.
 * Deterministic and safe on any input; the AI path, when configured, only adds
 * understanding on top and is validated against the same shape.
 */
import type { Cents } from '../finance/money';

export const CHAT_SERVICES = ['internet', 'mobile', 'tv', 'electricity', 'security'] as const;
export type ChatService = (typeof CHAT_SERVICES)[number];

export interface ChatBills {
  internet: Cents | null;
  mobile: Cents | null;
  mobileLines: number;
  tv: Cents | null;
  electricity: Cents | null;
  security: Cents | null;
  /** null = not asked or not answered yet. */
  ownsHome: boolean | null;
  /** Asked to see solar and home security pricing (counts only for homeowners). */
  showExtras: boolean;
  /** Services the customer said to leave out. */
  skipped: ChatService[];
}

export const EMPTY_BILLS: ChatBills = { internet: null, mobile: null, mobileLines: 1, tv: null, electricity: null, security: null, ownsHome: null, showExtras: false, skipped: [] };

export type ChatIntent = 'none' | 'wants_human' | 'asks_final' | 'review_all' | 'restart';

export interface Extraction {
  amounts: Partial<Record<ChatService, Cents>>;
  mobileLines?: number;
  ownsHome?: boolean;
  showExtras?: boolean;
  skip: ChatService[];
  /** A lone amount with no service named (for example "about 110"). */
  bareAmount?: Cents;
  /** Services named without an amount ("I want to look at my phone bill"). */
  mentioned: ChatService[];
  intent: ChatIntent;
  yes: boolean;
  no: boolean;
}

const KEYWORDS: [ChatService, RegExp][] = [
  ['internet', /\b(internet|wi-?fi|wifi|broadband|spectrum|xfinity|comcast|cox|optimum|frontier|fiber|centurylink|starlink|modem|router)\b/],
  ['mobile', /\b(phones?|mobile|cell(?:ular)?|wireless|lines?|verizon|t-?mobile|at&t|att|cricket|metro|visible|mint|boost|tracfone)\b/],
  ['tv', /\b(tv|television|cable|directv|direct tv|dish|youtube tv|sling|hulu|streaming|netflix|fubo)\b/],
  ['electricity', /\b(electric(?:ity)?|power|utility|energy|dte|consumers|duke|pg&e|edison|kwh|solar)\b/],
  ['security', /\b(security|alarm|adt|vivint|simplisafe|ring alarm|brinks|monitoring|cameras?)\b/],
];
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const MAX_CENTS = 1_000_000; // $10,000 a month

/** Dollar amounts in text: "$110", "110 dollars", "$1,200.50", "110/mo". Never phone numbers or years. */
function amountsIn(text: string): { cents: Cents; index: number }[] {
  const out: { cents: Cents; index: number }[] = [];
  const re = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d{1,5})(\.\d{1,2})?(\s?(?:dollars|bucks|usd|\/\s?mo(?:nth)?|a month|per month|monthly|\/month))?/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [, dollarSign, whole, decimals, unit] = m;
    const value = Number(whole.replace(/,/g, '') + (decimals ?? ''));
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    // A number followed by "line(s)" is a line count, not money.
    if (!dollarSign && !unit && /^\s*(lines?|phones?)\b/i.test(after)) continue;
    // Bare numbers only count when they look like a monthly bill.
    if (!dollarSign && !unit && !decimals && (value < 5 || value > 3000)) continue;
    const cents = Math.round(value * 100);
    if (cents > 0 && cents <= MAX_CENTS) out.push({ cents, index: m.index });
  }
  return out;
}

const servicesIn = (text: string): ChatService[] => KEYWORDS.filter(([, re]) => re.test(text)).map(([s]) => s);

export function extract(raw: string): Extraction {
  // Phone numbers and ZIP-like codes are never bills.
  const text = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, ' ')
    .trim();
  const result: Extraction = { amounts: {}, skip: [], mentioned: [], intent: 'none', yes: false, no: false };

  // Split into clauses so "$110 for Spectrum and $180 for three lines" pairs each amount with its own service.
  const clauses = text.split(/\s*(?:,(?!\d{3}\b)|;|\band\b|\bplus\b|\balso\b|\.(?!\d))\s*/).filter(Boolean);
  let lastService: ChatService | null = null;
  for (const clause of clauses) {
    const services = servicesIn(clause);
    const amounts = amountsIn(clause);
    if (services.length) lastService = services[0];
    if (amounts.length && services.length) {
      // Several services and amounts in one clause: pair them in order.
      services.forEach((s, i) => {
        const a = amounts[Math.min(i, amounts.length - 1)];
        if (result.amounts[s] === undefined) result.amounts[s] = a.cents;
      });
    } else if (amounts.length && lastService && clauses.length > 1) {
      if (result.amounts[lastService] === undefined) result.amounts[lastService] = amounts[0].cents;
    } else if (amounts.length && !services.length && result.bareAmount === undefined) {
      result.bareAmount = amounts[0].cents;
    }
    for (const s of services) if (!result.mentioned.includes(s)) result.mentioned.push(s);
  }

  const lines = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:phone\s+)?lines?\b/.exec(text);
  if (lines) {
    const n = NUMBER_WORDS[lines[1]] ?? Number(lines[1]);
    if (n >= 1 && n <= 10) result.mobileLines = n;
  }
  if (/\b(i|we) (own|bought)\b|\bhomeowners?\b|\bown (my|our|the) (home|house)\b|\bi own\b/.test(text)) result.ownsHome = true;
  if (/\b(i|we) rent\b|\brent(ing)?\b|\brenter\b|\bapartment\b|\blandlord\b/.test(text) && !result.ownsHome) result.ownsHome = false;
  if (/\b(show|see|include|compare)\b.*\b(solar|security|extra)\b/.test(text)) result.showExtras = true;

  for (const [s, re] of KEYWORDS) {
    if (new RegExp(`\\b(skip|no|don'?t have|not|without|none for)\\b[^.]{0,20}${re.source}`).test(text)) result.skip.push(s);
  }

  result.yes = /^(yes|yeah|yep|sure|ok(ay)?|please|y|sounds good|go ahead|do it)\b/.test(text);
  result.no = /^(no|nope|nah|not now|no thanks|n)\b/.test(text);
  if (/\b(real |live )?(person|human|agent|rep|representative|someone|somebody|advisor)\b|\bcall me\b|\btext me\b|\bcallback\b|\bspeak to\b|\btalk to\b/.test(text)) result.intent = 'wants_human';
  else if (/\b(sign me up|order|switch me|buy|purchase|install(ation)?|available at my|availability|exact price|final price|qualify|eligible|contract|credit check)\b/.test(text)) result.intent = 'asks_final';
  else if (/\b(all (my|of my|the) bills|everything|all of them|review all|all four|all services)\b/.test(text)) result.intent = 'review_all';
  else if (/\b(start over|reset|restart|clear)\b/.test(text)) result.intent = 'restart';
  return result;
}

/** Applies an extraction to the bills so far. A bare amount fills the service the assistant last asked about. */
export function applyExtraction(bills: ChatBills, e: Extraction, askedAbout: ChatService | null, step?: string): ChatBills {
  const next: ChatBills = { ...bills, skipped: [...bills.skipped] };
  // A plain yes or no to “see solar and home security pricing?”. Declining means security is not asked about again.
  if (step === 'extras' && e.yes) next.showExtras = true;
  if (step === 'extras' && e.no && !e.showExtras && !next.skipped.includes('security')) next.skipped.push('security');
  for (const s of CHAT_SERVICES) {
    const v = e.amounts[s];
    if (v !== undefined) {
      next[s] = v;
      next.skipped = next.skipped.filter((x) => x !== s);
    }
  }
  if (e.bareAmount !== undefined && askedAbout && e.amounts[askedAbout] === undefined) {
    next[askedAbout] = e.bareAmount;
    next.skipped = next.skipped.filter((x) => x !== askedAbout);
  }
  if (e.mobileLines) next.mobileLines = e.mobileLines;
  if (e.ownsHome !== undefined) next.ownsHome = e.ownsHome;
  if (e.showExtras) next.showExtras = true;
  for (const s of e.skip) {
    if (e.amounts[s] === undefined) {
      next[s] = null;
      if (!next.skipped.includes(s)) next.skipped.push(s);
    }
  }
  return next;
}
