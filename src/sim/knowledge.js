import { pairKey, getAlloy, materialById } from './gen.js';

export const D_PRIOR = [0.05, 6];
export const S_PRIOR = [10, 4000];
const CROSS = ['strong', 'volatile', 'dull'];

function fmt(x, digits = 2) {
  return Number(x).toFixed(digits);
}

export class Knowledge {
  constructor(game) {
    this.game = game;
    this.planet = game.planet;
    this.mats = new Map();
    this.pairs = new Map();
    this.inferred = new Map();
    this.ensure(this.planet.salvage, true);
    for (const m of this.planet.materials) this.ensure(m);
  }

  /** Carry a previous attempt's notebook onto the same planet. */
  importFrom(old) {
    const planet = this.planet;
    for (const [id, k] of old.mats) {
      let mat = materialById(planet, id);
      if (!mat && k.mat.kind === 'alloy') {
        const [a, b] = k.mat.parents.map((p) => materialById(planet, p));
        mat = a && b ? getAlloy(planet, a, b) : null;
      }
      if (!mat || mat.kind === 'salvage') continue;
      const n = this.ensure(mat);
      n.seen = k.seen;
      n.d = k.d.slice();
      n.s = k.s.slice();
      n.b = k.b;
      n.bHint = k.bHint;
      n.react = k.react.slice();
      n.firstCrack = k.firstCrack;
      n.firstBreak = k.firstBreak;
    }
    for (const [key, o] of old.pairs) this.pairs.set(key, o);
    this.infer();
  }

  ensure(mat, exact = false) {
    let k = this.mats.get(mat.id);
    if (k) return k;
    k = {
      mat,
      seen: exact,
      d: exact ? [mat.d, mat.d] : D_PRIOR.slice(),
      s: exact ? [mat.s, mat.s] : S_PRIOR.slice(),
      b: exact ? mat.b : null,
      bHint: null,
      react: exact ? mat.react.slice() : new Array(6).fill(null),
      exposure: new Array(6).fill(0),
      firstCrack: false,
      firstBreak: false,
      lastLowerNote: 0,
      exact,
    };
    this.mats.set(mat.id, k);
    return k;
  }

  get(mat) {
    return this.ensure(mat);
  }

  note(text, kind = 'info', mat = null) {
    this.game.log(text, kind, mat);
  }

  see(mat) {
    const k = this.ensure(mat);
    if (!k.seen) {
      k.seen = true;
      this.game.emit('discover', mat);
    }
  }

  densityInterval(mat, lo, hi, why) {
    const k = this.ensure(mat);
    if (k.exact) return;
    const nlo = Math.max(k.d[0], lo);
    const nhi = Math.min(k.d[1], hi);
    if (nlo > nhi) return;
    const before = k.d[1] - k.d[0];
    if (nhi - nlo < before - 1e-6) {
      k.d = [nlo, nhi];
      const after = nhi - nlo;
      if (why && before - after > 0.004) {
        const val = after < 0.05 ? `≈ ${fmt((nlo + nhi) / 2)}` : `${fmt(nlo)}–${fmt(nhi)}`;
        this.note(`${mat.name}: density ${val} t/m³ (${why})`, 'learn', mat);
      }
      this.game.emit('knowledge', mat);
    }
  }

  strengthLower(mat, v) {
    const k = this.ensure(mat);
    if (k.exact || v <= k.s[0]) return;
    const old = k.s[0];
    k.s[0] = Math.min(v, k.s[1]);
    const t = this.game.time;
    if (k.s[0] > old * 1.25 && t - k.lastLowerNote > 4) {
      k.lastLowerNote = t;
      this.note(`${mat.name} held ${Math.round(v)} kN at a joint without trouble.`, 'learn', mat);
    }
    this.game.emit('knowledge', mat);
  }

  strengthUpper(mat, v, why) {
    const k = this.ensure(mat);
    if (k.exact || v >= k.s[1]) return;
    k.s[1] = Math.max(v, k.s[0]);
    if (why) this.note(`${mat.name}: ${why} — strength under ${Math.round(v)} kN.`, 'warn', mat);
    this.game.emit('knowledge', mat);
  }

  strengthExact(mat, v, err = 0.02) {
    const k = this.ensure(mat);
    k.s = [v * (1 - err), v * (1 + err)];
    this.game.emit('knowledge', mat);
  }

  brittleness(mat, b, how) {
    const k = this.ensure(mat);
    if (k.b !== null) return;
    k.b = b;
    if (how) this.note(`${mat.name} is ${brittleWord(b)} ${how}.`, 'learn', mat);
    this.game.emit('knowledge', mat);
  }

