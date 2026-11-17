/** Website chat: the funnel, AI usage and each conversation. Admin only. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents } from '../../../shared/finance/money';
import { api, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { ChatTranscript, type TranscriptMessage } from './ChatTranscript';

interface Session {
  id: string;
  status: 'open' | 'previewed' | 'handoff';
  leadId: string | null;
  leadName: string | null;
  userMessages: number;
  aiCalls: number;
  aiFailures: number;
  landingPage: string;
  utmSource: string;
  createdAt: string;
  updatedAt: string;
}
interface Stats {
  days: number;
  opened: number;
  engaged: number;
  previewed: number;
  handoffs: number;
  abandoned: number;
  aiCalls: number;
  aiFailures: number;
  avgAiMs: number | null;
  estCostCents: number;
  costPerChatCents: number | null;
  costPerLeadCents: number | null;
}
interface Data {
  total: number;
  sessions: Session[];
  stats: Stats;
  ai: { configured: boolean; model: string };
}
const STATUS: Record<Session['status'], string> = { open: 'Chatting', previewed: 'Saw a preview', handoff: 'Asked for a person' };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default function Chats() {
  const [d, setD] = useState<Data | null>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<{ id: string; messages: TranscriptMessage[] } | null>(null);
  useEffect(() => {
    api<Data>(`/admin/chats${status ? `?status=${status}` : ''}`).then(setD);
  }, [status]);
  if (!d) return <Spinner />;
  const s = d.stats;
  const tiles: [string, string, string][] = [
    ['Chats opened', String(s.opened), ''],
    ['Sent a message', String(s.engaged), pct(s.engaged, s.opened)],
    ['Saw a preview', String(s.previewed), pct(s.previewed, s.engaged)],
    ['Asked for a person', String(s.handoffs), pct(s.handoffs, s.previewed)],
    ['Left mid-chat', String(s.abandoned), pct(s.abandoned, s.engaged)],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Website chat</h1>
        <p className="text-sm text-slate-400">Last {s.days} days. The assistant is an AI; savings figures come from the published benchmarks, never from the AI.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value, rate]) => (
          <div key={label} className="glass p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {rate && <p className="text-xs text-slate-400">{rate} of previous step</p>}
          </div>
        ))}
      </div>
      <div className="glass p-4 text-sm text-slate-300">
        <p>
          AI wording: {d.ai.configured ? `on (${d.ai.model})` : 'off: no API key set, the rule-based assistant answers every message'}.
          {s.aiCalls > 0 && ` ${s.aiCalls} calls, ${s.aiFailures} fell back to rules (${pct(s.aiFailures, s.aiCalls)}), average ${s.avgAiMs ?? 0} ms.`}
        </p>
        {s.aiCalls > 0 && (
          <p className="mt-1">
            Estimated AI cost {formatCents(s.estCostCents)}
            {s.costPerChatCents !== null && ` · ${formatCents(s.costPerChatCents)} per chat`}
            {s.costPerLeadCents !== null && ` · ${formatCents(s.costPerLeadCents)} per request for a person`} (from token counts at list prices; your invoice is the real figure).
          </p>
        )}
      </div>
      <div className="glass p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Conversations ({d.total})</h2>
          <label className="text-sm text-slate-400">
            Show{' '}
            <select className="input inline-block w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="open">Chatting</option>
              <option value="previewed">Saw a preview</option>
              <option value="handoff">Asked for a person</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 pr-3">Last activity</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Messages</th>
                <th className="py-2 pr-3">Started on</th>
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2"><span className="sr-only">Transcript</span></th>
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="py-2 pr-3">{fmtDateTime(c.updatedAt)}</td>
                  <td className="py-2 pr-3">{STATUS[c.status]}</td>
                  <td className="py-2 pr-3">{c.userMessages}</td>
                  <td className="py-2 pr-3">
                    {c.landingPage || '/'}
                    {c.utmSource ? ` · ${c.utmSource}` : ''}
                  </td>
                  <td className="py-2 pr-3">
                    {c.leadId ? (
                      <Link className="underline" to={`/admin/leads/${c.leadId}`}>
                        {c.leadName || 'Open lead'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2">
                    <button className="underline" onClick={() => api<{ messages: TranscriptMessage[] }>(`/admin/chats/${c.id}`).then((r) => setOpen({ id: c.id, messages: r.messages }))}>
                      Read
                    </button>
                  </td>
                </tr>
              ))}
              {d.sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-400">
                    No chats yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {open && (
        <div className="glass p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Transcript</h2>
            <button className="text-sm underline" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <ChatTranscript messages={open.messages} />
        </div>
      )}
    </div>
  );
}
