/**
 * Website chat API (mounted under /api/platform/chat).
 *
 * Every customer message goes through the same steps:
 *  1. the rule-based reader extracts bills and intent (always);
 *  2. if an AI key is configured, Claude reads the message too, and its
 *     validated fields are merged in;
 *  3. code decides the next step and computes any figures with the same
 *     benchmark calculation as the form;
 *  4. the reply is the code's text, or the model's rewording when it is safe.
 * A session is readable only with the token returned when it was created.
 */
import type express from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { BRAND } from '../shared/content';
import { handoffSummary, nextReply, NEW_STATE, previewFor, QUICK_START, WELCOME, type ChatState, type Reply } from '../shared/chat/conversation';
import { applyExtraction, CHAT_SERVICES, EMPTY_BILLS, extract, type ChatBills, type Extraction } from '../shared/chat/extract';
import type { BenchmarkSet } from '../shared/platform/benchmarks';
import { BENCHMARK_DISCLOSURE } from '../shared/platform/benchmarks';
import { handoffContactShape, type Handoff, type HandoffResult } from '../shared/platform/handoff';
import { leadInputSchema } from '../shared/schemas';
import { ChatModel, modelOutputSchema, safeReply, type ChatTurner } from './ai/chatModel';
import type { AppConfig } from './config';
import type { DB } from './db';
import { newToken, safeEqual, sha256 } from './lib/auth';
import * as repo from './repo';
import * as chats from './repo-chat';

z.config({ jitless: true });

/** Messages a visitor can send in one chat before being pointed to a person or the form. */
export const MAX_USER_MESSAGES = 40;

export interface ChatDeps {
  db: DB;
  config: AppConfig;
  limiter: (limit: number) => RequestHandler;
  parse: <T extends z.ZodType>(schema: T, data: unknown) => z.output<T>;
  handoffLead: (h: Handoff, req: express.Request, o: { source: 'platform_handoff' | 'platform_chat'; from: 'home' | 'chat'; note: string; onCreated?: (leadId: string) => void }) => HandoffResult;
  benchmarks: () => BenchmarkSet;
  /** Overrides the model built from config (tests). null turns the AI off. */
  model?: ChatTurner | null;
}

class ChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const token = z.string().min(16).max(128);
const startSchema = z.object({
  landingPage: z.string().trim().max(300).optional().default(''),
  utmSource: z.string().trim().max(100).optional().default(''),
  utmCampaign: z.string().trim().max(100).optional().default(''),
});
const messageSchema = z.object({ t: token, text: z.string().trim().min(1, 'Type a message').max(800, 'Please keep messages under 800 characters'), clientId: z.string().uuid() });
const cents = z.number().int().min(0).max(1_000_000).nullable();
const billsSchema = z.object({
  t: token,
  bills: z.object({ internet: cents, mobile: cents, mobileLines: z.number().int().min(1).max(10), tv: cents, electricity: cents, security: cents, ownsHome: z.boolean().nullable(), showExtras: z.boolean() }).partial(),
});
const chatHandoffSchema = z
  .object({ t: token, zip: leadInputSchema.shape.zip, website: z.string().optional().default(''), sessionId: z.string().trim().max(64).optional().default('') })
  .extend(handoffContactShape)
  .refine((v) => v.preferredContact !== 'email' || v.email !== '', { path: ['email'], message: 'Add an email address, or choose phone or text' });

export interface ChatMessageOut {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  card: { preview?: ReturnType<typeof previewFor> | null; disclosure?: string; quickReplies?: string[]; offerHuman?: boolean } | null;
  createdAt: string;
}
const out = (m: chats.ChatMessageRow): ChatMessageOut => ({ id: m.id, role: m.role, body: m.body, card: m.card as ChatMessageOut['card'], createdAt: m.createdAt });

/** Merge what the model understood (dollars) into an extraction (cents). Only values it actually returned. */
function mergeModel(e: Extraction, u: { [k: string]: number | boolean | null }): Extraction {
  const merged: Extraction = { ...e, amounts: { ...e.amounts }, mentioned: [...e.mentioned] };
  for (const s of CHAT_SERVICES) {
    const v = u[s];
    if (typeof v === 'number' && merged.amounts[s] === undefined) {
      merged.amounts[s] = Math.round(v * 100);
      if (!merged.mentioned.includes(s)) merged.mentioned.push(s);
    }
  }
  if (typeof u.mobileLines === 'number' && merged.mobileLines === undefined) merged.mobileLines = u.mobileLines;
  if (typeof u.ownsHome === 'boolean' && merged.ownsHome === undefined) merged.ownsHome = u.ownsHome;
  if (u.wantsExtraPricing === true) merged.showExtras = true;
  return merged;
}