  brittleHint(mat, b) {
    const k = this.ensure(mat);
    if (k.b !== null || k.bHint !== null) return;
    k.bHint = b;
    this.note(`${mat.name} gave ${b > 0.6 ? 'almost no' : b > 0.35 ? 'some' : 'plenty of'} warning before it broke: it looks ${brittleWord(b)}.`, 'learn', mat);
    this.game.emit('knowledge', mat);
  }

  reaction(mat, layer, type, how) {
    const k = this.ensure(mat);
    if (k.react[layer] === type) return;
    const prev = k.react[layer];
    k.react[layer] = type;
    if (type !== 'none' || how) {
      const L = this.planet.layers[layer];
      const verb = type === 'corrode' ? (layer === 0 ? 'oxidises (burns) in' : 'corrodes in') : type === 'swell' ? 'soaks up and swells in' : 'is inert in';
      if (type !== 'none' || prev === null) {
        if (type !== 'none') this.note(`${mat.name} ${verb} ${L.name}!`, 'warn', mat);
      }
    }
    this.game.emit('knowledge', mat);
  }

  exposed(mat, layer, dt) {
    const k = this.ensure(mat);
    if (k.react[layer] !== null || layer < 0 || layer > 5) return;
    const real = mat.react[layer];
    if (real !== 'none') {
      this.reaction(mat, layer, real);
      return;
    }
    k.exposure[layer] += dt;
    if (k.exposure[layer] > 3) this.reaction(mat, layer, 'none');
  }

  pairResult(a, b, outcome, how) {
    const key = pairKey(a, b);
    if (this.pairs.get(key) === outcome) return;
    this.pairs.set(key, outcome);
    const word = { strong: 'fuse into something remarkable', plain: 'blend into an ordinary alloy', dull: 'make a weak, crumbly alloy', volatile: 'react violently' }[outcome];
    this.note(`${a.name} + ${b.name} ${word}${how ? ` (${how})` : ''}.`, outcome === 'volatile' ? 'bad' : outcome === 'strong' ? 'good' : 'learn');
    this.infer();
    this.game.emit('knowledge', null);
  }

  /** Enumerate every hidden temper assignment consistent with what has been seen. */
  infer() {
    const mats = this.planet.materials;
    const n = mats.length;
    const known = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const o = this.pairs.get(pairKey(mats[i], mats[j]));
        if (o) known.push([i, j, o]);
      }
    const possible = new Map();
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const t = new Array(n).fill(0);
    const total = 3 ** n;
    for (let code = 0; code < total; code++) {
      let c = code;
      for (let i = 0; i < n; i++) {
        t[i] = c % 3;
        c = Math.floor(c / 3);
      }
      for (const perm of perms) {
        const outcomeOf = (i, j) => {
          if (t[i] === t[j]) return 'plain';
          const lo = Math.min(t[i], t[j]),
            hi = Math.max(t[i], t[j]);
          const set = lo === 0 && hi === 1 ? 0 : lo === 1 && hi === 2 ? 1 : 2;
          return CROSS[perm[set]];
        };
        let ok = true;
        for (const [i, j, o] of known)
          if (outcomeOf(i, j) !== o) {
            ok = false;
            break;
          }
        if (!ok) continue;
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const key = pairKey(mats[i], mats[j]);
            let s = possible.get(key);
            if (!s) possible.set(key, (s = new Set()));
            s.add(outcomeOf(i, j));
          }
      }
    }
    this.inferred = possible;
  }

  pairPossible(a, b) {
    const key = pairKey(a, b);
    const direct = this.pairs.get(key);
    if (direct) return { known: direct, possible: new Set([direct]), direct: true };
    const s = this.inferred.get(key);
    if (s && s.size === 1) return { known: [...s][0], possible: s, direct: false };
    return { known: null, possible: s || new Set(['plain', ...CROSS]), direct: false };
  }

  estimateDensity(mat, which = 'mid') {
    const k = this.ensure(mat);
    if (which === 'lo') return k.d[0];
    if (which === 'hi') return k.d[1];
    return Math.sqrt(k.d[0] * k.d[1]);
  }

  estimateStrength(mat, which = 'mid') {
    const k = this.ensure(mat);
    if (which === 'lo') return k.s[0];
    if (which === 'hi') return k.s[1];
    return Math.sqrt(k.s[0] * k.s[1]);
  }
}

export function brittleWord(b) {
  return b > 0.75 ? 'brittle' : b > 0.5 ? 'stiff' : b > 0.25 ? 'firm' : 'ductile';
}
