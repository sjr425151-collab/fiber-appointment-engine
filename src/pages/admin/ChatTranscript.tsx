/** A website chat as the customer saw it. Assistant lines are the AI's; the figures came from the benchmark calculation. */
import { fmtDateTime } from '../../lib/api';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  card: { preview?: { monthlySavings: number } | null } | null;
  source: string;
  createdAt: string;
}

export function ChatTranscript({ messages }: { messages: TranscriptMessage[] }) {
  if (!messages.length) return <p className="text-sm text-slate-400">No messages.</p>;
  return (
    <ol className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 text-sm">
      {messages.map((m) => (
        <li key={m.id} className={m.role === 'user' ? 'ml-8 rounded-lg bg-white/10 px-3 py-2' : 'mr-8 rounded-lg border border-white/10 px-3 py-2'}>
          <p className="text-xs text-slate-400">
            {m.role === 'user' ? 'Customer' : `Assistant${m.source === 'ai' ? ' (AI wording)' : ''}`} · {fmtDateTime(m.createdAt)}
          </p>
          <p className="whitespace-pre-wrap text-slate-200">{m.body}</p>
          {m.card?.preview && <p className="mt-1 text-xs text-amber-200">Showed an illustrative savings card (not verified).</p>}
        </li>
      ))}
    </ol>
  );
}
