import { generatePlanet, materialById } from './gen.js';
import { Sea, SURFACE } from './sea.js';
import { Physics, pl } from './physics.js';
import { Structure, DIRS, blockStrength } from './structure.js';
import { computeInjections, solveFlows, edgeNeed, edgeCapacity } from './stress.js';
import { Knowledge } from './knowledge.js';
import { Flotsam, Grapples } from './flotsam.js';
import { Modules } from './modules.js';
import { Rocket } from './rocket.js';
import { Progress } from './progress.js';
import {
  DT,
  FUNCS,
  G,
  CORRODE_RATE,
  SWELL_TIME,
  DIFFICULTIES,
  WORLD_HALF_WIDTH,
} from './config.js';
import { Rng } from './rng.js';

const STRESS_EVERY = 3;

export class Game {
  constructor({ seed = (Math.random() * 1e9) >>> 0, difficulty = 'standard', attract = false } = {}) {
    this.seed = seed;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'standard';
    this.diff = DIFFICULTIES[this.difficulty];
    this.attract = attract;
    this.planet = generatePlanet(seed);
    this.sea = new Sea(this.planet);
    this.physics = new Physics(this.sea);
    this.time = 0;
    this.duration = this.diff.minutes * 60;
    this.listeners = {};
    this.logs = [];
    this.fx = [];
    this.flags = {};
    this.stock = new Map();
    this.stats = { chunks: 0, tests: 0, blocks: 0, collapses: 0, alloys: 0, launches: 0 };
    this.state = 'playing';
    this.structures = [];
    this.knowledge = new Knowledge(this);
    this.flotsam = new Flotsam(this);
    this.grapples = new Grapples(this);
    this.modules = new Modules(this);
    this.rocket = new Rocket(this);
    this.rng = new Rng(seed ^ 0xbadc0de);
    this.stepCount = 0;
    this.tremorAt = 70;
    this.tremorWarned = false;
    this.lastTremorAmp = 0;
    this.shake = 0;
    this.progress = new Progress(this);
    for (const m of attract ? this.progress.order : this.progress.order.slice(0, 1)) this.progress.introduce(m, false);
    this.buildColony();
    this.flotsam.seed();
    this.flotsamReady = true;
    this.addStock('salvage', 30);
  }

  /** Retrying the same planet: the notebook and what you'd found survive. */
  carryOver(prev) {
    this.knowledge.importFrom(prev.knowledge);
    this.progress.importFrom(prev.progress);
  }

  on(evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
  }

  emit(evt, data) {
    const l = this.listeners[evt];
    if (l) for (const fn of l) fn(data);
  }

  log(text, kind = 'info', mat = null) {
    const entry = { text, kind, mat, t: this.time };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emit('log', entry);
  }

  stockOf(id) {
    return this.stock.get(id) || 0;
  }

  addStock(id, n) {
    this.stock.set(id, Math.max(0, (this.stock.get(id) || 0) + n));
    this.emit('stock', id);
  }

  get colony() {
    return this.colonyStruct;
  }

  buildColony() {
    const body = this.physics.createBody(0, 0.9, 0, null);
    const s = new Structure(this, 'colony', body);
    const salvage = this.planet.salvage;
    for (let gx = -4; gx <= 4; gx++) {
      s.addBlock(gx, -1, 'hollow', salvage);
      s.addBlock(gx, 0, 'hollow', salvage);
    }
    s.core = s.addBlock(0, 1, 'core', salvage);
    body.resetMassData();
    this.colonyStruct = s;
    this.structures.push(s);
    this.anchorX = 0;
  }

  removeStructure(s) {
    s.dead = true;
    const i = this.structures.indexOf(s);
    if (i >= 0) this.structures.splice(i, 1);
    for (const gr of this.grapples.list.slice()) if (gr.target.ref === s) this.grapples.release(gr);
    this.physics.destroyBody(s.body);
  }

  structureOfBody(body) {
    const ud = body.getUserData();
    return ud && ud.struct ? ud.struct : null;
  }

  // ───────────────────────────── building

