import { type Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfileInput } from '../components/AvatarColorPicker';
import { DEFAULT_LOOK, type Gesture, GESTURES } from './avatar';
import { BotCrowd } from './bots';
import { Captioner, captionsSupported } from './captions';
import { World } from './engine';
import { findMatches, type Match } from './match';
import { BoardEditor, CardsPanel, PeoplePanel, type PersonRow } from './panels';
import { type Card, type ChatLine, WorldSession } from './session';
import { type Branding, isPod, type PodId, PODS, type Zone } from './venue';
import { type Stroke, Whiteboards } from './whiteboard';

export interface WorldViewProps {
  mode: 'solo' | 'live';
  name: string;
  color: string;
  profile?: ProfileInput;
  title: string;
  /** Live mode only. */
  room?: Room;
  code?: string;
  isHost?: boolean;
  planLimitEndsAt?: string | null;
  onLeave: () => void;
  onEndForAll?: () => void;
}

const EMOTES = ['👋', '👏', '😂', '❤️', '💡', '🎉'];
const ZONE_LABEL: Record<Zone, string> = { lobby: 'Networking lobby', auditorium: 'Auditorium', stage: 'On stage', podA: `${PODS.podA.label} · private`, podB: `${PODS.podB.label} · private` };

/** First-run tips, shown one at a time until each is done. */
const TIPS = [
  { id: 'move', text: 'Walk with W A S D and look around with the mouse.' },
  { id: 'talk', text: 'Walk up to someone to talk: voices get louder as you get closer.' },
  { id: 'front', text: 'Keynotes are through the big doors. Press F from anywhere for a front-row view.' },
  { id: 'card', text: 'Stand near someone and press E to give them your business card.' },
  { id: 'pods', text: 'The glass pods in the back corners are soundproof, with a shared whiteboard (B) inside.' },
  { id: 'more', text: 'Under More: live captions, voice levelling and body language (7 nod, 8 wave, 9 lean in, 0 shrug).' },
] as const;
type TipId = (typeof TIPS)[number]['id'];

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be blocked */
  }
}

/**
 * The playable venue: a full-screen 3D view plus a HUD with your face cam,
 * familiar meeting controls, chat, minimap, people, cards and the front-row view.
 */
