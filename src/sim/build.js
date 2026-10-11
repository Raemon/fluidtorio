import { FUNCS } from './config.js';
import { DIRS, keyOf } from './structure.js';
import { materialById } from './gen.js';

/**
 * Blueprints. Placing a block marks a plan; colonists carry the material to it and build it.
 * Nothing is built out of thin air.
 */
export class Construction {
  constructor(game) {
    this.game = game;
    this.plans = new Map();
  }

  at(gx, gy) {
    return this.plans.get(keyOf(gx, gy));
  }

  list() {
    return [...this.plans.values()];
  }

  needs(fn, mat) {
    return this.game.costOf(fn, mat);
  }

  add(gx, gy, fn, mat) {
    const f = FUNCS[fn];
    if (f.fixedMat) mat = materialById(this.game.planet, f.fixedMat);
    const plan = { gx, gy, fn, mat, needs: this.needs(fn, mat), got: new Map(), coming: new Map(), work: 0, worker: null, born: this.game.time };
    this.plans.set(keyOf(gx, gy), plan);
    this.game.emit('plans', plan);
    return plan;
  }

  /** Material still to be brought, not counting what is on its way. */
  missing(plan) {
    const out = [];
    for (const [id, n] of plan.needs) {
      const left = n - (plan.got.get(id) || 0) - (plan.coming.get(id) || 0);
      if (left > 0) out.push([id, left]);
    }
    return out;
  }

  supplied(plan) {
    for (const [id, n] of plan.needs) if ((plan.got.get(id) || 0) < n) return false;
    return true;
  }

  /** Can it be built right now: does it touch the colony, and is what it stands on built? */
  ready(plan) {
    const col = this.game.colony;
    if (!col) return false;
    let adj = false;
    for (const [dx, dy] of DIRS) if (col.at(plan.gx + dx, plan.gy + dy)) adj = true;
    if (!adj) return false;
    const f = FUNCS[plan.fn];
    if (plan.fn === 'engine' || f.rocket) {
      const below = col.at(plan.gx, plan.gy - 1);
      if (!below) return false;
    }
    return !col.at(plan.gx, plan.gy);
  }

  deliver(plan, id, units) {
    plan.got.set(id, (plan.got.get(id) || 0) + units);
    plan.coming.set(id, Math.max(0, (plan.coming.get(id) || 0) - units));
  }

  /** The block goes in. */
  complete(plan) {
    const g = this.game;
    this.plans.delete(keyOf(plan.gx, plan.gy));
    const r = g.placeBlock(plan.gx, plan.gy, plan.fn, plan.mat, true);
    if (!r.ok) {
      this.refund(plan);
      if (r.reason) g.log(`Couldn't finish the ${FUNCS[plan.fn].name}: ${r.reason}`, 'warn');
    }
    g.emit('plans', null);
    return r;
  }

  refund(plan) {
    const g = this.game;
    const col = g.colony;
    if (!col) return;
    const p = col.worldPos(plan.gx, plan.gy);
    for (const [id, n] of plan.got) if (n > 0) g.cargo.produce(materialById(g.planet, id), n, p.x, p.y);
    plan.got.clear();
  }

  cancel(plan) {
    this.plans.delete(keyOf(plan.gx, plan.gy));
    this.refund(plan);
    if (plan.worker) plan.worker.job = null;
    this.game.emit('plans', null);
  }

  /** Plans that no longer make sense (the colony moved on under them) are dropped. */
  prune() {
    const col = this.game.colony;
    if (!col) return;
    for (const plan of this.list()) {
      if (col.at(plan.gx, plan.gy)) {
        this.cancel(plan);
        continue;
      }
      let near = false;
      for (const [dx, dy] of DIRS) if (col.at(plan.gx + dx, plan.gy + dy) || this.at(plan.gx + dx, plan.gy + dy)) near = true;
      if (!near) this.cancel(plan);
    }
  }
}
