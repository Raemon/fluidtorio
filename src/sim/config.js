export const G = 9.8;
export const DT = 1 / 60;

export const WORLD_HALF_WIDTH = 720;
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
  relaxed: { label: 'Relaxed', minutes: 50, tremorScale: 0.7 },
  standard: { label: 'Standard', minutes: 36, tremorScale: 1 },
  harrowing: { label: 'Harrowing', minutes: 26, tremorScale: 1.25 },
};

/** Cargo: one unit of material is a quarter of a square metre of it (the world is 1 m deep). */
export const UNITS_PER_M2 = 6;
/** Salvage crates and wreckage are mostly air. */
export const PACKED_SALVAGE_DENSITY = 0.5;
export const STOCKPILE_CAPACITY = 12;

/** Colonists. */
export const COLONIST_MASS = 0.09;
export const WALK_SPEED = 2.2;
export const CLIMB_SPEED = 1.2;
export const CAST_REACH = 11;
export const BUILD_TIME = 1.1;
export const ROW_FORCE = 6.5;

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
  stockpile: {
    name: 'Stockpile',
    key: '3',
    group: 'structure',
    fill: 0.35,
    equip: 0,
    sMul: 0.7,
    cost: 3,
    salvage: 0,
    capacity: 12,
    desc: 'A bin that keeps loose cargo from sliding about. Whatever you put in it, its joints carry.',
  },
  crane: {
    name: 'Crane',
    key: '4',
    group: 'harvest',
    fill: 0.5,
    equip: 0.6,
    sMul: 0.8,
    cost: 3,
    salvage: 2,
    reach: 17,
    desc: 'Fishes by itself: hauls in whatever drifts within 17 m. Build it out where the flotsam is.',
  },
  smelter: {
    name: 'Smelter',
    key: '5',
    group: 'industry',
    fill: 0.6,
    equip: 1.4,
    sMul: 0.9,
    cost: 4,
    salvage: 3,
    heat: 1,
    desc: 'Fuses two materials into an alloy (3 + 3 → 4). Some pairs explode: build it out on a limb.',
  },
  pump: {
    name: 'Pump',
    key: '6',
    group: 'industry',
    fill: 0.5,
    equip: 0.7,
    sMul: 0.8,
    cost: 3,
    salvage: 2,
    desc: 'Draws fuel. Works only inside the fuel layer.',
  },
  condenser: {
    name: 'Condenser',
    key: '7',
    group: 'industry',
    fill: 0.5,
    equip: 0.7,
    sMul: 0.8,
    cost: 3,
    salvage: 2,
    desc: 'Collects oxidiser. Works only inside the oxidiser layer.',
  },
  refinery: {
    name: 'Refinery',
    key: '8',
    group: 'industry',
    fill: 0.6,
    equip: 1.2,
    sMul: 0.9,
    cost: 4,
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
    cost: 4,
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
    cost: 4,
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
    cost: 2,
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
    desc: 'What is left of your lander: the helm and the anchor winch. Lose it and the game is over.',
  },
};

export const BUILD_ORDER = [
  'frame',
  'hollow',
  'stockpile',
  'crane',
  'smelter',
  'pump',
  'condenser',
  'refinery',
  'pad',
  'engine',
  'tank',
  'capsule',
];
