/** Central settings: where new-lead alerts are sent, and whether email is actually switched on. */
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../../components/ui';

interface SettingsData {
  teamEmails: string[];
  fallbackTeamEmails: string[];
  emailEnabled: boolean;
  emailFrom: string;
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [emails, setEmails] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SettingsData>('/admin/settings').then((d) => {
      setData(d);
      setEmails(d.teamEmails.join(', '));
    });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const teamEmails = emails.split(/[\s,;]+/).filter(Boolean);
      const d = await api<SettingsData>('/admin/settings', { method: 'PUT', body: { teamEmails } });
      setData(d);
      setEmails(d.teamEmails.join(', '));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.teamEmails ?? err.message) : 'Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="grid place-items-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }
  const effective = data.teamEmails.length ? data.teamEmails : data.fallbackTeamEmails;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">Settings</h1>

      <form onSubmit={save} className="glass space-y-4 p-5">
        <h2 className="font-semibold">New-lead alerts</h2>
        <p className="text-sm text-slate-400">Every new request is emailed to these addresses and to the representative it is assigned to. Each lead’s page shows whether its alert was sent, skipped or failed.</p>
        <div>
          <label className="label" htmlFor="set-emails">
            Alert email addresses (up to 10, separated by commas)
          </label>
          <input id="set-emails" className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="team@yourcompany.com" aria-invalid={!!error || undefined} />
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-300">
            Saved.
          </p>
        )}
        <button className="btn-primary py-2 text-sm" disabled={busy}>
          {busy ? <Spinner /> : 'Save'}
        </button>
      </form>

      <div className="glass space-y-2 p-5 text-sm">
        <h2 className="font-semibold">Delivery status</h2>
        <p className={data.emailEnabled ? 'text-emerald-300' : 'text-amber-300'}>
          {data.emailEnabled ? 'Email sending is on.' : 'Email sending is off: alerts are recorded on each lead but not delivered. It turns on when the email service key is added in the hosting settings.'}
        </p>
        <p className="text-slate-300">Alerts currently go to: {effective.length ? effective.join(', ') : 'nobody. Add an address above so new leads are not missed.'}</p>
        <p className="text-slate-400">Sent from: {data.emailFrom}</p>
      </div>
    </div>
  );
}
