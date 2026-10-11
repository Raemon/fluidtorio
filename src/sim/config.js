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
    cost: 3,
    salvage: 0,
    desc: 'Solid block: full weight, full strength.',
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
    desc: 'Sealed and hollow: light and buoyant, but weak. Floods if cracked below the surface.',
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
    desc: 'Grapples flotsam within 17 m by itself. Build it where the flotsam is.',
  },
  lab: {
    name: 'Lab',
    key: '4',
    group: 'industry',
    fixedMat: 'salvage',
    fill: 0.5,
    equip: 0.8,
    sMul: 0.8,
    cost: 0,
    salvage: 7,
    desc: 'Rebuilt from your test gear. Tests samples exactly: density, strength, reactions, alloys. One test at a time.',
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
    desc: 'Fuses two materials into an alloy (3 + 3 → 4). Some pairs explode.',
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
    desc: 'Draws fuel. Works only inside the fuel layer.',
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
    desc: 'Collects oxidiser. Works only inside the oxidiser layer.',
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
    desc: 'Turns 1 fuel + 1 oxidiser into 1 propellant.',
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
    desc: 'Engines must stand on one.',
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
    desc: '110 kN of thrust, burning 1 propellant a second. Stands on a Launch Pad.',
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
    desc: 'Holds 8 propellant. Stacks on an engine or another tank.',
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
    desc: 'You ride in this. Exactly one, on top of the rocket.',
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
    desc: 'What is left of your lander. Grapples within 24 m. Lose it and the game is over.',
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
  density: { name: 'Densitometer', short: 'Weigh', units: 1, time: 6, desc: 'Exact density.' },
  press: { name: 'Crush press', short: 'Crush', units: 2, time: 10, desc: 'Exact strength, and whether it warns before it breaks.' },
  soak: { name: 'Soak bath', short: 'Soak', units: 1, time: 12, desc: 'How it reacts with every layer of sea and sky, safely.' },
  crucible: { name: 'Crucible', short: 'Crucible', units: 1, time: 8, desc: 'How two materials fuse, safely. A thimble-sized smelt.' },
};