export function chatRoutes(r: express.Router, d: ChatDeps) {
  const { db, config } = d;
  const model: ChatTurner | null = d.model !== undefined ? d.model : config.chat?.apiKey ? new ChatModel({ apiKey: config.chat.apiKey, model: config.chat.model, timeoutMs: config.chat.timeoutMs }) : null;

  const session = (id: string, t: unknown) => {
    const s = chats.getSession(db, id);
    if (!s || typeof t !== 'string' || !safeEqual(s.tokenHash, sha256(t))) throw new ChatError(404, 'This chat has ended. Start a new one.');
    return s;
  };
  const say = (sessionId: string, reply: Reply, source: string) => {
    const card = { quickReplies: reply.quickReplies, offerHuman: reply.offerHuman, ...(reply.preview ? { preview: reply.preview, disclosure: BENCHMARK_DISCLOSURE } : {}) };
    chats.addMessage(db, { sessionId, role: 'assistant', body: reply.text, card, source });
  };
  const send = (res: express.Response, status: number, sessionId: string, extra: Record<string, unknown> = {}) => {
    const s = chats.getSession(db, sessionId)!;
    res
      .status(status)
      .set('Cache-Control', 'no-store')
      .json({ id: s.id, state: { bills: s.state.bills, step: s.state.step }, status: s.status, handedOff: !!s.leadId, ai: !!model, messages: chats.listMessages(db, s.id).map(out), ...extra });
  };
  const wrap =
    (fn: (req: express.Request, res: express.Response) => Promise<void> | void): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof ChatError) res.status(err.status).json({ error: err.message });
        else next(err);
      }
    };

  // Start a chat. No contact details are asked for.
  r.post(
    '/chat/sessions',
    d.limiter(20),
    wrap((req, res) => {
      const b = d.parse(startSchema, req.body ?? {});
      const t = newToken();
      const id = chats.createSession(db, { tokenHash: sha256(t), state: NEW_STATE({ ...EMPTY_BILLS }), landingPage: b.landingPage, utmSource: b.utmSource, utmCampaign: b.utmCampaign });
      chats.addMessage(db, { sessionId: id, role: 'assistant', body: WELCOME, card: { quickReplies: [...QUICK_START], offerHuman: false }, source: 'rules' });
      repo.insertEvent(db, { name: 'chat_open', sessionId: '', path: b.landingPage, props: {}, utmSource: b.utmSource, utmCampaign: b.utmCampaign, marketId: '' });
      send(res, 201, id, { token: t });
    }),
  );

  // Resume a chat (after reopening, navigating or a dropped connection).
  r.get(
    '/chat/sessions/:id',
    wrap((req, res) => {
      const s = session(String(req.params.id), req.query.t);
      send(res, 200, s.id);
    }),
  );

  // A customer message. Safe to send twice: the same clientId is stored and answered once.
  r.post(
    '/chat/sessions/:id/messages',
    d.limiter(60),
    wrap(async (req, res) => {
      const b = d.parse(messageSchema, req.body);
      const s = session(String(req.params.id), b.t);
      if (!chats.addMessage(db, { sessionId: s.id, role: 'user', body: b.text, clientId: b.clientId })) {
        // A retry of a message we already answered: return the conversation as it is.
        send(res, 200, s.id, { repeat: true });
        return;
      }
      chats.countUserMessage(db, s.id);
      if (s.userMessages + 1 > MAX_USER_MESSAGES) {
        say(
          s.id,
          { text: 'This chat has reached its length limit. A representative can pick it up from here, or you can use the savings form on the home page.', quickReplies: [], preview: null, offerHuman: true },
          'rules',
        );
        send(res, 201, s.id);
        return;
      }

      const set = d.benchmarks();
      let e = extract(b.text);
      // The rules decide the plan first; the model (if any) may refine understanding and wording.
      let plan = nextReply({ ...s.state, bills: applyExtraction(s.state.bills, e, s.state.askedAbout, s.state.step) }, { intent: e.intent, mentioned: e.mentioned, changed: true }, set);
      let source = 'rules';
      let text = plan.reply.text;
      if (model) {
        const started = Date.now();
        try {
          const history = chats
            .listMessages(db, s.id)
            .slice(0, -1)
            .map((m) => ({ role: m.role, text: m.body }));
          const { output: raw, inputTokens, outputTokens } = await model.turn({ history, known: { ...s.state.bills, skipped: undefined }, plan: plan.reply.text, message: b.text });
          // Validated again here, whatever produced it: anything out of range is a failed call.
          const output = modelOutputSchema.parse(raw);
          chats.recordAi(db, s.id, { ok: true, inputTokens, outputTokens, ms: Date.now() - started });
          const merged = mergeModel(e, output.understood);
          const intent = e.intent !== 'none' ? e.intent : output.intent === 'off_topic' ? 'none' : output.intent;
          if (JSON.stringify(merged) !== JSON.stringify(e) || intent !== e.intent) {
            e = { ...merged, intent };
            plan = nextReply({ ...s.state, bills: applyExtraction(s.state.bills, e, s.state.askedAbout, s.state.step) }, { intent: e.intent, mentioned: e.mentioned, changed: true }, set);
          }
          // The model's wording carries the plan; if it contains figures or anything odd, the rule text is used.
          text = safeReply(output.reply, plan.reply.text);
          source = text === plan.reply.text ? 'rules' : 'ai';
          if (plan.reply.preview) text = plan.reply.text; // a summary of figures is always the code's own words
        } catch (err) {
          chats.recordAi(db, s.id, { ok: false, inputTokens: 0, outputTokens: 0, ms: Date.now() - started });
          console.error(JSON.stringify({ level: 'warn', msg: 'chat model unavailable; using rules', error: err instanceof Error ? err.name : 'unknown' }));
          text = plan.reply.text;
        }
      }
      if (e.intent === 'restart')
        plan = { state: NEW_STATE({ ...EMPTY_BILLS }), reply: { text: 'Starting fresh. Which bill would you like to look at first?', quickReplies: [...QUICK_START], preview: null, offerHuman: false } };

      const firstPreview = !!plan.reply.preview && !s.state.previewShown;
      chats.saveState(db, s.id, plan.state, plan.reply.preview ? 'previewed' : undefined);
      say(s.id, { ...plan.reply, text: e.intent === 'restart' ? plan.reply.text : text }, source);
      if (firstPreview)
        repo.insertEvent(db, { name: 'chat_preview', sessionId: '', path: s.landingPage, props: { services: plan.reply.preview!.rows.length }, utmSource: s.utmSource, utmCampaign: s.utmCampaign, marketId: '' });
      send(res, 201, s.id);
    }),
  );

  // The customer edited an amount on the savings card: recompute with the same calculation.
  r.post(
    '/chat/sessions/:id/bills',
    d.limiter(60),
    wrap((req, res) => {
      const b = d.parse(billsSchema, req.body);
      const s = session(String(req.params.id), b.t);
      const bills: ChatBills = { ...s.state.bills, ...b.bills };
      const set = d.benchmarks();
      const preview = previewFor(bills, set);
      const state: ChatState = { ...s.state, bills, previewShown: true, step: 'preview' };
      chats.saveState(db, s.id, state, preview.rows.length ? 'previewed' : undefined);
      say(s.id, { text: 'Updated with your changes.', quickReplies: [], preview, offerHuman: true }, 'rules');
      send(res, 201, s.id);
    }),
  );

  // "Talk to a Real Representative": first name, phone, ZIP and consent. Everything from the chat goes with it.
  r.post(
    '/chat/sessions/:id/handoff',
    d.limiter(10),
    wrap((req, res) => {
      const b = d.parse(chatHandoffSchema, req.body);
      const s = session(String(req.params.id), b.t);
      if (b.website) {
        send(res, 201, s.id, { handoff: { leadId: crypto.randomUUID(), repeat: false, routing: { outcome: 'queued', representative: null } } });
        return;
      }
      const bills = s.state.bills;
      const h: Handoff = {
        firstName: b.firstName,
        lastName: b.lastName,
        phone: b.phone,
        email: b.email,
        preferredContact: b.preferredContact,
        bestTime: b.bestTime,
        street: b.street,
        consent: b.consent,
        marketingConsent: b.marketingConsent,
        requestKey: b.requestKey,
        zip: b.zip,
        bills: { internet: bills.internet, mobile: bills.mobile, tv: bills.tv, electricity: bills.electricity, security: bills.security },
        mobileLines: bills.mobileLines,
        ownsHome: !!bills.ownsHome,
        showExtras: bills.showExtras,
        utmSource: s.utmSource,
        utmMedium: '',
        utmCampaign: s.utmCampaign,
        utmContent: '',
        utmTerm: '',
        clickId: '',
        referrer: '',
        landingPage: s.landingPage,
        sessionId: b.sessionId,
        website: '',
      };
      const preview = previewFor(bills, d.benchmarks());
      const transcript = chats.listMessages(db, s.id);
      const lastAsk = [...transcript].reverse().find((m) => m.role === 'user')?.body ?? '';
      const result = d.handoffLead(h, req, {
        source: 'platform_chat',
        from: 'chat',
        note: `${handoffSummary(bills, preview, lastAsk.slice(0, 200))} The full chat is on this lead. Figures are a preliminary benchmark comparison, not verified pricing.`,
        onCreated: (leadId) => chats.linkLead(db, s.id, leadId),
      });
      if (!result.repeat) {
        say(
          s.id,
          {
            text: `Thanks${b.firstName ? `, ${b.firstName}` : ''}. Your request is with the ${BRAND.name} Team (${BRAND.agency}). A representative will contact you by ${b.preferredContact === 'text' ? 'text' : b.preferredContact === 'email' ? 'email' : 'phone'} to check real prices for your address. I’m an AI assistant; no representative has joined this chat.`,
            quickReplies: [],
            preview: null,
            offerHuman: false,
          },
          'rules',
        );
        repo.insertEvent(db, {
          name: 'chat_handoff_submit',
          sessionId: '',
          path: s.landingPage,
          props: { services: preview.rows.length, routed: result.routing.outcome },
          utmSource: s.utmSource,
          utmCampaign: s.utmCampaign,
          marketId: '',
        });
      }
      send(res, 201, s.id, { handoff: { leadId: result.leadId, repeat: result.repeat, routing: result.routing } });
    }),
  );
}
