/** Storage for website chat sessions and their messages. Parameterized SQL only. */
import { randomUUID } from 'node:crypto';
import type { ChatState } from '../shared/chat/conversation';
import type { DB } from './db';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export interface ChatSessionRow {
  id: string;
  tokenHash: string;
  state: ChatState;
  status: 'open' | 'previewed' | 'handoff';
  leadId: string | null;
  userMessages: number;
  aiCalls: number;
  aiFailures: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiMs: number;
  landingPage: string;
  utmSource: string;
  utmCampaign: string;
  createdAt: string;
  updatedAt: string;
}
const toSession = (r: Row): ChatSessionRow => ({
  id: r.id as string,
  tokenHash: r.token_hash as string,
  state: JSON.parse(r.state as string) as ChatState,
  status: r.status as ChatSessionRow['status'],
  leadId: (r.lead_id as string) ?? null,
  userMessages: r.user_messages as number,
  aiCalls: r.ai_calls as number,
  aiFailures: r.ai_failures as number,
  aiInputTokens: r.ai_input_tokens as number,
  aiOutputTokens: r.ai_output_tokens as number,
  aiMs: r.ai_ms as number,
  landingPage: r.landing_page as string,
  utmSource: r.utm_source as string,
  utmCampaign: r.utm_campaign as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export function createSession(db: DB, s: { tokenHash: string; state: ChatState; landingPage: string; utmSource: string; utmCampaign: string }): string {
  const id = randomUUID();
  const ts = now();
  db.prepare('INSERT INTO chat_sessions (id, token_hash, state, landing_page, utm_source, utm_campaign, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    s.tokenHash,
    JSON.stringify(s.state),
    s.landingPage,
    s.utmSource,
    s.utmCampaign,
    ts,
    ts,
  );
  return id;
}
export function getSession(db: DB, id: string): ChatSessionRow | null {
  const r = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as Row | undefined;
  return r ? toSession(r) : null;
}
export function saveState(db: DB, id: string, state: ChatState, status?: ChatSessionRow['status']) {
  db.prepare("UPDATE chat_sessions SET state = ?, status = CASE WHEN status = 'handoff' THEN status ELSE COALESCE(?, status) END, updated_at = ? WHERE id = ?").run(JSON.stringify(state), status ?? null, now(), id);
}
export function countUserMessage(db: DB, id: string) {
  db.prepare('UPDATE chat_sessions SET user_messages = user_messages + 1 WHERE id = ?').run(id);
}
export function recordAi(db: DB, id: string, u: { ok: boolean; inputTokens: number; outputTokens: number; ms: number }) {
  db.prepare('UPDATE chat_sessions SET ai_calls = ai_calls + 1, ai_failures = ai_failures + ?, ai_input_tokens = ai_input_tokens + ?, ai_output_tokens = ai_output_tokens + ?, ai_ms = ai_ms + ? WHERE id = ?').run(
    u.ok ? 0 : 1,
    u.inputTokens,
    u.outputTokens,
    u.ms,
    id,
  );
}
export function linkLead(db: DB, id: string, leadId: string) {
  db.prepare("UPDATE chat_sessions SET lead_id = ?, status = 'handoff', updated_at = ? WHERE id = ?").run(leadId, now(), id);
}

export interface ChatMessageRow {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  /** Savings card or other structured part, as stored. */
  card: unknown;
  clientId: string | null;
  /** 'rules' or 'ai' for assistant messages. */
  source: string;
  createdAt: string;
}
const toMessage = (r: Row): ChatMessageRow => ({
  id: r.id as string,
  role: r.role as ChatMessageRow['role'],
  body: r.body as string,
  card: r.card ? JSON.parse(r.card as string) : null,
  clientId: (r.client_id as string) ?? null,
  source: r.source as string,
  createdAt: r.created_at as string,
});
/** Returns false when the same client message was already stored (a retry). */
export function addMessage(db: DB, m: { sessionId: string; role: 'user' | 'assistant'; body: string; card?: unknown; clientId?: string | null; source?: string }): boolean {
  return (
    db
      .prepare('INSERT OR IGNORE INTO chat_messages (id, session_id, role, body, card, client_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), m.sessionId, m.role, m.body, m.card ? JSON.stringify(m.card) : '', m.clientId ?? null, m.source ?? '', now()).changes === 1
  );
}
export function listMessages(db: DB, sessionId: string, limit = 200): ChatMessageRow[] {
  return (db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid LIMIT ?').all(sessionId, limit) as Row[]).map(toMessage);
}
/** The assistant replies stored after a given client message (to answer a retried send with the same reply). */
export function repliesAfter(db: DB, sessionId: string, clientId: string): ChatMessageRow[] {
  const at = db.prepare('SELECT rowid FROM chat_messages WHERE session_id = ? AND client_id = ?').get(sessionId, clientId) as { rowid: number } | undefined;
  if (!at) return [];
  return (db.prepare("SELECT * FROM chat_messages WHERE session_id = ? AND rowid > ? AND role = 'assistant' ORDER BY rowid LIMIT 3").all(sessionId, at.rowid) as Row[]).map(toMessage);
}
export function transcriptForLead(db: DB, leadId: string): { sessionId: string; messages: ChatMessageRow[] } | null {
  const r = db.prepare('SELECT id FROM chat_sessions WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1').get(leadId) as { id: string } | undefined;
  return r ? { sessionId: r.id, messages: listMessages(db, r.id) } : null;
}

/** Sessions for the team area: newest first, with no message text. */
export function listSessions(db: DB, f: { status?: string; limit?: number; offset?: number } = {}) {
  const where = f.status ? 'WHERE s.status = ?' : '';
  const params = f.status ? [f.status] : [];
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM chat_sessions s ${where}`).get(...params) as { n: number };
  const rows = db
    .prepare(
      `SELECT s.*, TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS lead_name FROM chat_sessions s LEFT JOIN leads l ON l.id = s.lead_id ${where}
       ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return { total: n, sessions: rows.map((r) => ({ ...toSession(r), leadName: (r.lead_name as string) || null, tokenHash: undefined })) };
}

/**
 * Chat funnel for a period. Each session counts once at each step:
 * opened → engaged (sent at least one message) → saw a preview → asked for a person (lead saved).
 * AI cost is estimated from stored token counts and the configured prices.
 */
export function chatStats(db: DB, from: string, to: string) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS opened,
              SUM(CASE WHEN user_messages > 0 THEN 1 ELSE 0 END) AS engaged,
              SUM(CASE WHEN status IN ('previewed','handoff') THEN 1 ELSE 0 END) AS previewed,
              SUM(CASE WHEN status = 'handoff' THEN 1 ELSE 0 END) AS handoffs,
              SUM(CASE WHEN user_messages > 0 AND status = 'open' AND updated_at < ? THEN 1 ELSE 0 END) AS abandoned,
              COALESCE(SUM(ai_calls), 0) AS aiCalls, COALESCE(SUM(ai_failures), 0) AS aiFailures,
              COALESCE(SUM(ai_input_tokens), 0) AS inputTokens, COALESCE(SUM(ai_output_tokens), 0) AS outputTokens, COALESCE(SUM(ai_ms), 0) AS aiMs
       FROM chat_sessions WHERE created_at >= ? AND created_at < ?`,
    )
    .get(new Date(Date.now() - 30 * 60_000).toISOString(), from, to) as Record<string, number | null>;
  const v = (k: string) => (r[k] as number | null) ?? 0;
  return {
    opened: v('opened'),
    engaged: v('engaged'),
    previewed: v('previewed'),
    handoffs: v('handoffs'),
    abandoned: v('abandoned'),
    aiCalls: v('aiCalls'),
    aiFailures: v('aiFailures'),
    inputTokens: v('inputTokens'),
    outputTokens: v('outputTokens'),
    avgAiMs: v('aiCalls') ? Math.round(v('aiMs') / v('aiCalls')) : null,
  };
}

/** Removes chats that never became a lead after `days` (privacy: keep only what is needed). */
export function pruneChats(db: DB, days = 90): number {
  return Number(db.prepare('DELETE FROM chat_sessions WHERE lead_id IS NULL AND updated_at < ?').run(new Date(Date.now() - days * 86_400_000).toISOString()).changes);
}
