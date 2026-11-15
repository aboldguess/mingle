import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, type OrgDetails } from '../api';
import { useSession } from '../session';
import { Logo } from './Logo';

export interface OrgOutlet {
  details: OrgDetails;
  reload: () => Promise<void>;
}

export function useOrg(): OrgOutlet {
  return useOutletContext<OrgOutlet>();
}

export function AppShell() {
  const { orgId } = useParams();
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const [details, setDetails] = useState<OrgDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetails(await api<OrgDetails>(`/orgs/${orgId}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="card stack">
          <p className="error">{error}</p>
          <button className="btn" onClick={() => navigate('/app')}>Go to my workspace</button>
        </div>
      </div>
    );
  }
  if (!details || !me) return <div className="auth-wrap muted">Loading…</div>;
  const isAdmin = details.role !== 'member';

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo to={`/app/${orgId}`} />
        {me.orgs.length > 1 ? (
          <select aria-label="Switch organisation" value={orgId} onChange={(e) => navigate(`/app/${e.target.value}`)} style={{ marginTop: '1rem' }}>
            {me.orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        ) : (
          <div className="muted small" style={{ marginTop: '1rem' }}>{details.org.name}</div>
        )}
        <nav>
          <NavLink end to={`/app/${orgId}`}>Meetings</NavLink>
          <NavLink to={`/app/${orgId}/team`}>Team</NavLink>
          {isAdmin && <NavLink to={`/app/${orgId}/billing`}>Plan &amp; billing</NavLink>}
          {isAdmin && <NavLink to={`/app/${orgId}/settings`}>Settings</NavLink>}
          {isAdmin && <NavLink to={`/app/${orgId}/audit`}>Audit log</NavLink>}
        </nav>
        <div className="spacer" />
        <div className="small muted" style={{ marginTop: '1rem' }}>
          <div>{me.user.name}</div>
          <div>{me.user.email}</div>
          <div className="row" style={{ marginTop: '0.25rem' }}>
            <span className="badge badge-brand">{details.limits.name}</span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet context={{ details, reload } satisfies OrgOutlet} />
      </main>
    </div>
  );
}
