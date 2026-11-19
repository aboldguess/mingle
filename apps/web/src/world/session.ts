import {
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
} from 'livekit-client';
import * as THREE from 'three';
import { type AvatarLook, cleanLook, colorFor, DEFAULT_LOOK, type Gesture, GESTURES } from './avatar';
import type { PlayerState, World } from './engine';
import { type Branding, isPod, type PodId } from './venue';
import type { Stroke } from './whiteboard';

/**
 * Glue between the 3D world and a LiveKit room:
 * - positions, emotes, confetti and chat travel over LiveKit data messages
 * - webcams become the avatars' CRT faces
 * - microphones are mixed by distance and direction (proximity voice)
 * - whoever is on stage (or sharing a screen) appears on the big screen
 */

type Msg =
  | { t: 's'; x: number; y: number; z: number; yaw: number; pitch: number; c: string }
  | { t: 'e'; e: string }
  | { t: 'b'; o: number[]; d: number[]; c: string }
  | { t: 'h'; id: string }
  | { t: 'c'; text: string }
  /** Profile: "Ask me about…", "Here to…", contact (email, LinkedIn…) and avatar look. */
  | { t: 'p'; tag: string; contact: string; goal?: string; look?: Partial<AvatarLook> }
  /** Body-language gesture. */
  | { t: 'g'; g: Gesture }
  /** Live caption of what we just said. */
  | { t: 'cc'; text: string }
  /** Host only: discussion groups, as person id → table number (empty = groups over). */
  | { t: 'grp'; seats: Record<string, number> }
  /** Host only: venue branding. */
  | { t: 'brand'; name: string; sponsor: string; color: string }
  /** Whiteboard stroke, or a wipe. */
  | { t: 'wb'; s: Stroke }
  | { t: 'wbx'; b: PodId }
  /** Hand me your business card: sent to one person. */
  | { t: 'k'; to: string }
  /** Raised hand. */
  | { t: 'r'; up: boolean }
  /** Host only: who holds the hall mic (null = nobody). */
  | { t: 'm'; id: string | null }
  /** Host only: call everyone to the auditorium. */
  | { t: 'go' }
  /** Host only: announcement banner. */
  | { t: 'a'; text: string }
  /** Host only: rope off the stage so only these people (and hosts) can present. */
  | { t: 'stage'; locked: boolean; presenters: string[]; revoked?: string[] }
  /** Host only: hush the audience (auditorium mics off, their voices silenced). */
  | { t: 'hush'; on: boolean };

export interface Profile {
  tag: string;
  contact: string;
  /** What they want out of the event, shown as "Here to…". */
  goal: string;
  look: AvatarLook;
}

export const EMPTY_PROFILE: Profile = { tag: '', contact: '', goal: '', look: DEFAULT_LOOK };

export interface Card {
  id: string;
  name: string;
  tag: string;
  contact: string;
  at: number;
}

export interface ChatLine {
  id: number;
  from: string;
  color: string;
  text: string;
  at: number;
  system?: boolean;
  /** A live caption rather than typed chat. */
  caption?: boolean;
}

export interface SessionEvents {
  onChat?: (line: ChatLine) => void;
  onSplatted?: (byName: string) => void;
  onRosterChange?: () => void;
  onScreenOwner?: (name: string | null) => void;
  /** Someone handed us their card. */
  onCard?: (card: Card) => void;
  /** Hands, mic holder or profiles changed. */
  onSocialChange?: () => void;
  onSummon?: (byName: string) => void;
  onAnnounce?: (text: string, byName: string) => void;
  onConnection?: (state: 'reconnecting' | 'connected') => void;
  /** The host split the room into groups; `table` is ours (null = groups over). */
  onGroups?: (table: number | null, byName: string) => void;
  onBranding?: (b: Branding) => void;
  onStroke?: (s: Stroke) => void;
  onBoardClear?: (b: PodId) => void;
  /** Stage restriction, presenters or the audience hush changed. */
  onStageChange?: () => void;
  /** We were muted because the host hushed the audience. */
  onHushMuted?: () => void;
}

