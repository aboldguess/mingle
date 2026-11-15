import { useParticipants } from '@livekit/components-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/** Who's here, plus the host's waiting room and mute/remove controls. */
export function ParticipantsPanel({ code, isHost }: { code: string; isHost: boolean }) {
  const participants = useParticipants();
  const [pending, setPending] = useState<Array<{ id: string; displayName: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    if (!isHost) return;
    try {
      setPending((await api<{ pending: typeof pending }>(`/meetings/${code}/admissions`)).pending);
    } catch {
      /* transient; next poll retries */
    }
  }, [code, isHost]);

  useEffect(() => {
    void loadPending();
    if (!isHost) return;
    const t = setInterval(loadPending, 3000);
    return () => clearInterval(t);
  }, [loadPending, isHost]);

  const act = async (path: string, body: unknown = {}) => {
    setError(null);
    try {
      await api(path, { body });
      await loadPending();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside className="host-panel world-panel" aria-label="Participants">
      {error && <div className="error">{error}</div>}
      {isHost && pending.length > 0 && (
        <>
          <h3>Waiting room ({pending.length})</h3>
          {pending.map((p) => (
            <div className="person" key={p.id}>
              <span>{p.displayName}</span>
              <span className="row" style={{ gap: '0.3rem' }}>
                <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/admissions/${p.id}`, { admit: true })}>Admit</button>
                <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/admissions/${p.id}`, { admit: false })}>Deny</button>
              </span>
            </div>
          ))}
        </>
      )}
      <h3>In the venue ({participants.length})</h3>
      {participants.map((p) => (
        <div className="person" key={p.identity}>
          <span>
            {p.name || p.identity}
            {p.isLocal && ' (you)'}
            {!p.isMicrophoneEnabled && <span className="muted"> · muted</span>}
          </span>
          {isHost && !p.isLocal && (
            <span className="row" style={{ gap: '0.3rem' }}>
              {p.isMicrophoneEnabled && <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/participants/${encodeURIComponent(p.identity)}/mute`)}>Mute</button>}
              <button className="btn btn-sm" onClick={() => confirm(`Remove ${p.name || 'this person'}?`) && act(`/meetings/${code}/participants/${encodeURIComponent(p.identity)}/remove`)}>Remove</button>
            </span>
          )}
        </div>
      ))}
    </aside>
  );
}
