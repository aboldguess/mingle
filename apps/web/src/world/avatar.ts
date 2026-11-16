import * as THREE from 'three';
import { canvasTexture, paintCartoonFace, scanlines, shade } from './textures';
import { toon } from './venue';

/** Screen aspect of the CRT head (4:3, like an old telly). */
const SCREEN_W = 0.5;
const SCREEN_H = 0.375;

export const AVATAR_COLORS = ['#c8505f', '#3d7ea6', '#d9a050', '#4f9d69', '#7d5ba6', '#cf7a35', '#3a9ead', '#b56a85'];

/** How someone's avatar looks, beyond the colour. */
export interface AvatarLook {
  /** 0.9 – 1.1 */
  height: number;
  /** 0.8 – 1.2 */
  build: number;
  tv: 'crt' | 'flat';
  prop: 'none' | 'mug' | 'jumper' | 'headphones' | 'lanyard';
}
export const DEFAULT_LOOK: AvatarLook = { height: 1, build: 1, tv: 'crt', prop: 'none' };
export const PROPS: Array<{ id: AvatarLook['prop']; label: string }> = [
  { id: 'none', label: 'Nothing' },
  { id: 'mug', label: 'Coffee mug' },
  { id: 'jumper', label: 'Festive jumper' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'lanyard', label: 'Conference lanyard' },
];
export type Gesture = 'nod' | 'wave' | 'lean' | 'shrug';
export const GESTURES: Array<{ id: Gesture; label: string; key: string }> = [
  { id: 'nod', label: 'Nod', key: '7' },
  { id: 'wave', label: 'Wave', key: '8' },
  { id: 'lean', label: 'Lean in', key: '9' },
  { id: 'shrug', label: 'Shrug', key: '0' },
];
const GESTURE_SECONDS: Record<Gesture, number> = { nod: 1.3, wave: 1.8, lean: 3, shrug: 1.2 };

