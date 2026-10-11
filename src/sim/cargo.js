import { FUNCS, UNITS_PER_M2, PACKED_SALVAGE_DENSITY } from './config.js';
import { pl } from './physics.js';

/** Mass of so many units of a material, as cargo. */
export function cargoMass(mat, units) {
  const d = mat.kind === 'salvage' ? PACKED_SALVAGE_DENSITY : mat.d;
  return (units / UNITS_PER_M2) * d;
}

/**
 * What the colony owns is what is physically aboard: loose items lying on the deck, and the
 * contents of stockpiles. Using material takes it out of one of those; making material sets a
 * new item down on the deck.
 */
export class Cargo {
  constructor(game) {
    this.game = game;
  }

  piles() {
    const col = this.game.colony;
    return col ? col.list.filter((b) => b.fn === 'stockpile') : [];
  }

  contents(pile) {
    return pile.state.contents || (pile.state.contents = []);
  }

  used(pile) {
    return this.contents(pile).reduce((a, it) => a + it.units, 0);
  }

  room(pile) {
    return FUNCS.stockpile.capacity - this.used(pile);
  }

  /** Units of a material aboard, optionally only those not already promised to a job. */
  unitsOf(id, free = false) {
    let n = 0;
    for (const p of this.piles()) for (const it of this.contents(p)) if (it.mat.id === id) n += it.units - (free ? it.reserved || 0 : 0);
    for (const c of this.game.flotsam.aboard()) if (c.mat.id === id && !(free && c.claimed)) n += c.units;
    return n;
  }

  totals() {
    const m = new Map();
    for (const p of this.piles()) for (const it of this.contents(p)) m.set(it.mat.id, (m.get(it.mat.id) || 0) + it.units);
    for (const c of this.game.flotsam.aboard()) m.set(c.mat.id, (m.get(c.mat.id) || 0) + c.units);
    return m;
  }

  /** Put an item into a stockpile. It now weighs on that bin. */
  store(pile, item) {
    const list = this.contents(pile);
    const same = list.find((it) => it.mat === item.mat);
    const units = Math.min(item.units, this.room(pile));
    if (units <= 0) return 0;
    if (same) same.units += units;
    else list.push({ mat: item.mat, units, reserved: 0 });
    this.reweigh(pile);
    return units;
  }

  reweigh(pile) {
    pile.cargoMass = this.contents(pile).reduce((a, it) => a + cargoMass(it.mat, it.units), 0);
    if (pile.struct) {
      pile.struct.refreshMass(pile);
      pile.struct.syncMass();
    }
    this.game.emit('stock', null);
  }

  /** Take units of a material out of a stockpile. */
  takeFromPile(pile, id, units) {
    const list = this.contents(pile);
    const it = list.find((x) => x.mat.id === id);
    if (!it) return 0;
    const n = Math.min(units, it.units);
    it.units -= n;
    it.reserved = Math.max(0, (it.reserved || 0) - n);
    if (it.units <= 0) list.splice(list.indexOf(it), 1);
    this.reweigh(pile);
    return n;
  }

  /** Take units out of a loose item; what is left of it stays where it lies. */
  takeFromItem(c, units) {
    const g = this.game;
    const n = Math.min(units, c.units);
    if (n >= c.units) {
      g.flotsam.remove(c);
      g.emit('stock', null);
      return n;
    }
    const p = c.body.getPosition();
    const a = c.body.getAngle();
    const v = c.body.getLinearVelocity();
    const rest = c.units - n;
    const mat = c.mat;
    const aboard = c.aboard;
    g.flotsam.remove(c);
    const nc = g.flotsam.produce(mat, rest, p.x, p.y, { angle: a, debris: c.debris });
    nc.body.setLinearVelocity(v);
    nc.aboard = aboard;
    nc.aboardT = 1;
    g.emit('stock', null);
    return n;
  }

  /** Use material at once: from stockpiles first, then from loose items. */
  consume(id, units) {
    let left = units;
    for (const p of this.piles()) {
      if (left <= 0) break;
      left -= this.takeFromPile(p, id, left);
    }
    for (const c of this.game.flotsam.aboard()) {
      if (left <= 0) break;
      if (c.mat.id !== id || c.claimed) continue;
      left -= this.takeFromItem(c, left);
    }
    return units - left;
  }

  /** Set new material down on the deck, near a world point. */
  produce(mat, units, x, y) {
    const g = this.game;
    const col = g.colony;
    let vx = 0,
      vy = 0;
    if (col) {
      const v = col.body.getLinearVelocityFromWorldPoint(new pl.Vec2(x, y));
      vx = v.x;
      vy = v.y;
    }
    const c = g.flotsam.produce(mat, units, x, y, { vx, vy });
    c.aboard = true;
    c.aboardT = 1.2;
    g.emit('stock', null);
    return c;
  }

  /** A stockpile that leaves the colony, or is taken apart, drops everything in it. */
  spill(pile) {
    const g = this.game;
    const list = this.contents(pile);
    if (!list.length || !pile.struct) return;
    const p = pile.struct.worldPos(pile.gx, pile.gy + 0.3);
    const v = pile.struct.body.getLinearVelocityFromWorldPoint(new pl.Vec2(p.x, p.y));
    let k = 0;
    for (const it of list) {
      let left = it.units;
      while (left > 0) {
        const n = Math.min(left, 6);
        left -= n;
        const c = g.flotsam.produce(it.mat, n, p.x + (Math.random() - 0.5) * 0.8, p.y + 0.3 + k * 0.5);
        c.body.setLinearVelocity(new pl.Vec2(v.x + (Math.random() - 0.5) * 2, v.y + 1 + Math.random()));
        k++;
      }
    }
    list.length = 0;
    pile.cargoMass = 0;
    g.emit('stock', null);
  }

  /** Where could a job pick up some of this material? Nearest first, by the caller's measure. */
  sources(id) {
    const out = [];
    for (const p of this.piles())
      for (const it of this.contents(p)) if (it.mat.id === id && it.units - (it.reserved || 0) > 0) out.push({ kind: 'pile', pile: p, item: it, units: it.units - (it.reserved || 0) });
    for (const c of this.game.flotsam.aboard()) if (c.mat.id === id && !c.claimed) out.push({ kind: 'item', chunk: c, units: c.units });
    return out;
  }
}
