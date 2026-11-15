import * as THREE from 'three';
import { Avatar } from './avatar';
import { AUDITORIUM, blocked, buildVenue, groundAt, LOBBY, STAGE, type Venue, type Zone } from './venue';

/** What every client broadcasts about itself several times a second. */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface WorldEvents {
  /** Local player moved enough that peers should hear about it. */
  onLocalState?: (s: PlayerState) => void;
  onZoneChange?: (zone: Zone) => void;
  /** Local player fired the confetti cannon. */
  onBlast?: (origin: THREE.Vector3, dir: THREE.Vector3, color: string) => void;
  /** A local shot landed on someone. */
  onHit?: (targetId: string) => void;
  onPointerLockChange?: (locked: boolean) => void;
  /** Someone else's projectile hit the local player (only trusted in solo mode; live mode uses messages). */
  onLocalHit?: (ownerId: string) => void;
}

interface Remote {
  id: string;
  avatar: Avatar;
  target: PlayerState;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  hasState: boolean;
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  color: string;
  ownerId: string;
}

const EYE = 1.55;
const RADIUS = 0.35;
const STEP_UP = 0.62;
const GRAVITY = 20;
const WALK = 5;
const SPRINT = 8.5;
const JUMP = 7;
const PARTICLES = 3000;

export type WorldMode = 'play' | 'attract';

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 200);
  readonly renderer: THREE.WebGLRenderer;
  readonly venue: Venue;
  readonly localId: string;
  readonly localAvatar: Avatar;
  events: WorldEvents = {};

  /** Feet position of the local player. */
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private vel = new THREE.Vector3();
  private onGround = true;
  private keys = new Set<string>();
  private remotes = new Map<string, Remote>();
  private projectiles: Projectile[] = [];
  private projectileGeo = new THREE.SphereGeometry(0.12, 10, 8);
  private particles: THREE.Points;
  private particleVel = new Float32Array(PARTICLES * 3);
  private particleLife = new Float32Array(PARTICLES);
  private particleCursor = 0;
  private zone: Zone = 'lobby';
  private lastSent = { t: 0, s: null as PlayerState | null };
  private clock = new THREE.Clock();
  private frame = 0;
  private running = false;
  private disposed = false;
  private lastShot = 0;
  private screenVideo: HTMLVideoElement | null = null;
  private screenTex: THREE.Texture | null = null;
  private attractT = Math.random() * 100;
  private resizeObserver: ResizeObserver;
  readonly mode: WorldMode;
  private frameHooks = new Set<(dt: number) => void>();
  inputEnabled = true;
  thirdPerson = false;
  mouseSensitivity = 0.0022;
  blasterColor: string;

  constructor(
    private container: HTMLElement,
    opts: { mode: WorldMode; localId: string; name: string; color: string },
  ) {
    this.mode = opts.mode;
    this.localId = opts.localId;
    this.blasterColor = opts.color;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'world-canvas';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene.background = skyGradient();
    this.scene.fog = new THREE.Fog('#2a1b4d', 45, 110);
    this.venue = buildVenue();
    this.scene.add(this.venue.group);

    const spawn = this.venue.spawnPoint();
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;

    this.localAvatar = new Avatar(opts.name, opts.color);
    this.localAvatar.root.visible = false;
    this.scene.add(this.localAvatar.root);

    // Confetti particle pool.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3).fill(-999), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, vertexColors: true }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    if (this.mode === 'play') this.bindInput();
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.unbindInput?.();
    this.resizeObserver.disconnect();
    for (const r of this.remotes.values()) r.avatar.dispose();
    this.remotes.clear();
    this.localAvatar.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Run something every frame; returns an unsubscribe function. */
  onFrame(hook: (dt: number) => void) {
    this.frameHooks.add(hook);
    return () => this.frameHooks.delete(hook);
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------- input

  private unbindInput?: () => void;

  private bindInput() {
    const canvas = this.renderer.domElement;
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.inputEnabled || isTyping()) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.isLocked) e.preventDefault();
      if (e.code === 'KeyV' && !e.repeat) this.thirdPerson = !this.thirdPerson;
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    const onMouseMove = (e: MouseEvent) => {
      if (!this.isLocked) return;
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * this.mouseSensitivity, -1.45, 1.45);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.isLocked) {
        if (e.target === canvas && this.inputEnabled) void this.lock();
        return;
      }
      if (e.button === 0) this.fire();
    };
    const onLockChange = () => {
      if (!this.isLocked) this.keys.clear();
      this.events.onPointerLockChange?.(this.isLocked);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('pointerlockchange', onLockChange);
    this.unbindInput = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (this.isLocked) document.exitPointerLock();
    };
  }

  get isLocked() {
    return document.pointerLockElement === this.renderer.domElement;
  }

  async lock() {
    try {
      await this.renderer.domElement.requestPointerLock();
    } catch {
      /* Browsers refuse pointer lock right after an Esc; the next click works. */
    }
  }

  unlock() {
    if (this.isLocked) document.exitPointerLock();
  }

  /** Release all held keys, e.g. when a chat box takes focus. */
  clearKeys() {
    this.keys.clear();
  }

  // ------------------------------------------------------------------ remotes

  addRemote(id: string, name: string, color: string): Avatar {
    let r = this.remotes.get(id);
    if (r) {
      r.avatar.setName(name);
      r.avatar.setColor(color);
      return r.avatar;
    }
    const avatar = new Avatar(name, color);
    avatar.root.visible = false; // until we know where they are
    this.scene.add(avatar.root);
    r = { id, avatar, target: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, hasState: false };
    this.remotes.set(id, r);
    return avatar;
  }

  removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.dispose();
    this.remotes.delete(id);
  }

  getAvatar(id: string): Avatar | undefined {
    return id === this.localId ? this.localAvatar : this.remotes.get(id)?.avatar;
  }

  remoteIds() {
    return [...this.remotes.keys()];
  }

  applyRemoteState(id: string, s: PlayerState) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.target = s;
    if (!r.hasState) {
      r.hasState = true;
      r.pos.set(s.x, s.y, s.z);
      r.yaw = s.yaw;
      r.avatar.root.visible = true;
    }
  }

  /** Where a remote player is right now (interpolated), or null if unknown. */
  remotePosition(id: string): THREE.Vector3 | null {
    const r = this.remotes.get(id);
    return r?.hasState ? r.pos : null;
  }

  zoneOf(id: string): Zone | null {
    if (id === this.localId) return this.zone;
    const p = this.remotePosition(id);
    return p ? this.venue.zoneAt(p.x, p.z, p.y) : null;
  }

  get localZone() {
    return this.zone;
  }

  // ------------------------------------------------------------------- screen

  /** Show a video on the big screen, or null for the idle graphic. */
  setScreenVideo(video: HTMLVideoElement | null) {
    if (video === this.screenVideo) return;
    this.screenVideo = video;
    this.screenTex?.dispose();
    this.screenTex = null;
    const mat = this.venue.screen.material;
    if (video) {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex = tex;
      mat.map = tex;
      const fit = () => this.fitScreen(video.videoWidth / video.videoHeight);
      if (video.videoWidth) fit();
      video.addEventListener('loadedmetadata', fit);
      video.addEventListener('resize', fit);
    } else {
      mat.map = this.venue.screenIdle;
      this.fitScreen(16 / 9);
    }
    mat.needsUpdate = true;
  }

  /** Use a canvas on the big screen (the demo keynote uses this). */
  setScreenCanvas(canvas: HTMLCanvasElement) {
    this.screenVideo = null;
    this.screenTex?.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex = tex;
    this.venue.screen.material.map = tex;
    this.venue.screen.material.needsUpdate = true;
    this.fitScreen(canvas.width / canvas.height);
  }

  refreshScreenCanvas() {
    if (this.screenTex instanceof THREE.CanvasTexture) this.screenTex.needsUpdate = true;
  }

  /** Letterbox the screen so any aspect ratio fits inside the 16:9 frame. */
  private fitScreen(aspect: number) {
    if (!Number.isFinite(aspect) || aspect <= 0) aspect = 16 / 9;
    const frame = 16 / 9;
    const s = this.venue.screen.scale;
    if (aspect > frame) s.set(1, frame / aspect, 1);
    else s.set(aspect / frame, 1, 1);
  }

  // ------------------------------------------------------------------ blaster

  private fire() {
    const now = performance.now();
    if (now - this.lastShot < 250) return;
    this.lastShot = now;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.camera.position.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    this.spawnProjectile(this.localId, origin, dir, this.blasterColor);
    this.events.onBlast?.(origin, dir, this.blasterColor);
    this.playPop(0.5);
  }

  /** Simulate someone else's shot so everybody sees the same confetti. */
  remoteBlast(ownerId: string, origin: THREE.Vector3, dir: THREE.Vector3, color: string) {
    this.spawnProjectile(ownerId, origin, dir, color);
  }

  private spawnProjectile(ownerId: string, origin: THREE.Vector3, dir: THREE.Vector3, color: string) {
    const mesh = new THREE.Mesh(this.projectileGeo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel: dir.clone().normalize().multiplyScalar(24), age: 0, color, ownerId });
  }

  burst(at: THREE.Vector3, color: string, count = 60) {
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.particles.geometry.getAttribute('color') as THREE.BufferAttribute;
    const palette = [new THREE.Color(color), new THREE.Color('#ffffff'), new THREE.Color('#ffd166'), new THREE.Color('#06d6a0'), new THREE.Color('#ef476f')];
    for (let i = 0; i < count; i++) {
      const k = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % PARTICLES;
      pos.setXYZ(k, at.x, at.y, at.z);
      const c = palette[i % palette.length]!;
      col.setXYZ(k, c.r, c.g, c.b);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 4);
      this.particleVel.set([v.x, v.y, v.z], k * 3);
      this.particleLife[k] = 1.4 + Math.random() * 0.8;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  private audioCtx: AudioContext | null = null;

  /** A tiny synthesised pop, no sound files needed. */
  playPop(volume = 0.3) {
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520 + Math.random() * 200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(volume * 0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch {
      /* audio is optional */
    }
  }

  // --------------------------------------------------------------------- loop

  private tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frame++;
    for (const hook of this.frameHooks) hook(dt);
    if (this.mode === 'play') this.updateLocal(dt);
    else this.updateAttract(dt);
    this.updateRemotes(dt);
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    const mascot = this.venue.group.getObjectByName('mascot');
    if (mascot) mascot.rotation.y += dt * 0.3;
    if (this.screenTex instanceof THREE.CanvasTexture && this.frame % 4 === 0) this.screenTex.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  private updateLocal(dt: number) {
    const k = this.keys;
    // Arrow keys turn too, for people who prefer not to capture the mouse.
    if (k.has('ArrowLeft')) this.yaw += 2.2 * dt;
    if (k.has('ArrowRight')) this.yaw -= 2.2 * dt;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? SPRINT : WALK;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -sin * fwd + cos * strafe;
    let mz = -cos * fwd - sin * strafe;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx = (mx / len) * speed;
      mz = (mz / len) * speed;
    }
    // Snappy on the ground, floaty in the air.
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (mx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (mz - this.vel.z) * Math.min(1, accel * dt);

    const boxes = this.venue.boxes;
    const nx = this.pos.x + this.vel.x * dt;
    if (!blocked(boxes, nx, this.pos.z, this.pos.y, RADIUS, STEP_UP)) this.pos.x = nx;
    else this.vel.x = 0;
    const nz = this.pos.z + this.vel.z * dt;
    if (!blocked(boxes, this.pos.x, nz, this.pos.y, RADIUS, STEP_UP)) this.pos.z = nz;
    else this.vel.z = 0;

    if (k.has('Space') && this.onGround) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    const ground = groundAt(boxes, this.pos.x, this.pos.z, this.pos.y, RADIUS, STEP_UP);
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.pos.y - ground < 0.25 && this.vel.y <= 0) {
      // Walking down a step: stick to the floor instead of hopping.
      this.pos.y = ground;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
    // Safety net if anything ever pushes us out of the building.
    if (this.pos.x < LOBBY.minX - 1 || this.pos.x > LOBBY.maxX + 1 || this.pos.z > LOBBY.maxZ + 1 || this.pos.z < AUDITORIUM.minZ - 1) {
      const s = this.venue.spawnPoint();
      this.pos.set(s.x, 0, s.z);
    }

    // Camera.
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.thirdPerson) {
      const back = new THREE.Vector3(0, 0, 1).applyEuler(this.camera.rotation);
      this.camera.position.copy(eye).addScaledVector(back, 3.4).add(new THREE.Vector3(0, 0.5, 0));
    } else {
      this.camera.position.copy(eye);
    }
    const a = this.localAvatar;
    a.root.visible = this.thirdPerson;
    a.root.position.copy(this.pos);
    a.root.rotation.y = this.yaw;
    a.update(dt, Math.hypot(this.vel.x, this.vel.z), this.pitch);

    const zone = this.venue.zoneAt(this.pos.x, this.pos.z, this.pos.y);
    if (zone !== this.zone) {
      this.zone = zone;
      this.events.onZoneChange?.(zone);
    }

    this.maybeSendState();
  }

  private maybeSendState() {
    const now = performance.now();
    const s: PlayerState = { x: round(this.pos.x), y: round(this.pos.y), z: round(this.pos.z), yaw: round(this.yaw), pitch: round(this.pitch) };
    const prev = this.lastSent.s;
    const changed = !prev || prev.x !== s.x || prev.y !== s.y || prev.z !== s.z || Math.abs(prev.yaw - s.yaw) > 0.01 || Math.abs(prev.pitch - s.pitch) > 0.02;
    const interval = changed ? 80 : 1000;
    if (now - this.lastSent.t < interval) return;
    this.lastSent = { t: now, s };
    this.events.onLocalState?.(s);
  }

  /** Re-announce our position right away, e.g. when someone new joins. */
  forceSendState() {
    this.lastSent.t = 0;
    this.lastSent.s = null;
  }

  get localState(): PlayerState {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
  }

  private updateAttract(dt: number) {
    // Slow drift through the lobby looking towards the auditorium.
    this.attractT += dt * 0.05;
    const t = this.attractT;
    const x = Math.sin(t) * 7;
    const z = 17 + Math.cos(t * 0.7) * 4;
    this.camera.position.set(x, 3.4 + Math.sin(t * 1.3) * 0.5, z);
    this.camera.lookAt(Math.sin(t + 1.2) * 3, 1.4, z - 12);
  }

  private updateRemotes(dt: number) {
    const f = 1 - Math.exp(-dt * 12);
    for (const r of this.remotes.values()) {
      if (!r.hasState) continue;
      const before = r.pos.clone();
      r.pos.x += (r.target.x - r.pos.x) * f;
      r.pos.y += (r.target.y - r.pos.y) * f;
      r.pos.z += (r.target.z - r.pos.z) * f;
      let dy = r.target.yaw - r.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.yaw += dy * f;
      r.pitch += (r.target.pitch - r.pitch) * f;
      const moved = Math.hypot(r.pos.x - before.x, r.pos.z - before.z) / Math.max(dt, 1e-3);
      r.speed += (moved - r.speed) * Math.min(1, dt * 8);
      r.avatar.root.position.copy(r.pos);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.update(dt, r.speed, r.pitch);
    }
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.age += dt;
      // Small sub-steps so fast confetti can't skip through someone at low frame rates.
      const steps = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.2));
      const h = dt / steps;
      let hit = p.age > 3;
      for (let s = 0; s < steps && !hit; s++) {
        p.vel.y -= 6 * h;
        p.mesh.position.addScaledVector(p.vel, h);
        hit = this.projectileHits(p);
      }
      if (hit) {
        this.burst(p.mesh.position, p.color);
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private projectileHits(p: Projectile): boolean {
    const tmp = new THREE.Vector3();
    const at = p.mesh.position;
    for (const r of this.remotes.values()) {
      if (!r.hasState || r.id === p.ownerId) continue;
      if (r.avatar.center(tmp).distanceToSquared(at) < 0.6 * 0.6 || tmp.setY(r.pos.y + 1.65).distanceToSquared(at) < 0.4 * 0.4) {
        r.avatar.splat();
        if (p.ownerId === this.localId) {
          this.events.onHit?.(r.id);
          this.playPop(0.8);
        }
        return true;
      }
    }
    if (p.ownerId !== this.localId && this.mode === 'play') {
      tmp.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
      if (tmp.distanceToSquared(at) < 0.6 * 0.6) {
        this.events.onLocalHit?.(p.ownerId);
        return true;
      }
    }
    if (at.y <= groundAt(this.venue.boxes, at.x, at.z, at.y, 0, 0) || blocked(this.venue.boxes, at.x, at.z, at.y, 0.05, 0)) return true;
    return at.y > 13 || (at.z < 0 && at.y > 12.8) || at.y > 20;
  }

  private updateParticles(dt: number) {
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let any = false;
    for (let k = 0; k < PARTICLES; k++) {
      if (this.particleLife[k]! <= 0) continue;
      any = true;
      this.particleLife[k]! -= dt;
      const i = k * 3;
      this.particleVel[i + 1]! -= 5 * dt;
      // Confetti flutters: heavy drag.
      this.particleVel[i]! *= 1 - 2 * dt;
      this.particleVel[i + 2]! *= 1 - 2 * dt;
      arr[i]! += this.particleVel[i]! * dt;
      arr[i + 1]! += this.particleVel[i + 1]! * dt;
      arr[i + 2]! += this.particleVel[i + 2]! * dt;
      if (arr[i + 1]! < 0.02) {
        arr[i + 1] = 0.02;
        this.particleVel[i] = this.particleVel[i + 1] = this.particleVel[i + 2] = 0;
      }
      if (this.particleLife[k]! <= 0) arr[i + 1] = -999;
    }
    if (any) pos.needsUpdate = true;
  }

  // ------------------------------------------------------------------ minimap

  drawMinimap(ctx: CanvasRenderingContext2D, names: (id: string) => { color: string } | undefined) {
    const { width: w, height: h } = ctx.canvas;
    const plan = this.venue.plan;
    const sx = w / (plan.maxX - plan.minX);
    const sz = h / (plan.maxZ - plan.minZ);
    const s = Math.min(sx, sz);
    const ox = (w - (plan.maxX - plan.minX) * s) / 2;
    const oz = (h - (plan.maxZ - plan.minZ) * s) / 2;
    const px = (x: number) => ox + (x - plan.minX) * s;
    const pz = (z: number) => oz + (z - plan.minZ) * s;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.35)';
    ctx.fillRect(px(LOBBY.minX), pz(LOBBY.minZ), (LOBBY.maxX - LOBBY.minX) * s, (LOBBY.maxZ - LOBBY.minZ) * s);
    ctx.fillStyle = 'rgba(114, 9, 183, 0.45)';
    ctx.fillRect(px(AUDITORIUM.minX), pz(AUDITORIUM.minZ), (AUDITORIUM.maxX - AUDITORIUM.minX) * s, (AUDITORIUM.maxZ - AUDITORIUM.minZ) * s);
    ctx.fillStyle = 'rgba(255, 107, 53, 0.8)';
    ctx.fillRect(px(STAGE.minX), pz(STAGE.minZ), (STAGE.maxX - STAGE.minX) * s, (STAGE.maxZ - STAGE.minZ) * s);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const b of this.venue.boxes) {
      if (b.top < 0.9 || b.top > 50) continue;
      ctx.fillRect(px(b.minX), pz(b.minZ), Math.max(1, (b.maxX - b.minX) * s), Math.max(1, (b.maxZ - b.minZ) * s));
    }
    for (const r of this.remotes.values()) {
      if (!r.hasState) continue;
      ctx.fillStyle = names(r.id)?.color ?? '#fff';
      ctx.beginPath();
      ctx.arc(px(r.pos.x), pz(r.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.mode === 'play') {
      const x = px(this.pos.x);
      const z = pz(this.pos.z);
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(-this.yaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function skyGradient(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#120c3a');
  g.addColorStop(0.55, '#5a189a');
  g.addColorStop(1, '#ff7aa2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
