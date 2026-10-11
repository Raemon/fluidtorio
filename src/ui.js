import { FUNCS, GRAPPLE_REACH_CRANE, CAST_REACH, ESCAPE_SPEED } from './sim/config.js';
import { DROP_COST } from './sim/experiments.js';
import { allMaterials, materialById } from './sim/gen.js';
import { iconDataURL, swatchDataURL, toCss } from './render/textures.js';
import { predictJoints, classify, colonyStatus, predictRocket, ghostFluid } from './sim/predict.js';
import { brittleWord, D_PRIOR, S_PRIOR } from './sim/knowledge.js';
import { pl } from './sim/physics.js';
import { keyOf } from './sim/structure.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Palette groups, in the order they tend to become available. */
const GROUPS = [
  ['stockpile', 'frame', 'hollow'],
  ['crane', 'smelter'],
  ['pump', 'condenser', 'refinery'],
  ['pad', 'engine', 'tank', 'capsule'],
];
const TOOLS = [
  ['drop', null, 'drop', 'G'],
  ['repair', '✚', 'patch', 'R'],
];

const OUTCOME_GLYPH = { strong: '★', plain: '○', dull: '▽', volatile: '✸' };
const OUTCOME_WORD = { strong: 'superb', plain: 'ordinary', dull: 'crumbly', volatile: 'explosive' };

