import { FUNCS, SWELL_GAIN, PROPELLANT_MASS, G, ENGINE_THRUST, ENGINE_BURN, TANK_CAPACITY, ESCAPE_SPEED } from './config.js';
import { predictStress } from './stress.js';
import { AIR_QUAD } from './physics.js';
import { SURFACE } from './sea.js';

function massWith(b, d) {
  const fn = FUNCS[b.fn];
  let m = d * fn.fill * (1 + SWELL_GAIN * (b.swell || 0)) + fn.equip;
  if (b.flooded) m += (b.floodRho || 1) * (1 - fn.fill) * 0.85;
  if (b.fuel) m += b.fuel * PROPELLANT_MASS;
  return m;
}

/** A detached copy of a structure (plus optional extra blocks) that the stress solver can chew on. */
export function virtualStructure(struct, extras = [], filter = null) {
  const blocks = new Map();
  const list = [];
  const key = (x, y) => (x + 1024) * 2048 + (y + 1024);
  const copy = (b) => {
    const v = {
      gx: b.gx,
      gy: b.gy,
      fn: b.fn,
      mat: b.mat,
      fx: b.fx || 0,
      fy: b.fy || 0,
      ex: b.ex || 0,
      ey: b.ey || 0,
      swell: b.swell || 0,
      flooded: !!b.flooded,
      floodRho: b.floodRho,
      fuel: b.fuel || 0,
      edges: [null, null, null, null],
      ghost: !!b.ghost,
      src: b.src || b,
      mass: b.mass,
    };
    blocks.set(key(v.gx, v.gy), v);
    list.push(v);
    return v;
  };
  for (const b of struct.list) if (!filter || filter(b)) copy(b);
  for (const b of extras) copy(b);
  const edges = [];
  const link = (a, c, vertical, src) => {
    const e = { a, b: c, vertical, fvS: 0, flS: 0, src };
    a.edges[vertical ? 1 : 0] = e;
    c.edges[vertical ? 3 : 2] = e;
    edges.push(e);
  };
  for (const v of list) {
    const r = blocks.get(key(v.gx + 1, v.gy));
    const u = blocks.get(key(v.gx, v.gy + 1));
    if (r) {
      const real = v.src.edges && v.src.edges[0];
      if (v.ghost || r.ghost || (real && (real.b === r.src))) link(v, r, false, real || null);
    }
    if (u) {
      const real = v.src.edges && v.src.edges[1];
      if (v.ghost || u.ghost || (real && real.b === u.src)) link(v, u, true, real || null);
    }
  }
  return {
    list,
    body: struct.body,
    version: 1,
    solver: null,
    edges: () => edges,
  };
}

/** Rough fluid force on a hypothetical block at a body-local cell, using the current pose. */
export function ghostFluid(game, struct, gx, gy) {
  const p = struct.worldPos(gx, gy);
  const t = game.time;
  const surf = game.sea.surfaceY(p.x, t);
  const wet = Math.max(0, Math.min(1, surf - (p.y - 0.5)));
  if (wet <= 0) return 0;
  const k = Math.max(SURFACE, Math.min(5, game.sea.layerAt(p.x, Math.min(p.y, surf - 0.01), t)));
  return game.planet.layers[k].rho * wet * G;
}

function scenario(game, which) {
  const kn = game.knowledge;
  const dWhich = which === 'pess' ? 'hi' : 'lo';
  const sWhich = which === 'pess' ? 'lo' : 'hi';
  return {
    mass: (b) => massWith(b, kn.estimateDensity(b.mat, dWhich)),
    strength: (b) => kn.estimateStrength(b.mat, sWhich) * FUNCS[b.fn].sMul,
  };
}

/**
 * For each joint: the stress ratio in the worst case and best case consistent with what you know.
 * Returns Map(edge -> {lo, hi, ghost}) keyed by the virtual edge (with .src pointing at the real one).
 */
export function predictJoints(game, struct, extras = []) {
  if (!struct || struct.list.length + extras.length < 2) return [];
  const v = virtualStructure(struct, extras);
  const pess = scenario(game, 'pess');
  const opt = scenario(game, 'opt');
  const hi = predictStress(v, pess.mass, pess.strength);
  const v2 = virtualStructure(struct, extras);
  const lo = predictStress(v2, opt.mass, opt.strength);
  const out = [];
  const e1 = v.edges(),
    e2 = v2.edges();
  for (let i = 0; i < e1.length; i++) {
    const e = e1[i];
    out.push({
      a: e.a,
      b: e.b,
      vertical: e.vertical,
      src: e.src,
      ghost: e.a.ghost || e.b.ghost,
      hi: hi.get(e) || 0,
      lo: lo.get(e2[i]) || 0,
    });
  }
  return out;
}