/** Clamp untrusted look data from the network. */
export function cleanLook(l: Partial<AvatarLook> | undefined): AvatarLook {
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 1);
  return {
    height: num(l?.height, 0.9, 1.1),
    build: num(l?.build, 0.8, 1.2),
    tv: l?.tv === 'flat' ? 'flat' : 'crt',
    prop: PROPS.some((p) => p.id === l?.prop) ? l!.prop! : 'none',
  };
}

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
  private hand: THREE.Sprite | null = null;
  private tagline = '';
  private goal = '';
  private look: AvatarLook = DEFAULT_LOOK;
  private crtParts: THREE.Object3D[] = [];
  private caseFront: THREE.Mesh;
  private caseMat: THREE.MeshToonMaterial;
  private propObj: THREE.Object3D | null = null;
  private gesture: { kind: Gesture; start: number } | null = null;
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
    this.caseMat = caseMat;
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.52, 0.34), caseMat);
    this.caseFront = front;
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
      this.crtParts.push(knob);
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
      this.crtParts.push(rod, tip);
      this.antennaTips.push(tip);
    }
    this.head.add(front, back, bezel, screen);
    this.crtParts.push(back);
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
    this.rebuildTag();
    if (!this.video) this.redrawFace();
  }

  /** The "Ask me about…" line under the name. */
  setTagline(text: string) {
    if (text === this.tagline) return;
    this.tagline = text;
    this.rebuildTag();
  }

  /** The "Here to…" line: what they want out of the event. */
  setGoal(text: string) {
    if (text === this.goal) return;
    this.goal = text;
    this.rebuildTag();
  }

  /** Height, build, telly style and a conversation-starter prop. */
  setLook(look: AvatarLook) {
    this.look = look;
    const { height: h, build: b } = look;
    this.body.scale.set(b, h, b);
    for (const limb of this.limbs) {
      const pivot = limb.parent!;
      pivot.scale.set(1, h, 1);
      const arm = Math.abs(pivot.position.x) > 0.3;
      pivot.position.x = Math.sign(pivot.position.x) * (arm ? 0.4 * b : 0.15 * b);
      pivot.position.y = (arm ? 1.2 : 0.55) * h;
    }
    // Telly style: chunky CRT with rabbit ears, or a slim flat panel.
    const flat = look.tv === 'flat';
    for (const part of this.crtParts) part.visible = !flat;
    this.caseFront.scale.z = flat ? 0.3 : 1;
    this.caseFront.position.z = flat ? -0.12 : 0;
    this.caseMat.color.set(flat ? '#2f3238' : '#f1e3c8');
    this.applyProp();
    this.rebuildTag();
  }

  private applyProp() {
    if (this.propObj) {
      this.propObj.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.propObj.removeFromParent();
      this.propObj = null;
    }
    if (this.bodyMat.map) {
      this.bodyMat.map.dispose();
      this.bodyMat.map = null;
      this.bodyMat.needsUpdate = true;
    }
    const prop = this.look.prop;
    if (prop === 'mug') {
      const mug = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 12), toon('#f4f1ea'));
      const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.01, 12), toon('#5a3a26'));
      coffee.position.y = 0.065;
      mug.add(cup, coffee);
      mug.position.set(0, -0.42, -0.06);
      this.limbs[1]!.parent!.add(mug);
      this.propObj = mug;
    } else if (prop === 'headphones') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 20, Math.PI), toon('#2b2d33'));
      band.position.set(0, 0.06, 0.02);
      const cups = new THREE.Group();
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), toon('#2b2d33'));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.36, 0.04, 0.02);
        cups.add(cup);
      }
      const g = new THREE.Group();
      g.add(band, cups);
      this.head.add(g);
      this.propObj = g;
    } else if (prop === 'lanyard') {
      const g = new THREE.Group();
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 4, 16, Math.PI), toon('#3d7ea6'));
      strap.rotation.z = Math.PI;
      strap.position.set(0, 1.42, -0.3);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.01), toon('#ffffff'));
      badge.position.set(0, 1.18, -0.33);
      g.add(strap, badge);
      this.root.add(g);
      this.propObj = g;
    } else if (prop === 'jumper') {
      // A knitted festive jumper: stripes and snowflakes in the person's colour.
      this.bodyMat.map = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = this.color;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(0, h * 0.42, w, 18);
        ctx.fillRect(0, h * 0.62, w, 18);
        ctx.font = '34px system-ui, sans-serif';
        for (let x = 10; x < w; x += 52) ctx.fillText('❄', x, h * 0.58);
        ctx.fillStyle = shade(this.color, -0.3);
        for (let x = 0; x < w; x += 16) ctx.fillRect(x, h * 0.42 + 6, 8, 6);
      });
      this.bodyMat.needsUpdate = true;
    }
  }

  /**
   * Shrink the name tag and speech bubbles when you're standing close, so
   * they never cover the face you're talking to.
   */
  setViewDistance(d: number) {
    const k = THREE.MathUtils.clamp((d - 1) / 5, 0.38, 1);
    if (Math.abs(k - this.labelScale) < 0.02) return;
    this.labelScale = k;
    this.applyLabelScale(this.tag);
    if (this.bubble) this.applyLabelScale(this.bubble);
  }

  private labelScale = 1;
  private baseScale = new WeakMap<THREE.Sprite, THREE.Vector3>();
  private applyLabelScale(s: THREE.Sprite) {
    let base = this.baseScale.get(s);
    if (!base) this.baseScale.set(s, (base = s.scale.clone()));
    s.scale.copy(base).multiplyScalar(this.labelScale);
  }

  /** Play a body-language gesture. */
  playGesture(kind: Gesture) {
    this.gesture = { kind, start: performance.now() };
  }

  private rebuildTag() {
    this.root.remove(this.tag);
    disposeSprite(this.tag);
    this.tag = makeTag(this.name, this.color, this.tagline, this.goal);
    this.applyLabelScale(this.tag);
    this.tag.position.y = (this.tagline || this.goal ? 2.42 + (this.tagline && this.goal ? 0.08 : 0) : 2.35) + (this.look.height - 1) * 1.6;
    this.root.add(this.tag);
  }

  /** A raised hand that stays up until lowered. */
  setHand(up: boolean) {
    if (up === Boolean(this.hand)) return;
    if (this.hand) {
      disposeSprite(this.hand);
      this.hand = null;
      return;
    }
    this.hand = makeBubble('✋', true);
    this.hand.scale.set(0.55, 0.55, 1);
    this.hand.position.set(0.55, 2.0, 0);
    this.root.add(this.hand);
  }

  setColor(color: string) {
    if (color === this.color) return;
    this.color = color;
    this.bodyMat.color.set(color);
    if (this.look.prop === 'jumper') this.applyProp();
    for (const limb of this.limbs) (limb.material as THREE.MeshToonMaterial).color.set(shade(color, -0.35));
    this.rebuildTag();
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

  /** A live caption of what they just said: quieter styling than chat. */
  caption(text: string) {
    this.showBubble(makeBubble(text, false, true), Math.min(7, 2.5 + text.length / 14));
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
    this.applyLabelScale(sprite);
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
    const h = this.look.height;
    la!.parent!.rotation.set(swing, 0, 0);
    ra!.parent!.rotation.set(-swing, 0, 0);
    ll!.parent!.rotation.x = -swing;
    rl!.parent!.rotation.x = swing;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05 * walking;
    this.body.position.y = 0.95 * h + bob;
    this.body.rotation.x = 0;
    this.head.position.set(0, 1.62 * h + bob + (walking === 0 ? Math.sin(now / 700) * 0.01 : 0), 0);
    this.head.rotation.x = THREE.MathUtils.clamp(-pitch, -0.6, 0.6) * 0.6;
    if (this.look.prop === 'mug' && walking === 0) ra!.parent!.rotation.x = -1.1; // hold the mug up

    // Body language.
    const g = this.gesture;
    if (g) {
      const t = (now - g.start) / 1000;
      const len = GESTURE_SECONDS[g.kind];
      if (t > len) this.gesture = null;
      else {
        const ease = Math.sin(Math.min(1, t / 0.25, (len - t) / 0.25) * (Math.PI / 2));
        if (g.kind === 'nod') this.head.rotation.x += Math.sin(t * 11) * 0.28 * ease;
        else if (g.kind === 'wave') {
          ra!.parent!.rotation.set(0, 0, (2.5 + Math.sin(t * 12) * 0.35) * ease);
        } else if (g.kind === 'lean') {
          this.body.rotation.x = -0.18 * ease;
          this.head.position.z -= 0.16 * ease;
          this.head.position.y -= 0.04 * ease;
        } else if (g.kind === 'shrug') {
          la!.parent!.rotation.set(0, 0, -0.55 * ease);
          ra!.parent!.rotation.set(0, 0, 0.55 * ease);
          this.head.position.y += 0.05 * ease;
        }
      }
    }

    if (this.bubble && now > this.bubbleUntil) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
      this.bubble = null;
    } else if (this.bubble) {
      this.bubble.position.y = 2.75 + (this.look.height - 1) * 1.6 + (this.tagline && this.goal ? 0.12 : 0) + Math.sin(now / 300) * 0.04;
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
    if (this.hand) disposeSprite(this.hand);
    this.bodyMat.map?.dispose();
    this.faceTex.dispose();
    this.videoTex?.dispose();
    this.root.removeFromParent();
  }
}