const TOPIC = 'mingle';
const ALLOWED_EMOJI = new Set(['🪪', '👋', '👏', '😂', '❤️', '💡', '🎉', '🔥', '😱']);

interface AudioNodeSet {
  identity: string;
  track: RemoteAudioTrack;
  panner: StereoPannerNode;
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  source: Track.Source;
  lastVolume: number;
}

let sharedAudio: AudioContext | null = null;

/**
 * One AudioContext for the whole app. The LiveKit room must use this same
 * context (RoomOptions.webAudioMix) so our panner nodes can join its graph.
 */
export function venueAudioContext(): AudioContext {
  if (!sharedAudio || sharedAudio.state === 'closed') sharedAudio = new AudioContext();
  return sharedAudio;
}

export class WorldSession {
  readonly audioContext = venueAudioContext();
  private colors = new Map<string, string>();
  private audio = new Map<string, AudioNodeSet>();
  private videoEls = new Map<string, HTMLVideoElement>();
  private quality = new Map<string, string>();
  private mediaHost: HTMLDivElement;
  private timer: ReturnType<typeof setInterval>;
  private chatSeq = 0;
  private enc = new TextEncoder();
  private dec = new TextDecoder();
  private screenOwner: string | null = null;
  private offs: Array<() => void> = [];
  localVideo: HTMLVideoElement | null = null;
  readonly profiles = new Map<string, Profile>();
  readonly hands = new Set<string>();
  micHolder: string | null = null;
  /** When on, the stage is heard as if you were in the hall (front-row view). */
  frontRow = false;
  profile: Profile = EMPTY_PROFILE;
  /** Even out loud and quiet voices so nobody gets drowned out. */
  private levelling = true;
  branding: Branding | null = null;
  /** Our own whiteboard strokes, re-sent to newcomers. */
  myStrokes: Stroke[] = [];
  events: SessionEvents = {};
  splats = 0;
  /** Only presenters (and hosts) may go up to the stage. */
  stageLocked = false;
  /** People the host made presenters during the event (pre-agreed ones carry it in their token). */
  readonly presenters = new Set<string>();
  /** Pre-agreed presenters the host has sent back behind the rope. */
  readonly revoked = new Set<string>();
  /** The host has hushed the audience: mics in the auditorium stay off. */
  hushed = false;
  private lastHushMute = 0;

  constructor(
    readonly room: Room,
    readonly world: World,
    readonly color: string,
    opts: { stageRestricted?: boolean } = {},
  ) {
    this.stageLocked = Boolean(opts.stageRestricted);
    this.mediaHost = document.createElement('div');
    this.mediaHost.className = 'media-host';
    this.mediaHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.mediaHost);

    this.colors.set(room.localParticipant.identity, color);

    world.events.onLocalState = (s) => this.send({ t: 's', ...s, c: this.color }, false);
    world.events.onBlast = (o, d, c) => this.send({ t: 'b', o: o.toArray().map(r2), d: d.toArray().map(r2), c }, true);
    world.events.onHit = (id) => {
      this.splats++;
      this.send({ t: 'h', id }, true);
    };

