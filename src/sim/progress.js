import { ESCAPE_SPEED } from './config.js';

const CAT_RANK = { float: 0, i12: 1, i23: 2, sink: 3 };

/**
 * What the colony knows how to do, and what the sea has shown it so far.
 * Nothing here is a menu that opens on a timer: each build option appears when
 * the world gives a reason for it (a sample aboard, a layer reached, a crack).
 */
export class Progress {
  constructor(game) {
    this.game = game;
    this.unlocked = new Set(['hollow', 'frame']);
    this.found = { fuel: false, ox: false };
    this.introduced = [];
    this.introT = 0;
    this.reachMisses = 0;
    this.goalsDone = new Set();
    this.order = game.planet.materials.slice().sort((a, b) => CAT_RANK[a.cat] - CAT_RANK[b.cat] || a.d - b.d);
  }

  has(id) {
    return this.unlocked.has(id);
  }

  isIntroduced(mat) {
    return this.introduced.includes(mat.id);
  }

  /** Materials reach the colony one kind at a time, drifting in on the currents. */
  introduce(mat, announce = true) {
    if (this.isIntroduced(mat)) return;
    this.introduced.push(mat.id);
    this.introT = this.game.time;
    if (this.game.flotsamReady) this.game.flotsam.arrive(mat, announce);
  }

  unlock(ids, text) {
    const fresh = [].concat(ids).filter((id) => !this.unlocked.has(id));
    if (!fresh.length) return;
    for (const id of fresh) this.unlocked.add(id);
    if (text) this.game.log(text, 'unlock');
    this.game.emit('unlock', { ids: fresh, text });
  }

  missedReach() {
    this.reachMisses++;
    if (this.reachMisses === 1)
      this.unlock('crane', 'Out of reach of the core. A Crane grapples from wherever you build it, and hauls in on its own.');
  }

  findFuel(how, mat) {
    if (this.found.fuel) return;
    this.found.fuel = true;
    const L = this.game.planet.layers;
    this.game.log(
      how === 'chunk'
        ? `The ${mat.name} came up slick with ${L[5].name}. It burns: that layer is fuel.`
        : `Your keel reached ${L[5].name}. It burns: that layer is fuel.`,
      'good',
      mat,
    );
    this.unlock('pump', `A Pump sitting inside ${L[5].name} can draw its fuel.`);
  }

  findOx(mat) {
    if (this.found.ox) return;
    this.found.ox = true;
    const L = this.game.planet.layers;
    this.game.log(`Up in ${L[0].name} the air is rich in oxidiser.`, 'good', mat);
    this.unlock('condenser', `A Condenser sitting inside ${L[0].name} can collect it.`);
  }

  importFrom(old) {
    for (const id of old.unlocked) this.unlocked.add(id);
    this.found = { ...old.found };
    for (const id of old.introduced) {
      const m = this.order.find((x) => x.id === id);
      if (m) this.introduce(m, false);
    }
  }

