import * as THREE from 'three';
import { banner, canvasTexture, carpet, checkerFloor, neonSign, wallPanel } from './textures';

/**
 * The venue: a networking lobby joined by a wide doorway to an auditorium with
 * a stage and a giant screen. Everything is built from primitives at runtime.
 *
 * Coordinates are metres. Looking down the negative Z axis from the lobby you
 * face the auditorium.
 */

/** Axis-aligned box on the floor plan. Things you can bump into or stand on. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the top surface. Walls use a big number. */
  top: number;
}

export type Zone = 'lobby' | 'auditorium' | 'stage';

export interface Venue {
  group: THREE.Group;
  boxes: Box[];
  /** The giant screen behind the stage; its material map is swapped for live video. */
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  screenIdle: THREE.Texture;
  zoneAt(x: number, z: number, feetY: number): Zone;
  spawnPoint(): { x: number; z: number; yaw: number };
  /** Points of interest bots and the landing flythrough wander between. */
  waypoints: THREE.Vector2[];
  /** Floor plan outline for the minimap. */
  plan: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const LOBBY = { minX: -20, maxX: 20, minZ: 0, maxZ: 30 };
export const AUDITORIUM = { minX: -18, maxX: 18, minZ: -34, maxZ: 0 };
export const STAGE = { minX: -13, maxX: 13, minZ: -34, maxZ: -25, top: 1.1 };
export const PRESENTER_SPOT = new THREE.Vector2(0, -28.5);
const DOOR_HALF = 4;
const WALL = 0.5;

const toonRamp = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

export function toon(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshToonMaterialParameters> = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
}

export function buildVenue(): Venue {
  const group = new THREE.Group();
  const boxes: Box[] = [];

  const addBox = (
    b: Box,
    material: THREE.Material | null,
    opts: { bottom?: number; visualTop?: number; collide?: boolean } = {},
  ) => {
    if (opts.collide !== false) boxes.push(b);
    if (!material) return null;
    const bottom = opts.bottom ?? 0;
    const top = opts.visualTop ?? b.top;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, top - bottom, b.maxZ - b.minZ), material);
    mesh.position.set((b.minX + b.maxX) / 2, (top + bottom) / 2, (b.minZ + b.maxZ) / 2);
    group.add(mesh);
    return mesh;
  };

  // ---------- Floors ----------
  const lobbyFloorTex = checkerFloor('#ffd166', '#fff3c4', 8);
  lobbyFloorTex.repeat.set(LOBBY.maxX - LOBBY.minX, LOBBY.maxZ - LOBBY.minZ).multiplyScalar(1 / 4);
  const lobbyFloor = new THREE.Mesh(new THREE.PlaneGeometry(LOBBY.maxX - LOBBY.minX, LOBBY.maxZ - LOBBY.minZ), toon('#ffffff', { map: lobbyFloorTex }));
  lobbyFloor.rotation.x = -Math.PI / 2;
  lobbyFloor.position.set(0, 0, (LOBBY.minZ + LOBBY.maxZ) / 2);
  group.add(lobbyFloor);

  const audCarpet = carpet('#5b2a86', '#f72585');
  audCarpet.repeat.set(9, 8);
  const audFloor = new THREE.Mesh(new THREE.PlaneGeometry(AUDITORIUM.maxX - AUDITORIUM.minX, AUDITORIUM.maxZ - AUDITORIUM.minZ), toon('#ffffff', { map: audCarpet }));
  audFloor.rotation.x = -Math.PI / 2;
  audFloor.position.set(0, 0, (AUDITORIUM.minZ + AUDITORIUM.maxZ) / 2);
  group.add(audFloor);

  // ---------- Walls ----------
  const lobbyWallTex = wallPanel('#3a86ff', '#ffbe0b');
  lobbyWallTex.repeat.set(8, 1);
  const lobbyWall = toon('#ffffff', { map: lobbyWallTex });
  const audWallTex = wallPanel('#2b2d42', '#f72585');
  audWallTex.repeat.set(8, 1);
  const audWall = toon('#ffffff', { map: audWallTex });
  const LOBBY_H = 7;
  const AUD_H = 13;
  const BIG = 100;

  // Lobby: left, right, back.
  addBox({ minX: LOBBY.minX - WALL, maxX: LOBBY.minX, minZ: LOBBY.minZ, maxZ: LOBBY.maxZ + WALL, top: BIG }, lobbyWall, { visualTop: LOBBY_H });
  addBox({ minX: LOBBY.maxX, maxX: LOBBY.maxX + WALL, minZ: LOBBY.minZ, maxZ: LOBBY.maxZ + WALL, top: BIG }, lobbyWall, { visualTop: LOBBY_H });
  addBox({ minX: LOBBY.minX - WALL, maxX: LOBBY.maxX + WALL, minZ: LOBBY.maxZ, maxZ: LOBBY.maxZ + WALL, top: BIG }, lobbyWall, { visualTop: LOBBY_H });
  // Dividing wall with a wide doorway.
  addBox({ minX: LOBBY.minX - WALL, maxX: -DOOR_HALF, minZ: -WALL / 2, maxZ: WALL / 2, top: BIG }, lobbyWall, { visualTop: AUD_H });
  addBox({ minX: DOOR_HALF, maxX: LOBBY.maxX + WALL, minZ: -WALL / 2, maxZ: WALL / 2, top: BIG }, lobbyWall, { visualTop: AUD_H });
  addBox({ minX: -DOOR_HALF, maxX: DOOR_HALF, minZ: -WALL / 2, maxZ: WALL / 2, top: AUD_H }, lobbyWall, { bottom: 5, collide: false });
  // Auditorium: left, right, back.
  addBox({ minX: AUDITORIUM.minX - WALL, maxX: AUDITORIUM.minX, minZ: AUDITORIUM.minZ - WALL, maxZ: 0, top: BIG }, audWall, { visualTop: AUD_H });
  addBox({ minX: AUDITORIUM.maxX, maxX: AUDITORIUM.maxX + WALL, minZ: AUDITORIUM.minZ - WALL, maxZ: 0, top: BIG }, audWall, { visualTop: AUD_H });
  addBox({ minX: AUDITORIUM.minX - WALL, maxX: AUDITORIUM.maxX + WALL, minZ: AUDITORIUM.minZ - WALL, maxZ: AUDITORIUM.minZ, top: BIG }, audWall, { visualTop: AUD_H });
  // Auditorium ceiling with light strips.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(AUDITORIUM.maxX - AUDITORIUM.minX + 1, AUDITORIUM.maxZ - AUDITORIUM.minZ + 1), toon('#1b1b2f', { side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, AUD_H, (AUDITORIUM.minZ + AUDITORIUM.maxZ) / 2);
  group.add(ceiling);
  for (let z = -30; z <= -4; z += 6.5) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(24, 0.15, 0.4), new THREE.MeshBasicMaterial({ color: '#ffd6ff' }));
    strip.position.set(0, AUD_H - 0.1, z);
    group.add(strip);
  }

  // ---------- Stage ----------
  const stageMat = toon('#ff6b35');
  addBox({ ...STAGE }, stageMat);
  const stageEdge = new THREE.Mesh(new THREE.BoxGeometry(STAGE.maxX - STAGE.minX, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
  stageEdge.position.set(0, STAGE.top, STAGE.maxZ);
  group.add(stageEdge);
  const stepMat = toon('#f4a261');
  for (const cx of [-9, 0, 9]) {
    addBox({ minX: cx - 2, maxX: cx + 2, minZ: STAGE.maxZ, maxZ: STAGE.maxZ + 0.8, top: 0.55 }, stepMat);
  }
  // Presenter spot: a glowing ring on the stage.
  const spot = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#fff3b0', side: THREE.DoubleSide }));
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(PRESENTER_SPOT.x, STAGE.top + 0.01, PRESENTER_SPOT.y);
  group.add(spot);
  const spotLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({ map: neonSign('STAND HERE TO PRESENT', '#ffd166', 1024, 256, 'bold 84px system-ui, sans-serif'), transparent: true }),
  );
  spotLabel.rotation.x = -Math.PI / 2;
  spotLabel.position.set(PRESENTER_SPOT.x, STAGE.top + 0.02, PRESENTER_SPOT.y + 1.6);
  group.add(spotLabel);
  // Lectern off to one side so it does not hide the presenter.
  addBox({ minX: 5, maxX: 6.2, minZ: -28.2, maxZ: -27.4, top: STAGE.top + 1.15 }, toon('#2b2d42'), { bottom: STAGE.top });

  // ---------- Big screen ----------
  const screenW = 19;
  const screenH = screenW * (9 / 16);
  const screenIdle = idleScreenTexture();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(screenW + 0.8, screenH + 0.8, 0.3), toon('#111111'));
  frame.position.set(0, 2.2 + screenH / 2, AUDITORIUM.minZ + 0.2);
  group.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), new THREE.MeshBasicMaterial({ map: screenIdle, toneMapped: false }));
  screen.position.set(0, 2.2 + screenH / 2, AUDITORIUM.minZ + 0.37);
  group.add(screen);

  // ---------- Seating ----------
  const seatMat = toon('#e63946');
  const backMat = toon('#9d0208');
  for (let i = 0; i < 7; i++) {
    const z = -20 + i * 2.3;
    for (const [minX, maxX] of [
      [-14.5, -2.5],
      [2.5, 14.5],
    ] as const) {
      // Cushion row you can hop onto, with a backrest behind it.
      addBox({ minX, maxX, minZ: z, maxZ: z + 0.6, top: 0.5 }, seatMat);
      addBox({ minX, maxX, minZ: z + 0.6, maxZ: z + 0.8, top: 1.05 }, backMat);
      for (let x = minX + 0.6; x < maxX; x += 1.2) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.6), backMat);
        arm.position.set(x, 0.62, z + 0.3);
        group.add(arm);
      }
    }
  }

  // ---------- Lobby furniture ----------
  // Bar along the right wall.
  addBox({ minX: 14.5, maxX: 16, minZ: 7, maxZ: 23, top: 1.15 }, toon('#8338ec'));
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 16.4), toon('#ffbe0b'));
  barTop.position.set(15.25, 1.19, 15);
  group.add(barTop);
  addBox({ minX: 19, maxX: 20, minZ: 6, maxZ: 24, top: 3 }, toon('#3d348b'), { collide: true });
  for (let z = 7.5; z < 23; z += 1.4) {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), toon(['#06d6a0', '#ef476f', '#ffd166', '#118ab2'][Math.floor(z) % 4]!));
    bottle.position.set(19.3, 3.2, z);
    group.add(bottle);
  }
  const barSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: neonSign('JUICE BAR', '#06d6a0'), transparent: true }));
  barSign.position.set(19.9 - 0.45, 4.6, 15);
  barSign.rotation.y = -Math.PI / 2;
  group.add(barSign);

  // High tables for mingling.
  const tableTop = toon('#ffffff');
  const tableLeg = toon('#2b2d42');
  const tables: Array<[number, number]> = [
    [-12, 8], [-6, 6], [0, 9], [6, 6], [10, 12], [-10, 15], [-4, 14], [4, 16], [-12, 22], [-5, 21], [8, 21],
  ];
  for (const [x, z] of tables) {
    boxes.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, top: 1.1 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 20), tableTop);
    top.position.set(x, 1.1, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), tableLeg);
    leg.position.set(x, 0.55, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16), tableLeg);
    foot.position.set(x, 0.03, z);
    const snack = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 6), toon(['#ef476f', '#06d6a0', '#ffd166'][(x + z + 30) % 3]!));
    snack.position.set(x + 0.2, 1.27, z);
    group.add(top, leg, foot, snack);
  }

  // Couches by the left wall.
  const couchMat = toon('#06d6a0');
  for (const z of [9, 17]) {
    addBox({ minX: -19.9, maxX: -17.3, minZ: z - 2, maxZ: z + 2, top: 0.5 }, couchMat);
    addBox({ minX: -19.9, maxX: -19.2, minZ: z - 2, maxZ: z + 2, top: 1.2 }, toon('#049f76'));
  }

  // Plants.
  const potMat = toon('#e76f51');
  const leafMat = toon('#2a9d8f');
  for (const [x, z] of [[-18.5, 2], [18.5, 2], [-18.5, 28.5], [18.5, 28.5], [-6, 1.2], [6, 1.2]] as Array<[number, number]>) {
    boxes.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: 0.7 });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 12), potMat);
    pot.position.set(x, 0.35, z);
    group.add(pot);
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 - k * 0.12, 0), leafMat);
      leaf.position.set(x, 1.0 + k * 0.45, z);
      group.add(leaf);
    }
  }

  // Mascot statue: a giant CRT-headed figure on a plinth.
  addBox({ minX: -1.6, maxX: 1.6, minZ: 23.4, maxZ: 26.6, top: 0.8 }, toon('#ffffff'));
  const mascot = new THREE.Group();
  const mBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.4, 6, 16), toon('#ff006e'));
  mBody.position.y = 2.4;
  const mHead = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 1.7), toon('#ffbe0b'));
  mHead.position.y = 4.4;
  const mFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.25),
    new THREE.MeshBasicMaterial({ map: canvasTexture(256, 192, (ctx, w, h) => {
      ctx.fillStyle = '#1b998b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111';
      ctx.fillRect(w * 0.27, h * 0.3, w * 0.1, h * 0.2);
      ctx.fillRect(w * 0.63, h * 0.3, w * 0.1, h * 0.2);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.55, w * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }) }),
  );
  mFace.position.set(0, 4.4, -0.86);
  mFace.rotation.y = Math.PI;
  const mFace2 = mFace.clone();
  mFace2.position.z = 0.86;
  mFace2.rotation.y = 0;
  mascot.add(mBody, mHead, mFace, mFace2);
  mascot.position.set(0, 0, 25);
  mascot.name = 'mascot';
  group.add(mascot);

  // ---------- Signs ----------
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: neonSign('MINGLE', '#ff006e'), transparent: true }));
  logo.position.set(0, 5, LOBBY.maxZ - 0.01);
  logo.rotation.y = Math.PI;
  group.add(logo);
  const tagline = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), toon('#ffffff', { map: banner(['WHERE ZOOM', 'MEETS DOOM'], '#ff006e', '#fff3b0') }));
  tagline.position.set(LOBBY.minX + 0.01, 4.2, 15);
  tagline.rotation.y = Math.PI / 2;
  group.add(tagline);
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: neonSign('AUDITORIUM', '#ffd166'), transparent: true }));
  doorSign.position.set(0, 6.2, WALL / 2 + 0.02);
  group.add(doorSign);
  const nowShowing = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.3), new THREE.MeshBasicMaterial({ map: neonSign('NOW SHOWING ↓', '#4cc9f0', 1024, 160, 'bold 110px system-ui, sans-serif'), transparent: true }));
  nowShowing.position.set(0, 7.7, WALL / 2 + 0.02);
  group.add(nowShowing);

  // ---------- Lights ----------
  group.add(new THREE.HemisphereLight('#fff7e6', '#6c5b7b', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(8, 20, 12);
  group.add(sun);
  const stageLight = new THREE.SpotLight('#fff1d6', 120, 30, Math.PI / 6, 0.5, 1.2);
  stageLight.position.set(0, 12, -18);
  stageLight.target.position.set(0, 1, -28.5);
  group.add(stageLight, stageLight.target);
  const barGlow = new THREE.PointLight('#06d6a0', 30, 12);
  barGlow.position.set(17, 3, 15);
  group.add(barGlow);

  const spawnPoint = () => ({ x: (Math.random() - 0.5) * 16, z: 28.2 + Math.random(), yaw: 0 });

  const waypoints = [
    ...tables.map(([x, z]) => new THREE.Vector2(x + 1.1, z + 0.4)),
    new THREE.Vector2(13.6, 10), new THREE.Vector2(13.6, 18), // bar
    new THREE.Vector2(0, 2), new THREE.Vector2(0, -3), // doorway
    new THREE.Vector2(-8, -10), new THREE.Vector2(8, -12), new THREE.Vector2(0, -16), new THREE.Vector2(-16, -14), new THREE.Vector2(16, -8),
  ];

  return {
    group,
    boxes,
    screen,
    screenIdle,
    zoneAt: (x, z, feetY) => zoneAt(x, z, feetY),
    spawnPoint,
    waypoints,
    plan: { minX: LOBBY.minX, maxX: LOBBY.maxX, minZ: AUDITORIUM.minZ, maxZ: LOBBY.maxZ },
  };
}

function idleScreenTexture(): THREE.CanvasTexture {
  return canvasTexture(1280, 720, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3a0ca3');
    g.addColorStop(1, '#f72585');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) ctx.fillRect(0, i * 60, w, 30);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff3b0';
    ctx.font = '900 150px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText('MINGLE', w / 2, h * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 58px system-ui, sans-serif';
    ctx.fillText('Where Zoom Meets Doom', w / 2, h * 0.58);
    ctx.font = '500 36px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Step into the glowing ring on stage to present', w / 2, h * 0.78);
  });
}

/** Which part of the venue a point is in. */
export function zoneAt(x: number, z: number, feetY: number): Zone {
  if (z < 0) {
    if (feetY >= STAGE.top - 0.15 && x >= STAGE.minX - 0.4 && x <= STAGE.maxX + 0.4 && z <= STAGE.maxZ + 0.4) return 'stage';
    return 'auditorium';
  }
  return 'lobby';
}

/** Floor height under a point, letting people step up onto low things. */
export function groundAt(boxes: Box[], x: number, z: number, feetY: number, radius: number, stepUp: number): number {
  let ground = 0;
  for (const b of boxes) {
    if (b.top > feetY + stepUp) continue;
    if (x + radius * 0.5 < b.minX || x - radius * 0.5 > b.maxX || z + radius * 0.5 < b.minZ || z - radius * 0.5 > b.maxZ) continue;
    if (b.top > ground) ground = b.top;
  }
  return ground;
}

/** True if a circle at (x, z) overlaps a box too tall to step onto. */
export function blocked(boxes: Box[], x: number, z: number, feetY: number, radius: number, stepUp: number): boolean {
  for (const b of boxes) {
    if (b.top <= feetY + stepUp) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}
