import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarLook, CamFrame } from '../world/avatar';
import { AvatarColorPicker, LookFields, ProfileFields, type ProfileInput, saveProfile } from './AvatarColorPicker';
import { AvatarPreview } from './AvatarPreview';
import { CamFramer } from './CamFramer';

/** What you chose before walking in. */
export interface JoinChoices {
  username: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoDeviceId: string;
  audioDeviceId: string;
}

const KEY = 'mingle.prejoin';

function savedChoices(defaultName: string): JoinChoices {
  const base: JoinChoices = { username: defaultName, videoEnabled: true, audioEnabled: true, videoDeviceId: '', audioDeviceId: '' };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      username: defaultName || (typeof s.username === 'string' ? s.username : ''),
      videoEnabled: s.videoEnabled !== false,
      audioEnabled: s.audioEnabled !== false,
      videoDeviceId: typeof s.videoDeviceId === 'string' ? s.videoDeviceId : '',
      audioDeviceId: typeof s.audioDeviceId === 'string' ? s.audioDeviceId : '',
    };
  } catch {
    return base;
  }
}

/**
 * The pre-join "dressing room": name, camera and mic, webcam framing for your
 * telly head, and avatar customisation, all with a live 3D preview.
 */
export function PreJoinStudio(props: {
  defaultName: string;
  color: string;
  onColor: (c: string) => void;
  profile: ProfileInput;
  onProfile: (p: ProfileInput) => void;
  joinLabel: string;
  /** Solo demo: no microphone needed. */
  withMic?: boolean;
  busy?: boolean;
  onJoin: (choices: JoinChoices) => void;
}) {
  const withMic = props.withMic !== false;
  const [choices, setChoices] = useState(() => savedChoices(props.defaultName));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [tab, setTab] = useState<'look' | 'tag'>('look');
  const levelRaf = useRef(0);

  const update = (c: Partial<JoinChoices>) =>
    setChoices((prev) => {
      const next = { ...prev, ...c };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...next, username: next.username }));
      } catch {
        /* storage blocked */
      }
      return next;
    });

  const setLook = (look: AvatarLook) => {
    const p = { ...props.profile, look };
    props.onProfile(p);
    saveProfile(p);
  };
  const setCam = (cam: CamFrame) => setLook({ ...props.profile.look, cam });

  // Camera preview.
  useEffect(() => {
    if (!choices.videoEnabled) {
      setStream(null);
      return;
    }
    let live: MediaStream | null = null;
    let cancelled = false;
    setCamError(null);
    navigator.mediaDevices
      ?.getUserMedia({ video: { deviceId: choices.videoDeviceId ? { exact: choices.videoDeviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        live = s;
        setStream(s);
        void navigator.mediaDevices.enumerateDevices().then(setDevices);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setStream(null);
        setCamError(e.name === 'NotAllowedError' ? 'Camera blocked. Allow it in your browser’s address bar, or join with it off.' : `Camera problem: ${e.message}`);
      });
    if (!navigator.mediaDevices) setCamError('This browser can’t use a camera here (it needs https or localhost).');
    return () => {
      cancelled = true;
      live?.getTracks().forEach((t) => t.stop());
    };
  }, [choices.videoEnabled, choices.videoDeviceId]);

  // Mic level meter, so you can see it hears you.
  useEffect(() => {
    if (!withMic || !choices.audioEnabled || !navigator.mediaDevices) {
      setLevel(0);
      return;
    }
    let live: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: choices.audioDeviceId ? { exact: choices.audioDeviceId } : undefined } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        live = s;
        void navigator.mediaDevices.enumerateDevices().then(setDevices);
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel((l) => Math.max(peak / 128, l * 0.85));
          levelRaf.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setLevel(0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(levelRaf.current);
      live?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [withMic, choices.audioEnabled, choices.audioDeviceId]);

  // A hidden video element feeds the 3D preview's telly.
  const texVideo = useMemo(() => {
    if (!stream) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    void v.play().catch(() => {});
    return v;
  }, [stream]);

  const cams = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choices.username.trim()) return;
    // Hand the devices over: the venue opens its own camera and mic.
    stream?.getTracks().forEach((t) => t.stop());
    props.onJoin({ ...choices, username: choices.username.trim() });
  };

  return (
    <form className="studio" onSubmit={join}>
      <div className="studio-preview">
        <AvatarPreview name={choices.username || 'You'} color={props.color} look={props.profile.look} video={texVideo} />
        <div className="studio-devices">
          <button type="button" className={`btn btn-sm ${choices.videoEnabled ? 'btn-on' : ''}`} onClick={() => update({ videoEnabled: !choices.videoEnabled })} aria-pressed={choices.videoEnabled}>
            {choices.videoEnabled ? '📹 Camera on' : '🚫 Camera off'}
          </button>
          {withMic && (
            <button type="button" className={`btn btn-sm ${choices.audioEnabled ? 'btn-on' : ''}`} onClick={() => update({ audioEnabled: !choices.audioEnabled })} aria-pressed={choices.audioEnabled}>
              {choices.audioEnabled ? '🎙️ Mic on' : '🔇 Mic off'}
              {choices.audioEnabled && <span className="mic-meter" aria-hidden><span style={{ width: `${Math.min(100, level * 180)}%` }} /></span>}
            </button>
          )}
          {cams.length > 1 && choices.videoEnabled && (
            <select value={choices.videoDeviceId} onChange={(e) => update({ videoDeviceId: e.target.value })} aria-label="Camera">
              <option value="">Default camera</option>
              {cams.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
              ))}
            </select>
          )}
          {withMic && mics.length > 1 && choices.audioEnabled && (
            <select value={choices.audioDeviceId} onChange={(e) => update({ audioDeviceId: e.target.value })} aria-label="Microphone">
              <option value="">Default microphone</option>
              {mics.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
          )}
        </div>
        {camError && <div className="error small">{camError}</div>}
        {choices.videoEnabled && !camError && <CamFramer stream={stream} value={props.profile.look.cam} onChange={setCam} />}
      </div>

      <div className="studio-form stack">
        <label>
          Your name
          <input value={choices.username} maxLength={40} required onChange={(e) => update({ username: e.target.value })} placeholder="What should your name tag say?" />
        </label>
        <div className="studio-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'look'} className={tab === 'look' ? 'on' : ''} onClick={() => setTab('look')}>Your avatar</button>
          <button type="button" role="tab" aria-selected={tab === 'tag'} className={tab === 'tag' ? 'on' : ''} onClick={() => setTab('tag')}>Name tag & card</button>
        </div>
        {tab === 'look' ? (
          <>
            <AvatarColorPicker value={props.color} onChange={props.onColor} />
            <LookFields value={props.profile.look} onChange={setLook} />
          </>
        ) : (
          <ProfileFields value={props.profile} onChange={props.onProfile} />
        )}
        <button className="btn btn-primary btn-lg" type="submit" disabled={props.busy || !choices.username.trim()}>{props.joinLabel}</button>
      </div>
    </form>
  );
}