  update() {
    const g = this.game;
    const kn = g.knowledge;
    const raws = g.planet.materials;

    // flotsam: next kind arrives once the last one has been hauled in, or after a while regardless
    for (const m of this.order) if (!this.isIntroduced(m) && kn.get(m).seen) this.introduce(m, false);
    const next = this.order.find((m) => !this.isIntroduced(m));
    if (next) {
      const last = this.order.find((m) => m.id === this.introduced[this.introduced.length - 1]);
      const since = g.time - this.introT;
      if ((last && kn.get(last).seen && since > 55) || since > 150) this.introduce(next);
    }

    const seenRaw = raws.filter((m) => kn.get(m).seen);
    if (seenRaw.length) {
      this.unlock('lab', 'Unknown material aboard. Your test gear can be rebuilt as a Lab.');
      this.unlock('notebook');
      this.unlock('lens');
    }
    if (g.stats.chunks >= 5) this.unlock('crane', 'Hauling by hand is slow. A Crane hauls in whatever drifts within reach.');

    const col = g.colony;
    let cracked = false;
    if (col) {
      let span = 0;
      for (const b of col.list) {
        span = Math.max(span, Math.abs(b.gy));
        if (b.layer === 5 && !this.found.fuel) this.findFuel('block', b.mat);
        if (b.layer === 0 && !this.found.ox) this.findOx(b.mat);
        for (const e of b.edges) if (e && (e.damage > 0.05 || e.crackVis > 0.15)) cracked = true;
      }
      if (span >= 3 || cracked) this.unlock('stress', 'Press V to see the load on every joint, judged from what you know.');
    }
    if (cracked) this.unlock('patch', 'Cracked joints can be patched with one unit of their material [R].');
    const anyCrack = cracked || [...kn.mats.values()].some((k) => k.firstCrack || k.firstBreak);
    if (anyCrack) this.unlock(['smelter', 'alloys'], 'Raw materials crack. A Smelter fuses two into an alloy: stronger, or worse.');
    else if (g.flags.pump || this.found.ox) this.unlock(['smelter', 'alloys'], 'A rocket needs better than raw rock. A Smelter fuses two materials into an alloy.');
    if (g.flags.pump && g.flags.condenser) this.unlock('refinery', 'Fuel and oxidiser both. A Refinery mixes them into propellant.');
    if (g.stockOf('prop') > 0 || g.stats.launches > 0)
      this.unlock(['pad', 'engine', 'tank', 'capsule'], 'Propellant. Now build something to burn it in: Launch Pad, Engine, Tank, Capsule.');

    const goals = this.goals();
    for (const gl of goals)
      if (!this.goalsDone.has(gl.id) && gl.done()) {
        this.goalsDone.add(gl.id);
        g.emit('goal', gl);
      }
  }

  firstSample() {
    const kn = this.game.knowledge;
    return this.order.find((m) => kn.get(m).seen) || null;
  }

  goals() {
    const g = this.game;
    const L = g.planet.layers;
    const kn = g.knowledge;
    const first = this.firstSample();
    return [
      {
        id: 'haul',
        title: 'Haul in what drifts past',
        hint: 'Click a chunk near the raft to grapple it in. Every kind is something new to build with.',
        done: () => g.stats.chunks >= 2,
      },
      {
        id: 'weigh',
        title: first ? `Find out what ${first.name} weighs` : 'Find out what new materials weigh',
        hint: 'Density decides whether building with it floats you or sinks you. A resting chunk’s waterline gives it away; a Lab measures it exactly.',
        done: () => g.planet.materials.some((m) => kn.get(m).seen && kn.get(m).d[1] / kn.get(m).d[0] < 1.2),
      },
      {
        id: 'fuel',
        title: 'Find fuel',
        hint: `Below ${L[4].name}, ${L[5].name} glows as if it would burn. Reach down to it.`,
        done: () => this.found.fuel,
      },
      {
        id: 'pump',
        title: `Pump fuel from ${L[5].name}`,
        hint: `A Pump only works inside ${L[5].name}, ${(-L[5].top).toFixed(0)} m down. Mind what the deep does to your materials.`,
        done: () => !!g.flags.pump,
      },
      {
        id: 'ox',
        title: 'Find an oxidiser',
        hint: `Fuel needs something to burn in. The sky changes above +${L[1].top.toFixed(0)} m.`,
        done: () => this.found.ox,
      },
      {
        id: 'condense',
        title: `Condense oxidiser from ${L[0].name}`,
        hint: `A Condenser only works inside ${L[0].name}. A tall tower needs lift under it and strength in it.`,
        done: () => !!g.flags.condenser,
      },
      {
        id: 'refine',
        title: 'Refine propellant',
        hint: 'A Refinery turns 1 fuel + 1 oxidiser into 1 propellant.',
        done: () => g.stockOf('prop') >= 1 || g.stats.launches > 0,
      },
      {
        id: 'rocket',
        title: 'Stack a rocket',
        hint: 'Launch Pad, an Engine on it, Tanks above, the Capsule on top. The forecast says whether it flies.',
        done: () => {
          const rv = g.rocket.validate();
          return !!rv.capsule && rv.engines.length > 0 && rv.tanks.length > 0;
        },
      },
      {
        id: 'escape',
        title: `Reach escape speed`,
        hint: `${ESCAPE_SPEED} m/s, before the eruption.`,
        done: () => g.state === 'won',
      },
    ];
  }

  currentGoal() {
    const goals = this.goals();
    const i = goals.findIndex((gl) => !gl.done());
    return i < 0 ? null : { ...goals[i], index: i, total: goals.length };
  }
}
