import { pl, boxVerts } from './physics.js';
import { FUNCS, SWELL_GAIN, PROPELLANT_MASS } from './config.js';

let BLOCK_ID = 1;
let EDGE_ID = 1;

export const CAT_STRUCT = 0x0002;
export const CAT_CHUNK = 0x0004;

export const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function keyOf(gx, gy) {
  return (gx + 1024) * 2048 + (gy + 1024);
}

export function blockMass(b) {
  const fn = FUNCS[b.fn];
  let m = b.mat.d * fn.fill * (1 + SWELL_GAIN * b.swell) + fn.equip;
  if (b.flooded) m += (b.floodRho || 1) * (1 - fn.fill) * 0.85;
  if (b.fuel) m += b.fuel * PROPELLANT_MASS;
  return m;
}

export function blockStrength(b) {
  return b.mat.s * FUNCS[b.fn].sMul;
}

export class Structure {
  constructor(game, kind, body) {
    this.game = game;
    this.kind = kind;
    this.body = body;
    this.blocks = new Map();
    this.list = [];
    this.version = 0;
    this.solver = null;
    this.dead = false;
    body.setUserData({ kind, struct: this, wetFrac: 0 });
  }

  at(gx, gy) {
    return this.blocks.get(keyOf(gx, gy));
  }

  get size() {
    return this.list.length;
  }

  addBlock(gx, gy, fn, mat, extra = {}) {
    const b = {
      id: BLOCK_ID++,
      gx,
      gy,
      fn,
      mat,
      edges: [null, null, null, null],
      fixture: null,
      struct: this,
      swell: 0,
      flooded: false,
      floodRho: 1,
      fuel: 0,
      fx: 0,
      fy: 0,
      ex: 0,
      ey: 0,
      wet: 0,
      layer: -1,
      exposure: 0,
      corroding: false,
      phiV: 0,
      phiL: 0,
      state: {},
      born: this.game ? this.game.time : 0,
      ...extra,
    };
    this.blocks.set(keyOf(gx, gy), b);
    this.list.push(b);
    this.attachFixture(b);
    for (let d = 0; d < 4; d++) {
      const nb = this.at(gx + DIRS[d][0], gy + DIRS[d][1]);
      if (nb && !nb.edges[(d + 2) % 4]) this.link(b, nb, d);
    }
    this.version++;
    return b;
  }

  link(b, nb, d) {
    const lower = d === 0 || d === 1 ? b : nb;
    const upper = lower === b ? nb : b;
    const e = {
      id: EDGE_ID++,
      a: lower,
      b: upper,
      vertical: d === 1 || d === 3,
      damage: 0,
      stress: 0,
      fv: 0,
      fl: 0,
      fvS: 0,
      flS: 0,
      crackVis: 0,
      seed: Math.random() * 1000,
      broken: false,
    };
    const dl = e.vertical ? 1 : 0;
    lower.edges[dl] = e;
    upper.edges[dl + 2] = e;
    return e;
  }

  unlink(e) {
    const dl = e.vertical ? 1 : 0;
    if (e.a.edges[dl] === e) e.a.edges[dl] = null;
    if (e.b.edges[dl + 2] === e) e.b.edges[dl + 2] = null;
    e.broken = true;
    this.version++;
  }

  attachFixture(b) {
    const mass = blockMass(b);
    b.mass = mass;
    const fx = this.body.createFixture({
      shape: new pl.Box(0.5, 0.5, new pl.Vec2(b.gx, b.gy), 0),
      density: mass,
      friction: 0.75,
      restitution: 0.04,
      filterCategoryBits: CAT_STRUCT,
      filterMaskBits: this.ghostMask || 0xffff,
    });
    fx.setUserData({ owner: b, lv: boxVerts(b.gx, b.gy), n: 4, area: 1, currentMul: 1 });
    b.fixture = fx;
  }

  refreshMass(b) {
    const m = blockMass(b);
    if (Math.abs(m - b.mass) < 1e-4) return;
    b.mass = m;
    b.fixture.setDensity(m);
    this.massDirty = true;
  }

  syncMass() {
    if (this.massDirty) {
      this.body.resetMassData();
      this.massDirty = false;
    }
  }

  removeBlock(b) {
    for (let d = 0; d < 4; d++) if (b.edges[d]) this.unlink(b.edges[d]);
    this.blocks.delete(keyOf(b.gx, b.gy));
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
    if (b.fixture) this.body.destroyFixture(b.fixture);
    b.fixture = null;
    b.struct = null;
    this.version++;
  }

  edges() {
    const out = [];
    for (const b of this.list) {
      if (b.edges[0]) out.push(b.edges[0]);
      if (b.edges[1]) out.push(b.edges[1]);
    }
    return out;
  }

  worldPos(gx, gy) {
    const p = this.body.getWorldPoint(new pl.Vec2(gx, gy));
    return { x: p.x, y: p.y };
  }

  localPos(x, y) {
    const p = this.body.getLocalPoint(new pl.Vec2(x, y));
    return { x: p.x, y: p.y };
  }

  components(rootFn) {
    const seen = new Set();
    const comps = [];
    const order = rootFn ? [rootFn(this), ...this.list] : this.list;
    for (const start of order) {
      if (!start || seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const b = stack.pop();
        comp.push(b);
        for (let d = 0; d < 4; d++) {
          const e = b.edges[d];
          if (!e) continue;
          const o = e.a === b ? e.b : e.a;
          if (!seen.has(o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  detach(blocks, kind) {
    const body = this.body;
    const nb = this.game.physics.createBody(body.getPosition().x, body.getPosition().y, body.getAngle(), null);
    const s = new Structure(this.game, kind, nb);
    const moving = new Set(blocks);
    for (const b of blocks) {
      for (let d = 0; d < 4; d++) {
        const e = b.edges[d];
        if (!e) continue;
        const o = e.a === b ? e.b : e.a;
        if (!moving.has(o)) this.unlink(e);
      }
    }
    for (const b of blocks) {
      this.blocks.delete(keyOf(b.gx, b.gy));
      const i = this.list.indexOf(b);
      if (i >= 0) this.list.splice(i, 1);
      body.destroyFixture(b.fixture);
      b.fixture = null;
      b.struct = s;
      s.blocks.set(keyOf(b.gx, b.gy), b);
      s.list.push(b);
      s.attachFixture(b);
    }
    this.version++;
    s.version++;
    const wc = nb.getWorldCenter();
    nb.setLinearVelocity(body.getLinearVelocityFromWorldPoint(wc));
    nb.setAngularVelocity(body.getAngularVelocity());
    return s;
  }

  setPassThrough(on) {
    this.ghostMask = on ? 0xffff & ~CAT_STRUCT : 0xffff;
    for (let f = this.body.getFixtureList(); f; f = f.getNext()) f.setFilterData({ groupIndex: 0, categoryBits: CAT_STRUCT, maskBits: this.ghostMask });
  }

  totalMass() {
    let m = 0;
    for (const b of this.list) m += b.mass;
    return m;
  }

  bounds() {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const b of this.list) {
      if (b.gx < x0) x0 = b.gx;
      if (b.gx > x1) x1 = b.gx;
      if (b.gy < y0) y0 = b.gy;
      if (b.gy > y1) y1 = b.gy;
    }
    return { x0, x1, y0, y1 };
  }
}
