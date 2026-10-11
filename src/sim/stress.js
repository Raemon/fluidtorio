import { G, SHEAR, LATERAL_WEIGHT } from './config.js';
import { blockStrength } from './structure.js';

function buildTopology(struct) {
  const list = struct.list;
  const n = list.length;
  list.forEach((b, i) => (b.idx = i));
  const edges = struct.edges();
  const m = edges.length;
  const ei = new Int32Array(m);
  const ej = new Int32Array(m);
  const wv = new Float64Array(m);
  const wl = new Float64Array(m);
  const dv = new Float64Array(n);
  const dl = new Float64Array(n);
  for (let k = 0; k < m; k++) {
    const e = edges[k];
    ei[k] = e.a.idx;
    ej[k] = e.b.idx;
    wv[k] = e.vertical ? 1 : LATERAL_WEIGHT;
    wl[k] = e.vertical ? LATERAL_WEIGHT : 1;
    dv[ei[k]] += wv[k];
    dv[ej[k]] += wv[k];
    dl[ei[k]] += wl[k];
    dl[ej[k]] += wl[k];
  }
  return {
    version: struct.version,
    n,
    m,
    edges,
    ei,
    ej,
    wv,
    wl,
    dv,
    dl,
    bv: new Float64Array(n),
    bl: new Float64Array(n),
    xv: new Float64Array(n),
    xl: new Float64Array(n),
    r: new Float64Array(n),
    z: new Float64Array(n),
    p: new Float64Array(n),
    ap: new Float64Array(n),
  };
}

function applyL(T, w, x, out) {
  out.fill(0);
  const { ei, ej, m } = T;
  for (let k = 0; k < m; k++) {
    const i = ei[k],
      j = ej[k];
    const f = w[k] * (x[i] - x[j]);
    out[i] += f;
    out[j] -= f;
  }
}

function cg(T, w, diag, b, x, iters = 120, tol = 1e-5) {
  const n = T.n;
  const { r, z, p, ap } = T;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += b[i];
  mean /= n || 1;
  let bn = 0;
  for (let i = 0; i < n; i++) {
    b[i] -= mean;
    bn += b[i] * b[i];
  }
  bn = Math.sqrt(bn);
  if (bn < 1e-9) {
    x.fill(0);
    return 0;
  }
  applyL(T, w, x, ap);
  let rz = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - ap[i];
    z[i] = diag[i] > 0 ? r[i] / diag[i] : 0;
    p[i] = z[i];
    rz += r[i] * z[i];
  }
  let it = 0;
  for (; it < iters; it++) {
    applyL(T, w, p, ap);
    let pap = 0;
    for (let i = 0; i < n; i++) pap += p[i] * ap[i];
    if (Math.abs(pap) < 1e-14) break;
    const alpha = rz / pap;
    let rn = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
      rn += r[i] * r[i];
    }
    if (Math.sqrt(rn) < tol * bn) break;
    let rz2 = 0;
    for (let i = 0; i < n; i++) {
      z[i] = diag[i] > 0 ? r[i] / diag[i] : 0;
      rz2 += r[i] * z[i];
    }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return it;
}

export function topology(struct) {
  if (!struct.solver || struct.solver.version !== struct.version) {
    const old = struct.solver;
    struct.solver = buildTopology(struct);
    if (old) {
      for (const b of struct.list) {
        struct.solver.xv[b.idx] = b.phiV || 0;
        struct.solver.xl[b.idx] = b.phiL || 0;
      }
    }
  }
  return struct.solver;
}

/**
 * Body-frame load injections, using the true per-block forces from the physics pass.
 * Each block carries gravity + fluid force + any external force. Subtracting the rigid-body
 * acceleration makes them sum to zero, so they can be routed through the joints.
 */
