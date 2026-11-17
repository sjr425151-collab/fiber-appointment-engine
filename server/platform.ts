/**
 * Household savings API (mounted at /api/platform). Assessments contain no contact details; results are only
 * readable with the random token returned at submission (stored hashed).
 */
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { PLATFORM_CONSENT_VERSION, platformConsentText } from '../shared/content';
import { assessmentSchema, contactSchema, submissionSchema } from '../shared/platform/assessment';
import { buildAnalysis, type AreaCatalog, type PlatformAnalysis } from '../shared/platform/analysis';
import { offersFromMarket } from '../shared/platform/market-offers';
import { opportunitiesFrom } from '../shared/platform/opportunity';
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

export function platformRouter(config: AppConfig, db: DB, notifier: Notifier) {
  /** Real offers for a ZIP, from the location that serves it (admin → Locations and Service areas). */
  const areaCatalog = (zip: string): AreaCatalog => {
    const area = repo.getServiceArea(db, zip);
    const market = area ? repo.getMarket(db, area.marketId) : null;
    if (!area || !market?.active) return { internet: [] };
    if (area.status === 'available' || area.status === 'verify') return { internet: offersFromMarket(market, [zip]) };
    if (area.status === 'coming_soon') {
      return {
        internet: [],
        internetNote: `${market.provider} is coming to ${area.city} but isn’t available to order yet. An advisor can review your current internet bill now and let you know when it arrives.`,
      };
    }
    return { internet: [] };
  };
  const r = express.Router();
  const isTest = process.env.NODE_ENV === 'test';
  const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => isTest });

  /** Load an assessment only with a valid token; identical 404 for "missing" and "wrong token". */
  const authorized = (id: string, token: unknown) => {
    const hash = typeof token === 'string' && token.length >= 16 ? repo.getAssessmentTokenHash(db, id) : null;
    if (!hash || !safeEqual(hash, sha256(token as string))) throw new PlatformError(404, 'Results not found.');
    return repo.getAssessment(db, id)!;
  };

  r.post('/assessments', limiter(30), (req, res) => {
    const sub = parse(submissionSchema, req.body);
    const assessment = parse(assessmentSchema, sub.assessment);
    const computedAt = new Date().toISOString();
    const analysis = buildAnalysis(assessment, { includeSamples: config.flags.sampleData, computedAt, catalog: areaCatalog(assessment.zip) });
    const area = repo.getServiceArea(db, assessment.zip);
    const token = newToken();
    const id = repo.insertAssessment(db, {
      tokenHash: sha256(token),
      zip: assessment.zip,
      marketId: area?.marketId ?? '',
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
      marketId: area?.marketId ?? '',
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
    const area = repo.getServiceArea(db, assessment.zip);
    const areaMarket = area ? repo.getMarket(db, area.marketId) : null;
    const market = areaMarket?.active ? areaMarket : repo.getDefaultMarket(db);
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
    });
    const drafts = opportunitiesFrom(chosen);
    const bookingToken = newToken();
    const { lead, duplicate } = repo.createLead(db, {
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
      areaStatus: area?.status ?? 'unknown',
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
    });
    repo.linkAssessmentLead(db, a.id, lead.id);
    repo.insertOpportunities(db, { leadId: lead.id, assessmentId: a.id, marketId: market.slug, drafts });
    repo.addNote(
      db,
      lead.id,
      `From household assessment (${input.intent}). Asked about: ${drafts.map((d) => `${d.category} → ${d.planName}${d.kind === 'sample' ? ' [SAMPLE]' : ''}`).join('; ')}.`,
      'system',
    );
    repo.insertEvent(db, { name: 'advisor_request', sessionId: input.sessionId, path: '/savings', props: { intent: input.intent }, utmSource: a.utmSource, utmCampaign: a.utmCampaign, marketId: market.slug });
    notifier.onLead(repo.getLead(db, lead.id)!, duplicate);
    res.status(201).json({ leadId: lead.id, bookingToken, market: market.slug });
  });

  return r;
}