function makeTag(name: string, color: string, tagline = '', goal = ''): THREE.Sprite {
  const subs = [tagline && `Ask me about ${clip(tagline, 34)}`, goal && `Here to ${clip(goal.replace(/^here to\s+/i, ''), 38)}`].filter(Boolean) as string[];
  const h2 = 112 + subs.length * 56;
  const tex = canvasTexture(512, h2, (ctx, w, h) => {
    ctx.font = 'bold 56px system-ui, sans-serif';
    const text = name.length > 22 ? `${name.slice(0, 21)}…` : name;
    ctx.font = '500 34px system-ui, sans-serif';
    const subW = Math.max(0, ...subs.map((t) => ctx.measureText(t).width));
    ctx.font = 'bold 56px system-ui, sans-serif';
    const tw = Math.min(w - 8, Math.max(ctx.measureText(text).width + 48, subW + 32));
    ctx.fillStyle = 'rgba(20,22,28,0.7)';
    roundRect(ctx, (w - tw) / 2, 14, tw, h - 28, 26);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect((w - tw) / 2 + 18, 56 - 8, 16, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2 + 12, 58);
    ctx.font = '500 34px system-ui, sans-serif';
    subs.forEach((t, i) => {
      ctx.fillStyle = i === 0 && tagline ? '#d8d2c4' : '#a9d3b6';
      ctx.fillText(t, w / 2, 118 + i * 50);
    });
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 1.6 * (h2 / 512), 1);
  return sprite;
}

function clip(t: string, n: number) {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function makeBubble(text: string, emoji: boolean, caption = false): THREE.Sprite {
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
    ctx.fillStyle = caption ? 'rgba(30,33,40,0.82)' : '#ffffff';
    roundRect(ctx, 6, 6, w - 12, h - 30, 30);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, h - 26);
    ctx.lineTo(w / 2, h - 2);
    ctx.lineTo(w / 2 + 20, h - 26);
    ctx.fill();
    ctx.fillStyle = caption ? '#f2f0eb' : '#16161d';
    ctx.font = caption ? 'italic 500 46px system-ui, sans-serif' : '600 48px system-ui, sans-serif';
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
