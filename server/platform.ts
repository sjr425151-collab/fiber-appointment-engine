/**
 * Household savings API (mounted at /api/platform). Assessments contain no contact details; results are only
 * readable with the random token returned at submission (stored hashed).
 */
import { createHmac } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { PLATFORM_CONSENT_VERSION, platformConsentText } from '../shared/content';
import { assessmentSchema, submissionSchema, type PlatformCategory } from '../shared/platform/assessment';
import { buildAnalysis, type AreaCatalog, type PlatformAnalysis } from '../shared/platform/analysis';
import {
  assessmentFromBills,
  billCategories,
  contactSchema,
  HANDOFF_CONSENT_VERSION,
  handoffConsentText,
  handoffSchema,
  MARKETING_CONSENT_VERSION,
  marketingConsentText,
  previewFromBills,
  previewFromOpportunities,
  type Handoff,
  type HandoffResult,
} from '../shared/platform/handoff';
import { chatRoutes } from './chat';
import type { ChatTurner } from './ai/chatModel';
import { opportunitiesFrom } from '../shared/platform/opportunity';
import { ROUTING_REASON, routeLead } from '../shared/platform/routing';
import type { AppConfig } from './config';
import type { DB } from './db';
import { newToken, safeEqual, sha256 } from './lib/auth';
import type { Notifier } from './notify';
import * as repo from './repo';

export class PlatformError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    throw new PlatformError(400, 'Please check the highlighted fields.', fields);
  }
  return r.data;
}

/** Potential monthly savings with the selected options (steady state, flat scenario). */
const potentialSavings = (a: PlatformAnalysis) => a.opportunities.reduce((s, o) => s + o.monthlySavings, 0);

