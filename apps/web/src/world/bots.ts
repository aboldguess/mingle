import * as THREE from 'three';
import { AVATAR_COLORS } from './avatar';
import type { World } from './engine';
import { blocked, PRESENTER_SPOT, STAGE } from './venue';

/**
 * Pretend attendees for the solo demo and the landing page, so the venue
 * never feels empty. They wander, chat, emote and occasionally pelt you with
 * confetti.
 */

const NAMES = ['Pixel Pete', 'Captain Agenda', 'Synergy Sam', 'Mute Button Mo', 'Lagging Larry', 'Icebreaker Ivy', 'Q&A Quinn', 'Breakout Bea', 'Deck Builder Dee', 'Coffee Kim'];
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
  'Pew pew! Confetti incoming!',
  'Shall we grab a table?',
];
const EMOJI = ['👋', '👏', '😂', '❤️', '🔥', '🎉'];
const SLIDES = [
  { title: 'Meetings, but make it fun', bullets: ['Walk up to people to talk', 'Wander off when it gets boring', 'No more grid of tiny faces'] },
  { title: 'The science of confetti', bullets: ['Left click to launch', 'Splats are harmless', 'Morale +200%'] },
  { title: 'How proximity audio works', bullets: ['Closer = louder', 'Walls muffle chatter', 'The stage mic reaches the whole hall'] },
  { title: 'Q&A', bullets: ['Walk to the front', 'Press 1–6 to react', 'Grab a juice on the way out'] },
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
      world.addRemote(id, name, color);
      const bot: Bot = { id, name, pos, yaw, target: null, waitUntil: now + Math.random() * 4000, nextChat: now + 3000 + Math.random() * 15000, fixed };
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

  nameOf(id: string) {
    return this.bots.find((b) => b.id === id)?.name;
  }

  get roster() {
    return this.bots.map((b) => ({ id: b.id, name: b.name, color: this.world.getAvatar(b.id)?.color ?? '#fff' }));
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
            bot.waitUntil = now + 4000 + Math.random() * 9000;
            bot.yaw += (Math.random() - 0.5) * 2;
          } else {
            const step = Math.min(d, 1.7 * dt);
            const nx = bot.pos.x + (dx / d) * step;
            const nz = bot.pos.z + (dz / d) * step;
            if (blocked(this.world.venue.boxes, nx, nz, 0, 0.3, 0.6)) {
              bot.target = null;
              bot.waitUntil = now + 500;
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
        bot.nextChat = now + 9000 + Math.random() * 20000;
        if (Math.random() > 0.45) avatar?.say(LINES[Math.floor(Math.random() * LINES.length)]!);
        else avatar?.emote(EMOJI[Math.floor(Math.random() * EMOJI.length)]!);
      }
      // Keynote speaker "talks".
      if (bot.fixed && bot.name.startsWith('Dr.')) avatar?.setSpeaking(Math.sin(now / 400) + Math.sin(now / 170) > 0.3);
    }
    if (opts.blastPlayer && now - this.lastBlast > 14000) {
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
  g.addColorStop(0, '#0b132b');
  g.addColorStop(1, '#3a0ca3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffd166';
  ctx.font = '900 76px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText(slide.title, 80, 150);
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 48px system-ui, sans-serif';
  slide.bullets.forEach((b, i) => {
    ctx.fillStyle = AVATAR_COLORS[i % AVATAR_COLORS.length]!;
    ctx.fillRect(90, 255 + i * 110, 24, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b, 140, 280 + i * 110);
  });
  // A bouncing pixel-art chart, because every keynote needs one.
  for (let i = 0; i < 6; i++) {
    const bh = 60 + (Math.sin(now / 600 + i) + 1) * 70;
    ctx.fillStyle = AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length]!;
    ctx.fillRect(900 + i * 50, 640 - bh, 36, bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillText('MINGLE KEYNOTE · Where Zoom Meets Doom', 80, h - 40);
}
