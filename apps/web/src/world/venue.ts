import * as THREE from 'three';
import { banner, canvasTexture, carpet, checkerFloor, plaque, wallPanel } from './textures';

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

export type Zone = 'lobby' | 'auditorium' | 'stage' | 'podA' | 'podB';

/** Soundproof glass meeting pods in the lobby's back corners. */
export const PODS = {
  podA: { minX: -19.75, maxX: -12.5, minZ: 23.5, maxZ: 29.75, door: [-14.9, -13.1] as const, label: 'Pod A' },
  podB: { minX: 12.5, maxX: 19.75, minZ: 25, maxZ: 29.75, door: [13.1, 14.9] as const, label: 'Pod B' },
} as const;
export type PodId = keyof typeof PODS;
export const isPod = (z: Zone | null | undefined): z is PodId => z === 'podA' || z === 'podB';

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
  /** Shared whiteboards, one per pod. Draw on the canvas, then flag the texture. */
  boards: Record<PodId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; x: number; z: number }>;
  /** Discussion-group tables in the lobby, in the order groups are assigned. */
  groupTables: THREE.Vector2[];
  /** Host branding: event name on the back wall, sponsor line on the side banner. */
  setBranding(b: Branding | null): void;
}

export interface Branding {
  name: string;
  sponsor: string;
  color: string;
}

