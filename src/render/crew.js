import { toCss } from './textures.js';
import { FUNCS } from '../sim/config.js';

const shade = (c, k) => c.map((v) => Math.max(0, Math.min(1, v * k)));

/**
 * A little suited figure, feet at (x, y), drawn in whatever frame the context is in (y up).
 * pose: stand | walk | climb | carry | cast | reel | build | row | throw | wave | swim
 */
export function drawFigure(ctx, x, y, o) {
  const f = o.face || 1;
  const suit = o.suit || [0.9, 0.6, 0.3];
  const t = o.t || 0;
  const pose = o.pose || 'stand';
  const swing = pose === 'walk' || pose === 'carry' ? Math.sin(o.walkT || 0) : 0;
  const ink = 'rgba(10,8,14,0.85)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pose === 'swim') {
    // only head and arms above the surface
    ctx.strokeStyle = toCss(shade(suit, 0.85));
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    const a = Math.sin(t * 5) * 0.3;
    ctx.moveTo(x - 0.12, y + 0.05);
    ctx.lineTo(x - 0.35, y + 0.25 + a);
    ctx.moveTo(x + 0.12, y + 0.05);
    ctx.lineTo(x + 0.35, y + 0.25 - a);
    ctx.stroke();
    helmet(ctx, x, y + 0.12, f);
    return;
  }
  // legs
  ctx.strokeStyle = toCss(shade(suit, 0.55));
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  if (pose === 'climb') {
    ctx.moveTo(x - 0.06, y + 0.38);
    ctx.lineTo(x - 0.14, y + 0.14 + swing * 0.08);
    ctx.lineTo(x - 0.05, y + 0.02);
    ctx.moveTo(x + 0.06, y + 0.38);
    ctx.lineTo(x + 0.16, y + 0.22 - swing * 0.08);
    ctx.lineTo(x + 0.08, y + 0.1);
  } else {
    ctx.moveTo(x - 0.05, y + 0.38);
    ctx.lineTo(x - 0.08 + swing * 0.13, y + 0.03);
    ctx.moveTo(x + 0.05, y + 0.38);
    ctx.lineTo(x + 0.08 - swing * 0.13, y + 0.03);
  }
  ctx.stroke();
  // backpack
  ctx.fillStyle = toCss(shade(suit, 0.45));
  ctx.beginPath();
  ctx.roundRect(x - f * 0.25, y + 0.42, 0.11 * f || 0.11, 0.28, 0.04);
  ctx.fill();
  // torso
  ctx.fillStyle = toCss(suit);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.roundRect(x - 0.15, y + 0.34, 0.3, 0.42, 0.1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x - 0.1, y + 0.56, 0.2, 0.05);
  // arms and whatever they hold
  const sh = { x: x + f * 0.07, y: y + 0.68 };
  ctx.strokeStyle = toCss(shade(suit, 0.8));
  ctx.lineWidth = 0.085;
  const arm = (hx, hy) => {
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  };
  switch (pose) {
    case 'carry':
    case 'climb':
      arm(x - 0.12, y + 1.02);
      arm(x + 0.12, y + 1.02);
      break;
    case 'cast':
    case 'reel': {
      const gx = x + f * 0.22,
        gy = y + 0.66;
      arm(gx, gy);
      // the rod: its tip is where the line leaves from
      const tip = { x: x + f * 0.62, y: y + 1.3 };
      const bend = pose === 'reel' ? 0.12 * Math.sin(t * 11) + 0.12 : 0;
      ctx.strokeStyle = '#2a211a';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(gx - f * 0.05, gy - 0.06);
      ctx.quadraticCurveTo(x + f * (0.45 + bend), y + 1.0 + bend * 0.5, tip.x, tip.y - bend);
      ctx.stroke();
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath();
      ctx.arc(x + f * 0.28, y + 0.72, 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'build': {
      const a = Math.sin(t * 12) * 0.9;
      const hx = x + f * (0.3 + 0.1 * Math.cos(a)),
        hy = y + 0.8 + 0.25 * Math.sin(a);
      arm(hx, hy);
      ctx.strokeStyle = '#3a3a40';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + f * 0.2 * Math.cos(a - 1.2), hy + 0.2 * Math.sin(a - 1.2));
      ctx.stroke();
      break;
    }
    case 'row': {
      const st = o.stroke ?? 0.5;
      const a = -1.05 + st * 0.75;
      const len = 1.9;
      const gx = x + f * 0.18,
        gy = y + 0.7;
      arm(gx, gy);
      ctx.strokeStyle = '#4a3726';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(gx - f * Math.cos(a) * 0.25, gy - Math.sin(a) * 0.25);
      ctx.lineTo(gx + f * Math.cos(a) * len, gy + Math.sin(a) * len);
      ctx.stroke();
      ctx.fillStyle = '#5a4430';
      ctx.beginPath();
      ctx.ellipse(gx + f * Math.cos(a) * len, gy + Math.sin(a) * len, 0.08, 0.2, a, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'throw':
      arm(x + f * 0.3, y + 1.05);
      break;
    case 'wave': {
      const w = Math.sin(t * 8) * 0.18;
      arm(x + f * 0.2 + w, y + 1.1);
      arm(x - f * 0.1, y + 0.42);
      break;
    }
    default:
      arm(x + f * 0.1 + swing * 0.06, y + 0.42);
  }
  helmet(ctx, x, y + 0.9, f);
}

function helmet(ctx, x, y, f) {
  ctx.fillStyle = '#e9ecef';
  ctx.strokeStyle = 'rgba(10,8,14,0.85)';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.arc(x, y, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1b2433';
  ctx.beginPath();
  ctx.ellipse(x + f * 0.06, y + 0.01, 0.09, 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,220,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x + f * 0.09, y + 0.04, 0.03, 0.018, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** A carried item, drawn small above the head. */
export function drawCarried(ctx, R, x, y, it) {
  const pts = it.pts;
  ctx.save();
  ctx.translate(x, y + 1.2);
  const s = pts ? Math.min(0.5 / Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))), 0.55) : 0.3;
  ctx.scale(s, s);
  ctx.beginPath();
  if (pts) pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  else ctx.rect(-0.5, -0.5, 1, 1);
  ctx.closePath();
  ctx.fillStyle = R.pattern(ctx, it.mat);
  ctx.fill();
  ctx.lineWidth = 0.08;
  ctx.strokeStyle = 'rgba(10,8,14,0.75)';
  ctx.stroke();
  ctx.restore();
}

/** Stockpile contents: a heap of little pieces in the bin, in their materials' colours. */
export function drawPileContents(ctx, R, b) {
  const list = b.state.contents;
  if (!list || !list.length) return;
  const cap = FUNCS.stockpile.capacity;
  let total = 0;
  for (const it of list) total += it.units;
  const pieces = [];
  for (const it of list) for (let i = 0; i < Math.max(1, Math.round((it.units / cap) * 9)); i++) pieces.push(it.mat);
  const n = pieces.length;
  const fill = Math.min(1.25, total / cap);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 3),
      col = i % 3;
    const px = b.gx - 0.27 + col * 0.27 + (row % 2) * 0.1 - 0.05;
    const py = b.gy - 0.32 + row * 0.24 * (fill > 0.9 ? 1.1 : 1);
    if (py > b.gy - 0.5 + fill * 0.95 + 0.15) break;
    const r = 0.13;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + i;
      const rr = r * (0.8 + 0.3 * ((i * 7 + k * 3) % 5) / 5);
      const xx = px + Math.cos(a) * rr,
        yy = py + Math.sin(a) * rr * 0.8;
      k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    }
    ctx.closePath();
    ctx.fillStyle = toCss(pieces[i].color);
    ctx.fill();
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = 'rgba(10,8,14,0.6)';
    ctx.stroke();
  }
}

