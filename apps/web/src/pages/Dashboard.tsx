import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildIcs, formatWhen, type Meeting } from '../api';
import { useOrg } from '../components/AppShell';
import { ScheduleModal } from '../components/ScheduleModal';

function downloadIcs(m: Meeting) {
  const blob = new Blob([buildIcs(m)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${m.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'meeting'}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DashboardPage() {
  const { details } = useOrg();
  const orgId = details.org.id;
  const navigate = useNavigate();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ meetings: Meeting[] }>(`/orgs/${orgId}/meetings?scope=${scope}`);
    setMeetings(res.meetings);
  }, [orgId, scope]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const startNow = async () => {
    try {
      const { meeting } = await api<{ meeting: Meeting }>(`/orgs/${orgId}/meetings`, { body: { title: `${details.org.name} meeting` } });
      navigate(`/m/${meeting.code}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async (m: Meeting) => {
    await navigator.clipboard.writeText(m.joinUrl);
    setCopied(m.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const cancel = async (m: Meeting) => {
    if (!confirm(`Cancel "${m.title}"? People with the link will no longer be able to join.`)) return;
    await api(`/meetings/${m.code}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="stack">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Meetings</h1>
        <div className="row">
          <button className="btn" onClick={() => setScheduling(true)}>Schedule</button>
          <button className="btn btn-primary" onClick={startNow}>Start a meeting now</button>
        </div>
      </div>
      {details.org.effectivePlan === 'free' && (
        <div className="notice">
          Free plan: meetings end after {details.limits.maxMeetingMinutes} minutes.{' '}
          {details.role !== 'member' && <a href={`/app/${orgId}/billing`}>Upgrade for longer meetings</a>}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <button className={`btn btn-sm ${scope === 'upcoming' ? 'btn-primary' : ''}`} onClick={() => setScope('upcoming')}>Upcoming</button>
          <button className={`btn btn-sm ${scope === 'past' ? 'btn-primary' : ''}`} onClick={() => setScope('past')}>Past</button>
        </div>
        {meetings === null ? (
          <p className="muted">Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="muted">{scope === 'upcoming' ? 'No upcoming meetings. Start one now or schedule one for later.' : 'No past meetings yet.'}</p>
        ) : (
          meetings.map((m) => (
            <div className="meeting-item" key={m.id}>
              <div>
                <div className="row" style={{ gap: '0.5rem' }}>
                  <strong>{m.title}</strong>
                  {m.status === 'live' && <span className="badge badge-live">Live</span>}
                  {m.status === 'cancelled' && <span className="badge">Cancelled</span>}
                </div>
                <div className="small muted">
                  {formatWhen(m.scheduledStart)} · {m.durationMinutes} min · {m.code}
                  {m.hostName ? ` · Host: ${m.hostName}` : ''}
                </div>
              </div>
              {m.status !== 'cancelled' && (
                <div className="row">
                  <button className="btn btn-sm" onClick={() => copy(m)}>{copied === m.id ? 'Copied!' : 'Copy link'}</button>
                  <button className="btn btn-sm" onClick={() => downloadIcs(m)}>Add to calendar</button>
                  {scope === 'upcoming' && <button className="btn btn-sm btn-danger" onClick={() => cancel(m)}>Cancel</button>}
                  <button className="btn btn-sm btn-primary" onClick={() => navigate(`/m/${m.code}`)}>{m.status === 'live' ? 'Join' : 'Start'}</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {scheduling && (
        <ScheduleModal
          orgId={orgId}
          onClose={() => setScheduling(false)}
          onCreated={async () => {
            setScheduling(false);
            setScope('upcoming');
            await load();
          }}
        />
      )}
    </div>
  );
}