/** Static tooltips: [title, key, body]. Keep them short. */
const TIPS = {
  help: ['Field manual', 'H', 'Goals, physics and controls.'],
  pause: ['Pause', 'Space', 'You can still build while paused.'],
  speed: ['Game speed', ', .', 'Click to cycle 1× · 2× · 4×.'],
  lens: ['Density lens', 'hold Shift', 'See density itself. Anything that matches its surroundings vanishes.'],
  schl: ['Density view', 'Tab', 'The whole screen as density.'],
  stress: ['Stress view', 'V', 'Load on every joint, judged from what you know. Green holds, amber might not, red will fail.'],
  tremor: ['Swell incoming', '', 'The volcano is shaking the sea. Your colony is about to rock.'],
  'nb-open': ['Notebook', 'N', 'What you know about each material.'],
  'nb-close': ['Close notebook', 'N', ''],
  'tab-mats': ['Materials', '', 'Each property is a range: everything it could still be.'],
  'tab-alloys': ['Alloys', '', 'How pairs fuse. One hidden rule decides every pair.'],
  density: ['Density', '', 'Tonnes per m³. Coloured ticks are the liquids: anything lighter than a tick floats on that liquid.'],
  strength: ['Strength', '', 'Load one joint can carry. Learned from joints that hold, crack or snap under load.'],
  column: ['Column', '', 'How tall a solid column of it stands before its base gives way.'],
  temper: ['Temper', '', 'Brittle materials barely crack before they snap. Ductile ones warn you first.'],
  'res-fuel': ['Fuel', '', 'Pumped from the deep. Refined with oxidiser into propellant.'],
  'res-ox': ['Oxidiser', '', 'Condensed from the high air. Refined with fuel into propellant.'],
  'res-prop': ['Propellant', '', 'Rocket fuel. Loaded into the tanks at launch.'],
  'f-mass': ['Mass', '', 'Fuelled, as far as you know its materials.'],
  'f-twr': ['Thrust ÷ weight', '', 'Above 1 it lifts off. Higher climbs faster.'],
  'f-prop': ['Propellant', '', 'Loaded at launch, up to what the tanks hold.'],
  'f-speed': ['Top speed', '', `Fastest it gets before the propellant runs out. Escape takes ${ESCAPE_SPEED} m/s.`],
  'f-struct': ['Under thrust', '', 'Whether the stack holds together at full acceleration.'],
  launch: ['Launch', '', 'The stack leaves the colony. There is no calling it back.'],
  'mp-patch': ['Patch', 'R', 'Restore its joints for 1 unit of its material.'],
  'mp-jettison': ['Jettison', 'J', 'Cut it loose. Where it settles, and how deep it floats, tells you its density.'],
  'mp-dismantle': ['Dismantle', 'right-click', 'Take it apart and get 75% back.'],
  'mp-auto': ['Auto-haul', '', 'Let this crane grab whatever drifts into reach.'],
  'crew-auto': ['Fish by themselves', '', 'They’ll cast at whatever floats within reach whenever there’s nothing more pressing to do.'],
  'mp-stow': ['Stow', '', 'Someone carries it to a stockpile with room.'],
  'mp-throw': ['Throw overboard', '', 'Someone carries it to the edge and heaves it out. Lighter raft; and you can watch where it ends up.'],
  'mp-row': ['Row', '', 'Hauls up the anchor; anyone not busy goes to the edge and rows. A heavy raft rows slow.'],
  'mp-stop': ['Stop rowing', '', 'The raft drifts with the current until the anchor is down.'],
  'mp-anchor': ['Anchor', '', 'Down, the chain holds you where you are. Up, you drift.'],
  heel: ['Heel', '', 'How far the colony leans. Top-heavy builds lean more. Past about 25° it can capsize.'],
  damage: ['Worst joint', '', 'Damage on the most worn joint. Patch it, or take load off before it snaps.'],
  smelt: ['Smelt', '3 + 3 → 4', 'Sets an idle Smelter to this pair. Untested pairs can explode: keep that Smelter away from the core.'],
};

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function logPos(x, lo, hi) {
  return Math.max(0, Math.min(1, (Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
}

function tip(title, key, body, meta) {
  return `<div class="tt-title">${title}${key ? `<span class="tt-key">${key}</span>` : ''}</div>${body ? `<div class="tt-dim">${body}</div>` : ''}${meta ? `<div class="tt-meta">${meta}</div>` : ''}`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.tool = 'select';
    this.fn = 'frame';
    this.matId = 'salvage';
    this.hover = null;
    this.ghost = null;
    this.stressView = false;
    this.stressPreds = null;
    this.stressT = 0;
    this.tab = 'mats';
    this.journalOpen = false;
    this.selected = null;
    this.dirty = { chips: true, palette: true, journal: true, goal: true, status: true };
    this.swatches = new Map();
    this.icons = new Map();
    this.logEls = [];
    this.hoverT = 0;
    this.lastPred = 0;
    this.pair = null;
    this.mouse = { x: 0, y: 0, in: false };
    this.cardPulse = new Set();
    this.fresh = new Set();
    this.tipEl = null;
    this.tipSince = 0;
    this.tipShownAt = 0;
    this.rulerX = 66;
    this.wireStatic();
  }

  get game() {
    return this.app.game;
  }

  get R() {
    return this.app.renderer;
  }

  bind(game) {
    this.tool = 'select';
    this.fn = 'frame';
    this.matId = 'salvage';
    this.selected = null;
    this.pair = null;
    this.hover = null;
    this.ghost = null;
    this.stressPreds = null;
    this.stressView = false;
    this.tab = 'mats';
    this.goalFlash = null;
    this.swatches.clear();
    this.icons.clear();
    this.fresh.clear();
    for (const el of this.logEls) el.remove();
    this.logEls = [];
    this.lensLatched = false;
    for (const id of ['btn-lens', 'btn-schl', 'btn-stress']) $(id).classList.remove('on');
    document.querySelectorAll('.j-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'mats'));
    $('volcano-name').textContent = game.volcanoName();
    game.on('log', (e) => this.addLog(e));
    game.on('stock', () => {
      this.dirty.chips = true;
      this.dirty.palette = true;
      this.dirty.journal = true;
      this.dirty.status = true;
    });
    game.on('knowledge', (m) => {
      this.dirty.journal = true;
      this.dirty.status = true;
      this.dirty.chips = true;
      this.stressPreds = null;
      if (m) this.cardPulse.add(m.id);
    });
    game.on('discover', (m) => {
      this.dirty.chips = true;
      this.dirty.journal = true;
      if (m && m.kind !== 'salvage') {
        this.fresh.add('mat:' + m.id);
        this.cardPulse.add(m.id);
      }
    });
    game.on('labs', () => (this.dirty.journal = true));
    game.on('modules', () => (this.dirty.journal = true));
    game.on('built', () => {
      this.stressPreds = null;
      this.lastPredKey = null;
      this.dirty.status = true;
      this.dirty.goal = true;
    });
    game.on('unlock', (u) => this.onUnlock(u));
    game.on('goal', (gl) => {
      this.goalFlash = { title: gl.title, until: performance.now() + 2600 };
      this.dirty.goal = true;
      this.app.audio && this.app.audio.play('collect');
    });
    this.setJournal(game.progress.has('notebook') && window.innerWidth > 980, true);
    this.syncViews();
    this.markAll();
    this.renderPalette();
  }

  markAll() {
    for (const k of Object.keys(this.dirty)) this.dirty[k] = true;
  }

  onUnlock(u) {
    for (const id of u.ids) {
      if (FUNCS[id]) this.fresh.add('fn:' + id);
      if (id === 'patch') this.fresh.add('tool:repair');
      if (id === 'drop') this.fresh.add('tool:drop');
      if (id === 'lens') this.fresh.add('lens');
      if (id === 'stress') this.fresh.add('stress');
      if (id === 'notebook') {
        if (window.innerWidth > 980) this.setJournal(true, true);
        else this.fresh.add('nb-open');
      }
    }
    this.syncViews();
    this.dirty.palette = true;
    this.dirty.chips = true;
    this.dirty.journal = true;
    this.dirty.status = true;
  }

  /** Show only the view toggles, tabs and notebook handle the colony has a use for yet. */
  syncViews() {
    const P = this.game && this.game.progress;
    if (!P) return;
    const lens = P.has('lens');
    $('btn-lens').classList.toggle('hidden', !lens);
    $('btn-schl').classList.toggle('hidden', !lens);
    $('btn-stress').classList.toggle('hidden', !P.has('stress'));
    document.querySelector('.view-sep').classList.toggle('hidden', !lens && !P.has('stress'));
    const alloys = P.has('alloys');
    document.querySelector('.j-tab[data-tab="alloys"]').classList.toggle('hidden', !alloys);
    document.querySelector('.j-tabs').classList.toggle('single', !alloys);
    if (!alloys && this.tab === 'alloys') this.tab = 'mats';
    $('journal-open').classList.toggle('hidden', this.journalOpen || !P.has('notebook'));
    for (const [id, el] of [
      ['lens', $('btn-lens')],
      ['stress', $('btn-stress')],
      ['nb-open', $('journal-open')],
    ])
      el.classList.toggle('fresh', this.fresh.has(id));
  }

  wireStatic() {
    document.querySelectorAll('.j-tab').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        document.querySelectorAll('.j-tab').forEach((x) => x.classList.toggle('active', x === b));
        this.dirty.journal = true;
        this.app.click();
      }),
    );
    $('j-collapse').addEventListener('click', () => this.toggleJournal());
    $('journal-open').addEventListener('click', () => this.toggleJournal());
    $('btn-lens').addEventListener('click', () => {
      this.lensLatched = !this.lensLatched;
      $('btn-lens').classList.toggle('on', this.lensLatched);
      this.app.click();
    });
    $('btn-schl').addEventListener('click', () => this.toggleSchlieren());
    $('btn-stress').addEventListener('click', () => this.toggleStress());
    $('btn-pause').addEventListener('click', () => this.app.setSpeed(0));
    $('btn-speed').addEventListener('click', () => this.app.setSpeed(this.app.speed === 1 ? 2 : this.app.speed === 2 ? 4 : 1));
    $('btn-help').addEventListener('click', () => this.app.showHelp(true));
    $('j-body').addEventListener('click', (e) => this.onJournalClick(e));
    $('palette').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fn],[data-tool]');
      if (!b) return;
      if (b.dataset.fn) {
        if (this.tool === 'build' && this.fn === b.dataset.fn) this.setTool('select');
        else this.pickFn(b.dataset.fn);
      } else this.setTool(this.tool === b.dataset.tool ? 'select' : b.dataset.tool);
    });
    $('mat-chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-mat]');
      if (!c) return;
      this.matId = c.dataset.mat;
      if (this.tool === 'drop') {
        this.dirty.chips = true;
        this.dirty.palette = true;
        return this.app.click();
      }
      const keep = this.tool === 'build' && !FUNCS[this.fn].fixedMat;
      this.pickFn(keep ? this.fn : 'frame');
    });
    $('forecast').addEventListener('click', (e) => {
      if (e.target.closest('#launch-btn')) {
        this.game.rocket.launch();
        this.app.followRocket = true;
      }
    });
    $('module-panel').addEventListener('click', (e) => this.onModuleClick(e));
    $('module-panel').addEventListener('change', (e) => this.onModuleChange(e));

    // one tooltip system for every HUD element carrying data-tip
    const hud = $('hud');
    hud.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t === this.tipEl) return;
      this.tipEl = t || null;
      this.tipSince = performance.now();
      if (t) this.clearFresh(t.dataset.tip);
    });
    hud.addEventListener('pointerout', (e) => {
      const to = e.relatedTarget;
      const t = to && to.closest ? to.closest('[data-tip]') : null;
      if (!t || !hud.contains(t)) this.tipEl = null;
    });
    window.addEventListener('pointermove', (e) => {
      this.screenMouse = { x: e.clientX, y: e.clientY };
    });
  }

  clearFresh(key) {
    if (!this.fresh.has(key)) return;
    this.fresh.delete(key);
    this.dirty.palette = true;
    this.dirty.chips = true;
    this.syncViews();
  }

  setJournal(open, silent = false) {
    this.journalOpen = open;
    $('journal').classList.toggle('hidden', !open);
    document.body.classList.toggle('journal-open', open);
    if (open) this.fresh.delete('nb-open');
    this.syncViews();
    this.dirty.journal = true;
    if (!silent) this.app.click();
  }

  toggleJournal() {
    if (!this.game.progress.has('notebook')) return;
    this.setJournal(!this.journalOpen);
  }

  toggleSchlieren() {
    const R = this.R;
    R.schlTarget = R.schlTarget > 0.5 ? 0 : 1;
    $('btn-schl').classList.toggle('on', R.schlTarget > 0.5);
    this.app.click();
  }

  toggleStress() {
    this.stressView = !this.stressView;
    this.stressPreds = null;
    $('btn-stress').classList.toggle('on', this.stressView);
    this.clearFresh('stress');
    this.app.click();
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'build') this.ghost = null;
    if (tool === 'repair' || tool === 'drop') this.clearFresh('tool:' + tool);
    this.dirty.palette = true;
    this.dirty.chips = true;
    this.app.click();
  }

  pickFn(fn) {
    if (!this.game.progress.has(fn)) return;
    this.fn = fn;
    this.tool = 'build';
    if (!this.knownMats().some((m) => m.id === this.matId)) this.matId = 'salvage';
    this.clearFresh('fn:' + fn);
    this.ghost = null;
    this.lastPredKey = null;
    this.dirty.palette = true;
    this.dirty.chips = true;
    this.app.click();
  }

  cycleMat(dir) {
    const mats = this.knownMats();
    if (!mats.length) return;
    let i = mats.findIndex((m) => m.id === this.matId);
    i = (i + dir + mats.length) % mats.length;
    this.matId = mats[i].id;
    this.dirty.chips = true;
    this.dirty.palette = true;
    this.lastPredKey = null;
  }

  /** Materials you have seen, in the order you met them, salvage first. */
  knownMats() {
    const g = this.game;
    const kn = g.knowledge;
    const seen = allMaterials(g.planet).filter((m) => kn.mats.has(m.id) && kn.get(m).seen);
    return seen.sort((a, b) => (a.kind === 'salvage' ? -1 : b.kind === 'salvage' ? 1 : (kn.get(a).seenAt || 0) - (kn.get(b).seenAt || 0)));
  }

  get mat() {
    return materialById(this.game.planet, this.matId) || this.game.planet.salvage;
  }

  swatch(mat) {
    let s = this.swatches.get(mat.id);
    if (!s) {
      s = swatchDataURL(mat, 44);
      this.swatches.set(mat.id, s);
    }
    return s;
  }

  icon(fn, mat) {
    const key = fn + ':' + (mat ? mat.id : '');
    let s = this.icons.get(key);
    if (!s) {
      s = iconDataURL(fn, mat, 56);
      this.icons.set(key, s);
    }
    return s;
  }

  // ───────────────────────────── knowledge phrasing

  densityText(k) {
    const [dl, dh] = k.d;
    if (dh / dl < 1.015) return `${((dl + dh) / 2).toFixed(2)}`;
    if (dh >= D_PRIOR[1] - 1e-6 && dl <= D_PRIOR[0] + 1e-6) return '?';
    if (dh >= D_PRIOR[1] - 1e-6) return `> ${dl.toFixed(2)}`;
    if (dl <= D_PRIOR[0] + 1e-6) return `< ${dh.toFixed(2)}`;
    return `${dl.toFixed(2)}–${dh.toFixed(2)}`;
  }

  strengthText(k) {
    const [sl, sh] = k.s;
    if (sh / sl < 1.06) return `${Math.round((sl + sh) / 2)} kN`;
    if (sh >= S_PRIOR[1] - 1 && sl <= S_PRIOR[0] + 1e-6) return '?';
    if (sh >= S_PRIOR[1] - 1) return `> ${Math.round(sl)} kN`;
    return `${Math.round(sl)}–${Math.round(sh)} kN`;
  }

  whereFloats(k) {
    const L = this.game.planet.layers;
    const [lo, hi] = k.d;
    if (hi <= L[3].rho + 1e-6) return `floats on ${L[3].name}`;
    if (lo >= L[3].rho - 1e-6 && hi <= L[4].rho + 1e-6) return `rests on ${L[4].name}`;
    if (lo >= L[4].rho - 1e-6 && hi <= L[5].rho + 1e-6) return `rests on ${L[5].name}`;
    if (lo >= L[5].rho - 1e-6) return `sinks to the floor`;
    return 'density unknown';
  }

  // ───────────────────────────── logging

  addLog(e) {
    if (!e.text) return;
    const last = this.logEls[this.logEls.length - 1];
    if (last && last._text === e.text && performance.now() - last._born < 6000) {
      last._n = (last._n || 1) + 1;
      last._born = performance.now();
      last.querySelector('.log-n').textContent = ` ×${last._n}`;
      return;
    }
    const el = document.createElement('div');
    el.className = `log-line ${e.kind}`;
    const dot = e.mat ? `<span class="mat-dot" style="background:${toCss(e.mat.color)}"></span>` : '';
    const tag = e.kind === 'unlock' ? '<span class="new-tag">NEW</span>' : '';
    el.innerHTML = tag + dot + esc(e.text) + '<span class="log-n"></span>';
    el._text = e.text;
    el._life = e.kind === 'unlock' ? 22 : e.kind === 'info' ? 10 : 14;
    $('log').appendChild(el);
    this.logEls.push(el);
    el._born = performance.now();
    while (this.logEls.length > 5) this.logEls.shift().remove();
    if (e.kind === 'bad' || e.kind === 'warn') this.app.audio && this.app.audio.play(e.kind === 'bad' ? 'warn' : 'click');
    if (e.kind === 'unlock') this.app.audio && this.app.audio.play('pop');
  }

  // ───────────────────────────── per-frame

  update(dt) {
    const g = this.game;
    if (!g) return;
    const left = g.timeLeft();
    const cd = $('cd-time');
    cd.textContent = fmtTime(left);
    cd.classList.toggle('urgent', left < 180);
    $('cd-fill').style.width = `${Math.min(100, (g.time / g.duration) * 100)}%`;
    $('tremor-warn').classList.toggle('hidden', !(g.tremorWarned && g.time < g.tremorAt));
    $('paused-tag').classList.toggle('hidden', !this.app.paused);
    const now = performance.now();
    for (const el of this.logEls) {
      const age = (now - el._born) / 1000;
      el.style.opacity = age > el._life ? 0 : age > el._life - 4 ? 1 - (age - el._life + 4) / 4 : 1;
    }
    this.uiT = (this.uiT || 0) + dt;
    if (this.uiT > 0.25) {
      this.uiT = 0;
      this.dirty.status = true;
      this.dirty.goal = true;
    }
    if (this.dirty.chips && now - (this.chipsAt || 0) > 150) {
      this.chipsAt = now;
      this.renderChips();
    }
    if (this.dirty.palette && now - (this.paletteAt || 0) > 200) {
      this.paletteAt = now;
      this.renderPalette();
    }
    if (this.dirty.journal && this.journalOpen && now - (this.journalAt || 0) > 300) {
      this.journalAt = now;
      this.renderJournal();
    }
    if (this.dirty.goal) this.renderGoal();
    if (this.dirty.status) this.renderStatus();
    this.updateHover(dt);
    this.updateGhost();
    if (this.stressView) {
      this.stressT -= dt;
      if (!this.stressPreds || this.stressT <= 0) {
        this.stressT = 0.35;
        this.stressPreds = g.colony ? predictJoints(g, g.colony) : [];
      }
    }
    this.positionModulePanel();
  }

  // ───────────────────────────── palette & chips

  renderPalette() {
    this.dirty.palette = false;
    const g = this.game;
    const P = g.progress;
    const mat = this.mat;
    const items = [];
    for (const grp of GROUPS) {
      const fns = grp.filter((fn) => P.has(fn));
      if (!fns.length) continue;
      if (items.length) items.push({ gap: true });
      for (const fn of fns) {
        const f = FUNCS[fn];
        const m = f.fixedMat ? g.planet.salvage : mat;
        items.push({
          key: 'fn:' + fn,
          attr: `data-fn="${fn}"`,
          cls: `${this.tool === 'build' && this.fn === fn ? 'active' : ''} ${g.canAfford(fn, m) ? '' : 'poor'} ${this.fresh.has('fn:' + fn) ? 'fresh' : ''}`,
          inner: `<img src="${this.icon(fn, fn === 'frame' || fn === 'hollow' ? m : g.planet.salvage)}" alt="${f.name}"><span class="tkey">${(f.key || '').toUpperCase()}</span>`,
        });
      }
    }
    const tools = TOOLS.filter(([, , unlock]) => P.has(unlock));
    if (tools.length) items.push({ gap: true });
    for (const [id, glyph, , key] of tools)
      items.push({
        key: 'tool:' + id,
        attr: `data-tool="${id}"`,
        cls: `${this.tool === id ? 'active' : ''} ${g.stockOf(mat.id) < DROP_COST && id === 'drop' ? 'poor' : ''} ${this.fresh.has('tool:' + id) ? 'fresh' : ''}`,
        inner: `${glyph ? `<span class="glyph">${glyph}</span>` : `<img class="cube" src="${this.icon('frame', mat)}" alt="Drop"><span class="arrow">↓</span>`}<span class="tkey">${key}</span>`,
      });
    // update in place, so only newly unlocked buttons animate in
    const el = $('palette');
    const shape = items.map((it) => (it.gap ? '|' : it.key)).join(',');
    if (el._shape !== shape) {
      const old = new Set((el._shape || '').split(','));
      el.innerHTML = items.map((it) => (it.gap ? '<div class="pal-gap"></div>' : `<button class="tool ${old.has(it.key) || !el._shape ? '' : 'pop'}" ${it.attr} data-tip="${it.key}"></button>`)).join('');
      el._shape = shape;
    }
    const btns = el.querySelectorAll('.tool');
    let i = 0;
    for (const it of items) {
      if (it.gap) continue;
      const b = btns[i++];
      const cls = `tool ${b.classList.contains('pop') ? 'pop' : ''} ${it.cls}`.replace(/\s+/g, ' ').trim();
      if (b.className !== cls) b.className = cls;
      if (b._inner !== it.inner) {
        b.innerHTML = it.inner;
        b._inner = it.inner;
      }
    }
  }

  renderChips() {
    this.dirty.chips = false;
    const g = this.game;
    const P = g.progress;
    let h = '';
    const building = (this.tool === 'build' && !FUNCS[this.fn].fixedMat) || this.tool === 'drop';
    for (const m of this.knownMats()) {
      const sel = m.id === this.matId;
      const fresh = this.fresh.has('mat:' + m.id) ? 'fresh' : '';
      h += `<button class="chip ${sel && building ? 'active' : ''} ${fresh}" data-mat="${m.id}" data-tip="mat:${m.id}"><img src="${this.swatch(m)}" alt="">${sel ? `<span class="cname">${esc(m.name)}</span>` : ''}<span class="ccount">${g.stockOf(m.id)}</span></button>`;
    }
    const chipsEl = $('mat-chips');
    chipsEl.classList.toggle('hidden', !building);
    if (chipsEl._h !== h) {
      chipsEl.innerHTML = h;
      chipsEl._h = h;
    }
    const res = [];
    if (P.has('pump') || g.stockOf('fuel')) res.push(['fuel', g.stockOf('fuel')]);
    if (P.has('condenser') || g.stockOf('ox')) res.push(['ox', g.stockOf('ox')]);
    if (P.has('refinery') || g.stockOf('prop')) res.push(['prop', g.stockOf('prop')]);
    const rh = res.map(([c, v]) => `<div class="res r-${c}" data-tip="res-${c}"><i></i>${v}</div>`).join('');
    if ($('resources')._h !== rh) {
      $('resources').innerHTML = rh;
      $('resources')._h = rh;
    }
  }

  // ───────────────────────────── goal

  renderGoal() {
    this.dirty.goal = false;
    const g = this.game;
    const el = $('goal');
    const now = performance.now();
    let text,
      done = false;
    if (this.goalFlash && now < this.goalFlash.until) {
      text = this.goalFlash.title;
      done = true;
    } else {
      this.goalFlash = null;
      const gl = g.progress.currentGoal();
      text = gl ? gl.title : '';
    }
    el.classList.toggle('done', done);
    el.classList.toggle('hidden-goal', !text);
    $('goal-mark').textContent = done ? '✓' : '▸';
    if ($('goal-text').textContent !== text) $('goal-text').textContent = text;
  }

  // ───────────────────────────── notebook

  renderJournal() {
    this.dirty.journal = false;
    const body = $('j-body');
    const scroll = body.scrollTop;
    const html = this.tab === 'alloys' ? this.alloysHTML() : this.matsHTML();
    if (body._h !== html) {
      body.innerHTML = html;
      body._h = html;
      body.scrollTop = scroll;
    }
    this.cardPulse.clear();
  }

  matsHTML() {
    const g = this.game;
    const kn = g.knowledge;
    const L = g.planet.layers;
    let h = '';
    const mats = this.knownMats();
    const ordered = mats.filter((m) => m.kind !== 'salvage').concat(mats.filter((m) => m.kind === 'salvage'));
    for (const m of ordered) {
      const k = kn.get(m);
      const pulse = this.cardPulse.has(m.id) ? 'pulse' : '';
      if (m.kind === 'salvage') {
        h += `<div class="card known ${pulse}" data-tip="mat:salvage"><div class="card-head"><img src="${this.swatch(m)}" alt=""><div><div class="nm">${esc(m.name)}</div><div class="sub">fully known · ${m.d.toFixed(2)} t/m³ · ${Math.round(m.s)} kN</div></div><div class="stock">${g.stockOf(m.id)}</div></div></div>`;
        continue;
      }
      const sub = m.kind === 'alloy' ? `alloy of ${m.parents.map((p) => materialById(g.planet, p).name).join(' + ')}` : this.whereFloats(k);
      h += `<div class="card ${pulse}">`;
      h += `<div class="card-head" data-tip="mat:${m.id}"><img src="${this.swatch(m)}" alt=""><div><div class="nm">${esc(m.name)}</div><div class="sub">${sub}</div></div><div class="stock">${g.stockOf(m.id)}</div></div>`;
      const [dl, dh] = k.d;
      const dTxt = this.densityText(k);
      const dA = logPos(dl, 0.1, 6),
        dB = logPos(Math.min(dh, 6), 0.1, 6);
      let ticks = '';
      for (const l of L.slice(3)) ticks += `<span class="tickm" style="left:${logPos(l.rho, 0.1, 6) * 100}%;background:${toCss(l.color.map((c) => Math.min(1, c * 1.8 + 0.1)))}"></span>`;
      h += `<div class="prop" data-tip="d:${m.id}"><span class="pk">Density</span><div class="bar">${ticks}<span class="rng ${dh / dl < 1.015 ? 'exact' : ''} ${dTxt === '?' ? 'unknown' : ''}" style="left:${dA * 100}%;width:${Math.max(0.5, (dB - dA) * 100)}%"></span></div><span class="pv">${dTxt}</span></div>`;
      const [sl, sh] = k.s;
      const sTxt = this.strengthText(k);
      const sA = logPos(sl, 10, 4000),
        sB = logPos(Math.min(sh, 4000), 10, 4000);
      h += `<div class="prop" data-tip="s:${m.id}"><span class="pk">Strength</span><div class="bar"><span class="rng ${sh / sl < 1.06 ? 'exact' : ''} ${sTxt === '?' ? 'unknown' : ''}" style="left:${sA * 100}%;width:${Math.max(0.5, (sB - sA) * 100)}%"></span></div><span class="pv">${sTxt}</span></div>`;
      if (dh < D_PRIOR[1] && sl > S_PRIOR[0] * 1.5) {
        const hLo = sl / (9.8 * dh),
          hHi = sh / (9.8 * dl);
        const ht = sh >= S_PRIOR[1] - 1 ? `≥ ${hLo.toFixed(0)} m` : hHi / hLo < 1.15 ? `≈ ${hLo.toFixed(0)} m` : `${hLo.toFixed(0)}–${hHi.toFixed(0)} m`;
        h += `<div class="prop" data-tip="column"><span class="pk">Column</span><span class="note-small">${ht} tall</span></div>`;
      }
      const bTxt = k.b !== null ? brittleWord(k.b) : k.bHint !== null ? `looks ${brittleWord(k.bHint)}` : null;
      if (bTxt) h += `<div class="prop" data-tip="temper"><span class="pk">Temper</span><span class="note-small">${bTxt}</span></div>`;
      h += `<div class="reacts">`;
      for (let i = 0; i < 6; i++) {
        const r = k.react[i];
        const cls = r === null ? 'unknown' : r;
        const sym = r === null ? '?' : r === 'none' ? '✓' : r === 'swell' ? '◍' : i === 0 ? '✹' : '✕';
        const bg = toCss(L[i].color.map((c) => c * 0.75), 0.75);
        h += `<span class="rx ${cls}" style="background:${bg}" data-tip="rx:${m.id}:${i}">${sym}</span>`;
      }
      h += `</div>`;
      h += `</div>`;
    }
    return h;
  }

  alloysHTML() {
    const g = this.game;
    const kn = g.knowledge;
    const raws = g.planet.materials;
    const n = raws.length;
    let h = `<div class="legend"><span><b style="color:var(--gold)">★</b> superb</span><span>○ ordinary</span><span style="color:#a68d7a">▽ crumbly</span><span style="color:var(--fail)">✸ explosive</span></div>`;
    h += `<div class="matrix" style="grid-template-columns:24px repeat(${n},1fr)"><div></div>`;
    const head = (m) => `<div class="mx-h" data-tip="mat:${m.id}">${kn.get(m).seen ? `<img src="${this.swatch(m)}" alt="">` : '<span class="fine">?</span>'}</div>`;
    for (const m of raws) h += head(m);
    for (let i = 0; i < n; i++) {
      const a = raws[i];
      h += head(a);
      for (let j = 0; j < n; j++) {
        const b = raws[j];
        if (i === j) {
          h += `<div class="mx self"></div>`;
          continue;
        }
        const p = kn.pairPossible(a, b);
        const sel = this.pair && ((this.pair[0] === a.id && this.pair[1] === b.id) || (this.pair[0] === b.id && this.pair[1] === a.id));
        const style = sel ? 'style="box-shadow:0 0 0 2px var(--gold)"' : '';
        if (p.known) h += `<button class="mx click ${p.known} ${p.direct ? '' : 'inferred'}" data-pair="${a.id},${b.id}" ${style} data-tip="pair:${a.id},${b.id}">${OUTCOME_GLYPH[p.known]}</button>`;
        else h += `<button class="mx click unknown" data-pair="${a.id},${b.id}" ${style} data-tip="pair:${a.id},${b.id}">${p.possible.size <= 2 ? [...p.possible].map((o) => OUTCOME_GLYPH[o]).join('') : '?'}</button>`;
      }
    }
    h += `</div>`;
    if (this.pair) {
      const [a, b] = this.pair.map((id) => materialById(g.planet, id));
      const p = kn.pairPossible(a, b);
      const smelters = g.colony ? g.colony.list.filter((x) => x.fn === 'smelter') : [];
      h += `<div class="card"><div class="card-head"><img src="${this.swatch(a)}"><img src="${this.swatch(b)}"><div><div class="nm">${esc(a.name)} + ${esc(b.name)}</div><div class="sub">${p.known ? OUTCOME_WORD[p.known] + (p.direct ? '' : ' (deduced)') : 'outcome unknown'}</div></div></div>`;
      h += `<div class="tests"><button class="test-btn" data-smelt="${a.id},${b.id}" ${smelters.length ? '' : 'disabled'} data-tip="smelt">Smelt</button></div>`;
      if (!p.known || p.known === 'volatile') h += `<div class="note-small ${p.known === 'volatile' ? 'fail' : 'risk'}">${p.known === 'volatile' ? 'This pair explodes.' : 'Untested: it might explode. Smelt it well away from the core.'}</div>`;
      h += `</div>`;
    } else h += `<div class="note-small">Pick a pair. What one pair does tells you about others: deduced results have dashed borders.</div>`;
    return h;
  }

  onJournalClick(e) {
    const g = this.game;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pair) {
      this.pair = t.dataset.pair.split(',');
      this.app.click();
    } else if (t.dataset.smelt) {
      const [a, b] = t.dataset.smelt.split(',');
      const sm = g.colony.list.filter((x) => x.fn === 'smelter');
      const idle = sm.find((s) => !s.state.recipe) || sm[0];
      if (idle) {
        g.modules.setRecipe(idle, a, b);
        g.log(`Smelter set to ${materialById(g.planet, a).name} + ${materialById(g.planet, b).name}.`, 'info');
      }
      this.app.click();
    }
    this.dirty.journal = true;
  }

  // ───────────────────────────── gauge & launch forecast

  renderStatus() {
    this.dirty.status = false;
    const g = this.game;
    const st = colonyStatus(g);
    if (!st) return;
    // lift and heel are on the hull now (the load line, and the tilt you can see); only damage needs saying
    let worst = 0;
    if (g.colony) for (const b of g.colony.list) for (const d of [0, 1]) if (b.edges[d]) worst = Math.max(worst, b.edges[d].damage);
    const h = worst > 0.25 ? `<div class="g-item" data-tip="damage"><span class="g-label">JOINT</span><span class="g-val ${worst > 0.5 ? 'bad' : 'warn'}">${Math.round(worst * 100)}%</span></div>` : '';
    const el = $('gauge');
    if (el._h !== h) {
      el.innerHTML = h;
      el._h = h;
    }
    this.renderForecast();
  }

  renderForecast() {
    const g = this.game;
    const r = g.rocket;
    let h = '';
    if (r.struct) {
      h = `<div class="st-head">IN FLIGHT</div><div class="st-row"><span class="k">Altitude</span><span class="v">${r.altitude().toFixed(0)} m</span></div><div class="st-row" data-tip="f-speed"><span class="k">Speed</span><span class="v">${Math.max(0, r.speed || 0).toFixed(0)} / ${ESCAPE_SPEED} m/s</span></div><div class="st-row" data-tip="f-prop"><span class="k">Propellant</span><span class="v">${r.fuelLeft().toFixed(1)}</span></div>`;
    } else if (r.rocketBlocks().length) {
      const p = predictRocket(g);
      h = `<div class="st-head">LAUNCH FORECAST</div>`;
      if (p.engines) {
        const twr = p.twrLo / p.twrHi > 0.97 ? p.twrLo.toFixed(2) : `${p.twrLo.toFixed(2)}–${p.twrHi.toFixed(2)}`;
        const twrCls = p.twrHi < 1.05 ? 'bad' : p.twrLo < 1.15 ? 'warn' : '';
        h += `<div class="st-row" data-tip="f-mass"><span class="k">Mass</span><span class="v">${p.mLo.toFixed(1)}${p.mHi / p.mLo > 1.02 ? '–' + p.mHi.toFixed(1) : ''} t</span></div>`;
        h += `<div class="st-row" data-tip="f-twr"><span class="k">Thrust ÷ weight</span><span class="v ${twrCls}">${twr}</span></div>`;
        h += `<div class="st-row" data-tip="f-prop"><span class="k">Propellant</span><span class="v">${p.fuel.toFixed(0)} / ${p.cap}</span></div>`;
        const sp = (x) => `${Math.max(0, x).toFixed(0)}`;
        const vTxt = p.vHi - p.vLo < 3 ? sp(p.vLo) : `${sp(p.vLo)}–${sp(p.vHi)}`;
        h += `<div class="st-row" data-tip="f-speed"><span class="k">Top speed</span><span class="v ${p.vHi < ESCAPE_SPEED ? 'bad' : p.vLo < ESCAPE_SPEED ? 'warn' : ''}">${vTxt} / ${ESCAPE_SPEED}</span></div>`;
        const sTxt = p.stressHi < 0.8 ? '<span class="safe">holds</span>' : p.stressLo > 1 ? '<span class="fail">breaks up</span>' : `<span class="risk">unsure</span>`;
        h += `<div class="st-row" data-tip="f-struct"><span class="k">Under thrust</span><span class="v">${sTxt}</span></div>`;
        let verdict, cls;
        if (!p.ready) {
          verdict = p.reason;
          cls = 'risk';
        } else if (p.twrHi < 1 || p.vHi < ESCAPE_SPEED || p.stressLo > 1) {
          verdict = 'This rocket will not make it.';
          cls = 'fail';
        } else if (p.twrLo >= 1.05 && p.vLo >= ESCAPE_SPEED && p.stressHi < 0.8) {
          verdict = 'Everything you know says it flies.';
          cls = 'safe';
        } else {
          verdict = 'It might fly. What you don’t know could still kill it.';
          cls = 'risk';
        }
        h += `<div class="verdict ${cls}">${esc(verdict)}</div>`;
      } else h += `<div class="verdict risk">${esc(p.reason || 'Add an Engine on a Launch Pad.')}</div>`;
      h += `<button id="launch-btn" class="launch-btn" ${r.validate().ok ? '' : 'disabled'} data-tip="launch">LAUNCH</button>`;
    }
    const el = $('forecast');
    el.classList.toggle('hidden', !h);
    if (el._h !== h) {
      el.innerHTML = h;
      el._h = h;
    }
  }

  // ───────────────────────────── tooltips

  /** Tooltip content for a HUD element's data-tip key. */
  tipHTML(key) {
    const g = this.game;
    const L = g.planet.layers;
    if (key === 'pause' && this.app.paused) return tip('Resume', 'Space', 'Time is stopped. You can still build.');
    if (TIPS[key]) {
      const [t, k, b] = TIPS[key];
      return tip(t, k, b);
    }
    const [kind, a, b] = key.split(':');
    if (key === 'volcano') return tip(`Mount ${esc(g.volcanoName())}`, '', 'Erupts when the timer runs out. Each tremor sends a bigger swell.', `${fmtTime(g.timeLeft())} left`);
    if (key === 'goal') {
      const gl = g.progress.currentGoal();
      return gl ? tip(esc(gl.title), '', gl.hint, `Step ${gl.index + 1} of ${gl.total}`) : '';
    }
    if (key === 'lift') {
      const st = colonyStatus(g);
      return tip('Spare lift', '', 'Weight you can still add before the deck goes under. Floats add lift; heavy blocks use it up.', st ? `Colony: ${st.mass.toFixed(1)} t in ${st.blocks} blocks` : '');
    }
    if (kind === 'fn') {
      const f = FUNCS[a];
      const m = f.fixedMat ? g.planet.salvage : this.mat;
      const cost = [...g.costOf(a, m)].map(([id, n]) => `${n} ${materialById(g.planet, id).name}`).join(' + ');
      const afford = g.canAfford(a, m);
      return tip(f.name, (f.key || '').toUpperCase(), f.desc, `${cost || 'free'}${afford ? '' : ' · <span class="fail">not enough</span>'}`);
    }
    if (kind === 'tool' && a === 'repair') return tip('Patch', 'R', 'Click a cracked block to restore its joints. 1 unit of its material each.');
    if (kind === 'tool' && a === 'drop')
      return tip(`Throw a test cube · ${esc(this.mat.name)}`, 'G', 'Someone cuts a solid cube from your stores and heaves it into the sea. Watch where it ends up.', `${DROP_COST} ${esc(this.mat.name)} · fish it back for some of that`);
    if (kind === 'd' || kind === 's') {
      const m = materialById(g.planet, a);
      const k = g.knowledge.get(m);
      const [t, , body] = TIPS[kind === 'd' ? 'density' : 'strength'];
      const ev = k.ev[kind];
      const how = ev.length ? `<div class="tt-meta">${ev.map((x) => '· ' + esc(x)).join('<br>')}</div>` : `<div class="tt-meta">Nothing yet. ${kind === 'd' ? 'Drop a cube, or weigh some on the deck.' : 'Put some load on a joint of it.'}</div>`;
      return tip(t, '', body) + how;
    }
    if (kind === 'mat') {
      const m = materialById(g.planet, a);
      if (!m) return '';
      const k = g.knowledge.get(m);
      if (!k.seen) return tip('Unknown', '', 'Not hauled in yet.');
      if (m.kind === 'salvage') return tip('Salvage', 'Q E', 'Your lander, in pieces. Fully known. Equipment needs it.', `${g.stockOf(m.id)} in stock`);
      const where = m.kind === 'alloy' ? 'An alloy' : this.whereFloats(k);
      const d = this.densityText(k),
        s = this.strengthText(k);
      const dS = d === '?' ? 'Density unknown' : `Density ${d} t/m³`;
      const sS = s === '?' ? 'strength unknown' : `strength ${s}`;
      return tip(esc(m.name), 'Q E', `${where[0].toUpperCase() + where.slice(1)}. ${dS}, ${sS}.`, `${g.stockOf(m.id)} in stock · click to build with it`);
    }
    if (kind === 'rx') {
      const m = materialById(g.planet, a);
      const i = +b;
      const r = g.knowledge.get(m).react[i];
      const words =
        r === null
          ? 'Unknown. Leave some of it in there a few seconds and watch.'
          : r === 'none'
            ? 'Inert here.'
            : r === 'swell'
              ? 'Soaks it up and swells: it keeps getting heavier.'
              : i === 0
                ? 'Burns: its joints weaken fast.'
                : 'Corrodes: joints weaken, floats flood.';
      return tip(esc(L[i].name), L[i].kind === 'air' ? 'air' : 'liquid', words);
    }
    if (kind === 'pair') {
      const [ma, mb] = a.split(',').map((id) => materialById(g.planet, id));
      const p = g.knowledge.pairPossible(ma, mb);
      const body = p.known ? `${OUTCOME_WORD[p.known]}${p.direct ? '' : ', deduced'}` : `could be ${[...p.possible].map((o) => OUTCOME_WORD[o]).join(', ')}`;
      return tip(`${esc(ma.name)} + ${esc(mb.name)}`, '', body[0].toUpperCase() + body.slice(1) + '.');
    }
    return '';
  }

  /** Put a HUD tooltip beside its element, on the side facing the middle of the screen. */
  placeTip(tt, el) {
    const r = el.getBoundingClientRect();
    const tr = tt.getBoundingClientRect();
    const W = window.innerWidth,
      H = window.innerHeight;
    let x, y;
    if (el.closest('#journal')) {
      x = r.left - tr.width - 10;
      y = r.top + r.height / 2 - tr.height / 2;
    } else if (el.closest('#palette')) {
      x = r.right + 10;
      y = r.top + r.height / 2 - tr.height / 2;
    } else if (el.closest('#top') || el.closest('#controls')) {
      x = r.left + r.width / 2 - tr.width / 2;
      y = r.bottom + 8;
    } else {
      x = r.left + r.width / 2 - tr.width / 2;
      y = r.top - tr.height - 8;
    }
    tt.style.left = `${Math.max(8, Math.min(W - tr.width - 8, x))}px`;
    tt.style.top = `${Math.max(8, Math.min(H - tr.height - 8, y))}px`;
  }

  // ───────────────────────────── picking & hover

  pick(wx, wy) {
    const g = this.game;
    const col = g.colony;
    if (col)
      for (const c of g.colonists.list) {
        const lp = col.localPos(wx, wy);
        if (Math.abs(lp.x - c.x) < 0.38 && lp.y > c.y - 0.1 && lp.y < c.y + 1.15) return { kind: 'colonist', ref: c };
      }
    for (const cw of g.world.castaways) {
      if (cw.state === 'rescued') continue;
      if (Math.abs(wx - cw.x) < 0.5 && wy > cw.y - 0.3 && wy < cw.y + 1.2) return { kind: 'castaway', ref: cw };
    }
    for (const c of g.flotsam.chunks) {
      if (!c.body) continue;
      const lp = c.body.getLocalPoint(new pl.Vec2(wx, wy));
      if (Math.hypot(lp.x, lp.y) > 1.3) continue;
      let inside = false;
      const pts = c.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i],
          [xj, yj] = pts[j];
        if (yi > lp.y !== yj > lp.y && lp.x < ((xj - xi) * (lp.y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside || Math.hypot(lp.x, lp.y) < 0.45) return { kind: c.aboard ? 'item' : 'chunk', ref: c };
    }
    for (const s of g.structures) {
      const lp = s.localPos(wx, wy);
      const b = s.at(Math.round(lp.x), Math.round(lp.y));
      if (b) return { kind: s === col ? 'block' : s.kind === 'rocket' ? 'rocket' : s.kind === 'island' ? 'island' : 'wreck', ref: b, struct: s };
      if (s === col) {
        const plan = g.construction.at(Math.round(lp.x), Math.round(lp.y));
        if (plan) return { kind: 'plan', ref: plan };
      }
    }
    for (const isl of g.world.islands) {
      if (!isl.pts) continue;
      const lp = isl.body.getLocalPoint(new pl.Vec2(wx, wy));
      if (Math.abs(lp.x) < 4.8 && Math.abs(lp.y) < 1.8) return { kind: 'island', ref: isl };
    }
    for (const r of g.world.rocks) if (Math.abs(wx - r.x) < 4.5 && wy < 5 && wy > g.planet.floor) return { kind: 'island', ref: r };
    return null;
  }

  updateHover(dt) {
    const tt = $('tooltip');
    const now = performance.now();
    let el = this.tipEl;
    if (el && !el.isConnected && this.screenMouse) {
      const under = document.elementFromPoint(this.screenMouse.x, this.screenMouse.y);
      el = this.tipEl = under && under.closest ? under.closest('[data-tip]') : null;
    }
    if (el) {
      this.hover = null;
      const wait = now - this.tipShownAt < 500 ? 60 : 260;
      const h = now - this.tipSince < wait ? '' : this.tipHTML(el.dataset.tip);
      if (!h) {
        tt.classList.add('hidden');
        return;
      }
      if (tt._h !== h) {
        tt.innerHTML = h;
        tt._h = h;
      }
      tt.classList.remove('hidden');
      this.placeTip(tt, el);
      this.tipShownAt = now;
      return;
    }
    if (!this.mouse.in || this.app.dragging) {
      this.hover = null;
      tt.classList.add('hidden');
      return;
    }
    const w = this.R.toWorld(this.mouse.x, this.mouse.y);
    const prev = this.hover;
    this.hover = this.pick(w.x, w.y);
    if (!prev || !this.hover || prev.ref !== this.hover.ref) this.hoverT = 0;
    else this.hoverT += dt;
    this.renderTooltip();
  }

  renderTooltip() {
    const g = this.game;
    const tt = $('tooltip');
    let h = '';
    const hv = this.hover;
    const L = g.planet.layers;
    if (this.tool === 'drop' && this.dropGhost) {
      const d = this.dropGhost;
      h = `<div class="tt-title">Test cube · ${esc(this.mat.name)}<span class="tt-key">${DROP_COST} units</span></div>`;
      h += d.ok ? `<div class="tt-dim">${esc(d.where)}</div><div class="tt-act">Click to throw it here</div>` : `<div class="fail">${esc(d.reason || 'Can’t throw it there.')}</div>`;
    } else if (this.tool === 'build' && this.ghost) {
      const gh = this.ghost;
      const f = FUNCS[this.fn];
      const m = gh.mat || this.mat;
      h = `<div class="tt-title">${f.name}${f.fixedMat ? '' : ` · ${esc(m.name)}`}</div>`;
      if (!gh.valid) h += `<div class="fail">${esc(gh.reason)}</div>`;
      else {
        if (gh.lift) {
          const { before, lo, hi } = gh.lift;
          const cls = lo < 0.2 ? 'fail' : lo < 1 ? 'risk' : '';
          const after = hi - lo < 0.1 ? `${((lo + hi) / 2).toFixed(1)}` : `${lo.toFixed(1)}–${hi.toFixed(1)}`;
          h += `<div class="${cls}">Lift ${before.toFixed(1)} → ${after} t</div>`;
          if (gh.liftNote) h += `<div class="${gh.liftNote.cls}">${esc(gh.liftNote.text)}</div>`;
        }
        if (gh.summary) h += `<div class="${gh.summary.cls}">${esc(gh.summary.text)}</div>`;
        if (gh.layerNote) h += `<div class="${gh.layerNote.cls}">${esc(gh.layerNote.text)}</div>`;
      }
    } else if (hv && hv.kind === 'chunk') {
      const c = hv.ref;
      const k = g.knowledge.get(c.mat);
      h = c.debris
        ? `<div class="tt-title">Lander debris<span class="tt-key">${c.units} salvage</span></div>`
        : `<div class="tt-title">${k.seen ? esc(c.mat.name) : 'Something new'}<span class="tt-key">${c.units} units</span></div>`;
      const p = c.body.getPosition();
      if (c.layer === 5 && p.y < g.physics.floorAt(p.x) + 1.6) h += `<div class="tt-dim">On the floor</div>`;
      else if (Math.abs(p.y - g.sea.surfaceY(p.x, g.time)) < 1.2) h += `<div class="tt-dim">Floating on ${esc(L[3].name)}</div>`;
      else {
        const k5 = Math.abs(p.y - g.sea.ifaceY(5, p.x, g.time)) < 1.2 ? 5 : Math.abs(p.y - g.sea.ifaceY(4, p.x, g.time)) < 1.2 ? 4 : 0;
        h += k5 ? `<div class="tt-dim">Resting on ${esc(L[k5].name)}</div>` : `<div class="tt-dim">In ${esc(L[Math.min(5, Math.max(0, c.layer))].name)}</div>`;
      }
      if (c.fizz > 0.2) h += `<div class="fail">Reacting with the fluid!</div>`;
      const reach = this.reachFor(p);
      h += reach.ok ? `<div class="tt-act">Click to fish it in</div>` : `<div class="tt-dim">Out of reach: ${reach.d.toFixed(0)} m from where anyone could cast</div>`;
    } else if (hv && hv.kind === 'colonist') {
      const c = hv.ref;
      h = `<div class="tt-title">${esc(c.name)}</div><div class="tt-dim">${this.activity(c)}</div><div class="tt-act">Click to give orders</div>`;
    } else if (hv && hv.kind === 'castaway') {
      const cw = hv.ref;
      const reach = this.reachFor({ x: cw.x, y: cw.y + 0.5 });
      h = `<div class="tt-title">${esc(cw.name)}<span class="tt-key">castaway</span></div>`;
      h += cw.state === 'hooked' ? `<div class="tt-dim">Swimming for the raft.</div>` : reach.ok ? `<div class="tt-act">Click to throw them a line</div>` : `<div class="tt-dim">Too far for a line: ${reach.d.toFixed(0)} m. Row closer.</div>`;
    } else if (hv && hv.kind === 'item' && !(this.selected && this.selected.item === hv.ref)) {
      const c = hv.ref;
      const kind = c.crate ? 'crate' : c.debris ? 'wreckage' : 'chunk';
      h = `<div class="tt-title">${esc(c.mat.name)} ${kind}<span class="tt-key">${c.units} units</span></div><div class="tt-dim">Loose on deck${c.claimed ? `: ${esc(c.claimed.name)} is on it` : ''}.</div><div class="tt-act">Click for options</div>`;
    } else if (hv && hv.kind === 'plan') {
      const plan = hv.ref;
      const parts = [...plan.needs].map(([id, n]) => `${plan.got.get(id) || 0}/${n} ${esc(materialById(g.planet, id).name)}`).join(' · ');
      h = `<div class="tt-title">${FUNCS[plan.fn].name} · ${esc(plan.mat.name)}<span class="tt-key">planned</span></div><div class="tt-dim">${parts}</div><div class="tt-act">Right-click to cancel</div>`;
    } else if (hv && hv.kind === 'island') {
      const site = hv.ref.site || (hv.struct && g.world.islands.find((i) => i.struct === hv.struct)?.site);
      h = `<div class="tt-title">${site ? esc(site.name[0].toUpperCase() + site.name.slice(1)) : 'An island'}</div><div class="tt-dim">${hv.ref.body && hv.ref.body.getType && hv.ref.body.getType() === 'static' ? 'Rooted to the sea floor. It doesn’t float, and it doesn’t move.' : 'Floating, held by a sea anchor.'}</div>`;
    } else if (hv && (hv.kind === 'block' || hv.kind === 'rocket') && hv.ref !== this.selected) {
      const b = hv.ref;
      const f = FUNCS[b.fn];
      h = `<div class="tt-title">${f.name}${f.fixedMat ? '' : ` · ${esc(b.mat.name)}`}</div>`;
      const st = b.state;
      if (b.fn === 'core') h += `<div class="tt-dim">${g.anchored ? 'At anchor' : g.rowDir ? 'Under way' : 'Drifting'} · click for the helm</div>`;
      if (b.fn === 'stockpile') {
        const list = b.state.contents || [];
        h += `<div class="tt-dim">${list.length ? list.map((it) => `${it.units} ${esc(it.mat.name)}`).join(' · ') : 'Empty'} (${list.reduce((a, it) => a + it.units, 0)}/${f.capacity})</div>`;
      }
      if (b.fn === 'pump' || b.fn === 'condenser') h += st.active ? `<div class="safe">Working</div>` : `<div class="risk">Idle: must sit inside ${esc(b.fn === 'pump' ? L[5].name : L[0].name)}</div>`;
      else if (b.fn === 'smelter') h += `<div class="tt-dim">${st.recipe ? st.recipe.map((id) => materialById(g.planet, id).name).join(' + ') : 'No recipe'}</div>`;
      else if (b.layer >= 0 && b.layer <= 5) h += `<div class="tt-dim">In ${esc(L[b.layer].name)}</div>`;
      let dmg = 0,
        load = 0;
      for (const e of b.edges)
        if (e) {
          dmg = Math.max(dmg, e.damage);
          load = Math.max(load, e.need || 0);
        }
      if (load > 1) {
        const ks = g.knowledge.get(b.mat);
        h += `<div class="tt-dim">Heaviest joint: ${Math.round(load)} kN · ${esc(b.mat.name)} known to hold ${this.strengthText(ks) === '?' ? '?' : this.strengthText(ks)}</div>`;
      }
      if (dmg > 0.02) h += `<div class="${dmg > 0.5 ? 'fail' : 'risk'}">Joint damage ${Math.round(dmg * 100)}%</div>`;
      if (b.corroding) h += `<div class="fail">Corroding!</div>`;
      if (b.swell > 0.05) h += `<div class="risk">Swollen (+${Math.round(b.swell * 70)}% weight)</div>`;
      if (b.flooded) h += `<div class="fail">Flooded</div>`;
      if (hv.kind === 'block' && b.fn !== 'core')
        h += `<div class="tt-act">${this.tool === 'repair' ? (dmg > 0.02 ? 'Click to patch' : 'Nothing to patch') : this.tool === 'jettison' ? 'Click to jettison' : this.tool === 'dismantle' ? 'Click to dismantle' : 'Click for options · right-click to dismantle'}</div>`;
    } else if (hv && hv.kind === 'wreck') {
      const s = hv.struct;
      const mats = [...new Set(s.list.map((b) => b.mat.name))].join(', ');
      h = s.cube ? `<div class="tt-title">Test cube<span class="tt-key">${esc(mats)}</span></div>` : `<div class="tt-title">Wreckage<span class="tt-key">${s.list.length} block${s.list.length > 1 ? 's' : ''}</span></div><div class="tt-dim">${esc(mats)}</div>`;
      const cr = s.cube && s.cube.read;
      if (cr && cr.est) h += `<div>Floats ${Math.round(cr.frac * 100)}% into ${esc(cr.lower.name)}: <b>≈ ${cr.est.toFixed(2)} t/m³</b></div>`;
      else if (cr && cr.floor) h += `<div class="tt-dim">Sank to the floor: denser than ${esc(L[5].name)}</div>`;
      else if (s.cube && !cr) h += `<div class="tt-dim">${this.game.experiments.near(s.body.getWorldCenter().x, s.body.getWorldCenter().y) ? 'Watching it settle…' : 'Too far away to watch'}</div>`;
      const reach = this.reachFor(s.body.getWorldCenter());
      h += reach.ok ? `<div class="tt-act">Click to salvage half its cost</div>` : `<div class="tt-dim">Out of reach (${reach.d.toFixed(0)} m)</div>`;
    }
    if (!h) {
      tt.classList.add('hidden');
      return;
    }
    if (tt._h !== h) {
      tt.innerHTML = h;
      tt._h = h;
    }
    tt.classList.remove('hidden');
    const r = tt.getBoundingClientRect();
    tt.style.left = `${Math.min(window.innerWidth - r.width - 8, this.mouse.x + 18)}px`;
    tt.style.top = `${Math.min(window.innerHeight - r.height - 8, this.mouse.y + 16)}px`;
  }

  /** How close could anyone get to this point: a colonist casting from where they could stand, or a crane. */
  reachFor(p) {
    const g = this.game;
    const crew = g.colonists;
    let best = { ok: false, d: Infinity };
    if (crew.list.length)
      for (const n of crew.nodes.values()) {
        if (!n.stand) continue;
        const w = crew.nodeWorld(n);
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        const ok = d <= CAST_REACH;
        if ((ok && (!best.ok || d < best.d)) || (!best.ok && d < best.d)) best = { ok, d, op: w, reach: CAST_REACH };
      }
    for (const o of g.grapples.cranes()) {
      const op = g.grapples.ownerPos(o);
      const d = Math.hypot(p.x - op.x, p.y - op.y);
      const ok = d <= GRAPPLE_REACH_CRANE;
      if ((ok && (!best.ok || d < best.d)) || (!best.ok && d < best.d)) best = { ok, d, op, reach: GRAPPLE_REACH_CRANE };
    }
    return best;
  }

  // ───────────────────────────── building preview

  cellAt(sx, sy) {
    const g = this.game;
    if (!g.colony) return null;
    const w = this.R.toWorld(sx, sy);
    const lp = g.colony.localPos(w.x, w.y);
    return { gx: Math.round(lp.x), gy: Math.round(lp.y) };
  }

  updateGhost() {
    const g = this.game;
    this.dropGhost = null;
    if (this.tool === 'drop' && this.mouse.in && !this.tipEl && g.colony) {
      const w = this.R.toWorld(this.mouse.x, this.mouse.y);
      const chk = g.experiments.canThrow(this.mat, w.x, w.y);
      const k = g.sea.layerAt(w.x, w.y, g.time);
      const L = g.planet.layers;
      this.dropGhost = { x: w.x, y: w.y, ok: chk.ok, reason: chk.reason, where: k <= 2 ? 'Into the air, to fall where it will' : `Into ${L[Math.min(5, k)].name}` };
    }
    if (this.tool !== 'build' || !this.mouse.in || !g.colony || this.tipEl) {
      this.ghost = null;
      return;
    }
    const c = this.cellAt(this.mouse.x, this.mouse.y);
    if (!c) return;
    const f = FUNCS[this.fn];
    const mat = f.fixedMat ? g.planet.salvage : this.mat;
    const chk = g.canPlace(c.gx, c.gy, this.fn, mat);
    const key = `${c.gx},${c.gy},${this.fn},${mat.id},${chk.ok}`;
    const now = performance.now();
    if (this.ghost && this.lastPredKey === key && now - this.lastPred < 400) return;
    this.lastPredKey = key;
    this.lastPred = now;
    const gh = { gx: c.gx, gy: c.gy, valid: chk.ok, reason: chk.reason, mat, fn: this.fn, preds: null, summary: null, layerNote: null, lift: null, liftNote: null };
    if (chk.ok) {
      const fy = ghostFluid(g, g.colony, c.gx, c.gy);
      const extra = { gx: c.gx, gy: c.gy, fn: this.fn, mat, fx: 0, fy, ex: 0, ey: 0, ghost: true };
      gh.preds = predictJoints(g, g.colony, [extra]);
      let worst = 'safe';
      for (const p of gh.preds) {
        const c2 = classify(p);
        if (c2 === 'fail') worst = 'fail';
        else if (c2 === 'risk' && worst !== 'fail') worst = 'risk';
      }
      gh.summary =
        worst === 'safe'
          ? { cls: 'safe', text: 'Joints hold, whatever it turns out to be.' }
          : worst === 'fail'
            ? { cls: 'fail', text: 'Something will give way.' }
            : { cls: 'risk', text: 'Joints might fail, depending on what you don’t know yet.' };
      const st = colonyStatus(g);
      const kd = g.knowledge.get(mat).d;
      const fnd = FUNCS[this.fn];
      const gp = g.colony.worldPos(c.gx, c.gy);
      const above = gp.y - g.sea.surfaceY(gp.x, g.time);
      const wetNow = Math.max(0, Math.min(1, 0.5 - above));
      const kLay = Math.max(3, Math.min(5, g.sea.layerAt(gp.x, Math.min(gp.y, g.sea.surfaceY(gp.x, g.time) - 0.01), g.time)));
      const lift = g.planet.layers[kLay].rho * wetNow + (above < 1.1 ? g.planet.layers[3].rho * (1 - wetNow) : 0);
      const addHi = Math.min(kd[1], 6) * fnd.fill + fnd.equip - lift;
      const addLo = kd[0] * fnd.fill + fnd.equip - lift;
      if (st) {
        gh.lift = { before: st.reserve, lo: st.reserve - addHi, hi: st.reserve - addLo };
        if (st.reserve - addLo < 0.2) gh.liftNote = { cls: 'fail', text: 'The deck would go under. Add floats first.' };
        else if (st.reserve - addHi < 0.2) gh.liftNote = { cls: 'risk', text: `If ${mat.name} is dense, the deck goes under.` };
      }
      if (this.fn === 'pump' || this.fn === 'condenser') {
        const k = g.sea.layerAt(gp.x, gp.y, g.time);
        const want = this.fn === 'pump' ? 5 : 0;
        const L = g.planet.layers;
        gh.layerNote = k === want ? { cls: 'safe', text: `Inside ${L[want].name}: it will work.` } : { cls: 'risk', text: `In ${L[Math.min(5, k)].name}. Works only inside ${L[want].name}.` };
      }
      const kk = g.knowledge.get(mat);
      const k = g.sea.layerAt(gp.x, gp.y, g.time);
      if (k <= 5 && kk.react[k] && kk.react[k] !== 'none') gh.layerNote = { cls: 'fail', text: `${mat.name} ${kk.react[k] === 'swell' ? 'swells' : 'corrodes'} in ${g.planet.layers[k].name}!` };
    }
    this.ghost = gh;
  }

  // ───────────────────────────── pointer actions

  primaryAt(sx, sy, drag = false) {
    const g = this.game;
    if (g.state !== 'playing') return;
    if (this.tool === 'build') {
      const c = this.cellAt(sx, sy);
      if (!c) return;
      if (drag && this.lastPlaced && this.lastPlaced.gx === c.gx && this.lastPlaced.gy === c.gy) return;
      const r = g.place(c.gx, c.gy, this.fn, this.mat);
      if (r.ok) {
        this.lastPlaced = c;
        this.lastPredKey = null;
        if (this.fn === 'capsule') this.setTool('select');
      } else if (!drag && r.reason) g.log(r.reason, 'warn');
      return;
    }
    const w = this.R.toWorld(sx, sy);
    const crew = g.colonists;
    if (this.tool === 'drop') {
      if (drag) return;
      const chk = g.experiments.canThrow(this.mat, w.x, w.y);
      if (!chk.ok) {
        if (chk.reason) g.log(chk.reason, 'warn');
        return;
      }
      const who = crew.pick(w.x, w.y, this.crewSel);
      if (who) crew.order(who, { type: 'throw', cube: this.mat, target: { x: w.x, y: w.y } });
      return;
    }
    const hv = this.pick(w.x, w.y);
    if (this.tool === 'dismantle') {
      if (hv && hv.kind === 'block') g.deconstruct(hv.ref);
      return;
    }
    if (drag) return;
    if (this.tool === 'repair') {
      if (hv && hv.kind === 'block' && !g.repair(hv.ref)) this.app.audio && this.app.audio.play('click');
      return;
    }
    if (this.tool === 'jettison') {
      if (hv && hv.kind === 'block') g.jettison(hv.ref);
      return;
    }
    if (!hv) {
      // with someone selected, clicking the colony sends them there
      const sel = this.crewSel;
      if (sel && g.colony) {
        const lp = g.colony.localPos(w.x, w.y);
        const cell = { x: Math.round(lp.x), y: Math.round(lp.y + 0.3) };
        if (crew.node(cell.x, cell.y)) {
          crew.order(sel, { type: 'goto', cell });
          return;
        }
      }
      this.closeModule();
      this.selectCrew(null);
      return;
    }
    if (hv.kind === 'colonist') {
      this.selectCrew(hv.ref);
      this.openModule({ crew: hv.ref });
    } else if (hv.kind === 'chunk' || hv.kind === 'castaway' || hv.kind === 'wreck') {
      const target = hv.kind === 'wreck' ? { kind: 'wreck', ref: hv.struct } : { kind: hv.kind, ref: hv.ref };
      if (g.grapples.hooked(target.ref)) return;
      const p = g.grapples.targetPos(target);
      const who = crew.pick(p.x, p.y, this.crewSel);
      if (!who) return;
      if (target.kind === 'chunk') target.ref.claimed = who;
      crew.order(who, { type: 'fish', target, manual: true });
      this.app.click();
    } else if (hv.kind === 'item') {
      this.openModule({ item: hv.ref });
    } else if (hv.kind === 'block') {
      this.openModule(hv.ref);
    } else if (hv.kind === 'plan') {
      this.openModule({ plan: hv.ref });
    }
  }

  selectCrew(c) {
    this.crewSel = c;
    if (!c && this.selected && this.selected.crew) this.closeModule();
  }

  secondaryAt(sx, sy) {
    const g = this.game;
    const w = this.R.toWorld(sx, sy);
    const hv = this.pick(w.x, w.y);
    if (hv && hv.kind === 'block' && hv.ref.fn !== 'core' && g.state === 'playing') {
      g.deconstruct(hv.ref);
      return;
    }
    if (hv && hv.kind === 'plan') {
      g.construction.cancel(hv.ref);
      return;
    }
    if (this.crewSel) this.selectCrew(null);
    if (this.tool !== 'select') this.setTool('select');
  }

  endDrag() {
    this.lastPlaced = null;
  }

  // ───────────────────────────── module popover

  openModule(b) {
    this.selected = b;
    this.renderModule();
    $('module-panel').classList.remove('hidden');
  }

  closeModule() {
    this.selected = null;
    $('module-panel').classList.add('hidden');
  }

  renderModule() {
    const sel = this.selected;
    if (!sel) return;
    const h = sel.crew ? this.crewPanel(sel.crew) : sel.item ? this.itemPanel(sel.item) : sel.plan ? this.planPanel(sel.plan) : this.blockPanel(sel);
    const el = $('module-panel');
    if (el._h !== h) {
      el.innerHTML = h;
      el._h = h;
    }
  }

  activity(c) {
    const j = c.job;
    if (!j) return 'Taking a breather.';
    switch (j.type) {
      case 'fish':
        return j.target.kind === 'castaway' ? `Throwing ${j.target.ref.name} a line.` : 'Fishing.';
      case 'store':
        return 'Stowing cargo.';
      case 'build':
        return `${j.phase === 'work' ? 'Building' : 'Fetching material for'} a ${FUNCS[j.plan.fn].name}.`;
      case 'row':
        return 'Rowing.';
      case 'throw':
        return j.cube ? 'Throwing a test cube.' : 'Throwing cargo overboard.';
      case 'goto':
        return 'On the way.';
      default:
        return c.autoFish ? 'Watching for flotsam.' : 'Taking a breather.';
    }
  }

  crewPanel(c) {
    let h = `<button class="ib mp-close" data-close>×</button><h4>${esc(c.name)}</h4><div class="note-small">${this.activity(c)}</div>`;
    h += `<button class="mp-btn ${c.autoFish ? 'on' : ''}" data-autofish data-tip="crew-auto">${c.autoFish ? 'Fishing by themselves' : 'Fish by themselves'}</button>`;
    h += `<div class="note-small fine">Click anything floating to send ${esc(c.name)} after it, or a spot on the raft to send them there.</div>`;
    return h;
  }

  itemPanel(ch) {
    const kind = ch.crate ? 'crate' : ch.debris ? 'wreckage' : 'chunk';
    let h = `<button class="ib mp-close" data-close>×</button><h4>${esc(ch.mat.name)} ${kind} <span class="tt-dim">· ${ch.units} units</span></h4>`;
    h += `<div class="note-small">Loose on deck. Its weight is on the raft, wherever it lies.</div>`;
    h += `<div class="mp-row"><button class="mp-btn" data-stow data-tip="mp-stow">Stow</button><button class="mp-btn" data-throw data-tip="mp-throw">Throw overboard</button></div>`;
    return h;
  }

  planPanel(plan) {
    const g = this.game;
    const f = FUNCS[plan.fn];
    const parts = [...plan.needs].map(([id, n]) => `${plan.got.get(id) || 0}/${n} ${esc(materialById(g.planet, id).name)}`).join(' · ');
    let h = `<button class="ib mp-close" data-close>×</button><h4>${f.name}${f.fixedMat ? '' : ` <span class="tt-dim">· ${esc(plan.mat.name)}</span>`} <span class="tt-dim">(planned)</span></h4>`;
    h += `<div class="note-small">${parts}</div>`;
    const short = [...plan.needs].filter(([id, n]) => g.cargo.unitsOf(id, true) + (plan.got.get(id) || 0) + (plan.coming.get(id) || 0) < n);
    if (short.length) h += `<div class="note-small risk">Not enough ${short.map(([id]) => esc(materialById(g.planet, id).name)).join(' or ')} aboard yet.</div>`;
    h += `<button class="mp-btn" data-cancelplan>Cancel plan</button>`;
    return h;
  }

  blockPanel(b) {
    const g = this.game;
    const f = FUNCS[b.fn];
    const L = g.planet.layers;
    let h = `<button class="ib mp-close" data-close>×</button><h4>${f.name}${f.fixedMat ? '' : ` <span class="tt-dim">· ${esc(b.mat.name)}</span>`}</h4>`;
    if (b.fn === 'core') {
      const st = colonyStatus(g);
      const deg = st ? Math.abs((st.heel * 180) / Math.PI) : 0;
      const state = g.anchored ? 'At anchor.' : g.rowDir ? `Rowing ${g.rowDir > 0 ? 'east' : 'west'}.` : 'Drifting.';
      h += `<div class="note-small">${state} Spare lift ${st ? st.reserve.toFixed(1) : '?'} t · heel ${deg.toFixed(0)}°</div>`;
      h += `<div class="mp-row"><button class="mp-btn ${g.rowDir < 0 ? 'on' : ''}" data-row="-1" data-tip="mp-row">◀ West</button><button class="mp-btn" data-row="0" data-tip="mp-stop">Stop</button><button class="mp-btn ${g.rowDir > 0 ? 'on' : ''}" data-row="1" data-tip="mp-row">East ▶</button></div>`;
      h += `<button class="mp-btn" data-anchor data-tip="mp-anchor">${g.anchored ? 'Raise anchor' : 'Drop anchor'}</button>`;
      return h;
    }
    h += `<div class="note-small">${esc(f.desc)}</div>`;
    if (b.fn === 'stockpile') {
      const list = b.state.contents || [];
      const used = list.reduce((a, it) => a + it.units, 0);
      h += `<div class="note-small">${list.length ? list.map((it) => `${it.units} ${esc(it.mat.name)}`).join(' · ') : 'Empty.'} <span class="tt-dim">(${used}/${f.capacity})</span></div>`;
    }
    if (b.fn === 'smelter') {
      const raws = g.planet.materials.filter((m) => g.knowledge.get(m).seen);
      const [ra, rb] = b.state.recipe || (this.pendingRecipe && this.pendingRecipe.block === b ? this.pendingRecipe.ids : ['', '']);
      const opt = (sel) => `<option value="">—</option>` + raws.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)} (${g.stockOf(m.id)})</option>`).join('');
      h += `<select data-recipe="0">${opt(ra)}</select><select data-recipe="1">${opt(rb)}</select>`;
      if (ra && rb) {
        const p = g.knowledge.pairPossible(materialById(g.planet, ra), materialById(g.planet, rb));
        h += `<div class="note-small ${p.known === 'volatile' ? 'fail' : p.known ? '' : 'risk'}">${p.known ? 'Known: ' + OUTCOME_WORD[p.known] : 'Untested pair. It could explode.'}</div>`;
      }
      if (b.state.recipe) h += `<button class="mp-btn" data-stopsmelt>Stop smelting</button>`;
    }
    if (b.fn === 'crane') h += `<button class="mp-btn" data-auto data-tip="mp-auto">Auto-haul: ${b.state.auto === false ? 'off' : 'on'}</button>`;
    if (b.fn === 'pump' || b.fn === 'condenser') {
      const want = b.fn === 'pump' ? 5 : 0;
      h += `<div class="note-small ${b.state.active ? 'safe' : 'risk'}">${b.state.active ? 'Working.' : `Idle: it sits in ${esc(L[Math.min(5, Math.max(0, b.layer))].name)}, needs ${esc(L[want].name)}.`}</div>`;
    }
    h += `<div class="mp-row"><button class="mp-btn" data-repair data-tip="mp-patch">Patch</button><button class="mp-btn" data-jettison data-tip="mp-jettison">Jettison</button><button class="mp-btn" data-dismantle data-tip="mp-dismantle">Dismantle</button></div>`;
    return h;
  }

  /** Where the popover sits: beside whatever it's about, following it as it moves. */
  positionModulePanel() {
    const sel = this.selected;
    const el = $('module-panel');
    if (!sel) return;
    const g = this.game;
    let p = null;
    if (sel.crew) {
      if (!g.colonists.list.includes(sel.crew)) return this.closeModule();
      p = g.colonists.world(sel.crew, 0, 0.8);
    } else if (sel.item) {
      if (!sel.item.body || !sel.item.aboard) return this.closeModule();
      p = sel.item.body.getPosition();
    } else if (sel.plan) {
      if (!g.construction.plans.has(keyOf(sel.plan.gx, sel.plan.gy)) || !g.colony) return this.closeModule();
      p = g.colony.worldPos(sel.plan.gx, sel.plan.gy);
    } else {
      if (!sel.struct || sel.struct !== g.colony) return this.closeModule();
      p = sel.struct.worldPos(sel.gx, sel.gy);
    }
    const s = this.R.toScreen(p.x, p.y);
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, s.x + 28))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, s.y - r.height / 2))}px`;
    this.modT = (this.modT || 0) + 1;
    if (this.modT % 15 === 0) this.renderModule();
  }

  onModuleClick(e) {
    const g = this.game;
    const sel = this.selected;
    const t = e.target.closest('button');
    if (!t || !sel) return;
    const crew = g.colonists;
    if (t.dataset.close !== undefined) {
      if (sel.crew) this.selectCrew(null);
      return this.closeModule();
    }
    if (sel.crew) {
      if (t.dataset.autofish !== undefined) sel.crew.autoFish = !sel.crew.autoFish;
    } else if (sel.item) {
      const it = sel.item;
      if (t.dataset.stow !== undefined) {
        if (!g.cargo.piles().some((p) => g.cargo.room(p) > 0)) g.log('No stockpile with room. Build one first.', 'warn');
        else {
          const p = it.body.getPosition();
          const who = crew.pick(p.x, p.y, this.crewSel);
          if (who) {
            it.claimed = who;
            crew.order(who, { type: 'store', item: it, phase: 'fetch-walk' });
          }
        }
        this.closeModule();
      }
      if (t.dataset.throw !== undefined) {
        const p = it.body.getPosition();
        const cc = g.colony.body.getWorldCenter();
        const side = p.x >= cc.x ? 1 : -1;
        const b = g.colony.bounds();
        const edge = g.colony.worldPos(side > 0 ? b.x1 : b.x0, 0);
        const who = crew.pick(p.x, p.y, this.crewSel);
        if (who) {
          it.claimed = who;
          crew.order(who, { type: 'throw', item: it, target: { x: edge.x + side * 5, y: g.sea.surfaceY(edge.x + side * 5, g.time) } });
        }
        this.closeModule();
      }
      return this.app.click();
    } else if (sel.plan) {
      if (t.dataset.cancelplan !== undefined) {
        g.construction.cancel(sel.plan);
        return this.closeModule();
      }
    } else {
      const b = sel;
      if (t.dataset.row !== undefined) g.setRow(+t.dataset.row);
      if (t.dataset.anchor !== undefined) g.anchored ? g.raiseAnchor() : g.dropAnchor();
      if (t.dataset.auto !== undefined) b.state.auto = b.state.auto === false;
      if (t.dataset.stopsmelt !== undefined) g.modules.setRecipe(b, null, null);
      if (t.dataset.repair !== undefined && !g.repair(b)) g.log('Nothing to patch there.', 'info');
      if (t.dataset.jettison !== undefined) {
        g.jettison(b);
        return this.closeModule();
      }
      if (t.dataset.dismantle !== undefined) {
        g.deconstruct(b);
        return this.closeModule();
      }
    }
    this.app.click();
    this.renderModule();
  }

  onModuleChange(e) {
    const g = this.game;
    const b = this.selected;
    const s = e.target.closest('select');
    if (!s || !b) return;
    const sels = $('module-panel').querySelectorAll('select[data-recipe]');
    const a = sels[0].value,
      c = sels[1].value;
    this.pendingRecipe = { block: b, ids: [a, c] };
    if (a && c && a !== c) g.modules.setRecipe(b, a, c);
    else g.modules.setRecipe(b, null, null);
    if (a && c && a === c) g.log('Pick two different materials.', 'warn');
    this.renderModule();
  }

  // ───────────────────────────── world overlay

  drawWorldOverlay(ctx, R) {
    const g = this.game;
    if (!g) return;
    const z = R.cam.zoom;
    const tf = (body) => {
      const xf = body.getTransform();
      const c = xf.q.c,
        s = xf.q.s;
      const o = R.toScreen(xf.p.x, xf.p.y);
      ctx.setTransform(R.odpr * z * c, -R.odpr * z * s, -R.odpr * z * s, -R.odpr * z * c, R.odpr * o.x, R.odpr * o.y);
    };
    const reset = () => ctx.setTransform(R.odpr, 0, 0, R.odpr, 0, 0);
    const col = g.colony;

    if (this.stressView && this.stressPreds && col) {
      tf(col.body);
      this.drawPreds(ctx, this.stressPreds, z, false);
      reset();
    }

    if (this.tool === 'select' && g.state === 'playing' && g.colonists.list.length) {
      // a soft pulse on everything someone could cast to from the raft
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      const cc = col ? col.body.getWorldCenter() : { x: 0 };
      for (const c of g.flotsam.chunks) {
        if (c.grabbed || c.aboard || !c.body) continue;
        const p = c.body.getPosition();
        if (Math.abs(p.x - cc.x) > 40 || !this.reachFor(p).ok) continue;
        const s = R.toScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, z * 0.95 + 3 + pulse * 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,220,150,${0.18 + 0.2 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      for (const cw of g.world.castaways) {
        if (cw.state !== 'waiting' || !this.reachFor({ x: cw.x, y: cw.y + 0.5 }).ok) continue;
        const s = R.toScreen(cw.x, cw.y + 0.6);
        ctx.beginPath();
        ctx.arc(s.x, s.y, z * 1.1 + 4 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(140,255,190,${0.3 + 0.3 * pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // plans: the ghost of each block-to-be, filling as material arrives
    if (col)
      for (const plan of g.construction.list()) {
        tf(col.body);
        let need = 0,
          got = 0;
        for (const [id, n] of plan.needs) {
          need += n;
          got += Math.min(n, plan.got.get(id) || 0);
        }
        const k = need ? got / need : 1;
        ctx.globalAlpha = 0.28 + 0.3 * k;
        ctx.drawImage(R.tile(plan.mat), plan.gx - 0.5, plan.gy - 0.5, 1, 1);
        ctx.globalAlpha = 1;
        ctx.setLineDash([0.16, 0.12]);
        ctx.lineWidth = 1.6 / z;
        ctx.strokeStyle = g.construction.ready(plan) ? 'rgba(255,240,200,0.9)' : 'rgba(255,240,200,0.45)';
        ctx.strokeRect(plan.gx - 0.46, plan.gy - 0.46, 0.92, 0.92);
        ctx.setLineDash([]);
        if (k > 0 && k < 1) {
          ctx.fillStyle = 'rgba(255,209,102,0.9)';
          ctx.fillRect(plan.gx - 0.4, plan.gy - 0.42, 0.8 * k, 0.08);
        }
        if (plan.worker && plan.worker.job && plan.worker.job.phase === 'work') {
          ctx.fillStyle = 'rgba(125,255,176,0.9)';
          ctx.fillRect(plan.gx - 0.4, plan.gy - 0.42, 0.8 * Math.min(1, plan.worker.job.t / 1.1), 0.08);
        }
        reset();
      }

    // the selected crew member, and where they're headed
    const sel = this.crewSel;
    if (sel && col && g.colonists.list.includes(sel)) {
      tf(col.body);
      ctx.strokeStyle = 'rgba(140,255,190,0.95)';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.ellipse(sel.x, sel.y + 0.02, 0.38, 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (sel.path.length) {
        ctx.fillStyle = 'rgba(140,255,190,0.6)';
        for (const n of sel.path) {
          ctx.beginPath();
          ctx.arc(n.x, n.y - 0.45, 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      reset();
    }

    this.drawEdgeMarkers(ctx, R);
    const hv = this.hover;
    if (hv && hv.kind === 'chunk' && hv.ref.body) {
      tf(hv.ref.body);
      ctx.beginPath();
      hv.ref.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = 'rgba(255,220,140,0.95)';
      ctx.stroke();
      reset();
      const p = hv.ref.body.getPosition();
      const reach = this.reachFor(p);
      if (reach.op) {
        const a = R.toScreen(reach.op.x, reach.op.y);
        ctx.beginPath();
        ctx.arc(a.x, a.y, reach.reach * z, 0, Math.PI * 2);
        ctx.strokeStyle = reach.ok ? 'rgba(255,220,140,0.25)' : 'rgba(255,120,100,0.3)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
        const b = R.toScreen(p.x, p.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = reach.ok ? 'rgba(255,220,140,0.45)' : 'rgba(255,120,100,0.35)';
        ctx.stroke();
      }
    } else if (hv && hv.struct) {
      tf(hv.struct.body);
      const b = hv.ref;
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = hv.kind === 'wreck' ? 'rgba(255,220,140,0.9)' : this.tool === 'dismantle' ? 'rgba(255,100,90,0.95)' : 'rgba(255,255,255,0.75)';
      if (hv.kind === 'wreck') for (const x of hv.struct.list) ctx.strokeRect(x.gx - 0.5, x.gy - 0.5, 1, 1);
      else ctx.strokeRect(b.gx - 0.5, b.gy - 0.5, 1, 1);
      reset();
    }

    if (this.selected && this.selected.struct === col) {
      tf(col.body);
      const b = this.selected;
      ctx.lineWidth = 2.5 / z;
      ctx.strokeStyle = 'rgba(255,209,102,0.95)';
      ctx.strokeRect(b.gx - 0.55, b.gy - 0.55, 1.1, 1.1);
      if (b.fn === 'crane') {
        reset();
        const p = col.worldPos(b.gx, b.gy);
        const s = R.toScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, GRAPPLE_REACH_CRANE * z, 0, Math.PI * 2);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(255,209,102,0.35)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      reset();
    }

    const dg = this.dropGhost;
    if (dg && col && col.core) {
      const s = R.toScreen(dg.x, dg.y);
      ctx.fillStyle = dg.ok ? 'rgba(255,255,255,0.14)' : 'rgba(255,80,80,0.16)';
      ctx.fillRect(s.x - z / 2, s.y - z / 2, z, z);
      ctx.strokeStyle = dg.ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,90,90,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x - z / 2, s.y - z / 2, z, z);
    }

    const wp = g.experiments.weighProgress();
    if (wp !== null && col && col.core) {
      const cp = col.worldPos(col.core.gx, col.core.gy);
      const s = R.toScreen(cp.x, cp.y + 2.4);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 11, -Math.PI / 2, -Math.PI / 2 + wp * Math.PI * 2);
      ctx.strokeStyle = 'rgba(207,232,255,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.font = '600 12px "Manrope", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(207,232,255,0.95)';
      ctx.fillText('⚖', s.x, s.y + 4);
      ctx.fillStyle = 'rgba(207,232,255,0.7)';
      ctx.font = '500 11px "Manrope", system-ui, sans-serif';
      ctx.fillText('weighing', s.x, s.y + 26);
    }

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (const s of g.structures) {
      const cr = s.cube && s.cube.read;
      if (!cr || (!cr.est && !cr.floor) || s.list.length !== 1) continue;
      const p = s.body.getWorldCenter();
      const q = R.toScreen(p.x + 0.7, p.y + 0.2);
      if (q.x < -50 || q.x > R.cssW + 50 || q.y < -20 || q.y > R.cssH + 20) continue;
      const txt = cr.est ? `${s.list[0].mat.name} ≈ ${cr.est.toFixed(2)}` : `${s.list[0].mat.name}: sank`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(txt, q.x + 1, q.y + 1);
      ctx.fillStyle = 'rgba(255,240,210,0.9)';
      ctx.fillText(txt, q.x, q.y);
    }

    const gh = this.ghost;
    if (gh && col) {
      tf(col.body);
      if (gh.preds) this.drawPreds(ctx, gh.preds, z, true);
      ctx.fillStyle = gh.valid ? 'rgba(255,255,255,0.18)' : 'rgba(255,80,80,0.18)';
      ctx.fillRect(gh.gx - 0.5, gh.gy - 0.5, 1, 1);
      ctx.lineWidth = 2 / z;
      const cls = gh.liftNote && gh.liftNote.cls === 'fail' ? 'fail' : gh.summary ? gh.summary.cls : null;
      ctx.strokeStyle = gh.valid ? (cls ? { safe: '#7dffb0', risk: '#ffc65c', fail: '#ff5b5b' }[cls] : '#fff') : 'rgba(255,90,90,0.9)';
      ctx.strokeRect(gh.gx - 0.5, gh.gy - 0.5, 1, 1);
      if (this.fn === 'crane' && gh.valid) {
        ctx.beginPath();
        ctx.arc(gh.gx, gh.gy, GRAPPLE_REACH_CRANE, 0, Math.PI * 2);
        ctx.setLineDash([0.4, 0.6]);
        ctx.strokeStyle = 'rgba(255,209,102,0.35)';
        ctx.lineWidth = 1.2 / z;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      reset();
    }

    if (g.rocket.struct) {
      const v = Math.max(0, g.rocket.speed || 0);
      const x = R.cssW - (this.journalOpen ? 340 : 40);
      const top = 120,
        bot = R.cssH - 140;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bot);
      ctx.stroke();
      const f = Math.max(0, Math.min(1, v / ESCAPE_SPEED));
      const y = bot - (bot - top) * f;
      ctx.fillStyle = f >= 1 ? '#7dffb0' : '#ffb15c';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${v.toFixed(0)} m/s`, x - 10, y + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`escape ${ESCAPE_SPEED} m/s`, x - 10, top + 4);
      ctx.fillText(`${g.rocket.altitude().toFixed(0)} m`, x - 10, bot + 18);
    }
  }

  /** Off-screen things worth knowing about: a flare just fired, castaways you've heard from. */
  drawEdgeMarkers(ctx, R) {
    const g = this.game;
    const W = R.cssW,
      H = R.cssH;
    const marks = [];
    for (const f of R.flares) if (f.t < 9) marks.push({ x: f.x, y: f.y, color: '255,90,70', label: 'flare', a: Math.min(1, (9 - f.t) / 2) });
    if (g.world.flareSeen)
      for (const cw of g.world.castaways) if (cw.state === 'waiting' && cw.seen) marks.push({ x: cw.x, y: cw.y + 1, color: '140,255,190', label: cw.name, a: 0.8 });
    const cc = g.colony ? g.colony.body.getWorldCenter() : { x: 0, y: 0 };
    for (const m of marks) {
      const s = R.toScreen(m.x, m.y);
      if (s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) continue;
      const cx = W / 2,
        cy = H / 2;
      const dx = s.x - cx,
        dy = s.y - cy;
      const k = Math.min((W / 2 - 40) / Math.max(1, Math.abs(dx)), (H / 2 - 70) / Math.max(1, Math.abs(dy)));
      const ex = cx + dx * k,
        ey = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.globalAlpha = m.a;
      ctx.translate(ex, ey);
      ctx.fillStyle = `rgba(${m.color},0.95)`;
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      ctx.font = '600 11px "Manrope", system-ui, sans-serif';
      ctx.textAlign = dx > 0 ? 'right' : 'left';
      ctx.fillStyle = `rgba(${m.color},0.95)`;
      ctx.fillText(`${m.label} · ${Math.round(Math.abs(m.x - cc.x))} m`, dx > 0 ? -16 : 16, 4);
      ctx.restore();
    }
  }

  drawPreds(ctx, preds, z, ghost) {
    for (const p of preds) {
      const cls = classify(p);
      if (!ghost && cls === 'safe' && p.hi < 0.45) continue;
      if (ghost && cls === 'safe' && !p.ghost && p.hi < 0.6) continue;
      const a = p.a;
      let x0, y0, x1, y1;
      if (p.vertical) {
        x0 = a.gx - 0.42;
        x1 = a.gx + 0.42;
        y0 = y1 = a.gy + 0.5;
      } else {
        y0 = a.gy - 0.42;
        y1 = a.gy + 0.42;
        x0 = x1 = a.gx + 0.5;
      }
      const col = cls === 'safe' ? `rgba(125,255,176,${0.35 + 0.4 * Math.min(1, p.hi)})` : cls === 'risk' ? 'rgba(255,198,92,0.95)' : 'rgba(255,91,91,1)';
      ctx.strokeStyle = col;
      ctx.lineWidth = (cls === 'safe' ? 2.5 : 4) / z;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}
