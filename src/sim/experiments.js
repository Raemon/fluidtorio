import { FUNCS, GRAPPLE_REACH_CORE, SWELL_GAIN } from './config.js';
import { Structure } from './structure.js';
import { pl } from './physics.js';

/** How far from the colony the crew can still watch what happens. */
export const WATCH_RANGE = 60;
/** A test cube is a solid frame block, at frame cost. */
export const DROP_COST = FUNCS.frame.cost;
export const THROW_RANGE = 12;
const SETTLE = 2.5;


/**
 * The colony's instruments are the sea and the raft itself. Nothing here measures
 * anything on its own: it only reads the physical situations the player sets up.
 *
 * - Test cubes dropped overboard show where a material settles, how deep it floats,
 *   and what it does in each layer on the way down.
 * - Every block added to the raft pushes it down: the change in draft weighs it
 *   (less what it displaces, if it's in the water). More blocks, solid blocks and
 *   calm water read better; two unknown materials at once can't be told apart.
 */
export class Experiments {
  constructor(game) {
    this.game = game;
    this.weigh = null;
  }

  near(x, y) {
    const col = this.game.colony;
    if (!col) return false;
    const c = col.body.getWorldCenter();
    return Math.hypot(x - c.x, y - c.y) < WATCH_RANGE;
  }

  // ───────────────────────────── test cubes

  canDrop(mat, x, y) {
    const g = this.game;
    const col = g.colony;
    if (!col || !col.core || g.state !== 'playing') return { ok: false, reason: '' };
    if (!mat) return { ok: false, reason: 'Pick a material.' };
    const cp = col.worldPos(col.core.gx, col.core.gy);
    if (Math.hypot(x - cp.x, y - cp.y) > GRAPPLE_REACH_CORE) return { ok: false, reason: 'Too far from the core to lower it there.' };
    if (y < g.physics.floorAt(x) + 0.7) return { ok: false, reason: 'That is the sea floor.' };
    const lp = col.localPos(x, y);
    for (let gy = Math.round(lp.y); gy > -60; gy--) if (col.at(Math.round(lp.x), gy)) return { ok: false, reason: 'It would land on the raft. Drop it over open water.' };
    for (const s of g.structures) {
      const lp = s.localPos(x, y);
      for (const cx of [Math.floor(lp.x), Math.ceil(lp.x)])
        for (const cy of [Math.floor(lp.y), Math.ceil(lp.y)])
          if (s.at(cx, cy) && Math.abs(lp.x - cx) < 0.95 && Math.abs(lp.y - cy) < 0.95) return { ok: false, reason: 'Something is in the way.' };
    }
    if (g.stockOf(mat.id) < DROP_COST) return { ok: false, reason: `A cube takes ${DROP_COST} ${mat.name}.` };
    return { ok: true };
  }

  /** opts.free: the material was already taken (a colonist cut the cube and threw it). */
  /** A colonist can throw a test cube out over open water, within a stone's throw of the deck. */
  canThrow(mat, x, y) {
    const g = this.game;
    const col = g.colony;
    if (!col || g.state !== 'playing') return { ok: false, reason: '' };
    if (!mat) return { ok: false, reason: 'Pick a material.' };
    if (!g.colonists.list.length) return { ok: false, reason: 'Nobody aboard to throw it.' };
    const lp = col.localPos(x, y);
    for (let gy = Math.round(lp.y); gy > -60; gy--) if (col.at(Math.round(lp.x), gy)) return { ok: false, reason: 'That would land on the raft. Throw it over open water.' };
    if (y < g.physics.floorAt(x) + 0.7) return { ok: false, reason: 'That is the sea floor.' };
    let near = Infinity;
    for (const n of g.colonists.nodes.values()) {
      if (!n.stand) continue;
      const w = g.colonists.nodeWorld(n);
      near = Math.min(near, Math.hypot(w.x - x, w.y - y));
    }
    if (near > THROW_RANGE) return { ok: false, reason: 'Too far to throw.' };
    if (g.stockOf(mat.id) < DROP_COST) return { ok: false, reason: `A cube takes ${DROP_COST} ${mat.name}, and there isn't that much aboard.` };
    return { ok: true };
  }