  costOf(fnId, mat) {
    const fn = FUNCS[fnId];
    const costs = new Map();
    const add = (id, n) => n > 0 && costs.set(id, (costs.get(id) || 0) + n);
    if (fn.fixedMat) add('salvage', fn.salvage);
    else {
      add(mat.id, fn.cost);
      add('salvage', fn.salvage);
    }
    return costs;
  }

  canAfford(fnId, mat) {
    for (const [id, n] of this.costOf(fnId, mat)) if (this.stockOf(id) < n) return false;
    return true;
  }

  canPlace(gx, gy, fnId, mat) {
    const col = this.colony;
    if (!col || this.state !== 'playing') return { ok: false, reason: '' };
    const fn = FUNCS[fnId];
    if (!fn || fnId === 'core') return { ok: false, reason: '' };
    if (fn.fixedMat) mat = materialById(this.planet, fn.fixedMat);
    if (!mat) return { ok: false, reason: 'Pick a material.' };
    if (col.at(gx, gy)) return { ok: false, reason: 'Occupied.' };
    let adj = false;
    for (const [dx, dy] of DIRS) if (col.at(gx + dx, gy + dy)) adj = true;
    if (!adj) return { ok: false, reason: 'Must touch the colony.' };
    if (Math.abs(gx) > 60 || gy > 60 || gy < -50) return { ok: false, reason: 'Too far out.' };
    const below = col.at(gx, gy - 1);
    if (fnId === 'engine' && (!below || below.fn !== 'pad')) return { ok: false, reason: 'Engines must stand on a Launch Pad.' };
    if ((fnId === 'tank' || fnId === 'capsule') && (!below || !FUNCS[below.fn].rocket || below.fn === 'capsule'))
      return { ok: false, reason: 'Stack it on an engine or tank.' };
    if (fnId === 'capsule' && col.list.some((b) => b.fn === 'capsule')) return { ok: false, reason: 'You only need one capsule.' };
    if (below && below.fn === 'capsule') return { ok: false, reason: 'The capsule must stay on top.' };
    const wp = col.worldPos(gx, gy);
    for (const s of this.structures) {
      if (s === col) continue;
      const lp = s.localPos(wp.x, wp.y);
      if (s.at(Math.round(lp.x), Math.round(lp.y)) && Math.hypot(lp.x - Math.round(lp.x), lp.y - Math.round(lp.y)) < 0.7)
        return { ok: false, reason: 'Wreckage is in the way.' };
    }
    if (!this.canAfford(fnId, mat)) return { ok: false, reason: 'Not enough material.' };
    return { ok: true, mat };
  }

  place(gx, gy, fnId, mat) {
    const chk = this.canPlace(gx, gy, fnId, mat);
    if (!chk.ok) return chk;
    mat = chk.mat;
    for (const [id, n] of this.costOf(fnId, mat)) this.addStock(id, -n);
    const col = this.colony;
    const b = col.addBlock(gx, gy, fnId, mat);
    if (fnId === 'crane') b.state.auto = true;
    col.body.resetMassData();
    this.knowledge.see(mat);
    this.stats.blocks++;
    const wp = col.worldPos(gx, gy);
    this.fx.push({ type: 'place', x: wp.x, y: wp.y, block: b });
    this.emit('sfx', { name: 'place', x: wp.x, y: wp.y });
    this.emit('built', b);
    return { ok: true, block: b };
  }

  refundFor(b, frac) {
    const fn = FUNCS[b.fn];
    if (fn.fixedMat) this.addStock('salvage', Math.floor((fn.salvage || 0) * frac));
    else {
      this.addStock(b.mat.id, Math.floor(fn.cost * frac));
      this.addStock('salvage', Math.floor((fn.salvage || 0) * frac));
    }
  }