export function classify(p) {
  if (p.hi < 0.8) return 'safe';
  if (p.lo > 1) return 'fail';
  return 'risk';
}

export function colonyStatus(game) {
  const col = game.colony;
  if (!col) return null;
  const t = game.time;
  let mass = 0,
    capacity = 0,
    wet = 0;
  for (const b of col.list) {
    mass += b.mass;
    const p = col.worldPos(b.gx, b.gy);
    const k = Math.max(SURFACE, Math.min(5, game.sea.layerAt(p.x, Math.min(p.y, game.sea.surfaceY(p.x, t) - 0.01), t)));
    capacity += game.planet.layers[k].rho;
    wet += b.wet;
  }
  const ang = col.body.getAngle();
  return { mass, reserve: capacity - mass, heel: ((ang + Math.PI) % (2 * Math.PI)) - Math.PI, blocks: col.list.length };
}

/** Flight forecast for the rocket currently stacked on the pads. */
export function predictRocket(game) {
  const v = game.rocket.validate();
  const blocks = v.blocks;
  if (!blocks.length || !v.engines.length) return { ready: false, reason: v.reason };
  const kn = game.knowledge;
  const tanks = v.tanks.length;
  const fuel = Math.min(tanks * TANK_CAPACITY, game.stockOf('prop'));
  const per = tanks ? fuel / tanks : 0;
  const cap = tanks * TANK_CAPACITY;
  const thrust = v.engines.length * ENGINE_THRUST;
  const burn = v.engines.length * ENGINE_BURN;
  const massOf = (which) =>
    blocks.reduce((a, b) => a + massWith({ ...b, fuel: b.fn === 'tank' ? per : 0 }, kn.estimateDensity(b.mat, which)), 0);
  const mLo = massOf('lo'),
    mHi = massOf('hi');
  const fly = (m0) => {
    let m = m0,
      vv = 0,
      f = fuel,
      vmax = 0;
    const dt = 0.05;
    if (thrust / m0 - G <= 0) return { vmax: 0, liftoff: false };
    while (f > 0) {
      const used = Math.min(f, burn * dt);
      f -= used;
      m -= used * PROPELLANT_MASS;
      vv += (thrust / m - G - (AIR_QUAD * blocks.length * vv * Math.abs(vv)) / m) * dt;
      vmax = Math.max(vmax, vv);
    }
    return { vmax, liftoff: true };
  };
  const best = fly(mLo),
    worst = fly(mHi);
  const rs = blocks.map((b) => ({ ...b, fuel: b.fn === 'tank' ? per : 0, src: b }));
  const fake = { list: rs, body: { getAngle: () => 0, getPosition: () => ({ x: 0, y: 0 }) } };
  for (const b of rs) {
    b.fx = 0;
    b.fy = 0;
    b.ex = 0;
    b.ey = b.fn === 'engine' ? ENGINE_THRUST : 0;
  }
  let sHi = 0,
    sLo = 0;
  for (const phase of ['full', 'empty']) {
    if (phase === 'empty') for (const b of rs) if (b.fn === 'tank') b.fuel = 0;
    const vs = virtualStructure(fake, [], null);
    const vs2 = virtualStructure(fake, [], null);
    const pess = scenario(game, 'pess'),
      opt = scenario(game, 'opt');
    const hi = predictStress(vs, pess.mass, pess.strength);
    const lo = predictStress(vs2, opt.mass, opt.strength);
    for (const x of hi.values()) sHi = Math.max(sHi, x);
    for (const x of lo.values()) sLo = Math.max(sLo, x);
  }
  return {
    ready: v.ok,
    reason: v.reason,
    engines: v.engines.length,
    tanks,
    fuel,
    cap,
    mLo,
    mHi,
    twrLo: thrust / (mHi * G),
    twrHi: thrust / (mLo * G),
    vLo: worst.vmax,
    vHi: best.vmax,
    escape: ESCAPE_SPEED,
    stressLo: sLo,
    stressHi: sHi,
  };
}
