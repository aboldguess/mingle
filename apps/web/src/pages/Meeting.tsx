import { PreJoin, type LocalUserChoices } from '@livekit/components-react';
import { DisconnectReason, Room, RoomEvent, VideoPresets } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, formatWhen, type JoinResult } from '../api';
import { AvatarColorPicker, savedAvatarColor } from '../components/AvatarColorPicker';
import { Logo } from '../components/Logo';
import { useSession } from '../session';
import { venueAudioContext } from '../world/session';
import { WorldView } from '../world/WorldView';

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
  const [color, setColor] = useState(savedAvatarColor);

  useEffect(() => {
    if (sessionLoading) return;
    api<MeetingInfo>(`/meetings/${code}`)
      .then((m) => {
        setInfo(m);
        if (m.status === 'cancelled') setPhase({ kind: 'error', message: 'This event was cancelled.' });
        else if (!me && !m.guestsAllowed) setPhase({ kind: 'error', message: 'Sign in to join this event.', signIn: true });
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
    return <LiveVenue info={info} join={phase.join} choices={phase.choices} color={color} onLeave={(reason) => setPhase({ kind: 'left', reason })} />;
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
                joinLabel={info?.isHost ? 'Open the venue' : 'Enter the venue'}
                userLabel="Your name"
                onSubmit={join}
                onError={(e) => setJoinError(`Camera or microphone problem: ${e.message}. You can still join with them off.`)}
              />
            </div>
            <AvatarColorPicker value={color} onChange={setColor} />
            <p className="small muted" style={{ margin: 0 }}>Your webcam becomes the face on your avatar’s telly head. Walk up to people to talk.</p>
            {!me && <p className="small muted">Have an account? <Link to={`/login?next=/m/${code}`}>Sign in</Link> to join as yourself.</p>}
          </>
        )}
        {phase.kind === 'waiting' && (
          <div className="notice">You’re in the queue at the door. The host will let you in shortly, so keep this page open.</div>
        )}
        {phase.kind === 'denied' && <div className="error">The host did not let you into this event.</div>}
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
      return 'The host removed you from the event.';
    case DisconnectReason.ROOM_DELETED:
      return 'The event has ended.';
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'You joined this event from another tab or device.';
    case DisconnectReason.CLIENT_INITIATED:
      return 'You left the venue.';
    default:
      return 'You were disconnected from the event.';
  }
}

/** Connects to the LiveKit room, then drops you into the 3D venue. */
function LiveVenue({ info, join, choices, color, onLeave }: { info: MeetingInfo; join: JoinResult; choices: LocalUserChoices; color: string; onLeave: (reason: string) => void }) {
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leftRef = useRef(false);

  useEffect(() => {
    const r = new Room({
      // We manage quality ourselves from distance in the 3D world.
      adaptiveStream: false,
      dynacast: true,
      // Mix remote voices through our AudioContext so the venue can pan and fade them.
      webAudioMix: { audioContext: venueAudioContext() },
      videoCaptureDefaults: { deviceId: choices.videoDeviceId || undefined, resolution: VideoPresets.h540.resolution },
      audioCaptureDefaults: { deviceId: choices.audioDeviceId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: { simulcast: true, videoCodec: 'vp8' },
    });
    let cancelled = false;
    leftRef.current = false;
    r.on(RoomEvent.Disconnected, (reason) => {
      // Ignore rooms this effect already tore down, and leaves we started ourselves.
      if (cancelled || leftRef.current) return;
      leftRef.current = true;
      onLeave(reasonText(reason));
    });
    (async () => {
      try {
        await r.connect(join.serverUrl, join.token);
        if (cancelled) return;
        setRoom(r);
        // Turn devices on after connecting so a blocked camera never blocks joining.
        await r.localParticipant.setCameraEnabled(choices.videoEnabled).catch(() => {});
        await r.localParticipant.setMicrophoneEnabled(choices.audioEnabled && !join.muteOnEntry).catch(() => {});
      } catch (e) {
        if (!cancelled) setError(`Could not connect to the venue: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      void r.disconnect();
    };
    // Connect once per join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join]);

  const endForAll = async () => {
    if (!confirm('End the event for everyone?')) return;
    await api(`/meetings/${info.code}/end`, { body: {} });
    navigate('/app');
  };

  if (error) {
    return (
      <div className="prejoin">
        <div className="card prejoin-card stack">
          <div className="error">{error}</div>
          <button className="btn" onClick={() => onLeave('Connection failed.')}>Back</button>
        </div>
      </div>
    );
  }
  if (!room) return <div className="world-loading">Warming up the venue…</div>;

  return (
    <WorldView
      mode="live"
      room={room}
      name={choices.username || room.localParticipant.name || 'Guest'}
      color={color}
      title={info.title}
      code={info.code}
      isHost={join.isHost}
      planLimitEndsAt={join.planLimitEndsAt}
      onLeave={() => {
        leftRef.current = true;
        onLeave('You left the venue.');
      }}
      onEndForAll={join.isHost ? endForAll : undefined}
    />
  );
}

