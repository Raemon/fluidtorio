import { FUNCS, G, WALK_SPEED, CLIMB_SPEED, CAST_REACH, BUILD_TIME, COLONIST_MASS, ROW_FORCE } from './config.js';
import { pl } from './physics.js';
import { keyOf } from './structure.js';
import { cargoMass } from './cargo.js';
import { DROP_COST } from './experiments.js';

const NAMES = ['Ada', 'Bo', 'Cass', 'Dov', 'Esme', 'Finn', 'Gale', 'Hiro', 'Ines', 'Juno', 'Kit', 'Lem'];
const SUITS = [
  [0.95, 0.58, 0.24],
  [0.36, 0.72, 0.96],
  [0.58, 0.86, 0.42],
  [0.93, 0.46, 0.72],
  [0.96, 0.86, 0.36],
  [0.66, 0.56, 0.96],
];
const N8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Lower is less important: a colonist doing something less important can be pulled off it. */
const RANK = { idle: 0, row: 1, fish: 2, store: 3, build: 4, throw: 5, goto: 6 };

let COLONIST_ID = 1;

/**
 * The crew. They live on the colony's grid: standing on blocks, climbing the sides of the
 * structure, and doing the actual work. You can order any of them about; left alone they
 * build what is planned, stow loose cargo, row when there's a course set, and fish if told to.
 */