  deconstruct(b) {
    const col = this.colony;
    if (!b || b.struct !== col || b.fn === 'core') return false;
    const wp = col.worldPos(b.gx, b.gy);
    if (b.fuel) this.addStock('prop', b.fuel);
    this.refundFor(b, 0.75);
    col.removeBlock(b);
    col.body.resetMassData();
    this.fx.push({ type: 'remove', x: wp.x, y: wp.y, mat: b.mat });
    this.emit('sfx', { name: 'remove', x: wp.x, y: wp.y });
    this.checkSplit(col);
    this.emit('built', null);
    return true;
  }

  jettison(b) {
    const col = this.colony;
    if (!b || b.struct !== col || b.fn === 'core') return false;
    const s = col.detach([b], 'wreck');
    this.structures.push(s);
    s.body.applyLinearImpulse(new pl.Vec2((b.gx >= 0 ? 1 : -1) * 2 * b.mass, 1.5 * b.mass), s.body.getWorldCenter(), true);
    col.body.resetMassData();
    this.checkSplit(col);
    this.emit('sfx', { name: 'remove' });
    this.log(`Jettisoned a ${b.mat.name} block. Watch where it settles.`, 'info', b.mat);
    this.emit('built', null);
    return true;
  }

  repair(b) {
    if (!b || !b.struct || b.struct !== this.colony) return false;
    const dmg = b.edges.reduce((a, e) => a + (e ? e.damage : 0), 0);
    if (dmg < 0.02) return false;
    const fn = FUNCS[b.fn];
    const matId = fn.fixedMat ? 'salvage' : b.mat.id;
    if (this.stockOf(matId) < 1) {
      this.log(`Need 1 ${fn.fixedMat ? 'Salvage' : b.mat.name} to patch that.`, 'warn');
      return false;
    }
    this.addStock(matId, -1);
    for (const e of b.edges) if (e) e.damage = 0;
    const wp = b.struct.worldPos(b.gx, b.gy);
    this.fx.push({ type: 'repair', x: wp.x, y: wp.y });
    this.emit('sfx', { name: 'repair', x: wp.x, y: wp.y });
    return true;
  }

  checkSplit(struct) {
    if (struct.list.length === 0) return;
    const root = struct === this.colony ? struct.core : struct.kind === 'rocket' ? this.rocket.rootBlock() : struct.list[0];
    const comps = struct.components(() => root);
    if (comps.length <= 1) return;
    for (let i = 1; i < comps.length; i++) {
      const s = struct.detach(comps[i], 'wreck');
      this.structures.push(s);
      if (struct === this.colony) this.stats.collapses++;
      if (struct.kind === 'rocket' && comps[i].some((b) => b.fn === 'capsule')) this.rocket.fail('The rocket broke apart.');
    }
    struct.body.resetMassData();
  }

  // ───────────────────────────── stress

  updateStress(struct, dt, learn) {
    if (struct.list.length < 2) return;
    const T = computeInjections(struct);
    solveFlows(struct, T);
    const k = 1 - Math.exp(-dt / 0.12);
    const kn = this.knowledge;
    let broke = false;
    for (const e of T.edges) {
      if (e.broken) continue;
      e.fvS += (e.fv - e.fvS) * k;
      e.flS += (e.fl - e.flS) * k;
      const need = edgeNeed(e);
      const cap = edgeCapacity(e);
      const s = need / Math.max(1e-6, cap);
      e.stress = s;
      e.need = need;
      const weak = blockStrength(e.a) <= blockStrength(e.b) ? e.a : e.b;
      const mat = weak.mat;
      const crackStart = mat.crack;
      const strain = Math.max(0, (s - crackStart) / (1 - crackStart));
      const target = Math.min(1, Math.max(strain * 0.7, e.damage));
      e.crackVis += (target - e.crackVis) * Math.min(1, dt * 3);
      if (s > 1) {
        const rate = (s - 1 + 0.08) * (0.1 + 1.7 * mat.b);
        if (e.damage === 0) e.firstDamageT = this.time;
        e.damage += rate * dt;
        e.creak = (e.creak || 0) + dt;
        if (e.creak > 0.45) {
          e.creak = 0;
          const p = struct.worldPos((e.a.gx + e.b.gx) / 2, (e.a.gy + e.b.gy) / 2);
          this.emit('sfx', { name: 'creak', x: p.x, y: p.y, b: mat.b });
        }
      }
      if (learn) this.learnFromEdge(e, need, s);
      if (strain > 0.35 && learn) {
        const kk = kn.get(mat);
        if (!kk.firstCrack) {
          kk.firstCrack = true;
          this.log(`Hairline cracks in a ${mat.name} joint carrying ${Math.round(need)} kN.`, 'warn', mat);
          const p = struct.worldPos((e.a.gx + e.b.gx) / 2, (e.a.gy + e.b.gy) / 2);
          this.emit('crack', { x: p.x, y: p.y, mat });
        }
      }
      if (e.damage >= 1) {
        this.breakEdge(struct, e, mat, learn);
        broke = true;
      }
    }
    if (broke) this.checkSplit(struct);
  }

