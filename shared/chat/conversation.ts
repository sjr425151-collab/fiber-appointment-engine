/**
 * What the assistant does next, decided by code: which question to ask, when
 * to show the savings card, when to offer a person. The same rules run with or
 * without an AI model; the model may only rephrase the wording.
 * All figures come from `quickPreview` (the same calculation as the form).
 */
import { formatCents } from '../finance/money';
import { quickPreview, type BenchmarkSet, type QuickPreview } from '../platform/benchmarks';
import { CHAT_SERVICES, type ChatBills, type ChatIntent, type ChatService } from './extract';

export const SERVICE_LABEL: Record<ChatService, string> = { internet: 'home internet', mobile: 'phone', tv: 'TV & streaming', electricity: 'electric', security: 'home security' };

export const QUICK_START = ['Internet', 'Phone', 'TV & Streaming', 'Electricity', 'Review all my bills'] as const;

export const WELCOME = 'Hey! I’m Tucker’s AI assistant. 👋\n\nI can show how your internet, phone, TV or electric bills compare with Tucker’s illustrative prices. What would you like to look at first?';

export type Step = 'start' | 'ask' | 'home' | 'extras' | 'preview' | 'handoff';

export interface ChatState {
  bills: ChatBills;
  /** The service the last question was about (so "about 110" lands in the right place). */
  askedAbout: ChatService | null;
  /** Services the customer wants to go through. */
  wanted: ChatService[];
  step: Step;
  previewShown: boolean;
}

export const NEW_STATE = (bills: ChatBills): ChatState => ({ bills, askedAbout: null, wanted: [], step: 'start', previewShown: false });

export interface Reply {
  text: string;
  quickReplies: string[];
  /** Show the savings card with these figures (computed, never written by a model). */
  preview: QuickPreview | null;
  /** Offer the "Talk to a Real Representative" handoff. */
  offerHuman: boolean;
}

export const previewFor = (b: ChatBills, set: BenchmarkSet): QuickPreview =>
  quickPreview({ internet: b.internet, mobile: b.mobile, mobileLines: b.mobileLines, tv: b.tv, electricity: b.electricity, security: b.security, ownsHome: !!b.ownsHome, showExtras: b.showExtras }, set);

const has = (b: ChatBills, s: ChatService) => b[s] !== null;
const settled = (b: ChatBills, s: ChatService) => has(b, s) || b.skipped.includes(s);
const QUESTION: Record<ChatService, string> = {
  internet: 'About how much do you pay each month for home internet?',
  mobile: 'About how much is your phone bill each month, and how many lines is that for? (Leave out phone payments.)',
  tv: 'About how much do you pay each month for TV or streaming?',
  electricity: 'About how much is your electric bill in a typical month?',
  security: 'About how much do you pay each month for home security monitoring?',
};

