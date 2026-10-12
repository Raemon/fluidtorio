import { pl } from './physics.js';
import { Rng } from './rng.js';
import { Structure, CAT_STRUCT } from './structure.js';
import { chunkShape, polyArea } from './flotsam.js';
import { WORLD_HALF_WIDTH } from './config.js';

const CASTAWAY_NAMES = ['Bo', 'Cass', 'Dov', 'Esme', 'Finn', 'Gale'];

/**
 * The wider sea: where things are. Each site keeps a finite supply of flotsam drifting near it,
 * so what you can build depends on where you've been. Some sites have a castaway waiting.
 */
export class World {
  constructor(game) {
    this.game = game;
    this.sites = [];
    this.castaways = [];
    this.islands = [];
    this.rocks = [];
    this.flareSeen = null;
    this.spawnT = 0;
    this.layout();
  }

  /** Decide, from the seed, what is where. */
  layout() {
    const g = this.game;
    const r = new Rng(g.seed ^ 0x51735);
    const mats = g.planet.materials;
    const by = (cat) => mats.filter((m) => m.cat === cat).sort((a, b) => a.d - b.d);
    const floats = by('float'),
      i12 = by('i12'),
      i23 = by('i23'),
      sinks = by('sink');
    const side = r.sign();
    const used = new Set();
    const take = (...ms) => {
      const out = ms.filter(Boolean);
      for (const m of out) used.add(m.id);
      return out;
    };
    this.sites = [
      { key: 'start', kind: 'wreckfield', x: 0, mats: take(floats[0]), debris: 16, name: 'the crash site' },
      { key: 'pod', kind: 'pod', x: side * r.range(36, 46), mats: [], debris: 10, castaway: true, name: 'the escape pod' },
      { key: 'pumice', kind: 'pumice', x: -side * r.range(100, 130), mats: take(floats[1] || floats[0], i12[0]), name: 'the pumice raft' },
      { key: 'stack', kind: 'stack', x: side * r.range(190, 235), mats: take(sinks[0], i23[0]), castaway: true, name: 'the basalt stack' },
      { key: 'far', kind: 'wreck', x: -side * r.range(280, 330), mats: [], debris: 14, castaway: true, name: 'the far wreck' },
    ];
    const far = this.sites[4];
    for (const m of mats) if (!used.has(m.id)) far.mats.push(m);
    if (!far.mats.length) far.mats.push(i12[1] || i23[1] || floats[0]);
    for (const s of this.sites) {
      s.pool = new Map(s.mats.map((m) => [m.id, m.cat === 'sink' ? 22 : 30]));
      s.debrisPool = s.debris || 0;
    }
  }

  site(key) {
    return this.sites.find((s) => s.key === key);
  }

  // ───────────────────────────── building the places

  build() {
    const g = this.game;
    const r = new Rng(g.seed ^ 0x9a11);
    let names = 0;
    for (const s of this.sites) {
      if (s.kind === 'pod' || s.kind === 'wreck') this.buildPod(s, s.kind === 'wreck' ? 5 : 3, r);
      if (s.kind === 'pumice') this.buildPumice(s, r);
      if (s.kind === 'stack') this.buildStack(s, r);
      if (s.castaway) {
        const cw = { id: names, name: CASTAWAY_NAMES[names++ % CASTAWAY_NAMES.length], site: s, state: 'waiting', x: s.x, y: 1, flareT: s.key === 'pod' ? 22 : 30 + r.range(0, 30), wave: 0, attach: s.perch };
        this.castaways.push(cw);
      }
    }
    this.place();
  }

  /** A broken-off piece of a lander, still floating, held by a sea anchor. */
  buildPod(s, n, r) {
    const g = this.game;
    const body = g.physics.createBody(s.x, 0.4, 0, null);
    const st = new Structure(g, 'island', body);
    const S = g.planet.salvage;
    const half = Math.floor(n / 2);
    for (let i = -half; i <= n - half - 1; i++) st.addBlock(i, 0, 'hollow', S);
    st.addBlock(-half, 1, 'frame', S);
    body.resetMassData();
    g.structures.push(st);
    s.struct = st;
    s.perch = { body, lx: half - 0.2, ly: 0.5 };
    this.islands.push({ kind: 'pod', site: s, body, struct: st, anchorX: s.x });
  }

