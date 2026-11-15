import { BOARD_H, BOARD_W, clearBoard, PODS, type PodId, type Venue } from './venue';

/**
 * One pen stroke on a pod whiteboard. Points are flattened x,y pairs in
 * board space scaled to 0–1000, so strokes are small on the wire and
 * resolution-independent.
 */
export interface Stroke {
  b: PodId;
  c: string;
  w: number;
  p: number[];
}

export const PEN_COLORS = ['#1d2027', '#c8505f', '#3d7ea6', '#4f9d69', '#d9a050'];
const MAX_STROKES = 600;

/** Keeps every board's strokes and paints them onto the venue's board textures. */
export class Whiteboards {
  private strokes: Record<PodId, Stroke[]> = { podA: [], podB: [] };
  /** Called after any change, e.g. to repaint an open full-size editor. */
  onChange?: (b: PodId) => void;

  constructor(private venue: Venue) {}

  add(s: Stroke) {
    const clean = cleanStroke(s);
    if (!clean) return;
    const list = this.strokes[clean.b];
    list.push(clean);
    if (list.length > MAX_STROKES) list.shift();
    paintStroke(this.venue.boards[clean.b].canvas.getContext('2d')!, clean, BOARD_W, BOARD_H);
    this.venue.boards[clean.b].texture.needsUpdate = true;
    this.onChange?.(clean.b);
  }

  clear(b: PodId) {
    this.strokes[b] = [];
    clearBoard(this.venue.boards[b].canvas, PODS[b].label);
    this.venue.boards[b].texture.needsUpdate = true;
    this.onChange?.(b);
  }

  /** Repaint a board onto another canvas (the full-size editor). */
  paintInto(b: PodId, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.venue.boards[b].canvas, 0, 0, canvas.width, canvas.height);
  }
}

export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (s.p.length < 2) return;
  ctx.strokeStyle = s.c;
  ctx.lineWidth = s.w * (w / BOARD_W);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo((s.p[0]! / 1000) * w, (s.p[1]! / 1000) * h);
  if (s.p.length === 2) ctx.lineTo((s.p[0]! / 1000) * w + 0.1, (s.p[1]! / 1000) * h);
  for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo((s.p[i]! / 1000) * w, (s.p[i + 1]! / 1000) * h);
  ctx.stroke();
}

/** Validate a stroke from the network. */
export function cleanStroke(s: Stroke): Stroke | null {
  if (!s || (s.b !== 'podA' && s.b !== 'podB') || !Array.isArray(s.p) || s.p.length < 2 || s.p.length > 2000) return null;
  const p = s.p.map(Number);
  if (!p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
  const c = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#1d2027';
  const w = Number.isFinite(s.w) ? Math.min(40, Math.max(2, s.w)) : 6;
  return { b: s.b, c, w, p: p.map(Math.round) };
}
