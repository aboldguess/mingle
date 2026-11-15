import { Navigate } from 'react-router-dom';
import { useSession } from '../session';

export function HomeRedirect() {
  const { me } = useSession();
  const first = me?.orgs[0];
  if (!first) return <div className="auth-wrap muted">You are not in any organisation yet.</div>;
  return <Navigate to={`/app/${first.id}`} replace />;
}