  /** A raft of floating stone: you can't fish it, but things wash up on it. */
  buildPumice(s, r) {
    const g = this.game;
    const mat = s.mats[0];
    const pts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rx = 4.6 + r.range(-0.5, 0.6),
        ry = 1.5 + r.range(-0.25, 0.3);
      pts.push([Math.cos(a) * rx, Math.sin(a) * ry * (Math.sin(a) > 0 ? 0.7 : 1.15)]);
    }
    // planck wants convex pieces: fan the outline into triangles around the centre
    const body = g.physics.createBody(s.x, 0.2, 0, null);
    for (let i = 0; i < n; i++) {
      const p = pts[i],
        q = pts[(i + 1) % n];
      const tri = [[0, 0], p, q];
      const fx = body.createFixture({ shape: new pl.Polygon(tri.map((v) => new pl.Vec2(v[0], v[1]))), density: mat.d * 0.85, friction: 0.9, filterCategoryBits: CAT_STRUCT });
      const lv = new Float64Array(6);
      tri.forEach((v, k) => {
        lv[2 * k] = v[0];
        lv[2 * k + 1] = v[1];
      });
      fx.setUserData({ owner: null, island: true, lv, n: 3, area: polyArea(tri), currentMul: 1 });
    }
    body.setUserData({ kind: 'island', wetFrac: 0 });
    s.perch = { body, lx: 0, ly: 1.2 };
    this.islands.push({ kind: 'pumice', site: s, body, pts, mat, anchorX: s.x });
  }

  /** A basalt column standing on the sea floor: it doesn't float, and it doesn't move. */
  buildStack(s, r) {
    const g = this.game;
    const floor = g.physics.floorAt(s.x) - 1;
    const top = r.range(3, 4.5);
    const levels = [floor, floor * 0.7, floor * 0.42, floor * 0.18, 0, top];
    const widths = [9.5, 7.2, 8.4, 6.6, 6.2, 4.4].map((w) => w + r.range(-0.6, 0.6));
    const offs = widths.map(() => r.range(-0.7, 0.7));
    const body = g.physics.world.createBody({ type: 'static', position: new pl.Vec2(s.x, 0) });
    const left = [],
      right = [];
    for (let i = 0; i < levels.length; i++) {
      left.push([offs[i] - widths[i] / 2, levels[i]]);
      right.push([offs[i] + widths[i] / 2, levels[i]]);
    }
    for (let i = 0; i < levels.length - 1; i++) {
      const quad = [left[i], right[i], right[i + 1], left[i + 1]];
      body.createFixture({ shape: new pl.Polygon(quad.map((v) => new pl.Vec2(v[0], v[1]))), friction: 0.95, filterCategoryBits: CAT_STRUCT });
    }
    body.setUserData({ kind: 'rock' });
    const outline = [...left, ...right.slice().reverse()];
    s.perch = { body, lx: offs[offs.length - 1], ly: top };
    s.ledges = levels.slice(1, -1).map((y, i) => ({ y, x0: left[i + 1][0], x1: right[i + 1][0] }));
    this.rocks.push({ site: s, body, outline, x: s.x });
  }

  // ───────────────────────────── flotsam supply

  place() {
    const g = this.game;
    for (const s of this.sites) {
      const first = s.key === 'start';
      const nd = Math.min(s.debrisPool, first ? 5 : 4);
      for (let i = 0; i < nd; i++) this.spawnDebris(s, first ? 6 + i * 3.2 : null);
      for (const m of s.mats) {
        const n = first ? 5 : m.cat === 'sink' ? 6 : 5;
        for (let i = 0; i < n; i++) this.spawnMat(s, m, first ? 7 + i * 3 : null);
      }
    }
    // a couple of crates from the lander's hold, already aboard
    const col = g.colony;
    if (col && !g.sandbox) {
      for (const [lx, h] of [
        [-2.6, 1.0],
        [2.4, 0.9],
      ]) {
        const p = col.body.getWorldPoint(new pl.Vec2(lx, 0.5 + h / 2 + 0.02));
        const c = g.flotsam.spawn(g.planet.salvage, p.x, p.y, { crate: true, w: 1.25, h, angle: 0, units: 8 });
        c.aboard = true;
        c.aboardT = 2;
      }
    }
  }

  spawnDebris(s, dist) {
    const g = this.game;
    if (s.debrisPool <= 0) return null;
    s.debrisPool--;
    const d = dist ?? 5 + Math.random() * 20;
    const x = s.x + (Math.random() < 0.5 ? -1 : 1) * d;
    return g.flotsam.spawn(g.planet.salvage, x, 0.3, { size: 0.42 + Math.random() * 0.22, debris: true, site: s });
  }

  spawnMat(s, m, dist) {
    const g = this.game;
    const left = s.pool.get(m.id) || 0;
    if (left <= 0) return null;
    s.pool.set(m.id, left - 1);
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    let x, y;
    if (m.cat === 'sink') {
      x = s.x + sideSign * (dist ?? 3 + Math.random() * 14);
      y = g.physics.floorAt(x) + 0.9;
    } else {
      x = s.x + sideSign * (dist ?? 4 + Math.random() * 22);
      y = g.flotsam.restY(m);
      if (s.kind === 'pumice' && m.d < g.planet.layers[3].rho && Math.random() < 0.4) {
        x = s.x + (Math.random() - 0.5) * 6;
        y = 2.2;
      }
    }
    return g.flotsam.spawn(m, x, y, { site: s });
  }

  nearCount(s, test) {
    let n = 0;
    for (const c of this.game.flotsam.chunks) {
      if (c.aboard || !c.body || c.site !== s || !test(c)) continue;
      if (Math.abs(c.body.getPosition().x - s.x) < 40) n++;
    }
    return n;
  }

  update(dt) {
    const g = this.game;
    // floating islands ride sea anchors
    for (const isl of this.islands) {
      const b = isl.body;
      const wc = b.getWorldCenter();
      const v = b.getLinearVelocity();
      const M = b.getMass();
      b.applyForceToCenter(new pl.Vec2(-M * (0.5 * (wc.x - isl.anchorX) + 1.2 * v.x), 0), true);
    }
    // sites top up their flotsam while their supply lasts
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 2.5;
      for (const s of this.sites) {
        if (s.debrisPool > 0 && this.nearCount(s, (c) => c.debris) < 4 && Math.random() < 0.5) this.spawnDebris(s);
        for (const m of s.mats) if ((s.pool.get(m.id) || 0) > 0 && this.nearCount(s, (c) => c.mat === m && !c.debris) < (m.cat === 'sink' ? 5 : 4) && Math.random() < 0.45) this.spawnMat(s, m);
      }
    }
    // castaways keep their perch, and fire flares
    const col = g.colony;
    const cx = col ? col.body.getWorldCenter().x : 0;
    for (const cw of this.castaways) {
      if (cw.state !== 'waiting') continue;
      if (cw.attach) {
        const p = cw.attach.body.getWorldPoint(new pl.Vec2(cw.attach.lx, cw.attach.ly));
        cw.x = p.x;
        cw.y = p.y;
      }
      cw.wave = Math.abs(cw.x - cx) < 34 ? cw.wave + dt : 0;
      cw.flareT -= dt;
      if (cw.flareT <= 0 && Math.abs(cw.x - cx) < 140) {
        cw.seen = true;
        cw.flareT = 34 + Math.random() * 14;
        g.fx.push({ type: 'flare', x: cw.x, y: cw.y + 1.4, dir: Math.sign(cw.x - cx) || 1 });
        g.emit('sfx', { name: 'tremorWarn', x: cw.x, y: cw.y });
        if (!this.flareSeen) {
          this.flareSeen = cw;
          g.log(`A flare goes up, far to the ${cw.x > cx ? 'east' : 'west'}. Someone is alive out there.`, 'good');
        }
      }
    }
  }

  castawayHooked(cw) {
    cw.state = 'hooked';
    cw.attach = null;
  }

  /** Hauled in on a line: one more pair of hands. */
  rescue(cw, owner) {
    const g = this.game;
    cw.state = 'rescued';
    const spot = g.grapples.landingSpot(owner);
    const lp = g.colony.localPos(spot.x, spot.y);
    const c = g.colonists.spawn(Math.round(lp.x), Math.round(lp.y + 0.2), cw.name);
    c.autoFish = false;
    g.stats.rescued = (g.stats.rescued || 0) + 1;
    g.log(`${cw.name} is aboard, soaked and grinning. One more pair of hands.`, 'good');
    g.emit('sfx', { name: 'win', x: spot.x, y: spot.y });
    g.emit('rescue', c);
  }

  /** What site is nearest the colony, and how far? */
  nearest(x) {
    let best = null,
      bd = Infinity;
    for (const s of this.sites) {
      const d = Math.abs(s.x - x);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { site: best, d: bd };
  }

  clampX(x) {
    return Math.max(-WORLD_HALF_WIDTH + 10, Math.min(WORLD_HALF_WIDTH - 10, x));
  }
}

export { chunkShape };
