import * as pl from 'planck';
import { G, WORLD_HALF_WIDTH } from './config.js';
import { SURFACE, N_LAYERS } from './sea.js';

const AX = new Float64Array(32);
const AY = new Float64Array(32);
const BX = new Float64Array(32);
const BY = new Float64Array(32);
const WX = new Float64Array(32);
const WY = new Float64Array(32);
const clipOut = { cx: 0, cy: 0 };

export function clipBand(xs, ys, n, yb, yt, out) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x1 = xs[i],
      y1 = ys[i],
      x2 = xs[j],
      y2 = ys[j];
    const in1 = y1 <= yt,
      in2 = y2 <= yt;
    if (in1) {
      AX[m] = x1;
      AY[m] = y1;
      m++;
    }
    if (in1 !== in2) {
      const t = (yt - y1) / (y2 - y1);
      AX[m] = x1 + (x2 - x1) * t;
      AY[m] = yt;
      m++;
    }
  }
  let q = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === m ? 0 : i + 1;
    const x1 = AX[i],
      y1 = AY[i],
      x2 = AX[j],
      y2 = AY[j];
    const in1 = y1 >= yb,
      in2 = y2 >= yb;
    if (in1) {
      BX[q] = x1;
      BY[q] = y1;
      q++;
    }
    if (in1 !== in2) {
      const t = (yb - y1) / (y2 - y1);
      BX[q] = x1 + (x2 - x1) * t;
      BY[q] = yb;
      q++;
    }
  }
  if (q < 3) return 0;
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < q; i++) {
    const j = i + 1 === q ? 0 : i + 1;
    const cr = BX[i] * BY[j] - BX[j] * BY[i];
    a += cr;
    cx += (BX[i] + BX[j]) * cr;
    cy += (BY[i] + BY[j]) * cr;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return 0;
  out.cx = cx / (6 * a);
  out.cy = cy / (6 * a);
  return Math.abs(a);
}

pl.Settings.maxTranslation = 8;

export const DRAG_LIN = 0.9;
export const DRAG_QUAD = 0.55;
export const AIR_QUAD = 0.00002;

export class Physics {
  constructor(sea) {
    this.sea = sea;
    this.world = new pl.World({ gravity: new pl.Vec2(0, -G) });
    this.floorBody = this.world.createBody({ type: 'static' });
    const W = WORLD_HALF_WIDTH + 60;
    const f = sea.floor;
    const pts = [];
    for (let x = -W; x <= W; x += 6) {
      const y = f + 0.5 * Math.sin(x * 0.13) + 0.35 * Math.sin(x * 0.051 + 1.3);
      pts.push(new pl.Vec2(x, y));
    }
    this.floorPts = pts;
    this.floorBody.createFixture({ shape: new pl.Chain(pts, false), friction: 0.9 });
    this.floorBody.setUserData({ kind: 'floor' });
    this.bodies = new Set();
    this.impacts = [];
    this.dt = 1 / 60;
    this.world.on('post-solve', (contact, impulse) => {
      const ni = impulse.normalImpulses;
      const fa = contact.getFixtureA(),
        fb = contact.getFixtureB();
      // cargo resting on a block presses on that block: the stress solver needs to know
      const da = fa.getUserData(),
        db = fb.getUserData();
      const blk = da && da.owner && db && db.chunk ? da.owner : db && db.owner && da && da.chunk ? db.owner : null;
      if (blk) {
        const n = contact.getManifold().pointCount;
        let J = 0;
        for (let i = 0; i < n; i++) J += ni[i] || 0;
        if (J > 0) {
          const wm = contact.getWorldManifold(null);
          const sign = blk === (da && da.owner) ? -1 : 1;
          blk.ex += (sign * wm.normal.x * J) / this.dt;
          blk.ey += (sign * wm.normal.y * J) / this.dt;
        }
      }
      const j = Math.max(ni[0] || 0, ni[1] || 0);
      if (j < 4) return;
      this.impacts.push({ a: fa, b: fb, j });
    });
  }

