import { FUNCS, BUILD_ORDER, LAB_TESTS, GRAPPLE_REACH_CRANE, ESCAPE_ALTITUDE, ESCAPE_SPEED } from './sim/config.js';
import { allMaterials, materialById } from './sim/gen.js';
import { iconDataURL, swatchDataURL, toCss } from './render/textures.js';
import { predictJoints, classify, colonyStatus, predictRocket, ghostFluid } from './sim/predict.js';
import { brittleWord, D_PRIOR, S_PRIOR } from './sim/knowledge.js';
import { pl } from './sim/physics.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const GROUPS = [
  ['Structure', ['frame', 'hollow']],
  ['Harvest', ['crane']],
  ['Industry', ['lab', 'smelter', 'pump', 'condenser', 'refinery']],
  ['Rocket', ['pad', 'engine', 'tank', 'capsule']],
];
const TOOLS = [
  ['select', '➚', 'Pointer', 'Esc'],
  ['dismantle', '✕', 'Dismantle', 'X'],
  ['repair', '✚', 'Patch', 'R'],
  ['jettison', '⇲', 'Jettison', 'J'],
];

const OUTCOME_GLYPH = { strong: '★', plain: '○', dull: '▽', volatile: '✸' };
const OUTCOME_WORD = { strong: 'superb', plain: 'ordinary', dull: 'crumbly', volatile: 'explosive' };

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function logPos(x, lo, hi) {
  return Math.max(0, Math.min(1, (Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
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
    this.journalOpen = window.innerWidth > 1100;
    this.selected = null;
    this.dirty = { chips: true, palette: true, journal: true, objectives: true, status: true };
    this.swatches = new Map();
    this.icons = new Map();
    this.logEls = [];
    this.hoverT = 0;
    this.lastPred = 0;
    this.pair = null;
    this.mouse = { x: 0, y: 0, in: false };
    this.cardPulse = new Set();
    this.rulerX = 186;
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
    this.swatches.clear();
    this.icons.clear();
    for (const el of this.logEls) el.remove();
    this.logEls = [];
    $('volcano-name').textContent = game.volcanoName().toUpperCase();
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
      this.stressPreds = null;
      if (m) this.cardPulse.add(m.id);
    });
    game.on('discover', () => {
      this.dirty.chips = true;
      this.dirty.journal = true;
    });
    game.on('labs', () => (this.dirty.journal = true));
    game.on('modules', () => (this.dirty.journal = true));
    game.on('built', () => {
      this.stressPreds = null;
      this.lastPredKey = null;
      this.dirty.status = true;
      this.dirty.objectives = true;
    });
    this.markAll();
    this.renderPalette();
    document.body.classList.toggle('journal-closed', !this.journalOpen);
    $('journal').classList.toggle('hidden', !this.journalOpen);
    $('journal-open').classList.toggle('hidden', this.journalOpen);
  }

  markAll() {
    for (const k of Object.keys(this.dirty)) this.dirty[k] = true;
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
    document.querySelectorAll('.speed').forEach((b) => b.addEventListener('click', () => this.app.setSpeed(+b.dataset.speed)));
    $('btn-help').addEventListener('click', () => this.app.showHelp(true));
    $('j-body').addEventListener('click', (e) => this.onJournalClick(e));
    $('j-body').addEventListener('change', (e) => this.onJournalChange(e));
    $('palette').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fn],[data-tool]');
      if (!b) return;
      if (b.dataset.fn) this.pickFn(b.dataset.fn);
      else this.setTool(b.dataset.tool);
    });
    $('palette').addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-fn],[data-tool]');
      this.paletteHover = b ? b.dataset.fn || null : null;
    });
    $('palette').addEventListener('mouseleave', () => (this.paletteHover = null));
    $('mat-chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-mat]');
      if (!c) return;
      this.matId = c.dataset.mat;
      if (this.tool !== 'build') this.setTool('build');
      this.dirty.chips = true;
      this.dirty.palette = true;
      this.app.click();
    });
    $('status').addEventListener('click', (e) => {
      if (e.target.closest('#launch-btn')) {
        this.game.rocket.launch();
        this.app.followRocket = true;
      }
    });
    $('module-panel').addEventListener('click', (e) => this.onModuleClick(e));
    $('objectives').addEventListener('click', (e) => {
      if (e.target.closest('[data-objall]')) {
        this.objectivesAll = !this.objectivesAll;
        this.dirty.objectives = true;
        this.app.click();
      }
    });
    $('module-panel').addEventListener('change', (e) => this.onModuleChange(e));
  }

  toggleJournal() {
    this.journalOpen = !this.journalOpen;
    $('journal').classList.toggle('hidden', !this.journalOpen);
    $('journal-open').classList.toggle('hidden', this.journalOpen);
    document.body.classList.toggle('journal-closed', !this.journalOpen);
    this.dirty.journal = true;
    this.app.click();
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
    this.app.click();
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'build') this.ghost = null;
    this.dirty.palette = true;
    this.app.click();
  }

  pickFn(fn) {
    this.fn = fn;
    this.tool = 'build';
    const f = FUNCS[fn];
    if (f.fixedMat) this.matId = f.fixedMat;
    else if (this.matId === 'salvage' && fn !== 'frame' && fn !== 'hollow') this.matId = this.matId;
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

  knownMats() {
    const g = this.game;
    return allMaterials(g.planet).filter((m) => g.knowledge.mats.has(m.id) && g.knowledge.get(m).seen);
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

  // ───────────────────────────── logging

  addLog(e) {
    const el = document.createElement('div');
    el.className = `log-line ${e.kind}`;
    const dot = e.mat ? `<span class="mat-dot" style="background:${toCss(e.mat.color)}"></span>` : '';
    el.innerHTML = dot + esc(e.text);
    $('log').appendChild(el);
    this.logEls.push(el);
    el._born = performance.now();
    while (this.logEls.length > 5) this.logEls.shift().remove();
    if (e.kind === 'bad' || e.kind === 'warn') this.app.audio && this.app.audio.play(e.kind === 'bad' ? 'warn' : 'click');
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
      el.style.opacity = age > 14 ? 0 : age > 10 ? 1 - (age - 10) / 4 : 1;
    }
    this.uiT = (this.uiT || 0) + dt;
    if (this.uiT > 0.25) {
      this.uiT = 0;
      this.dirty.status = true;
      this.dirty.objectives = true;
      if (this.tab === 'lab') this.dirty.journal = true;
    }
    if (this.dirty.chips) this.renderChips();
    if (this.dirty.palette) this.renderPalette();
    if (this.dirty.journal && this.journalOpen) this.renderJournal();
    if (this.dirty.objectives) this.renderObjectives();
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
    const mat = this.mat;
    let h = '';
    for (const [name, fns] of GROUPS) {
      h += `<div class="pal-group">${name}</div>`;
      for (const fn of fns) {
        const f = FUNCS[fn];
        const m = f.fixedMat ? g.planet.salvage : mat;
        const active = this.tool === 'build' && this.fn === fn;
        const poor = !g.canAfford(fn, m);
        const img = this.icon(fn, fn === 'frame' || fn === 'hollow' ? m : g.planet.salvage);
        h += `<button class="tool ${active ? 'active' : ''} ${poor ? 'poor' : ''}" data-fn="${fn}"><img src="${img}" alt=""><span class="tname">${f.name}</span><span class="tkey">${(f.key || '').toUpperCase()}</span></button>`;
      }
    }
    h += `<div class="pal-group">Tools</div>`;
    for (const [id, glyph, name, key] of TOOLS) {
      h += `<button class="tool ${this.tool === id ? 'active' : ''}" data-tool="${id}"><span class="glyph">${glyph}</span><span class="tname">${name}</span><span class="tkey">${key}</span></button>`;
    }
    $('palette').innerHTML = h;
  }

  renderChips() {
    this.dirty.chips = false;
    const g = this.game;
    const kn = g.knowledge;
    let h = '';
    const mats = allMaterials(g.planet);
    let unseen = 0;
    for (const m of mats) {
      const k = kn.mats.get(m.id);
      if (!k || !k.seen) {
        if (m.kind === 'raw') unseen++;
        continue;
      }
      const active = m.id === this.matId;
      h += `<button class="chip ${active ? 'active' : ''}" data-mat="${m.id}" title="${esc(m.name)}"><img src="${this.swatch(m)}" alt=""><span class="cname">${esc(m.name)}</span><span class="ccount">${g.stockOf(m.id)}</span></button>`;
    }
    for (let i = 0; i < unseen; i++) h += `<div class="chip unseen" title="An undiscovered material is drifting somewhere out there"><span class="sw" style="background:repeating-linear-gradient(45deg,#222 0 4px,#333 4px 8px)"></span><span class="cname">???</span></div>`;
    $('mat-chips').innerHTML = h;
    const res = [
      ['fuel', 'fuel', g.stockOf('fuel')],
      ['ox', 'oxidiser', g.stockOf('ox')],
      ['prop', 'propellant', g.stockOf('prop')],
    ];
    $('resources').innerHTML = res.map(([c, l, v]) => `<div class="res r-${c}"><span class="rv">${v}</span><span class="rl">${l}</span></div>`).join('');
  }

  // ───────────────────────────── journal

  renderJournal() {
    this.dirty.journal = false;
    const g = this.game;
    const body = $('j-body');
    const labs = g.modules.labs();
    const busy = labs.filter((l) => l.state.job).length + g.modules.queue.length;
    $('lab-count').textContent = busy ? `(${busy})` : '';
    const scroll = body.scrollTop;
    if (this.tab === 'mats') body.innerHTML = this.matsHTML();
    else if (this.tab === 'alloys') body.innerHTML = this.alloysHTML();
    else body.innerHTML = this.labHTML();
    body.scrollTop = scroll;
    this.cardPulse.clear();
  }

  matsHTML() {
    const g = this.game;
    const kn = g.knowledge;
    const hasLab = g.modules.labs().length > 0;
    const L = g.planet.layers;
    let h = '';
    const mats = allMaterials(g.planet).filter((m) => kn.mats.has(m.id) && kn.get(m).seen);
    if (mats.length <= 1)
      h += `<div class="empty">Nothing hauled in yet. <b>Click a chunk</b> drifting near your raft to grapple it. Watch where each kind floats: that alone tells you something about its density.</div>`;
    for (const m of mats) {
      const k = kn.get(m);
      const pulse = this.cardPulse.has(m.id) ? 'pulse' : '';
      const where =
        m.kind === 'salvage'
          ? 'lander salvage · fully known'
          : m.kind === 'alloy'
            ? `alloy of ${m.parents.map((p) => materialById(g.planet, p).name).join(' + ')}`
            : this.whereFloats(k);
      h += `<div class="card ${pulse}">`;
      h += `<div class="card-head"><img src="${this.swatch(m)}" alt=""><div><div class="nm">${esc(m.name)}</div><div class="sub">${where}</div></div><div class="stock">${g.stockOf(m.id)}</div></div>`;
      // density
      const [dl, dh] = k.d;
      const dExact = dh / dl < 1.015;
      let dTxt = dExact ? `${((dl + dh) / 2).toFixed(2)}` : dh >= D_PRIOR[1] - 1e-6 && dl <= D_PRIOR[0] + 1e-6 ? '?' : dh >= D_PRIOR[1] - 1e-6 ? `> ${dl.toFixed(2)}` : dl <= D_PRIOR[0] + 1e-6 ? `< ${dh.toFixed(2)}` : `${dl.toFixed(2)}–${dh.toFixed(2)}`;
      const dA = logPos(dl, 0.1, 6),
        dB = logPos(Math.min(dh, 6), 0.1, 6);
      const dUnk = dTxt === '?' ? 'unknown' : '';
      let ticks = '';
      for (const l of L.slice(3)) ticks += `<span class="tickm" style="left:${logPos(l.rho, 0.1, 6) * 100}%;background:${toCss(l.color.map((c) => Math.min(1, c * 1.8 + 0.1)))}" title="${esc(l.name)} ${l.rho.toFixed(2)}"></span>`;
      h += `<div class="prop"><span class="pk">Density</span><div class="bar">${ticks}<span class="rng ${dExact ? 'exact' : ''} ${dUnk}" style="left:${dA * 100}%;width:${Math.max(0.5, (dB - dA) * 100)}%"></span></div><span class="pv">${dTxt}${dTxt === '?' ? '' : ' t/m³'}</span></div>`;
      // strength
      const [sl, sh] = k.s;
      const sExact = sh / sl < 1.06;
      const sTxt = sExact ? `${Math.round((sl + sh) / 2)} kN` : sh >= S_PRIOR[1] - 1 && sl <= S_PRIOR[0] + 1e-6 ? '?' : sh >= S_PRIOR[1] - 1 ? `> ${Math.round(sl)} kN` : `${Math.round(sl)}–${Math.round(sh)} kN`;
      const sA = logPos(sl, 10, 4000),
        sB = logPos(Math.min(sh, 4000), 10, 4000);
      h += `<div class="prop"><span class="pk">Strength</span><div class="bar"><span class="rng ${sExact ? 'exact' : ''} ${sTxt === '?' ? 'unknown' : ''}" style="left:${sA * 100}%;width:${Math.max(0.5, (sB - sA) * 100)}%"></span></div><span class="pv">${sTxt}</span></div>`;
      // column limit
      const hLo = sl / (9.8 * dh),
        hHi = sh / (9.8 * dl);
      if (hHi < 400 && dh < D_PRIOR[1]) {
        const ht = hHi / hLo < 1.15 ? `${hLo.toFixed(0)} m` : `${hLo.toFixed(0)}–${hHi.toFixed(0)} m`;
        h += `<div class="prop"><span class="pk">Column</span><span class="note-small" style="grid-column:2/4">a solid column stands about <b>${ht}</b> before its base gives way</span></div>`;
      } else if (dh < D_PRIOR[1]) {
        h += `<div class="prop"><span class="pk">Column</span><span class="note-small" style="grid-column:2/4">a solid column stands at least <b>${hLo.toFixed(0)} m</b></span></div>`;
      }
      // brittleness
      const bTxt = k.b !== null ? brittleWord(k.b) : k.bHint !== null ? `looks ${brittleWord(k.bHint)}` : '?';
      h += `<div class="prop"><span class="pk">Temper</span><span class="note-small" style="grid-column:2/4">${bTxt === '?' ? 'unknown: will it warn you before it breaks?' : bTxt}</span></div>`;
      // reactions
      h += `<div class="reacts">`;
      for (let i = 0; i < 6; i++) {
        const r = k.react[i];
        const cls = r === null ? 'unknown' : r;
        const sym = r === null ? '?' : r === 'none' ? '✓' : r === 'swell' ? '◍' : i === 0 ? '✹' : '✕';
        const words = r === null ? 'unknown' : r === 'none' ? 'inert' : r === 'swell' ? 'soaks up and swells' : i === 0 ? 'burns' : 'corrodes';
        const bg = toCss(L[i].color.map((c) => c * 0.75), 0.75);
        h += `<span class="rx ${cls}" style="background:${bg}" title="${esc(L[i].name)}: ${words}">${sym}</span>`;
      }
      h += `</div>`;
      if (m.kind !== 'salvage') {
        h += `<div class="tests">`;
        for (const t of ['density', 'press', 'soak']) {
          const spec = LAB_TESTS[t];
          const dis = !hasLab || g.stockOf(m.id) < spec.units;
          h += `<button class="test-btn" data-test="${t}" data-mat="${m.id}" ${dis ? 'disabled' : ''} title="${esc(spec.desc)}">${spec.name.split(' ').pop()}<small>${spec.units}u · ${spec.time}s</small></button>`;
        }
        h += `</div>`;
      }
      h += `</div>`;
    }
    if (!hasLab && mats.length > 1) h += `<div class="note-small">Build a <b>Lab</b> to run exact tests. Everything else you learn the hard way.</div>`;
    return h;
  }

  whereFloats(k) {
    const g = this.game;
    const L = g.planet.layers;
    const [lo, hi] = k.d;
    if (hi <= L[3].rho + 1e-6) return `floats on ${L[3].name}`;
    if (lo >= L[3].rho - 1e-6 && hi <= L[4].rho + 1e-6) return `rests between ${L[3].name} and ${L[4].name}`;
    if (lo >= L[4].rho - 1e-6 && hi <= L[5].rho + 1e-6) return `rests between ${L[4].name} and ${L[5].name}`;
    if (lo >= L[5].rho - 1e-6) return `sinks to the floor`;
    return 'density unknown';
  }

  alloysHTML() {
    const g = this.game;
    const kn = g.knowledge;
    const raws = g.planet.materials;
    const n = raws.length;
    let h = `<div class="note-small">Fusing two raw materials gives an alloy whose character follows a hidden rule about each material's <b>temper</b>. What you learn about one pair often tells you about others. The notebook works out what follows (dashed cells).</div>`;
    h += `<div class="legend"><span><b style="color:var(--gold)">★</b> superb</span><span>○ ordinary</span><span style="color:#a68d7a">▽ crumbly</span><span style="color:var(--fail)">✸ explosive</span><span>? unknown</span></div>`;
    h += `<div class="matrix" style="grid-template-columns:28px repeat(${n},1fr)"><div></div>`;
    for (const m of raws) {
      const seen = kn.get(m).seen;
      h += `<div class="mx-h" title="${esc(m.name)}">${seen ? `<img src="${this.swatch(m)}" alt="">` : '<span class="fine">?</span>'}</div>`;
    }
    for (let i = 0; i < n; i++) {
      const a = raws[i];
      const seenA = kn.get(a).seen;
      h += `<div class="mx-h" title="${esc(a.name)}">${seenA ? `<img src="${this.swatch(a)}" alt="">` : '<span class="fine">?</span>'}</div>`;
      for (let j = 0; j < n; j++) {
        const b = raws[j];
        if (i === j) {
          h += `<div class="mx self"></div>`;
          continue;
        }
        const p = kn.pairPossible(a, b);
        const sel = this.pair && ((this.pair[0] === a.id && this.pair[1] === b.id) || (this.pair[0] === b.id && this.pair[1] === a.id));
        const style = sel ? 'style="box-shadow:0 0 0 2px var(--gold)"' : '';
        if (p.known) h += `<button class="mx click ${p.known} ${p.direct ? '' : 'inferred'}" data-pair="${a.id},${b.id}" ${style} title="${esc(a.name)} + ${esc(b.name)}: ${OUTCOME_WORD[p.known]}${p.direct ? '' : ' (deduced)'}">${OUTCOME_GLYPH[p.known]}</button>`;
        else {
          const opts = [...p.possible].map((o) => OUTCOME_GLYPH[o]).join('');
          h += `<button class="mx click unknown" data-pair="${a.id},${b.id}" ${style} title="${esc(a.name)} + ${esc(b.name)}: could be ${[...p.possible].map((o) => OUTCOME_WORD[o]).join(', ')}">${p.possible.size <= 2 ? opts : '?'}</button>`;
        }
      }
    }
    h += `</div>`;
    if (this.pair) {
      const [a, b] = this.pair.map((id) => materialById(g.planet, id));
      const p = kn.pairPossible(a, b);
      const hasLab = g.modules.labs().length > 0;
      const smelters = g.colony ? g.colony.list.filter((x) => x.fn === 'smelter') : [];
      h += `<div class="card"><div class="card-head"><img src="${this.swatch(a)}"><img src="${this.swatch(b)}"><div><div class="nm">${esc(a.name)} + ${esc(b.name)}</div><div class="sub">${p.known ? OUTCOME_WORD[p.known] + (p.direct ? '' : ' (deduced)') : 'outcome unknown'}</div></div></div>`;
      const canC = hasLab && g.stockOf(a.id) >= 1 && g.stockOf(b.id) >= 1;
      h += `<div class="tests"><button class="test-btn" data-crucible="${a.id},${b.id}" ${canC ? '' : 'disabled'}>Crucible test<small>1 + 1 · 8 s · safe</small></button>`;
      h += `<button class="test-btn" data-smelt="${a.id},${b.id}" ${smelters.length ? '' : 'disabled'}>Smelt it<small>${smelters.length ? 'in an idle smelter' : 'build a Smelter'}</small></button></div>`;
      if (!p.known || p.known === 'volatile') h += `<div class="note-small ${p.known === 'volatile' ? 'fail' : 'risk'}">${p.known === 'volatile' ? 'This pairing explodes. Smelting it will destroy the smelter and crack everything nearby.' : 'Unknown pairing. A full smelt might explode.'}</div>`;
      h += `</div>`;
    }
    const smelters = g.colony ? g.colony.list.filter((x) => x.fn === 'smelter') : [];
    if (smelters.length) {
      h += `<div class="note-small" style="margin:6px 0">Smelters</div>`;
      smelters.forEach((s, i) => {
        const r = s.state.recipe ? s.state.recipe.map((id) => materialById(g.planet, id).name).join(' + ') : 'idle';
        const ph = s.state.phase === 'heating' ? `heating ${Math.round((s.state.t / 10) * 100)}%` : s.state.phase === 'starved' ? 'waiting for 3 + 3' : '';
        h += `<div class="job"><div class="jt"><span>Smelter ${i + 1}: ${esc(r)}</span><span class="fine">${ph}</span></div>${s.state.recipe ? `<button class="mp-btn" data-stop="${s.id}">Stop</button>` : ''}</div>`;
      });
    }
    return h;
  }

  labHTML() {
    const g = this.game;
    const labs = g.modules.labs();
    if (!labs.length) return `<div class="empty">No labs yet. A <b>Lab</b> (key 4) runs exact tests on samples: density, crush strength, reactivity, and alloy crucibles. Each lab runs one test at a time.</div>`;
    let h = `<div class="note-small" style="margin-bottom:8px">${labs.length} lab${labs.length > 1 ? 's' : ''}. Queue tests from the Materials and Alloys tabs.</div>`;
    labs.forEach((l, i) => {
      const j = l.state.job;
      h += `<div class="job"><div class="jt"><span>Lab ${i + 1}</span><span class="fine">${j ? this.jobName(j) : 'idle'}</span></div>${j ? `<div class="pbar"><i style="width:${Math.min(100, (j.t / j.dur) * 100)}%"></i></div>` : ''}</div>`;
    });
    if (g.modules.queue.length) {
      h += `<div class="note-small" style="margin:8px 0 4px">Queued</div>`;
      g.modules.queue.forEach((j, i) => {
        h += `<div class="job"><div class="jt"><span>${this.jobName(j)}</span><button class="icon-btn" data-cancel="${i}" title="Cancel and refund">×</button></div></div>`;
      });
    }
    return h;
  }

  jobName(j) {
    return `${LAB_TESTS[j.test].name}: ${j.mats.map((m) => m.name).join(' + ')}`;
  }

  onJournalClick(e) {
    const g = this.game;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.test) {
      const r = g.modules.enqueue(t.dataset.test, [t.dataset.mat]);
      if (!r.ok) g.log(r.reason, 'warn');
      this.app.click();
    } else if (t.dataset.pair) {
      this.pair = t.dataset.pair.split(',');
      this.dirty.journal = true;
      this.app.click();
    } else if (t.dataset.crucible) {
      const r = g.modules.enqueue('crucible', t.dataset.crucible.split(','));
      if (!r.ok) g.log(r.reason, 'warn');
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
    } else if (t.dataset.stop) {
      const s = g.colony.list.find((x) => x.id === +t.dataset.stop);
      if (s) g.modules.setRecipe(s, null, null);
    } else if (t.dataset.cancel !== undefined) {
      g.modules.cancel(g.modules.queue[+t.dataset.cancel]);
    }
    this.dirty.journal = true;
  }

  onJournalChange() {}

  // ───────────────────────────── objectives

  renderObjectives() {
    this.dirty.objectives = false;
    const g = this.game;
    const L = g.planet.layers;
    const hasLab = g.colony && g.colony.list.some((b) => b.fn === 'lab');
    const rv = g.rocket.validate();
    const items = [
      { done: g.stats.chunks >= 3, text: `Haul in flotsam (${Math.min(3, g.stats.chunks)}/3)`, hint: 'Click a chunk drifting near the raft. Your core’s grapple reaches 24 m.' },
      { done: hasLab, text: 'Build a Lab', hint: 'Pick <b>Lab</b> (4), choose a material below, and click next to your raft. Labs cost 4 salvage.' },
      { done: g.stats.tests >= 1, text: 'Run a test', hint: 'In the Notebook, press a test button on a material card.' },
      {
        done: !!g.flags.pump,
        text: `Pump fuel from ${L[5].name}`,
        hint: `Hang a keel down past <b>${L[5].top.toFixed(1)} m</b> and put a <b>Pump</b> (6) at its tip. Mind what the deep fluids do to your materials.`,
      },
      {
        done: !!g.flags.condenser,
        text: `Condense oxidiser in ${L[0].name}`,
        hint: `Raise a tower above <b>+${L[1].top.toFixed(1)} m</b> and cap it with a <b>Condenser</b> (7). Tall towers capsize light rafts.`,
      },
      { done: g.stockOf('prop') >= 1 || g.stats.launches > 0, text: 'Refine propellant', hint: 'A <b>Refinery</b> (8) turns fuel + oxidiser into propellant.' },
      {
        done: rv.capsule && rv.engines.length > 0 && rv.tanks.length > 0,
        text: 'Stack a rocket',
        hint: '<b>Launch Pad</b> (9), <b>Engine</b> (0) on it, <b>Tanks</b> (T) above, <b>Capsule</b> (C) on top.',
      },
      { done: g.state === 'won', text: `Reach escape speed (${ESCAPE_SPEED} m/s)`, hint: 'Check the launch forecast in the colony panel, then launch before the eruption.' },
    ];
    const doneN = items.filter((it) => it.done).length;
    let h = `<div class="obj-title">MISSION · ${doneN}/${items.length}</div>`;
    let active = false;
    let shown = 0;
    for (const it of items) {
      const isActive = !it.done && !active;
      if (isActive) active = true;
      const visible = this.objectivesAll || isActive || (!it.done && shown < 3 && active);
      if (!visible) continue;
      shown++;
      h += `<div class="obj ${it.done ? 'done' : isActive ? 'active' : ''}"><span class="tick">${it.done ? '✓' : isActive ? '▸' : '·'}</span><span>${it.text}</span></div>`;
      if (isActive) h += `<div class="obj-hint">${it.hint}</div>`;
    }
    h += `<div class="obj-more" data-objall>${this.objectivesAll ? '▴ fewer' : '▾ all steps'}</div>`;
    const el = $('objectives');
    if (el._h !== h) {
      el.innerHTML = h;
      el._h = h;
    }
  }

  // ───────────────────────────── status & launch

  renderStatus() {
    this.dirty.status = false;
    const g = this.game;
    const st = colonyStatus(g);
    if (!st) return;
    const deg = (st.heel * 180) / Math.PI;
    const heelCls = Math.abs(deg) > 25 ? 'bad' : Math.abs(deg) > 10 ? 'warn' : '';
    const resCls = st.reserve < 1 ? 'bad' : st.reserve < 3 ? 'warn' : '';
    let worst = 0;
    if (g.colony) for (const b of g.colony.list) for (const d of [0, 1]) if (b.edges[d]) worst = Math.max(worst, b.edges[d].damage);
    let h = `<div class="st-head">COLONY</div>`;
    h += `<div class="st-row"><span class="k">Mass</span><span class="v">${st.mass.toFixed(1)} t · ${st.blocks} blocks</span></div>`;
    h += `<div class="st-row" title="How many more tonnes the raft can carry before its waterline blocks go under"><span class="k">Spare buoyancy</span><span class="v ${resCls}">${st.reserve.toFixed(1)} t</span></div>`;
    h += `<div class="st-row"><span class="k">Heel</span><span class="v ${heelCls}">${deg.toFixed(1)}°</span></div>`;
    h += `<div class="heel"><i style="left:calc(${50 + Math.max(-50, Math.min(50, (deg / 45) * 50))}% - 1px)"></i></div>`;
    if (worst > 0.05) h += `<div class="st-row"><span class="k">Worst joint damage</span><span class="v ${worst > 0.5 ? 'bad' : 'warn'}">${Math.round(worst * 100)}%</span></div>`;
    const r = g.rocket;
    if (r.struct) {
      const alt = r.altitude();
      h += `<div class="launch"><div class="st-head">IN FLIGHT</div><div class="st-row"><span class="k">Altitude</span><span class="v">${alt.toFixed(0)} m</span></div><div class="st-row"><span class="k">Speed</span><span class="v">${Math.max(0, r.speed || 0).toFixed(0)} / ${ESCAPE_SPEED} m/s</span></div><div class="st-row"><span class="k">Propellant</span><span class="v">${r.fuelLeft().toFixed(1)}</span></div></div>`;
    } else {
      const parts = r.rocketBlocks();
      if (parts.length) {
        const p = predictRocket(g);
        h += `<div class="launch"><div class="st-head">LAUNCH FORECAST</div>`;
        if (p.engines) {
          const twr = p.twrLo / p.twrHi > 0.97 ? p.twrLo.toFixed(2) : `${p.twrLo.toFixed(2)}–${p.twrHi.toFixed(2)}`;
          const twrCls = p.twrHi < 1.05 ? 'bad' : p.twrLo < 1.15 ? 'warn' : '';
          h += `<div class="st-row"><span class="k">Mass (fuelled)</span><span class="v">${p.mLo.toFixed(1)}${p.mHi / p.mLo > 1.02 ? '–' + p.mHi.toFixed(1) : ''} t</span></div>`;
          h += `<div class="st-row"><span class="k">Thrust / weight</span><span class="v ${twrCls}">${twr}</span></div>`;
          h += `<div class="st-row"><span class="k">Propellant</span><span class="v">${p.fuel.toFixed(0)} / ${p.cap}</span></div>`;
          const sp = (x) => `${Math.max(0, x).toFixed(0)}`;
          const vTxt = p.vHi - p.vLo < 3 ? sp(p.vLo) : `${sp(p.vLo)}–${sp(p.vHi)}`;
          h += `<div class="st-row"><span class="k">Top speed</span><span class="v ${p.vHi < ESCAPE_SPEED ? 'bad' : p.vLo < ESCAPE_SPEED ? 'warn' : ''}">${vTxt} / ${ESCAPE_SPEED} m/s</span></div>`;
          const sTxt = p.stressHi < 0.8 ? '<span class="safe">holds</span>' : p.stressLo > 1 ? '<span class="fail">breaks up</span>' : `<span class="risk">uncertain (${Math.round(p.stressLo * 100)}–${Math.round(p.stressHi * 100)}%)</span>`;
          h += `<div class="st-row"><span class="k">Structure under thrust</span><span class="v">${sTxt}</span></div>`;
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
        } else h += `<div class="verdict risk">${esc(p.reason || 'Add an engine on a launch pad.')}</div>`;
        h += `<button id="launch-btn" class="launch-btn" ${r.validate().ok ? '' : 'disabled'}>LAUNCH</button></div>`;
      }
    }
    const el = $('status');
    if (el._h !== h) {
      el.innerHTML = h;
      el._h = h;
    }
  }

  // ───────────────────────────── picking & hover

  pick(wx, wy) {
    const g = this.game;
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
      if (inside || Math.hypot(lp.x, lp.y) < 0.45) return { kind: 'chunk', ref: c };
    }
    for (const s of g.structures) {
      const lp = s.localPos(wx, wy);
      const b = s.at(Math.round(lp.x), Math.round(lp.y));
      if (b) return { kind: s === g.colony ? 'block' : s.kind === 'rocket' ? 'rocket' : 'wreck', ref: b, struct: s };
    }
    return null;
  }

  updateHover(dt) {
    const g = this.game;
    if (!this.mouse.in || this.app.dragging) {
      this.hover = null;
      $('tooltip').classList.add('hidden');
      return;
    }
    const w = this.R.toWorld(this.mouse.x, this.mouse.y);
    const prev = this.hover;
    this.hover = this.pick(w.x, w.y);
    if (!prev || !this.hover || prev.ref !== this.hover.ref) this.hoverT = 0;
    else this.hoverT += dt;
    this.renderTooltip(w);
  }

  renderTooltip(w) {
    const g = this.game;
    const tt = $('tooltip');
    let h = '';
    const hv = this.hover;
    if (this.paletteHover) {
      const f = FUNCS[this.paletteHover];
      const m = f.fixedMat ? g.planet.salvage : this.mat;
      const cost = [...g.costOf(this.paletteHover, m)].map(([id, n]) => `${n} ${materialById(g.planet, id).name}`).join(' + ');
      h = `<div class="tt-title">${f.name}</div><div class="tt-dim">${esc(f.desc)}</div><div style="margin-top:4px">Cost: <b>${cost || 'free'}</b></div>`;
    } else if (this.tool === 'build' && this.ghost) {
      const gh = this.ghost;
      const f = FUNCS[this.fn];
      const m = gh.mat || this.mat;
      const kn = g.knowledge.get(m);
      const ml = m.d === undefined ? 0 : kn.d[0] * f.fill + f.equip,
        mh = kn.d[1] * f.fill + f.equip;
      const massTxt = mh / Math.max(ml, 1e-6) < 1.03 ? `${ml.toFixed(2)} t` : kn.d[1] >= D_PRIOR[1] ? `${ml.toFixed(1)} t or more` : `${ml.toFixed(1)}–${mh.toFixed(1)} t`;
      h = `<div class="tt-title">${f.name} · ${esc(m.name)}</div><div class="tt-dim">mass ${massTxt}</div>`;
      if (!gh.valid) h += `<div class="fail">${esc(gh.reason)}</div>`;
      else if (gh.summary) h += `<div class="${gh.summary.cls}">${esc(gh.summary.text)}</div>`;
      if (gh.layerNote) h += `<div class="${gh.layerNote.cls}">${esc(gh.layerNote.text)}</div>`;
    } else if (hv && hv.kind === 'chunk') {
      const c = hv.ref;
      const k = g.knowledge.get(c.mat);
      const L = g.planet.layers;
      h = c.debris
        ? `<div class="tt-title">Lander debris <span class="tt-dim">· ${c.units} salvage</span></div><div class="tt-dim">A piece of your own ship, still floating.</div>`
        : `<div class="tt-title">${esc(c.mat.name)} chunk <span class="tt-dim">· ${c.units} units</span></div>`;
      const ms = c.debris ? null : g.flotsam.measureWaterline(c);
      const p = c.body.getPosition();
      if (ms) {
        const est = ms.upper.rho + ms.frac * (ms.lower.rho - ms.upper.rho);
        h += `<div class="tt-dim">${Math.round(ms.frac * 100)}% below the ${ms.upper.name === 'air' ? 'surface' : esc(ms.upper.name) + '/' + esc(ms.lower.name) + ' line'}</div>`;
        if (this.hoverT > 0.7) {
          const err = 0.03 * (ms.lower.rho - ms.upper.rho);
          g.knowledge.densityInterval(c.mat, c.mat.d - err * (0.3 + Math.random() * 0.7), c.mat.d + err * (0.3 + Math.random() * 0.7), 'waterline reading');
          h += `<div>Waterline reading: <b>ρ ≈ ${est.toFixed(2)}</b></div>`;
        } else h += `<div class="tt-dim">hold still to read its waterline…</div>`;
      } else if (c.layer === 5 && p.y < g.physics.floorAt(p.x) + 1.6) h += `<div class="tt-dim">resting on the floor: denser than ${esc(L[5].name)}</div>`;
      else if (Math.abs(p.y - g.sea.surfaceY(p.x, g.time)) < 1.2) h += `<div class="tt-dim">floating on ${esc(L[3].name)}</div>`;
      else h += `<div class="tt-dim">drifting in ${esc(L[Math.min(5, Math.max(0, c.layer))].name)}</div>`;
      if (c.fizz > 0.2) h += `<div class="fail">It is reacting with the fluid!</div>`;
      const reach = this.reachFor(p);
      h += reach.ok ? `<div class="tt-act">Click to haul in · ${reach.d.toFixed(0)} m</div>` : `<div class="tt-dim">Out of reach (${reach.d.toFixed(0)} m). A crane nearer to it would get it.</div>`;
      if (!k.seen) h += `<div class="tt-dim">Unknown material: haul one in to start a notebook page.</div>`;
    } else if (hv && (hv.kind === 'block' || hv.kind === 'rocket')) {
      const b = hv.ref;
      const f = FUNCS[b.fn];
      const L = g.planet.layers;
      h = `<div class="tt-title">${f.name}${f.fixedMat ? '' : ` · ${esc(b.mat.name)}`}</div>`;
      if (b.layer >= 0 && b.layer <= 5) h += `<div class="tt-dim">in ${esc(L[b.layer].name)}${b.wet > 0.05 && b.wet < 0.95 ? ' (at the waterline)' : ''}</div>`;
      const st = b.state;
      if (b.fn === 'pump' || b.fn === 'condenser') h += st.active ? `<div class="safe">Working</div>` : `<div class="risk">Idle: must sit inside ${esc(b.fn === 'pump' ? L[5].name : L[0].name)}</div>`;
      if (b.fn === 'smelter') h += `<div class="tt-dim">${st.recipe ? st.recipe.map((id) => materialById(g.planet, id).name).join(' + ') : 'no recipe: click to set one'}</div>`;
      if (b.fn === 'lab') h += `<div class="tt-dim">${st.job ? this.jobName(st.job) : 'idle'}</div>`;
      if (b.fn === 'crane') h += `<div class="tt-dim">auto-haul ${st.auto === false ? 'off' : 'on'} · reach ${GRAPPLE_REACH_CRANE} m</div>`;
      if (b.fn === 'tank' && b.fuel) h += `<div class="tt-dim">${b.fuel.toFixed(1)} propellant</div>`;
      let dmg = 0,
        load = 0;
      for (const e of b.edges) if (e) {
        dmg = Math.max(dmg, e.damage);
        load = Math.max(load, e.need || 0);
      }
      if (load > 1) h += `<div>Heaviest joint load: <b>${Math.round(load)} kN</b></div>`;
      if (dmg > 0.02) h += `<div class="${dmg > 0.5 ? 'fail' : 'risk'}">Joint damage ${Math.round(dmg * 100)}%</div>`;
      if (b.corroding) h += `<div class="fail">Corroding!</div>`;
      if (b.swell > 0.05) h += `<div class="risk">Swollen with fluid (+${Math.round(b.swell * 70)}% weight)</div>`;
      if (b.flooded) h += `<div class="fail">Flooded</div>`;
      if (hv.kind === 'block' && b.fn !== 'core') h += `<div class="tt-act">${this.tool === 'repair' && dmg > 0.02 ? 'Click to patch (1 unit)' : this.tool === 'jettison' ? 'Click to jettison' : this.tool === 'dismantle' ? 'Click to dismantle' : FUNCS[b.fn].group === 'industry' || b.fn === 'crane' ? 'Click for controls · right-click to dismantle' : 'Right-click to dismantle'}</div>`;
      if (b.fn === 'core') h += `<div class="tt-dim">${esc(f.desc)}</div>`;
    } else if (hv && hv.kind === 'wreck') {
      const s = hv.struct;
      const mats = [...new Set(s.list.map((b) => b.mat.name))].join(', ');
      h = `<div class="tt-title">Wreckage · ${s.list.length} block${s.list.length > 1 ? 's' : ''}</div><div class="tt-dim">${esc(mats)}</div>`;
      if (s.list.length === 1 && s.list[0].fn === 'frame') {
        const b = s.list[0];
        const v = s.body.getLinearVelocity();
        if (Math.hypot(v.x, v.y) < 0.5) {
          const p = s.body.getWorldCenter();
          const k = g.sea.layerAt(p.x, p.y, g.time);
          h += `<div class="tt-dim">settled in ${esc(g.planet.layers[Math.min(5, k)].name)}</div>`;
          this.observeWreck(s);
        }
      }
      const reach = this.reachFor(s.body.getWorldCenter());
      h += reach.ok ? `<div class="tt-act">Click to salvage (half its cost back)</div>` : `<div class="tt-dim">Out of reach (${reach.d.toFixed(0)} m)</div>`;
    }
    if (!h) {
      tt.classList.add('hidden');
      return;
    }
    tt.innerHTML = h;
    tt.classList.remove('hidden');
    const x = this.paletteHover ? 190 : this.mouse.x + 18;
    const y = this.paletteHover ? this.mouse.y - 10 : this.mouse.y + 16;
    const r = tt.getBoundingClientRect();
    tt.style.left = `${Math.min(window.innerWidth - r.width - 8, x)}px`;
    tt.style.top = `${Math.min(window.innerHeight - r.height - 8, y)}px`;
  }

  /** A single jettisoned frame block resting at an interface brackets its material's density. */
  observeWreck(s) {
    if (s._observed) return;
    const g = this.game;
    const b = s.list[0];
    const p = s.body.getWorldCenter();
    const L = g.planet.layers;
    const surf = g.sea.surfaceY(p.x, g.time);
    if (Math.abs(p.y - surf) < 1) {
      g.knowledge.densityInterval(b.mat, 0, L[3].rho, `a ${b.mat.name} block floats`);
      s._observed = true;
      return;
    }
    for (const k of [4, 5]) {
      if (Math.abs(p.y - g.sea.ifaceY(k, p.x, g.time)) < 1) {
        g.knowledge.densityInterval(b.mat, L[k - 1].rho, L[k].rho, `a ${b.mat.name} block settled there`);
        s._observed = true;
        return;
      }
    }
    if (p.y < g.physics.floorAt(p.x) + 1.2) {
      g.knowledge.densityInterval(b.mat, L[5].rho, Infinity, `a ${b.mat.name} block sank`);
      s._observed = true;
    }
  }

  reachFor(p) {
    const g = this.game;
    let best = { ok: false, d: Infinity };
    for (const o of g.grapples.owners()) {
      const op = g.grapples.ownerPos(o);
      const d = Math.hypot(p.x - op.x, p.y - op.y);
      const reach = g.grapples.reachOf(o);
      if (d <= reach && (!best.ok || d < best.d)) best = { ok: true, d, owner: o, op, reach };
      else if (!best.ok && d < best.d) best = { ok: false, d, owner: o, op, reach };
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
    if (this.tool !== 'build' || !this.mouse.in || !g.colony || this.paletteHover) {
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
    const gh = { gx: c.gx, gy: c.gy, valid: chk.ok, reason: chk.reason, mat, fn: this.fn, preds: null, summary: null, layerNote: null };
    if (chk.ok) {
      const fy = ghostFluid(g, g.colony, c.gx, c.gy);
      const extra = { gx: c.gx, gy: c.gy, fn: this.fn, mat, fx: 0, fy, ex: 0, ey: 0, ghost: true };
      gh.preds = predictJoints(g, g.colony, [extra]);
      let worst = 'safe',
        hi = 0;
      for (const p of gh.preds) {
        const c2 = classify(p);
        hi = Math.max(hi, p.hi);
        if (c2 === 'fail') worst = 'fail';
        else if (c2 === 'risk' && worst !== 'fail') worst = 'risk';
      }
      gh.summary =
        worst === 'safe'
          ? { cls: 'safe', text: 'Every joint holds, for anything this material could be.' }
          : worst === 'fail'
            ? { cls: 'fail', text: 'Something will certainly give way.' }
            : { cls: 'risk', text: 'Some joints might fail. It depends on what you don’t know yet.' };
      const st = colonyStatus(g);
      const kd = g.knowledge.get(mat).d;
      const fnd = FUNCS[this.fn];
      const gp = g.colony.worldPos(c.gx, c.gy);
      const above = gp.y - g.sea.surfaceY(gp.x, g.time);
      const wetNow = Math.max(0, Math.min(1, 0.5 - above));
      const kLay = Math.max(3, Math.min(5, g.sea.layerAt(gp.x, Math.min(gp.y, g.sea.surfaceY(gp.x, g.time) - 0.01), g.time)));
      const lift = g.planet.layers[kLay].rho * wetNow + (above < 1.1 ? g.planet.layers[3].rho * (1 - wetNow) : 0);
      const addHi = kd[1] * fnd.fill + fnd.equip - lift;
      const addLo = kd[0] * fnd.fill + fnd.equip - lift;
      if (st && addLo > 0 && st.reserve - addLo < 0.2) gh.summary = { cls: 'fail', text: `This would push the deck under (spare buoyancy ${st.reserve.toFixed(1)} t). Add floats first.` };
      else if (st && addHi > 0 && st.reserve - addHi < 1) gh.summary = { cls: 'risk', text: kd[1] >= D_PRIOR[1] ? `If ${mat.name} is dense, this could sink the raft (${st.reserve.toFixed(1)} t spare).` : `The raft is nearly out of buoyancy (${st.reserve.toFixed(1)} t spare).` };
      if (this.fn === 'pump' || this.fn === 'condenser') {
        const p = g.colony.worldPos(c.gx, c.gy);
        const k = g.sea.layerAt(p.x, p.y, g.time);
        const want = this.fn === 'pump' ? 5 : 0;
        const L = g.planet.layers;
        gh.layerNote = k === want ? { cls: 'safe', text: `Inside ${L[want].name}: it will work.` } : { cls: 'risk', text: `This spot is in ${L[Math.min(5, k)].name}. It only works inside ${L[want].name}.` };
      }
      const kk = g.knowledge.get(mat);
      const p = g.colony.worldPos(c.gx, c.gy);
      const k = g.sea.layerAt(p.x, p.y, g.time);
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
      this.closeModule();
      return;
    }
    if (hv.kind === 'chunk') {
      const r = g.grapples.fire({ kind: 'chunk', ref: hv.ref });
      if (!r.ok) g.log(r.reason, 'warn');
    } else if (hv.kind === 'wreck') {
      const r = g.grapples.fire({ kind: 'wreck', ref: hv.struct });
      if (!r.ok) g.log(r.reason, 'warn');
    } else if (hv.kind === 'block') {
      this.openModule(hv.ref);
    }
  }

  secondaryAt(sx, sy) {
    const g = this.game;
    const w = this.R.toWorld(sx, sy);
    const hv = this.pick(w.x, w.y);
    if (hv && hv.kind === 'block' && hv.ref.fn !== 'core' && g.state === 'playing') {
      g.deconstruct(hv.ref);
      return;
    }
    if (this.tool !== 'select') this.setTool('select');
  }

  endDrag() {
    this.lastPlaced = null;
  }

  // ───────────────────────────── module panel

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
    const g = this.game;
    const b = this.selected;
    if (!b) return;
    const f = FUNCS[b.fn];
    const L = g.planet.layers;
    let h = `<button class="icon-btn mp-close" data-close>×</button><h4>${f.name}${f.fixedMat ? '' : ` <span class="tt-dim">· ${esc(b.mat.name)}</span>`}</h4><div class="note-small">${esc(f.desc)}</div>`;
    if (b.fn === 'smelter') {
      const raws = g.planet.materials.filter((m) => g.knowledge.get(m).seen);
      const [ra, rb] = b.state.recipe || ['', ''];
      const opt = (sel) => `<option value="">—</option>` + raws.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)} (${g.stockOf(m.id)})</option>`).join('');
      h += `<select data-recipe="0">${opt(ra)}</select><select data-recipe="1">${opt(rb)}</select>`;
      if (ra && rb) {
        const p = g.knowledge.pairPossible(materialById(g.planet, ra), materialById(g.planet, rb));
        h += `<div class="note-small ${p.known === 'volatile' ? 'fail' : p.known ? '' : 'risk'}">${p.known ? 'Known: ' + OUTCOME_WORD[p.known] : 'Untested pairing. It could explode.'}</div>`;
      }
      if (b.state.recipe) h += `<button class="mp-btn" data-stopsmelt>Stop smelting</button>`;
    }
    if (b.fn === 'crane') h += `<button class="mp-btn" data-auto>Auto-haul: ${b.state.auto === false ? 'off' : 'on'}</button>`;
    if (b.fn === 'pump' || b.fn === 'condenser') {
      const want = b.fn === 'pump' ? 5 : 0;
      h += `<div class="note-small ${b.state.active ? 'safe' : 'risk'}">${b.state.active ? 'Working.' : `Idle: it sits in ${esc(L[Math.min(5, Math.max(0, b.layer))].name)}, needs ${esc(L[want].name)}.`}</div>`;
    }
    if (b.fn === 'lab') h += `<div class="note-small">${b.state.job ? 'Running: ' + this.jobName(b.state.job) : 'Idle. Queue tests from the Notebook.'}</div>`;
    if (b.fn !== 'core') {
      h += `<button class="mp-btn" data-repair>Patch joints (1 unit)</button>`;
      h += `<button class="mp-btn" data-dismantle>Dismantle (75% back)</button>`;
    }
    $('module-panel').innerHTML = h;
  }

  positionModulePanel() {
    const b = this.selected;
    const el = $('module-panel');
    if (!b) return;
    if (!b.struct || b.struct !== this.game.colony) {
      this.closeModule();
      return;
    }
    const p = b.struct.worldPos(b.gx, b.gy);
    const s = this.R.toScreen(p.x, p.y);
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, s.x + 24))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, s.y - r.height / 2))}px`;
  }

  onModuleClick(e) {
    const g = this.game;
    const b = this.selected;
    const t = e.target.closest('button');
    if (!t || !b) return;
    if (t.dataset.close !== undefined) return this.closeModule();
    if (t.dataset.auto !== undefined) b.state.auto = b.state.auto === false;
    if (t.dataset.stopsmelt !== undefined) g.modules.setRecipe(b, null, null);
    if (t.dataset.repair !== undefined) g.repair(b);
    if (t.dataset.dismantle !== undefined) {
      g.deconstruct(b);
      return this.closeModule();
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

    if (this.tool === 'select' && g.state === 'playing') {
      const owners = g.grapples.owners().filter((o) => !g.grapples.busy(o));
      if (owners.length) {
        const ops = owners.map((o) => ({ o, p: g.grapples.ownerPos(o), r: g.grapples.reachOf(o) }));
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        for (const c of g.flotsam.chunks) {
          if (c.grabbed || !c.body) continue;
          const p = c.body.getPosition();
          if (!ops.some((q) => Math.hypot(p.x - q.p.x, p.y - q.p.y) <= q.r)) continue;
          const s = R.toScreen(p.x, p.y);
          ctx.beginPath();
          ctx.arc(s.x, s.y, z * 0.95 + 3 + pulse * 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,220,150,${0.18 + 0.2 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
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
      if (reach.owner) {
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

    const gh = this.ghost;
    if (gh && col) {
      tf(col.body);
      if (gh.preds) this.drawPreds(ctx, gh.preds, z, true);
      ctx.fillStyle = gh.valid ? 'rgba(255,255,255,0.18)' : 'rgba(255,80,80,0.18)';
      ctx.fillRect(gh.gx - 0.5, gh.gy - 0.5, 1, 1);
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = gh.valid ? (gh.summary ? { safe: '#7dffb0', risk: '#ffc65c', fail: '#ff5b5b' }[gh.summary.cls] : '#fff') : 'rgba(255,90,90,0.9)';
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
      const x = R.cssW - (this.journalOpen ? 380 : 40);
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

  drawPreds(ctx, preds, z, ghost) {
    for (const p of preds) {
      const cls = classify(p);
      if (!ghost && cls === 'safe' && p.hi < 0.45) continue;
      if (ghost && cls === 'safe' && !p.ghost && p.hi < 0.6) continue;
      const a = p.a,
        b = p.b;
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