export class Colonists {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nodes = new Map();
    this.navVersion = -1;
    this.nameIdx = 0;
  }

  spawn(cx, cy, name) {
    const c = {
      colonist: true,
      id: COLONIST_ID++,
      name: name || NAMES[this.nameIdx % NAMES.length],
      suit: SUITS[this.nameIdx % SUITS.length],
      cx,
      cy,
      x: cx,
      y: cy - 0.5,
      path: [],
      job: null,
      orders: [],
      carry: null,
      autoFish: false,
      face: 1,
      walkT: 0,
      pose: 'stand',
      thinkT: 0,
      ex: 0,
      ey: 0,
      born: this.game.time,
    };
    this.nameIdx++;
    this.list.push(c);
    this.rebuild();
    this.snap(c);
    this.game.emit('crew', c);
    return c;
  }

  // ───────────────────────────── navigation

  rebuild() {
    const col = this.game.colony;
    this.nodes = new Map();
    if (!col || !col.list.length) return;
    this.navVersion = col.version;
    const b = col.bounds();
    for (let x = b.x0 - 1; x <= b.x1 + 1; x++)
      for (let y = b.y0 - 1; y <= b.y1 + 2; y++) {
        if (col.at(x, y)) continue;
        let touch = false;
        for (const [dx, dy] of N8) if (col.at(x + dx, y + dy)) touch = true;
        if (touch) this.nodes.set(keyOf(x, y), { x, y, stand: !!col.at(x, y - 1) });
      }
  }

  node(x, y) {
    return this.nodes.get(keyOf(x, y));
  }

  /** Every node's travel time from a cell. */
  dijkstra(fx, fy) {
    const dist = new Map(),
      prev = new Map();
    const start = this.node(fx, fy);
    if (!start) return { dist, prev };
    const open = [start];
    dist.set(start, 0);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
      const n = open[bi];
      open.splice(bi, 1);
      const d0 = dist.get(n);
      for (const [dx, dy] of N4) {
        const m = this.node(n.x + dx, n.y + dy);
        if (!m) continue;
        const d = d0 + (dy ? 1 / CLIMB_SPEED : 1 / WALK_SPEED) * (m.stand ? 1 : 1.25);
        if (!dist.has(m) || d < dist.get(m)) {
          if (!dist.has(m)) open.push(m);
          dist.set(m, d);
          prev.set(m, n);
        }
      }
    }
    return { dist, prev };
  }

  /** Path to the reachable node that scores best (lower is better), or null. */
  route(c, score) {
    const { dist, prev } = this.dijkstra(c.cx, c.cy);
    let best = null,
      bs = Infinity;
    for (const [n, d] of dist) {
      const s = score(n, d);
      if (s < bs) {
        bs = s;
        best = n;
      }
    }
    if (!best) return null;
    const path = [];
    for (let n = best; n && !(n.x === c.cx && n.y === c.cy); n = prev.get(n)) path.unshift(n);
    return { node: best, path, cost: dist.get(best) };
  }

  snap(c) {
    if (this.node(c.cx, c.cy)) return;
    let best = null,
      bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - c.x, n.y - 0.5 - c.y) + (n.stand ? 0 : 0.6);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (!best) return;
    c.cx = best.x;
    c.cy = best.y;
    c.x = best.x;
    c.y = best.y - 0.5;
    c.path = [];
  }

  // ───────────────────────────── where things are

  local(x, y) {
    const lp = this.game.colony.localPos(x, y);
    return lp;
  }

  world(c, dx = 0, dy = 0) {
    const p = this.game.colony.body.getWorldPoint(new pl.Vec2(c.x + dx, c.y + dy));
    return { x: p.x, y: p.y };
  }

  handPos(c) {
    return this.world(c, c.face * 0.42, 1.12);
  }

  /** The block a colonist is standing on or clinging to: it feels their weight. */
  supportOf(c) {
    const col = this.game.colony;
    if (!col) return null;
    return col.at(c.cx, c.cy - 1) || col.at(c.cx - c.face, c.cy) || col.at(c.cx + c.face, c.cy) || col.at(c.cx, c.cy + 1) || null;
  }

  /** Where a hauled item is set down: a little way inboard of whoever hauled it. */
  landingSpot(c) {
    const col = this.game.colony;
    const ix = Math.round(c.x - c.face);
    let y = c.cy;
    while (col.at(ix, y) && y < c.cy + 6) y++;
    return col.body.getWorldPoint(new pl.Vec2(ix, y - 0.5 + 0.75));
  }

  nodeWorld(n) {
    const p = this.game.colony.body.getWorldPoint(new pl.Vec2(n.x, n.y - 0.5 + 1.1));
    return { x: p.x, y: p.y };
  }

  // ───────────────────────────── orders

  priority(c) {
    if (c.orders.length) return 9;
    return c.job ? RANK[c.job.type] ?? 0 : 0;
  }

  /** Pick who should answer a click: the least busy, nearest crew member. */
  pick(wx, wy, preferred) {
    if (preferred) return preferred;
    let best = null,
      bs = Infinity;
    for (const c of this.list) {
      const p = this.world(c, 0, 1);
      const s = this.priority(c) * 12 + Math.hypot(p.x - wx, p.y - wy);
      if (s < bs) {
        bs = s;
        best = c;
      }
    }
    return best;
  }

  order(c, job) {
    this.abort(c);
    c.orders = [job];
    c.thinkT = 0;
  }

  /** Stop what you're doing: let go of anything promised, put down anything carried. */
  abort(c, keepCarry = false) {
    const j = c.job;
    if (j) {
      if (j.line && !j.line.done) this.game.grapples.release(j.line);
      this.unreserve(j);
      if (j.plan && j.plan.worker === c) j.plan.worker = null;
    }
    c.job = null;
    c.path = [];
    if (c.carry && !keepCarry) this.putDown(c);
  }

  unreserve(j) {
    if (j.reserved) {
      const r = j.reserved;
      if (r.kind === 'pile') r.item.reserved = Math.max(0, (r.item.reserved || 0) - r.units);
      if (r.kind === 'item' && r.chunk.claimed) r.chunk.claimed = null;
      if (j.plan) j.plan.coming.set(r.id, Math.max(0, (j.plan.coming.get(r.id) || 0) - r.units));
      j.reserved = null;
    }
    if (j.item && j.item.claimed) j.item.claimed = null;
  }

  /** Whatever is carried becomes an item on the deck again. */
  putDown(c) {
    const g = this.game;
    const it = c.carry;
    c.carry = null;
    if (!it) return;
    const p = this.world(c, 0, 1.0);
    const ch = g.flotsam.produce(it.mat, it.units, p.x, p.y, { debris: it.debris, crate: it.crate, pts: it.pts });
    const v = g.colony.body.getLinearVelocityFromWorldPoint(new pl.Vec2(p.x, p.y));
    ch.body.setLinearVelocity(v);
    ch.aboard = true;
    ch.aboardT = 1;
  }

  // ───────────────────────────── per step

  update(dt) {
    const g = this.game;
    const col = g.colony;
    if (!col || !this.list.length) return;
    if (col.version !== this.navVersion) {
      this.rebuild();
      for (const c of this.list) {
        this.snap(c);
        if (c.path.some((n) => !this.node(n.x, n.y))) c.path = [];
      }
    }
    for (const c of this.list) {
      c.ex = c.ey = 0;
      c.thinkT -= dt;
      if (!c.job || (c.job.soft && c.thinkT <= 0)) {
        this.think(c);
        c.thinkT = 0.8;
      }
      this.act(c, dt);
      this.weigh(c);
    }
  }

  /** Each colonist's weight (and what they carry) bears down on the block under them. */
  weigh(c) {
    const col = this.game.colony;
    const m = COLONIST_MASS + (c.carry ? cargoMass(c.carry.mat, c.carry.units) : 0);
    const p = this.world(c, 0, 0.1);
    col.body.applyForce(new pl.Vec2(0, -m * G), new pl.Vec2(p.x, p.y), true);
    const blk = this.supportOf(c);
    if (blk) blk.ey -= m * G;
  }

  /** Walk along the current path. Returns true once there. */
  walk(c, dt) {
    if (!c.path.length) {
      c.pose = c.carry ? 'carry' : 'stand';
      return true;
    }
    const n = c.path[0];
    if (!this.node(n.x, n.y)) {
      c.path = [];
      return true;
    }
    const tx = n.x,
      ty = n.y - 0.5;
    const dx = tx - c.x,
      dy = ty - c.y;
    const d = Math.hypot(dx, dy);
    const g = this.game;
    const wp = this.world(c, 0, 0.6);
    const wet = wp.y < g.sea.surfaceY(wp.x, g.time);
    const sp = (Math.abs(dy) > Math.abs(dx) ? CLIMB_SPEED : WALK_SPEED) * (wet ? 0.55 : 1);
    if (Math.abs(dx) > 0.01) c.face = dx > 0 ? 1 : -1;
    c.walkT += dt * sp * 2.2;
    c.pose = Math.abs(dy) > 0.05 || !n.stand ? 'climb' : c.carry ? 'carry' : 'walk';
    if (d <= sp * dt) {
      c.x = tx;
      c.y = ty;
      c.cx = n.x;
      c.cy = n.y;
      c.path.shift();
      return !c.path.length;
    }
    c.x += (dx / d) * sp * dt;
    c.y += (dy / d) * sp * dt;
    return false;
  }

  // ───────────────────────────── deciding

  think(c) {
    if (c.job && !c.job.soft) return;
    if (c.orders.length) {
      if (c.job) this.abort(c, true);
      this.begin(c, c.orders.shift());
      return;
    }
    const cur = c.job;
    const next = this.findBuild(c) || this.findStore(c) || this.findRow(c) || (c.autoFish && this.findFish(c)) || null;
    if (next) {
      if (cur && cur.type === next.type && cur.soft) return;
      if (cur) this.abort(c, true);
      this.begin(c, next);
      return;
    }
    if (!cur) this.begin(c, { type: 'idle', soft: true, t: 2 + Math.random() * 3 });
  }

  begin(c, job) {
    c.job = job;
    job.phase = job.phase || 'start';
    if (job.type === 'build' && job.plan) job.plan.worker = c;
  }

  findBuild(c) {
    const g = this.game;
    const B = g.construction;
    let best = null,
      bs = Infinity;
    const here = { x: c.x, y: c.y };
    for (const plan of B.list()) {
      if (plan.worker && plan.worker !== c) continue;
      if (!B.ready(plan)) continue;
      const d0 = Math.hypot(plan.gx - here.x, plan.gy - here.y);
      if (B.supplied(plan)) {
        if (d0 < bs) {
          bs = d0;
          best = { type: 'build', plan, phase: 'work-walk' };
        }
        continue;
      }
      for (const [id, n] of B.missing(plan)) {
        for (const src of g.cargo.sources(id)) {
          const sp = src.kind === 'pile' ? { x: src.pile.gx, y: src.pile.gy } : this.local(src.chunk.body.getPosition().x, src.chunk.body.getPosition().y);
          const d = Math.hypot(sp.x - here.x, sp.y - here.y) + Math.hypot(plan.gx - sp.x, plan.gy - sp.y);
          if (d < bs) {
            bs = d;
            best = { type: 'build', plan, src, id, units: Math.min(n, src.units), phase: 'fetch-walk' };
          }
        }
      }
    }
    if (best && best.src) {
      const r = { kind: best.src.kind, id: best.id, units: best.units };
      if (best.src.kind === 'pile') {
        r.item = best.src.item;
        r.pile = best.src.pile;
        r.item.reserved = (r.item.reserved || 0) + best.units;
      } else {
        r.chunk = best.src.chunk;
        r.chunk.claimed = c;
      }
      best.reserved = r;
      best.plan.coming.set(best.id, (best.plan.coming.get(best.id) || 0) + best.units);
    }
    return best;
  }

  findStore(c) {
    const g = this.game;
    const piles = g.cargo.piles().filter((p) => g.cargo.room(p) > 0);
    if (!piles.length) return null;
    let best = null,
      bd = Infinity;
    for (const ch of g.flotsam.aboard()) {
      if (ch.claimed) continue;
      const lp = this.local(ch.body.getPosition().x, ch.body.getPosition().y);
      const d = Math.hypot(lp.x - c.x, lp.y - c.y);
      if (d < bd) {
        bd = d;
        best = ch;
      }
    }
    if (!best) return null;
    best.claimed = c;
    return { type: 'store', item: best, phase: 'fetch-walk' };
  }

  findRow(c) {
    const g = this.game;
    if (!g.rowDir) return null;
    return { type: 'row', soft: true, phase: 'walk' };
  }

  /** The nearest thing in the sea that someone standing at the edge could reach. */
  findFish(c) {
    const g = this.game;
    const col = g.colony;
    const cc = col.body.getWorldCenter();
    const edge = [...this.nodes.values()].filter((n) => n.stand);
    let best = null,
      bd = Infinity;
    const consider = (target, p, bonus) => {
      for (const n of edge) {
        const w = this.nodeWorld(n);
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < CAST_REACH - 0.4) {
          const s = d - bonus + Math.hypot(n.x - c.x, n.y - c.y) * 0.3;
          if (s < bd) {
            bd = s;
            best = target;
          }
          return;
        }
      }
    };
    for (const cw of g.world.castaways) if (cw.state === 'waiting' && !cw.hooked) consider({ kind: 'castaway', ref: cw }, { x: cw.x, y: cw.y + 0.5 }, 30);
    for (const ch of g.flotsam.chunks) {
      if (ch.aboard || ch.grabbed || ch.claimed || !ch.body) continue;
      const p = ch.body.getPosition();
      if (Math.abs(p.x - cc.x) > 40) continue;
      consider({ kind: 'chunk', ref: ch }, p, 0);
    }
    if (!best) return null;
    if (best.kind === 'chunk') best.ref.claimed = c;
    return { type: 'fish', target: best, phase: 'walk', soft: false };
  }

  // ───────────────────────────── doing

  act(c, dt) {
    const j = c.job;
    if (!j) {
      this.walk(c, dt);
      return;
    }
    const fn = this['do_' + j.type];
    if (fn) fn.call(this, c, j, dt);
  }

  finish(c) {
    const j = c.job;
    if (j) this.unreserve(j);
    c.job = null;
    c.thinkT = 0;
  }

  do_idle(c, j, dt) {
    if (j.phase === 'start') {
      j.phase = 'wait';
    }
    if (this.walk(c, dt)) {
      j.t -= dt;
      c.pose = 'stand';
      const taken = (x, y, o) => this.list.some((d) => d !== o && d.cx === x && d.cy === y);
      // nobody stands on anyone's toes
      if (taken(c.cx, c.cy, c)) j.t = Math.min(j.t, 0.4);
      if (j.t <= 0) {
        // stretch the legs a little
        const opts = [...this.nodes.values()].filter((n) => n.stand && Math.abs(n.x - c.cx) <= 3 && Math.abs(n.y - c.cy) <= 1 && !taken(n.x, n.y, c));
        const n = opts[Math.floor(Math.random() * opts.length)];
        if (n) {
          const r = this.route(c, (m) => (m === n ? 0 : Infinity));
          if (r) c.path = r.path;
        }
        j.t = 3 + Math.random() * 5;
      }
    }
  }

  do_goto(c, j, dt) {
    if (j.phase === 'start') {
      const r = this.route(c, (n, d) => Math.hypot(n.x - j.cell.x, n.y - j.cell.y) * 4 + d);
      c.path = r ? r.path : [];
      j.phase = 'walk';
    }
    if (this.walk(c, dt)) this.finish(c);
  }

  /** Walk to an edge from which the target can be reached, cast, and wait for the line. */
  do_fish(c, j, dt) {
    const g = this.game;
    const t = j.target;
    const tp = () => g.grapples.targetPos(t);
    const valid = () =>
      t.kind === 'chunk' ? t.ref.body && !t.ref.aboard && !t.ref.dead : t.kind === 'wreck' ? !t.ref.dead && t.ref.list.length > 0 : t.ref.state === 'waiting';
    if (j.phase === 'start') j.phase = 'walk';
    if (j.phase === 'walk') {
      if (!valid()) return this.finish(c);
      const p = tp();
      const r = this.route(c, (n, d) => {
        const w = this.nodeWorld(n);
        const reach = Math.hypot(p.x - w.x, p.y - w.y);
        if (reach > CAST_REACH - 0.3) return Infinity;
        return d + (n.stand ? 0 : 2) + reach * 0.05;
      });
      if (!r) {
        if (t.kind === 'chunk' && t.ref.claimed === c) t.ref.claimed = null;
        if (j.manual) {
          g.progress.missedReach();
          g.log(`${c.name} can't reach that from the raft. ${g.progress.has('crane') ? 'A crane, or building out towards it, would help.' : 'Building out towards it would help.'}`, 'warn');
        }
        return this.finish(c);
      }
      c.path = r.path;
      j.phase = 'walking';
    }
    if (j.phase === 'walking') {
      if (!valid()) return this.finish(c);
      if (!this.walk(c, dt)) return;
      const p = tp();
      const me = this.world(c, 0, 1.1);
      c.face = p.x >= me.x ? 1 : -1;
      if (Math.hypot(p.x - me.x, p.y - me.y) > CAST_REACH + 0.5) {
        j.phase = 'walk';
        return;
      }
      if (g.grapples.hooked(t.ref)) return this.finish(c);
      j.line = g.grapples.launch(c, t, false);
      j.phase = 'line';
      c.pose = 'cast';
      j.castT = 0;
    }
    if (j.phase === 'line') {
      j.castT += dt;
      c.pose = j.line.phase === 'out' || j.castT < 0.35 ? 'cast' : 'reel';
      const p = tp();
      if (p) c.face = p.x >= this.world(c).x ? 1 : -1;
      if (j.line.done) {
        if (t.kind === 'chunk' && t.ref.claimed === c) t.ref.claimed = null;
        this.finish(c);
      }
    }
  }

  /** Pick up a loose item and stow it in a stockpile with room. */
  do_store(c, j, dt) {
    const g = this.game;
    const it = j.item;
    if (j.phase === 'fetch-walk') {
      if (!it.body || !it.aboard) return this.finish(c);
      const p = it.body.getPosition();
      const r = this.route(c, (n, d) => {
        const w = this.nodeWorld(n);
        const near = Math.hypot(p.x - w.x, p.y - w.y + 0.6);
        return near > 1.8 ? Infinity : d + near * 0.2;
      });
      if (!r) return this.finish(c);
      c.path = r.path;
      j.phase = 'fetch';
    }
    if (j.phase === 'fetch') {
      if (!it.body || !it.aboard || it.grabbed) return this.finish(c);
      if (!this.walk(c, dt)) return;
      c.carry = { mat: it.mat, units: it.units, debris: it.debris, crate: it.crate, pts: it.pts };
      g.flotsam.remove(it);
      j.item = null;
      g.emit('sfx', { name: 'pop' });
      j.phase = 'stow-walk';
    }
    if (j.phase === 'stow-walk') {
      const piles = g.cargo.piles().filter((p) => g.cargo.room(p) > 0);
      if (!piles.length) {
        this.putDown(c);
        return this.finish(c);
      }
      const near = new Set();
      for (const p of piles) for (const [dx, dy] of N8) near.add(keyOf(p.gx + dx, p.gy + dy));
      const r = this.route(c, (n, d) => (near.has(keyOf(n.x, n.y)) ? d : Infinity));
      if (!r) {
        this.putDown(c);
        return this.finish(c);
      }
      c.path = r.path;
      j.phase = 'stow';
    }
    if (j.phase === 'stow') {
      if (!this.walk(c, dt)) return;
      let pile = null,
        pd = Infinity;
      for (const p of g.cargo.piles()) {
        const d = Math.max(Math.abs(p.gx - c.cx), Math.abs(p.gy - c.cy));
        if (d <= 1 && g.cargo.room(p) > 0 && d < pd) {
          pd = d;
          pile = p;
        }
      }
      if (!pile) {
        j.phase = 'stow-walk';
        return;
      }
      const n = g.cargo.store(pile, c.carry);
      c.carry.units -= n;
      if (c.carry.units <= 0) c.carry = null;
      else j.phase = 'stow-walk';
      if (!c.carry) {
        g.emit('sfx', { name: 'place', x: this.world(c).x, y: this.world(c).y });
        this.finish(c);
      }
    }
  }

  /** Fetch material for a plan, bring it, and build. */
  do_build(c, j, dt) {
    const g = this.game;
    const B = g.construction;
    const plan = j.plan;
    if (!B.plans.has(keyOf(plan.gx, plan.gy))) {
      if (c.carry) this.putDown(c);
      return this.finish(c);
    }
    if (j.phase === 'fetch-walk') {
      const r = j.reserved;
      let target;
      if (r.kind === 'pile') {
        if (!r.pile.struct) return this.finish(c);
        const near = new Set();
        for (const [dx, dy] of N8) near.add(keyOf(r.pile.gx + dx, r.pile.gy + dy));
        target = this.route(c, (n, d) => (near.has(keyOf(n.x, n.y)) ? d : Infinity));
      } else {
        if (!r.chunk.body) return this.finish(c);
        const p = r.chunk.body.getPosition();
        target = this.route(c, (n, d) => {
          const w = this.nodeWorld(n);
          const near = Math.hypot(p.x - w.x, p.y - w.y + 0.6);
          return near > 1.8 ? Infinity : d + near * 0.2;
        });
      }
      if (!target) return this.finish(c);
      c.path = target.path;
      j.phase = 'fetch';
    }
    if (j.phase === 'fetch') {
      if (!this.walk(c, dt)) return;
      const r = j.reserved;
      let got = 0;
      if (r.kind === 'pile') got = r.pile.struct ? g.cargo.takeFromPile(r.pile, r.id, r.units) : 0;
      else if (r.chunk.body) {
        r.chunk.claimed = null;
        got = g.cargo.takeFromItem(r.chunk, r.units);
      }
      plan.coming.set(r.id, Math.max(0, (plan.coming.get(r.id) || 0) - r.units));
      j.reserved = null;
      if (got <= 0) return this.finish(c);
      c.carry = { mat: r.kind === 'pile' ? r.item.mat : r.chunk.mat, units: got, debris: r.kind === 'item' && r.chunk.debris };
      plan.coming.set(r.id, (plan.coming.get(r.id) || 0) + got);
      j.carryId = r.id;
      j.phase = 'deliver-walk';
    }
    if (j.phase === 'deliver-walk' || j.phase === 'work-walk') {
      const near = new Set();
      for (const [dx, dy] of N8) near.add(keyOf(plan.gx + dx, plan.gy + dy));
      const r = this.route(c, (n, d) => (near.has(keyOf(n.x, n.y)) && !(n.x === plan.gx && n.y === plan.gy) ? d + (n.stand ? 0 : 0.5) : Infinity));
      if (!r) {
        if (c.carry) {
          plan.coming.set(j.carryId, Math.max(0, (plan.coming.get(j.carryId) || 0) - c.carry.units));
          this.putDown(c);
        }
        return this.finish(c);
      }
      c.path = r.path;
      j.phase = j.phase === 'deliver-walk' ? 'deliver' : 'work-go';
    }
    if (j.phase === 'deliver') {
      if (!this.walk(c, dt)) return;
      B.deliver(plan, j.carryId, c.carry.units);
      c.carry = null;
      if (B.supplied(plan)) j.phase = 'work';
      else {
        plan.worker = null;
        return this.finish(c);
      }
      j.t = 0;
    }
    if (j.phase === 'work-go') {
      if (!this.walk(c, dt)) return;
      j.phase = 'work';
      j.t = 0;
    }
    if (j.phase === 'work') {
      c.pose = 'build';
      c.face = plan.gx >= c.x ? 1 : -1;
      j.t += dt;
      if (j.t >= BUILD_TIME) {
        plan.worker = null;
        B.complete(plan);
        this.finish(c);
      }
    }
  }

  /** Go to the edge of the deck and row. */
  do_row(c, j, dt) {
    const g = this.game;
    const col = g.colony;
    if (!g.rowDir) return this.finish(c);
    if (j.phase === 'walk') {
      const stands = [...this.nodes.values()].filter((n) => n.stand);
      if (!stands.length) return this.finish(c);
      const lo = Math.min(...stands.map((n) => n.y));
      const deck = stands.filter((n) => n.y <= lo + 1);
      const xs = deck.map((n) => n.x);
      const ends = new Set([Math.min(...xs), Math.max(...xs)]);
      const r = this.route(c, (n, d) => (n.stand && n.y <= lo + 1 && ends.has(n.x) ? d : Infinity));
      if (!r) return this.finish(c);
      c.path = r.path;
      j.phase = 'go';
    }
    if (j.phase === 'go') {
      if (!this.walk(c, dt)) return;
      j.phase = 'rowing';
      j.t = 0;
    }
    if (j.phase === 'rowing') {
      j.t += dt;
      const b = col.bounds();
      c.face = c.x < (b.x0 + b.x1) / 2 ? -1 : 1;
      c.pose = 'row';
      const stroke = 0.5 + 0.5 * Math.sin(j.t * 3.4);
      const p = this.world(c, c.face * 0.9, -0.4);
      const F = ROW_FORCE * g.rowDir * (0.6 + 0.8 * stroke);
      col.body.applyForce(new pl.Vec2(F, 0), new pl.Vec2(p.x, Math.min(p.y, g.sea.surfaceY(p.x, g.time))), true);
      const blk = this.supportOf(c);
      if (blk) blk.ex += F;
      j.stroke = stroke;
    }
  }

  /** Carry something (an item on deck, or a test cube cut from stores) to the edge and throw it. */
  do_throw(c, j, dt) {
    const g = this.game;
    if (j.phase === 'start') {
      if (j.item) {
        j.phase = 'fetch-walk';
      } else if (j.cube) {
        if (g.cargo.unitsOf(j.cube.id, true) < DROP_COST) {
          g.log(`Not enough ${j.cube.name} aboard to cut a cube.`, 'warn');
          return this.finish(c);
        }
        g.cargo.consume(j.cube.id, DROP_COST);
        c.carry = { mat: j.cube, units: DROP_COST, cube: true };
        j.phase = 'edge-walk';
      }
    }
    if (j.phase === 'fetch-walk') {
      const it = j.item;
      if (!it.body || !it.aboard) return this.finish(c);
      const p = it.body.getPosition();
      const r = this.route(c, (n, d) => {
        const w = this.nodeWorld(n);
        const near = Math.hypot(p.x - w.x, p.y - w.y + 0.6);
        return near > 1.8 ? Infinity : d + near * 0.2;
      });
      if (!r) return this.finish(c);
      c.path = r.path;
      j.phase = 'fetch';
    }
    if (j.phase === 'fetch') {
      const it = j.item;
      if (!it.body || !it.aboard) return this.finish(c);
      if (!this.walk(c, dt)) return;
      c.carry = { mat: it.mat, units: it.units, debris: it.debris, crate: it.crate, pts: it.pts };
      g.flotsam.remove(it);
      j.item = null;
      j.phase = 'edge-walk';
    }
    if (j.phase === 'edge-walk') {
      const tgt = j.target;
      const r = this.route(c, (n, d) => {
        if (!n.stand) return Infinity;
        const w = this.nodeWorld(n);
        const col = g.colony;
        const out = col.at(n.x + Math.sign(tgt.x - w.x), n.y) || col.at(n.x + Math.sign(tgt.x - w.x), n.y - 1);
        return d + Math.hypot(tgt.x - w.x, tgt.y - w.y) * 0.4 + (out ? 6 : 0);
      });
      if (!r) {
        this.putDown(c);
        return this.finish(c);
      }
      c.path = r.path;
      j.phase = 'edge';
    }
    if (j.phase === 'edge') {
      if (!this.walk(c, dt)) return;
      const hand = this.world(c, 0, 1.4);
      c.face = j.target.x >= hand.x ? 1 : -1;
      c.pose = 'throw';
      j.t = (j.t || 0) + dt;
      if (j.t < 0.3) return;
      const it = c.carry;
      c.carry = null;
      if (!it) return this.finish(c);
      const T = Math.max(0.5, Math.min(1.3, Math.hypot(j.target.x - hand.x, j.target.y - hand.y) / 8));
      const vx = (j.target.x - hand.x) / T;
      const vy = (j.target.y - hand.y + 0.5 * G * T * T) / T;
      const v0 = g.colony.body.getLinearVelocityFromWorldPoint(new pl.Vec2(hand.x, hand.y));
      if (it.cube) g.experiments.drop(it.mat, hand.x, hand.y, { free: true, vx: v0.x + vx, vy: v0.y + vy });
      else {
        const ch = g.flotsam.produce(it.mat, it.units, hand.x, hand.y, { debris: it.debris, crate: it.crate, pts: it.pts, vx: v0.x + vx, vy: v0.y + vy });
        ch.thrown = g.time;
      }
      g.emit('sfx', { name: 'grappleFire', x: hand.x, y: hand.y });
      this.finish(c);
    }
  }
}

export { RANK };
