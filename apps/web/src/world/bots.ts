import * as THREE from 'three';
import { AVATAR_COLORS, type AvatarLook, GESTURES, PROPS } from './avatar';
import type { World } from './engine';
import { blocked, PRESENTER_SPOT, STAGE } from './venue';

/**
 * Pretend attendees for the solo demo and the landing page, so the venue
 * never feels empty. They wander, chat, emote and occasionally pelt you with
 * confetti.
 */

const NAMES = ['Pixel Pete', 'Captain Agenda', 'Synergy Sam', 'Mute Button Mo', 'Lagging Larry', 'Icebreaker Ivy', 'Q&A Quinn', 'Breakout Bea', 'Deck Builder Dee', 'Coffee Kim'];
const TAGS = ['3D graphics', 'running meetups', 'climate tech', 'hiring designers', 'sourdough', 'event production', 'funding rounds', 'remote teams', 'pitch decks', 'coffee roasting'];
const GOALS = ['find a co-founder', 'learn about 3D graphics', 'hire designers', 'meet climate tech people', 'learn about funding rounds', 'swap remote team tips', 'improve my pitch decks', 'find event production help', 'get better coffee', 'meet sourdough fans'];
const LINES = [
  'Can everyone see my screen?',
  "You're on mute! Oh wait, wrong app.",
  'Love the telly head. Very retro.',
  'Anyone else just here for the snacks?',
  'Let’s circle back… literally, I’m walking in circles.',
  'Who’s doing the keynote? I heard there’s confetti.',
  'This beats a grid of faces any day.',
  'Has anyone tried the juice bar?',
  'Quick sync? I’m by the big statue.',
  'My camera is off because I’m a robot.',
  'Has anyone tried the soundproof pods?',
  'Shall we grab a table?',
];
const EMOJI = ['👋', '👏', '😂', '❤️', '💡', '🎉'];
const SLIDES = [
  { title: 'Meetings, but make it fun', bullets: ['Walk up to people to talk', 'Wander off when it gets boring', 'No more grid of tiny faces'] },
  { title: 'Things you can’t do in real life', bullets: ['Front-row view from anywhere (F)', 'Teleport to anyone you want to meet', 'Swap business cards with one key (E)'] },
  { title: 'How proximity audio works', bullets: ['Closer = louder', 'Walls muffle chatter', 'The stage mic reaches the whole hall'] },
  { title: 'Q&A', bullets: ['Raise your hand with R', 'The host can pass you the mic', 'No running down the aisle'] },
];

interface Bot {
  id: string;
  name: string;
  pos: THREE.Vector3;
  yaw: number;
  target: THREE.Vector2 | null;
  waitUntil: number;
  nextChat: number;
  fixed: boolean;
  tag: string;
  goal: string;
  nextGesture: number;
  /** Table they've been seated at by the host, if any. */
  seatAt?: THREE.Vector2;
}

export class BotCrowd {
  private bots: Bot[] = [];
  private unsub: () => void;
  private slideCanvas = document.createElement('canvas');
  private slide = -1;
  private lastBlast = performance.now();

  constructor(private world: World, opts: { lobby: number; audience: number; keynote: boolean; blastPlayer: boolean }) {
    const now = performance.now();
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    let n = 0;
    const add = (pos: THREE.Vector3, yaw: number, fixed: boolean, name = names[n % names.length]!) => {
      const id = `bot-${n++}`;
      const color = AVATAR_COLORS[n % AVATAR_COLORS.length]!;
      const avatar = world.addRemote(id, name, color);
      const tag = name.startsWith('Dr.') ? 'the future of meetings' : TAGS[(n - 1) % TAGS.length]!;
      // Goals are offset from tags so bots match each other (and you) in interesting ways.
      const goal = name.startsWith('Dr.') ? '' : GOALS[(n + 2) % GOALS.length]!;
      avatar.setTagline(tag);
      avatar.setGoal(goal);
      const look: AvatarLook = {
        height: 0.92 + Math.random() * 0.16,
        build: 0.85 + Math.random() * 0.3,
        tv: Math.random() > 0.7 ? 'flat' : 'crt',
        prop: Math.random() > 0.5 ? PROPS[1 + Math.floor(Math.random() * (PROPS.length - 1))]!.id : 'none',
      };
      avatar.setLook(look);
      const bot: Bot = { id, name, pos, yaw, target: null, waitUntil: now + Math.random() * 4000, nextChat: now + 8000 + Math.random() * 25000, fixed, tag, goal, nextGesture: now + 4000 + Math.random() * 15000 };
      this.bots.push(bot);
      world.applyRemoteState(id, { x: pos.x, y: pos.y, z: pos.z, yaw, pitch: 0 });
      return bot;
    };
    for (let i = 0; i < opts.lobby; i++) {
      const wp = world.venue.waypoints[Math.floor(Math.random() * 12)]!;
      add(new THREE.Vector3(wp.x + Math.random(), 0, wp.y + Math.random()), Math.random() * Math.PI * 2, false);
    }
    for (let i = 0; i < opts.audience; i++) {
      const row = Math.floor(Math.random() * 5);
      const side = i % 2 ? 1 : -1;
      add(new THREE.Vector3(side * (4 + Math.random() * 9), 0.5, -20 + row * 2.3 + 0.3), 0, true);
    }
    if (opts.keynote) {
      add(new THREE.Vector3(PRESENTER_SPOT.x, STAGE.top, PRESENTER_SPOT.y), Math.PI, true, 'Dr. Byte (keynote)');
      this.slideCanvas.width = 1280;
      this.slideCanvas.height = 720;
      world.setScreenCanvas(this.slideCanvas);
    }
    this.unsub = world.onFrame((dt) => this.update(dt, opts));
  }