  drop(mat, x, y, opts = {}) {
    const g = this.game;
    if (!opts.free) {
      const chk = this.canDrop(mat, x, y);
      if (!chk.ok) return chk;
      g.addStock(mat.id, -DROP_COST);
    }
    const body = g.physics.createBody(x, y, 0, null);
    if (opts.vx !== undefined) body.setLinearVelocity(new pl.Vec2(opts.vx, opts.vy || 0));
    const s = new Structure(g, 'wreck', body);
    const b = s.addBlock(0, 0, 'frame', mat);
    body.resetMassData();
    s.cube = { mat, still: 0, read: null, born: g.time };
    g.structures.push(s);
    g.knowledge.see(mat);
    g.stats.cubes++;
    g.fx.push({ type: 'place', x, y, block: b });
    g.emit('sfx', { name: 'splash', x, y });
    return { ok: true, struct: s };
  }

  /** Watch lone blocks in the water (test cubes, jettisoned blocks) until they come to rest. */
  watchCubes(dt) {
    const g = this.game;
    for (const s of g.structures) {
      if (s.kind !== 'wreck' || s.list.length !== 1 || s.list[0].fn !== 'frame') continue;
      if (!s.cube) s.cube = { mat: s.list[0].mat, still: 0, read: null, born: g.time };
      const c = s.cube;
      if (c.read) continue;
      const p = s.body.getWorldCenter();
      if (!this.near(p.x, p.y)) continue;
      // drifting with the current is fine; it has settled once it stops rising or sinking
      const v = s.body.getLinearVelocity();
      c.vy = (c.vy || 0) * 0.85 + Math.abs(v.y) * 0.15;
      c.still = c.vy < 0.2 ? c.still + dt : 0;
      if (c.still > 1.5) this.readCube(s, p);
    }
  }

  readCube(s, p) {
    const g = this.game;
    const kn = g.knowledge;
    const b = s.list[0];
    const m = b.mat;
    const L = g.planet.layers;
    const t = g.time;
    const c = s.cube;
    const fill = FUNCS[b.fn].fill * (1 + SWELL_GAIN * (b.swell || 0));
    if (b.flooded) return;
    const surf = g.sea.surfaceY(p.x, t);
    let upper = null,
      lower = null;
    if (Math.abs(p.y - surf) < 0.95) {
      upper = { rho: 0, name: 'air' };
      lower = L[3];
    } else
      for (const k of [4, 5])
        if (Math.abs(p.y - g.sea.ifaceY(k, p.x, t)) < 0.95) {
          upper = L[k - 1];
          lower = L[k];
        }
    if (upper) {
      // a cube at rest across an interface: how far it sits into the lower fluid is its density
      const gap = lower.rho - upper.rho;
      const frac = Math.max(0, Math.min(1, (m.d * fill - upper.rho) / gap));
      const err = (0.05 * gap) / fill;
      const centre = m.d + (Math.random() * 2 - 1) * 0.6 * err;
      c.read = { frac, est: centre, upper, lower };
      kn.densityInterval(m, centre - err, centre + err, `a cube floats ${Math.round(frac * 100)}% into ${lower.name}`);
    } else if (p.y < g.physics.floorAt(p.x) + 1.3) {
      c.read = { floor: true };
      kn.densityInterval(m, L[5].rho, Infinity, `a cube sank to the floor`);
    } else {
      c.still = 0;
      return;
    }
    g.emit('cube', s);
  }

  // ───────────────────────────── weighing on the deck

  /** Every block set down on the colony changes how deep it rides. Dry ones can be weighed. */
  onPlace(b) {
    const col = this.game.colony;
    if (!col || b.struct !== col || this.game.attract) return;
    if (!this.weigh) this.weigh = { blocks: [], t: 0, age: 0, swell: 0, wet: 0, n: 0 };
    this.weigh.blocks.push(b);
    this.weigh.t = 0;
  }

  /** Anything else that changes the load spoils a reading in progress. */
  disturb(why) {
    if (this.weigh) this.spoil(why);
  }

  spoil(why) {
    const g = this.game;
    this.weigh = null;
    if (why) g.log(why, 'info');
  }

