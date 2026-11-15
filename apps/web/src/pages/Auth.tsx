import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useSession } from '../session';

/** Only allow same-site relative redirects after sign-in. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { body: { email, password } });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <Logo />
        <h1>Sign in</h1>
        {error && <div className="error" role="alert">{error}</div>}
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted">New to Mingle? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
      </form>
    </div>
  );
}

export function SignupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', password: '', orgName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ orgId: string }>('/auth/signup', { body: { ...form, orgName: form.orgName || undefined } });
      await refresh();
      navigate(next ? safeNext(next) : `/app/${res.orgId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <Logo />
        <h1>Create your account</h1>
        <p className="muted small">Free forever for events up to 40 minutes. No credit card needed.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <label>Your name<input required autoComplete="name" value={form.name} onChange={set('name')} /></label>
        <label>Work email<input type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} /><span className="small muted">At least 10 characters.</span></label>
        <label>Company or team name <span className="muted small">(optional)</span><input value={form.orgName} onChange={set('orgName')} /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="small muted">Already have an account? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></p>
      </form>
    </div>
  );
}