  /** Put the keynote slides back on the big screen. */
  restoreScreen() {
    if (this.slideCanvas.width) this.world.setScreenCanvas(this.slideCanvas);
  }

  /** A bot's business card. */
  cardOf(id: string) {
    const b = this.bots.find((x) => x.id === id);
    if (!b) return null;
    const handle = b.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
    return { id, name: b.name, tag: b.tag, contact: `${handle}@example.com`, at: Date.now() };
  }

  /** Bots in the audience put their hands up now and then during the demo keynote. */
  get handsUp() {
    return this.bots.filter((b) => this.hands.has(b.id)).map((b) => b.id);
  }

  lowerHand(id: string) {
    this.hands.delete(id);
    this.world.getAvatar(id)?.setHand(false);
  }

  private hands = new Set<string>();

  nameOf(id: string) {
    return this.bots.find((b) => b.id === id)?.name;
  }

  get roster() {
    return this.bots.map((b) => ({ id: b.id, name: b.name, tag: b.tag, goal: b.goal, color: this.world.getAvatar(b.id)?.color ?? '#fff' }));
  }

  /** Host split the room into groups: walk the wandering bots to their tables and keep them there. */
  seat(seats: Record<string, number>, tables: THREE.Vector2[]) {
    const now = performance.now();
    for (const bot of this.bots) {
      if (bot.fixed) continue;
      const t = seats[bot.id];
      if (t === undefined) {
        bot.seatAt = undefined;
        bot.waitUntil = now + 1000; // groups over: back to wandering
        continue;
      }
      const table = tables[t]!;
      bot.seatAt = table;
      const a = Math.random() * Math.PI * 2;
      bot.target = new THREE.Vector2(table.x + Math.cos(a) * 1.2, table.y + Math.sin(a) * 1.2);
      bot.waitUntil = now + 10 * 60_000;
    }
  }

  /** Bots that wander (and so can be put into groups). */
  get mobileIds() {
    return this.bots.filter((b) => !b.fixed).map((b) => b.id);
  }

  get ids() {
    return this.bots.map((b) => b.id);
  }