  learnFromEdge(e, need, s) {
    if (need < 6) return;
    const kn = this.knowledge;
    const wa = FUNCS[e.a.fn].sMul,
      wb = FUNCS[e.b.fn].sMul;
    if (s <= 1) {
      kn.strengthLower(e.a.mat, need / wa);
      if (e.b.mat !== e.a.mat || wb !== wa) kn.strengthLower(e.b.mat, need / wb);
      return;
    }
    if (e.a.mat === e.b.mat) {
      kn.strengthUpper(e.a.mat, need / Math.min(wa, wb), e.damage > 0.5 ? null : null);
      return;
    }
    const ka = kn.get(e.a.mat),
      kb = kn.get(e.b.mat);
    if (kb.s[0] * wb >= need) kn.strengthUpper(e.a.mat, need / wa);
    else if (ka.s[0] * wa >= need) kn.strengthUpper(e.b.mat, need / wb);
  }

  breakEdge(struct, e, mat, learn) {
    struct.unlink(e);
    const p = struct.worldPos((e.a.gx + e.b.gx) / 2, (e.a.gy + e.b.gy) / 2);
    this.fx.push({ type: 'break', x: p.x, y: p.y, mat, vertical: e.vertical, angle: struct.body.getAngle() });
    this.emit('sfx', { name: 'snap', x: p.x, y: p.y, b: mat.b });
    this.shake = Math.min(1, this.shake + 0.25);
    if (learn) {
      const kk = this.knowledge.get(mat);
      if (!kk.firstBreak) {
        kk.firstBreak = true;
        this.knowledge.brittleHint(mat, mat.b);
        if (e.need) this.log(`A ${mat.name} joint snapped under ${Math.round(e.need)} kN.`, 'bad', mat);
      }
    }
  }

