import { RoomContext } from '@livekit/components-react';
import { type Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ParticipantsPanel } from '../components/ParticipantsPanel';
import { BotCrowd } from './bots';
import { World } from './engine';
import { type ChatLine, WorldSession } from './session';
import type { Zone } from './venue';

export interface WorldViewProps {
  mode: 'solo' | 'live';
  name: string;
  color: string;
  title: string;
  /** Live mode only. */
  room?: Room;
  code?: string;
  isHost?: boolean;
  planLimitEndsAt?: string | null;
  onLeave: () => void;
  onEndForAll?: () => void;
}

const EMOTES = ['👋', '👏', '😂', '❤️', '🔥', '🎉'];
const ZONE_LABEL: Record<Zone, string> = { lobby: 'Networking lobby', auditorium: 'Auditorium', stage: 'On stage' };

interface Toast {
  id: number;
  text: string;
}

/**
 * The playable venue: a full-screen 3D view plus a HUD with your face cam,
 * mic and camera toggles, emotes, chat, minimap and the people list.
 */
export function WorldView(props: WorldViewProps) {
  const { mode, room } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const worldRef = useRef<World | null>(null);
  const sessionRef = useRef<WorldSession | null>(null);
  const botsRef = useRef<BotCrowd | null>(null);
  const soloCamRef = useRef<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);

  const [locked, setLocked] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [zone, setZone] = useState<Zone>('lobby');
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false);
  const [splat, setSplat] = useState<{ by: string; at: number } | null>(null);
  const [timesSplatted, setTimesSplatted] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [, setTick] = useState(0);
  const [splats, setSplats] = useState(0);
  const [soloCam, setSoloCam] = useState(false);
  const [thirdPerson, setThirdPerson] = useState(false);
  const [copied, setCopied] = useState(false);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const toast = useCallback((text: string) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const pushChat = useCallback((line: ChatLine) => setChat((c) => [...c.slice(-40), line]), []);

  // Build the world once.
  useEffect(() => {
    const container = containerRef.current!;
    const world = new World(container, {
      mode: 'play',
      localId: room?.localParticipant.identity ?? 'me',
      name: props.name,
      color: props.color,
    });
    worldRef.current = world;
    world.events.onPointerLockChange = setLocked;
    world.events.onZoneChange = (z) => {
      setZone(z);
      if (z === 'stage') toast(mode === 'live' ? 'You’re on stage! Your camera is on the big screen and your mic fills the hall. Press P to share your screen.' : 'You’re on stage! Turn your camera on to appear on the big screen.');
    };

    if (mode === 'live' && room) {
      const session = new WorldSession(room, world, props.color);
      sessionRef.current = session;
      (window as unknown as { __mingleSession?: WorldSession }).__mingleSession = session;
      session.events = {
        onChat: pushChat,
        onRosterChange: rerender,
        onSplatted: (by) => setSplat({ by, at: Date.now() }),
        onScreenOwner: (who) => who && toast(`${who} is on the big screen`),
      };
      world.events.onHit = ((orig) => (id: string) => {
        orig?.(id);
        setSplats((n) => n + 1);
      })(world.events.onHit);
    } else {
      const bots = new BotCrowd(world, { lobby: 9, audience: 7, keynote: true, blastPlayer: true });
      botsRef.current = bots;
      world.events.onHit = (id) => {
        bots.react(id);
        setSplats((n) => n + 1);
      };
      world.events.onLocalHit = (id) => setSplat({ by: bots.nameOf(id) ?? 'Someone', at: Date.now() });
      pushChat({ id: Math.random(), from: '', color: '#fff', text: 'Solo demo: everyone here is a bot. Host an event to invite real people.', at: Date.now(), system: true });
    }
    world.start();
    // Handy for debugging and the browser smoke tests.
    (window as unknown as { __mingleWorld?: World }).__mingleWorld = world;

    const mapTimer = setInterval(() => {
      const ctx = minimapRef.current?.getContext('2d');
      if (ctx) world.drawMinimap(ctx, (id) => ({ color: sessionRef.current?.colorOf(id) ?? world.getAvatar(id)?.color ?? '#fff' }));
      setThirdPerson(world.thirdPerson);
    }, 120);

    return () => {
      clearInterval(mapTimer);
      setChat([]);
      sessionRef.current?.dispose();
      sessionRef.current = null;
      botsRef.current?.dispose();
      botsRef.current = null;
      soloCamRef.current?.stream.getTracks().forEach((t) => t.stop());
      soloCamRef.current = null;
      world.dispose();
      worldRef.current = null;
    };
    // The world is built once per mount; name/colour changes are not live-updated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, mode]);

  // Keep the self-view in sync with whichever camera is live.
  const local = room?.localParticipant;
  const camOn = mode === 'live' ? Boolean(local?.isCameraEnabled) : soloCam;
  const micOn = mode === 'live' ? Boolean(local?.isMicrophoneEnabled) : false;
  const sharing = Boolean(local?.isScreenShareEnabled);
  useEffect(() => {
    const el = selfViewRef.current;
    if (!el) return;
    const src = mode === 'live' ? sessionRef.current?.localVideo?.srcObject : soloCamRef.current?.stream;
    if (el.srcObject !== (src ?? null)) el.srcObject = (src as MediaStream | undefined) ?? null;
  });

  // Live room: re-render on local track changes so buttons stay honest.
  useEffect(() => {
    if (!room) return;
    const events = [RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted] as const;
    for (const e of events) room.on(e, rerender);
    return () => {
      for (const e of events) room.off(e, rerender);
    };
  }, [room, rerender]);

  // Solo mode: show your own camera on the big screen while on stage.
  useEffect(() => {
    const world = worldRef.current;
    if (mode !== 'solo' || !world) return;
    if (zone === 'stage' && soloCamRef.current) world.setScreenVideo(soloCamRef.current.video);
    else botsRef.current?.restoreScreen();
  }, [zone, soloCam, mode]);

  const resumeAudio = () => {
    void sessionRef.current?.audioContext.resume();
    void room?.startAudio();
  };

  const toggleMic = async () => {
    if (!local) return toast('Mic needs a live event. This is the solo demo.');
    try {
      await local.setMicrophoneEnabled(!local.isMicrophoneEnabled);
    } catch (e) {
      toast(`Microphone problem: ${(e as Error).message}`);
    }
    rerender();
  };

  const toggleCam = async () => {
    const world = worldRef.current;
    if (mode === 'solo') {
      if (soloCamRef.current) {
        soloCamRef.current.stream.getTracks().forEach((t) => t.stop());
        soloCamRef.current = null;
        world?.localAvatar.setVideo(null);
        setSoloCam(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        soloCamRef.current = { stream, video };
        world?.localAvatar.setVideo(video);
        setSoloCam(true);
        toast('Camera on. Press V to see your own telly head.');
      } catch (e) {
        toast(`Camera problem: ${(e as Error).message}`);
      }
      return;
    }
    if (!local) return;
    try {
      await local.setCameraEnabled(!local.isCameraEnabled);
    } catch (e) {
      toast(`Camera problem: ${(e as Error).message}`);
    }
    rerender();
  };

  const toggleShare = async () => {
    if (!local) return toast('Screen sharing needs a live event.');
    if (!sharing && worldRef.current?.localZone !== 'stage') return toast('Walk onto the stage to share your screen.');
    try {
      worldRef.current?.unlock();
      await local.setScreenShareEnabled(!sharing, { audio: true });
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') toast(`Screen share problem: ${(e as Error).message}`);
    }
    rerender();
  };

  const emote = (e: string) => {
    if (sessionRef.current) sessionRef.current.emote(e);
    else worldRef.current?.localAvatar.emote(e);
  };

  const openChat = () => {
    const world = worldRef.current;
    if (world) {
      world.inputEnabled = false;
      world.clearKeys();
    }
    setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const closeChat = (relock: boolean) => {
    setChatOpen(false);
    setChatText('');
    const world = worldRef.current;
    if (world) {
      world.inputEnabled = true;
      if (relock && !world.isLocked) void world.lock();
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatText.trim();
    if (text) {
      if (sessionRef.current) sessionRef.current.chat(text);
      else {
        worldRef.current?.localAvatar.say(text);
        pushChat({ id: Date.now(), from: props.name, color: props.color, text, at: Date.now() });
      }
    }
    closeChat(true);
  };

  const leave = () => {
    worldRef.current?.unlock();
    if (room) void room.disconnect();
    props.onLeave();
  };

  // HUD keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (typing) return;
      if (e.code === 'Enter' || e.code === 'KeyT') {
        e.preventDefault();
        openChat();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        // Free the mouse so the list can be clicked.
        setRosterOpen((o) => {
          if (!o) worldRef.current?.unlock();
          return !o;
        });
      } else if (/^Digit[1-6]$/.test(e.code)) {
        emote(EMOTES[Number(e.code.slice(5)) - 1]!);
      } else if (e.code === 'KeyH') setShowHelp((h) => !h);
      else if (e.code === 'KeyM') void toggleMic();
      else if (e.code === 'KeyC') void toggleCam();
      else if (e.code === 'KeyP') void toggleShare();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Fade the splat overlay.
  useEffect(() => {
    if (!splat) return;
    setTimesSplatted((n) => n + 1);
    const t = setTimeout(() => setSplat(null), 1600);
    return () => clearTimeout(t);
  }, [splat]);

  const secondsLeft = useCountdown(props.planLimitEndsAt ?? null);
  const recentChat = chat.filter((c) => chatOpen || Date.now() - c.at < 12000).slice(-7);
  const peopleCount = mode === 'live' ? (room?.remoteParticipants.size ?? 0) + 1 : (botsRef.current?.ids.length ?? 0) + 1;

  const copyLink = async () => {
    if (!props.code) return;
    await navigator.clipboard.writeText(`${window.location.origin}/m/${props.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hud = (
    <div className="world" onMouseDown={resumeAudio} data-splatted={timesSplatted}>
      <div ref={containerRef} className="world-stage" />

      {/* Top left: where am I */}
      <div className="hud hud-top-left">
        <div className="hud-title">
          <span className="hud-brand">MINGLE</span>
          <strong>{props.title}</strong>
        </div>
        <div className="row hud-chips">
          <span className={`chip chip-${zone}`}>{ZONE_LABEL[zone]}</span>
          {mode === 'solo' && <span className="chip">Solo demo</span>}
          {secondsLeft !== null && <span className={`chip ${secondsLeft < 300 ? 'chip-warn' : ''}`}>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} left</span>}
          {props.code && <button className="chip chip-btn" onClick={copyLink}>{copied ? 'Link copied!' : 'Copy invite link'}</button>}
        </div>
      </div>

      {/* Top right: minimap and people */}
      <div className="hud hud-top-right">
        <canvas ref={minimapRef} width={160} height={256} className="minimap" aria-label="Map" />
        <button className="chip chip-btn" onClick={() => setRosterOpen((o) => !o)}>People ({peopleCount}) · Tab</button>
        <div className="chip">Confetti landed: {splats}</div>
      </div>

      {/* Crosshair */}
      {locked && <div className="crosshair" aria-hidden />}

      {/* Toasts */}
      <div className="hud-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className="hud-toast" key={t.id}>{t.text}</div>
        ))}
      </div>

      {/* Chat */}
      <div className="hud hud-chat">
        {recentChat.map((c) => (
          <div key={c.id} className={`chat-line ${c.system ? 'chat-system' : ''}`}>
            {!c.system && <b style={{ color: c.color }}>{c.from}: </b>}
            {c.text}
          </div>
        ))}
        {chatOpen ? (
          <form onSubmit={sendChat}>
            <input
              ref={chatInputRef}
              className="chat-input"
              value={chatText}
              maxLength={280}
              placeholder="Say something… (Enter to send, Esc to cancel)"
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && closeChat(false)}
              onBlur={() => !chatText && closeChat(false)}
            />
          </form>
        ) : (
          <div className="chat-hint">Enter to chat</div>
        )}
      </div>

      {/* Bottom bar: your face, controls, emotes */}
      <div className="hud hud-bottom">
        <div className="selfview" title="Your face, as others see it">
          <video ref={selfViewRef} muted playsInline autoPlay style={{ display: camOn ? 'block' : 'none' }} />
          {!camOn && <div className="selfview-off">📺</div>}
          <span className="selfview-name">{props.name}</span>
        </div>
        <div className="hud-buttons">
          <button className={`hud-btn ${micOn ? 'on' : 'off'}`} onClick={toggleMic} title="Microphone (M)">{micOn ? '🎙️' : '🔇'}<span>Mic</span></button>
          <button className={`hud-btn ${camOn ? 'on' : 'off'}`} onClick={toggleCam} title="Camera (C)">{camOn ? '📹' : '🚫'}<span>Cam</span></button>
          <button className={`hud-btn ${sharing ? 'on' : ''}`} onClick={toggleShare} disabled={!sharing && zone !== 'stage'} title={zone === 'stage' ? 'Share your screen on the big screen (P)' : 'Walk onto the stage to present'}>🖥️<span>{sharing ? 'Stop' : 'Present'}</span></button>
          <button className={`hud-btn ${thirdPerson ? 'on' : ''}`} onClick={() => worldRef.current && (worldRef.current.thirdPerson = !worldRef.current.thirdPerson)} title="Switch first/third person (V)">👀<span>View</span></button>
          <span className="hud-sep" />
          {EMOTES.map((e, i) => (
            <button key={e} className="hud-btn emote" onClick={() => emote(e)} title={`Emote (${i + 1})`}>{e}<span>{i + 1}</span></button>
          ))}
          <span className="hud-sep" />
          {props.isHost && props.onEndForAll && <button className="hud-btn danger" onClick={props.onEndForAll} title="End the event for everyone">⏹️<span>End</span></button>}
          <button className="hud-btn danger" onClick={leave} title="Leave">🚪<span>Leave</span></button>
        </div>
      </div>

      {/* Splat! */}
      {splat && (
        <div className="splat" key={splat.at}>
          <div className="splat-text">🎉 {splat.by} confetti’d you!</div>
        </div>
      )}

      {/* Click to play */}
      {!locked && !chatOpen && !showHelp && (
        <div className="hud-resume">Click the view to play · <kbd>H</kbd> help</div>
      )}
      {showHelp && !chatOpen && (
        <div className="hud-pause" onClick={(e) => e.target === e.currentTarget && setShowHelp(false)}>
          <div className="pause-card">
            <h2>Where Zoom Meets Doom</h2>
            <p className="muted">Walk up to people to talk. Head through the big doors for the keynote.</p>
            <button className="btn btn-primary btn-lg" onClick={() => { resumeAudio(); setShowHelp(false); void worldRef.current?.lock(); }}>
              Click to play
            </button>
            <div className="keys">
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
              <span><kbd>Mouse</kbd> look</span>
              <span><kbd>Shift</kbd> sprint</span>
              <span><kbd>Space</kbd> jump</span>
              <span><kbd>Click</kbd> confetti cannon</span>
              <span><kbd>1</kbd>–<kbd>6</kbd> emotes</span>
              <span><kbd>Enter</kbd> chat</span>
              <span><kbd>V</kbd> camera view</span>
              <span><kbd>M</kbd> mic · <kbd>C</kbd> cam</span>
              <span><kbd>P</kbd> present (on stage)</span>
              <span><kbd>Tab</kbd> people</span>
              <span><kbd>Esc</kbd> free the mouse</span>
              <span><kbd>H</kbd> this help</span>
            </div>
          </div>
        </div>
      )}

      {rosterOpen && (mode === 'live' && room && props.code ? (
        <ParticipantsPanel code={props.code} isHost={Boolean(props.isHost)} />
      ) : (
        <aside className="host-panel world-panel" aria-label="People">
          <h3>In the venue ({peopleCount})</h3>
          <div className="person"><span>{props.name} (you)</span></div>
          {botsRef.current?.roster.map((b) => (
            <div className="person" key={b.id}><span><span className="dot" style={{ background: b.color }} /> {b.name} <span className="muted">· bot</span></span></div>
          ))}
        </aside>
      ))}
    </div>
  );

  return room ? <RoomContext.Provider value={room}>{hud}</RoomContext.Provider> : hud;
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

