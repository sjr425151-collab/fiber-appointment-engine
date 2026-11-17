import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Logo, Spinner } from '../../components/ui';

const ADMIN_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/work', label: 'Workspace' },
  { to: '/admin/leads', label: 'Leads' },
  { to: '/admin/follow-ups', label: 'Follow-ups' },
  { to: '/admin/appointments', label: 'Appointments' },
  { to: '/admin/opportunities', label: 'Opportunities' },
  { to: '/admin/assessments', label: 'Assessments' },
  { to: '/admin/chats', label: 'Chats' },
  { to: '/admin/reps', label: 'Representatives' },
  { to: '/admin/benchmarks', label: 'Benchmarks' },
  { to: '/admin/settings', label: 'Settings' },
];
/** A representative sees only their own leads; a manager sees every lead. */
const REP_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin/work', label: 'Overview' },
  { to: '/admin/leads', label: 'My leads' },
  { to: '/admin/follow-ups', label: 'Follow-ups' },
];
const MANAGER_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin/work', label: 'Overview' },
  { to: '/admin/leads', label: 'Leads' },
  { to: '/admin/follow-ups', label: 'Follow-ups' },
];

export interface TeamContext {
  role: 'admin' | 'rep';
  /** What the Agent Workspace allows: rep (own leads), manager (all leads) or admin. */
  workRole: 'admin' | 'manager' | 'rep';
  rep: { id: string; name: string; accepting: boolean; openLeads: number } | null;
}
interface Me extends Omit<TeamContext, 'workRole'> {
  workRole?: TeamContext['workRole'];
  email: string;
  emailEnabled: boolean;
  locationsWithoutTeamEmail: string[];
  pricingWarnings?: { name: string; state: 'expiring' | 'hidden'; daysLeft: number | null }[];
  crm?: { name: string; configured: boolean };
  representatives?: number;
}
export const useTeam = () => useOutletContext<TeamContext>();

export default function AdminLayout() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ enabled: boolean; missing: string[] }>({ enabled: true, missing: [] });
  const [pricing, setPricing] = useState<{ name: string; state: 'expiring' | 'hidden'; daysLeft: number | null }[]>([]);
  const [team, setTeam] = useState<TeamContext>({ role: 'admin', workRole: 'admin', rep: null });
  const loc = useLocation();
  const [notes, setNotes] = useState<{ items: { id: string; title: string; leadId: string | null; readAt: string | null; createdAt: string }[]; unread: number }>({ items: [], unread: 0 });
  const [bell, setBell] = useState(false);
  const [noReps, setNoReps] = useState(false);

  useEffect(() => {
    api<Me>('/admin/me')
      .then((r) => {
        setTeam({ role: r.role ?? 'admin', workRole: r.workRole ?? (r.role === 'rep' ? 'rep' : 'admin'), rep: r.rep ?? null });
        setNoReps(r.role !== 'rep' && r.representatives === 0);
        setEmail(r.email);
        setEmailStatus({ enabled: r.emailEnabled, missing: r.locationsWithoutTeamEmail ?? [] });
        setPricing(r.pricingWarnings ?? []);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) nav('/admin/login', { replace: true });
      });
  }, [nav]);

  // Representatives and managers start on their workspace.
  useEffect(() => {
    if (email && team.role === 'rep' && (loc.pathname === '/admin' || loc.pathname === '/admin/')) nav('/admin/work', { replace: true });
  }, [email, team.role, loc.pathname, nav]);
  // In-app notifications (new leads assigned), checked every minute.
  useEffect(() => {
    if (team.role !== 'rep') return;
    const load = () =>
      api<typeof notes>('/admin/work/notifications')
        .then(setNotes)
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [team.role]);
  async function openBell() {
    setBell(!bell);
    if (!bell && notes.unread) {
      await api('/admin/work/notifications/read', { method: 'POST' }).catch(() => undefined);
      setNotes((n) => ({ ...n, unread: 0 }));
    }
  }

  async function setAccepting(accepting: boolean) {
    // Show the change at once; put it back if the server refuses.
    const apply = (v: boolean) => setTeam((t) => (t.rep ? { ...t, rep: { ...t.rep, accepting: v } } : t));
    apply(accepting);
    try {
      const r = await api<{ representative: { accepting: boolean } }>('/admin/reps/me', { method: 'PATCH', body: { accepting } });
      apply(r.representative.accepting);
    } catch {
      apply(!accepting);
    }
  }

  async function logout() {
    await api('/admin/logout', { method: 'POST' });
    nav('/admin/login');
  }

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-500">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-white/10 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <Logo />
          {/* Phones: the nav gets its own full-width row and scrolls sideways instead of overlapping. */}
          <nav aria-label="Admin" className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 pb-1 text-sm lg:order-none lg:mx-0 lg:w-auto lg:overflow-visible lg:px-0 lg:pb-0">
            {(team.workRole === 'rep' ? REP_NAV : team.workRole === 'manager' ? MANAGER_NAV : ADMIN_NAV).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `shrink-0 whitespace-nowrap rounded-lg px-3 py-2 transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
            {team.rep && (
              <div className="relative">
                <button
                  type="button"
                  onClick={openBell}
                  aria-expanded={bell}
                  aria-label={`Notifications${notes.unread ? `, ${notes.unread} new` : ''}`}
                  className="relative grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {notes.unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{notes.unread}</span>}
                </button>
                {bell && (
                  <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-white/10 bg-ink-900 p-2 shadow-2xl">
                    {notes.items.length === 0 ? (
                      <p className="p-3 text-sm text-slate-400">No notifications.</p>
                    ) : (
                      <ul>
                        {notes.items.slice(0, 10).map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                              onClick={() => {
                                setBell(false);
                                if (n.leadId) nav(`/admin/leads/${n.leadId}`);
                              }}
                            >
                              {n.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            {team.rep && (
              <label className="flex cursor-pointer items-center gap-2 text-slate-200">
                <input type="checkbox" checked={team.rep.accepting} onChange={(e) => setAccepting(e.target.checked)} />
                Accepting new leads
              </label>
            )}
            <span className="hidden sm:inline">{email}</span>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {noReps && (
        <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-center text-sm text-amber-100 sm:px-6">
          No representatives are set up, so every pricing-review request waits in the follow-up queue (Leads → Unassigned). Add one under Representatives.
        </div>
      )}
      {(!emailStatus.enabled || emailStatus.missing.length > 0) && (
        <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-center text-sm text-amber-100 sm:px-6">
          {!emailStatus.enabled
            ? 'Email notifications are off — lead alerts and customer confirmations are logged but not sent. They turn on when the email service key is added in the hosting settings.'
            : 'No alert email is set, so nobody is emailed when a new lead arrives. Add one in Settings.'}
        </div>
      )}
      {pricing.length > 0 && (
        <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-center text-sm text-amber-100 sm:px-6">
          {pricing
            .map((p) =>
              p.state === 'hidden'
                ? `${p.name}: plan prices are hidden from customers’ savings results until re-verified.`
                : `${p.name}: plan prices will be hidden from savings results in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} unless re-verified.`,
            )
            .join(' ')}{' '}
          Confirm the prices and update “Prices verified on” in Locations.
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet context={team} />
      </main>
    </div>
  );
}
