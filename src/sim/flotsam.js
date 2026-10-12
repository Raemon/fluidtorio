import { pl } from './physics.js';
import {
  WORLD_HALF_WIDTH,
  GRAPPLE_SPEED,
  REEL_SPEED,
  GRAPPLE_MAX_FORCE,
  GRAPPLE_REACH_CRANE,
  CAST_REACH,
  FUNCS,
  UNITS_PER_M2,
  PACKED_SALVAGE_DENSITY,
} from './config.js';
import { CAT_STRUCT, CAT_CHUNK } from './structure.js';

let CHUNK_ID = 1;

export function chunkShape(rng, r) {
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

export function boxShape(w, h) {
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/**
 * Everything loose in the world: flotsam in the sea, and cargo sitting on the colony.
 * A hauled chunk never becomes a number: it lands on the deck and stays a body with weight.
 */
export class Flotsam {
  constructor(game) {
    this.game = game;
    this.chunks = [];
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

  /**
   * opts: size (radius), debris (salvage wreckage), crate (a salvage crate), units, pts, angle, vx, vy, site.
   */
  spawn(mat, x, y, opts = {}) {
    if (typeof opts === 'number') opts = { size: opts };
    const g = this.game;
    const salvage = mat.kind === 'salvage';
    const debris = !!opts.debris || (salvage && !opts.crate);
    let pts = opts.pts;
    if (!pts) {
      if (opts.crate) pts = boxShape(opts.w || 1.25, opts.h || 1.0);
      else {
        let r = opts.size;
        if (!r && opts.units) r = Math.sqrt(opts.units / UNITS_PER_M2 / 2.3);
        pts = chunkShape(this.rng, r || 0.45 + this.rng() * 0.32);
      }
    }
    const area = polyArea(pts);
    const density = salvage ? PACKED_SALVAGE_DENSITY : mat.d;
    const body = g.physics.createBody(x, y, opts.angle ?? this.rng() * 6.28, null);
    const lv = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => {
      lv[2 * i] = p[0];
      lv[2 * i + 1] = p[1];
    });
    const fixture = body.createFixture({
      shape: new pl.Polygon(pts.map((p) => new pl.Vec2(p[0], p[1]))),
      density,
      friction: 0.85,
      restitution: 0.04,
      filterCategoryBits: CAT_CHUNK,
      filterMaskBits: 0xffff,
    });
    const chunk = {
      id: CHUNK_ID++,
      mat,
      body,
      pts,
      area,
      units: opts.units || Math.max(2, Math.round(area * UNITS_PER_M2 * (debris ? 0.8 : 1))),
      debris,
      crate: !!opts.crate,
      site: opts.site || null,
      settled: 0,
      layer: -1,
      fizz: 0,
      grabbed: null,
      claimed: null,
      aboard: false,
      aboardT: 0,
      hover: 0,
    };
    fixture.setUserData({ owner: null, chunk, lv, n: pts.length, area, currentMul: 1 });
    body.setUserData({ kind: 'chunk', chunk, wetFrac: 0 });
    if (opts.vx !== undefined) body.setLinearVelocity(new pl.Vec2(opts.vx, opts.vy || 0));
    this.chunks.push(chunk);
    return chunk;
  }

  /** A fresh item of cargo, sized to its units. */
  produce(mat, units, x, y, opts = {}) {
    return this.spawn(mat, x, y, { ...opts, units, size: Math.sqrt(units / UNITS_PER_M2 / 2.3) });
  }

  remove(chunk) {
    const i = this.chunks.indexOf(chunk);
    if (i >= 0) this.chunks.splice(i, 1);
    if (chunk.body) this.game.physics.destroyBody(chunk.body);
    chunk.body = null;
    chunk.dead = true;
  }

  /** Is this item resting on top of the colony (or on cargo that is), out of the water? */
  touchingColony(c) {
    const col = this.game.colony;
    if (!col || !c.body) return false;
    const ud = c.body.getUserData();
    if (ud && ud.wetFrac > 0.6) return false;
    for (let ce = c.body.getContactList(); ce; ce = ce.next) {
      const ct = ce.contact;
      if (!ct.isTouching()) continue;
      const od = ce.other.getUserData();
      const support = ce.other === col.body || (od && od.kind === 'chunk' && od.chunk.aboard && od.chunk !== c);
      if (!support) continue;
      // the contact normal must point up from the support into the item: it's lying on it
      const n = ct.getWorldManifold(null).normal;
      const up = ct.getFixtureA().getBody() === ce.other ? n.y : -n.y;
      if (up > 0.45) return true;
    }
    return false;
  }

  /**
   * Floating debris doesn't pile up against the bow of a raft under way: in the real sea it would
   * slide around the hull, so here it passes behind it.
   */
  slip(c, dt) {
    const col = this.game.colony;
    if (!col || c.grabbed || c.aboard) return;
    if (c.slipT > 0) {
      c.slipT -= dt;
      if (c.slipT > 0) return;
      const q = col.body.getLocalPoint(c.body.getPosition());
      const b = col.bounds();
      if (q.x > b.x0 - 1.3 && q.x < b.x1 + 1.3 && q.y > b.y0 - 1.3 && q.y < b.y1 + 1.3) {
        c.slipT = 0.4;
        return;
      }
      this.setSlip(c, false);
      return;
    }
    const vx = col.body.getLinearVelocity().x;
    if (Math.abs(vx - c.body.getLinearVelocity().x) < 0.1) return;
    for (let ce = c.body.getContactList(); ce; ce = ce.next) {
      if (ce.other !== col.body || !ce.contact.isTouching()) continue;
      const n = ce.contact.getWorldManifold(null).normal;
      if (Math.abs(n.x) > 0.6) {
        c.slipT = 2;
        this.setSlip(c, true);
        return;
      }
    }
  }

  setSlip(c, on) {
    for (let f = c.body.getFixtureList(); f; f = f.getNext()) f.setFilterData({ groupIndex: 0, categoryBits: CAT_CHUNK, maskBits: on ? 0xffff & ~CAT_STRUCT : 0xffff });
  }

  aboard() {
    return this.chunks.filter((c) => c.aboard && !c.grabbed && c.body);
  }

  update(dt) {
    const g = this.game;
    const t = g.time;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      const p = c.body.getPosition();
      if (Math.abs(p.x) > WORLD_HALF_WIDTH + 8 || p.y < g.sea.floor - 20) {
        if (!c.grabbed) this.remove(c);
        continue;
      }
      this.slip(c, dt);
      const wasAboard = c.aboard;
      if (this.touchingColony(c)) {
        c.aboardT = 0.8;
        c.aboard = true;
      } else {
        c.aboardT -= dt;
        if (c.aboardT <= 0) c.aboard = false;
      }
      if (wasAboard && !c.aboard && !c.claimed) g.emit('overboard', c);
      const layer = g.sea.layerAt(p.x, p.y, t);
      c.layer = layer;
      const v = c.body.getLinearVelocity();
      const sp = Math.hypot(v.x, v.y);
      if (layer <= 5 && g.experiments.near(p.x, p.y)) g.knowledge.exposed(c.mat, layer, dt);
      if (c.mat.react[layer] && c.mat.react[layer] !== 'none' && layer <= 5) c.fizz = Math.min(1, c.fizz + dt * 2);
      else c.fizz = Math.max(0, c.fizz - dt);
      if (sp < 0.35 && !c.grabbed && !c.aboard) c.settled += dt;
      else c.settled = 0;
      if (c.settled > 0.8) this.observeRest(c);
    }
  }

  /** A chunk at rest tells you where its density sits between the fluids around it. */
  observeRest(c, force = false) {
    const g = this.game;
    if (!c.body || c.debris || c.crate || c.aboard) return;
    const p = c.body.getPosition();
    if (!force && !g.experiments.near(p.x, p.y)) return;
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
    if (Math.abs(p.y - surf) < 1.2) {
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
}

/**
 * Lines: cast by a colonist with a rod, or by a crane. A line hooks a target and reels it to its owner,
 * pulling on the colony as it does. Whatever arrives is set down on the deck.
 */
export class Grapples {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.autoT = 0;
  }

  isColonist(o) {
    return !!o.colonist;
  }

  reachOf(o) {
    return this.isColonist(o) ? CAST_REACH : GRAPPLE_REACH_CRANE;
  }

  ownerPos(o) {
    if (this.isColonist(o)) return this.game.colonists.handPos(o);
    const s = o.struct;
    const p = s.body.getWorldPoint(new pl.Vec2(o.gx, o.gy + 0.3));
    return { x: p.x, y: p.y };
  }

  ownerStruct(o) {
    return this.isColonist(o) ? this.game.colony : o.struct;
  }

  /** The block that feels the line's pull. */
  ownerBlock(o) {
    return this.isColonist(o) ? this.game.colonists.supportOf(o) : o;
  }

  busy(o) {
    return this.list.some((gr) => gr.owner === o);
  }

  targetPos(target) {
    if (target.kind === 'castaway') return { x: target.ref.x, y: target.ref.y + 0.5 };
    if (target.kind === 'wreck' && target.ref.dead) return null;
    const body = target.ref.body;
    if (!body) return null;
    const p = body.getWorldCenter();
    return { x: p.x, y: p.y };
  }

  cranes() {
    const col = this.game.colony;
    if (!col) return [];
    return col.list.filter((b) => b.fn === 'crane');
  }

  owners() {
    return [...this.cranes(), ...this.game.colonists.list];
  }

  hooked(ref) {
    return this.list.some((gr) => gr.target.ref === ref);
  }

  launch(owner, target, auto) {
    const op = this.ownerPos(owner);
    const gr = { owner, target, phase: 'out', hx: op.x, hy: op.y, len: 0, t: 0, auto, tension: 0 };
    if (target.kind === 'chunk') {
      target.ref.grabbed = gr;
      const v = target.ref.body.getLinearVelocity();
      if (target.ref.settled > 0.3 || Math.hypot(v.x, v.y) < 0.6) this.game.flotsam.observeRest(target.ref, true);
    }
    if (target.kind === 'castaway') target.ref.hooked = gr;
    this.passThrough(target, true);
    this.list.push(gr);
    this.game.emit('sfx', { name: 'grappleFire', x: op.x, y: op.y });
    return gr;
  }

  release(gr, why) {
    const i = this.list.indexOf(gr);
    if (i >= 0) this.list.splice(i, 1);
    if (gr.target.kind === 'chunk' && gr.target.ref.grabbed === gr) gr.target.ref.grabbed = null;
    if (gr.target.kind === 'castaway' && gr.target.ref.hooked === gr) gr.target.ref.hooked = null;
    this.passThrough(gr.target, false);
    if (why) this.game.log(why, 'info');
    gr.done = true;
  }

  passThrough(target, on) {
    const ref = target.ref;
    if (target.kind === 'castaway' || !ref || !ref.body || ref.dead) return;
    if (target.kind === 'chunk') {
      for (let f = ref.body.getFixtureList(); f; f = f.getNext()) f.setFilterData({ groupIndex: 0, categoryBits: CAT_CHUNK, maskBits: on ? 0xffff & ~CAT_STRUCT : 0xffff });
    } else ref.setPassThrough(on);
  }

  /** Cranes haul by themselves. */
  update(dt) {
    const g = this.game;
    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 0.6;
      for (const o of this.cranes()) {
        if (this.busy(o) || o.state.auto === false) continue;
        const op = this.ownerPos(o);
        let best = null,
          bd = Infinity;
        for (const c of g.flotsam.chunks) {
          if (c.grabbed || c.aboard || c.claimed || !c.body) continue;
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
    const struct = this.ownerStruct(owner);
    if (!struct || struct !== g.colony || struct.dead || (!this.isColonist(owner) && owner.struct !== g.colony)) {
      this.release(gr);
      return;
    }
    if (gr.target.kind === 'castaway') return this.stepCastaway(gr, dt);
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
    const ov = struct.body.getLinearVelocityFromWorldPoint(new pl.Vec2(op.x, op.y));
    const relAway = -((tv.x - ov.x) * ux + (tv.y - ov.y) * uy);
    let F = 0;
    if (d > gr.len) F = mass * 30 * (d - gr.len) + mass * 7 * relAway;
    F = Math.max(0, Math.min(GRAPPLE_MAX_FORCE, F));
    gr.tension = F;
    if (F > 0) {
      tb.applyForceToCenter(new pl.Vec2(ux * F, uy * F), true);
      struct.body.applyForce(new pl.Vec2(-ux * F, -uy * F), new pl.Vec2(op.x, op.y), true);
      const blk = this.ownerBlock(owner);
      if (blk) {
        blk.ex -= ux * F;
        blk.ey -= uy * F;
      }
    }
    if (d < 1.7) {
      this.collect(gr);
      return;
    }
    if (gr.t > 45) this.release(gr, F >= GRAPPLE_MAX_FORCE * 0.98 ? 'Too heavy to haul in. The line slipped.' : 'The line slipped.');
  }

  /** A castaway on the line swims along it. */
  stepCastaway(gr, dt) {
    const g = this.game;
    const cw = gr.target.ref;
    const op = this.ownerPos(gr.owner);
    gr.t += dt;
    if (gr.phase === 'out') {
      const dx = cw.x - gr.hx,
        dy = cw.y + 0.5 - gr.hy;
      const d = Math.hypot(dx, dy);
      const step = GRAPPLE_SPEED * dt;
      if (d <= step + 0.3) {
        gr.phase = 'reel';
        g.world.castawayHooked(cw);
      } else {
        gr.hx += (dx / d) * step;
        gr.hy += (dy / d) * step;
      }
      return;
    }
    // swim towards the line's owner, staying at the surface until close
    const tx = op.x,
      ty = Math.min(op.y, g.sea.surfaceY(cw.x, g.time) + 0.1);
    const dx = tx - cw.x,
      dy = ty - cw.y;
    const d = Math.hypot(dx, dy);
    const sp = 3.2;
    cw.x += (dx / (d || 1)) * Math.min(d, sp * dt);
    cw.y += (dy / (d || 1)) * Math.min(d, sp * dt);
    cw.swimming = true;
    gr.hx = cw.x;
    gr.hy = cw.y + 0.5;
    if (Math.hypot(op.x - cw.x, op.y - cw.y) < 1.8) {
      this.release(gr);
      g.world.rescue(cw, gr.owner);
    }
  }

  /** Whatever comes up the line is set down on the deck beside whoever hauled it. */
  landingSpot(owner) {
    const g = this.game;
    const col = g.colony;
    if (this.isColonist(owner)) return g.colonists.landingSpot(owner);
    const lp = { x: owner.gx, y: owner.gy };
    const inward = lp.x > col.core.gx ? -1 : 1;
    return col.body.getWorldPoint(new pl.Vec2(lp.x + inward * 0.6, lp.y + 1.2));
  }

  collect(gr) {
    const g = this.game;
    const ref = gr.target.ref;
    const owner = gr.owner;
    this.release(gr);
    const spot = this.landingSpot(owner);
    const col = g.colony;
    const v = col.body.getLinearVelocityFromWorldPoint(new pl.Vec2(spot.x, spot.y));
    if (gr.target.kind === 'chunk') {
      // swing it aboard: it lands, and from now on the raft carries its weight
      ref.body.setTransform(new pl.Vec2(spot.x, spot.y), ref.body.getAngle());
      ref.body.setLinearVelocity(new pl.Vec2(v.x, v.y - 0.5));
      ref.body.setAngularVelocity(0);
      ref.aboard = true;
      ref.aboardT = 1.2;
      ref.observedAboard = true;
      g.knowledge.see(ref.mat);
      g.fx.push({ type: 'collect', x: spot.x, y: spot.y, mat: ref.mat, units: ref.units, debris: ref.debris });
      g.emit('sfx', { name: 'collect', x: spot.x, y: spot.y });
      g.stats.chunks++;
      if (!ref.debris && !ref.crate && ref.mat.d > g.planet.layers[4].rho) g.progress.findFuel('chunk', ref.mat);
      g.emit('haul', ref);
      // sandbox stores are abstract: the haul goes straight into them
      if (g.sandbox) {
        g.addStock(ref.mat.id, ref.units);
        this.game.flotsam.remove(ref);
      }
    } else {
      // a wreck: break it down into salvage on the deck
      const refund = new Map();
      for (const b of ref.list) {
        const fn = FUNCS[b.fn];
        const add = (m, n) => refund.set(m, (refund.get(m) || 0) + n);
        if (fn.fixedMat) add(g.planet.salvage, Math.floor((fn.salvage || 0) * 0.5));
        else {
          add(b.mat, Math.floor(fn.cost * 0.5));
          add(g.planet.salvage, Math.floor((fn.salvage || 0) * 0.5));
        }
      }
      g.removeStructure(ref);
      let k = 0;
      for (const [m, n] of refund)
        if (n > 0 && g.sandbox) g.addStock(m.id, n);
        else if (n > 0) {
          const c = g.flotsam.produce(m, n, spot.x + (k++ - 0.5) * 0.6, spot.y + 0.4);
          c.body.setLinearVelocity(new pl.Vec2(v.x, v.y));
          c.aboard = true;
          c.aboardT = 1.2;
        }
      g.fx.push({ type: 'collect', x: spot.x, y: spot.y, mat: null, units: 0 });
      g.emit('sfx', { name: 'collect', x: spot.x, y: spot.y });
    }
  }
}
