import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Logo, Spinner } from '../../components/ui';
import { bootFlags } from '../../lib/market';

const NAV = [
  { to: '/admin', label: 'Leads', end: true },
  { to: '/admin/appointments', label: 'Appointments' },
  { to: '/admin/locations', label: 'Locations' },
  { to: '/admin/areas', label: 'Service areas' },
  // Parent-platform assessments (only when the platform is enabled).
  ...(bootFlags().platform
    ? [
        { to: '/admin/opportunities', label: 'Opportunities' },
        { to: '/admin/assessments', label: 'Assessments' },
      ]
    : []),
];

export default function AdminLayout() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ enabled: boolean; missing: string[] }>({ enabled: true, missing: [] });

  useEffect(() => {
    api<{ email: string; emailEnabled: boolean; locationsWithoutTeamEmail: string[] }>('/admin/me')
      .then((r) => {
        setEmail(r.email);
        setEmailStatus({ enabled: r.emailEnabled, missing: r.locationsWithoutTeamEmail ?? [] });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) nav('/admin/login', { replace: true });
      });
  }, [nav]);

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
            {NAV.map((n) => (
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
            <span className="hidden sm:inline">{email}</span>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {(!emailStatus.enabled || emailStatus.missing.length > 0) && (
        <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-center text-sm text-amber-100 sm:px-6">
          {!emailStatus.enabled
            ? 'Email notifications are off — lead alerts and customer confirmations are logged but not sent. Add RESEND_API_KEY to turn them on.'
            : `No team alert email set for: ${emailStatus.missing.join(', ')}. Add one in Locations so new leads aren’t missed.`}
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
