import { ESCAPE_SPEED } from './config.js';

/**
 * What the colony knows how to do, and what it is trying to do next.
 * Build options appear when the world gives a reason for them (cargo on deck, something out of
 * reach, a layer reached, a crack). Goals name outcomes; how to get there is up to you.
 */
export class Progress {
  constructor(game) {
    this.game = game;
    this.unlocked = new Set();
    this.found = { fuel: false, ox: false };
    this.reachMisses = 0;
    this.goalsDone = new Set();
  }

  has(id) {
    return this.unlocked.has(id);
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
    if (this.reachMisses === 1) this.unlock('crane', 'A Crane fishes from wherever you build it, further out than anyone can cast.');
  }

  findFuel(how, mat) {
    if (this.found.fuel) return;
    this.found.fuel = true;
    const L = this.game.planet.layers;
    this.game.log(
      how === 'chunk' ? `The ${mat.name} came up slick with ${L[5].name}. It burns: that layer is fuel.` : `Your keel reached ${L[5].name}. It burns: that layer is fuel.`,
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
  }

  update() {
    const g = this.game;
    const kn = g.knowledge;
    if (g.stats.chunks > 0)
      this.unlock(['stockpile', 'hollow', 'frame'], 'Loose cargo shifts when the raft rolls, and can go over the side. A Stockpile holds it. You can build onto the raft itself, too.');
    const raw = g.planet.materials.some((m) => kn.get(m).seen);
    if (raw) this.unlock(['drop', 'notebook', 'lens']);
    if (g.stats.chunks >= 6) this.unlock('crane', 'Fishing by hand is slow. A Crane hauls in whatever drifts within its reach, by itself.');

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
      if (span >= 3 || cracked) this.unlock('stress');
    }
    if (cracked) this.unlock('patch', 'Cracked joints can be patched with a unit of their material [R].');
    const anyCrack = cracked || [...kn.mats.values()].some((k) => k.firstCrack || k.firstBreak);
    if (anyCrack) this.unlock(['smelter', 'alloys'], 'Raw materials crack. A Smelter fuses two into an alloy: stronger, or worse.');
    else if (g.flags.pump || this.found.ox) this.unlock(['smelter', 'alloys'], 'A rocket needs better than raw rock. A Smelter fuses two materials into an alloy.');
    if (g.flags.pump && g.flags.condenser) this.unlock('refinery', 'Fuel and oxidiser both. A Refinery mixes them into propellant.');
    if (g.stockOf('prop') > 0 || g.stats.launches > 0)
      this.unlock(['pad', 'engine', 'tank', 'capsule'], 'Propellant. Now build something to burn it in: Launch Pad, Engine, Tank, Capsule.');

    for (const gl of this.goals())
      if (!this.goalsDone.has(gl.id) && gl.done()) {
        this.goalsDone.add(gl.id);
        g.emit('goal', gl);
      }
  }

  goals() {
    const g = this.game;
    const L = g.planet.layers;
    const first = g.colonists.list[0];
    const flare = g.world.flareSeen;
    const cx = g.colony ? g.colony.body.getWorldCenter().x : 0;
    return [
      {
        id: 'haul',
        title: 'Fish in the wreckage',
        hint: `Click something floating near the raft. ${first ? first.name : 'Your colonist'} will walk to the edge and cast a line.`,
        done: () => g.stats.chunks >= 1,
      },
      {
        id: 'stow',
        title: 'Keep your haul aboard',
        hint: 'Loose cargo slides when the raft rolls, and can go over the side.',
        done: () => g.cargo.piles().some((p) => (p.state.contents || []).length > 0),
      },
      {
        id: 'rescue',
        title: flare ? 'Answer the flare' : 'Find who else survived',
        hint: flare
          ? `It came from the ${flare.x > cx ? 'east' : 'west'}. Click the lander to row; get within a cast and fish them in.`
          : 'Keep an eye on the horizon.',
        done: () => g.stats.rescued >= 1,
      },
      {
        id: 'fuel',
        title: 'Find fuel',
        hint: `Below ${L[4].name}, ${L[5].name} glows as if it would burn.`,
        done: () => this.found.fuel,
      },
      {
        id: 'pump',
        title: `Pump fuel from ${L[5].name}`,
        hint: `A Pump only works inside ${L[5].name}, ${(-L[5].top).toFixed(0)} m down.`,
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
        hint: `A Condenser only works inside ${L[0].name}, high above the raft.`,
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
        hint: 'Launch Pad, an Engine on it, Tanks above, the Capsule on top.',
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