export function WorldView(props: WorldViewProps) {
  const { mode, room } = props;
  const isHost = mode === 'solo' || Boolean(props.isHost);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const frontRowRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const sessionRef = useRef<WorldSession | null>(null);
  const botsRef = useRef<BotCrowd | null>(null);
  const soloCamRef = useRef<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);
  const lastBlockedToast = useRef(0);
  const boardsRef = useRef<Whiteboards | null>(null);
  const captionerRef = useRef<Captioner | null>(null);
  const matchedRef = useRef(new Set<string>());
  const lastNudge = useRef(0);

  const cardsKey = `mingle.cards.${props.code ?? 'demo'}`;
  const [locked, setLocked] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [zone, setZone] = useState<Zone>('lobby');
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [panel, setPanel] = useState<'people' | 'cards' | null>(null);
  const [splat, setSplat] = useState<{ by: string; at: number } | null>(null);
  const [timesSplatted, setTimesSplatted] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [, setTick] = useState(0);
  const [splats, setSplats] = useState(0);
  const [soloCam, setSoloCam] = useState(false);
  const [soloHand, setSoloHand] = useState(false);
  const [soloMic, setSoloMic] = useState<string | null>(null);
  const [thirdPerson, setThirdPerson] = useState(false);
  const [copied, setCopied] = useState(false);
  const [frontRow, setFrontRow] = useState(false);
  const [cards, setCards] = useState<Card[]>(() => loadJson<Card[]>(cardsKey, []));
  const [announcement, setAnnouncement] = useState<{ text: string; by: string; at: number } | null>(null);
  const [connection, setConnection] = useState<'connected' | 'reconnecting'>('connected');
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [levelOn, setLevelOn] = useState(true);
  const [board, setBoard] = useState<PodId | null>(null);
  const [boardRev, setBoardRev] = useState(0);
  const [groups, setGroups] = useState<{ count: number; mine: number | null } | null>(null);
  const [branding, setBrandingState] = useState<Branding | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [tipsDone, setTipsDone] = useState<TipId[]>(() => loadJson<TipId[]>('mingle.tipsDone', []));
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const toast = useCallback((text: string, action?: Toast['action'], ms = 4500) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const doneTip = useCallback((id: TipId) => {
    setTipsDone((d) => {
      if (d.includes(id)) return d;
      const next = [...d, id];
      saveJson('mingle.tipsDone', next);
      return next;
    });
  }, []);

  const pushChat = useCallback((line: ChatLine) => setChat((c) => [...c.slice(-40), line]), []);

  const addCard = useCallback(
    (card: Card) => {
      setCards((cs) => {
        const next = [...cs.filter((c) => c.id !== card.id), card];
        saveJson(cardsKey, next);
        return next;
      });
    },
    [cardsKey],
  );

  const goToTable = useCallback((table: number) => {
    const w = worldRef.current;
    const t = w?.venue.groupTables[table];
    if (!w || !t) return;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = t.x + Math.cos(a) * 1.3;
      const z = t.y + Math.sin(a) * 1.3;
      if (w.teleport(x, z, Math.atan2(-(t.x - x), -(t.y - z)))) break;
    }
  }, []);

  const goToAuditorium = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    for (let i = 0; i < 10; i++) {
      if (w.teleport((Math.random() - 0.5) * 3, -6 - Math.random() * 10, 0)) break;
    }
  }, []);

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
    world.localAvatar.setTagline(props.profile?.tag ?? '');
    world.localAvatar.setGoal(props.profile?.goal ?? '');
    world.localAvatar.setLook(props.profile?.look ?? DEFAULT_LOOK);
    const boards = new Whiteboards(world.venue);
    boards.onChange = () => setBoardRev((r) => r + 1);
    boardsRef.current = boards;
    world.events.onPointerLockChange = setLocked;
    let lastPos = world.pos.clone();
    let walked = 0;
    world.events.onZoneChange = (z) => {
      setZone(z);
      if (z === 'stage') toast(mode === 'live' ? 'You’re on stage: your camera is on the big screen and your mic fills the hall. Press P to share your screen.' : 'You’re on stage. Turn your camera on to appear on the big screen.');
      if (z === 'podA' || z === 'podB') {
        toast('Private pod: only people inside can hear you, and you can’t hear the lobby.');
        doneTip('pods');
      }
      if (z === 'auditorium') doneTip('front');
    };
    world.events.onBlockedFire = () => {
      if (performance.now() - lastBlockedToast.current < 6000) return;
      lastBlockedToast.current = performance.now();
      toast('Confetti is for the lobby only, so talks and private chats stay focused.');
    };
    const unFrame = world.onFrame(() => {
      walked += world.pos.distanceTo(lastPos);
      lastPos = world.pos.clone();
      if (walked > 4) doneTip('move');
      const near = world.nearest(3);
      if (near) doneTip('talk');
    });

    if (mode === 'live' && room) {
      const session = new WorldSession(room, world, props.color);
      sessionRef.current = session;
      (window as unknown as { __mingleSession?: WorldSession }).__mingleSession = session;
      session.setProfile(props.profile ?? {});
      session.events = {
        onChat: pushChat,
        onRosterChange: rerender,
        onSocialChange: rerender,
        onSplatted: (by) => setSplat({ by, at: Date.now() }),
        onScreenOwner: (who) => who && toast(`${who} is on the big screen · press F for a front-row view`),
        onCard: (card) => {
          addCard(card);
          toast(`${card.name} gave you their business card. Press E near them to give yours back.`);
        },
        onSummon: (by) => toast(`${by} is calling everyone to the auditorium.`, { label: 'Take me there', run: goToAuditorium }, 15000),
        onAnnounce: (text, by) => setAnnouncement({ text, by, at: Date.now() }),
        onConnection: (state) => setConnection(state),
        onGroups: (table, by) => {
          if (table === null) {
            setGroups(null);
            toast(`${by} ended the discussion groups. Mingle freely!`);
            return;
          }
          setGroups({ count: 0, mine: table });
          goToTable(table);
          toast(`${by} split the room into discussion groups. You're at table ${table + 1}.`, undefined, 7000);
        },
        onBranding: (b) => {
          world.venue.setBranding(b);
          setBrandingState(b);
        },
        onStroke: (st) => boards.add(st),
        onBoardClear: (b) => boards.clear(b),
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
      pushChat({ id: Math.random(), from: '', color: '#fff', text: 'Solo demo: everyone here is a bot, and you’re the host. Host an event to invite real people.', at: Date.now(), system: true });
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
      unFrame();
      captionerRef.current?.stop();
      captionerRef.current = null;
      boardsRef.current = null;
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
  const handUp = mode === 'live' ? Boolean(sessionRef.current?.handUp) : soloHand;
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

  // Front-row view: copy whatever is on the big screen into a full-window canvas.
  useEffect(() => {
    if (sessionRef.current) sessionRef.current.frontRow = frontRow;
    if (!frontRow) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = frontRowRef.current;
      const src = worldRef.current?.screenSource();
      if (!canvas || !src) return;
      const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
      const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
      if (!sw || !sh) return;
      if (canvas.width !== sw || canvas.height !== sh) {
        canvas.width = sw;
        canvas.height = sh;
      }
      canvas.getContext('2d')?.drawImage(src, 0, 0, sw, sh);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [frontRow]);

  // Freeze walking while the whiteboard is open, so drawing doesn't move you.
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !board) return;
    w.inputEnabled = false;
    w.clearKeys();
    return () => {
      w.inputEnabled = true;
    };
  }, [board]);

  // Announcements fade after a while.
  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(null), 12000);
    return () => clearTimeout(t);
  }, [announcement]);

  const resumeAudio = () => {
    void sessionRef.current?.audioContext.resume();
    void room?.startAudio();
  };

  const toggleMic = async () => {
    if (!local) return toast('The mic needs a live event. This is the solo demo.');
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

  const toggleHand = () => {
    const up = !handUp;
    if (sessionRef.current) sessionRef.current.setHand(up);
    else {
      worldRef.current?.localAvatar.setHand(up);
      setSoloHand(up);
    }
    if (up) toast('Hand raised. The host can pass you the mic so the whole hall hears you.');
  };

  const giveCard = () => {
    const world = worldRef.current;
    const id = world?.nearest(3.5);
    if (!world || !id) return toast('Stand next to someone (within a few steps) and press E to give them your card.');
    doneTip('card');
    world.localAvatar.emote('🪪');
    if (sessionRef.current) {
      sessionRef.current.giveCard(id);
      toast(`You gave ${sessionRef.current.nameOf(id)} your card.`);
    } else {
      const card = botsRef.current?.cardOf(id);
      if (!card) return;
      addCard(card);
      world.getAvatar(id)?.emote('🪪');
      toast(`You swapped cards with ${card.name}. See them under Cards.`);
    }
  };

  const goTo = (id: string) => {
    const ok = worldRef.current?.teleportTo(id);
    if (!ok) toast('Couldn’t find a free spot next to them. Try again in a moment.');
  };

  const passMic = (id: string | null) => {
    if (sessionRef.current) sessionRef.current.passMic(id);
    else {
      setSoloMic(id);
      if (id) botsRef.current?.lowerHand(id);
      if (id === 'me') {
        worldRef.current?.localAvatar.setHand(false);
        setSoloHand(false);
      }
    }
    rerender();
  };

  const summon = () => {
    if (sessionRef.current) sessionRef.current.summon();
    toast('Everyone has been asked to come to the auditorium.');
  };

  const announce = (text: string) => {
    if (!text.trim()) return;
    sessionRef.current?.announce(text);
    setAnnouncement({ text: text.trim(), by: props.name, at: Date.now() });
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

  const togglePanel = (which: 'people' | 'cards') => {
    setPanel((p) => {
      if (p !== which) worldRef.current?.unlock(); // free the mouse so the list can be clicked
      return p === which ? null : which;
    });
  };

  const toggleFrontRow = () => {
    setFrontRow((f) => !f);
    doneTip('front');
  };

  const gesture = (g: Gesture) => {
    if (sessionRef.current) sessionRef.current.gesture(g);
    else worldRef.current?.localAvatar.playGesture(g);
    doneTip('more');
  };

  const toggleCaptions = () => {
    if (captionsOn) {
      captionerRef.current?.stop();
      captionerRef.current = null;
      setCaptionsOn(false);
      return;
    }
    if (!captionsSupported()) return toast('Live captions need Chrome or Edge.');
    const c = new Captioner(
      (text) => {
        if (sessionRef.current) {
          if (room?.localParticipant.isMicrophoneEnabled) sessionRef.current.caption(text);
        } else {
          worldRef.current?.localAvatar.caption(text);
          pushChat({ id: Math.random(), from: props.name, color: props.color, text, at: Date.now(), caption: true });
        }
      },
      (msg) => {
        toast(msg);
        setCaptionsOn(false);
      },
    );
    c.start();
    captionerRef.current = c;
    setCaptionsOn(true);
    doneTip('more');
    toast('Live captions on: what you say appears over your head and in the chat for people nearby.');
  };

  const toggleLevel = () => {
    const on = !levelOn;
    setLevelOn(on);
    if (sessionRef.current) sessionRef.current.levelVoices = on;
    toast(on ? 'Voice levelling on: quiet and loud voices are evened out.' : 'Voice levelling off.');
  };

  const openBoard = () => {
    const z = worldRef.current?.localZone;
    if (!isPod(z)) return toast('Whiteboards are in the glass pods at the back of the lobby.');
    worldRef.current?.unlock();
    setBoard(z);
    setMenuOpen(false);
  };

  const drawStroke = (st: Stroke) => {
    boardsRef.current?.add(st);
    sessionRef.current?.stroke(st);
  };

  const wipeBoard = (b: PodId) => {
    boardsRef.current?.clear(b);
    sessionRef.current?.clearBoard(b);
  };

  /** Host: split everyone (except whoever is presenting) into n tables. */
  const makeGroups = (n: number) => {
    const world = worldRef.current;
    if (!world) return;
    const meId = room?.localParticipant.identity ?? 'me';
    const ids = (mode === 'live' && room ? [meId, ...room.remoteParticipants.keys()] : [meId, ...(botsRef.current?.mobileIds ?? [])]).filter(
      (id) => (id === meId ? world.localZone : world.zoneOf(id)) !== 'stage',
    );
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const tables = Math.max(1, Math.min(n, world.venue.groupTables.length, shuffled.length));
    const seats: Record<string, number> = {};
    shuffled.forEach((id, i) => (seats[id] = i % tables));
    if (sessionRef.current) sessionRef.current.setGroups(seats);
    else botsRef.current?.seat(seats, world.venue.groupTables);
    const mine = seats[meId] ?? null;
    setGroups({ count: tables, mine });
    if (mine !== null) goToTable(mine);
    toast(`Split ${ids.length} people across ${tables} tables. Use “Visit” to drop in on any table.`);
  };

  const endGroups = () => {
    if (sessionRef.current) sessionRef.current.setGroups({});
    else botsRef.current?.seat({}, worldRef.current?.venue.groupTables ?? []);
    setGroups(null);
  };

  const applyBranding = (b: Branding) => {
    worldRef.current?.venue.setBranding(b);
    sessionRef.current?.setBranding(b);
    setBrandingState(b);
    toast('Venue signage updated for everyone.');
  };

  const leave = () => {
    worldRef.current?.unlock();
    if (room) void room.disconnect();
    props.onLeave();
  };

  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    const c = e.currentTarget;
    if (!world) return;
    const r = c.getBoundingClientRect();
    const p = world.minimapToWorld(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, c.width, c.height);
    if (!world.teleport(p.x, p.z)) toast('Can’t stand there. Pick an open spot on the map.');
  };

  // HUD keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (typing) return;
      if (board) return;
      if (e.code === 'Escape' && frontRow) setFrontRow(false);
      else if (e.code === 'Enter' || e.code === 'KeyT') {
        e.preventDefault();
        openChat();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        togglePanel('people');
      } else if (/^Digit[1-6]$/.test(e.code)) emote(EMOTES[Number(e.code.slice(5)) - 1]!);
      else if (e.code === 'KeyH') setShowHelp((h) => !h);
      else if (e.code === 'KeyM') void toggleMic();
      else if (e.code === 'KeyC') void toggleCam();
      else if (e.code === 'KeyP') void toggleShare();
      else if (e.code === 'KeyF') toggleFrontRow();
      else if (e.code === 'KeyR') toggleHand();
      else if (e.code === 'KeyE') giveCard();
      else if (e.code === 'KeyK') togglePanel('cards');
      else if (e.code === 'KeyB') openBoard();
      else if (/^Digit[7890]$/.test(e.code)) gesture(GESTURES[(Number(e.code.slice(5)) + 3) % 10]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Fade the splat overlay.
  useEffect(() => {
    if (!splat) return;
    setTimesSplatted((n) => n + 1);
    const t = setTimeout(() => setSplat(null), 1100);
    return () => clearTimeout(t);
  }, [splat]);

  // Matchmaking: every few seconds, look for people who can help with what you're here for.
  useEffect(() => {
    const myTag = mode === 'live' ? sessionRef.current?.profile.tag : props.profile?.tag;
    const myGoal = mode === 'live' ? sessionRef.current?.profile.goal : props.profile?.goal;
    if (!myTag && !myGoal) return;
    const check = () => {
      const session = sessionRef.current;
      const others =
        mode === 'live' && room && session
          ? [...room.remoteParticipants.values()].map((p) => ({ id: p.identity, name: p.name || 'Guest', tag: session.profiles.get(p.identity)?.tag, goal: session.profiles.get(p.identity)?.goal }))
          : (botsRef.current?.roster ?? []);
      const found = findMatches({ tag: myTag, goal: myGoal }, others);
      setMatches(found.slice(0, 5));
      // Nudge at most once every couple of minutes; the People panel lists the rest.
      const fresh = found.find((m) => !matchedRef.current.has(m.id));
      if (fresh && Date.now() - lastNudge.current > 120_000) {
        lastNudge.current = Date.now();
        matchedRef.current.add(fresh.id);
        toast(`Worth meeting: ${fresh.name} ${fresh.reason}.`, { label: 'Take me there', run: () => worldRef.current?.teleportTo(fresh.id) }, 9000);
      }
    };
    const first = setTimeout(check, 6000);
    const t = setInterval(check, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [mode, room, props.profile, toast]);

  const secondsLeft = useCountdown(props.planLimitEndsAt ?? null);
  const recentChat = chat.filter((c) => chatOpen || Date.now() - c.at < 12000).slice(-6);
  const tip = TIPS.find((t) => !tipsDone.includes(t.id));

  // Everyone in the venue, for the people panel.
  const world = worldRef.current;
  const session = sessionRef.current;
  const whereOf = (id: string) => {
    const z = world?.zoneOf(id);
    return z ? ZONE_LABEL[z] : undefined;
  };
  const people: PersonRow[] =
    mode === 'live' && room && session
      ? [
          {
            id: room.localParticipant.identity,
            name: props.name,
            color: props.color,
            you: true,
            tag: session.profile.tag,
            goal: session.profile.goal,
            hand: session.handUp,
            mic: session.micHolder === room.localParticipant.identity,
            muted: !room.localParticipant.isMicrophoneEnabled,
            where: ZONE_LABEL[zone],
          },
          ...[...room.remoteParticipants.values()].map((p) => ({
            id: p.identity,
            name: p.name || 'Guest',
            color: session.colorOf(p.identity),
            tag: session.profiles.get(p.identity)?.tag,
            goal: session.profiles.get(p.identity)?.goal,
            hand: session.hands.has(p.identity),
            mic: session.micHolder === p.identity,
            muted: !p.isMicrophoneEnabled,
            where: whereOf(p.identity),
          })),
        ]
      : [
          { id: 'me', name: props.name, color: props.color, you: true, tag: props.profile?.tag, goal: props.profile?.goal, hand: soloHand, mic: soloMic === 'me', where: ZONE_LABEL[zone] },
          ...(botsRef.current?.roster ?? []).map((b) => ({ ...b, bot: true, hand: botsRef.current?.handsUp.includes(b.id), mic: soloMic === b.id, where: whereOf(b.id) })),
        ];
  const handsUp = people.filter((p) => p.hand).length;
  const micHolderName = people.find((p) => p.mic)?.name;

  const copyLink = async () => {
    if (!props.code) return;
    await navigator.clipboard.writeText(`${window.location.origin}/m/${props.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
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
          {props.code && <button className="chip chip-btn" onClick={copyLink}>{copied ? 'Link copied' : 'Copy invite link'}</button>}
          {micHolderName && <span className="chip">🎤 {micHolderName} has the mic</span>}
          {isHost && handsUp > 0 && <button className="chip chip-btn" onClick={() => togglePanel('people')}>✋ {handsUp} hand{handsUp > 1 ? 's' : ''} up</button>}
        </div>
      </div>

      {/* Top right: minimap */}
      <div className="hud hud-top-right">
        <canvas ref={minimapRef} width={160} height={256} className="minimap" aria-label="Map: click to teleport" title="Click the map to teleport" onClick={onMinimapClick} />
        <span className="chip small-chip">Click map to teleport</span>
        {splats > 0 && <div className="chip small-chip">Confetti landed: {splats}</div>}
      </div>

      {locked && !frontRow && <div className="crosshair" aria-hidden />}

      {connection === 'reconnecting' && <div className="hud-banner hud-banner-warn">Connection lost, reconnecting… you’ll be put back where you were.</div>}
      {announcement && (
        <div className="hud-banner" key={announcement.at}>
          <span className="muted-on-dark">📣 {announcement.by}:</span> {announcement.text}
        </div>
      )}

      <div className="hud-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className="hud-toast" key={t.id}>
            {t.text}
            {t.action && (
              <button className="btn btn-sm" onClick={() => { t.action!.run(); setToasts((ts) => ts.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {tip && !showHelp && !frontRow && (
        <div className="hud-tip">
          <span>💡 {tip.text}</span>
          <button className="tip-skip" onClick={() => doneTip(tip.id)}>Got it</button>
        </div>
      )}

      {/* Chat */}
      <div className="hud hud-chat">
        {recentChat.map((c) => (
          <div key={c.id} className={`chat-line ${c.system ? 'chat-system' : ''} ${c.caption ? 'chat-caption' : ''}`}>
            {!c.system && <b style={{ color: c.color }}>{c.from}: </b>}
            {c.text}
          </div>
        ))}
        {chatOpen && (
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
        )}
      </div>

      {/* Front-row view */}
      {frontRow && (
        <div className="front-row" onClick={() => setFrontRow(false)}>
          {worldRef.current?.screenSource() ? <canvas ref={frontRowRef} /> : <div className="front-row-empty">Nothing on the big screen yet.</div>}
          <div className="front-row-hint">Front-row view · you can still hear the room · press F or Esc to close</div>
        </div>
      )}

      {/* Bottom bar: familiar meeting controls */}
      <div className="hud hud-bottom">
        <div className="selfview" title="Your face, as others see it">
          <video ref={selfViewRef} muted playsInline autoPlay style={{ display: camOn ? 'block' : 'none' }} />
          {!camOn && <div className="selfview-off">📺</div>}
          <span className="selfview-name">{props.name}</span>
        </div>
        <div className="hud-buttons">
          <button className={`hud-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} title="Microphone (M)">{micOn ? '🎙️' : '🔇'}<span>{micOn ? 'Mute' : 'Unmute'}</span></button>
          <button className={`hud-btn ${camOn ? '' : 'off'}`} onClick={toggleCam} title="Camera (C)">{camOn ? '📹' : '🚫'}<span>{camOn ? 'Stop video' : 'Start video'}</span></button>
          <span className="hud-sep" />
          <button className={`hud-btn ${sharing ? 'on' : ''}`} onClick={toggleShare} disabled={!sharing && zone !== 'stage'} title={zone === 'stage' ? 'Share your screen on the big screen (P)' : 'Walk onto the stage to share your screen'}>🖥️<span>{sharing ? 'Stop share' : 'Share'}</span></button>
          <button className={`hud-btn ${frontRow ? 'on' : ''}`} onClick={toggleFrontRow} title="Front-row view of the big screen (F)">🎬<span>Front row</span></button>
          <button className={`hud-btn ${panel === 'people' ? 'on' : ''}`} onClick={() => togglePanel('people')} title="People (Tab)">👥<span>People {people.length}</span></button>
          <button className={`hud-btn ${chatOpen ? 'on' : ''}`} onClick={openChat} title="Chat (Enter)">💬<span>Chat</span></button>
          <button className={`hud-btn ${panel === 'cards' ? 'on' : ''}`} onClick={() => togglePanel('cards')} title="Business cards: E to give yours, K to view">🪪<span>Cards {cards.length || ''}</span></button>
          <button className={`hud-btn ${handUp ? 'on' : ''}`} onClick={toggleHand} title="Raise hand (R)">✋<span>{handUp ? 'Lower' : 'Raise'}</span></button>
          <span className="hud-sep" />
          {EMOTES.map((e, i) => (
            <button key={e} className="hud-btn emote" onClick={() => emote(e)} title={`React (${i + 1})`}>{e}</button>
          ))}
          <span className="hud-sep" />
          {isPod(zone) && <button className={`hud-btn ${board ? 'on' : ''}`} onClick={openBoard} title="Pod whiteboard (B)">🖊️<span>Whiteboard</span></button>}
          <div className="hud-more">
            <button className={`hud-btn ${menuOpen ? 'on' : ''}`} onClick={() => { setMenuOpen((m) => !m); worldRef.current?.unlock(); }} title="Captions, voice levelling, body language">⋯<span>More</span></button>
            {menuOpen && (
              <div className="hud-menu" role="menu">
                <div className="menu-title">Accessibility</div>
                <label className="toggle">
                  Live captions of my speech
                  <input type="checkbox" checked={captionsOn} onChange={toggleCaptions} />
                </label>
                <label className="toggle">
                  Level voices (even out quiet and loud)
                  <input type="checkbox" checked={levelOn} onChange={toggleLevel} />
                </label>
                <div className="hint">Voices also pan left and right, so you can tell who is speaking.</div>
                <div className="menu-title">Body language</div>
                <div className="gesture-row">
                  {GESTURES.map((g) => (
                    <button key={g.id} className="btn btn-sm" onClick={() => gesture(g.id)} title={`Key ${g.key}`}>{g.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className={`hud-btn ${thirdPerson ? 'on' : ''}`} onClick={() => worldRef.current && (worldRef.current.thirdPerson = !worldRef.current.thirdPerson)} title="Switch first/third person (V)">👀<span>View</span></button>
          {props.isHost && props.onEndForAll && <button className="hud-btn danger" onClick={props.onEndForAll} title="End the event for everyone">⏹️<span>End all</span></button>}
          <button className="hud-btn leave" onClick={leave} title="Leave">Leave</button>
        </div>
      </div>

      {splat && (
        <div className="splat" key={splat.at}>
          <div className="splat-text">🎉 {splat.by} got you with confetti</div>
        </div>
      )}

      {!locked && !chatOpen && !showHelp && !frontRow && <div className="hud-resume">Click the view to look around · <kbd>H</kbd> help</div>}
      {showHelp && !chatOpen && (
        <div className="hud-pause" onClick={(e) => e.target === e.currentTarget && setShowHelp(false)}>
          <div className="pause-card">
            <h2>Welcome to {props.title}</h2>
            <p className="muted">Walk up to people to talk. Keynotes are through the big doors.</p>
            <button className="btn btn-primary btn-lg" onClick={() => { resumeAudio(); setShowHelp(false); void worldRef.current?.lock(); }}>
              Click to play
            </button>
            <div className="keys">
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>
              <span><kbd>Mouse</kbd> look</span>
              <span><kbd>Shift</kbd> run · <kbd>Space</kbd> jump</span>
              <span><kbd>F</kbd> front-row view</span>
              <span><kbd>E</kbd> give your card</span>
              <span><kbd>R</kbd> raise hand</span>
              <span><kbd>M</kbd> mute · <kbd>C</kbd> camera</span>
              <span><kbd>P</kbd> share (on stage)</span>
              <span><kbd>Enter</kbd> chat · <kbd>1</kbd>–<kbd>6</kbd> react</span>
              <span><kbd>Tab</kbd> people · <kbd>K</kbd> cards</span>
              <span>Click the map to teleport</span>
              <span><kbd>Click</kbd> confetti (lobby only)</span>
              <span><kbd>V</kbd> third person</span>
              <span><kbd>7</kbd>–<kbd>0</kbd> nod, wave, lean in, shrug</span>
              <span><kbd>B</kbd> whiteboard (in a pod)</span>
              <span><kbd>Esc</kbd> free the mouse</span>
            </div>
          </div>
        </div>
      )}

      {panel === 'people' && (
        <PeoplePanel
          people={people}
          isHost={isHost}
          code={mode === 'live' ? props.code : undefined}
          onGoTo={goTo}
          onPassMic={isHost ? passMic : undefined}
          onSummon={summon}
          onAnnounce={announce}
          matches={matches}
          groups={groups}
          tableCount={worldRef.current?.venue.groupTables.length ?? 0}
          onMakeGroups={makeGroups}
          onEndGroups={endGroups}
          onVisitTable={goToTable}
          branding={branding}
          onBranding={applyBranding}
          onClose={() => setPanel(null)}
        />
      )}
      {board && boardsRef.current && (
        <BoardEditor
          board={board}
          label={PODS[board].label}
          rev={boardRev}
          paintInto={(c) => boardsRef.current?.paintInto(board, c)}
          onStroke={drawStroke}
          onClear={() => wipeBoard(board)}
          onClose={() => setBoard(null)}
        />
      )}
      {panel === 'cards' && <CardsPanel cards={cards} eventTitle={props.title} onClose={() => setPanel(null)} />}
    </div>
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
