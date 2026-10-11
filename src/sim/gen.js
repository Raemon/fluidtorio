import { Rng, hashString, clamp } from './rng.js';
import { G } from './config.js';

const MAT_PRE = [
  'cor', 'lum', 'bras', 'fer', 'syl', 'vel', 'quar', 'obs', 'thal', 'zir', 'mor', 'kel', 'ner', 'pyr', 'ast',
  'dra', 'gal', 'hel', 'ith', 'jas', 'kry', 'lir', 'mag', 'nov', 'orv', 'pel', 'rho', 'sel', 'tor', 'ulv',
  'vor', 'xan', 'yth', 'zel', 'cal', 'ond', 'bry', 'cin', 'fal', 'gor',
];
const MAT_MID = ['', '', 'a', 'e', 'i', 'o', 'an', 'er', 'il', 'on', 'ur', 'ev'];
const MAT_SUF = ['ite', 'ex', 'ane', 'ium', 'oth', 'ine', 'ase', 'yl', 'ar', 'on', 'ide', 'um', 'ax', 'ene', 'ist'];

const LAYER_NAMES = {
  thin: [['Argent', 'Ozonic', 'Halcyon', 'Vitriol', 'Glacial', 'Cobalt'], ['Vault', 'Reach', 'Canopy', 'Heights', 'Shelf']],
  clear: [['Pale', 'Lucid', 'Glass', 'Still', 'Bright', 'Open'], ['Sky', 'Air', 'Expanse', 'Blue', 'Gap']],
  murk: [['Ash', 'Sulfur', 'Ochre', 'Smoke', 'Sepia', 'Cinder'], ['Haze', 'Murk', 'Pall', 'Fog', 'Veil']],
  l1: [['Glimmer', 'Amber', 'Honey', 'Saffron', 'Pearl', 'Rose', 'Citrine'], ['oil', 'gloss', 'slick', 'wash', 'sheen']],
  l2: [['Quick', 'Jade', 'Cobalt', 'Teal', 'Verdi', 'Glass', 'Cyan'], ['brine', 'mere', 'flux', 'water', 'well']],
  l3: [['Pyro', 'Naphth', 'Ember', 'Garnet', 'Wine', 'Ink'], ['sump', 'mire', 'deep', 'flux', 'pool']],
};

const PATTERNS = ['strata', 'crystal', 'speckle', 'fiber', 'glass', 'metal'];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

function layerName(rng, kind) {
  const [a, b] = LAYER_NAMES[kind];
  if (kind === 'thin' || kind === 'clear' || kind === 'murk') return `${rng.pick(a)} ${rng.pick(b)}`;
  return rng.pick(a) + rng.pick(b);
}

function crackFromBrittle(b) {
  return 0.97 - 0.42 * (1 - b);
}

