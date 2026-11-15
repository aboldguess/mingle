import * as THREE from 'three';
import { canvasTexture, paintCartoonFace, scanlines, shade } from './textures';
import { toon } from './venue';

/** Screen aspect of the CRT head (4:3, like an old telly). */
const SCREEN_W = 0.5;
const SCREEN_H = 0.375;

export const AVATAR_COLORS = ['#ff006e', '#3a86ff', '#ffbe0b', '#06d6a0', '#8338ec', '#fb5607', '#00b4d8', '#ef476f'];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

/**
 * A walking, CRT-headed avatar. Its screen shows the person's webcam, or a
 * cartoon face when the camera is off.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  private body: THREE.Mesh;
  private bodyMat: THREE.MeshToonMaterial;
  private limbs: THREE.Mesh[] = [];
  private screenMat: THREE.MeshBasicMaterial;
  private faceCanvas: HTMLCanvasElement;
  private faceTex: THREE.CanvasTexture;
  private videoTex: THREE.VideoTexture | null = null;
  private video: HTMLVideoElement | null = null;
  private antennaTips: THREE.Mesh[] = [];
  private tag: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private walkPhase = Math.random() * 10;
  private blinkAt = 0;
  private speaking = false;
  private faceMood: 'happy' | 'talk' | 'blink' = 'happy';
  private splatUntil = 0;
  name: string;
  color: string;

  constructor(name: string, color: string) {
    this.name = name;
    this.color = color;
    this.bodyMat = toon(color);

    // Body: a chunky hoodie capsule with stubby arms and legs.
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 12), this.bodyMat);
    this.body.position.y = 0.95;
    this.root.add(this.body);
    const limbMat = toon(shade(color, -0.35));
    const limbGeo = new THREE.CapsuleGeometry(0.09, 0.38, 3, 8);
    for (const [x, y] of [[-0.4, 1.0], [0.4, 1.0], [-0.15, 0.35], [0.15, 0.35]] as Array<[number, number]>) {
      const limb = new THREE.Mesh(limbGeo, limbMat);
      limb.geometry.translate(0, 0, 0);
      const pivot = new THREE.Group();
      pivot.position.set(x, y + 0.2, 0);
      limb.position.y = -0.2;
      pivot.add(limb);
      this.root.add(pivot);
      this.limbs.push(limb);
    }

    // Head: a retro CRT telly.
    this.head.position.y = 1.62;
    const caseMat = toon('#f1e3c8');
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.52, 0.34), caseMat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 0.24), toon('#d9c7a5'));
    back.position.z = 0.27;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.06, SCREEN_H + 0.06, 0.02), toon('#2b2b2b'));
    bezel.position.set(-0.03, 0, -0.171);
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = 256;
    this.faceCanvas.height = 192;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.faceTex, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.screenMat);
    screen.position.set(-0.03, 0, -0.182);
    screen.rotation.y = Math.PI;
    // Two knobs beside the screen.
    const knobMat = toon('#444444');
    for (const ky of [0.1, -0.08]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), knobMat);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(0.3, ky, -0.18);
      this.head.add(knob);
    }
    // Rabbit-ear antennas whose tips light up when you talk.
    const rodMat = toon('#666666');
    for (const side of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), rodMat);
      rod.position.set(side * 0.12, 0.42, 0.05);
      rod.rotation.z = -side * 0.45;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: '#555555' }));
      tip.position.set(side * 0.21, 0.61, 0.05);
      this.head.add(rod, tip);
      this.antennaTips.push(tip);
    }
    this.head.add(front, back, bezel, screen);
    // Faces -Z, like the camera.
    this.root.add(this.head);

    this.tag = makeTag(name, color);
    this.tag.position.y = 2.35;
    this.root.add(this.tag);
    this.redrawFace();
  }

  setName(name: string) {
    if (name === this.name) return;
    this.name = name;
    this.root.remove(this.tag);
    disposeSprite(this.tag);
    this.tag = makeTag(name, this.color);
    this.tag.position.y = 2.35;
    this.root.add(this.tag);
    if (!this.video) this.redrawFace();
  }

  setColor(color: string) {
    if (color === this.color) return;
    this.color = color;
    this.bodyMat.color.set(color);
    for (const limb of this.limbs) (limb.material as THREE.MeshToonMaterial).color.set(shade(color, -0.35));
    const name = this.name;
    this.name = '';
    this.setName(name);
  }

  /** Show a webcam on the screen, or null for the cartoon face. */
  setVideo(video: HTMLVideoElement | null) {
    if (video === this.video) return;
    this.videoTex?.dispose();
    this.videoTex = null;
    this.video = video;
    if (video) {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.videoTex = tex;
      this.fitVideo();
      video.addEventListener('loadedmetadata', () => this.fitVideo(), { once: true });
      video.addEventListener('resize', () => this.fitVideo());
      this.screenMat.map = tex;
    } else {
      this.screenMat.map = this.faceTex;
      this.redrawFace();
    }
    this.screenMat.needsUpdate = true;
  }

  get hasVideo() {
    return this.video !== null;
  }

  /** Crop the video to fill the 4:3 screen. */
  private fitVideo() {
    const v = this.video;
    const tex = this.videoTex;
    if (!v || !tex || !v.videoWidth) return;
    const videoAspect = v.videoWidth / v.videoHeight;
    const screenAspect = SCREEN_W / SCREEN_H;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    if (videoAspect > screenAspect) {
      tex.repeat.x = screenAspect / videoAspect;
      tex.offset.x = (1 - tex.repeat.x) / 2;
    } else {
      tex.repeat.y = videoAspect / screenAspect;
      tex.offset.y = (1 - tex.repeat.y) / 2;
    }
  }

  setSpeaking(on: boolean) {
    if (on === this.speaking) return;
    this.speaking = on;
    for (const tip of this.antennaTips) (tip.material as THREE.MeshBasicMaterial).color.set(on ? '#39ff14' : '#555555');
  }

  /** Float an emoji above the head for a few seconds. */
  emote(emoji: string) {
    this.showBubble(makeBubble(emoji, true), 3);
  }

  say(text: string) {
    this.showBubble(makeBubble(text, false), Math.min(9, 3 + text.length / 12));
  }

  /** Got hit by a confetti blast: tint the screen for a moment. */
  splat() {
    this.splatUntil = performance.now() + 900;
  }

  private showBubble(sprite: THREE.Sprite, seconds: number) {
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubble = sprite;
    sprite.position.y = 2.75;
    this.root.add(sprite);
    this.bubbleUntil = performance.now() + seconds * 1000;
  }

  /**
   * Advance animation. `speed` is horizontal speed in m/s, `pitch` tilts the head.
   */
  update(dt: number, speed: number, pitch: number) {
    const now = performance.now();
    const walking = Math.min(1, speed / 4);
    this.walkPhase += dt * (4 + speed * 2.2);
    const swing = Math.sin(this.walkPhase) * 0.7 * walking;
    const [la, ra, ll, rl] = this.limbs;
    la!.parent!.rotation.x = swing;
    ra!.parent!.rotation.x = -swing;
    ll!.parent!.rotation.x = -swing;
    rl!.parent!.rotation.x = swing;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05 * walking;
    this.body.position.y = 0.95 + bob;
    this.head.position.y = 1.62 + bob + (walking === 0 ? Math.sin(now / 700) * 0.01 : 0);
    this.head.rotation.x = THREE.MathUtils.clamp(-pitch, -0.6, 0.6) * 0.6;

    if (this.bubble && now > this.bubbleUntil) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
      this.bubble = null;
    } else if (this.bubble) {
      this.bubble.position.y = 2.75 + Math.sin(now / 300) * 0.04;
    }

    this.screenMat.color.set(now < this.splatUntil ? '#ff9de2' : '#ffffff');

    if (!this.video) {
      let mood: typeof this.faceMood = 'happy';
      if (this.speaking) mood = Math.sin(now / 90) > 0 ? 'talk' : 'happy';
      if (now > this.blinkAt) {
        mood = 'blink';
        if (now > this.blinkAt + 140) this.blinkAt = now + 2000 + Math.random() * 3000;
      }
      if (mood !== this.faceMood) {
        this.faceMood = mood;
        this.redrawFace();
      }
    }
  }

  /** Paint a canvas onto the screen instead of a webcam (used by bots). */
  paintScreen(paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const ctx = this.faceCanvas.getContext('2d')!;
    paint(ctx, this.faceCanvas.width, this.faceCanvas.height);
    scanlines(ctx, this.faceCanvas.width, this.faceCanvas.height);
    this.faceTex.needsUpdate = true;
  }

  private redrawFace() {
    const ctx = this.faceCanvas.getContext('2d')!;
    paintCartoonFace(ctx, this.faceCanvas.width, this.faceCanvas.height, this.color, this.name, this.faceMood);
    this.faceTex.needsUpdate = true;
  }

  /** World position of the body centre, for hit tests. */
  center(target = new THREE.Vector3()) {
    return target.copy(this.root.position).setY(this.root.position.y + 1.1);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
      }
    });
    disposeSprite(this.tag);
    if (this.bubble) disposeSprite(this.bubble);
    this.faceTex.dispose();
    this.videoTex?.dispose();
    this.root.removeFromParent();
  }
}

