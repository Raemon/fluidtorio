import { EXTRACT_PERIOD } from './config.js';
import { getAlloy, pairOutcome, materialById } from './gen.js';

export class Modules {
  constructor(game) {
    this.game = game;
  }

  update(dt) {
    const col = this.game.colony;
    if (!col) return;
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
    st.recipe = aId && bId && aId !== bId ? [aId, bId] : null;
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
    if (!ma || !mb || ma === mb || ma.kind !== 'raw' || mb.kind !== 'raw') {
      st.recipe = null;
      st.phase = 'idle';
      return;
    }
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
      g.addStock(alloy.id, 4, b.struct ? b.struct.worldPos(b.gx, b.gy + 1) : null);
      g.stats.alloys += 4;
    }
  }
}