/** Decide the next reply. `intent` and `mentioned` come from the extraction of the customer's latest message. */
export function nextReply(state: ChatState, o: { intent: ChatIntent; mentioned: ChatService[]; changed: boolean }, set: BenchmarkSet): { state: ChatState; reply: Reply } {
  const s: ChatState = { ...state, bills: { ...state.bills }, wanted: [...state.wanted] };
  const b = s.bills;
  const done = (text: string, extra: Partial<Reply> = {}) => ({ state: s, reply: { text, quickReplies: [], preview: null, offerHuman: false, ...extra } });

  if (o.intent === 'wants_human') {
    s.step = 'handoff';
    return done('Of course. A real person on the Tucker Team can check what is actually available at your address. Tap below and leave a first name and phone number; nothing you told me needs repeating.', {
      offerHuman: true,
    });
  }
  if (o.intent === 'asks_final') {
    s.step = 'handoff';
    return done('That part needs a person: availability, eligibility, final pricing and ordering are confirmed by a Tucker representative, not by me. I can pass along everything you’ve told me.', {
      offerHuman: true,
      quickReplies: ['Keep comparing'],
    });
  }

  if (o.intent === 'review_all') s.wanted = [...CHAT_SERVICES.filter((x) => x !== 'security')];
  for (const m of o.mentioned) if (!s.wanted.includes(m)) s.wanted.push(m);
  for (const x of CHAT_SERVICES) if (has(b, x) && !s.wanted.includes(x)) s.wanted.push(x);

  // Solar and security are priced only for homeowners who ask.
  const wantsExtras = s.wanted.includes('electricity') || s.wanted.includes('security');
  const securityOpen = s.wanted.includes('security') && !settled(b, 'security');
  if (wantsExtras && b.ownsHome === null && (has(b, 'electricity') || has(b, 'security') || securityOpen)) {
    s.step = 'home';
    s.askedAbout = null;
    return done('Do you own your home or rent? Solar and home security comparisons are only for homeowners.', { quickReplies: ['I own my home', 'I rent'] });
  }
  if (wantsExtras && b.ownsHome && !b.showExtras && (s.step === 'home' || (securityOpen && o.mentioned.includes('security')))) {
    s.step = 'extras';
    return done('Would you like to see extra-service pricing for homeowners, solar and home security?', { quickReplies: ['Yes, show solar and security', 'No thanks'] });
  }

  // Next service still missing an amount.
  const missing = s.wanted.find((x) => !settled(b, x) && !(x === 'security' && !(b.ownsHome && b.showExtras)));
  if (missing) {
    s.step = 'ask';
    s.askedAbout = missing;
    if (missing === 'mobile' && b.mobile === null) return done(QUESTION.mobile, { quickReplies: ['Skip phone'] });
    return done(QUESTION[missing], { quickReplies: [`Skip ${SERVICE_LABEL[missing]}`] });
  }

  const preview = previewFor(b, set);
  if (!preview.rows.length) {
    s.step = 'start';
    s.askedAbout = null;
    return done('Which bill would you like to look at? You can also give me several at once, like “internet $110, phone $180 for 3 lines”.', { quickReplies: [...QUICK_START] });
  }

  s.step = 'preview';
  s.askedAbout = null;
  s.previewShown = true;
  const totalLine =
    preview.monthlySavings > 0
      ? `Here’s your illustrative comparison: about ${formatCents(preview.monthlySavings, { cents: false })} a month less, roughly ${formatCents(preview.annualSavings, { cents: false })} a year.`
      : 'Here’s your illustrative comparison. Against our benchmarks your bills already look competitive.';
  const higher = preview.monthlyHigher > 0 ? ' Where a benchmark is higher than what you pay, I show it as a possible extra cost and leave it out of the total.' : '';
  const others = CHAT_SERVICES.filter((x) => !s.wanted.includes(x) && x !== 'security');
  return done(`${totalLine}${higher} These are estimates, not offers: a representative confirms real prices for your address.`, {
    preview,
    offerHuman: true,
    quickReplies: others.length ? others.slice(0, 2).map((x) => `Add ${SERVICE_LABEL[x]}`) : ['Change an amount'],
  });
}

/** A short, factual summary for the representative, built from the data (not from the model). */
export function handoffSummary(b: ChatBills, preview: QuickPreview, intent: string): string {
  const parts = preview.rows.map(
    (r) =>
      `${SERVICE_LABEL[r.category as ChatService] ?? r.category} ${formatCents(r.current)}/mo${r.benchmark !== null ? ` vs ${formatCents(r.benchmark)}` : ''}${r.category === 'mobile' ? ` (${b.mobileLines} line${b.mobileLines === 1 ? '' : 's'})` : ''}`,
  );
  const total = preview.monthlySavings > 0 ? `Illustrative difference ${formatCents(preview.monthlySavings)}/mo (${formatCents(preview.annualSavings)}/yr), not verified.` : 'No illustrative savings against benchmarks.';
  const home = b.ownsHome === true ? `Homeowner${b.showExtras ? ', asked for solar/security pricing' : ''}.` : b.ownsHome === false ? 'Rents.' : '';
  return [`From the chat: ${parts.join('; ') || 'no bills given'}.`, total, home, intent ? `Asked for: ${intent}.` : ''].filter(Boolean).join(' ');
}
