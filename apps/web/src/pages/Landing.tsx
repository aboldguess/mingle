import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PlanInfo } from '../api';
import { Logo } from '../components/Logo';
import { useSession } from '../session';

const FEATURES = [
  { icon: '📺', title: 'Your face on a telly', body: 'Everyone is a walking, CRT-headed avatar and your webcam is the picture on the screen. No more grid of tiny rectangles.' },
  { icon: '🗣️', title: 'Talk by walking over', body: 'Proximity voice: people get louder as you approach and fade as you wander off, panned left and right like real life. Five conversations, one room, no chaos.' },
  { icon: '🎤', title: 'Keynotes on a giant screen', body: 'Step into the glowing ring on stage and your camera or shared screen fills the auditorium, with your mic reaching every seat.' },
  { icon: '🎉', title: 'A confetti cannon', body: 'Click to launch harmless confetti at colleagues. Splats are counted. Morale is not optional.' },
  { icon: '🛂', title: 'Real events, real controls', body: 'Shareable invite links, a queue at the door, host mute and remove, members-only events, teams and roles.' },
  { icon: '🌐', title: 'Just a browser', body: 'Nothing to install. WASD to walk, mouse to look. Built on a media server that scales to hundreds of attendees.' },
];

/** Renders the real venue behind the hero, with bots milling about. Loaded lazily so the page paints first. */
function LiveBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void Promise.all([import('../world/engine'), import('../world/bots')]).then(([{ World }, { BotCrowd }]) => {
      if (disposed || !ref.current) return;
      try {
        const world = new World(ref.current, { mode: 'attract', localId: 'viewer', name: 'Viewer', color: '#ff006e' });
        const bots = new BotCrowd(world, { lobby: 12, audience: 6, keynote: true, blastPlayer: false });
        world.start();
        // Bots throw a bit of confetti at each other for show.
        const timer = setInterval(() => {
          const ids = bots.ids;
          const a = world.remotePosition(ids[Math.floor(Math.random() * ids.length)]!);
          const b = world.remotePosition(ids[Math.floor(Math.random() * ids.length)]!);
          if (a && b && a !== b && a.z > 0 && b.z > 0) {
            const from = a.clone().setY(1.5);
            const dir = b.clone().setY(1.6).sub(from).normalize();
            dir.y += 0.08;
            world.remoteBlast('show', from.addScaledVector(dir, 0.6), dir, ['#ff006e', '#ffbe0b', '#06d6a0', '#3a86ff'][Math.floor(Math.random() * 4)]!);
          }
        }, 1800);
        cleanup = () => {
          clearInterval(timer);
          bots.dispose();
          world.dispose();
        };
      } catch {
        /* No WebGL: the gradient backdrop stays. */
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return <div ref={ref} className="hero-backdrop" aria-hidden />;
}

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
    <div className="landing">
      <section className="hero-3d">
        <LiveBackdrop />
        <header className="topbar topbar-over">
          <Logo />
          <div className="row">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            {me ? (
              <Link className="btn btn-primary" to="/app">Open Mingle</Link>
            ) : (
              <>
                <Link className="btn btn-ghost" to="/login">Sign in</Link>
                <Link className="btn btn-primary" to="/signup">Sign up free</Link>
              </>
            )}
          </div>
        </header>
        <div className="hero-copy">
          <div className="sticker">MINGLE</div>
          <h1>Where Zoom Meets Doom</h1>
          <p>
            Ditch the grid of faces. Mingle drops you into a 3D venue as a walking, talking telly-headed avatar with your webcam for a face. Work the room at
            a networking event, catch a keynote in the auditorium, and pelt your colleagues with confetti.
          </p>
          <div className="row hero-ctas">
            <Link className="btn btn-primary btn-lg btn-chunky" to="/play">▶ Play the demo</Link>
            <Link className="btn btn-lg btn-chunky btn-light" to={me ? '/app' : '/signup'}>Host an event</Link>
          </div>
          <form onSubmit={joinByCode} className="row hero-join">
            <input aria-label="Event code or link" placeholder="Got an invite? Paste the code or link" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" type="submit" disabled={!code.trim()}>Join</button>
          </form>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-title">Meetings you can actually walk around in</h2>
        <div className="grid grid-3">
          {FEATURES.map((f) => (
            <div className="card feature-card" key={f.title}>
              <div className="feature-icon" aria-hidden>{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
        <div className="venues">
          <div className="venue-card venue-lobby">
            <h3>The networking lobby</h3>
            <p>High tables, a juice bar, sofas and a giant mascot statue to meet by. Drift between huddles like a real mixer.</p>
          </div>
          <div className="venue-card venue-aud">
            <h3>The auditorium</h3>
            <p>Rows of seats, a stage with a spotlight and a cinema-sized screen. The presenter’s voice reaches everyone; the audience hushes.</p>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <h2 className="section-title">Simple pricing</h2>
        <p className="muted" style={{ textAlign: 'center' }}>Per host, per month. Guests always get in free.</p>
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
      <footer className="footer">© {new Date().getFullYear()} Mingle · Where Zoom Meets Doom</footer>
    </div>
  );
}
