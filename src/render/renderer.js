import { VERT, FRAG } from './shaders.js';
import { drawFigure, drawCarried, drawPileContents, drawLoadLine, drawRock, drawAnchor, stepFlares, drawFlares } from './crew.js';
import { materialTile, functionIcon, toCss } from './textures.js';
import { Particles } from './particles.js';
import { FUNCS } from '../sim/config.js';
import { N_LAYERS, SURFACE } from '../sim/sea.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(log);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const RHO_VIS_AIR = [0.0, 0.035, 0.09];

export class Renderer {
  constructor(glCanvas, overlayCanvas) {
    this.glCanvas = glCanvas;
    this.overlay = overlayCanvas;
    this.octx = overlayCanvas.getContext('2d');
    const gl = glCanvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.u[name] = gl.getUniformLocation(prog, info.name);
    }
    this.vao = gl.createVertexArray();
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.texObj = tex();
    this.texDen = tex();
    this.texIface = tex();
    gl.bindTexture(gl.TEXTURE_2D, this.texIface);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.cam = { x: 0, y: 3, zoom: 24, shake: 0 };
    this.particles = new Particles();
    this.tiles = new Map();
    this.patterns = new Map();
    this.icons = {};
    for (const fn of Object.keys(FUNCS)) this.icons[fn] = functionIcon(fn);
    this.schl = 0;
    this.schlTarget = 0;
    this.lens = { on: 0, target: 0, x: 0, y: 0, r: 120 };
    this.flash = 0;
    this.popups = [];
    this.flares = [];
    this.scale = 1;
    this.quality = 1;
    this.prevY = new WeakMap();
    this.firstSeen = new WeakMap();
    this.time = 0;
    this.splashT = 0;
    this.resize();
  }

  softSprite(c) {
    const key = c.map((v) => Math.round(v * 20)).join(',');
    this.sprites = this.sprites || new Map();
    let sp = this.sprites.get(key);
    if (!sp) {
      sp = makeCanvas(64, 64);
      const x = sp.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      const col = c.map((v) => Math.round(Math.min(1, v) * 255)).join(',');
      g.addColorStop(0, `rgba(${col},1)`);
      g.addColorStop(0.45, `rgba(${col},0.55)`);
      g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this.sprites.set(key, sp);
    }
    return sp;
  }

  tile(mat) {
    let t = this.tiles.get(mat.id);
    if (!t) {
      t = materialTile(mat);
      this.tiles.set(mat.id, t);
    }
    return t;
  }

  pattern(ctx, mat) {
    const key = mat.id;
    let p = this.patterns.get(key);
    if (!p || p.ctx !== ctx) {
      const pat = ctx.createPattern(this.tile(mat), 'repeat');
      pat.setTransform(new DOMMatrix().scale(1 / 64));
      p = { ctx, pat };
      this.patterns.set(key, p);
    }
    return p.pat;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.glCanvas.clientWidth || window.innerWidth;
    const ch = this.glCanvas.clientHeight || window.innerHeight;
    const maxPx = 2.6e6;
    let s = Math.min(dpr, 1.6) * this.quality;
    if (cw * ch * s * s > maxPx) s = Math.sqrt(maxPx / (cw * ch));
    this.scale = s;
    this.cssW = cw;
    this.cssH = ch;
    const W = Math.max(2, Math.round(cw * s));
    const H = Math.max(2, Math.round(ch * s));
    if (this.W === W && this.H === H) return;
    this.W = W;
    this.H = H;
    this.glCanvas.width = W;
    this.glCanvas.height = H;
    this.objCanvas = makeCanvas(W, H);
    this.objCtx = this.objCanvas.getContext('2d');
    this.denCanvas = makeCanvas(Math.ceil(W / 2), Math.ceil(H / 2));
    this.denCtx = this.denCanvas.getContext('2d', { willReadFrequently: false });
    this.patterns.clear();
    this.ifaceData = new Float32Array(W * 8);
    this.overlay.width = Math.round(cw * dpr);
    this.overlay.height = Math.round(ch * dpr);
    this.odpr = dpr;
  }

  // CSS pixel <-> world
  toScreen(x, y) {
    const c = this.cam;
    return { x: this.cssW / 2 + (x - c.x) * c.zoom, y: this.cssH / 2 - (y - c.y) * c.zoom };
  }

  toWorld(sx, sy) {
    const c = this.cam;
    return { x: c.x + (sx - this.cssW / 2) / c.zoom, y: c.y - (sy - this.cssH / 2) / c.zoom };
  }

  bodyTransform(ctx, body, k) {
    const xf = body.getTransform();
    const z = this.cam.zoom * this.scale * k;
    const c = xf.q.c,
      s = xf.q.s;
    const ox = (this.W * k) / 2 + (xf.p.x - this.camX) * z;
    const oy = (this.H * k) / 2 - (xf.p.y - this.camY) * z;
    ctx.setTransform(z * c, -z * s, -z * s, -z * c, ox, oy);
  }

  worldTransform(ctx, k) {
    const z = this.cam.zoom * this.scale * k;
    ctx.setTransform(z, 0, 0, -z, (this.W * k) / 2 - this.camX * z, (this.H * k) / 2 + this.camY * z);
  }

  // ───────────────────────────── fx from the simulation

  consumeFx(game) {
    const P = this.particles;
    for (const f of game.fx) {
      switch (f.type) {
        case 'collect': {
          P.burst(f.x, f.y, 14, { speed: 3, life: 0.7, size: 0.07, color: f.mat ? f.mat.color : [1, 0.9, 0.6], kind: 'glow', g: 0, drag: 3 });
          const label = f.mat ? `+${f.units} ${f.mat.name}` : 'salvaged';
          this.popups.push({ x: f.x, y: f.y + 0.6, text: label, t: 0, color: f.mat ? toCss(f.mat.color.map((c) => Math.min(1, c * 1.3 + 0.15))) : '#ffe4a8' });
          break;
        }
        case 'place':
          P.burst(f.x, f.y, 8, { speed: 1.4, life: 0.5, size: 0.12, color: [0.8, 0.78, 0.72], kind: 'smoke', g: 0, drag: 3 });
          break;
        case 'remove':
          P.burst(f.x, f.y, 10, { speed: 2, life: 0.6, size: 0.1, color: f.mat ? f.mat.color : [0.7, 0.7, 0.7], kind: 'shard', drag: 1 });
          break;
        case 'repair':
          P.burst(f.x, f.y, 16, { speed: 2.5, life: 0.6, size: 0.05, color: [0.6, 1, 0.8], kind: 'glow', g: 0, drag: 3 });
          break;
        case 'break':
          P.burst(f.x, f.y, 26, { speed: 5, life: 1.2, size: 0.11, color: f.mat.color, kind: 'shard', drag: 0.6 });
          P.burst(f.x, f.y, 10, { speed: 1.5, life: 1.4, size: 0.25, color: [0.75, 0.72, 0.68], kind: 'smoke', g: 0, drag: 2 });
          P.burst(f.x, f.y, 8, { speed: 6, life: 0.3, size: 0.05, color: [1, 0.85, 0.5], kind: 'glow', drag: 2 });
          this.flash = Math.max(this.flash, 0.05);
          break;
        case 'impact':
          P.burst(f.x, f.y, 10, { speed: 3, life: 0.6, size: 0.08, color: f.mat.color, kind: 'shard' });
          break;
        case 'explosion': {
          const big = f.big ? 2 : 1;
          P.burst(f.x, f.y, 60 * big, { speed: 12 * big, life: 0.8, size: 0.12, color: [1, 0.7, 0.3], kind: 'glow', g: -3, drag: 1.5, heat: 1 });
          P.burst(f.x, f.y, 26 * big, { speed: 4, life: 2.6, size: 0.7, color: [0.25, 0.22, 0.22], kind: 'smoke', g: 0, drag: 1.2 });
          P.burst(f.x, f.y, 30 * big, { speed: 9, life: 1.5, size: 0.12, color: [0.4, 0.35, 0.3], kind: 'shard', drag: 0.4 });
          this.shocks = this.shocks || [];
          this.shocks.push({ x: f.x, y: f.y, t: 0, r: f.r * 3 * big });
          this.flash = Math.max(this.flash, 0.55 * big);
          this.cam.shake = Math.max(this.cam.shake, 0.8);
          break;
        }
        case 'pop': {
          const b = f.block;
          if (b.struct) {
            const p = b.struct.worldPos(b.gx, b.gy);
            P.burst(p.x, p.y, 20, { speed: 3, life: 0.6, size: 0.08, color: [0.6, 1, 0.6], kind: 'glow', drag: 2 });
          }
          break;
        }
        case 'flare':
          this.flares.push({ x: f.x, y: f.y, vy: 24, t: 0 });
          P.burst(f.x, f.y, 14, { speed: 3, life: 0.6, size: 0.08, color: [1, 0.5, 0.3], kind: 'glow', drag: 2, heat: 1 });
          break;
        case 'popup':
          this.popups.push({ x: f.x, y: f.y, text: f.text, t: 0, color: f.color || '#ffe4a8', life: f.life || 1.6 });
          break;
        case 'dissolve':
          P.burst(f.x, f.y, 20, { speed: 1, life: 2, size: 0.08, color: [1, 1, 1], kind: 'bubble' });
          break;
        default:
          break;
      }
    }
    game.fx.length = 0;
  }

  splashes(game, dt) {
    const P = this.particles;
    const t = game.time;
    const sea = game.sea;
    const check = (key, x, y, vy, mass) => {
      const s = sea.surfaceY(x, t);
      const d = y - s;
      const prev = this.prevY.get(key);
      this.prevY.set(key, d);
      if (prev === undefined) return;
      if (Math.sign(prev) !== Math.sign(d) && Math.abs(vy) > 1.1) {
        const k = Math.min(3, Math.abs(vy) * 0.25 * Math.pow(mass, 0.25));
        const col = sea.layers[3].color.map((c) => Math.min(1, c * 1.6 + 0.25));
        P.burst(x, s + 0.05, Math.round(8 + 18 * k), { angle: Math.PI / 2, spread: 1.6, speed: 3 + 3 * k, life: 1, size: 0.07, color: col, kind: 'drop', drag: 0.4 });
        if (vy < 0) P.burst(x, s - 0.4, Math.round(6 + 10 * k), { speed: 1, life: 2.5, size: 0.06, color: [1, 1, 1], kind: 'bubble' });
        if (k > 0.6) game.emit('sfx', { name: 'splash', x, y: s, k });
      }
    };
    for (const c of game.flotsam.chunks) {
      if (!c.body) continue;
      const p = c.body.getPosition();
      check(c, p.x, p.y, c.body.getLinearVelocity().y, c.body.getMass());
    }
    for (const s of game.structures) {
      if (s === game.colony || s.list.length > 40) continue;
      const p = s.body.getWorldCenter();
      check(s, p.x, p.y, s.body.getLinearVelocity().y, s.body.getMass());
    }
    this.splashT -= dt;
    if (game.colony && this.splashT <= 0) {
      this.splashT = 0.08;
      const col = game.colony;
      const v = col.body.getLinearVelocity();
      const w = col.body.getAngularVelocity();
      const sp = Math.abs(v.y) + Math.abs(w) * 4;
      if (sp > 0.25) {
        for (const b of col.list) {
          if (b.wet <= 0.05 || b.wet >= 0.95) continue;
          if (Math.random() > 0.08 * sp) continue;
          const p = col.worldPos(b.gx, b.gy);
          const s = sea.surfaceY(p.x, t);
          const lc = sea.layers[3].color.map((c) => Math.min(1, c * 1.6 + 0.3));
          P.burst(p.x + (Math.random() - 0.5), s, 3, { angle: Math.PI / 2, spread: 1.2, speed: 1.5 + sp, life: 0.7, size: 0.05, color: lc, kind: 'drop' });
        }
      }
    }
  }

  ambient(game, dt) {
    const P = this.particles;
    const t = game.time;
    for (const s of game.structures) {
      for (const b of s.list) {
        const roll = Math.random();
        if (b.corroding && roll < dt * 10) {
          const p = s.worldPos(b.gx + (Math.random() - 0.5) * 0.9, b.gy + (Math.random() - 0.5) * 0.9);
          if (b.layer >= 3) P.add({ x: p.x, y: p.y, vx: 0, vy: 0.5, life: 1.5, size: 0.04 + Math.random() * 0.04, kind: 'bubble', color: [1, 1, 1] });
          else P.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, life: 0.6, size: 0.05, kind: 'glow', color: [1, 0.55, 0.15], g: 1, heat: 1 });
        }
        if (s !== game.colony) continue;
        const st = b.state;
        if (b.fn === 'smelter' && st.phase === 'heating' && roll < dt * 6) {
          const p = s.worldPos(b.gx - 0.15, b.gy + 0.6);
          P.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 0.4, vy: 0.8, life: 3, size: 0.18, kind: 'smoke', color: [0.3, 0.27, 0.27], rise: 0.8, grow: 0.5, g: 0 });
          if (Math.random() < 0.5) P.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 2, life: 0.7, size: 0.04, kind: 'glow', color: [1, 0.6, 0.2], g: -2 });
        }
        if (b.fn === 'refinery' && st.active && roll < dt * 4) {
          const p = s.worldPos(b.gx, b.gy + 0.6);
          P.add({ x: p.x, y: p.y, vx: 0, vy: 0.6, life: 2, size: 0.12, kind: 'steam', color: [0.9, 0.92, 0.95], rise: 0.5, grow: 0.4, g: 0 });
        }
        if (b.fn === 'pump' && st.active && roll < dt * 12) {
          const p = s.worldPos(b.gx + (Math.random() - 0.5) * 1.6, b.gy - 0.6 - Math.random() * 0.6);
          const q = s.worldPos(b.gx, b.gy);
          P.add({ x: p.x, y: p.y, vx: (q.x - p.x) * 2, vy: (q.y - p.y) * 2, life: 0.5, size: 0.05, kind: 'glow', color: [1, 0.45, 0.9], g: 0, drag: 0 });
        }
        if (b.fn === 'condenser' && st.active && roll < dt * 10) {
          const p = s.worldPos(b.gx + (Math.random() - 0.5) * 2.2, b.gy + (Math.random() - 0.5) * 2.2);
          const q = s.worldPos(b.gx, b.gy);
          P.add({ x: p.x, y: p.y, vx: (q.x - p.x) * 1.6, vy: (q.y - p.y) * 1.6, life: 0.6, size: 0.04, kind: 'glow', color: [0.6, 0.95, 1], g: 0, drag: 0 });
        }
      }
    }
    if (game.colony && game.colonists)
      for (const c of game.colonists.list) {
        const j = c.job;
        if (!j || j.type !== 'row' || j.phase !== 'rowing' || Math.random() > dt * 9) continue;
        const a = -1.05 + (j.stroke ?? 0.5) * 0.75;
        const tip = game.colony.body.getWorldPoint({ x: c.x + c.face * (0.18 + Math.cos(a) * 1.9), y: c.y + 0.7 + Math.sin(a) * 1.9 });
        const sy = game.sea.surfaceY(tip.x, t);
        const lc = game.sea.layers[3].color.map((v) => Math.min(1, v * 1.6 + 0.3));
        P.burst(tip.x, sy, 3, { angle: Math.PI / 2 - c.face * 0.6, spread: 0.8, speed: 1.6, life: 0.6, size: 0.05, color: lc, kind: 'drop' });
      }
    for (const c of game.flotsam.chunks) {
      if (c.fizz > 0.2 && Math.random() < dt * 8 && c.body) {
        const p = c.body.getPosition();
        P.add({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y, vx: 0, vy: 0.4, life: 1.2, size: 0.05, kind: c.layer >= 3 ? 'bubble' : 'glow', color: [1, 0.7, 0.3], g: 0 });
      }
    }
    if (game.state === 'erupting' && Math.random() < dt * 14) {
      const x = this.cam.x + (Math.random() - 0.3) * 90;
      P.add({ x, y: this.cam.y + 40, vx: -6 - Math.random() * 6, vy: -20, life: 4, size: 0.25 + Math.random() * 0.3, kind: 'glow', color: [1, 0.45, 0.1], g: -9.8, drag: 0.05, heat: 1 });
    }
    // rocket exhaust
    const r = game.rocket;
    if (r.struct && r.burning) {
      const s = r.struct;
      const ang = s.body.getAngle();
      for (const e of s.list) {
        if (e.fn !== 'engine') continue;
        for (let i = 0; i < 6; i++) {
          const p = s.worldPos(e.gx + (Math.random() - 0.5) * 0.5, e.gy - 0.55);
          const sp = 14 + Math.random() * 10;
          const a = -Math.PI / 2 + ang + (Math.random() - 0.5) * 0.35;
          const v = s.body.getLinearVelocity();
          P.add({ x: p.x, y: p.y, vx: Math.cos(a) * sp + v.x * 0.5, vy: Math.sin(a) * sp + v.y * 0.5, life: 0.35 + Math.random() * 0.2, size: 0.18, kind: 'flame', color: [1, 0.75, 0.35], g: 0, drag: 2, heat: 1 });
        }
        if (Math.random() < 0.7) {
          const p = s.worldPos(e.gx, e.gy - 1.5);
          P.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 3, vy: -2, life: 5, size: 0.5, kind: 'smoke', color: [0.75, 0.72, 0.7], rise: 0.25, grow: 1.2, g: 0, drag: 0.6 });
        }
      }
    }
  }

  // ───────────────────────────── drawing

  drawStructure(ctx, s, game, overlayInfo) {
    this.bodyTransform(ctx, s.body, 1);
    const t = game.time;
    for (const b of s.list) {
      let seen = this.firstSeen.get(b);
      if (seen === undefined) this.firstSeen.set(b, (seen = this.time));
      const age = this.time - seen;
      let popped = false;
      if (age < 0.22) {
        const k = age / 0.22;
        const sc = 0.55 + 0.45 * (1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2));
        ctx.save();
        ctx.translate(b.gx, b.gy);
        ctx.scale(sc, sc);
        ctx.translate(-b.gx, -b.gy);
        popped = true;
      }
      const x = b.gx - 0.5,
        y = b.gy - 0.5;
      const fn = b.fn;
      if (fn === 'tank' || fn === 'capsule' || fn === 'engine') {
        ctx.drawImage(this.tile(b.mat), x + 0.08, y, 0.84, 1);
      } else ctx.drawImage(this.tile(b.mat), x - 0.005, y - 0.005, 1.01, 1.01);
      const icon = this.icons[fn];
      if (icon && fn !== 'frame') ctx.drawImage(icon, x, y, 1, 1);
      if (b.swell > 0.02) {
        ctx.fillStyle = `rgba(30,20,40,${b.swell * 0.35})`;
        ctx.fillRect(x, y, 1, 1);
      }
      if (b.flooded) {
        const L = game.planet.layers[Math.max(3, Math.min(5, b.layer))];
        ctx.fillStyle = toCss(L.color, 0.85);
        ctx.fillRect(x + 0.18, y + 0.18, 0.64, 0.5);
      }
      if (fn === 'condenser' && b.state.active) {
        ctx.strokeStyle = 'rgba(180,240,255,0.8)';
        ctx.lineWidth = 0.05;
        const a0 = t * 3;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = a0 + (i * Math.PI * 2) / 3;
          ctx.moveTo(b.gx, b.gy);
          ctx.lineTo(b.gx + Math.cos(a) * 0.36, b.gy + Math.sin(a) * 0.36);
        }
        ctx.stroke();
      }
      if (fn === 'smelter' && b.state.phase === 'heating') {
        const k = 0.5 + 0.5 * Math.sin(t * 9 + b.id);
        ctx.fillStyle = `rgba(255,${120 + 60 * k},40,${0.25 + 0.2 * k})`;
        ctx.fillRect(x + 0.2, y + 0.2, 0.6, 0.35);
      }
      if (fn === 'core') {
        const k = Math.sin(t * 2.4) > 0.6 ? 1 : 0.2;
        ctx.fillStyle = `rgba(255,90,80,${k})`;
        ctx.beginPath();
        ctx.arc(b.gx, b.gy + 0.62, 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(220,230,240,0.85)';
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        ctx.moveTo(b.gx, b.gy + 0.5);
        ctx.lineTo(b.gx, b.gy + 0.58);
        ctx.stroke();
      }
      if (fn === 'stockpile') drawPileContents(ctx, this, b);
      if (popped) ctx.restore();
    }
    if (s === game.colony) drawLoadLine(ctx, s);
    // outline of the whole structure
    ctx.lineWidth = 0.045;
    ctx.strokeStyle = 'rgba(8,8,12,0.65)';
    ctx.beginPath();
    for (const b of s.list) {
      const x = b.gx,
        y = b.gy;
      if (!s.at(x, y + 1)) {
        ctx.moveTo(x - 0.5, y + 0.5);
        ctx.lineTo(x + 0.5, y + 0.5);
      }
      if (!s.at(x, y - 1)) {
        ctx.moveTo(x - 0.5, y - 0.5);
        ctx.lineTo(x + 0.5, y - 0.5);
      }
      if (!s.at(x + 1, y)) {
        ctx.moveTo(x + 0.5, y - 0.5);
        ctx.lineTo(x + 0.5, y + 0.5);
      }
      if (!s.at(x - 1, y)) {
        ctx.moveTo(x - 0.5, y - 0.5);
        ctx.lineTo(x - 0.5, y + 0.5);
      }
    }
    ctx.stroke();
    // seams between different materials or broken joints
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    for (const b of s.list) {
      const r = s.at(b.gx + 1, b.gy);
      if (r && (r.mat !== b.mat || !b.edges[0])) {
        ctx.moveTo(b.gx + 0.5, b.gy - 0.5);
        ctx.lineTo(b.gx + 0.5, b.gy + 0.5);
      }
      const u = s.at(b.gx, b.gy + 1);
      if (u && (u.mat !== b.mat || !b.edges[1])) {
        ctx.moveTo(b.gx - 0.5, b.gy + 0.5);
        ctx.lineTo(b.gx + 0.5, b.gy + 0.5);
      }
    }
    ctx.stroke();
    this.drawCracks(ctx, s, t);
  }

  drawCrew(ctx, game) {
    const col = game.colony;
    this.bodyTransform(ctx, col.body, 1);
    for (const c of game.colonists.list) {
      const j = c.job;
      drawFigure(ctx, c.x, c.y, { face: c.face, suit: c.suit, pose: c.pose, walkT: c.walkT, t: game.time + c.id, stroke: j && j.type === 'row' ? j.stroke : 0.5 });
      if (c.carry) drawCarried(ctx, this, c.x, c.y, c.carry);
    }
  }

  drawCastaways(ctx, game) {
    this.worldTransform(ctx, 1);
    const cx = game.colony ? game.colony.body.getWorldCenter().x : 0;
    for (const cw of game.world.castaways) {
      if (cw.state === 'rescued') continue;
      const face = cx > cw.x ? 1 : -1;
      const pose = cw.state === 'hooked' ? 'swim' : cw.wave > 0 ? 'wave' : 'stand';
      drawFigure(ctx, cw.x, cw.y, { face, suit: [0.85, 0.85, 0.82], pose, t: game.time + cw.id * 3 });
    }
  }

  drawCracks(ctx, s, t) {
    for (const b of s.list) {
      for (const d of [0, 1]) {
        const e = b.edges[d];
        if (!e || e.crackVis < 0.04) continue;
        const v = e.crackVis;
        const seed = e.seed;
        const rnd = (i) => {
          const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        let x0, y0, dx, dy, nx, ny;
        if (e.vertical) {
          x0 = b.gx - 0.5;
          y0 = b.gy + 0.5;
          dx = 1;
          dy = 0;
          nx = 0;
          ny = 1;
        } else {
          x0 = b.gx + 0.5;
          y0 = b.gy - 0.5;
          dx = 0;
          dy = 1;
          nx = 1;
          ny = 0;
        }
        const start = rnd(1) * 0.5;
        const len = Math.min(1, 0.2 + v * 0.95);
        const pts = [];
        const steps = 7;
        for (let i = 0; i <= steps; i++) {
          const u = start + (len * i) / steps;
          const off = (rnd(i + 3) - 0.5) * 0.22 * v;
          pts.push([x0 + dx * (u % 1) + nx * off, y0 + dy * (u % 1) + ny * off]);
        }
        const hot = Math.max(0, e.damage - 0.1);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        for (let k = 0; k < Math.floor(v * 4); k++) {
          const p = pts[1 + Math.floor(rnd(20 + k) * (steps - 1))];
          const sgn = rnd(30 + k) < 0.5 ? -1 : 1;
          const bl = 0.12 + rnd(40 + k) * 0.28 * v;
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[0] + nx * sgn * bl + dx * (rnd(50 + k) - 0.5) * 0.2, p[1] + ny * sgn * bl + dy * (rnd(50 + k) - 0.5) * 0.2);
        }
        ctx.lineWidth = 0.07 + 0.08 * v;
        ctx.strokeStyle = `rgba(255,236,210,${0.18 + 0.25 * v})`;
        ctx.stroke();
        ctx.lineWidth = 0.035 + 0.05 * v;
        ctx.strokeStyle = `rgba(8,4,6,${0.7 + 0.3 * v})`;
        ctx.stroke();
        if (hot > 0) {
          const flick = 0.75 + 0.25 * Math.sin(t * 23 + seed);
          ctx.lineWidth = 0.02 + 0.035 * hot;
          ctx.strokeStyle = `rgba(255,${Math.round(150 - 80 * hot)},60,${Math.min(1, hot * 1.6) * flick})`;
          ctx.stroke();
        }
      }
    }
  }

  drawStructureDensity(ctx, s) {
    this.bodyTransform(ctx, s.body, 0.5);
    for (const b of s.list) {
      const fn = FUNCS[b.fn];
      const dens = b.mass;
      ctx.fillStyle = `rgb(${Math.min(255, (dens / 4) * 255)},255,0)`;
      ctx.fillRect(b.gx - 0.5, b.gy - 0.5, 1, 1);
      if (b.fn === 'hollow' || b.fn === 'tank') {
        const inner = b.flooded ? (b.floodRho || 1) : b.fn === 'tank' ? (b.fuel / 10) * 1.2 : 0.0;
        ctx.fillStyle = `rgb(${Math.min(255, (inner / 4) * 255)},255,0)`;
        ctx.fillRect(b.gx - 0.32, b.gy - 0.32, 0.64, 0.64);
      } else if (fn.equip > 0 && b.fn !== 'core') {
        ctx.fillStyle = `rgb(${Math.min(255, ((b.mat.d * 0.4) / 4) * 255)},255,0)`;
        ctx.fillRect(b.gx - 0.28, b.gy - 0.28, 0.56, 0.56);
      }
    }
  }

  drawChunk(ctx, c, density) {
    const body = c.body;
    if (!body) return;
    this.bodyTransform(ctx, body, density ? 0.5 : 1);
    ctx.beginPath();
    c.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    if (density) {
      ctx.fillStyle = `rgb(${Math.min(255, ((c.debris ? 0.45 : c.mat.d) / 4) * 255)},255,0)`;
      ctx.fill();
      return;
    }
    ctx.fillStyle = this.pattern(ctx, c.mat);
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = 'rgba(10,8,14,0.7)';
    ctx.stroke();
    if (c.crate) {
      const w = c.pts[1][0],
        h = c.pts[2][1];
      ctx.strokeStyle = 'rgba(40,36,30,0.75)';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(-w * 0.45, -h);
      ctx.lineTo(-w * 0.45, h);
      ctx.moveTo(w * 0.45, -h);
      ctx.lineTo(w * 0.45, h);
      ctx.moveTo(-w, -h * 0.1);
      ctx.lineTo(w, -h * 0.1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,190,80,0.85)';
      ctx.fillRect(-0.12, h * 0.25, 0.24, 0.16);
      return;
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    const n = c.pts.length;
    for (let i = 0; i < n; i++) {
      const p = c.pts[i],
        q = c.pts[(i + 1) % n];
      if (p[1] + q[1] > 0) {
        ctx.moveTo(p[0] * 0.85, p[1] * 0.85);
        ctx.lineTo(q[0] * 0.85, q[1] * 0.85);
      }
    }
    ctx.stroke();
  }

  drawGrapples(ctx, game) {
    this.worldTransform(ctx, 1);
    for (const gr of game.grapples.list) {
      const o = game.grapples.ownerPos(gr.owner);
      const tense = gr.phase === 'reel' ? Math.min(1, gr.tension / 40) : 0;
      const mx = (o.x + gr.hx) / 2,
        my = (o.y + gr.hy) / 2 - (1 - tense) * Math.min(2, Math.hypot(gr.hx - o.x, gr.hy - o.y) * 0.12);
      ctx.lineWidth = 0.07;
      ctx.strokeStyle = 'rgba(20,16,12,0.9)';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.quadraticCurveTo(mx, my, gr.hx, gr.hy);
      ctx.stroke();
      ctx.lineWidth = 0.03;
      ctx.strokeStyle = `rgba(${200 + 55 * tense},${190 - 60 * tense},${140 - 80 * tense},0.9)`;
      ctx.stroke();
      ctx.fillStyle = '#d9d2c0';
      ctx.beginPath();
      ctx.arc(gr.hx, gr.hy, 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawParticles(ctx, density) {
    const P = this.particles.list;
    if (density) {
      this.worldTransform(ctx, 0.5);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of P) {
        if (!p.heat) continue;
        const a = 1 - p.age / p.life;
        ctx.fillStyle = `rgba(0,0,${Math.round(255 * a * 0.5)},1)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    this.worldTransform(ctx, 1);
    for (const p of P) {
      const a = 1 - p.age / p.life;
      const c = p.color || [1, 1, 1];
      switch (p.kind) {
        case 'smoke':
        case 'steam': {
          ctx.globalAlpha = Math.min(1, a * (p.kind === 'steam' ? 0.45 : 0.75) * Math.min(1, p.age * 6));
          const r = p.size * 1.6;
          ctx.drawImage(this.softSprite(c), p.x - r, p.y - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'bubble': {
          ctx.strokeStyle = `rgba(255,255,255,${0.55 * a})`;
          ctx.lineWidth = 0.02;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'shard': {
          ctx.fillStyle = toCss(c, a);
          const s = p.size;
          ctx.fillRect(p.x - s, p.y - s, s * 2, s * 1.4);
          break;
        }
        case 'drop': {
          ctx.fillStyle = toCss(c, a * 0.85);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default:
          break;
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of P) {
      if (p.kind !== 'glow' && p.kind !== 'flame') continue;
      const a = 1 - p.age / p.life;
      const c = p.color;
      if (p.kind === 'flame') {
        const k = p.age / p.life;
        ctx.fillStyle = `rgba(${255},${Math.round(230 - 150 * k)},${Math.round(160 - 140 * k)},${0.35 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + k * 2), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = toCss(c, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawFlames(ctx, game) {
    const r = game.rocket;
    if (!r.struct || !r.burning) return;
    const s = r.struct;
    this.bodyTransform(ctx, s.body, 1);
    ctx.globalCompositeOperation = 'lighter';
    const t = this.time;
    for (const e of s.list) {
      if (e.fn !== 'engine') continue;
      const L = 2.6 + Math.sin(t * 47 + e.id) * 0.3 + Math.random() * 0.4;
      const x = e.gx,
        y = e.gy - 0.5;
      const g = ctx.createLinearGradient(x, y, x, y - L);
      g.addColorStop(0, 'rgba(255,255,240,0.95)');
      g.addColorStop(0.18, 'rgba(255,210,120,0.85)');
      g.addColorStop(0.55, 'rgba(255,110,40,0.45)');
      g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 0.42, y);
      ctx.quadraticCurveTo(x - 0.5, y - L * 0.35, x, y - L);
      ctx.quadraticCurveTo(x + 0.5, y - L * 0.35, x + 0.42, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(180,220,255,0.6)';
      ctx.beginPath();
      ctx.ellipse(x, y - 0.25, 0.22, 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawHeat(ctx, game) {
    ctx.globalCompositeOperation = 'lighter';
    const radial = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,${Math.round(255 * a)},1)`);
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    this.worldTransform(ctx, 0.5);
    const col = game.colony;
    if (col) {
      for (const b of col.list) {
        if (b.fn === 'smelter' && b.state.phase === 'heating') {
          const p = col.worldPos(b.gx, b.gy + 1.2);
          radial(p.x, p.y, 1.6, 0.8);
          const q = col.worldPos(b.gx, b.gy + 3);
          radial(q.x, q.y, 2.2, 0.45);
        } else if (b.fn === 'refinery' && b.state.active) {
          const p = col.worldPos(b.gx, b.gy + 1);
          radial(p.x, p.y, 1.2, 0.4);
        } else if (b.fn === 'core') {
          const p = col.worldPos(b.gx, b.gy + 1);
          radial(p.x, p.y, 0.9, 0.12);
        }
      }
    }
    const r = game.rocket;
    if (r.struct && r.burning) {
      for (const e of r.struct.list) {
        if (e.fn !== 'engine') continue;
        for (let i = 1; i < 6; i++) {
          const p = r.struct.worldPos(e.gx, e.gy - i * 1.2);
          radial(p.x, p.y, 0.8 + i * 0.35, 0.9 - i * 0.12);
        }
      }
    }
    if (this.shocks) {
      for (const s of this.shocks) {
        const rr = s.r * Math.min(1, s.t * 2.2);
        ctx.strokeStyle = `rgba(0,0,${Math.round(255 * Math.max(0, 1 - s.t * 1.4))},1)`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  updateIface(game) {
    const W = this.W;
    const data = this.ifaceData;
    const z = this.cam.zoom * this.scale;
    const sea = game.sea;
    const t = game.time;
    const phys = game.physics;
    for (let i = 0; i < W; i++) {
      const x = this.camX + (i + 0.5 - W / 2) / z;
      for (let k = 1; k < N_LAYERS; k++) data[k * W + i] = sea.ifaceY(k, x, t);
      data[6 * W + i] = phys.floorAt(x);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texIface);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, 8, 0, gl.RED, gl.FLOAT, data);
  }

  frame(game, ui, dt) {
    this.time += dt;
    const cam = this.cam;
    cam.shake = Math.max(cam.shake * Math.exp(-dt * 4), game.shake * 0.6);
    const sh = cam.shake * cam.shake * 0.35;
    this.camX = cam.x + (Math.random() - 0.5) * sh;
    this.camY = cam.y + (Math.random() - 0.5) * sh;
    this.consumeFx(game);
    this.splashes(game, dt);
    this.ambient(game, dt);
    this.particles.update(dt, game);
    stepFlares(this, dt);
    if (this.shocks) {
      for (const s of this.shocks) s.t += dt;
      this.shocks = this.shocks.filter((s) => s.t < 0.8);
    }
    this.flash *= Math.exp(-dt * 7);

    const ctx = this.objCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.imageSmoothingEnabled = true;
    const W = game.world;
    if (W) {
      this.worldTransform(ctx, 1);
      for (const r of W.rocks) drawRock(ctx, r, false);
      for (const isl of W.islands) if (isl.pts) this.drawChunk(ctx, isl, false);
    }
    for (const c of game.flotsam.chunks) this.drawChunk(ctx, c, false);
    for (const s of game.structures) if (s !== game.colony) this.drawStructure(ctx, s, game);
    if (game.colony) {
      this.worldTransform(ctx, 1);
      drawAnchor(ctx, game);
      this.drawStructure(ctx, game.colony, game);
      this.drawCrew(ctx, game);
    }
    if (W) this.drawCastaways(ctx, game);
    this.drawGrapples(ctx, game);
    this.drawParticles(ctx, false);
    this.drawFlames(ctx, game);
    this.worldTransform(ctx, 1);
    drawFlares(ctx, this);

    const dctx = this.denCtx;
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = '#000';
    dctx.fillRect(0, 0, this.denCanvas.width, this.denCanvas.height);
    if (W) {
      this.worldTransform(dctx, 0.5);
      for (const r of W.rocks) drawRock(dctx, r, true);
      for (const isl of W.islands) if (isl.pts) this.drawChunk(dctx, isl, true);
    }
    for (const c of game.flotsam.chunks) this.drawChunk(dctx, c, true);
    for (const s of game.structures) this.drawStructureDensity(dctx, s);
    this.drawHeat(dctx, game);
    this.drawParticles(dctx, true);

    const gl = this.gl;
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(this.prog);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texObj);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.objCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texDen);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.denCanvas);
    gl.activeTexture(gl.TEXTURE2);
    this.updateIface(game);
    const u = this.u;
    gl.uniform1i(u.uObj, 0);
    gl.uniform1i(u.uDen, 1);
    gl.uniform1i(u.uIface, 2);
    const z = cam.zoom * this.scale;
    gl.uniform2f(u.uRes, this.W, this.H);
    gl.uniform2f(u.uCam, this.camX, this.camY);
    gl.uniform1f(u.uZoom, z);
    gl.uniform1f(u.uTime, game.time);
    const L = game.planet.layers;
    gl.uniform1fv(u.uRhoVis, L.map((l, i) => (i < 3 ? RHO_VIS_AIR[i] : l.rho)));
    gl.uniform3fv(u.uCol, L.flatMap((l) => l.color));
    gl.uniform1fv(u.uTop, L.map((l) => (isFinite(l.top) ? l.top : 999)));
    gl.uniform1fv(u.uCurrent, L.map((l) => l.current));
    this.schl += (this.schlTarget - this.schl) * Math.min(1, dt * 6);
    gl.uniform1f(u.uSchl, this.schl);
    const lens = this.lens;
    lens.on += (lens.target - lens.on) * Math.min(1, dt * 10);
    gl.uniform3f(u.uLens, lens.x * this.scale, this.H - lens.y * this.scale, lens.r * this.scale);
    gl.uniform1f(u.uLensOn, lens.on);
    const prog = Math.min(1, game.time / game.duration);
    gl.uniform1f(u.uDoom, game.attract ? 0.15 : Math.pow(prog, 1.4));
    gl.uniform1f(u.uFlash, this.flash);
    gl.uniform1f(u.uErupt, game.state === 'erupting' || (game.state === 'lost' && game.eruptT) ? Math.min(1, (game.eruptT || 0) / 3) : 0);
    gl.uniform1f(u.uWin, game.state === 'won' ? 1 : 0);
    const horizon = this.H / 2 - this.camY * z;
    gl.uniform2f(u.uSun, this.W * 0.2, horizon + this.H * 0.36);
    gl.uniform1f(u.uQuality, this.quality);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.drawOverlay(game, ui, dt);
  }

  // ───────────────────────────── overlay (crisp, unrefracted)

  drawOverlay(game, ui, dt) {
    const ctx = this.octx;
    const dpr = this.odpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (ui && ui.drawWorldOverlay) ui.drawWorldOverlay(ctx, this);
    this.drawRuler(ctx, game, ui);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < (p.life || 1.6));
    ctx.textAlign = 'center';
    ctx.font = '600 13px "Manrope", system-ui, sans-serif';
    for (const p of this.popups) {
      const s = this.toScreen(p.x, p.y);
      const a = Math.min(1, ((p.life || 1.6) - p.t) * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(p.text, s.x + 1, s.y - p.t * 26 + 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, s.y - p.t * 26);
    }
    ctx.globalAlpha = 1;
  }

  drawRuler(ctx, game, ui) {
    if (ui && ui.hideRuler) return;
    const L = game.planet.layers;
    const t = game.time;
    const kn = game.knowledge;
    ctx.textAlign = 'left';
    const x0 = (ui && ui.rulerX) || 12;
    let lastY = -1e9;
    for (let k = 0; k < L.length; k++) {
      const top = k === 0 ? Infinity : game.sea.ifaceY(k, this.cam.x, t);
      const bot = k === L.length - 1 ? game.planet.floor : game.sea.ifaceY(k + 1, this.cam.x, t);
      const yTop = isFinite(top) ? this.toScreen(0, top).y : -1e9;
      const yBot = this.toScreen(0, bot).y;
      const y0 = Math.max(yTop, 64);
      const y1 = Math.min(yBot, this.cssH - 40);
      if (y1 - y0 < 34) continue;
      const yy = Math.max(y0 + 18, Math.min(y1 - 14, isFinite(top) ? yTop + 18 : y1 - 14));
      if (yy - lastY < 34) continue;
      lastY = yy;
      const l = L[k];
      ctx.font = '700 12px "Syne", "Manrope", sans-serif';
      ctx.fillStyle = 'rgba(255,250,240,0.92)';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.fillText(l.name.toUpperCase(), x0, yy);
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255,250,240,0.7)';
      const rho = l.kind === 'air' ? 'gas' : `ρ ${l.rho.toFixed(2)} t/m³`;
      const found = game.progress ? game.progress.found : { fuel: true, ox: true };
      const role = l.role === 'fuel' && found.fuel ? '  ▼ FUEL' : l.role === 'oxidizer' && found.ox ? '  ▲ OXIDISER' : '';
      ctx.fillText(rho + role, x0, yy + 15);
      ctx.shadowBlur = 0;
      if (isFinite(top) && yTop > 50 && yTop < this.cssH - 30) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yTop);
        ctx.lineTo(x0 - 4 + 6, yTop);
        ctx.stroke();
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        const h = L[k].top;
        ctx.fillText(`${h >= 0 ? '+' : ''}${h.toFixed(1)} m`, x0 + 2, yTop - 4);
      }
    }
  }
}