  update(dt) {
    this.watchCubes(dt);
    const w = this.weigh;
    const g = this.game;
    const col = g.colony;
    if (!w || !col) return;
    w.t += dt;
    w.age += dt;
    // a passing swell, or a block sitting right at the waterline, blurs the reading
    const c = col.body.getWorldCenter();
    w.swell = Math.max(w.swell, g.sea.swellAt(c.x));
    let lap = 0;
    for (const b of w.blocks) if (b.wet > 0.05 && b.wet < 0.95) lap++;
    w.wet += lap * dt;
    w.n += dt;
    const tugging = g.grapples.list.some((gr) => gr.owner.struct === col && gr.tension > 2);
    if (tugging) w.t = Math.min(w.t, 0.5);
    if (w.age > 20) return this.spoil('The grapple kept tugging at the raft, so the weighing never settled.');
    if (w.t >= SETTLE) this.resolve();
  }

  resolve() {
    const g = this.game;
    const kn = g.knowledge;
    const col = g.colony;
    const w = this.weigh;
    this.weigh = null;
    const blocks = w.blocks.filter((b) => b.struct === col);
    if (!blocks.length) return;
    if (blocks.length < w.blocks.length) return g.log('Part of the load came off before the raft settled.', 'info');
    const lapping = w.wet / Math.max(w.n, 1e-6);
    const rho1 = g.planet.layers[3].rho;
    const sigma = 0.05 + 0.6 * w.swell + 0.15 * rho1 * lapping;
    // the raft feels each block's weight less what it displaces; the crew can see how deep each sits, so they add that back
    const total = blocks.reduce((a, b) => a + b.mass, 0);
    const shown = Math.max(0, total + (Math.random() * 2 - 1) * sigma * 0.6);
    const c = col.body.getWorldCenter();
    g.fx.push({ type: 'popup', x: c.x, y: c.y + 2.6, text: `⚖ ${shown.toFixed(1)} t`, color: '#cfe8ff', life: 2.6 });
    g.stats.weighings++;
    // what you know about everything else on the scale bounds what this one can weigh
    const mats = [...new Set(blocks.map((b) => b.mat))];
    const fillOf = (m) => blocks.filter((b) => b.mat === m).reduce((a, b) => a + FUNCS[b.fn].fill * (1 + SWELL_GAIN * (b.swell || 0)), 0);
    const equip = blocks.reduce((a, b) => a + FUNCS[b.fn].equip, 0);
    const lo = shown - sigma,
      hi = shown + sigma;
    let learned = 0;
    const unknown = mats.filter((m) => !kn.get(m).exact && kn.get(m).d[1] / kn.get(m).d[0] > 1.03);
    for (const m of unknown) {
      const others = mats.filter((o) => o !== m);
      const oLo = others.reduce((a, o) => a + kn.get(o).d[0] * fillOf(o), 0);
      const oHi = others.reduce((a, o) => a + Math.min(kn.get(o).d[1], 6) * fillOf(o), 0);
      const f = fillOf(m);
      const dLo = Math.max(0.01, (lo - equip - oHi) / f),
        dHi = (hi - equip - oLo) / f;
      if (dHi / dLo > 1.6) continue; // too blurred by everything else on the scale to say anything useful
      const n = blocks.filter((b) => b.mat === m).length;
      const why = w.swell > 0.25 ? ' in a swell' : lapping > 0.3 ? ' at the waterline' : '';
      const with_ = others.length ? ` with ${others.map((o) => o.name).join(' and ')}` : '';
      kn.densityInterval(m, dLo, dHi, `weighed ${n} ${m.name} block${n > 1 ? 's' : ''}${with_}${why}`);
      learned++;
    }
    if (unknown.length > 1 && !learned)
      g.log(`Weighed ${unknown.map((m) => m.name).join(' and ')} together: ${shown.toFixed(1)} t, but there's no telling which weighs what.`, 'warn');
  }

  /** The current weighing, for the HUD: progress 0..1. */
  weighProgress() {
    const w = this.weigh;
    return w ? Math.min(1, w.t / SETTLE) : null;
  }
}
