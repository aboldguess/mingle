import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Role } from '../api';
import { useOrg } from '../components/AppShell';
import { useSession } from '../session';

interface Member { userId: string; name: string; email: string; role: Role; joinedAt: string }
interface Invite { id: string; email: string; role: Role; expiresAt: string }

export function TeamPage() {
  const { details, reload } = useOrg();
  const { me } = useSession();
  const orgId = details.org.id;
  const isAdmin = details.role !== 'member';
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMembers((await api<{ members: Member[] }>(`/orgs/${orgId}/members`)).members);
    if (isAdmin) setInvites((await api<{ invitations: Invite[] }>(`/orgs/${orgId}/invitations`)).invitations);
  }, [orgId, isAdmin]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ inviteUrl: string }>(`/orgs/${orgId}/invitations`, { body: { email, role } });
      setLastLink(res.inviteUrl);
      setEmail('');
    });
  };

  return (
    <div className="stack">
      <h1>Team</h1>
      <p className="muted">{details.usage.members} of {details.limits.maxMembers} members on the {details.limits.name} plan.</p>
      {error && <div className="error">{error}</div>}

      {isAdmin && (
        <form className="card stack" onSubmit={invite}>
          <h2>Invite someone</h2>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="email" required placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role" style={{ width: 140 }}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              {details.role === 'owner' && <option value="owner">Owner</option>}
            </select>
            <button className="btn btn-primary">Invite</button>
          </div>
          {lastLink && (
            <div className="notice">
              Invitation created. Send them this link (valid for 7 days):
              <div className="row" style={{ marginTop: '0.4rem', flexWrap: 'nowrap' }}>
                <input readOnly value={lastLink} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(lastLink)}>Copy</button>
              </div>
            </div>
          )}
        </form>
      )}

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}{m.userId === me?.user.id && <span className="muted"> (you)</span>}</td>
                <td>{m.email}</td>
                <td>
                  {isAdmin && m.userId !== me?.user.id && (m.role !== 'owner' || details.role === 'owner') ? (
                    <select value={m.role} aria-label={`Role for ${m.name}`} onChange={(e) => run(() => api(`/orgs/${orgId}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      {details.role === 'owner' && <option value="owner">Owner</option>}
                    </select>
                  ) : (
                    <span className="badge">{m.role}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {m.userId === me?.user.id ? (
                    <button className="btn btn-sm" onClick={() => confirm('Leave this organisation?') && run(async () => { await api(`/orgs/${orgId}/members/${m.userId}`, { method: 'DELETE' }); window.location.href = '/app'; })}>Leave</button>
                  ) : (
                    isAdmin && (m.role !== 'owner' || details.role === 'owner') && (
                      <button className="btn btn-sm btn-danger" onClick={() => confirm(`Remove ${m.name}?`) && run(() => api(`/orgs/${orgId}/members/${m.userId}`, { method: 'DELETE' }))}>Remove</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && invites.length > 0 && (
        <div className="card">
          <h2>Pending invitations</h2>
          <table>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td><span className="badge">{i.role}</span></td>
                  <td className="muted small">Expires {new Date(i.expiresAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-danger" onClick={() => run(() => api(`/orgs/${orgId}/invitations/${i.id}`, { method: 'DELETE' }))}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