export const BOARD_W = 1024;
export const BOARD_H = 576;

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
  const lobbyFloorTex = checkerFloor('#e4dccd', '#ebe5d9', 8);
  lobbyFloorTex.repeat.set(LOBBY.maxX - LOBBY.minX, LOBBY.maxZ - LOBBY.minZ).multiplyScalar(1 / 4);
  const lobbyFloor = new THREE.Mesh(new THREE.PlaneGeometry(LOBBY.maxX - LOBBY.minX, LOBBY.maxZ - LOBBY.minZ), toon('#ffffff', { map: lobbyFloorTex }));
  lobbyFloor.rotation.x = -Math.PI / 2;
  lobbyFloor.position.set(0, 0, (LOBBY.minZ + LOBBY.maxZ) / 2);
  group.add(lobbyFloor);

  const audCarpet = carpet('#363a45', '#4a5060');
  audCarpet.repeat.set(9, 8);
  const audFloor = new THREE.Mesh(new THREE.PlaneGeometry(AUDITORIUM.maxX - AUDITORIUM.minX, AUDITORIUM.maxZ - AUDITORIUM.minZ), toon('#ffffff', { map: audCarpet }));
  audFloor.rotation.x = -Math.PI / 2;
  audFloor.position.set(0, 0, (AUDITORIUM.minZ + AUDITORIUM.maxZ) / 2);
  group.add(audFloor);

  // ---------- Walls ----------
  const lobbyWallTex = wallPanel('#e9e5dd', '#c4ae8c');
  lobbyWallTex.repeat.set(8, 1);
  const lobbyWall = toon('#ffffff', { map: lobbyWallTex });
  const audWallTex = wallPanel('#2e333d', '#7c6a52');
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
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(AUDITORIUM.maxX - AUDITORIUM.minX + 1, AUDITORIUM.maxZ - AUDITORIUM.minZ + 1), toon('#23272f', { side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, AUD_H, (AUDITORIUM.minZ + AUDITORIUM.maxZ) / 2);
  group.add(ceiling);
  for (let z = -30; z <= -4; z += 6.5) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(24, 0.15, 0.4), new THREE.MeshBasicMaterial({ color: '#f3efe6' }));
    strip.position.set(0, AUD_H - 0.1, z);
    group.add(strip);
  }

  // ---------- Stage ----------
  const stageMat = toon('#4b505c');
  addBox({ ...STAGE }, stageMat);
  const stageEdge = new THREE.Mesh(new THREE.BoxGeometry(STAGE.maxX - STAGE.minX, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#e8dcc0' }));
  stageEdge.position.set(0, STAGE.top, STAGE.maxZ);
  group.add(stageEdge);
  const stepMat = toon('#5c616d');
  for (const cx of [-9, 0, 9]) {
    addBox({ minX: cx - 2, maxX: cx + 2, minZ: STAGE.maxZ, maxZ: STAGE.maxZ + 0.8, top: 0.55 }, stepMat);
  }
  // Presenter spot: a glowing ring on the stage.
  const spot = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#e8dcc0', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(PRESENTER_SPOT.x, STAGE.top + 0.01, PRESENTER_SPOT.y);
  group.add(spot);
  const spotLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({ map: plaque('STAND HERE TO PRESENT', '#e8dcc0', 1024, 256, '600 72px system-ui, sans-serif'), transparent: true }),
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
  const seatMat = toon('#7a3e44');
  const backMat = toon('#5e2f34');
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
  addBox({ minX: 14.5, maxX: 16, minZ: 7, maxZ: 23, top: 1.15 }, toon('#7a6250'));
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 16.4), toon('#ddd3c3'));
  barTop.position.set(15.25, 1.19, 15);
  group.add(barTop);
  addBox({ minX: 19, maxX: 20, minZ: 6, maxZ: 24, top: 3 }, toon('#5a4a3e'), { collide: true });
  for (let z = 7.5; z < 23; z += 1.4) {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), toon(['#6f9a85', '#a86b6b', '#c9a86a', '#5f7f9a'][Math.floor(z) % 4]!));
    bottle.position.set(19.3, 3.2, z);
    group.add(bottle);
  }
  const barSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: plaque('JUICE BAR', '#f1ece2'), transparent: true }));
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
    const snack = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 6), toon(['#c48b7a', '#8fae96', '#d6bd8c'][(x + z + 30) % 3]!));
    snack.position.set(x + 0.2, 1.27, z);
    group.add(top, leg, foot, snack);
  }

  // Couches by the left wall.
  const couchMat = toon('#7f9389');
  for (const z of [9, 17]) {
    addBox({ minX: -19.9, maxX: -17.3, minZ: z - 2, maxZ: z + 2, top: 0.5 }, couchMat);
    addBox({ minX: -19.9, maxX: -19.2, minZ: z - 2, maxZ: z + 2, top: 1.2 }, toon('#6b7d74'));
  }

  // Plants.
  const potMat = toon('#b49a80');
  const leafMat = toon('#6b8f6f');
  for (const [x, z] of [[-18.5, 2], [18.5, 2], [-6, 1.2], [6, 1.2]] as Array<[number, number]>) {
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

  // Soundproof meeting pods: glass rooms where only the people inside hear each other.
  const boards = {} as Venue['boards'];
  const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false });
  const frameMat = toon('#8a8f99');
  for (const pod of Object.values(PODS)) {
    const inner = pod.minX < 0 ? pod.maxX : pod.minX;
    const glassWall = (b: Box) => {
      addBox(b, glass, { visualTop: 3 });
      const rail = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 0.02, 0.08, b.maxZ - b.minZ + 0.02), frameMat);
      rail.position.set((b.minX + b.maxX) / 2, 3, (b.minZ + b.maxZ) / 2);
      group.add(rail);
    };
    // Front wall with a doorway, and the side wall facing the lobby.
    glassWall({ minX: pod.minX, maxX: pod.door[0], minZ: pod.minZ - 0.06, maxZ: pod.minZ + 0.06, top: BIG });
    glassWall({ minX: pod.door[1], maxX: pod.maxX, minZ: pod.minZ - 0.06, maxZ: pod.minZ + 0.06, top: BIG });
    glassWall({ minX: inner - 0.06, maxX: inner + 0.06, minZ: pod.minZ, maxZ: pod.maxZ, top: BIG });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(pod.door[1] - pod.door[0], 0.6, 0.12), frameMat);
    lintel.position.set((pod.door[0] + pod.door[1]) / 2, 2.7, pod.minZ);
    group.add(lintel);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), new THREE.MeshBasicMaterial({ map: plaque(`${pod.label.toUpperCase()} · PRIVATE`, '#3d4350', 1024, 170, '700 90px system-ui, sans-serif'), transparent: true }));
    sign.position.set((pod.minX + pod.maxX) / 2, 3.35, pod.minZ - 0.02);
    sign.rotation.y = Math.PI;
    group.add(sign);
    // A table and a rug inside.
    const cx = (pod.minX + pod.maxX) / 2;
    const cz = (pod.minZ + pod.maxZ) / 2 + 0.5;
    boxes.push({ minX: cx - 0.9, maxX: cx + 0.9, minZ: cz - 0.6, maxZ: cz + 0.6, top: 0.75 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 1.2), toon('#cbb89c'));
    top.position.set(cx, 0.75, cz);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.3), toon('#5b5f69'));
    base.position.set(cx, 0.36, cz);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(pod.maxX - pod.minX - 1, pod.maxZ - pod.minZ - 1), toon('#c9c2b4'));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx, 0.01, (pod.minZ + pod.maxZ) / 2);
    group.add(top, base, rug);
    // A whiteboard on the back wall.
    const canvas = document.createElement('canvas');
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    clearBoard(canvas, pod.label);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    board.position.set(cx, 1.85, pod.maxZ - 0.06);
    board.rotation.y = Math.PI;
    const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(3.35, 1.95, 0.05), frameMat);
    boardFrame.position.set(cx, 1.85, pod.maxZ - 0.02);
    group.add(boardFrame, board);
    boards[pod.label === 'Pod A' ? 'podA' : 'podB'] = { canvas, texture, x: cx, z: pod.maxZ - 0.06 };
  }

  // Mascot statue: a giant CRT-headed figure on a plinth.
  addBox({ minX: -1.6, maxX: 1.6, minZ: 23.4, maxZ: 26.6, top: 0.8 }, toon('#ffffff'));
  const mascot = new THREE.Group();
  const mBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.4, 6, 16), toon('#c9775f'));
  mBody.position.y = 2.4;
  const mHead = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 1.7), toon('#ece3d3'));
  mHead.position.y = 4.4;
  const mFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.25),
    new THREE.MeshBasicMaterial({ map: canvasTexture(256, 192, (ctx, w, h) => {
      ctx.fillStyle = '#5b7d73';
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
  const logoFont = '800 150px "Trebuchet MS", system-ui, sans-serif';
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: plaque('MINGLE', '#6b5b4b', 1024, 256, logoFont), transparent: true }));
  logo.position.set(0, 4.6, LOBBY.maxZ - 0.01);
  logo.scale.setScalar(0.6);
  logo.rotation.y = Math.PI;
  group.add(logo);
  const defaultBanner = () => banner(['WHERE ZOOM', 'MEETS DOOM'], '#3f4a5a', '#efe6d4');
  const tagline = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), toon('#ffffff', { map: defaultBanner() }));
  tagline.position.set(LOBBY.minX + 0.01, 4.2, 15);
  tagline.rotation.y = Math.PI / 2;
  group.add(tagline);
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: plaque('AUDITORIUM  →  KEYNOTES', '#5a4a3e', 1024, 256, '700 96px system-ui, sans-serif'), transparent: true }));
  doorSign.position.set(0, 6.2, WALL / 2 + 0.02);
  group.add(doorSign);

  // ---------- Lights ----------
  group.add(new THREE.HemisphereLight('#fff9f0', '#7a7468', 1.7));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(8, 20, 12);
  group.add(sun);
  const stageLight = new THREE.SpotLight('#fff1d6', 120, 30, Math.PI / 6, 0.5, 1.2);
  stageLight.position.set(0, 12, -18);
  stageLight.target.position.set(0, 1, -28.5);
  group.add(stageLight, stageLight.target);
  const barGlow = new THREE.PointLight('#ffe2b8', 12, 12);
  barGlow.position.set(17, 3, 15);
  group.add(barGlow);

  const spawnPoint = () => ({ x: (Math.random() - 0.5) * 16, z: 28.2 + Math.random(), yaw: 0 });

  const waypoints = [
    ...tables.map(([x, z]) => new THREE.Vector2(x + 1.1, z + 0.4)),
    new THREE.Vector2(13.6, 10), new THREE.Vector2(13.6, 18), // bar
    new THREE.Vector2(-14, 22.5), new THREE.Vector2(-16.5, 26), new THREE.Vector2(14, 24), new THREE.Vector2(16, 27.5), // pods
    new THREE.Vector2(0, 2), new THREE.Vector2(0, -3), // doorway
    new THREE.Vector2(-8, -10), new THREE.Vector2(8, -12), new THREE.Vector2(0, -16), new THREE.Vector2(-16, -14), new THREE.Vector2(16, -8),
  ];

  const setBranding = (b: Branding | null) => {
    const logoMat = logo.material;
    const bannerMat = tagline.material as THREE.MeshToonMaterial;
    logoMat.map?.dispose();
    bannerMat.map?.dispose();
    const name = b?.name.trim().toUpperCase().slice(0, 28) || 'MINGLE';
    const font = name.length > 12 ? `800 ${Math.max(56, Math.floor(1350 / name.length))}px "Trebuchet MS", system-ui, sans-serif` : logoFont;
    logoMat.map = plaque(name, b?.color || '#6b5b4b', 1024, 256, font);
    bannerMat.map = b?.sponsor.trim() ? banner(['WITH THANKS TO', b.sponsor.trim().toUpperCase().slice(0, 22)], b.color || '#3f4a5a', '#ffffff') : defaultBanner();
    logoMat.needsUpdate = true;
    bannerMat.needsUpdate = true;
  };

  // Discussion-group tables, spread around the lobby.
  const groupTables = [[-6, 6], [6, 6], [-10, 15], [10, 12], [-4, 14], [4, 16], [-5, 21], [8, 21]].map(([x, z]) => new THREE.Vector2(x!, z!));

  return {
    group,
    boxes,
    boards,
    groupTables,
    setBranding,
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
    g.addColorStop(0, '#20252e');
    g.addColorStop(1, '#3a4250');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
    ctx.fillStyle = '#efe6d4';
    ctx.font = '800 130px "Trebuchet MS", system-ui, sans-serif';
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
  for (const [id, pod] of Object.entries(PODS) as Array<[PodId, (typeof PODS)[PodId]]>) {
    if (x > pod.minX && x < pod.maxX && z > pod.minZ && z < pod.maxZ) return id;
  }
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

/** Wipe a whiteboard back to blank, with a faint label in the corner. */
export function clearBoard(canvas: HTMLCanvasElement, label: string) {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(60,64,72,0.35)';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.fillText(`${label} whiteboard · press B to draw`, 24, canvas.height - 24);
}
