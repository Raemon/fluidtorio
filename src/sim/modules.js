import { LAB_TESTS, EXTRACT_PERIOD } from './config.js';
import { getAlloy, pairOutcome, materialById } from './gen.js';
import { brittleWord } from './knowledge.js';

export class Modules {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.tick = 0;
  }

  enqueue(test, matIds) {
    const g = this.game;
    const spec = LAB_TESTS[test];
    const mats = matIds.map((id) => materialById(g.planet, id));
    if (!g.colony.list.some((b) => b.fn === 'lab')) return { ok: false, reason: 'Build a Lab first.' };
    for (const m of mats) {
      if (g.stockOf(m.id) < spec.units) return { ok: false, reason: `Need ${spec.units} ${m.name} for that.` };
    }
    for (const m of mats) g.addStock(m.id, -spec.units);
    this.queue.push({ test, mats, t: 0, dur: spec.time, id: Math.random() });
    g.emit('labs');
    return { ok: true };
  }

  cancel(job) {
    const g = this.game;
    const i = this.queue.indexOf(job);
    if (i < 0) return;
    this.queue.splice(i, 1);
    for (const m of job.mats) g.addStock(m.id, LAB_TESTS[job.test].units);
    g.emit('labs');
  }

  labs() {
    return this.game.colony ? this.game.colony.list.filter((b) => b.fn === 'lab') : [];
  }

  update(dt) {
    const g = this.game;
    const col = g.colony;
    if (!col) return;
    const labs = this.labs();
    for (const lab of labs) {
      const st = lab.state;
      if (!st.job && this.queue.length) {
        st.job = this.queue.shift();
        g.emit('labs');
      }
      if (st.job) {
        st.job.t += dt;
        if (st.job.t >= st.job.dur) {
          this.finish(lab, st.job);
          st.job = null;
          g.emit('labs');
        }
      }
    }
    for (const b of col.list) {
      if (b.fn === 'pump' || b.fn === 'condenser') this.extractor(b, dt);
      else if (b.fn === 'refinery') this.refinery(b, dt);
      else if (b.fn === 'smelter') this.smelter(b, dt);
    }
  }

  inRole(b) {
    const role = b.fn === 'pump' ? 'fuel' : 'oxidizer';
    const L = this.game.planet.layers[b.layer];
    return !!L && L.role === role;
  }

  extractor(b, dt) {
    const g = this.game;
    const st = b.state;
    st.active = this.inRole(b);
    if (!st.active) {
      st.t = 0;
      return;
    }
    st.t = (st.t || 0) + dt;
    if (st.t >= EXTRACT_PERIOD) {
      st.t -= EXTRACT_PERIOD;
      g.addStock(b.fn === 'pump' ? 'fuel' : 'ox', 1);
      if (!g.flags[b.fn]) {
        g.flags[b.fn] = true;
        g.log(b.fn === 'pump' ? 'The pump is drawing fuel from the deep layer.' : 'The condenser is pulling oxidiser out of the high air.', 'good');
      }
    }
  }

  refinery(b, dt) {
    const g = this.game;
    const st = b.state;
    st.active = g.stockOf('fuel') >= 1 && g.stockOf('ox') >= 1;
    if (!st.active) return;
    st.t = (st.t || 0) + dt;
    if (st.t >= 2) {
      st.t -= 2;
      g.addStock('fuel', -1);
      g.addStock('ox', -1);
      g.addStock('prop', 1);
    }
  }

  setRecipe(b, aId, bId) {
    const g = this.game;
    const st = b.state;
    st.recipe = aId && bId ? [aId, bId] : null;
    st.t = 0;
    st.phase = 'idle';
    g.emit('modules');
  }

  smelter(b, dt) {
    const g = this.game;
    const st = b.state;
    if (!st.recipe) {
      st.phase = 'idle';
      return;
    }
    const [ma, mb] = st.recipe.map((id) => materialById(g.planet, id));
    if (st.phase !== 'heating') {
      if (g.stockOf(ma.id) >= 3 && g.stockOf(mb.id) >= 3) {
        g.addStock(ma.id, -3);
        g.addStock(mb.id, -3);
        st.phase = 'heating';
        st.t = 0;
      } else {
        st.phase = 'starved';
        return;
      }
    }
    st.t += dt;
    const outcome = pairOutcome(g.planet, ma, mb);
    if (outcome === 'volatile' && st.t > 2.2) {
      g.knowledge.pairResult(ma, mb, 'volatile', 'the smelter exploded');
      st.recipe = null;
      st.phase = 'idle';
      g.explode(b, 3.4, 0.95);
      return;
    }
    if (st.t >= 10) {
      st.phase = 'idle';
      const alloy = getAlloy(g.planet, ma, mb);
      if (!g.knowledge.mats.has(alloy.id)) {
        g.knowledge.ensure(alloy);
        g.knowledge.see(alloy);
        g.log(`New alloy: ${alloy.name}. Its properties are unknown.`, 'good', alloy);
      }
      g.knowledge.pairResult(ma, mb, outcome, null);
      g.addStock(alloy.id, 4);
      g.stats.alloys += 4;
    }
  }

  finish(lab, job) {
    const g = this.game;
    const kn = g.knowledge;
    const [m, m2] = job.mats;
    if (job.test === 'density') {
      kn.densityInterval(m, m.d * 0.995, m.d * 1.005, 'densitometer');
      g.log(`Densitometer: ${m.name} is ${m.d.toFixed(3)} t/m³.`, 'learn', m);
    } else if (job.test === 'press') {
      kn.strengthExact(m, m.s, 0.02);
      kn.ensure(m).b = m.b;
      g.log(`Crush press: ${m.name} failed at ${Math.round(m.s)} kN. It is ${brittleWord(m.b)}.`, 'learn', m);
      g.emit('knowledge', m);
    } else if (job.test === 'soak') {
      const k = kn.ensure(m);
      const bad = [];
      for (let i = 0; i < 6; i++) {
        k.react[i] = m.react[i];
        if (m.react[i] !== 'none') bad.push(`${m.react[i] === 'swell' ? 'swells in' : i === 0 ? 'burns in' : 'corrodes in'} ${g.planet.layers[i].name}`);
      }
      g.log(`Soak bath: ${m.name} ${bad.length ? bad.join(', ') : 'is inert everywhere'}.`, bad.length ? 'warn' : 'learn', m);
      g.emit('knowledge', m);
    } else if (job.test === 'crucible') {
      const o = pairOutcome(g.planet, m, m2);
      kn.pairResult(m, m2, o, 'crucible');
      if (o === 'volatile') {
        g.fx.push({ type: 'pop', block: lab });
        g.emit('sfx', { name: 'pop' });
        for (const e of lab.edges) if (e) e.damage = Math.min(0.9, e.damage + 0.25);
      }
    }
    g.stats.tests++;
  }
}
