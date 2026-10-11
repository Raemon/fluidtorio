import { Game } from './sim/game.js';
import { pairOutcome } from './sim/gen.js';
import { DT, FUNCS, BUILD_ORDER } from './sim/config.js';
import { Renderer } from './render/renderer.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);

function randomSeed() {
  return Math.floor(Math.random() * 1e9) >>> 0;
}

function parseSeed(s) {
  const t = String(s).trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('fluidtorio.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('fluidtorio.' + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

class App {
  constructor() {
    try {
      this.renderer = new Renderer($('gl'), $('overlay'));
    } catch (e) {
      console.error(e);
      $('nogl').classList.remove('hidden');
      $('title').classList.add('hidden');
      return;
    }
    this.audio = new AudioEngine();
    this.muted = store.get('muted', false);
    this.ui = new UI(this);
    this.speed = 1;
    this.paused = false;
    this.mode = 'title';
    this.difficulty = store.get('difficulty', 'standard');
    this.seed = randomSeed();
    this.keys = new Set();
    this.acc = 0;
    this.followRocket = false;
    this.startAttract();
    this.wireTitle();
    this.wireInput();
    window.addEventListener('resize', () => this.renderer.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  click() {
    this.audio.play('click');
  }

  // ───────────────────────────── title / attract

  startAttract() {
    const g = new Game({ seed: 4242 + Math.floor(Math.random() * 1000), attract: true });
    const col = g.colony;
    const mats = g.planet.materials;
    for (const m of mats) g.addStock(m.id, 999);
    g.addStock('salvage', 999);
    const keelMat = mats.slice().sort((a, b) => Math.abs(a.d - 1.6) - Math.abs(b.d - 1.6))[0];
    for (let x = 5; x <= 8; x++) {
      g.place(x, -1, 'hollow', g.planet.salvage);
      g.place(-x, -1, 'hollow', g.planet.salvage);
      g.place(x, 0, 'hollow', g.planet.salvage);
      g.place(-x, 0, 'hollow', g.planet.salvage);
    }
    for (let y = -2; y >= -7; y--) g.place(0, y, 'frame', keelMat);
    g.place(0, -8, 'crane', keelMat);
    g.place(-3, 1, 'lab', g.planet.salvage);
    g.place(3, 1, 'smelter', g.planet.salvage);
    for (let y = 1; y <= 7; y++) g.place(-6, y, y < 5 ? 'frame' : 'hollow', g.planet.salvage);
    g.place(-6, 8, 'crane', g.planet.salvage);
    let pair = null;
    for (let i = 0; i < mats.length && !pair; i++)
      for (let j = i + 1; j < mats.length && !pair; j++) if (pairOutcome(g.planet, mats[i], mats[j]) !== 'volatile') pair = [mats[i].id, mats[j].id];
    if (pair) g.modules.setRecipe(col.list.find((b) => b.fn === 'smelter'), pair[0], pair[1]);
    this.game = g;
    this.renderer.cam.x = 4;
    this.renderer.cam.y = 0;
    this.renderer.cam.zoom = Math.max(18, Math.min(30, window.innerHeight / 34));
    this.mode = 'title';
    $('hud').classList.add('hidden');
    $('title').classList.remove('hidden');
  }

  wireTitle() {
    const input = $('seed-input');
    input.value = String(this.seed);
    $('seed-random').addEventListener('click', () => {
      this.seed = randomSeed();
      input.value = String(this.seed);
      this.click();
    });
    document.querySelectorAll('#diff-row button').forEach((b) => {
      b.classList.toggle('active', b.dataset.diff === this.difficulty);
      b.addEventListener('click', () => {
        this.difficulty = b.dataset.diff;
        store.set('difficulty', this.difficulty);
        document.querySelectorAll('#diff-row button').forEach((x) => x.classList.toggle('active', x === b));
        this.click();
      });
    });
    $('btn-start').addEventListener('click', () => {
      this.seed = parseSeed(input.value || randomSeed());
      this.startGame();
    });
    $('btn-howto').addEventListener('click', () => this.showHelp(true));
    document.querySelectorAll('.close-help').forEach((b) => b.addEventListener('click', () => this.showHelp(false)));
    $('help').addEventListener('click', (e) => {
      if (e.target === $('help')) this.showHelp(false);
    });
    $('btn-retry').addEventListener('click', () => this.startGame());
    $('btn-new').addEventListener('click', () => {
      this.seed = randomSeed();
      $('seed-input').value = String(this.seed);
      this.startGame();
    });
    $('btn-linger').addEventListener('click', () => {
      $('end').classList.add('hidden');
      this.click();
    });
  }

  startGame() {
    this.audio.init();
    this.audio.setMuted(this.muted);
    const g = new Game({ seed: this.seed, difficulty: this.difficulty });
    this.game = g;
    g.on('sfx', (s) => this.audio.play(s.name, s));
    g.on('end', (e) => setTimeout(() => this.showEnd(e), e.won ? 3200 : 1200));
    g.on('tremor', (e) => this.audio.play(e.warn ? 'tremorWarn' : 'rumble'));
    g.on('launch', () => (this.followRocket = true));
    g.on('rocketFailed', () => setTimeout(() => (this.followRocket = false), 2500));
    this.ui.bind(g);
    const cam = this.renderer.cam;
    cam.x = 0;
    cam.y = 1;
    cam.zoom = Math.max(18, Math.min(32, window.innerHeight / 36));
    this.mode = 'play';
    this.paused = false;
    this.setSpeed(1);
    this.followRocket = false;
    this.renderer.schlTarget = 0;
    this.renderer.particles.list.length = 0;
    $('title').classList.add('hidden');
    $('end').classList.add('hidden');
    $('hud').classList.remove('hidden');
    g.log(`Landfall on Strata. Mount ${g.volcanoName()} is waking. Haul in what drifts past and learn what it's made of.`, 'info');
    this.click();
  }

  showHelp(on) {
    $('help').classList.toggle('hidden', !on);
    if (on && this.mode === 'play') this.paused = true;
    this.syncSpeedButtons();
    this.click();
  }

  showEnd(e) {
    const g = this.game;
    if (this.mode !== 'play') return;
    const won = e.won;
    $('end-kicker').textContent = won ? 'Escape velocity' : g.lostReason ? 'The colony is lost' : `Mount ${g.volcanoName()} erupted`;
    $('end-title').textContent = won ? 'You got off Strata.' : g.lostReason ? g.lostReason : 'The sea boiled.';
    const left = g.timeLeft();
    const known = [...g.knowledge.mats.values()].filter((k) => k.mat.kind !== 'salvage');
    const learned = known.filter((k) => k.d[1] / k.d[0] < 1.1 && k.s[1] / k.s[0] < 1.3).length;
    $('end-text').textContent = won
      ? `With ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} to spare. Everything you flew on, you learned on the way.`
      : `You pinned down ${learned} of ${known.length} materials before the end. Same planet, same materials: what you know now carries over to the next attempt.`;
    const stats = [
      ['Chunks hauled', g.stats.chunks],
      ['Lab tests', g.stats.tests],
      ['Blocks built', g.stats.blocks],
      ['Collapses', g.stats.collapses],
      ['Alloy units', g.stats.alloys],
      ['Launches', g.stats.launches],
    ];
    $('end-stats').innerHTML = stats.map(([l, v]) => `<div class="stat"><div class="sv">${v}</div><div class="sl">${l}</div></div>`).join('');
    $('end').classList.remove('hidden');
  }

  setSpeed(s) {
    if (s === 0) this.paused = !this.paused;
    else {
      this.speed = s;
      this.paused = false;
    }
    this.syncSpeedButtons();
    this.click();
  }

  syncSpeedButtons() {
    document.querySelectorAll('.speed').forEach((b) => {
      const s = +b.dataset.speed;
      b.classList.toggle('active', s === 0 ? this.paused : !this.paused && s === this.speed);
    });
  }

  // ───────────────────────────── input

  wireInput() {
    const gl = $('gl');
    const ui = this.ui;
    let down = null;
    const pos = (e) => ({ x: e.clientX, y: e.clientY });
    gl.addEventListener('contextmenu', (e) => e.preventDefault());
    gl.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play') return;
      this.audio.init();
      gl.setPointerCapture(e.pointerId);
      const p = pos(e);
      down = { button: e.button, x: p.x, y: p.y, camX: this.renderer.cam.x, camY: this.renderer.cam.y, moved: false };
      if (e.button === 0) ui.primaryAt(p.x, p.y, false);
    });
    gl.addEventListener('pointermove', (e) => {
      const p = pos(e);
      ui.mouse.x = p.x;
      ui.mouse.y = p.y;
      ui.mouse.in = true;
      this.renderer.lens.x = p.x;
      this.renderer.lens.y = p.y;
      if (!down) return;
      const dx = p.x - down.x,
        dy = p.y - down.y;
      if (Math.hypot(dx, dy) > 5) down.moved = true;
      if (down.button === 2 || down.button === 1) {
        if (down.moved) {
          this.dragging = true;
          const z = this.renderer.cam.zoom;
          this.renderer.cam.x = down.camX - dx / z;
          this.renderer.cam.y = down.camY + dy / z;
          this.followRocket = false;
        }
      } else if (down.button === 0 && (ui.tool === 'build' || ui.tool === 'dismantle')) {
        ui.primaryAt(p.x, p.y, true);
      }
    });
    const up = (e) => {
      if (!down) return;
      const p = pos(e);
      if (down.button === 2 && !down.moved) ui.secondaryAt(p.x, p.y);
      ui.endDrag();
      down = null;
      this.dragging = false;
    };
    gl.addEventListener('pointerup', up);
    gl.addEventListener('pointercancel', up);
    gl.addEventListener('pointerleave', () => (ui.mouse.in = false));
    gl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.mode !== 'play') return;
        const cam = this.renderer.cam;
        const before = this.renderer.toWorld(e.clientX, e.clientY);
        const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
        cam.zoom = Math.max(5, Math.min(70, cam.zoom * k));
        const after = this.renderer.toWorld(e.clientX, e.clientY);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lensHeld = false;
    });
  }

  onKey(e, isDown) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Shift') this.lensHeld = isDown;
    if (!isDown) {
      this.keys.delete(k);
      return;
    }
    if (this.mode !== 'play') {
      if (k === 'Enter' && this.mode === 'title') $('btn-start').click();
      if (k === 'Escape') this.showHelp(false);
      return;
    }
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      this.keys.add(k);
      if (k.startsWith('Arrow')) e.preventDefault();
      this.followRocket = false;
      return;
    }
    const ui = this.ui;
    if (k === 'Tab') {
      e.preventDefault();
      ui.toggleSchlieren();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      this.setSpeed(0);
      return;
    }
    if (k === 'Escape') {
      if (!$('help').classList.contains('hidden')) this.showHelp(false);
      else {
        ui.setTool('select');
        ui.closeModule();
      }
      return;
    }
    if (e.repeat) return;
    const fn = BUILD_ORDER.find((f) => FUNCS[f].key === k);
    if (fn) return ui.pickFn(fn);
    switch (k) {
      case 'q':
        ui.cycleMat(-1);
        break;
      case 'e':
        ui.cycleMat(1);
        break;
      case 'x':
        ui.setTool('dismantle');
        break;
      case 'r':
        ui.setTool('repair');
        break;
      case 'j':
        ui.setTool('jettison');
        break;
      case 'v':
        ui.toggleStress();
        break;
      case 'n':
        ui.toggleJournal();
        break;
      case 'h':
      case '?':
        this.showHelp($('help').classList.contains('hidden'));
        break;
      case 'f':
        this.focusColony();
        break;
      case ',':
        this.setSpeed(this.speed === 4 ? 2 : 1);
        break;
      case '.':
        this.setSpeed(this.speed === 1 ? 2 : 4);
        break;
      case 'm':
        this.muted = !this.muted;
        store.set('muted', this.muted);
        this.audio.setMuted(this.muted);
        break;
      default:
        break;
    }
  }

  focusColony() {
    const g = this.game;
    if (!g.colony) return;
    const p = g.colony.body.getWorldCenter();
    this.camTarget = { x: p.x, y: p.y + 2 };
    this.followRocket = false;
  }

  // ───────────────────────────── loop

  loop(now) {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    const g = this.game;
    const R = this.renderer;
    const cam = R.cam;
    if (this.mode === 'title') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 4) {
        g.step();
        this.acc -= DT;
        n++;
      }
      cam.x = 4 + Math.sin(now / 9000) * 6;
      cam.y = -1 + Math.sin(now / 13000) * 5;
      R.lens.target = 1;
      R.lens.x = window.innerWidth * (0.62 + 0.16 * Math.sin(now / 3100));
      R.lens.y = window.innerHeight * (0.52 + 0.2 * Math.sin(now / 4700));
      R.lens.r = Math.min(220, window.innerHeight * 0.2);
    } else {
      if (!this.paused && $('help').classList.contains('hidden')) {
        this.acc += dt * this.speed;
        let n = 0;
        const max = 6 * this.speed;
        while (this.acc >= DT && n < max) {
          g.step();
          this.acc -= DT;
          n++;
        }
        if (n >= max) this.acc = 0;
      }
      const pan = (30 / cam.zoom) * 18 * dt;
      if (this.keys.has('a') || this.keys.has('ArrowLeft')) cam.x -= pan;
      if (this.keys.has('d') || this.keys.has('ArrowRight')) cam.x += pan;
      if (this.keys.has('w') || this.keys.has('ArrowUp')) cam.y += pan;
      if (this.keys.has('s') || this.keys.has('ArrowDown')) cam.y -= pan;
      if (this.followRocket && g.rocket.struct) {
        const p = g.rocket.struct.body.getWorldCenter();
        cam.x += (p.x - cam.x) * Math.min(1, dt * 4);
        cam.y += (p.y - 2 - cam.y) * Math.min(1, dt * 4);
      } else if (this.camTarget) {
        cam.x += (this.camTarget.x - cam.x) * Math.min(1, dt * 5);
        cam.y += (this.camTarget.y - cam.y) * Math.min(1, dt * 5);
        if (Math.hypot(this.camTarget.x - cam.x, this.camTarget.y - cam.y) < 0.05) this.camTarget = null;
      }
      cam.y = Math.max(g.planet.floor + 6, Math.min(g.state === 'won' ? 420 : 320, cam.y));
      cam.x = Math.max(-170, Math.min(170, cam.x));
      R.lens.target = this.lensHeld || this.ui.lensLatched ? 1 : 0;
      R.lens.r = Math.min(170, window.innerHeight * 0.17);
      this.ui.update(dt);
    }
    R.frame(g, this.mode === 'play' ? this.ui : { hideRuler: true }, dt);
    if (this.audio) {
      let smelting = 0,
        pumping = 0,
        stressMax = 0;
      if (g.colony) {
        for (const b of g.colony.list) {
          if (b.fn === 'smelter' && b.state.phase === 'heating') smelting++;
          if ((b.fn === 'pump' || b.fn === 'condenser') && b.state.active) pumping++;
          for (const e of b.edges) if (e && e.stress > stressMax) stressMax = e.stress;
        }
      }
      this.audio.update(
        {
          camX: cam.x,
          camY: cam.y,
          paused: this.paused || this.mode !== 'play',
          doom: g.attract ? 0.1 : Math.min(1, g.time / g.duration),
          erupting: g.state === 'erupting',
          smelting,
          pumping,
          rocketBurning: !!(g.rocket.struct && g.rocket.burning),
          rocketAlt: g.rocket.struct ? g.rocket.altitude() : 0,
          stressMax: Math.min(2, stressMax),
          heel: g.colony ? g.colony.body.getAngle() : 0,
        },
        dt,
      );
    }
    requestAnimationFrame((t) => this.loop(t));
  }
}

window.fluidtorio = new App();