export function generatePlanet(seed) {
  const rng = new Rng(seed);

  const hOx = rng.range(15, 19);
  const hMurk = rng.range(4.5, 6.5);
  const d1 = -rng.range(7, 9.5);
  const d2 = -rng.range(15, 18.5);
  const floor = -rng.range(33, 38);

  const rho1 = rng.range(0.82, 0.97);
  const rho2 = rho1 * rng.range(1.42, 1.62);
  const rho3 = rho2 * rng.range(1.32, 1.5);

  const l1Hue = rng.pick([rng.range(26, 46), rng.range(336, 356), rng.range(12, 24)]);
  const l2Hue = rng.range(165, 200);
  const l3Hue = rng.range(278, 318);

  const layers = [
    {
      id: 0,
      key: 'thin',
      kind: 'air',
      role: 'oxidizer',
      name: layerName(rng, 'thin'),
      rho: 0.0006,
      top: Infinity,
      color: hsl(rng.range(228, 252), 0.55, 0.1),
      current: 0,
      drag: 0.02,
    },
    {
      id: 1,
      key: 'clear',
      kind: 'air',
      role: null,
      name: layerName(rng, 'clear'),
      rho: 0.0012,
      top: hOx,
      color: hsl(rng.range(188, 212), 0.45, 0.5),
      current: 0,
      drag: 0.02,
    },
    {
      id: 2,
      key: 'murk',
      kind: 'air',
      role: null,
      name: layerName(rng, 'murk'),
      rho: 0.005,
      top: hMurk,
      color: hsl(rng.range(22, 42), 0.38, 0.42),
      current: 0,
      drag: 0.03,
    },
    {
      id: 3,
      key: 'l1',
      kind: 'liquid',
      role: null,
      name: layerName(rng, 'l1'),
      rho: rho1,
      top: 0,
      color: hsl(l1Hue, 0.52, 0.36),
      current: rng.sign() * rng.range(0.05, 0.16),
      drag: 1,
    },
    {
      id: 4,
      key: 'l2',
      kind: 'liquid',
      role: null,
      name: layerName(rng, 'l2'),
      rho: rho2,
      top: d1,
      color: hsl(l2Hue, 0.5, 0.25),
      current: rng.sign() * rng.range(0.04, 0.12),
      drag: 1.3,
    },
    {
      id: 5,
      key: 'l3',
      kind: 'liquid',
      role: 'fuel',
      name: layerName(rng, 'l3'),
      rho: rho3,
      top: d2,
      color: hsl(l3Hue, 0.45, 0.15),
      current: rng.sign() * rng.range(0.02, 0.08),
      drag: 1.7,
    },
  ];

  const categories = rng.shuffle(['float', 'i12', 'i23', 'sink', rng.pick(['float', 'i12', 'i23'])]);
  const heights = rng.shuffle([6.5, 9.5, 13, 18, 25]).map((h) => h * rng.range(0.88, 1.12));
  const brittles = rng.shuffle([0.08, 0.3, 0.5, 0.7, 0.92]).map((b) => clamp(b + rng.range(-0.06, 0.06), 0.03, 0.97));
  const tempers = rng.shuffle([0, 0, 1, 1, 2]);
  const patterns = rng.shuffle(PATTERNS.slice());
  const hueBase = rng.range(0, 360);
  const hueOrder = rng.shuffle([0, 1, 2, 3, 4]);
  const usedNames = new Set();

  const materials = [];
  for (let i = 0; i < 5; i++) {
    let pre, suf, name;
    do {
      pre = rng.pick(MAT_PRE) + rng.pick(MAT_MID);
      suf = rng.pick(MAT_SUF);
      name = cap(pre + suf);
    } while (usedNames.has(name) || name.length > 10);
    usedNames.add(name);

    const cat = categories[i];
    let d;
    if (cat === 'float') d = rho1 * rng.range(0.32, 0.72);
    else if (cat === 'i12') d = rho1 + (rho2 - rho1) * rng.range(0.18, 0.82);
    else if (cat === 'i23') d = rho2 + (rho3 - rho2) * rng.range(0.18, 0.82);
    else d = rho3 * rng.range(1.12, 1.6);

    const hMax = heights[i];
    const s = G * hMax * Math.pow(d, 0.6) * 1.2;
    const b = brittles[i];
    const hue = hueBase + hueOrder[i] * 72 + rng.range(-14, 14);
    materials.push({
      id: `m${i}`,
      kind: 'raw',
      name,
      pre: cap(pre),
      suf,
      cat,
      d,
      s,
      b,
      crack: crackFromBrittle(b),
      react: new Array(6).fill('none'),
      temper: tempers[i],
      hue,
      color: hsl(hue, rng.range(0.25, 0.55), rng.range(0.38, 0.62)),
      color2: hsl(hue + rng.range(-40, 40), rng.range(0.2, 0.6), rng.range(0.2, 0.75)),
      pattern: patterns[i],
      spawn: cat === 'sink' ? 0 : cat === 'i23' ? 0.8 : 1,
    });
  }

  const touches = { float: [2, 3], i12: [3, 4], i23: [4, 5], sink: [5] };
  const reactiveLayers = [0, 3, 4, 5];
  const mustCover = rng.shuffle([5, 0, rng.pick([3, 4])]);
  materials.forEach((m, i) => {
    const allowed = reactiveLayers.filter((k) => !touches[m.cat].includes(k));
    const wanted = mustCover[i];
    const picks = [];
    if (wanted !== undefined && allowed.includes(wanted)) picks.push(wanted);
    else if (rng.chance(0.85)) picks.push(rng.pick(allowed));
    if (rng.chance(0.3)) {
      const extra = rng.pick(allowed);
      if (!picks.includes(extra)) picks.push(extra);
    }
    for (const k of picks) {
      m.react[k] = k === 0 ? 'corrode' : rng.chance(0.6) ? 'corrode' : 'swell';
    }
  });

  const outcomes = rng.shuffle(['strong', 'volatile', 'dull']);
  const crossOutcome = {};
  crossOutcome['0,1'] = outcomes[0];
  crossOutcome['1,2'] = outcomes[1];
  crossOutcome['0,2'] = outcomes[2];

  const salvage = {
    id: 'salvage',
    kind: 'salvage',
    name: 'Salvage',
    pre: 'Salv',
    suf: 'age',
    cat: 'known',
    d: 1.25,
    s: G * Math.pow(1.25, 0.6) * 30 * 1.2,
    b: 0.35,
    crack: crackFromBrittle(0.35),
    react: new Array(6).fill('none'),
    temper: null,
    hue: 210,
    color: [0.72, 0.74, 0.78],
    color2: [0.42, 0.46, 0.52],
    pattern: 'plate',
    spawn: 0,
  };

  const planet = {
    seed,
    layers,
    floor,
    materials,
    salvage,
    crossOutcome,
    alloys: new Map(),
  };
  return planet;
}