    // Keep our own handler references so dispose() removes only ours.
    const on = <E extends RoomEvent>(event: E, handler: (...args: never[]) => void) => {
      room.on(event, handler as never);
      this.offs.push(() => room.off(event, handler as never));
    };
    on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.addParticipant(p));
    on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      world.removeRemote(p.identity);
      this.system(`${p.name || 'Someone'} left`);
      this.events.onRosterChange?.();
    });
    on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      this.receive(participant, payload);
    });
    on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => this.attach(track, pub, participant));
    on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => this.detach(track, pub, participant));
    on(RoomEvent.TrackMuted, () => this.events.onRosterChange?.());
    on(RoomEvent.TrackUnmuted, () => this.events.onRosterChange?.());
    on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => this.attachLocal(pub));
    on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => this.detachLocal(pub));
    on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => this.speakers(speakers));
    on(RoomEvent.ParticipantNameChanged, (name: string, p: Participant) => world.getAvatar(p.identity)?.setName(name));
    on(RoomEvent.Reconnecting, () => this.events.onConnection?.('reconnecting'));
    on(RoomEvent.Reconnected, () => {
      // Everyone may have missed our updates while we were away: re-announce.
      world.forceSendState();
      this.announceSelf();
      this.events.onConnection?.('connected');
    });

    for (const p of room.remoteParticipants.values()) {
      this.addParticipant(p, true);
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.isSubscribed) this.attach(pub.track, pub, p);
      }
    }
    for (const pub of room.localParticipant.trackPublications.values()) this.attachLocal(pub);

    this.timer = setInterval(() => this.mix(), 120);
    this.applyStage();
  }

  dispose() {
    clearInterval(this.timer);
    for (const off of this.offs) off();
    this.offs = [];
    for (const a of this.audio.values()) a.track.detach();
    this.audio.clear();
    for (const v of this.videoEls.values()) v.remove();
    this.mediaHost.remove();
  }

  // ---------------------------------------------------------------- outgoing

  private send(msg: Msg, reliable: boolean) {
    if (this.room.state !== 'connected') return;
    void this.room.localParticipant.publishData(this.enc.encode(JSON.stringify(msg)), { reliable, topic: TOPIC }).catch(() => {});
  }

  /** Send our profile, hand and (if host) the mic holder to everyone. */
  private announceSelf() {
    this.send({ t: 'p', ...this.profile }, true);
    for (const st of this.myStrokes) this.send({ t: 'wb', s: st }, true);
    if (this.isHost(this.room.localParticipant) && this.branding) this.send({ t: 'brand', ...this.branding }, true);
    if (this.hands.has(this.room.localParticipant.identity)) this.send({ t: 'r', up: true }, true);
    if (this.isHost(this.room.localParticipant) && this.micHolder) this.send({ t: 'm', id: this.micHolder }, true);
    if (this.isHost(this.room.localParticipant)) {
      this.send(this.stageMsg(), true);
      if (this.hushed) this.send({ t: 'hush', on: true }, true);
    }
  }

  private stageMsg(): Msg {
    return { t: 'stage', locked: this.stageLocked, presenters: [...this.presenters], revoked: [...this.revoked] };
  }

  /** May this person stand on stage and be heard and seen by the whole hall? */
  canPresent(id: string): boolean {
    if (!this.stageLocked || this.presenters.has(id)) return true;
    const p = id === this.room.localParticipant.identity ? this.room.localParticipant : this.room.remoteParticipants.get(id);
    if (!p) return false;
    if (this.isHost(p)) return true;
    // The host can take back a presenter slot that was agreed before the event.
    return this.metaFlag(p, 'isPresenter') && !this.revoked.has(id);
  }

  /** Host: rope off the stage, or open it to everyone. */
  setStageLocked(locked: boolean) {
    this.stageLocked = locked;
    this.send(this.stageMsg(), true);
    this.applyStage();
  }

  /** Host: let someone through the rope (or not). */
  setPresenter(id: string, on: boolean) {
    if (on) {
      this.presenters.add(id);
      this.revoked.delete(id);
    } else {
      this.presenters.delete(id);
      this.revoked.add(id);
    }
    this.send(this.stageMsg(), true);
    this.applyStage();
  }

  /** Host: hush the audience. Returns who was in the auditorium, for a server-side mute. */
  setHush(on: boolean): string[] {
    this.hushed = on;
    this.send({ t: 'hush', on }, true);
    this.events.onStageChange?.();
    if (!on) return [];
    return [...this.room.remoteParticipants.values()]
      .filter((p) => this.world.zoneOf(p.identity) === 'auditorium' && p.identity !== this.micHolder && !this.isHost(p))
      .map((p) => p.identity);
  }

  private applyStage() {
    this.world.setStageAccess(this.stageLocked, this.canPresent(this.room.localParticipant.identity));
    this.events.onStageChange?.();
  }

  setProfile(profile: Partial<Profile>) {
    this.profile = { tag: (profile.tag ?? '').slice(0, 60), contact: (profile.contact ?? '').slice(0, 120), goal: (profile.goal ?? '').slice(0, 60), look: cleanLook(profile.look) };
    this.profiles.set(this.room.localParticipant.identity, this.profile);
    this.world.localAvatar.setTagline(this.profile.tag);
    this.world.localAvatar.setGoal(this.profile.goal);
    this.world.localAvatar.setLook(this.profile.look);
    this.send({ t: 'p', ...this.profile }, true);
  }

  gesture(g: Gesture) {
    this.world.localAvatar.playGesture(g);
    this.send({ t: 'g', g }, true);
  }

  /** Share a live caption of something we just said. */
  caption(text: string) {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.world.localAvatar.caption(clean);
    this.send({ t: 'cc', text: clean }, true);
    this.events.onChat?.({ id: ++this.chatSeq, from: this.room.localParticipant.name || 'You', color: this.color, text: clean, at: Date.now(), caption: true });
  }

  /** Host: seat people at discussion tables (empty to end groups). */
  setGroups(seats: Record<string, number>) {
    this.send({ t: 'grp', seats }, true);
  }

  /** Host: put the event's name and sponsor on the venue signage. */
  setBranding(b: Branding) {
    this.branding = b;
    this.send({ t: 'brand', ...b }, true);
  }

  stroke(st: Stroke) {
    this.myStrokes.push(st);
    if (this.myStrokes.length > 400) this.myStrokes.shift();
    this.send({ t: 'wb', s: st }, true);
  }

  clearBoard(b: PodId) {
    this.myStrokes = this.myStrokes.filter((st) => st.b !== b);
    this.send({ t: 'wbx', b }, true);
  }

  get levelVoices() {
    return this.levelling;
  }

  set levelVoices(on: boolean) {
    this.levelling = on;
    for (const a of this.audio.values()) applyLevelling(a.compressor, a.makeup, on && a.source === Track.Source.Microphone);
  }

  /** Give our card to someone. Returns false if nobody is near. */
  giveCard(to: string) {
    this.send({ t: 'k', to }, true);
  }

  setHand(up: boolean) {
    const me = this.room.localParticipant.identity;
    if (up) this.hands.add(me);
    else this.hands.delete(me);
    this.world.localAvatar.setHand(up);
    this.send({ t: 'r', up }, true);
    this.events.onSocialChange?.();
  }

  get handUp() {
    return this.hands.has(this.room.localParticipant.identity);
  }

  /** Host: hand the hall mic to someone (or take it back with null). */
  passMic(id: string | null) {
    this.micHolder = id;
    if (id) this.hands.delete(id);
    this.send({ t: 'm', id }, true);
    if (id === this.room.localParticipant.identity) this.world.localAvatar.setHand(false);
    else if (id) this.world.getAvatar(id)?.setHand(false);
    this.events.onSocialChange?.();
  }

  summon() {
    this.send({ t: 'go' }, true);
  }

  announce(text: string) {
    const clean = text.trim().slice(0, 200);
    if (clean) this.send({ t: 'a', text: clean }, true);
  }

  isHost(p: Participant): boolean {
    return this.metaFlag(p, 'isHost');
  }

  /** Flags the server signed into someone's join token. */
  private metaFlag(p: Participant, key: 'isHost' | 'isPresenter'): boolean {
    try {
      return Boolean(JSON.parse(p.metadata || '{}')[key]);
    } catch {
      return false;
    }
  }

  nameOf(id: string) {
    if (id === this.room.localParticipant.identity) return this.room.localParticipant.name || 'You';
    return this.room.remoteParticipants.get(id)?.name || 'Guest';
  }

  emote(emoji: string) {
    this.world.localAvatar.emote(emoji);
    this.send({ t: 'e', e: emoji }, true);
  }

  chat(text: string) {
    const clean = text.trim().slice(0, 280);
    if (!clean) return;
    this.send({ t: 'c', text: clean }, true);
    this.world.localAvatar.say(clean);
    this.pushChat(this.room.localParticipant.name || 'You', this.color, clean);
  }

  // ---------------------------------------------------------------- incoming

  private addParticipant(p: RemoteParticipant, initial = false) {
    const color = this.colors.get(p.identity) ?? colorFor(p.identity);
    this.world.addRemote(p.identity, p.name || 'Guest', color);
    // Tell the newcomer where we are, who we are, and the hall's state right away.
    this.world.forceSendState();
    this.announceSelf();
    if (!initial) this.system(`${p.name || 'Someone'} arrived`);
    this.events.onRosterChange?.();
  }

  private receive(p: RemoteParticipant, payload: Uint8Array) {
    let msg: Msg;
    try {
      msg = JSON.parse(this.dec.decode(payload));
    } catch {
      return;
    }
    const avatar = this.world.getAvatar(p.identity) ?? this.world.addRemote(p.identity, p.name || 'Guest', colorFor(p.identity));
    switch (msg.t) {
      case 's': {
        if (![msg.x, msg.y, msg.z, msg.yaw, msg.pitch].every(Number.isFinite)) return;
        if (typeof msg.c === 'string' && /^#[0-9a-f]{6}$/i.test(msg.c) && this.colors.get(p.identity) !== msg.c) {
          this.colors.set(p.identity, msg.c);
          avatar.setColor(msg.c);
          this.events.onRosterChange?.();
        }
        const state: PlayerState = { x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch };
        this.world.applyRemoteState(p.identity, state);
        break;
      }
      case 'e':
        if (ALLOWED_EMOJI.has(msg.e)) avatar.emote(msg.e);
        break;
      case 'b': {
        if (!Array.isArray(msg.o) || !Array.isArray(msg.d) || msg.o.length !== 3 || msg.d.length !== 3) return;
        const o = new THREE.Vector3().fromArray(msg.o.map(Number));
        const d = new THREE.Vector3().fromArray(msg.d.map(Number));
        if (![o.x, o.y, o.z, d.x, d.y, d.z].every(Number.isFinite) || d.lengthSq() === 0) return;
        const color = /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#ffffff';
        this.world.remoteBlast(p.identity, o, d, color);
        break;
      }
      case 'h':
        if (msg.id === this.room.localParticipant.identity) {
          this.events.onSplatted?.(p.name || 'Someone');
          this.world.playPop(0.9);
        } else {
          this.world.getAvatar(msg.id)?.splat();
        }
        break;
      case 'p': {
        if (typeof msg.tag !== 'string' || typeof msg.contact !== 'string') return;
        const prof: Profile = { tag: msg.tag.slice(0, 60), contact: msg.contact.slice(0, 120), goal: typeof msg.goal === 'string' ? msg.goal.slice(0, 60) : '', look: cleanLook(msg.look) };
        this.profiles.set(p.identity, prof);
        avatar.setTagline(prof.tag);
        avatar.setGoal(prof.goal);
        avatar.setLook(prof.look);
        this.events.onSocialChange?.();
        break;
      }
      case 'g':
        if (GESTURES.some((g) => g.id === msg.g)) avatar.playGesture(msg.g);
        break;
      case 'cc':
        if (typeof msg.text !== 'string') return;
        avatar.caption(msg.text.slice(0, 200));
        this.events.onChat?.({ id: ++this.chatSeq, from: p.name || 'Guest', color: this.colors.get(p.identity) ?? avatar.color, text: msg.text.slice(0, 200), at: Date.now(), caption: true });
        break;
      case 'grp': {
        if (!this.isHost(p) || typeof msg.seats !== 'object' || !msg.seats) return;
        const mine = msg.seats[this.room.localParticipant.identity];
        this.events.onGroups?.(Object.keys(msg.seats).length === 0 ? null : typeof mine === 'number' ? mine : null, p.name || 'The host');
        break;
      }
      case 'brand':
        if (!this.isHost(p) || typeof msg.name !== 'string' || typeof msg.sponsor !== 'string') return;
        this.branding = { name: msg.name.slice(0, 28), sponsor: msg.sponsor.slice(0, 22), color: /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#3f4a5a' };
        this.events.onBranding?.(this.branding);
        break;
      case 'wb':
        if (msg.s && (msg.s.b === 'podA' || msg.s.b === 'podB') && Array.isArray(msg.s.p)) this.events.onStroke?.(msg.s);
        break;
      case 'wbx':
        if (msg.b === 'podA' || msg.b === 'podB') this.events.onBoardClear?.(msg.b);
        break;
      case 'k': {
        if (msg.to !== this.room.localParticipant.identity) return;
        const prof = this.profiles.get(p.identity) ?? { tag: '', contact: '' };
        this.events.onCard?.({ id: p.identity, name: p.name || 'Guest', ...prof, at: Date.now() });
        break;
      }
      case 'r':
        if (msg.up) this.hands.add(p.identity);
        else this.hands.delete(p.identity);
        avatar.setHand(Boolean(msg.up));
        this.events.onSocialChange?.();
        break;
      case 'm': {
        if (!this.isHost(p)) return;
        const id = typeof msg.id === 'string' ? msg.id : null;
        this.micHolder = id;
        if (id) {
          this.hands.delete(id);
          this.world.getAvatar(id)?.setHand(false);
        }
        if (id === this.room.localParticipant.identity) this.system('The host handed you the mic: the whole hall can hear you.');
        this.events.onSocialChange?.();
        break;
      }
      case 'go':
        if (this.isHost(p)) this.events.onSummon?.(p.name || 'The host');
        break;
      case 'a':
        if (this.isHost(p) && typeof msg.text === 'string') this.events.onAnnounce?.(msg.text.slice(0, 200), p.name || 'The host');
        break;
      case 'stage': {
        if (!this.isHost(p) || !Array.isArray(msg.presenters)) return;
        const wasAllowed = this.canPresent(this.room.localParticipant.identity);
        const wasLocked = this.stageLocked;
        this.stageLocked = Boolean(msg.locked);
        this.presenters.clear();
        for (const id of msg.presenters.slice(0, 200)) if (typeof id === 'string') this.presenters.add(id);
        this.revoked.clear();
        if (Array.isArray(msg.revoked)) for (const id of msg.revoked.slice(0, 200)) if (typeof id === 'string') this.revoked.add(id);
        const allowed = this.canPresent(this.room.localParticipant.identity);
        if (this.stageLocked && !wasLocked) this.system(allowed ? 'The host roped off the stage. You’re a presenter, so you can still go up.' : 'The host roped off the stage for the speakers.');
        else if (!this.stageLocked && wasLocked) this.system('The stage is open to everyone again.');
        else if (this.stageLocked && allowed && !wasAllowed) this.system('The host made you a presenter: head up to the podium when you’re ready.');
        this.applyStage();
        break;
      }
      case 'hush':
        if (!this.isHost(p)) return;
        if (Boolean(msg.on) !== this.hushed) this.system(msg.on ? 'The host hushed the audience: mics in the auditorium are off. Raise your hand (R) to ask a question.' : 'The audience can talk again.');
        this.hushed = Boolean(msg.on);
        this.events.onStageChange?.();
        break;
      case 'c':
        if (typeof msg.text !== 'string') return;
        avatar.say(msg.text.slice(0, 280));
        this.pushChat(p.name || 'Guest', this.colors.get(p.identity) ?? avatar.color, msg.text.slice(0, 280));
        break;
    }
  }

  private pushChat(from: string, color: string, text: string, system = false) {
    this.events.onChat?.({ id: ++this.chatSeq, from, color, text, at: Date.now(), system });
  }

  private system(text: string) {
    this.pushChat('', '#ffffff', text, true);
  }

  private speakers(speakers: Participant[]) {
    const talking = new Set(speakers.map((s) => s.identity));
    this.world.localAvatar.setSpeaking(talking.has(this.room.localParticipant.identity));
    for (const id of this.world.remoteIds()) this.world.getAvatar(id)?.setSpeaking(talking.has(id));
  }

  // ------------------------------------------------------------------- media

  private videoKey(identity: string, source: Track.Source) {
    return `${identity}:${source}`;
  }

  private makeVideo(key: string, track: { attach(el: HTMLMediaElement): HTMLMediaElement }) {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    track.attach(el);
    this.mediaHost.appendChild(el);
    this.videoEls.set(key, el);
    return el;
  }

  private attach(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    const avatar = this.world.getAvatar(p.identity) ?? this.world.addRemote(p.identity, p.name || 'Guest', colorFor(p.identity));
    if (track.kind === Track.Kind.Video) {
      const key = this.videoKey(p.identity, pub.source);
      this.videoEls.get(key)?.remove();
      const el = this.makeVideo(key, track);
      if (pub.source === Track.Source.Camera) avatar.setVideo(el as HTMLVideoElement);
      this.events.onRosterChange?.();
    } else if (track instanceof RemoteAudioTrack) {
      // Route through Web Audio so we can pan and fade by distance.
      // Route through Web Audio so we can pan and fade by distance, and level
      // quiet and loud voices so everyone is heard equally.
      const compressor = this.audioContext.createDynamicsCompressor();
      const makeup = this.audioContext.createGain();
      applyLevelling(compressor, makeup, this.levelling && pub.source === Track.Source.Microphone);
      const panner = this.audioContext.createStereoPanner();
      track.setWebAudioPlugins([compressor, makeup, panner]);
      track.attach();
      this.audio.set(track.sid ?? this.videoKey(p.identity, pub.source), { identity: p.identity, track, panner, compressor, makeup, source: pub.source, lastVolume: -1 });
      this.events.onRosterChange?.();
    }
  }

  private detach(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    track.detach();
    if (track.kind === Track.Kind.Video) {
      const key = this.videoKey(p.identity, pub.source);
      this.videoEls.get(key)?.remove();
      this.videoEls.delete(key);
      this.quality.delete(key);
      if (pub.source === Track.Source.Camera) this.world.getAvatar(p.identity)?.setVideo(null);
    } else {
      this.audio.delete(track.sid ?? this.videoKey(p.identity, pub.source));
    }
    this.events.onRosterChange?.();
  }

  private attachLocal(pub: LocalTrackPublication) {
    const track = pub.track;
    if (!track || track.kind !== Track.Kind.Video) return;
    const key = this.videoKey(this.room.localParticipant.identity, pub.source);
    this.videoEls.get(key)?.remove();
    const el = this.makeVideo(key, track);
    if (pub.source === Track.Source.Camera) {
      this.localVideo = el;
      this.world.localAvatar.setVideo(el);
    }
    this.events.onRosterChange?.();
  }

  private detachLocal(pub: LocalTrackPublication) {
    const key = this.videoKey(this.room.localParticipant.identity, pub.source);
    this.videoEls.get(key)?.remove();
    this.videoEls.delete(key);
    if (pub.source === Track.Source.Camera) {
      this.localVideo = null;
      this.world.localAvatar.setVideo(null);
    }
    this.events.onRosterChange?.();
  }

  /** Volume, panning, video quality and the big screen, recomputed a few times a second. */
  private mix() {
    const me = this.world.localState;
    const myZone = this.world.localZone;
    const rightX = Math.cos(me.yaw);
    const rightZ = -Math.sin(me.yaw);
    const presenterOnStage = [...this.room.remoteParticipants.keys()].some((id) => this.world.zoneOf(id) === 'stage' && this.canPresent(id));
    const local = this.room.localParticipant;
    // A hushed audience keeps its mics off while in the auditorium.
    if (this.hushed && myZone === 'auditorium' && local.isMicrophoneEnabled && this.micHolder !== local.identity && !this.isHost(local)) {
      void local.setMicrophoneEnabled(false).catch(() => {});
      if (performance.now() - this.lastHushMute > 4000) {
        this.lastHushMute = performance.now();
        this.events.onHushMuted?.();
      }
    }

    for (const a of this.audio.values()) {
      const pos = this.world.remotePosition(a.identity);
      const theirZone = this.world.zoneOf(a.identity);
      let volume = 0;
      let pan = 0;
      if (pos) {
        const dx = pos.x - me.x;
        const dz = pos.z - me.z;
        const d = Math.hypot(dx, dz);
        pan = d > 0.5 ? THREE.MathUtils.clamp((dx * rightX + dz * rightZ) / d, -1, 1) * 0.75 : 0;
        const inHall = myZone === 'auditorium' || myZone === 'stage' || this.frontRow;
        const amplified = (theirZone === 'stage' && this.canPresent(a.identity)) || a.identity === this.micHolder;
        if ((isPod(myZone) || isPod(theirZone)) && myZone !== theirZone) {
          // Soundproof pods: nobody in or out hears across the glass.
          volume = 0;
        } else if ((amplified && inHall) || a.source === Track.Source.ScreenShareAudio) {
          // The stage mic and shared-screen audio fill the auditorium.
          volume = inHall ? 1 : isPod(myZone) ? 0 : 0.25;
          pan *= 0.3;
        } else {
          volume = d < 2.5 ? 1 : Math.max(0, 1 - (d - 2.5) / 14) ** 2;
          if ((myZone === 'lobby') !== (theirZone === 'lobby') && !isPod(myZone)) volume *= 0.3;
          // Hush the audience while someone presents, or entirely when the host says so.
          if (presenterOnStage && inHall && theirZone === 'auditorium') volume *= 0.5;
          const speaker = this.room.remoteParticipants.get(a.identity);
          if (this.hushed && theirZone === 'auditorium' && a.source === Track.Source.Microphone && !(speaker && this.isHost(speaker))) volume = 0;
        }
      }
      if (Math.abs(volume - a.lastVolume) > 0.01) {
        a.track.setVolume(volume);
        a.lastVolume = volume;
      }
      a.panner.pan.setTargetAtTime(pan, this.audioContext.currentTime, 0.08);
    }

    // Video quality by distance: faces nearby in HD, far away in thumbnails, very far paused.
    for (const p of this.room.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.Camera);
      if (!pub) continue;
      const pos = this.world.remotePosition(p.identity);
      const d = pos ? Math.hypot(pos.x - me.x, pos.z - me.z) : 0;
      const onStage = this.world.zoneOf(p.identity) === 'stage';
      const want = onStage ? 'high' : d > 32 ? 'off' : d > 14 ? 'low' : d > 6 ? 'medium' : 'high';
      const key = this.videoKey(p.identity, Track.Source.Camera);
      if (this.quality.get(key) === want) continue;
      this.quality.set(key, want);
      pub.setEnabled(want !== 'off');
      if (want !== 'off') pub.setVideoQuality(want === 'high' ? VideoQuality.HIGH : want === 'medium' ? VideoQuality.MEDIUM : VideoQuality.LOW);
    }

    this.updateScreen();
  }

  /** Screen share wins; otherwise the camera of whoever stands on stage; otherwise the idle card. */
  private updateScreen() {
    const local = this.room.localParticipant;
    let owner: Participant | null = null;
    let el: HTMLVideoElement | null = null;
    const all: Participant[] = [local, ...this.room.remoteParticipants.values()];
    for (const p of all) {
      const v = this.videoEls.get(this.videoKey(p.identity, Track.Source.ScreenShare));
      if (v) {
        owner = p;
        el = v;
        break;
      }
    }
    if (!el) {
      for (const p of all) {
        if (this.world.zoneOf(p.identity) !== 'stage' || !this.canPresent(p.identity)) continue;
        const v = this.videoEls.get(this.videoKey(p.identity, Track.Source.Camera));
        if (v) {
          owner = p;
          el = v;
          break;
        }
      }
    }
    this.world.setScreenVideo(el);
    const name = owner ? owner.name || 'Someone' : null;
    if (name !== this.screenOwner) {
      this.screenOwner = name;
      this.events.onScreenOwner?.(name);
    }
  }

  /** Current proximity volume per remote speaker (for the HUD and tests). */
  volumes(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.audio.values()) if (a.source === Track.Source.Microphone) out[a.identity] = a.lastVolume;
    return out;
  }

  colorOf(identity: string) {
    return this.colors.get(identity) ?? colorFor(identity);
  }
}

/** Voice levelling: a gentle compressor plus make-up gain lifts quiet voices and tames loud ones. */
function applyLevelling(c: DynamicsCompressorNode, g: GainNode, on: boolean) {
  c.threshold.value = on ? -36 : 0;
  c.knee.value = on ? 18 : 0;
  c.ratio.value = on ? 6 : 1;
  c.attack.value = 0.005;
  c.release.value = 0.25;
  g.gain.value = on ? 2 : 1;
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}