  /** A bot got hit by the player. */
  react(id: string) {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot) return;
    const avatar = this.world.getAvatar(id);
    avatar?.emote(Math.random() > 0.5 ? '😂' : '😱');
    if (!bot.fixed && Math.random() > 0.5) {
      // Retaliate!
      setTimeout(() => this.blastAt(bot), 600);
    }
  }

  private blastAt(bot: Bot) {
    if (this.world.mode !== 'play') return;
    const origin = bot.pos.clone().setY(bot.pos.y + 1.4);
    const target = this.world.pos.clone().setY(this.world.pos.y + 1.2);
    const dist = origin.distanceTo(target);
    const dir = target.sub(origin).normalize();
    dir.y += dist * 0.012; // aim up a little against gravity
    bot.yaw = Math.atan2(-(this.world.pos.x - bot.pos.x), -(this.world.pos.z - bot.pos.z));
    this.world.remoteBlast(bot.id, origin.addScaledVector(dir, 0.6), dir, this.world.getAvatar(bot.id)?.color ?? '#ff006e');
  }

  private update(dt: number, opts: { blastPlayer: boolean }) {
    const now = performance.now();
    for (const bot of this.bots) {
      const avatar = this.world.getAvatar(bot.id);
      if (!bot.fixed) {
        if (!bot.target && now > bot.waitUntil) {
          const wps = this.world.venue.waypoints;
          const wp = wps[Math.floor(Math.random() * wps.length)]!;
          bot.target = new THREE.Vector2(wp.x + (Math.random() - 0.5) * 1.5, wp.y + (Math.random() - 0.5) * 1.5);
        }
        if (bot.target) {
          const dx = bot.target.x - bot.pos.x;
          const dz = bot.target.y - bot.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.3) {
            bot.target = null;
            if (bot.waitUntil < now) bot.waitUntil = now + 4000 + Math.random() * 9000;
            bot.yaw = bot.seatAt ? Math.atan2(-(bot.seatAt.x - bot.pos.x), -(bot.seatAt.y - bot.pos.z)) : bot.yaw + (Math.random() - 0.5) * 2;
          } else {
            const step = Math.min(d, 1.7 * dt);
            const nx = bot.pos.x + (dx / d) * step;
            const nz = bot.pos.z + (dz / d) * step;
            if (blocked(this.world.venue.boxes, nx, nz, 0, 0.3, 0.6)) {
              bot.target = null;
              if (bot.seatAt) {
                // Something's in the way of their table: hop to a free spot beside it.
                for (let k = 0; k < 8; k++) {
                  const a = Math.random() * Math.PI * 2;
                  const x = bot.seatAt.x + Math.cos(a) * 1.2;
                  const z = bot.seatAt.y + Math.sin(a) * 1.2;
                  if (!blocked(this.world.venue.boxes, x, z, 0, 0.3, 0.6)) {
                    bot.pos.set(x, 0, z);
                    bot.yaw = Math.atan2(-(bot.seatAt.x - x), -(bot.seatAt.y - z));
                    break;
                  }
                }
              } else bot.waitUntil = now + 500;
            } else {
              bot.pos.x = nx;
              bot.pos.z = nz;
              bot.yaw = Math.atan2(-dx, -dz);
            }
          }
        }
      }
      this.world.applyRemoteState(bot.id, { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw, pitch: 0 });
      if (now > bot.nextChat) {
        bot.nextChat = now + 20000 + Math.random() * 30000;
        if (bot.fixed) {
          // The audience stays quiet during the talk; sometimes a hand goes up.
          if (!bot.name.startsWith('Dr.') && Math.random() > 0.6 && this.hands.size < 2) {
            this.hands.add(bot.id);
            avatar?.setHand(true);
          }
        } else if (Math.random() > 0.45) avatar?.say(LINES[Math.floor(Math.random() * LINES.length)]!);
        else avatar?.emote(EMOJI[Math.floor(Math.random() * EMOJI.length)]!);
      }
      // Body language: nods and waves now and then, and a wave back if you're close.
      if (!bot.fixed && now > bot.nextGesture) {
        bot.nextGesture = now + 12000 + Math.random() * 20000;
        const close = bot.pos.distanceTo(this.world.pos) < 4;
        avatar?.playGesture(close ? 'wave' : GESTURES[Math.floor(Math.random() * GESTURES.length)]!.id);
      }
      // Keynote speaker "talks".
      if (bot.fixed && bot.name.startsWith('Dr.')) avatar?.setSpeaking(Math.sin(now / 400) + Math.sin(now / 170) > 0.3);
    }
    if (opts.blastPlayer && now - this.lastBlast > 30000 && this.world.localZone === 'lobby') {
      this.lastBlast = now;
      const near = this.bots.filter((b) => !b.fixed && b.pos.distanceTo(this.world.pos) < 14);
      const shooter = near[Math.floor(Math.random() * near.length)];
      if (shooter) this.blastAt(shooter);
    }
    const slide = Math.floor(now / 9000) % SLIDES.length;
    if (this.slideCanvas.width && (slide !== this.slide || Math.floor(now / 100) % 5 === 0)) {
      this.slide = slide;
      paintSlide(this.slideCanvas, SLIDES[slide]!, now);
    }
  }

  dispose() {
    this.unsub();
    for (const b of this.bots) this.world.removeRemote(b.id);
    this.bots = [];
  }
}

function paintSlide(canvas: HTMLCanvasElement, slide: { title: string; bullets: string[] }, now: number) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f6f3ec');
  g.addColorStop(1, '#ebe5d8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2c3340';
  ctx.font = '800 76px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText(slide.title, 80, 150);
  ctx.font = '500 48px system-ui, sans-serif';
  slide.bullets.forEach((b, i) => {
    ctx.fillStyle = AVATAR_COLORS[i % AVATAR_COLORS.length]!;
    ctx.fillRect(90, 255 + i * 110, 24, 24);
    ctx.fillStyle = '#3d4350';
    ctx.fillText(b, 140, 280 + i * 110);
  });
  // A bouncing pixel-art chart, because every keynote needs one.
  for (let i = 0; i < 6; i++) {
    const bh = 60 + (Math.sin(now / 600 + i) + 1) * 70;
    ctx.fillStyle = AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length]!;
    ctx.fillRect(900 + i * 50, 640 - bh, 36, bh);
  }
  ctx.fillStyle = 'rgba(44,51,64,0.55)';
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillText('MINGLE KEYNOTE · Where Zoom Meets Doom', 80, h - 40);
}