export function computeInjections(struct, massOf = (b) => b.mass, fluidScale = null) {
  const T = topology(struct);
  const body = struct.body;
  const ang = body.getAngle();
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const pos = body.getPosition();
  const list = struct.list;
  const n = list.length;
  let M = 0,
    cx = 0,
    cy = 0,
    Fx = 0,
    Fy = 0;
  const wx = new Float64Array(n),
    wy = new Float64Array(n),
    fxA = new Float64Array(n),
    fyA = new Float64Array(n),
    mA = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = list[i];
    const m = massOf(b);
    mA[i] = m;
    const px = pos.x + c * b.gx - s * b.gy;
    const py = pos.y + s * b.gx + c * b.gy;
    wx[i] = px;
    wy[i] = py;
    const flx = fluidScale ? b.fx * fluidScale : b.fx;
    const fly = fluidScale ? b.fy * fluidScale : b.fy;
    const fx = flx + b.ex;
    const fy = fly + b.ey - m * G;
    fxA[i] = fx;
    fyA[i] = fy;
    M += m;
    cx += m * px;
    cy += m * py;
    Fx += fx;
    Fy += fy;
  }
  if (M <= 0) return T;
  cx /= M;
  cy /= M;
  const ax = Fx / M,
    ay = Fy / M;
  let tau = 0,
    I = 0;
  for (let i = 0; i < n; i++) {
    const rx = wx[i] - cx,
      ry = wy[i] - cy;
    tau += rx * fyA[i] - ry * fxA[i];
    I += mA[i] * (rx * rx + ry * ry + 1 / 6);
  }
  const alpha = I > 0 ? tau / I : 0;
  for (let i = 0; i < n; i++) {
    const rx = wx[i] - cx,
      ry = wy[i] - cy;
    const jx = fxA[i] - mA[i] * (ax - alpha * ry);
    const jy = fyA[i] - mA[i] * (ay + alpha * rx);
    T.bl[i] = c * jx + s * jy;
    T.bv[i] = -s * jx + c * jy;
  }
  return T;
}

export function solveFlows(struct, T) {
  cg(T, T.wv, T.dv, T.bv, T.xv);
  cg(T, T.wl, T.dl, T.bl, T.xl);
  for (const b of struct.list) {
    b.phiV = T.xv[b.idx];
    b.phiL = T.xl[b.idx];
  }
  const { ei, ej, wv, wl, xv, xl, edges, m } = T;
  for (let k = 0; k < m; k++) {
    const e = edges[k];
    e.fv = wv[k] * (xv[ei[k]] - xv[ej[k]]);
    e.fl = wl[k] * (xl[ei[k]] - xl[ej[k]]);
  }
}

export function edgeNeed(e, fv = e.fvS, fl = e.flS) {
  const nv = Math.abs(fv) / (e.vertical ? 1 : SHEAR);
  const nl = Math.abs(fl) / (e.vertical ? SHEAR : 1);
  return Math.sqrt(nv * nv + nl * nl);
}

export function edgeCapacity(e, strengthOf = blockStrength) {
  return Math.min(strengthOf(e.a), strengthOf(e.b));
}

export function weakerSide(e) {
  return blockStrength(e.a) <= blockStrength(e.b) ? e.a : e.b;
}

/** Hypothetical stress for a structure under given mass/strength assumptions (used for predictions). */
export function predictStress(struct, massOf, strengthOf, fluidScale) {
  const T = computeInjections(struct, massOf, fluidScale);
  const xv = Float64Array.from(T.xv);
  const xl = Float64Array.from(T.xl);
  cg(T, T.wv, T.dv, T.bv, xv, 80, 1e-4);
  cg(T, T.wl, T.dl, T.bl, xl, 80, 1e-4);
  const out = new Map();
  const { ei, ej, wv, wl, edges, m } = T;
  for (let k = 0; k < m; k++) {
    const e = edges[k];
    const fv = wv[k] * (xv[ei[k]] - xv[ej[k]]);
    const fl = wl[k] * (xl[ei[k]] - xl[ej[k]]);
    out.set(e, edgeNeed(e, fv, fl) / Math.max(1e-6, edgeCapacity(e, strengthOf)));
  }
  return out;
}
