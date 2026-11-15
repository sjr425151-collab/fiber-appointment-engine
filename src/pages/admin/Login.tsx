import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Field, Logo, Spinner } from '../../components/ui';

export default function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/login', { method: 'POST', body: { email, password } });
      nav('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fiber-lines grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-5 p-8">
        <Logo />
        <div>
          <h1 className="font-display text-2xl font-bold">Team sign in</h1>
          <p className="text-sm text-slate-400">Lead and appointment management</p>
        </div>
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="pw">
          <input id="pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
