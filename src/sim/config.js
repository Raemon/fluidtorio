export const G = 9.8;
export const DT = 1 / 60;

export const WORLD_HALF_WIDTH = 170;
export const ESCAPE_ALTITUDE = 120;
export const ESCAPE_SPEED = 170;

export const SHEAR = 0.65;
export const LATERAL_WEIGHT = 0.35;
export const CORRODE_RATE = 1 / 45;
export const SWELL_TIME = 22;
export const SWELL_GAIN = 0.7;

export const GRAPPLE_REACH_CORE = 24;
export const GRAPPLE_REACH_CRANE = 17;
export const GRAPPLE_SPEED = 30;
export const REEL_SPEED = 7;
export const GRAPPLE_MAX_FORCE = 140;

export const PROPELLANT_MASS = 0.2;
export const ENGINE_THRUST = 110;
export const ENGINE_BURN = 1.0;
export const TANK_CAPACITY = 8;
export const EXTRACT_PERIOD = 3.5;

export const DIFFICULTIES = {
  relaxed: { label: 'Relaxed', minutes: 40, tremorScale: 0.7 },
  standard: { label: 'Standard', minutes: 28, tremorScale: 1 },
  harrowing: { label: 'Harrowing', minutes: 19, tremorScale: 1.25 },
};

export const FUNCS = {
  frame: {
    name: 'Frame',
    key: '1',
    group: 'structure',
    fill: 1,
    equip: 0,
    sMul: 1,
    cost: 4,
    salvage: 0,
    desc: 'Solid block. Full weight, full strength. Heavy below the waterline makes a stabilising keel.',
  },
  hollow: {
    name: 'Float',
    key: '2',
    group: 'structure',
    fill: 0.3,
    equip: 0,
    sMul: 0.45,
    cost: 2,
    salvage: 0,
    floodable: true,
    desc: 'Hollow, sealed block: 30% of the weight, 45% of the strength. Floods if cracked or corroded under the surface.',
  },
  crane: {
    name: 'Crane',
    key: '3',
    group: 'harvest',
    fill: 0.5,
    equip: 0.6,
    sMul: 0.8,
    cost: 5,
    salvage: 2,
    reach: 17,
    desc: 'Automatically hauls in flotsam within 17 m. Put one deep on a keel to reach the heavy stuff.',
  },
  lab: {
    name: 'Lab',
    key: '4',
    group: 'industry',
    fill: 0.5,
    equip: 0.8,
    sMul: 0.8,
    cost: 5,
    salvage: 4,
    desc: 'Runs tests on samples: exact density, crush strength, reactivity, alloy crucibles. More labs, more tests at once.',
  },
  smelter: {
    name: 'Smelter',
    key: '5',
    group: 'industry',
    fill: 0.6,
    equip: 1.4,
    sMul: 0.9,
    cost: 7,
    salvage: 3,
    heat: 1,
    desc: 'Fuses two materials into an alloy (3 + 3 → 4). Some pairs are spectacular. Some pairs explode.',
  },
  pump: {
    name: 'Pump',
    key: '6',
    group: 'industry',
    fill: 0.5,
    equip: 0.7,
    sMul: 0.8,
    cost: 4,
    salvage: 3,
    desc: 'Draws fuel. Only works with its intake inside the fuel layer, far below.',
  },
  condenser: {
    name: 'Condenser',
    key: '7',
    group: 'industry',
    fill: 0.5,
    equip: 0.7,
    sMul: 0.8,
    cost: 4,
    salvage: 3,
    desc: 'Condenses oxidiser. Only works inside the high oxidiser layer of the sky.',
  },
  refinery: {
    name: 'Refinery',
    key: '8',
    group: 'industry',
    fill: 0.6,
    equip: 1.2,
    sMul: 0.9,
    cost: 6,
    salvage: 3,
    heat: 0.6,
    desc: 'Mixes fuel and oxidiser into propellant (1 + 1 → 1).',
  },
  pad: {
    name: 'Launch Pad',
    key: '9',
    group: 'rocket',
    fill: 1,
    equip: 0.4,
    sMul: 1.2,
    cost: 6,
    salvage: 1,
    desc: 'Rocket engines must stand directly on a pad.',
  },
  engine: {
    name: 'Engine',
    key: '0',
    group: 'rocket',
    rocket: true,
    fill: 0.6,
    equip: 1.5,
    sMul: 1,
    cost: 5,
    salvage: 3,
    desc: '110 kN of thrust, burning 1 propellant per second. Must stand on a Launch Pad.',
  },
  tank: {
    name: 'Tank',
    key: 't',
    group: 'rocket',
    rocket: true,
    fill: 0.3,
    equip: 0,
    sMul: 0.6,
    cost: 3,
    salvage: 0,
    desc: 'Holds 8 propellant (1.6 t when full). Under thrust its shell carries everything above it, at several g.',
  },
  capsule: {
    name: 'Capsule',
    key: 'c',
    group: 'rocket',
    rocket: true,
    fixedMat: 'salvage',
    fill: 0.5,
    equip: 1.0,
    sMul: 1,
    cost: 0,
    salvage: 8,
    desc: 'You ride in this. Exactly one, on top of the rocket. Built from salvage.',
  },
  core: {
    name: 'Lander Core',
    key: null,
    group: 'none',
    fixedMat: 'salvage',
    fill: 1,
    equip: 2.0,
    sMul: 1.6,
    cost: 0,
    salvage: 0,
    desc: 'What is left of your lander. Grapples flotsam within 24 m. If it is lost, so are you.',
  },
};

export const BUILD_ORDER = [
  'frame',
  'hollow',
  'crane',
  'lab',
  'smelter',
  'pump',
  'condenser',
  'refinery',
  'pad',
  'engine',
  'tank',
  'capsule',
];

export const LAB_TESTS = {
  density: { name: 'Densitometer', units: 1, time: 6, desc: 'Weigh a sample and measure what it displaces. Exact density.' },
  press: { name: 'Crush press', units: 2, time: 10, desc: 'Load a sample until it fails. Exact strength and brittleness.' },
  soak: { name: 'Soak bath', units: 1, time: 12, desc: 'Sample every layer of sea and sky. Reveals all reactions.' },
  crucible: { name: 'Crucible', units: 1, time: 8, desc: 'A thimble-sized smelt of two materials. Reveals how they fuse.' },
};
