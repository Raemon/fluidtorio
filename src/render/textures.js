import { mulberry32 } from '../sim/rng.js';

const T = 64;

function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toCss(c, a = 1) {
  const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  return `rgba(${r},${g},${b},${a})`;
}
export { toCss };

function noise2(seed) {
  const rnd = mulberry32(seed);
  const N = 16;
  const grid = new Float32Array(N * N).map(() => rnd());
  return (x, y) => {
    x = ((x % N) + N) % N;
    y = ((y % N) + N) % N;
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const u = xf * xf * (3 - 2 * xf),
      v = yf * yf * (3 - 2 * yf);
    const g = (i, j) => grid[((j % N) * N + (i % N)) | 0];
    const a = g(xi, yi),
      b = g(xi + 1, yi),
      c = g(xi, yi + 1),
      d = g(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(n, x, y, oct = 4) {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

/** A 64×64 lit tile for a material, pre-flipped vertically to suit the y-up world transform. */
export function materialTile(mat) {
  const c = makeCanvas(T, T);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(T, T);
  const seed = Math.floor((mat.hue + 1000) * 997) ^ mat.name.length * 131;
  const rnd = mulberry32(seed);
  const n = noise2(seed);
  const [r1, g1, b1] = mat.color;
  const [r2, g2, b2] = mat.color2;
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push([rnd() * T, rnd() * T, rnd()]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = x / T,
        v = y / T;
      let t = 0,
        shade = 1;
      switch (mat.pattern) {
        case 'strata': {
          const w = fbm(n, u * 4, v * 4, 3);
          t = 0.5 + 0.5 * Math.sin((v * 7 + w * 2.4) * Math.PI);
          t = t * 0.75 + fbm(n, u * 16, v * 16, 2) * 0.35;
          break;
        }
        case 'crystal': {
          let best = 1e9,
            second = 1e9,
            id = 0;
          for (let i = 0; i < pts.length; i++) {
            for (const [ox, oy] of [
              [0, 0],
              [T, 0],
              [-T, 0],
              [0, T],
              [0, -T],
            ]) {
              const d = Math.hypot(x - pts[i][0] - ox, y - pts[i][1] - oy);
              if (d < best) {
                second = best;
                best = d;
                id = i;
              } else if (d < second) second = d;
            }
          }
          t = pts[id][2];
          shade = 0.75 + 0.35 * Math.min(1, (second - best) / 6);
          break;
        }
        case 'speckle': {
          const s = rnd();
          t = fbm(n, u * 6, v * 6, 3) * 0.6 + (s > 0.93 ? 1 : s < 0.06 ? -0.4 : 0);
          break;
        }
        case 'fiber': {
          const w = fbm(n, u * 3, v * 3, 3);
          t = 0.5 + 0.5 * Math.sin((u * 3 + w * 3.5) * Math.PI * 4);
          t = Math.pow(t, 3) * 0.8 + fbm(n, u * 20, v * 3, 2) * 0.3;
          break;
        }
        case 'glass': {
          const w = fbm(n, u * 3, v * 3, 3);
          t = 0.35 + w * 0.4 + Math.max(0, 1 - Math.abs(u - v - 0.1) * 9) * 0.5;
          for (const p of pts.slice(0, 4)) {
            const d = Math.hypot(x - p[0], y - p[1]);
            const r = 2 + p[2] * 3;
            if (d < r) t += d > r - 1.2 ? 0.6 : -0.2;
          }
          break;
        }
        case 'metal': {
          t = 0.45 + fbm(n, u * 1.5, v * 30, 2) * 0.35 + 0.25 * (1 - v);
          break;
        }
        case 'plate': {
          t = 0.5 + fbm(n, u * 2, v * 2, 2) * 0.25 + 0.2 * (1 - v);
          const edge = Math.min(x, y, T - 1 - x, T - 1 - y);
          if (edge < 3) t += 0.25;
          if ([10, 54].some((cx) => [10, 54].some((cy) => Math.hypot(x - cx, y - cy) < 2.6))) t = 0.95;
          break;
        }
        case 'alloy': {
          const w = fbm(n, u * 3, v * 3, 4);
          t = 0.5 + 0.5 * Math.sin((u * 2 + v * 1.4 + w * 4) * Math.PI * 2);
          shade = 0.85 + 0.3 * (1 - v);
          break;
        }
        default:
          t = 0.5;
      }
      t = Math.max(0, Math.min(1, t));
      let r = r1 + (r2 - r1) * t,
        g = g1 + (g2 - g1) * t,
        b = b1 + (b2 - b1) * t;
      const edge = Math.min(x, y, T - 1 - x, T - 1 - y);
      let bev = 1;
      if (edge < 4) {
        const top = y < 4 && y <= x && y <= T - 1 - x;
        const left = x < 4 && x <= y && x <= T - 1 - y;
        const bottom = T - 1 - y < 4 && T - 1 - y <= x && T - 1 - y <= T - 1 - x;
        bev = top ? 1.35 : left ? 1.15 : bottom ? 0.55 : 0.75;
      }
      const lit = (1.08 - v * 0.22) * shade * bev;
      const i = ((T - 1 - y) * T + x) * 4;
      img.data[i] = Math.min(255, r * lit * 255);
      img.data[i + 1] = Math.min(255, g * lit * 255);
      img.data[i + 2] = Math.min(255, b * lit * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Overlay glyphs for block functions, drawn y-flipped like the tiles. */
export function functionIcon(fn) {
  const c = makeCanvas(T, T);
  const ctx = c.getContext('2d');
  ctx.translate(0, T);
  ctx.scale(1, -1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = 'rgba(14,12,18,0.82)';
  const light = 'rgba(255,248,232,0.9)';
  const S = (w) => (ctx.lineWidth = w);
  const plate = (inset = 9, r = 8) => {
    ctx.fillStyle = 'rgba(10,12,18,0.55)';
    ctx.beginPath();
    ctx.roundRect(inset, inset, T - inset * 2, T - inset * 2, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    S(1.5);
    ctx.stroke();
  };
  switch (fn) {
    case 'hollow': {
      const g = ctx.createLinearGradient(0, 10, 0, 54);
      g.addColorStop(0, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(10, 10, 44, 44, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      S(2);
      ctx.beginPath();
      ctx.roundRect(10, 10, 44, 44, 12);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      S(2.5);
      ctx.beginPath();
      ctx.arc(24, 24, 6, Math.PI, Math.PI * 1.6);
      ctx.stroke();
      break;
    }
    case 'crane': {
      plate(8, 6);
      ctx.strokeStyle = '#f5c542';
      S(5);
      ctx.beginPath();
      ctx.moveTo(18, 50);
      ctx.lineTo(18, 16);
      ctx.lineTo(48, 16);
      ctx.stroke();
      ctx.strokeStyle = light;
      S(2);
      ctx.beginPath();
      ctx.moveTo(44, 16);
      ctx.lineTo(44, 36);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(44, 41, 5, -Math.PI * 0.2, Math.PI * 1.2);
      ctx.stroke();
      break;
    }
    case 'smelter': {
      plate(7, 6);
      ctx.fillStyle = '#2a1a14';
      ctx.beginPath();
      ctx.roundRect(15, 26, 34, 24, 4);
      ctx.fill();
      const g = ctx.createRadialGradient(32, 40, 2, 32, 40, 16);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(0.4, '#ff8a20');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(19, 30, 26, 16, 3);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillRect(22, 12, 8, 14);
      break;
    }
    case 'pump': {
      plate(8, 6);
      ctx.strokeStyle = light;
      S(4);
      ctx.beginPath();
      ctx.moveTo(32, 14);
      ctx.lineTo(32, 50);
      ctx.stroke();
      ctx.fillStyle = '#ff7adf';
      ctx.beginPath();
      ctx.moveTo(32, 14);
      ctx.lineTo(23, 26);
      ctx.lineTo(41, 26);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,122,223,0.9)';
      S(2.5);
      ctx.beginPath();
      ctx.arc(32, 44, 9, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'condenser': {
      plate(8, 6);
      ctx.strokeStyle = '#9fe8ff';
      S(3);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(32, 32);
        ctx.lineTo(32 + Math.cos(a) * 17, 32 + Math.sin(a) * 17);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(32 + Math.cos(a) * 10, 32 + Math.sin(a) * 10);
        ctx.lineTo(32 + Math.cos(a + 0.5) * 14, 32 + Math.sin(a + 0.5) * 14);
        ctx.stroke();
      }
      break;
    }
    case 'refinery': {
      plate(7, 6);
      ctx.fillStyle = 'rgba(255,200,120,0.85)';
      ctx.beginPath();
      ctx.roundRect(14, 18, 14, 30, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,230,255,0.85)';
      ctx.beginPath();
      ctx.roundRect(36, 18, 14, 30, 6);
      ctx.fill();
      ctx.strokeStyle = light;
      S(3);
      ctx.beginPath();
      ctx.moveTo(21, 18);
      ctx.lineTo(21, 12);
      ctx.lineTo(43, 12);
      ctx.lineTo(43, 18);
      ctx.stroke();
      break;
    }
    case 'pad': {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 64, 15);
      ctx.clip();
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(0, 0, 64, 15);
      ctx.fillStyle = '#16141a';
      for (let x = -16; x < 64; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 7, 0);
        ctx.lineTo(x + 19, 15);
        ctx.lineTo(x + 12, 15);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = ink;
      for (const x of [12, 52]) {
        ctx.beginPath();
        ctx.arc(x, 36, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'engine': {
      ctx.fillStyle = '#1b1820';
      ctx.beginPath();
      ctx.moveTo(18, 34);
      ctx.lineTo(46, 34);
      ctx.lineTo(56, 62);
      ctx.lineTo(8, 62);
      ctx.closePath();
      ctx.fill();
      const g = ctx.createLinearGradient(8, 0, 56, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillRect(14, 8, 36, 26);
      ctx.strokeStyle = 'rgba(255,170,90,0.9)';
      S(2.5);
      ctx.strokeRect(17, 12, 30, 16);
      break;
    }
    case 'tank': {
      const g = ctx.createLinearGradient(6, 0, 58, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.45)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(6, 2, 52, 60, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,16,24,0.7)';
      S(3);
      for (const y of [14, 50]) {
        ctx.beginPath();
        ctx.moveTo(7, y);
        ctx.lineTo(57, y);
        ctx.stroke();
      }
      break;
    }
    case 'capsule': {
      ctx.fillStyle = 'rgba(235,238,245,0.95)';
      ctx.beginPath();
      ctx.moveTo(6, 62);
      ctx.lineTo(58, 62);
      ctx.lineTo(44, 14);
      ctx.quadraticCurveTo(32, -2, 20, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1d2a44';
      ctx.beginPath();
      ctx.arc(32, 38, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,220,255,0.9)';
      ctx.beginPath();
      ctx.arc(30, 36, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d23c2a';
      S(3);
      ctx.beginPath();
      ctx.moveTo(10, 56);
      ctx.lineTo(54, 56);
      ctx.stroke();
      break;
    }
    case 'core': {
      ctx.fillStyle = 'rgba(12,16,26,0.75)';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = 32 + Math.cos(a) * 24,
          y = 32 + Math.sin(a) * 24;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#7fe7ff';
      S(2.5);
      ctx.stroke();
      const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 12);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, '#7fe7ff');
      g.addColorStop(1, 'rgba(127,231,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(32, 32, 12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  return c;
}

/** Small CSS swatch for UI use (not flipped). */
export function swatchDataURL(mat, size = 40) {
  const tile = materialTile(mat);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  ctx.drawImage(tile, 0, 0, size, size);
  return c.toDataURL();
}

export function iconDataURL(fn, mat, size = 44) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  if (mat) ctx.drawImage(materialTile(mat), 0, 0, size, size);
  ctx.drawImage(functionIcon(fn), 0, 0, size, size);
  return c.toDataURL();
}