  floorAt(x) {
    return this.sea.floor + 0.5 * Math.sin(x * 0.13) + 0.35 * Math.sin(x * 0.051 + 1.3);
  }

  createBody(x, y, angle, data) {
    const body = this.world.createBody({
      type: 'dynamic',
      position: new pl.Vec2(x, y),
      angle,
      linearDamping: 0.02,
      angularDamping: 0.12,
    });
    body.setUserData(data);
    this.bodies.add(body);
    return body;
  }

  destroyBody(body) {
    this.bodies.delete(body);
    this.world.destroyBody(body);
  }

  step(dt, t) {
    this.dt = dt;
    for (const body of this.bodies) this.applyFluid(body, t);
    this.world.step(dt, 8, 3);
  }

  applyFluid(body, t) {
    const sea = this.sea;
    const layers = sea.layers;
    const xf = body.getTransform();
    const px = xf.p.x,
      py = xf.p.y,
      c = xf.q.c,
      s = xf.q.s;
    const wc = body.getWorldCenter();
    const v = body.getLinearVelocity();
    const w = body.getAngularVelocity();
    const floor = sea.floor;
    let Fx = 0,
      Fy = 0,
      T = 0;
    let wetArea = 0;
    let totalArea = 0;
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const fd = f.getUserData();
      if (!fd) continue;
      const owner = fd.owner;
      if (owner) {
        owner.fx = 0;
        owner.fy = 0;
        owner.wet = 0;
      }
      const lv = fd.lv;
      const n = fd.n;
      let minY = Infinity,
        maxY = -Infinity,
        sx = 0;
      for (let i = 0; i < n; i++) {
        const lx = lv[2 * i],
          ly = lv[2 * i + 1];
        const wx = px + c * lx - s * ly;
        const wy = py + s * lx + c * ly;
        WX[i] = wx;
        WY[i] = wy;
        sx += wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
      totalArea += fd.area;
      const xc = sx / n;
      const surf = sea.ifaceY(SURFACE, xc, t);
      if (minY >= surf) continue;
      let yt = surf;
      for (let k = SURFACE; k < N_LAYERS; k++) {
        const yb = k === N_LAYERS - 1 ? floor - 50 : sea.ifaceY(k + 1, xc, t);
        if (maxY > yb && minY < yt) {
          const area = clipBand(WX, WY, n, yb, yt, clipOut);
          if (area > 1e-6) {
            const L = layers[k];
            const rho = L.rho;
            const rx = clipOut.cx - wc.x,
              ry = clipOut.cy - wc.y;
            const vx = v.x - w * ry - L.current * fd.currentMul;
            const vy = v.y + w * rx;
            const sp = Math.sqrt(vx * vx + vy * vy);
            const kd = rho * area * L.drag * (DRAG_LIN + DRAG_QUAD * sp);
            const fx = -kd * vx;
            const fy = rho * area * G - kd * vy;
            Fx += fx;
            Fy += fy;
            T += rx * fy - ry * fx;
            wetArea += area;
            if (owner) {
              owner.fx += fx;
              owner.fy += fy;
              owner.wet += area;
            }
          }
        }
        yt = yb;
        if (yt <= minY) break;
      }
    }
    const dryArea = totalArea - wetArea;
    if (dryArea > 0) {
      const sp = Math.sqrt(v.x * v.x + v.y * v.y);
      const kd = 0.003 * dryArea + AIR_QUAD * dryArea * sp;
      Fx -= kd * v.x;
      Fy -= kd * v.y;
    }
    const ud = body.getUserData();
    ud.wetFrac = totalArea > 0 ? wetArea / totalArea : 0;
    body.applyForceToCenter(new pl.Vec2(Fx, Fy), true);
    body.applyTorque(T, true);
  }
}

export function boxVerts(cx, cy, h = 0.5) {
  return new Float64Array([cx - h, cy - h, cx + h, cy - h, cx + h, cy + h, cx - h, cy + h]);
}

export { pl };
