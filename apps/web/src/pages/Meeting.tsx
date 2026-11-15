import { LiveKitRoom, PreJoin, RoomAudioRenderer, VideoConference, useParticipants, type LocalUserChoices } from '@livekit/components-react';
import { DisconnectReason, type RoomOptions, VideoPresets } from 'livekit-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, formatWhen, type JoinResult } from '../api';
import { Logo } from '../components/Logo';
import { useSession } from '../session';

interface MeetingInfo {
  code: string;
  title: string;
  orgName: string;
  hostName: string | null;
  scheduledStart: string | null;
  status: string;
  guestsAllowed: boolean;
  waitingRoom: boolean;
  isHost: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; signIn?: boolean }
  | { kind: 'prejoin' }
  | { kind: 'waiting'; requestId: string; choices: LocalUserChoices }
  | { kind: 'denied' }
  | { kind: 'room'; join: JoinResult; choices: LocalUserChoices }
  | { kind: 'left'; reason: string };

export function MeetingPage() {
  const { code = '' } = useParams();
  const { me, loading: sessionLoading } = useSession();
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    api<MeetingInfo>(`/meetings/${code}`)
      .then((m) => {
        setInfo(m);
        if (m.status === 'cancelled') setPhase({ kind: 'error', message: 'This meeting was cancelled.' });
        else if (!me && !m.guestsAllowed) setPhase({ kind: 'error', message: 'Sign in to join this meeting.', signIn: true });
        else setPhase({ kind: 'prejoin' });
      })
      .catch((e) => setPhase({ kind: 'error', message: e.message }));
  }, [code, me, sessionLoading]);

  const join = async (choices: LocalUserChoices) => {
    setJoinError(null);
    try {
      const res = await fetch(`/api/meetings/${code}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: choices.username || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error?.code, data.error?.message);
      if (res.status === 202) setPhase({ kind: 'waiting', requestId: data.requestId, choices });
      else setPhase({ kind: 'room', join: data, choices });
    } catch (e) {
      setJoinError((e as Error).message);
    }
  };

  // Poll while waiting for the host to admit us.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const timer = setInterval(async () => {
      try {
        const res = await api<{ status: string }>(`/meetings/${code}/admission/${phase.requestId}`);
        if (res.status === 'admitted') setPhase({ kind: 'room', join: res as unknown as JoinResult, choices: phase.choices });
        if (res.status === 'denied') setPhase({ kind: 'denied' });
      } catch (e) {
        setPhase({ kind: 'error', message: (e as Error).message });
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [phase, code]);

  if (phase.kind === 'room' && info) {
    return <Room info={info} join={phase.join} choices={phase.choices} onLeave={(reason) => setPhase({ kind: 'left', reason })} />;
  }

  return (
    <div className="prejoin">
      <div className="card prejoin-card stack">
        <Logo />
        {info && (
          <div>
            <h1 style={{ marginBottom: '0.2rem' }}>{info.title}</h1>
            <div className="muted small">
              {info.orgName}
              {info.hostName ? ` · Hosted by ${info.hostName}` : ''}
              {info.scheduledStart ? ` · ${formatWhen(info.scheduledStart)}` : ''}
            </div>
          </div>
        )}
        {phase.kind === 'loading' && <p className="muted">Loading…</p>}
        {phase.kind === 'error' && (
          <>
            <div className="error">{phase.message}</div>
            {phase.signIn && <Link className="btn btn-primary" to={`/login?next=/m/${code}`}>Sign in</Link>}
          </>
        )}
        {phase.kind === 'prejoin' && (
          <>
            {joinError && <div className="error" role="alert">{joinError}</div>}
            <div data-lk-theme="default" style={{ borderRadius: 10, overflow: 'hidden' }}>
              <PreJoin
                defaults={{ username: me?.user.name ?? '', videoEnabled: true, audioEnabled: true }}
                persistUserChoices
                joinLabel={info?.isHost ? 'Start meeting' : 'Join meeting'}
                userLabel="Your name"
                onSubmit={join}
                onError={(e) => setJoinError(`Camera or microphone problem: ${e.message}. You can still join with them off.`)}
              />
            </div>
            {!me && <p className="small muted">Have an account? <Link to={`/login?next=/m/${code}`}>Sign in</Link> to join as yourself.</p>}
          </>
        )}
        {phase.kind === 'waiting' && (
          <div className="notice">Waiting for the host to let you in. Keep this page open.</div>
        )}
        {phase.kind === 'denied' && <div className="error">The host did not admit you to this meeting.</div>}
        {phase.kind === 'left' && (
          <>
            <div className="notice">{phase.reason}</div>
            <div className="row">
              <button className="btn btn-primary" onClick={() => setPhase({ kind: 'prejoin' })}>Rejoin</button>
              <Link className="btn" to={me ? '/app' : '/'}>Back to {me ? 'dashboard' : 'home'}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function reasonText(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'The host removed you from the meeting.';
    case DisconnectReason.ROOM_DELETED:
      return 'The meeting has ended.';
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'You joined this meeting from another tab or device.';
    case DisconnectReason.CLIENT_INITIATED:
      return 'You left the meeting.';
    default:
      return 'You were disconnected from the meeting.';
  }
}

function Room({ info, join, choices, onLeave }: { info: MeetingInfo; join: JoinResult; choices: LocalUserChoices; onLeave: (reason: string) => void }) {
  const options = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { deviceId: choices.videoDeviceId || undefined, resolution: VideoPresets.h720.resolution },
      audioCaptureDefaults: { deviceId: choices.audioDeviceId || undefined, echoCancellation: true, noiseSuppression: true },
      publishDefaults: { simulcast: true, videoCodec: 'vp8' },
    }),
    [choices],
  );
  const [showPanel, setShowPanel] = useState(join.isHost);

  return (
    <LiveKitRoom
      serverUrl={join.serverUrl}
      token={join.token}
      connect
      video={choices.videoEnabled}
      audio={choices.audioEnabled && !join.muteOnEntry}
      options={options}
      onDisconnected={(reason) => onLeave(reasonText(reason))}
      data-lk-theme="default"
      className="room"
    >
      <RoomBar info={info} join={join} onTogglePanel={() => setShowPanel((s) => !s)} />
      <div className="room-body">
        <div className="room-stage">
          <VideoConference />
        </div>
        {showPanel && <ParticipantsPanel code={info.code} isHost={join.isHost} />}
      </div>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function useCountdown(endsAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
}

function RoomBar({ info, join, onTogglePanel }: { info: MeetingInfo; join: JoinResult; onTogglePanel: () => void }) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const secondsLeft = useCountdown(join.planLimitEndsAt);
  const participants = useParticipants();

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/m/${info.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const endForAll = async () => {
    if (!confirm('End the meeting for everyone?')) return;
    await api(`/meetings/${info.code}/end`, { body: {} });
    navigate('/app');
  };

  return (
    <div className="room-bar">
      <div className="row">
        <strong>{info.title}</strong>
        <span className="muted">{info.code}</span>
        {secondsLeft !== null && (
          <span className={secondsLeft < 300 ? 'timer-warning' : 'muted'} title="Free plan meeting limit">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} left
          </span>
        )}
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={copyLink}>{copied ? 'Link copied' : 'Copy invite link'}</button>
        <button className="btn btn-sm" onClick={onTogglePanel}>People ({participants.length})</button>
        {join.isHost && <button className="btn btn-sm" style={{ color: '#f87171' }} onClick={endForAll}>End for all</button>}
      </div>
    </div>
  );
}

function ParticipantsPanel({ code, isHost }: { code: string; isHost: boolean }) {
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
    <aside className="host-panel" aria-label="Participants">
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
      <h3>In the meeting ({participants.length})</h3>
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
