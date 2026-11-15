import * as THREE from 'three';

/** Small helpers that paint textures on a canvas, so the world ships with no image assets. */

export function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function checkerFloor(a: string, b: string, tiles = 8): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const s = w / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, h);
      ctx.moveTo(0, i * s);
      ctx.lineTo(w, i * s);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function carpet(base: string, fleck: string): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Retro cinema carpet: scattered squiggles and dots.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = i % 2 ? fleck : 'rgba(255,255,255,0.35)';
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 10, y - 12, x + 20, y);
      ctx.quadraticCurveTo(x + 30, y + 12, x + 40, y);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function wallPanel(base: string, stripe: string): THREE.CanvasTexture {
  const tex = canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, h * 0.62, w, h * 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, h * 0.68, w, h * 0.32);
    ctx.fillRect(w - 3, 0, 3, h);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A glowing neon-style sign. */
export function neonSign(text: string, color: string, width = 1024, height = 256, font = 'bold 150px "Trebuchet MS", system-ui, sans-serif'): THREE.CanvasTexture {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    for (const blur of [40, 20, 8]) {
      ctx.shadowBlur = blur;
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, h / 2);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(text, w / 2, h / 2);
  });
}

export function banner(lines: string[], bg: string, fg: string): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = -h; x < w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
      ctx.lineTo(x + h + 25, 0);
      ctx.lineTo(x + 25, h);
      ctx.fill();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = lines.length > 1 ? 82 : 110;
    ctx.font = `900 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
  });
}

/** Cartoon face drawn on a CRT screen when someone has their camera off. */
export function paintCartoonFace(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, name: string, mood: 'happy' | 'talk' | 'blink' = 'happy') {
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
  g.addColorStop(0, shade(color, 0.25));
  g.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111';
  const eyeY = h * 0.4;
  if (mood === 'blink') {
    ctx.fillRect(w * 0.28, eyeY, w * 0.14, h * 0.035);
    ctx.fillRect(w * 0.58, eyeY, w * 0.14, h * 0.035);
  } else {
    ctx.beginPath();
    ctx.ellipse(w * 0.35, eyeY, w * 0.06, h * 0.1, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.65, eyeY, w * 0.06, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w * 0.365, eyeY - h * 0.04, w * 0.02, 0, Math.PI * 2);
    ctx.arc(w * 0.665, eyeY - h * 0.04, w * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = w * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'talk') {
    ctx.fillStyle = '#3b0d0d';
    ctx.ellipse(w * 0.5, h * 0.68, w * 0.1, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.arc(w * 0.5, h * 0.6, w * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.round(h * 0.11)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(initials(name), w / 2, h * 0.93);
  scanlines(ctx, w, h);
}

export function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  if (amount > 0) c.lerp(new THREE.Color('#ffffff'), amount);
  else c.lerp(new THREE.Color('#000000'), -amount);
  return `#${c.getHexString()}`;
}
