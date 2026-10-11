import { pl } from './physics.js';
import { FUNCS, ENGINE_THRUST, ENGINE_BURN, TANK_CAPACITY, ESCAPE_ALTITUDE, ESCAPE_SPEED } from './config.js';

export class Rocket {
  constructor(game) {
    this.game = game;
    this.struct = null;
    this.phase = 'none';
    this.t = 0;
    this.maxAlt = 0;
  }

  rocketBlocks() {
    const col = this.game.colony;
    return col ? col.list.filter((b) => FUNCS[b.fn].rocket) : [];
  }

  /** The connected rocket stack that holds the capsule (or the first engine's stack). */
  group() {
    const parts = this.rocketBlocks();
    if (!parts.length) return [];
    const start = parts.find((b) => b.fn === 'capsule') || parts.find((b) => b.fn === 'engine') || parts[0];
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const b = stack.pop();
      for (const e of b.edges) {
        if (!e) continue;
        const o = e.a === b ? e.b : e.a;
        if (!seen.has(o) && FUNCS[o.fn].rocket) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    return [...seen];
  }

  validate() {
    const g = this.game;
    const blocks = this.group();
    const engines = blocks.filter((b) => b.fn === 'engine');
    const tanks = blocks.filter((b) => b.fn === 'tank');
    const capsule = blocks.find((b) => b.fn === 'capsule');
    const res = { ok: false, blocks, engines, tanks, capsule, reason: '' };
    if (!blocks.length) res.reason = 'Build a Launch Pad, then an Engine on it, Tanks above, and the Capsule on top.';
    else if (!engines.length) res.reason = 'The rocket needs at least one Engine, standing on a Launch Pad.';
    else if (!tanks.length) res.reason = 'Stack at least one Tank above the engine.';
    else if (!capsule) res.reason = 'Put the Capsule on top of the stack.';
    else if (g.stockOf('prop') < 1) res.reason = 'No propellant. Refine fuel + oxidiser.';
    else if (this.struct) res.reason = 'A rocket is already in flight.';
    else if (g.state !== 'playing') res.reason = '';
    else res.ok = true;
    return res;
  }

  launch() {
    const g = this.game;
    const v = this.validate();
    if (!v.ok) {
      if (v.reason) g.log(v.reason, 'warn');
      return v;
    }
    const col = g.colony;
    const cap = v.tanks.length * TANK_CAPACITY;
    const fuel = Math.min(cap, g.stockOf('prop'));
    g.addStock('prop', -fuel);
    for (const t of v.tanks) {
      t.fuel = fuel / v.tanks.length;
      col.refreshMass(t);
    }
    col.syncMass();
    this.pads = v.engines.map((e) => col.at(e.gx, e.gy - 1)).filter(Boolean);
    const s = col.detach(v.blocks, 'rocket');
    g.structures.push(s);
    s.body.setBullet(true);
    s.body.setLinearDamping(0);
    col.body.resetMassData();
    g.checkSplit(col);
    this.struct = s;
    this.phase = 'burn';
    this.t = 0;
    this.startY = s.body.getWorldCenter().y;
    this.maxAlt = 0;
    this.fuel0 = fuel;
    this.lifted = false;
    this.maxSpeed = 0;
    this.coastNoted = false;
    g.stats.launches++;
    g.log(`Ignition. ${v.engines.length} engine${v.engines.length > 1 ? 's' : ''}, ${fuel.toFixed(0)} propellant aboard.`, 'good');
    g.emit('sfx', { name: 'launch' });
    g.emit('launch', this);
    return v;
  }

  rootBlock() {
    if (!this.struct) return null;
    return this.struct.list.find((b) => b.fn === 'capsule') || this.struct.list[0];
  }

  fuelLeft() {
    if (!this.struct) return 0;
    return this.struct.list.reduce((a, b) => a + (b.fn === 'tank' ? b.fuel : 0), 0);
  }

  update(dt) {
    const g = this.game;
    const s = this.struct;
    if (!s) return;
    if (s.dead || !s.list.some((b) => b.fn === 'capsule')) {
      this.fail('The capsule was lost.');
      return;
    }
    this.t += dt;
    const body = s.body;
    const ang = body.getAngle();
    const ux = -Math.sin(ang),
      uy = Math.cos(ang);
    const engines = s.list.filter((b) => b.fn === 'engine');
    const tanks = s.list.filter((b) => b.fn === 'tank');
    let fuel = tanks.reduce((a, b) => a + b.fuel, 0);
    this.burning = this.phase === 'burn' && fuel > 0 && engines.length > 0;
    if (this.burning) {
      for (const e of engines) {
        const p = body.getWorldPoint(new pl.Vec2(e.gx, e.gy - 0.3));
        body.applyForce(new pl.Vec2(ux * ENGINE_THRUST, uy * ENGINE_THRUST), p, true);
        e.ex += ux * ENGINE_THRUST;
        e.ey += uy * ENGINE_THRUST;
      }
      const burn = Math.min(fuel, engines.length * ENGINE_BURN * dt);
      for (const t of tanks) {
        t.fuel = Math.max(0, t.fuel - (burn * t.fuel) / Math.max(fuel, 1e-9));
        s.refreshMass(t);
      }
      fuel -= burn;
      s.syncMass();
      if (this.t < 1.6 && g.colony) {
        const k = (1 - this.t / 1.6) * 0.55 * ENGINE_THRUST;
        for (const pad of this.pads) {
          if (pad.struct !== g.colony) continue;
          const p = g.colony.body.getWorldPoint(new pl.Vec2(pad.gx, pad.gy + 0.5));
          g.colony.body.applyForce(new pl.Vec2(-ux * k, -uy * k), p, true);
          pad.ey -= uy * k;
          pad.ex -= ux * k;
        }
      }
      if (fuel <= 1e-6) {
        this.phase = 'coast';
      }
    }
    const I = body.getInertia();
    const w = body.getAngularVelocity();
    body.applyTorque(-I * (14 * ang + 5 * w), true);
    const wc = body.getWorldCenter();
    const alt = wc.y - this.startY;
    this.maxAlt = Math.max(this.maxAlt, alt);
    if (this.t > 2.5 && alt > 1.5) this.lifted = true;
    if (this.t > 4.5 && !this.lifted) {
      this.fail('Too heavy: the engines strained on the pad and overheated.');
      return;
    }
    const vy = body.getLinearVelocity().y;
    this.speed = vy;
    this.maxSpeed = Math.max(this.maxSpeed || 0, vy);
    if (wc.y > ESCAPE_ALTITUDE && vy >= ESCAPE_SPEED) {
      this.succeed();
      return;
    }
    if (this.phase === 'coast' && !this.coastNoted) {
      this.coastNoted = true;
      this.game.log(`Burnout at ${Math.round(vy)} m/s. Escape needs ${ESCAPE_SPEED}. It will fall back.`, 'bad');
    }
    if (this.phase === 'coast' && vy < -3) this.fail(`It peaked at ${Math.round(this.maxAlt)} m and fell back into the sea.`);
  }

  altitude() {
    if (!this.struct) return 0;
    return this.struct.body.getWorldCenter().y;
  }

  succeed() {
    const g = this.game;
    this.phase = 'escaped';
    g.state = 'won';
    g.log('The capsule clears the atmosphere. You made it off Strata.', 'good');
    g.emit('sfx', { name: 'win' });
    g.emit('end', { won: true });
  }

  fail(reason) {
    const g = this.game;
    const s = this.struct;
    if (!s) return;
    this.struct = null;
    this.phase = 'none';
    g.log(reason, 'bad');
    const c = s.body.getWorldCenter();
    g.fx.push({ type: 'explosion', x: c.x, y: c.y, r: 5, big: true });
    g.emit('sfx', { name: 'explosion', x: c.x, y: c.y });
    g.shake = 1;
    for (const b of s.list.slice()) for (const e of b.edges) if (e) s.unlink(e);
    const pieces = s.components();
    for (let i = 1; i < pieces.length; i++) {
      const w = s.detach(pieces[i], 'wreck');
      g.structures.push(w);
      const wc = w.body.getWorldCenter();
      const dx = wc.x - c.x,
        dy = wc.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const m = w.body.getMass();
      w.body.applyLinearImpulse(new pl.Vec2((dx / d) * m * 9, (dy / d) * m * 9 + m * 3), wc, true);
      w.body.setAngularVelocity((Math.random() - 0.5) * 8);
    }
    s.kind = 'wreck';
    s.body.getUserData().kind = 'wreck';
    s.body.setBullet(false);
    g.emit('rocketFailed', { reason });
  }
}
