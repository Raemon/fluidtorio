import { pl } from './physics.js';
import { WORLD_HALF_WIDTH, GRAPPLE_SPEED, REEL_SPEED, GRAPPLE_MAX_FORCE, GRAPPLE_REACH_CORE, GRAPPLE_REACH_CRANE, FUNCS } from './config.js';
import { SURFACE } from './sea.js';
import { CAT_STRUCT, CAT_CHUNK } from './structure.js';

let CHUNK_ID = 1;

function chunkShape(rng, r) {
  const n = 5 + Math.floor(rng() * 3);
  const pts = [];
  const off = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const rr = r * (0.7 + rng() * 0.45);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * (0.7 + rng() * 0.3)]);
  }
  return pts;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export class Flotsam {
  constructor(game) {
    this.game = game;
    this.chunks = [];
    this.spawnT = 0;
    this.rng = Math.random;
  }

  restY(mat) {
    const L = this.game.planet.layers;
    if (mat.cat === 'float' || mat.d < L[3].rho) return 0.1;
    if (mat.d < L[4].rho) return L[4].top;
    if (mat.d < L[5].rho) return L[5].top;
    return this.game.planet.floor + 1.5;
  }

  driftDir(mat) {
    const L = this.game.planet.layers;
    let c;
    if (mat.d < L[3].rho) c = L[3].current;
    else if (mat.d < L[4].rho) c = L[3].current + L[4].current;
    else if (mat.d < L[5].rho) c = L[4].current + L[5].current;
    else c = L[3].current;
    return c >= 0 ? 1 : -1;
  }

  spawn(mat, x, y, size, debris = false) {
    const g = this.game;
    const r = size || 0.45 + this.rng() * 0.32;
    const pts = chunkShape(this.rng, r);
    const area = polyArea(pts);
    const body = g.physics.createBody(x, y, this.rng() * 6.28, null);
    const lv = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => {
      lv[2 * i] = p[0];
      lv[2 * i + 1] = p[1];
    });
    const fixture = body.createFixture({
      shape: new pl.Polygon(pts.map((p) => new pl.Vec2(p[0], p[1]))),
      density: debris ? 0.45 : mat.d,
      friction: 0.8,
      restitution: 0.05,
      filterCategoryBits: CAT_CHUNK,
      filterMaskBits: 0xffff,
    });
    const chunk = {
      id: CHUNK_ID++,
      mat,
      body,
      pts,
      area,
      units: debris ? 2 + Math.floor(this.rng() * 3) : Math.max(3, Math.round(area * 7)),
      debris,
      settled: 0,
      layer: -1,
      fizz: 0,
      grabbed: null,
      measured: 0,
      hover: 0,
    };
    fixture.setUserData({ owner: null, chunk, lv, n: pts.length, area, currentMul: 1 });
    body.setUserData({ kind: 'chunk', chunk, wetFrac: 0 });
    this.chunks.push(chunk);
    return chunk;
  }

  remove(chunk) {
    const i = this.chunks.indexOf(chunk);
    if (i >= 0) this.chunks.splice(i, 1);
    if (chunk.body) this.game.physics.destroyBody(chunk.body);
    chunk.body = null;
    chunk.dead = true;
  }

  seed() {
    const g = this.game;
    const W = WORLD_HALF_WIDTH;
    for (const x of [-15, 13, 21]) this.spawn(g.planet.salvage, x + this.rng() * 3, 0.3, 0.5, true);
    for (const mat of g.planet.materials) {
      if (mat.cat === 'sink') {
        const n = 9;
        for (let i = 0; i < n; i++) {
          let x = (this.rng() * 2 - 1) * (i < 3 ? 22 : 70);
          if (Math.abs(x) < 6) x += 8 * Math.sign(x || 1);
          const y = g.physics.floorAt(x) + 0.9;
          this.spawn(mat, x, y, 0.5 + this.rng() * 0.3);
        }
        continue;
      }
      const n = Math.round(9 * mat.spawn);
      for (let i = 0; i < n; i++) {
        let x = (this.rng() * 2 - 1) * (W - 10);
        if (i < 2) x = (8 + this.rng() * 12) * (this.rng() < 0.5 ? -1 : 1);
        this.spawn(mat, x, this.restY(mat), null);
      }
    }
  }

  update(dt) {
    const g = this.game;
    const t = g.time;
    this.spawnT -= dt;
    const free = this.chunks.filter((c) => c.mat.cat !== 'sink' || c.layer < 5).length;
    if (this.spawnT <= 0 && free < 56) {
      this.spawnT = 1.8 + this.rng() * 2;
      if (this.rng() < 0.1) {
        const dir = this.game.planet.layers[3].current >= 0 ? 1 : -1;
        this.spawn(g.planet.salvage, -dir * (WORLD_HALF_WIDTH - 2), 0.3, 0.5, true);
        return;
      }
      const pool = g.planet.materials.filter((m) => m.cat !== 'sink' || this.rng() < 0.5);
      const weights = pool.map((m) => (m.cat === 'sink' ? 0.35 : m.spawn));
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      let mat = pool[0];
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          mat = pool[i];
          break;
        }
      }
      const dir = this.driftDir(mat);
      const x = -dir * (WORLD_HALF_WIDTH - 2);
      const y = mat.cat === 'sink' ? 0.4 : this.restY(mat);
      this.spawn(mat, x, y, null);
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      const p = c.body.getPosition();
      if (Math.abs(p.x) > WORLD_HALF_WIDTH + 8 || p.y < g.sea.floor - 20) {
        if (!c.grabbed) this.remove(c);
        continue;
      }
      const layer = g.sea.layerAt(p.x, p.y, t);
      c.layer = layer;
      const v = c.body.getLinearVelocity();
      const sp = Math.hypot(v.x, v.y);
      if (layer <= 5) g.knowledge.exposed(c.mat, layer, dt);
      if (c.mat.react[layer] && c.mat.react[layer] !== 'none' && layer <= 5) c.fizz = Math.min(1, c.fizz + dt * 2);
      else c.fizz = Math.max(0, c.fizz - dt);
      if (sp < 0.35 && !c.grabbed) c.settled += dt;
      else c.settled = 0;
      if (c.settled > 0.8) this.observeRest(c);
    }
  }

  /** A chunk at rest tells you where its density sits between the fluids around it. */
  observeRest(c, force = false) {
    const g = this.game;
    const col = g.colony;
    if (!col || !c.body || c.debris) return;
    const p = c.body.getPosition();
    const cp = col.body.getPosition();
    if (!force && Math.abs(p.x - cp.x) > 60) return;
    if (c.observed) return;
    c.observed = true;
    const L = g.planet.layers;
    const t = g.time;
    const surf = g.sea.surfaceY(p.x, t);
    const k = g.sea.layerAt(p.x, p.y, t);
    if (k === 6 || p.y < g.physics.floorAt(p.x) + 1.5) {
      if (c.mat.d > L[5].rho) g.knowledge.densityInterval(c.mat, L[5].rho, Infinity, `sinks through ${L[5].name}`);
      return;
    }
    const up = Math.abs(p.y - surf) < 1.2 ? 2 : null;
    if (up !== null) {
      g.knowledge.densityInterval(c.mat, 0, L[3].rho, `floats on ${L[3].name}`);
      return;
    }
    for (const kk of [4, 5]) {
      const y = g.sea.ifaceY(kk, p.x, t);
      if (Math.abs(p.y - y) < 1.2) {
        g.knowledge.densityInterval(c.mat, L[kk - 1].rho, L[kk].rho, `rests between ${L[kk - 1].name} and ${L[kk].name}`);
        return;
      }
    }
  }

  /** Read a floating chunk's waterline: Archimedes, by eye. */
  measureWaterline(c) {
    const g = this.game;
    if (!c.body) return null;
    const p = c.body.getPosition();
    const t = g.time;
    const L = g.planet.layers;
    const surf = g.sea.surfaceY(p.x, t);
    let upper, lower;
    if (Math.abs(p.y - surf) < 1.2) {
      upper = { rho: 0, name: 'air' };
      lower = L[3];
    } else {
      for (const kk of [4, 5]) {
        const y = g.sea.ifaceY(kk, p.x, t);
        if (Math.abs(p.y - y) < 1.2) {
          upper = L[kk - 1];
          lower = L[kk];
        }
      }
    }
    if (!upper) return null;
    const v = c.body.getLinearVelocity();
    if (Math.hypot(v.x, v.y) > 0.8) return null;
    const frac = (c.mat.d - upper.rho) / (lower.rho - upper.rho);
    if (frac <= 0 || frac >= 1) return null;
    return { frac, upper, lower };
  }
}