export function platformRouter(config: AppConfig, db: DB, notifier: Notifier, chatModel?: ChatTurner | null) {
  /**
   * Previews are national: every household is compared with the current
   * benchmark set, whatever its ZIP. No location or service-area record is
   * consulted, so nothing geographic can block a preview.
   */
  const NATIONAL: AreaCatalog = { internet: [] };
  const benchmarks = () => repo.currentBenchmarks(db);
  /** The one internal record that holds the organisation's calendar and alert settings (every lead is filed under it). */
  const home = () => repo.getDefaultMarket(db);
  const r = express.Router();
  const isTest = process.env.NODE_ENV === 'test';
  const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => isTest });

  /** Load an assessment only with a valid token; identical 404 for "missing" and "wrong token". */
  const authorized = (id: string, token: unknown) => {
    const hash = typeof token === 'string' && token.length >= 16 ? repo.getAssessmentTokenHash(db, id) : null;
    if (!hash || !safeEqual(hash, sha256(token as string))) throw new PlatformError(404, 'Results not found.');
    return repo.getAssessment(db, id)!;
  };

  /**
   * Tokens for a submitted form are derived from its request key, so a retry of
   * the same form gets the same tokens back instead of a second lead.
   */
  const tokenFor = (purpose: string, requestKey: string | undefined) =>
    requestKey ? createHmac('sha256', config.sessionSecret).update(`${purpose}:${requestKey}`).digest('base64url') : newToken();

  const routingOf = (leadId: string): HandoffResult['routing'] => {
    const lead = repo.getLead(db, leadId)!;
    const rep = lead.assignedRepId ? repo.getRep(db, lead.assignedRepId) : null;
    const outcome = lead.routingOutcome === 'assigned' || lead.routingOutcome === 'unsupported' ? lead.routingOutcome : 'queued';
    // First name only: enough to tell the customer who will be in touch.
    // Who is assigned is internal: customers are only told the Tucker Team has their request.
    return { outcome: rep ? 'assigned' : outcome === 'assigned' ? 'queued' : outcome, representative: null };
  };

  /** Decide who gets a new lead, record why, and report the outcome. Deterministic (shared/platform/routing.ts). */
  function route(leadId: string, o: { marketId: string | null; categories: PlatformCategory[]; phone: string; sessionId: string; utmSource: string; utmCampaign: string; path: string }) {
    const decision = routeLead({ marketId: o.marketId, categories: o.categories, existingOwnerId: repo.openLeadOwner(db, o.phone, leadId) }, repo.listReps(db));
    const repId = decision.outcome === 'assigned' ? decision.repId : null;
    repo.assignLead(db, leadId, repId, { outcome: decision.outcome, reason: ROUTING_REASON[decision.reason], actor: 'routing' });
    if (repId) {
      repo.insertEvent(db, { name: 'rep_assigned', sessionId: o.sessionId, path: o.path, props: { reason: decision.reason }, utmSource: o.utmSource, utmCampaign: o.utmCampaign, marketId: o.marketId ?? '' });
    }
    return routingOf(leadId);
  }

  r.post('/assessments', limiter(30), (req, res) => {
    const sub = parse(submissionSchema, req.body);
    const assessment = parse(assessmentSchema, sub.assessment);
    const computedAt = new Date().toISOString();
    const set = benchmarks();
    const analysis = buildAnalysis(assessment, { includeSamples: config.flags.sampleData, computedAt, catalog: NATIONAL, benchmarks: { version: set.version, internetMonthly: set.internetMonthly, mobilePerLine: set.mobilePerLine, tvMonthly: set.tvMonthly, electricityWithSolarMonthly: set.electricityWithSolarMonthly, securityMonthly: set.securityMonthly } });
    const token = newToken();
    const id = repo.insertAssessment(db, {
      tokenHash: sha256(token),
      zip: assessment.zip,
      marketId: '',
      categories: assessment.categories,
      answers: assessment,
      analysis,
      analysisVersion: analysis.version,
      assumptionsVersion: analysis.assumptionsVersion,
      includeSamples: analysis.includeSamples,
      status: analysis.status,
      currentMonthlyCents: analysis.household?.currentMonthly ?? null,
      potentialSavingsCents: potentialSavings(analysis),
      projectionBasis: analysis.projectionBasis,
      sessionId: sub.sessionId,
      utmSource: sub.utmSource,
      utmCampaign: sub.utmCampaign,
      landingPage: sub.landingPage,
      referrer: sub.referrer,
    });
    repo.insertEvent(db, {
      name: 'assessment_complete',
      sessionId: sub.sessionId,
      path: sub.landingPage,
      props: { status: analysis.status, categories: assessment.categories.length, basis: analysis.projectionBasis },
      utmSource: sub.utmSource,
      utmCampaign: sub.utmCampaign,
      marketId: '',
    });
    res.status(201).json({ id, token, analysis, assessment });
  });

  r.get('/assessments/:id', (req, res) => {
    const a = authorized(String(req.params.id), req.query.t);
    res.set('Cache-Control', 'no-store').json({ id: a.id, assessment: a.answers, analysis: a.analysis, contacted: !!a.leadId });
  });

  r.post('/assessments/:id/contact', limiter(10), (req, res) => {
    const input = parse(contactSchema, req.body);
    const a = authorized(String(req.params.id), input.token);
    const assessment = assessmentSchema.parse(a.answers);
    if (input.website) {
      // Honeypot: pretend success.
      res.status(201).json({ leadId: crypto.randomUUID(), bookingToken: newToken(), market: repo.getDefaultMarket(db).slug });
      return;
    }
    const market = home();
    // Re-run the deterministic analysis with the customer's selections, anchored to
    // the snapshot's time and data scope. Prices are never taken from the request;
    // unknown option ids fall back to the default selection.
    const snapshot = a.analysis as PlatformAnalysis;
    const chosen = buildAnalysis(assessment, {
      includeSamples: snapshot.includeSamples && config.flags.sampleData,
      computedAt: snapshot.computedAt,
      selections: input.selections,
      // The offers the customer saw, exactly as stored (older snapshots have none and use the pilot data).
      catalog: snapshot.catalog,
      // …and the benchmark values that were in force then, so a later change never alters what they saw.
      benchmarks: snapshot.benchmarks,
    });
    const drafts = opportunitiesFrom(chosen);
    const bookingToken = tokenFor('booking', input.requestKey);
    const { lead, duplicate, retried } = repo.createLead(db, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      street: input.street,
      unit: input.unit,
      city: input.city,
      zip: assessment.zip,
      preferredContact: input.preferredContact,
      currentProvider: assessment.internet?.provider ?? '',
      areaStatus: 'unknown',
      source: 'platform_assessment',
      utmSource: a.utmSource,
      utmMedium: '',
      utmCampaign: a.utmCampaign,
      utmContent: '',
      utmTerm: '',
      clickId: '',
      referrer: '',
      landingPage: '/savings',
      sessionId: input.sessionId,
      marketId: market.slug,
      bookingTokenHash: sha256(bookingToken),
      consentText: `[${PLATFORM_CONSENT_VERSION}] ${platformConsentText()}`,
      consentIp: req.ip ?? '',
      consentUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      preview: previewFromOpportunities(drafts, chosen.household?.currentMonthly ?? null),
      bestTime: input.bestTime,
      marketingConsentText: input.marketingConsent ? `[${MARKETING_CONSENT_VERSION}] ${marketingConsentText()}` : undefined,
      requestKey: input.requestKey ?? null,
    });
    if (retried) {
      // The same form sent again (retry or double tap): nothing new is created or emailed.
      res.status(201).json({ leadId: lead.id, bookingToken, market: lead.marketId, repeat: true, routing: routingOf(lead.id) } satisfies HandoffResult);
      return;
    }
    repo.linkAssessmentLead(db, a.id, lead.id);
    repo.insertOpportunities(db, { leadId: lead.id, assessmentId: a.id, marketId: market.slug, drafts });
    repo.addNote(
      db,
      lead.id,
      `From household assessment (${input.intent}). Asked about: ${drafts.map((d) => `${d.category} → ${d.planName}${d.kind === 'sample' ? ' [SAMPLE]' : ''}`).join('; ')}.`,
      'system',
      { category: 'handoff' },
    );
    repo.insertEvent(db, { name: 'advisor_request', sessionId: input.sessionId, path: '/savings', props: { intent: input.intent }, utmSource: a.utmSource, utmCampaign: a.utmCampaign, marketId: market.slug });
    repo.insertEvent(db, { name: 'handoff_submit', sessionId: input.sessionId, path: '/savings', props: { from: 'results', intent: input.intent }, utmSource: a.utmSource, utmCampaign: a.utmCampaign, marketId: market.slug });
    const routing = route(lead.id, { marketId: market.slug, categories: assessment.categories, phone: lead.phone, sessionId: input.sessionId, utmSource: a.utmSource, utmCampaign: a.utmCampaign, path: '/savings' });
    notifier.onLead(repo.getLead(db, lead.id)!, duplicate);
    res.status(201).json({ leadId: lead.id, bookingToken, market: market.slug, repeat: false, routing } satisfies HandoffResult);
  });

  /**
   * "Get My Exact Pricing" from the home page preview: first name, phone, ZIP
   * and consent, plus the bills already typed. The lead is saved first; the
   * full analysis and opportunities are then built from the same bills so the
   * representative sees what any other lead shows. Savings stay illustrative.
   */
  /**
   * Save a pricing-review request as a lead, route it and attach the analysis.
   * Shared by the home-page request and the chat, so both create identical leads.
   */
  const handoffLead = (h: Handoff, req: express.Request, o: { source: 'platform_handoff' | 'platform_chat'; from: 'home' | 'chat'; note: string; onCreated?: (leadId: string) => void }): HandoffResult => {
    const market = home();
    const set = benchmarks();
    const benchmarkSet = { version: set.version, internetMonthly: set.internetMonthly, mobilePerLine: set.mobilePerLine, tvMonthly: set.tvMonthly, electricityWithSolarMonthly: set.electricityWithSolarMonthly, securityMonthly: set.securityMonthly };
    const bookingToken = tokenFor('booking', h.requestKey);
    const resultsToken = tokenFor('results', h.requestKey);
    const path = h.landingPage || '/';
    const { lead, duplicate, retried } = repo.createLead(db, {
      firstName: h.firstName,
      lastName: h.lastName,
      email: h.email,
      phone: h.phone,
      street: h.street,
      unit: '',
      city: '',
      zip: h.zip,
      preferredContact: h.preferredContact,
      currentProvider: '',
      areaStatus: 'unknown',
      source: o.source,
      utmSource: h.utmSource,
      utmMedium: h.utmMedium,
      utmCampaign: h.utmCampaign,
      utmContent: h.utmContent,
      utmTerm: h.utmTerm,
      clickId: h.clickId,
      referrer: h.referrer,
      landingPage: path,
      sessionId: h.sessionId,
      marketId: market.slug,
      bookingTokenHash: sha256(bookingToken),
      consentText: `[${HANDOFF_CONSENT_VERSION}] ${handoffConsentText()}`,
      consentIp: req.ip ?? '',
      consentUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      preview: previewFromBills(h, benchmarkSet),
      bestTime: h.bestTime,
      marketingConsentText: h.marketingConsent ? `[${MARKETING_CONSENT_VERSION}] ${marketingConsentText()}` : undefined,
      requestKey: h.requestKey ?? null,
    });
    const results = (id: string | null) => (id ? { id, token: resultsToken } : undefined);
    if (retried) {
      return { leadId: lead.id, bookingToken, market: lead.marketId, repeat: true, routing: routingOf(lead.id), results: results(lead.assessmentId) } satisfies HandoffResult;
    }
    repo.addNote(db, lead.id, o.note, 'system', { category: 'handoff' });
    o.onCreated?.(lead.id);
    repo.insertEvent(db, { name: 'handoff_submit', sessionId: h.sessionId, path, props: { from: o.from, categories: billCategories(h.bills, h.ownsHome && h.showExtras).length }, utmSource: h.utmSource, utmCampaign: h.utmCampaign, marketId: market.slug });
    const routing = route(lead.id, { marketId: market.slug, categories: billCategories(h.bills, h.ownsHome && h.showExtras), phone: lead.phone, sessionId: h.sessionId, utmSource: h.utmSource, utmCampaign: h.utmCampaign, path });
    notifier.onLead(repo.getLead(db, lead.id)!, duplicate);

    // The lead is safe. Now attach the full analysis; if this part fails the request still succeeded.
    let assessmentId: string | null = null;
    try {
      const assessment = assessmentSchema.parse(assessmentFromBills(h));
      const analysis = buildAnalysis(assessment, { includeSamples: config.flags.sampleData, computedAt: new Date().toISOString(), catalog: NATIONAL, benchmarks: benchmarkSet });
      assessmentId = repo.insertAssessment(db, {
        tokenHash: sha256(resultsToken),
        zip: h.zip,
        marketId: '',
        categories: assessment.categories,
        answers: assessment,
        analysis,
        analysisVersion: analysis.version,
        assumptionsVersion: analysis.assumptionsVersion,
        includeSamples: analysis.includeSamples,
        status: analysis.status,
        currentMonthlyCents: analysis.household?.currentMonthly ?? null,
        potentialSavingsCents: potentialSavings(analysis),
        projectionBasis: analysis.projectionBasis,
        sessionId: h.sessionId,
        utmSource: h.utmSource,
        utmCampaign: h.utmCampaign,
        landingPage: path,
        referrer: h.referrer,
      });
      repo.linkAssessmentLead(db, assessmentId, lead.id);
      repo.insertOpportunities(db, { leadId: lead.id, assessmentId, marketId: market.slug, drafts: opportunitiesFrom(analysis) });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'handoff analysis failed; lead saved', leadId: lead.id, error: err instanceof Error ? err.message : String(err) }));
    }
    return { leadId: lead.id, bookingToken, market: market.slug, repeat: false, routing, results: results(assessmentId) } satisfies HandoffResult;
  };


  r.post('/handoff', limiter(10), (req, res) => {
    const h = parse(handoffSchema, req.body);
    if (h.website) {
      // Honeypot: pretend success.
      res.status(201).json({ leadId: crypto.randomUUID(), bookingToken: newToken(), market: repo.getDefaultMarket(db).slug, repeat: false, routing: { outcome: 'queued', representative: null } } satisfies HandoffResult);
      return;
    }
    res.status(201).json(handoffLead(h, req, { source: 'platform_handoff', from: 'home', note: 'Pricing review requested from the home page preview. Figures are a preliminary benchmark comparison, not verified pricing.' }));
  });

  chatRoutes(r, { db, config, limiter, parse, handoffLead, model: chatModel, benchmarks: () => { const b = benchmarks(); return { version: b.version, internetMonthly: b.internetMonthly, mobilePerLine: b.mobilePerLine, tvMonthly: b.tvMonthly, electricityWithSolarMonthly: b.electricityWithSolarMonthly, securityMonthly: b.securityMonthly }; } });

  return r;
}