export function pairKey(a, b) {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

export function pairOutcome(planet, a, b) {
  if (a.kind !== 'raw' || b.kind !== 'raw' || a === b) return null;
  if (a.temper === b.temper) return 'plain';
  const lo = Math.min(a.temper, b.temper);
  const hi = Math.max(a.temper, b.temper);
  return planet.crossOutcome[`${lo},${hi}`];
}

export function getAlloy(planet, a, b) {
  const key = pairKey(a, b);
  if (planet.alloys.has(key)) return planet.alloys.get(key);
  const outcome = pairOutcome(planet, a, b);
  if (!outcome || outcome === 'volatile') return null;
  const [p, q] = a.id < b.id ? [a, b] : [b, a];
  const rng = new Rng(hashString(`${planet.seed}:${key}`));
  const dm = (p.d + q.d) / 2;
  const sm = (p.s + q.s) / 2;
  let d, s, br;
  if (outcome === 'strong') {
    d = dm * rng.range(0.8, 0.94);
    s = sm * rng.range(2.1, 2.8);
    br = Math.min(p.b, q.b) * 0.6;
  } else if (outcome === 'plain') {
    d = dm * rng.range(0.96, 1.05);
    s = sm * rng.range(0.95, 1.2);
    br = (p.b + q.b) / 2;
  } else {
    d = dm * rng.range(1.0, 1.1);
    s = sm * rng.range(0.48, 0.68);
    br = Math.max(p.b, q.b);
  }
  const react = p.react.map((r, k) => (r !== 'none' && r === q.react[k] ? r : 'none'));
  const hue = (p.hue + q.hue) / 2 + (Math.abs(p.hue - q.hue) > 180 ? 180 : 0);
  const name = cap(p.pre.toLowerCase() + q.suf.replace(/^[aeiouy]/, ''));
  const alloy = {
    id: `a:${key}`,
    kind: 'alloy',
    name,
    pre: p.pre,
    suf: q.suf,
    cat: 'alloy',
    parents: [p.id, q.id],
    outcome,
    d,
    s,
    b: br,
    crack: crackFromBrittle(br),
    react,
    temper: null,
    hue,
    color: p.color.map((c, i) => c * 0.5 + q.color[i] * 0.5),
    color2: p.color2.map((c, i) => c * 0.4 + q.color2[i] * 0.6),
    pattern: 'alloy',
    spawn: 0,
  };
  planet.alloys.set(key, alloy);
  return alloy;
}

export function allMaterials(planet) {
  return [planet.salvage, ...planet.materials, ...planet.alloys.values()];
}

export function materialById(planet, id) {
  if (id === 'salvage') return planet.salvage;
  const m = planet.materials.find((x) => x.id === id);
  if (m) return m;
  for (const a of planet.alloys.values()) if (a.id === id) return a;
  return null;
}