function makeTag(name: string, color: string): THREE.Sprite {
  const tex = canvasTexture(512, 112, (ctx, w, h) => {
    ctx.font = 'bold 56px system-ui, sans-serif';
    const text = name.length > 22 ? `${name.slice(0, 21)}…` : name;
    const tw = Math.min(w - 8, ctx.measureText(text).width + 48);
    ctx.fillStyle = 'rgba(15,15,25,0.72)';
    roundRect(ctx, (w - tw) / 2, 14, tw, h - 28, 28);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect((w - tw) / 2 + 18, h / 2 - 8, 16, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2 + 12, h / 2 + 2);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 0.35, 1);
  return sprite;
}

function makeBubble(text: string, emoji: boolean): THREE.Sprite {
  if (emoji) {
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.font = '180px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 10);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    s.scale.set(0.8, 0.8, 1);
    return s;
  }
  const lines = wrap(text, 28).slice(0, 4);
  const tex = canvasTexture(768, 80 + lines.length * 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 6, 6, w - 12, h - 30, 30);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, h - 26);
    ctx.lineTo(w / 2, h - 2);
    ctx.lineTo(w / 2 + 20, h - 26);
    ctx.fill();
    ctx.fillStyle = '#16161d';
    ctx.font = '600 48px system-ui, sans-serif';
    ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 70 + i * 64));
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  const aspect = tex.image.height / tex.image.width;
  s.scale.set(2.2, 2.2 * aspect, 1);
  s.center.set(0.5, 0);
  return s;
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > max && line) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeSprite(s: THREE.Sprite) {
  s.material.map?.dispose();
  s.material.dispose();
  s.removeFromParent();
}
