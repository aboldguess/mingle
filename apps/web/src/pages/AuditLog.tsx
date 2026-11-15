import { useEffect, useState } from 'react';
import { api } from '../api';
import { useOrg } from '../components/AppShell';

interface Entry { id: string; action: string; target: string | null; ip: string | null; createdAt: string; actorName: string | null; actorEmail: string | null }

export function AuditLogPage() {
  const { details } = useOrg();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ entries: Entry[] }>(`/orgs/${details.org.id}/audit-logs`).then((r) => setEntries(r.entries)).catch((e) => setError(e.message));
  }, [details.org.id]);

  return (
    <div className="stack">
      <h1>Audit log</h1>
      <p className="muted">The latest 100 security and administration events in this organisation.</p>
      {error && <div className="error">{error}</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="small">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="small">{e.actorName ?? 'System'}</td>
                <td><code>{e.action}</code></td>
                <td className="small">{e.target}</td>
                <td className="small muted">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
