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
import { colorFor } from './avatar';
import type { PlayerState, World } from './engine';

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
  | { t: 'c'; text: string };

export interface ChatLine {
  id: number;
  from: string;
  color: string;
  text: string;
  at: number;
  system?: boolean;
}

export interface SessionEvents {
  onChat?: (line: ChatLine) => void;
  onSplatted?: (byName: string) => void;
  onRosterChange?: () => void;
  onScreenOwner?: (name: string | null) => void;
}

const TOPIC = 'mingle';
const ALLOWED_EMOJI = new Set(['👋', '👏', '😂', '❤️', '🔥', '🎉', '😱']);

interface AudioNodeSet {
  identity: string;
  track: RemoteAudioTrack;
  panner: StereoPannerNode;
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
  events: SessionEvents = {};
  splats = 0;

  constructor(
    readonly room: Room,
    readonly world: World,
    readonly color: string,
  ) {
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

    for (const p of room.remoteParticipants.values()) {
      this.addParticipant(p, true);
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.isSubscribed) this.attach(pub.track, pub, p);
      }
    }
    for (const pub of room.localParticipant.trackPublications.values()) this.attachLocal(pub);

    this.timer = setInterval(() => this.mix(), 120);
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
    // Tell the newcomer where we are right away.
    this.world.forceSendState();
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
      const panner = this.audioContext.createStereoPanner();
      track.setWebAudioPlugins([panner]);
      track.attach();
      this.audio.set(track.sid ?? this.videoKey(p.identity, pub.source), { identity: p.identity, track, panner, source: pub.source, lastVolume: -1 });
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
    const presenterOnStage = [...this.room.remoteParticipants.keys()].some((id) => this.world.zoneOf(id) === 'stage');

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
        const inHall = myZone !== 'lobby';
        if ((theirZone === 'stage' && inHall) || a.source === Track.Source.ScreenShareAudio) {
          // The stage mic and shared-screen audio fill the auditorium.
          volume = inHall ? 1 : 0.25;
          pan *= 0.3;
        } else {
          volume = d < 2.5 ? 1 : Math.max(0, 1 - (d - 2.5) / 14) ** 2;
          if ((myZone === 'lobby') !== (theirZone === 'lobby')) volume *= 0.3;
          // Hush the audience while someone presents.
          if (presenterOnStage && inHall && theirZone === 'auditorium') volume *= 0.5;
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
        if (this.world.zoneOf(p.identity) !== 'stage') continue;
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

function r2(n: number) {
  return Math.round(n * 100) / 100;
}
