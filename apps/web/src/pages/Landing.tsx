import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PlanInfo } from '../api';
import { Logo } from '../components/Logo';
import { useSession } from '../session';

const FEATURES = [
  { title: 'HD video that holds up', body: 'A selective forwarding media server adapts every stream to each person’s connection, so meetings stay smooth from 2 to 300 people.' },
  { title: 'Screen share and chat', body: 'Share a window or whole screen with audio, and chat with everyone in the meeting without leaving the call.' },
  { title: 'Invite anyone with a link', body: 'Schedule a meeting, send the link or calendar invite, and guests join from the browser. No downloads.' },
  { title: 'Host controls', body: 'Waiting room, mute on entry, mute or remove participants and end the meeting for everyone.' },
  { title: 'Built for organisations', body: 'Teams with owner, admin and member roles, members-only meetings, and a full audit log.' },
  { title: 'Secure by default', body: 'Encrypted media (DTLS-SRTP), short-lived join tokens, hashed credentials and strict browser security headers.' },
];

export function LandingPage() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [code, setCode] = useState('');

  useEffect(() => {
    api<{ plans: PlanInfo[] }>('/plans').then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, []);

  const joinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toLowerCase().replace(/.*\/m\//, '');
    if (clean) navigate(`/m/${clean}`);
  };

  return (
    <div>
      <header className="topbar">
        <Logo />
        <div className="row">
          <a href="#pricing">Pricing</a>
          {me ? (
            <Link className="btn btn-primary" to="/app">Open Mingle</Link>
          ) : (
            <>
              <Link className="btn" to="/login">Sign in</Link>
              <Link className="btn btn-primary" to="/signup">Sign up free</Link>
            </>
          )}
        </div>
      </header>

      <section className="hero">
        <h1>Video meetings your team can rely on</h1>
        <p>Mingle gives you secure, high quality video calls with screen sharing, chat and scheduling, ready for your whole organisation.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary btn-lg" to={me ? '/app' : '/signup'}>Start a meeting</Link>
          <form onSubmit={joinByCode} className="row" style={{ flexWrap: 'nowrap' }}>
            <input aria-label="Meeting code or link" placeholder="Enter a code or link" value={code} onChange={(e) => setCode(e.target.value)} style={{ minWidth: 220 }} />
            <button className="btn btn-lg" type="submit" disabled={!code.trim()}>Join</button>
          </form>
        </div>
      </section>

      <section className="section">
        <div className="grid">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <h3>{f.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="pricing">
        <h2 style={{ textAlign: 'center', fontSize: '1.75rem' }}>Simple pricing</h2>
        <p className="muted" style={{ textAlign: 'center' }}>Per host, per month. Guests always join free.</p>
        <div className="grid">
          {plans.map((p) => (
            <div key={p.id} className={`card plan-card ${p.id === 'pro' ? 'featured' : ''}`}>
              <div className="row spread">
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                {p.id === 'pro' && <span className="badge badge-brand">Most popular</span>}
              </div>
              <div className="price">${p.monthlyPriceUsd}<span className="muted small"> /host/mo</span></div>
              <ul>
                {p.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`btn ${p.id === 'pro' ? 'btn-primary' : ''}`} to={me ? '/app' : '/signup'} style={{ width: '100%' }}>
                {p.id === 'free' ? 'Get started' : `Choose ${p.name}`}
              </Link>
            </div>
          ))}
        </div>
      </section>
      <footer className="footer">© {new Date().getFullYear()} Mingle</footer>
    </div>
  );
}