export class Grapples {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.autoT = 0;
  }

  reachOf(block) {
    return block.fn === 'core' ? GRAPPLE_REACH_CORE : GRAPPLE_REACH_CRANE;
  }

  ownerPos(block) {
    const s = block.struct;
    const p = s.body.getWorldPoint(new pl.Vec2(block.gx, block.gy + (block.fn === 'crane' ? 0.3 : 0)));
    return { x: p.x, y: p.y };
  }

  busy(block) {
    return this.list.some((gr) => gr.owner === block);
  }

  targeted(obj) {
    return this.list.some((gr) => gr.target === obj);
  }

  targetPos(target) {
    const body = target.kind === 'chunk' ? target.ref.body : target.ref.body;
    if (!body) return null;
    const p = body.getWorldCenter();
    return { x: p.x, y: p.y };
  }

  owners() {
    const col = this.game.colony;
    if (!col) return [];
    return col.list.filter((b) => b.fn === 'core' || b.fn === 'crane');
  }

  /** Pick the free grapple that can reach the target soonest. */
  fire(target) {
    const tp = this.targetPos(target);
    if (!tp) return { ok: false, reason: 'Nothing there.' };
    if (this.list.some((gr) => gr.target.ref === target.ref)) return { ok: false, reason: 'Already hauling that in.' };
    let best = null,
      bestD = Infinity;
    for (const o of this.owners()) {
      const op = this.ownerPos(o);
      const d = Math.hypot(tp.x - op.x, tp.y - op.y);
      if (d > this.reachOf(o)) continue;
      const busy = this.busy(o);
      const score = d + (busy ? 1000 : 0);
      if (score < bestD) {
        bestD = score;
        best = o;
      }
    }
    if (!best) return { ok: false, reason: 'Out of reach. Build a crane closer (17 m reach), or wait for it to drift nearer.' };
    if (this.busy(best)) {
      const gr = this.list.find((x) => x.owner === best);
      if (gr && gr.auto) this.release(gr);
      else return { ok: false, reason: 'That grapple is busy.' };
    }
    this.launch(best, target, false);
    return { ok: true };
  }

  launch(owner, target, auto) {
    const op = this.ownerPos(owner);
    const gr = { owner, target, phase: 'out', hx: op.x, hy: op.y, len: 0, t: 0, auto, tension: 0 };
    if (target.kind === 'chunk') {
      target.ref.grabbed = gr;
      const v = target.ref.body.getLinearVelocity();
      if (target.ref.settled > 0.3 || Math.hypot(v.x, v.y) < 0.6) this.game.flotsam.observeRest(target.ref, true);
    }
    this.passThrough(target, true);
    this.list.push(gr);
    this.game.emit('sfx', { name: 'grappleFire', x: op.x, y: op.y });
    return gr;
  }

  release(gr, why) {
    const i = this.list.indexOf(gr);
    if (i >= 0) this.list.splice(i, 1);
    if (gr.target.kind === 'chunk' && gr.target.ref.grabbed === gr) gr.target.ref.grabbed = null;
    this.passThrough(gr.target, false);
    if (why) this.game.log(why, 'info');
  }

  passThrough(target, on) {
    const ref = target.ref;
    if (!ref || !ref.body || ref.dead) return;
    if (target.kind === 'chunk') {
      for (let f = ref.body.getFixtureList(); f; f = f.getNext()) f.setFilterData({ groupIndex: 0, categoryBits: CAT_CHUNK, maskBits: on ? 0xffff & ~CAT_STRUCT : 0xffff });
    } else ref.setPassThrough(on);
  }

  update(dt) {
    const g = this.game;
    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 0.6;
      for (const o of this.owners()) {
        if (o.fn !== 'crane' || this.busy(o) || o.state.auto === false) continue;
        const op = this.ownerPos(o);
        let best = null,
          bd = Infinity;
        for (const c of g.flotsam.chunks) {
          if (c.grabbed || !c.body) continue;
          const p = c.body.getPosition();
          const d = Math.hypot(p.x - op.x, p.y - op.y);
          if (d < GRAPPLE_REACH_CRANE && d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best) this.launch(o, { kind: 'chunk', ref: best }, true);
      }
    }
    for (const gr of this.list.slice()) this.step(gr, dt);
  }

  step(gr, dt) {
    const g = this.game;
    const owner = gr.owner;
    if (!owner.struct || owner.struct !== g.colony || owner.struct.dead) {
      this.release(gr);
      return;
    }
    const ref = gr.target.ref;
    if (!ref.body || ref.dead) {
      this.release(gr);
      return;
    }
    gr.t += dt;
    const op = this.ownerPos(owner);
    const tb = ref.body;
    const tp = tb.getWorldCenter();
    if (gr.phase === 'out') {
      const dx = tp.x - gr.hx,
        dy = tp.y - gr.hy;
      const d = Math.hypot(dx, dy);
      const step = GRAPPLE_SPEED * dt;
      if (d <= step + 0.3) {
        gr.hx = tp.x;
        gr.hy = tp.y;
        gr.phase = 'reel';
        gr.len = Math.hypot(tp.x - op.x, tp.y - op.y);
        g.emit('sfx', { name: 'grappleHit', x: tp.x, y: tp.y });
      } else {
        gr.hx += (dx / d) * step;
        gr.hy += (dy / d) * step;
      }
      if (Math.hypot(gr.hx - op.x, gr.hy - op.y) > this.reachOf(owner) + 8) this.release(gr, 'The line fell short.');
      return;
    }
    gr.hx = tp.x;
    gr.hy = tp.y;
    gr.len = Math.max(0.6, gr.len - REEL_SPEED * dt);
    const dx = op.x - tp.x,
      dy = op.y - tp.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / d,
      uy = dy / d;
    const mass = tb.getMass();
    const tv = tb.getLinearVelocity();
    const ov = owner.struct.body.getLinearVelocityFromWorldPoint(new pl.Vec2(op.x, op.y));
    const relAway = -((tv.x - ov.x) * ux + (tv.y - ov.y) * uy);
    let F = 0;
    if (d > gr.len) F = mass * 30 * (d - gr.len) + mass * 7 * relAway;
    F = Math.max(0, Math.min(GRAPPLE_MAX_FORCE, F));
    gr.tension = F;
    if (F > 0) {
      tb.applyForceToCenter(new pl.Vec2(ux * F, uy * F), true);
      owner.struct.body.applyForce(new pl.Vec2(-ux * F, -uy * F), new pl.Vec2(op.x, op.y), true);
      owner.ex -= ux * F;
      owner.ey -= uy * F;
    }
    if (d < 2) {
      this.collect(gr);
      return;
    }
    if (gr.t > 45) this.release(gr, F >= GRAPPLE_MAX_FORCE * 0.98 ? 'Too heavy to haul in. The line slipped.' : 'The line slipped.');
  }

  collect(gr) {
    const g = this.game;
    const ref = gr.target.ref;
    const p = ref.body.getWorldCenter();
    this.release(gr);
    if (gr.target.kind === 'chunk') {
      g.addStock(ref.mat.id, ref.units);
      g.knowledge.see(ref.mat);
      g.fx.push({ type: 'collect', x: p.x, y: p.y, mat: ref.mat, units: ref.units });
      g.emit('sfx', { name: 'collect', x: p.x, y: p.y });
      g.stats.chunks++;
      g.flotsam.remove(ref);
    } else {
      const refund = new Map();
      for (const b of ref.list) {
        const fn = FUNCS[b.fn];
        const add = (id, n) => refund.set(id, (refund.get(id) || 0) + n);
        if (fn.fixedMat) add('salvage', Math.floor((fn.salvage || 0) * 0.5));
        else {
          add(b.mat.id, Math.floor(fn.cost * 0.5));
          add('salvage', Math.floor((fn.salvage || 0) * 0.5));
        }
      }
      for (const [id, n] of refund) if (n > 0) g.addStock(id, n);
      g.fx.push({ type: 'collect', x: p.x, y: p.y, mat: null, units: 0, salvage: refund });
      g.emit('sfx', { name: 'collect', x: p.x, y: p.y });
      g.removeStructure(ref);
    }
  }
}