/** The load line painted on the lander's hull: when the water reaches it, you're carrying too much. */
export function drawLoadLine(ctx, s) {
  const row = s.list.filter((b) => b.gy === 0);
  if (!row.length) return;
  const xs = row.map((b) => b.gx);
  for (const [gx, side] of [
    [Math.min(...xs), -1],
    [Math.max(...xs), 1],
  ]) {
    const x = gx + side * 0.18,
      y = 0.12;
    ctx.strokeStyle = 'rgba(255,250,240,0.85)';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(x, y, 0.15, 0, Math.PI * 2);
    ctx.moveTo(x - 0.26, y);
    ctx.lineTo(x + 0.26, y);
    ctx.stroke();
  }
}

/** Basalt: dark, columnar, and going nowhere. */
export function drawRock(ctx, rock, density) {
  const o = rock.outline;
  ctx.beginPath();
  o.forEach((p, i) => (i ? ctx.lineTo(rock.x + p[0], p[1]) : ctx.moveTo(rock.x + p[0], p[1])));
  ctx.closePath();
  if (density) {
    ctx.fillStyle = `rgb(${Math.round((2.8 / 4) * 255)},255,0)`;
    ctx.fill();
    return;
  }
  const top = Math.max(...o.map((p) => p[1]));
  const bot = Math.min(...o.map((p) => p[1]));
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, '#4f4c55');
  g.addColorStop(0.25, '#34323a');
  g.addColorStop(1, '#141418');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const rnd = (i) => {
    const v = Math.sin(i * 12.9898 + rock.x * 0.37) * 43758.5453;
    return v - Math.floor(v);
  };
  // basalt columns: each its own shade, lit from the sun's side, with staggered cooling joints
  let x = -8;
  for (let i = 0; x < 8; i++) {
    const w = 0.65 + 0.45 * rnd(i);
    const lean = (rnd(i + 50) - 0.5) * 0.25;
    const x0 = rock.x + x,
      x1 = x0 + w;
    const shade = rnd(i + 100);
    ctx.fillStyle = shade > 0.5 ? `rgba(255,255,255,${(shade - 0.5) * 0.09})` : `rgba(0,0,0,${(0.5 - shade) * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(x0, top + 1);
    ctx.lineTo(x1, top + 1);
    ctx.lineTo(x1 + lean * (top - bot), bot);
    ctx.lineTo(x0 + lean * (top - bot), bot);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,220,0.07)';
    ctx.fillRect(x0, bot, 0.07, top - bot + 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x1 - 0.06, bot, 0.06, top - bot + 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let y = top - 0.6 - rnd(i + 7) * 1.6, k = 0; y > bot; y -= 1.3 + rnd(i * 7 + k) * 1.5, k++) {
      const tilt = (rnd(i * 3 + k) - 0.5) * 0.3;
      ctx.moveTo(x0, y + tilt);
      ctx.lineTo(x1, y - tilt);
    }
    ctx.stroke();
    x += w;
  }
  // wet, darker below the waterline
  ctx.fillStyle = 'rgba(10,10,16,0.35)';
  ctx.fillRect(rock.x - 9, bot, 18, -bot);
  ctx.restore();
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  o.forEach((p, i) => (i ? ctx.lineTo(rock.x + p[0], p[1]) : ctx.moveTo(rock.x + p[0], p[1])));
  ctx.closePath();
  ctx.stroke();
}

/** The anchor: its chain runs to the sea floor while it's down, and it hangs at the bow while it's up. */
export function drawAnchor(ctx, game) {
  const col = game.colony;
  if (!col) return;
  const b = col.bounds();
  const side = game.anchorX < col.body.getWorldCenter().x ? -1 : 1;
  const lx = side < 0 ? b.x0 - 0.45 : b.x1 + 0.45;
  const top = col.body.getWorldPoint({ x: lx, y: -0.6 });
  let end;
  if (game.anchored) {
    const fx = game.anchorX + side * 14;
    end = { x: fx, y: game.physics.floorAt(fx) + 0.35 };
  } else end = { x: top.x + side * 0.15, y: top.y - 1.6 };
  const sag = game.anchored ? 4 : 0.1;
  const mx = (top.x + end.x) / 2 - side * sag * 0.6,
    my = (top.y + end.y) / 2;
  ctx.strokeStyle = 'rgba(30,28,30,0.95)';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.quadraticCurveTo(mx, my, end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,145,140,0.6)';
  ctx.lineWidth = 0.04;
  ctx.setLineDash([0.18, 0.14]);
  ctx.stroke();
  ctx.setLineDash([]);
  // the anchor itself
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.strokeStyle = '#2d2b2c';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(0, 0.55);
  ctx.lineTo(0, -0.35);
  ctx.moveTo(-0.38, 0.05);
  ctx.quadraticCurveTo(0, -0.55, 0.38, 0.05);
  ctx.moveTo(-0.2, 0.42);
  ctx.lineTo(0.2, 0.42);
  ctx.stroke();
  ctx.restore();
}

/** A parachute flare: up fast, then a slow red drift down. */
export function stepFlares(R, dt) {
  for (const f of R.flares) {
    f.t += dt;
    f.y += f.vy * dt;
    f.vy = Math.max(-1.1, f.vy - 11 * dt);
    if (f.t < 8 && Math.random() < dt * 14) R.particles.add({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 0.3, vy: 0.3, life: 2.5, size: 0.35, color: [0.75, 0.7, 0.7], kind: 'smoke', g: 0, drag: 1 });
  }
  R.flares = R.flares.filter((f) => f.t < 11);
}

export function drawFlares(ctx, R) {
  for (const f of R.flares) {
    const k = Math.max(0, Math.min(1, (11 - f.t) / 3)) * (0.75 + 0.25 * Math.sin(f.t * 30));
    const spr = R.softSprite([1, 0.25, 0.15]);
    const s = 3.2 * k;
    ctx.globalAlpha = 0.85 * k;
    ctx.drawImage(spr, f.x - s / 2, f.y - s / 2, s, s);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(255,${200 + 55 * k},${180 * k},${k})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
}
