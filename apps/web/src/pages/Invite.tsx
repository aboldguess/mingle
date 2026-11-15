import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useSession } from '../session';

export function InvitePage() {
  const { token } = useParams();
  const { me, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ orgName: string; email: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api(`/orgs/invitations/${token}`).then(setInvite).catch((e) => setError(e.message));
  }, [token]);

  const accept = async () => {
    try {
      const res = await api<{ orgId: string }>(`/orgs/invitations/${token}/accept`, { body: {} });
      await refresh();
      navigate(`/app/${res.orgId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const here = `/invite/${token}`;

  return (
    <div className="auth-wrap">
      <div className="card auth-card stack">
        <Logo />
        {error && <div className="error">{error}</div>}
        {invite && (
          <>
            <h1>Join {invite.orgName}</h1>
            <p className="muted">You were invited as {invite.role === 'admin' ? 'an admin' : `a ${invite.role}`} ({invite.email}).</p>
            {loading ? null : me ? (
              <button className="btn btn-primary" onClick={accept}>Accept invitation</button>
            ) : (
              <div className="row">
                <Link className="btn btn-primary" to={`/signup?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(here)}`}>Create account</Link>
                <Link className="btn" to={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