  explode(block, radius, power) {
    const s = block.struct;
    if (!s) return;
    const c = s.worldPos(block.gx, block.gy);
    this.fx.push({ type: 'explosion', x: c.x, y: c.y, r: radius });
    this.emit('sfx', { name: 'explosion', x: c.x, y: c.y });
    this.shake = 1;
    if (s.list.includes(block) && block.fn !== 'core') {
      s.removeBlock(block);
      s.body.resetMassData();
    }
    for (const st of this.structures) {
      for (const b of st.list) {
        const p = st.worldPos(b.gx, b.gy);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d > radius) continue;
        const f = power * (1 - d / radius);
        for (const e of b.edges) if (e) e.damage += f * 0.85;
      }
      const wc = st.body.getWorldCenter();
      const d = Math.hypot(wc.x - c.x, wc.y - c.y);
      if (d < radius * 3) {
        const m = st.body.getMass();
        const imp = (power * 6 * Math.min(m, 40)) / Math.max(1.5, d);
        st.body.applyLinearImpulse(new pl.Vec2(((wc.x - c.x) / (d || 1)) * imp, ((wc.y - c.y) / (d || 1)) * imp), wc, true);
      }
    }
    for (const ch of this.flotsam.chunks) {
      const p = ch.body.getPosition();
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < radius * 2.5) {
        const m = ch.body.getMass();
        ch.body.applyLinearImpulse(new pl.Vec2(((p.x - c.x) / (d || 1)) * m * 8, ((p.y - c.y) / (d || 1)) * m * 8 + m * 4), p, true);
      }
    }
    for (const st of this.structures.slice()) {
      let broke = false;
      for (const b of st.list.slice()) for (const e of b.edges) if (e && e.damage >= 1) {
        this.breakEdge(st, e, e.a.mat, st === this.colony);
        broke = true;
      }
      if (broke || st === s) this.checkSplit(st);
    }
  }

  // ───────────────────────────── environment effects on blocks

  updateBlocks(dt) {
    const t = this.time;
    const kn = this.knowledge;
    for (const s of this.structures) {
      const learn = s === this.colony || s.kind === 'wreck';
      for (const b of s.list) {
        const p = s.worldPos(b.gx, b.gy);
        const layer = this.sea.layerAt(p.x, p.y, t);
        b.layer = layer;
        if (layer > 5) continue;
        if (learn) kn.exposed(b.mat, layer, dt);
        const r = b.mat.react[layer];
        b.corroding = r === 'corrode';
        if (r === 'corrode') {
          for (const e of b.edges) if (e) e.damage += CORRODE_RATE * dt;
          if (s.kind !== 'colony' && s.list.length === 1) b.dissolve = (b.dissolve || 0) + CORRODE_RATE * dt;
        } else if (r === 'swell' && b.wet > 0.3 && b.swell < 1) {
          b.swell = Math.min(1, b.swell + dt / SWELL_TIME);
          s.refreshMass(b);
        }
        if (FUNCS[b.fn].floodable && !b.flooded && b.wet > 0.4) {
          const dmg = b.edges.reduce((a, e) => Math.max(a, e ? e.damage : 0), 0);
          if (dmg > 0.35 || b.corroding) {
            b.flooded = true;
            b.floodRho = this.planet.layers[Math.max(3, layer)].rho;
            s.refreshMass(b);
            if (s === this.colony) this.log(`A ${b.mat.name} float cracked open and flooded.`, 'bad', b.mat);
            this.emit('sfx', { name: 'flood', x: p.x, y: p.y });
          }
        }
      }
      s.syncMass();
    }
    for (const s of this.structures.slice()) {
      if (s.kind === 'colony' || s.list.length !== 1) continue;
      if (s.list[0].dissolve > 1) {
        const p = s.body.getWorldCenter();
        this.fx.push({ type: 'dissolve', x: p.x, y: p.y, mat: s.list[0].mat });
        this.removeStructure(s);
      }
    }
  }

  processImpacts() {
    const imps = this.physics.impacts;
    if (!imps.length) return;
    for (const { a, b, j } of imps) {
      for (const [fa, fb] of [
        [a, b],
        [b, a],
      ]) {
        const da = fa.getUserData();
        if (!da || !da.owner) continue;
        const blk = da.owner;
        const s = blk.struct;
        if (!s || (s !== this.colony && s.kind !== 'rocket')) continue;
        const other = fb.getBody().getUserData();
        if (!other || other.kind === 'floor' || other.kind === 'chunk') continue;
        const dmg = Math.max(0, j - 14) / (blockStrength(blk) * 0.12);
        if (dmg <= 0.01) continue;
        for (const e of blk.edges) if (e) e.damage += dmg;
        if (dmg > 0.15) {
          const p = s.worldPos(blk.gx, blk.gy);
          this.fx.push({ type: 'impact', x: p.x, y: p.y, mat: blk.mat });
          this.emit('sfx', { name: 'thud', x: p.x, y: p.y });
        }
      }
    }
    imps.length = 0;
  }

  // ───────────────────────────── volcano

  updateVolcano(dt) {
    const prog = this.time / this.duration;
    if (!this.tremorWarned && this.time > this.tremorAt - 9) {
      this.tremorWarned = true;
      this.log('The volcano shudders. A swell is coming.', 'warn');
      this.emit('tremor', { warn: true });
    }
    if (this.time > this.tremorAt) {
      const amp = (0.4 + 1.8 * prog * prog + this.rng.range(-0.08, 0.15)) * this.diff.tremorScale;
      this.lastTremorAmp = amp;
      this.sea.addPacket(this.time, amp, 9 + this.rng.range(0, 5), 8.5 + this.rng.range(0, 2), -1);
      this.emit('tremor', { warn: false, amp });
      this.emit('sfx', { name: 'rumble' });
      this.shake = Math.min(1, this.shake + 0.4 + prog * 0.4);
      this.tremorAt = this.time + this.rng.range(70, 105) * (1 - 0.45 * prog);
      this.tremorWarned = false;
    }
    if (this.time >= this.duration && this.state === 'playing') {
      this.state = 'erupting';
      this.eruptT = 0;
      this.log('Mount ' + this.volcanoName() + ' erupts.', 'bad');
      this.sea.addPacket(this.time, 3.5, 16, 12, -1);
      this.emit('sfx', { name: 'eruption' });
      this.emit('erupt');
    }
  }

  volcanoName() {
    if (!this._vname) {
      const r = new Rng(this.seed ^ 0x7a7a);
      this._vname = r.pick(['Ignis', 'Kalder', 'Vashti', 'Morrow', 'Embrae', 'Tolva', 'Surtr', 'Ashkel', 'Pyrran']);
    }
    return this._vname;
  }

  // ───────────────────────────── main step

  step(dt = DT) {
    if (this.state === 'won' || this.state === 'lost') {
      this.time += dt;
      this.sea.update(this.time);
      this.physics.step(dt, this.time);
      return;
    }
    this.time += dt;
    this.stepCount++;
    this.sea.update(this.time);
    const col = this.colony;
    for (const s of this.structures) for (const b of s.list) {
      b.ex = 0;
      b.ey = 0;
    }
    if (col) {
      const wc = col.body.getWorldCenter();
      const v = col.body.getLinearVelocity();
      const M = col.body.getMass();
      const fx = -M * (0.9 * (wc.x - this.anchorX) + 1.4 * v.x);
      col.body.applyForceToCenter(new pl.Vec2(Math.max(-12 * M, Math.min(12 * M, fx)), 0), true);
    }
    this.grapples.update(dt);
    this.rocket.update(dt);
    this.physics.step(dt, this.time);
    this.processImpacts();
    if (this.stepCount % STRESS_EVERY === 0) {
      const sdt = dt * STRESS_EVERY;
      if (col) this.updateStress(col, sdt, true);
      if (this.rocket.struct) this.updateStress(this.rocket.struct, sdt, false);
      this.updateBlocks(sdt);
      this.flotsam.update(sdt);
      this.modules.update(sdt);
      if (!this.attract) {
        this.updateVolcano(sdt);
        this.progress.update();
      }
      this.checkColony();
    }
    this.shake = Math.max(0, this.shake - dt * 1.4);
    if (this.state === 'erupting') {
      this.eruptT += dt;
      if (this.eruptT > 9) {
        this.state = 'lost';
        this.emit('end', { won: false });
      }
    }
  }

  checkColony() {
    const col = this.colony;
    if (!col || this.attract) return;
    const p = col.core ? col.worldPos(col.core.gx, col.core.gy) : null;
    if (!p) return;
    const k = this.sea.layerAt(p.x, p.y, this.time);
    const ang = Math.abs(((col.body.getAngle() + Math.PI) % (2 * Math.PI)) - Math.PI);
    if (k >= SURFACE + 1 || p.y < this.sea.surfaceY(p.x, this.time) - 6) {
      this.sinkT = (this.sinkT || 0) + 0.05;
    } else this.sinkT = 0;
    if (ang > 2.4) this.flipT = (this.flipT || 0) + 0.05;
    else this.flipT = 0;
    if (this.sinkT > 6 || this.flipT > 8) {
      this.state = 'lost';
      this.lostReason = this.sinkT > 6 ? 'The core sank.' : 'The colony capsized.';
      this.log(this.lostReason, 'bad');
      this.emit('end', { won: false, reason: this.lostReason });
    }
  }

  timeLeft() {
    return Math.max(0, this.duration - this.time);
  }
}
