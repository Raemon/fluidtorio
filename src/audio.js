// Fluidtorio audio: everything is synthesized with the Web Audio API (no assets).
// Graph: voices/ambience/music -> master gain -> subsonic HP -> soft high shelf -> compressor -> soft clip -> out.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];
const pent = (base, n) => mtof(base + 12 * Math.floor(n / 5) + PENTA[n % 5]);
const quiet = (promise) => promise && promise.catch && promise.catch(() => {});
const chain = (...n) => {
  for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
  return n[n.length - 1];
};

const MAX_VOICES = 32;
const MUSIC_LEVEL = 0.32;
// Peak level of each ambience layer (before the ambience bus).
const AMB = { sea: 0.16, uw: 0.14, wind: 0.3, volc: 0.2, furn: 0.3, pump: 0.045, rocket: 0.6, groan: 0.12 };
// Minimum spacing between repeats of the same one-shot, in seconds (creak: max 6/s).
const MIN_GAP = { creak: 1 / 6, snap: 0.04, splash: 0.05, flood: 0.08, thud: 0.04, rumble: 0.6, eruption: 2, launch: 1, win: 2, tremorWarn: 1 };
const UI_SOUNDS = new Set(['click', 'warn', 'tremorWarn', 'win']);

// Pad voicings (MIDI), from calm Dorian/Lydian colours to tense Phrygian/diminished ones.
const CHORDS = [
  [[50, 57, 60, 64], [53, 60, 64, 71], [55, 62, 64, 69], [48, 55, 62, 71], [57, 64, 67, 71], [45, 52, 59, 62]],
  [[45, 52, 57, 60], [53, 57, 60, 64], [43, 50, 55, 58], [52, 55, 59, 62], [48, 51, 55, 62]],
  [[50, 56, 60, 65], [50, 53, 57, 63], [45, 51, 55, 58], [46, 53, 58, 61], [44, 50, 53, 59]],
];

// One-shot effects. Called with `this` = AudioEngine, v = voice, k = intensity 0..3, b = brittleness 0..1.
const SFX = {
  grappleFire(v) {
    v.wet(0.12);
    this._nz(v, { f: 450, f1: 3200, st: 0.14, q: 1.4, a: 0.03, r: 0.22, g: 0.5 });
    this._nz(v, { ft: 'highpass', f: 4200, a: 0.01, r: 0.08, g: 0.08 });
    const ts = [];
    for (let i = 0, t = 0.07; i < 7; i++, t += 0.02 + i * 0.004) ts.push([t, 0.22 * Math.pow(0.84, i)]);
    this._clicks(v, ts, { f: 2600, q: 4, tau: 0.004 });
  },

  grappleHit(v, k) {
    v.wet(0.2);
    const p = rand(0.94, 1.06), kk = 0.6 + 0.3 * k;
    this._tone(v, { f: 1180 * p, a: 0.001, r: 0.24, g: 0.06 * kk });
    this._tone(v, { f: 1790 * p, a: 0.001, r: 0.15, g: 0.04 * kk });
    this._tone(v, { f: 2960 * p, a: 0.001, r: 0.07, g: 0.025 * kk });
    this._tone(v, { f: 150 * p, f1: 85, a: 0.002, r: 0.12, g: 0.26 * kk });
    this._nz(v, { f: 2200, q: 1.2, a: 0.001, r: 0.025, g: 0.16 * kk });
  },

  collect(v) {
    v.wet(0.35);
    const i = (Math.random() * 6) | 0, j = i + 1 + ((Math.random() * 2) | 0);
    this._glass(v, pent(72, i) * rand(0.997, 1.003), 0, 0.1, 0.9);
    this._glass(v, pent(72, j) * rand(0.997, 1.003), 0.085, 0.09, 1.1);
  },

  place(v, k) {
    v.wet(0.12);
    const p = rand(0.9, 1.1), kk = 0.7 + 0.3 * k;
    this._tone(v, { f: 170 * p, f1: 70 * p, st: 0.1, a: 0.002, r: 0.16, g: 0.3 * kk });
    this._tone(v, { w: 'triangle', f: 340 * p, f1: 210 * p, st: 0.05, a: 0.001, r: 0.06, g: 0.09 * kk });
    this._nz(v, { n: 'brown', ft: 'lowpass', f: 600 * p, a: 0.001, r: 0.07, g: 0.22 * kk });
    this._nz(v, { f: 3800 * p, q: 1, a: 0.0005, r: 0.012, g: 0.14 });
  },

  remove(v) {
    v.wet(0.15);
    const p = rand(0.92, 1.08);
    this._nz(v, { f: 500 * p, f1: 2600 * p, q: 2, a: 0.14, r: 0.025, g: 0.2 }); // swelling scrape (reversed envelope)
    this._tone(v, { f: 380 * p, f1: 900 * p, st: 0.04, t: 0.14, a: 0.002, r: 0.06, g: 0.16 });
    this._nz(v, { ft: 'highpass', f: 2500, t: 0.14, a: 0.001, r: 0.02, g: 0.08 });
  },

  repair(v) {
    v.wet(0.4);
    const root = 76 + pick([0, 2, 5]);
    for (let i = 0; i < 6; i++) this._glass(v, pent(root, i) * rand(0.996, 1.004), i * 0.055, 0.07 - i * 0.006, 0.4);
    this._nz(v, { f: 2500, f1: 7000, q: 2, a: 0.2, r: 0.25, g: 0.07 });
  },

  // Stick-slip creak: a slow sawtooth (pulse train) ringing a small bank of resonant bandpasses.
  creak(v, k, b) {
    const c = this.ctx, t0 = v.t, kk = 0.6 + 0.3 * k;
    const dur = lerp(0.95, 0.2, b) * rand(0.8, 1.25), f = lerp(115, 720, b) * rand(0.85, 1.18);
    const rate = lerp(9, 40, b) * rand(0.8, 1.2);
    v.wet(0.18);
    const saw = c.createOscillator(), env = c.createGain();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(rate, t0);
    saw.frequency.linearRampToValueAtTime(rate * rand(1.3, 1.9), t0 + dur * rand(0.3, 0.6));
    saw.frequency.linearRampToValueAtTime(rate * rand(0.6, 1), t0 + dur);
    this._env(env.gain, t0, 0.7 * kk, dur * 0.3, dur * 0.3, dur * 0.4);
    for (const [ratio, q, w] of [[1, 14, 1], [2.31, 10, 0.5], [0.52, 8, 1 - b]]) {
      if (w < 0.05) continue;
      const bp = this._filt('bandpass', f * ratio, q), wg = this._g(w);
      bp.frequency.setValueAtTime(f * ratio, t0);
      bp.frequency.linearRampToValueAtTime(f * ratio * rand(0.88, 1.12), t0 + dur);
      chain(saw, bp, wg, env);
      v.nodes.push(bp, wg);
    }
    env.connect(v.out);
    saw.start(t0);
    saw.stop(t0 + dur + 0.05);
    v.nodes.push(saw, env);
    v.end = Math.max(v.end, t0 + dur);
    this._nz(v, { f, q: 4, a: dur * 0.3, h: dur * 0.3, r: dur * 0.4, g: 0.015 * kk }); // grit
  },

  snap(v, k, b) {
    const kk = 0.6 + 0.3 * k;
    v.wet(0.2 + 0.2 * b);
    this._nz(v, { ft: 'highpass', f: 1800, a: 0.0008, r: 0.05, g: 0.3 * kk }); // crack
    this._nz(v, { f: 900 + 900 * b, q: 0.9, a: 0.001, r: 0.1, g: 0.2 * kk });
    if (b > 0.15) this._glass(v, rand(1700, 2600), 0.004, 0.1 * b * kk, 0.3 + 0.4 * b);
    if (b < 0.85) {
      const w = (1 - b) * kk, ts = [];
      this._tone(v, { w: 'triangle', f: rand(240, 360), f1: 150, st: 0.12, a: 0.001, r: 0.14, g: 0.13 * w });
      for (let i = 0, t = 0.01; i < 7; i++, t += rand(0.008, 0.025)) ts.push([t, 0.18 * w * rand(0.4, 1)]);
      this._clicks(v, ts, { f: 1100, q: 1.2, tau: 0.006 });
    }
    this._tone(v, { f: 100, f1: 42, st: 0.22, a: 0.002, r: 0.3, g: 0.36 * kk }); // thump
  },

  explosion(v, k) {
    const kk = 0.55 + 0.25 * k;
    v.wet(0.75);
    this._nz(v, { n: 'brown', rate: 0.5, ft: 'lowpass', f: 900, f1: 110, st: 1.2, q: 0.8, a: 0.004, h: 0.08, r: 1.8, g: 0.5 * kk });
    this._nz(v, { f: 1600, f1: 250, st: 0.4, q: 0.7, a: 0.002, r: 0.35, g: 0.2 * kk });
    this._tone(v, { f: 95, f1: 32, st: 1, a: 0.004, r: 1.3, g: 0.38 * kk });
    this._crackle(v, 0.05, 1.4, 28 + 10 * k, 0.1 * kk);
  },

  flood(v, k) {
    const kk = 0.6 + 0.3 * k;
    v.wet(0.25);
    this._nz(v, { n: 'pink', ft: 'lowpass', f: 500, f1: 250, q: 1, a: 0.08, h: 0.1, r: 0.45, g: 0.18 * kk });
    const n = 4 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const f = rand(180, 520);
      this._tone(v, { f, f1: f * rand(1.6, 2.4), st: 0.06, t: rand(0, 0.55), a: 0.004, r: rand(0.05, 0.1), g: 0.13 * kk });
    }
  },

  thud(v, k) {
    const kk = 0.6 + 0.3 * k;
    v.wet(0.15);
    this._tone(v, { f: 85 * rand(0.9, 1.1), f1: 36, st: 0.25, a: 0.003, r: 0.38, g: 0.45 * kk });
    this._nz(v, { n: 'brown', ft: 'lowpass', f: 320, a: 0.002, r: 0.22, g: 0.4 * kk });
    this._nz(v, { ft: 'lowpass', f: 1600, a: 0.0008, r: 0.015, g: 0.1 * kk });
  },

  splash(v, k) {
    const s = k / 3;
    v.wet(0.2 + 0.15 * s);
    this._nz(v, { f: 3200, f1: 380, st: 0.25 + 0.35 * s, q: 0.9, a: 0.008, h: 0.03 * s, r: 0.25 + 0.4 * s, g: 0.1 + 0.24 * s });
    this._nz(v, { ft: 'highpass', f: 5000, a: 0.004, r: 0.06 + 0.1 * s, g: 0.04 + 0.05 * s });
    this._tone(v, { f: 320, f1: 120, st: 0.08, a: 0.002, r: 0.09, g: 0.08 + 0.1 * s });
    for (let i = 0; i < Math.round(k); i++) {
      const f = rand(300, 700);
      this._tone(v, { f, f1: f * 1.8, st: 0.05, t: rand(0.1, 0.5), a: 0.003, r: 0.06, g: 0.05 });
    }
  },

  rumble(v, k) {
    const kk = 0.6 + 0.25 * k, d = rand(3, 4);
    v.wet(0.35);
    this._nz(v, { n: 'brown', rate: 0.6, ft: 'lowpass', f: 140, f1: 90, st: d, q: 1.2, a: d * 0.35, h: d * 0.15, r: d * 0.5, g: 0.5 * kk });
    this._tone(v, { f: 42, f1: 33, st: d, a: d * 0.4, h: d * 0.1, r: d * 0.5, g: 0.2 * kk });
    this._nz(v, { n: 'brown', f: 320, q: 1.5, a: d * 0.4, r: d * 0.6, g: 0.12 * kk }); // rattle
  },

  eruption(v, k) {
    const kk = 0.7 + 0.15 * k;
    v.wet(0.6);
    this._nz(v, { n: 'brown', rate: 0.5, ft: 'lowpass', f: 900, f1: 120, st: 1.5, a: 0.01, r: 2.2, g: 0.5 * kk });
    this._tone(v, { f: 70, f1: 28, st: 2, a: 0.01, r: 2.5, g: 0.36 * kk });
    this._nz(v, { n: 'brown', rate: 0.7, ft: 'lowpass', f: 170, f1: 110, st: 8, q: 1, a: 1.2, h: 3, r: 3.8, g: 0.7 * kk });
    this._nz(v, { f: 520, f1: 240, st: 8, q: 0.6, a: 0.9, h: 2.6, r: 4, g: 0.2 * kk }); // roar
    this._tone(v, { f: 31, f1: 27, st: 8, a: 1.5, h: 3, r: 3.5, g: 0.28 * kk });
    this._crackle(v, 0.1, 6.5, 70, 0.07 * kk);
  },

  launch(v) {
    v.wet(0.4);
    this._nz(v, { ft: 'lowpass', f: 300, f1: 2400, st: 0.8, q: 0.7, a: 0.5, h: 0.5, r: 1.2, g: 0.4 });
    this._nz(v, { f: 180, f1: 900, st: 0.25, q: 1, a: 0.02, r: 0.5, g: 0.3 }); // ignition whoomph
    this._tone(v, { f: 75, f1: 38, st: 0.6, a: 0.01, r: 0.8, g: 0.36 });
    this._crackle(v, 0.15, 1.8, 60, 0.09);
  },

  win(v) {
    v.wet(0.55);
    const lp = this._vfilt(v, 'lowpass', 2200, 0.5);
    [50, 57, 62, 66, 69, 74].forEach((m, i) => {
      const f = mtof(m), t = i * 0.09;
      this._tone(v, { w: 'triangle', f, t, a: 1.4, h: 1, r: 2, g: 0.045, to: lp });
      this._tone(v, { f: f * 1.004, t, a: 1.6, h: 0.8, r: 2, g: 0.035, to: lp });
    });
    for (let i = 0; i < 7; i++) this._glass(v, mtof(86 + pick([0, 2, 4, 7, 9, 12])), 0.8 + i * 0.35 + rand(0, 0.15), 0.018, 1.2);
  },

  pop(v) {
    v.wet(0.2);
    const p = rand(0.85, 1.2);
    this._tone(v, { f: 520 * p, f1: 1300 * p, st: 0.03, a: 0.001, r: 0.06, g: 0.15 });
    this._nz(v, { f: 2400 * p, q: 1.5, a: 0.0005, r: 0.012, g: 0.1 });
  },

  click(v) {
    v.wet(0);
    this._tone(v, { f: 1900, f1: 1300, st: 0.02, a: 0.0008, r: 0.025, g: 0.07 });
    this._nz(v, { ft: 'highpass', f: 3000, a: 0.0005, r: 0.006, g: 0.035 });
  },

  warn(v) {
    v.wet(0.25);
    [76, 72].forEach((m, i) => {
      const f = mtof(m), t = i * 0.2;
      this._tone(v, { f, t, a: 0.02, h: 0.06, r: 0.35, g: 0.11 });
      this._tone(v, { f: f * 2, t, a: 0.02, h: 0.03, r: 0.2, g: 0.02 });
    });
  },

  tremorWarn(v, k) {
    const kk = 0.7 + 0.2 * k;
    v.wet(0.4);
    const lp = this._vfilt(v, 'lowpass', 320, 0.5);
    this._tone(v, { f: 55, f1: 49, st: 3, a: 1.4, h: 0.4, r: 1.6, g: 0.16 * kk });
    this._tone(v, { w: 'triangle', f: 77.8, f1: 69.3, st: 3, a: 1.6, h: 0.3, r: 1.5, g: 0.09 * kk, to: lp });
    this._nz(v, { n: 'brown', ft: 'lowpass', f: 110, a: 1.5, h: 0.4, r: 1.5, g: 0.32 * kk });
  },
};

export class AudioEngine {
  constructor() {
    Object.assign(this, { ctx: null, ready: false, failed: false, volume: 0.8, muted: false, camX: 0, voices: 0 });
    this._last = Object.create(null); // per-name last play time (rate limiting)
    this._tg = new Map(); // last automation target per AudioParam
    Object.assign(this, { _acc: 1, _musT: 3, _doom: 0, _lastChord: null });
  }

  init() {
    try {
      if (!this.ctx && !this.failed) this._build();
      const c = this.ctx;
      if (c && c.state !== 'running' && c.state !== 'closed') quiet(c.resume());
    } catch (e) {
      this.failed = true;
    }
  }

  setVolume(v) { this.volume = clamp(num(v, this.volume), 0, 1); this._applyVolume(); }

  setMuted(m) { this.muted = !!m; this._applyVolume(); }

  play(name, data = {}) {
    let v = null;
    try {
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SFX, name) || !this._live()) return;
      const d = data && typeof data === 'object' ? data : {};
      const now = this.ctx.currentTime;
      if (now - (this._last[name] ?? -9) < (MIN_GAP[name] ?? 0.025)) return;
      this._last[name] = now;
      v = this._voice(d, UI_SOUNDS.has(name) ? 'ui' : 'sfx');
      if (!v) return;
      SFX[name].call(this, v, clamp(num(d.k, 1), 0, 3), clamp(num(d.b, 0.5), 0, 1), d);
    } catch (e) { /* audio must never break the game */ } finally {
      if (v) this._done(v);
    }
  }

  update(state, dt) {
    try {
      if (!state || typeof state !== 'object') return;
      this.camX = num(state.camX, this.camX);
      if (!this._live()) return;
      dt = clamp(num(dt, 0.016), 0, 0.25);
      const camY = num(state.camY, 0), paused = !!state.paused;
      const uw = clamp((-camY - 2) / 2, 0, 1);
      this._doom = clamp(num(state.doom, 0), 0, 1);

      if (uw > 0.5 && !paused && Math.random() < dt * 1.8) this._bubbleTick(uw);
      this._musT -= dt;
      if (this._musT <= 0) {
        this._musT = rand(8, 12);
        this._pad();
      }

      this._acc += dt; // automation targets are refreshed at ~12 Hz
      if (this._acc < 0.08) return;
      this._acc = 0;
      this._ambience(state, camY, uw, paused);
    } catch (e) { /* ignore */ }
  }

  // ---- graph construction -------------------------------------------------

  _build() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return void (this.failed = true);
    let c;
    try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { c = new AC(); }
    this.ctx = c;
    try {
      this.buf = { white: this._noiseBuf(3, 'white'), pink: this._noiseBuf(7, 'pink'), brown: this._noiseBuf(7, 'brown') };

      const comp = c.createDynamicsCompressor();
      for (const [k, x] of Object.entries({ threshold: -18, knee: 12, ratio: 4, attack: 0.006, release: 0.3 })) comp[k].value = x;
      const shelf = this._filt('highshelf', 7000, 0);
      shelf.gain.value = -4;
      // Safety ceiling: input is halved, curve is identity below 0.7 and saturates smoothly under 0.98.
      const clip = c.createWaveShaper(), curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const y = (i / (curve.length - 1)) * 4 - 2, a = Math.abs(y);
        curve[i] = Math.sign(y) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
      }
      clip.curve = curve;
      clip.oversample = '2x';
      this.master = this._g(0);
      chain(this.master, this._filt('highpass', 28, 0.7), shelf, comp, this._g(0.5), clip, c.destination);

      this.verbIn = this._g(1);
      const verb = c.createConvolver();
      verb.buffer = this._impulse(3.2);
      chain(this.verbIn, verb, this._g(0.9), this.master);

      // World SFX pass through lowpasses that close when the camera is underwater.
      this.sfxDry = this._filt('lowpass', 18000, 0.5);
      this.sfxWet = this._filt('lowpass', 18000, 0.5);
      chain(this.sfxDry, this._g(0.7), this.master);
      chain(this.sfxWet, this.verbIn);
      this.uiBus = this._g(0.7);
      this.uiBus.connect(this.master);

      this.ambBus = this._g(0.7);
      this.ambBus.connect(this.master);

      this.musicLP = this._filt('lowpass', 1500, 0.4);
      this.musicBus = this._g(MUSIC_LEVEL);
      chain(this.musicLP, this.musicBus, this.master);
      chain(this.musicBus, this._g(0.7), this.verbIn);
      this._lfo(0.05, 250, this.musicLP.frequency);

      this._buildAmbience();
      this.ready = true;
      this._applyVolume();
    } catch (e) {
      this.failed = true;
      this.ready = false;
      try { quiet(c.close()); } catch (e2) { /* ignore */ }
    }
  }

  _buildAmbience() {
    const c = this.ctx, B = this.buf, A = (this.amb = {});
    const layer = (name) => {
      const g = this._g(0);
      g.connect(this.ambBus);
      return (A[name] = g);
    };
    const white = this._src(B.white), brown = this._src(B.brown);

    // Sea: stereo pink noise (two decorrelated loops), low-passed, with slow overlapping swells.
    const merge = c.createChannelMerger(2);
    this._src(B.pink).connect(merge, 0, 0);
    this._src(B.pink).connect(merge, 0, 1);
    const seaLP = this._filt('lowpass', 650, 0.5), swell = this._g(0.6);
    chain(merge, seaLP, swell, layer('sea'));
    chain(white, this._filt('bandpass', 3000, 0.5), this._g(0.05), swell); // foam hiss
    this._lfo(0.071, 0.22, swell.gain);
    this._lfo(0.163, 0.12, swell.gain);
    this._lfo(0.043, 220, seaLP.frequency);

    // Underwater: muffled brown-noise bed.
    const uwLP = this._filt('lowpass', 240, 0.7), uwSw = this._g(0.8);
    chain(brown, uwLP, uwSw, layer('uw'));
    this._lfo(0.09, 0.2, uwSw.gain);
    this._lfo(0.05, 60, uwLP.frequency);

    // Wind: wandering bandpass on white noise.
    const wBP = this._filt('bandpass', 650, 0.7), wSw = this._g(0.5);
    chain(white, wBP, wSw, layer('wind'));
    this._lfo(0.11, 280, wBP.frequency);
    this._lfo(0.27, 120, wBP.frequency);
    this._lfo(0.13, 0.3, wSw.gain);

    // Volcano: sub-bass noise plus two low sines that beat slowly.
    const vLP = this._filt('lowpass', 80, 0.6), vSw = this._g(0.75);
    chain(brown, vLP, vSw);
    chain(this._osc('sine', 34), this._g(0.35), vSw);
    chain(this._osc('sine', 51.4), this._g(0.15), vSw);
    vSw.connect(layer('volc'));
    this._lfo(0.037, 0.25, vSw.gain);
    A.volcLP = vLP;

    // Furnace roar (flickering band of noise) and pump pulse (amplitude-modulated low tone).
    const fFl = this._g(1);
    chain(white, this._filt('bandpass', 320, 0.7), this._filt('lowpass', 900, 0.5), fFl, layer('furn'));
    this._lfo(2.3, 0.2, fFl.gain);
    this._lfo(0.53, 0.25, fFl.gain);
    const pAM = this._g(0.5);
    chain(this._osc('sine', 58), pAM);
    chain(this._osc('triangle', 116), this._g(0.3), pAM);
    pAM.connect(layer('pump'));
    this._lfo(1.1, 0.4, pAM.gain);
    this._lfo(2.2, 0.1, pAM.gain);

    // Rocket: fluttering low-passed noise + detuned low saws + brown body.
    const rocket = layer('rocket'), rLP = this._filt('lowpass', 1200, 0.7), rN = this._g(0.8);
    chain(white, rLP, rN, rocket);
    this._lfo(13, 0.15, rN.gain);
    this._lfo(7.3, 0.1, rN.gain);
    const sLP = this._filt('lowpass', 170, 1);
    this._osc('sawtooth', 41).connect(sLP);
    this._osc('sawtooth', 41.7).connect(sLP);
    chain(sLP, this._g(0.3), rocket);
    chain(brown, this._filt('lowpass', 220, 0.5), this._g(0.6), rocket);
    A.rocketLP = rLP;

    // Structural groan: very slow pulse train through resonances, plus a noisy body.
    const saw = this._osc('sawtooth', 11), gAM = this._g(3.5);
    this._lfo(0.17, 3.5, saw.frequency);
    this._lfo(0.06, 2, saw.frequency);
    const g1 = this._filt('bandpass', 230, 14), g2 = this._filt('bandpass', 520, 10);
    chain(saw, g1, gAM);
    chain(saw, g2, gAM);
    this._lfo(0.09, 30, g1.frequency);
    this._lfo(0.07, 50, g2.frequency);
    chain(brown, this._filt('bandpass', 170, 3), this._g(0.5), gAM);
    this._lfo(0.31, 1.6, gAM.gain);
    gAM.connect(layer('groan'));
  }

  _ambience(s, camY, uw, paused) {
    const A = this.amb, doom = this._doom;
    const air = clamp((camY - 12) / 10, 0, 1);
    this._set(A.sea.gain, AMB.sea * (1 - uw) * (1 - 0.6 * air), 0.5);
    this._set(A.uw.gain, AMB.uw * uw, 0.5);
    this._set(A.wind.gain, AMB.wind * air, 0.8);

    const er = !!s.erupting;
    this._set(A.volc.gain, AMB.volc * (0.03 + 0.97 * doom * doom) * (er ? 2 : 1), er ? 0.4 : 1.5);
    this._set(A.volcLP.frequency, er ? 240 : 70 + 40 * doom, 1);

    const sm = Math.max(0, num(s.smelting, 0)), pu = Math.max(0, num(s.pumping, 0));
    this._set(A.furn.gain, sm > 0 ? AMB.furn * (0.6 + 0.1 * Math.min(sm, 4)) : 0, 0.5);
    this._set(A.pump.gain, pu > 0 ? AMB.pump * (0.6 + 0.1 * Math.min(pu, 4)) : 0, 0.5);

    const fade = Math.exp(-Math.max(0, num(s.rocketAlt, 0)) / 350);
    this._set(A.rocket.gain, s.rocketBurning ? AMB.rocket * (0.05 + 0.95 * fade) : 0, s.rocketBurning ? 0.12 : 0.8);
    this._set(A.rocketLP.frequency, 300 + 1500 * fade, 0.3);

    const heel = Math.abs(num(s.heel, 0));
    const stress = Math.max(0, num(s.stressMax, 0) - 0.7) + Math.max(0, heel - 0.12) * 0.4;
    this._set(A.groan.gain, Math.min(1, stress) * AMB.groan, 0.6);

    this._set(this.ambBus.gain, paused ? 0.7 * 0.25 : 0.7, 0.25);
    this._set(this.musicBus.gain, MUSIC_LEVEL * (paused ? 0.25 : 1), 0.4);
    const cut = lerp(18000, 1400, uw);
    this._set(this.sfxDry.frequency, cut, 0.15);
    this._set(this.sfxWet.frequency, cut, 0.15);
    this._set(this.musicLP.frequency, 1700 - 1100 * doom, 2);
  }

  // ---- generative music ---------------------------------------------------

  _pad() {
    const doom = this._doom, set = CHORDS[clamp(Math.round(doom * 2 + rand(-0.45, 0.45)), 0, 2)];
    let chord = pick(set);
    if (chord === this._lastChord && set.length > 1) chord = set[(set.indexOf(chord) + 1) % set.length];
    this._lastChord = chord;
    const v = this._voice({}, 'music', true);
    if (!v) return;
    try {
      const n = chord.length, g = 0.035, spread = 5 + doom * 12; // more beating = more tension
      chord.forEach((m, i) => {
        const f = mtof(m), p = this._panner(v, (i / (n - 1) - 0.5) * 0.8);
        this._tone(v, { f, a: 3.5, h: 4, r: 5, g, to: p });
        this._tone(v, { w: 'triangle', f, dt: (i % 2 ? 1 : -1) * spread, a: 4, h: 3.5, r: 5, g: g * 0.55, to: p });
      });
      if (doom > 0.45) this._tone(v, { f: mtof(chord[0] - 12), a: 4, h: 3, r: 5, g: g * (doom - 0.3) });
      if (Math.random() < 0.35) this._glass(v, mtof(pick(chord) + 24), rand(2, 5), 0.012, 2.5, this.musicBus);
    } finally {
      this._done(v);
    }
  }

  _bubbleTick(uw) {
    const v = this._voice({ x: this.camX + rand(-30, 30) }, 'amb');
    if (!v) return;
    try {
      v.wet(0.3);
      const f = rand(500, 1500);
      this._tone(v, { f, f1: f * rand(1.5, 2.2), st: 0.04, a: 0.003, r: rand(0.03, 0.07), g: 0.035 * uw });
    } finally {
      this._done(v);
    }
  }

  // ---- voices & primitives ------------------------------------------------

  _live() {
    return this.ready && !!this.ctx && this.ctx.state === 'running';
  }

  // A voice is a short-lived sub-graph: out -> panner -> dry bus, and -> send -> reverb.
  _voice(d, route, force) {
    if (this.voices >= MAX_VOICES && !force) return null; // keeps node counts bounded
    const c = this.ctx, out = c.createGain(), nodes = [out];
    const dx = typeof d.x === 'number' && Number.isFinite(d.x) ? d.x - this.camX : 0;
    out.gain.value = clamp(1 - (Math.abs(dx) - 40) / 160, 0.3, 1); // far-off events are softer
    const v = { t: c.currentTime + 0.005, end: c.currentTime, out, nodes };
    let tail = out;
    if (c.createStereoPanner) {
      tail = c.createStereoPanner();
      tail.pan.value = clamp(dx / 40, -1, 1);
      out.connect(tail);
      nodes.push(tail);
    }
    const send = this._g(route === 'music' ? 0 : 0.15);
    nodes.push(send);
    tail.connect({ sfx: this.sfxDry, ui: this.uiBus, amb: this.ambBus, music: this.musicLP }[route]);
    chain(tail, send, route === 'sfx' ? this.sfxWet : this.verbIn);
    v.wet = (x) => (send.gain.value = x);
    this.voices++;
    return v;
  }

  // Schedule disconnection of every node in the voice once its last envelope has ended.
  _done(v) {
    if (v.closed) return;
    v.closed = true;
    const ms = Math.max(0.1, v.end - this.ctx.currentTime + 0.3) * 1000;
    setTimeout(() => {
      for (const n of v.nodes) try { n.disconnect(); } catch (e) { /* ignore */ }
      this.voices--;
    }, ms);
  }

  // Attack (linear) / hold / release (exponential) envelope.
  _env(p, t0, peak, a, h, r) {
    peak = Math.max(peak, 1e-4);
    a = Math.max(a, 0.0005);
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + a);
    if (h > 0) p.setValueAtTime(peak, t0 + a + h);
    p.exponentialRampToValueAtTime(1e-4, t0 + a + h + r);
    return t0 + a + h + r;
  }

  // Oscillator note. o: { w type, f, f1 sweep target, st sweep time, t offset, a, h, r, g peak, dt cents, to dest }
  _tone(v, o) {
    const c = this.ctx, t0 = v.t + (o.t || 0), a = o.a ?? 0.005, h = o.h || 0, r = o.r ?? 0.2;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.w || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + (o.st || a + h + r));
    if (o.dt) osc.detune.value = o.dt;
    const end = this._env(g.gain, t0, o.g, a, h, r);
    chain(osc, g, o.to || v.out);
    osc.start(t0);
    osc.stop(end + 0.02);
    v.nodes.push(osc, g);
    if (end > v.end) v.end = end;
  }

  // Filtered noise burst. o: { n buffer, rate, ft filter type, f, f1, st, q, t, a, h, r, g, to }
  _nz(v, o) {
    const c = this.ctx, t0 = v.t + (o.t || 0), a = o.a ?? 0.005, h = o.h || 0, r = o.r ?? 0.2;
    const src = this._src(this.buf[o.n || 'white'], null, true), f = this._filt(o.ft || 'bandpass', o.f, o.q ?? 0.8);
    const g = c.createGain();
    if (o.rate) src.playbackRate.value = o.rate;
    f.frequency.setValueAtTime(o.f, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + (o.st || a + h + r));
    const end = this._env(g.gain, t0, o.g, a, h, r);
    chain(src, f, g, o.to || v.out);
    src.start(t0, Math.random() * (src.buffer.duration - 0.5));
    src.stop(end + 0.02);
    v.nodes.push(src, f, g);
    if (end > v.end) v.end = end;
  }

  // A train of tiny noise ticks from one source: ts = [[time, amp], ...] sorted by time.
  _clicks(v, ts, o) {
    if (!ts.length) return;
    const c = this.ctx, src = this._src(this.buf.white, null, true), f = this._filt(o.ft || 'bandpass', o.f, o.q ?? 1);
    const g = c.createGain();
    g.gain.setValueAtTime(0, v.t);
    for (const [t, amp] of ts) {
      g.gain.setValueAtTime(amp, v.t + t);
      g.gain.setTargetAtTime(0, v.t + t + 0.0005, o.tau || 0.005);
    }
    const end = v.t + ts[ts.length - 1][0] + 0.06;
    chain(src, f, g, v.out);
    src.start(v.t, Math.random() * 2);
    src.stop(end);
    v.nodes.push(src, f, g);
    if (end > v.end) v.end = end;
  }

  // Random crackle, denser at the start and thinning out.
  _crackle(v, t, dur, n, g) {
    const ts = [];
    for (let i = 0; i < n; i++) ts.push(t + dur * Math.pow(Math.random(), 1.7));
    ts.sort((x, y) => x - y);
    this._clicks(v, ts.map((x) => [x, g * rand(0.25, 1) * (1 - 0.7 * ((x - t) / dur))]), { f: 2500, q: 0.6, tau: 0.003 });
  }

  // Glassy bell: fundamental, a slightly detuned twin (shimmer), and an inharmonic partial.
  _glass(v, f, t, g, r, to) {
    this._tone(v, { f, t, a: 0.003, r, g, to });
    this._tone(v, { f: f * 1.0035, t, a: 0.003, r: r * 0.8, g: g * 0.5, to });
    this._tone(v, { f: f * 2.76, t, a: 0.002, r: r * 0.4, g: g * 0.25, to });
  }

  // Per-voice filter / panner feeding v.out (cleaned up with the voice).
  _vfilt(v, type, f, q) {
    const flt = this._filt(type, f, q);
    flt.connect(v.out);
    v.nodes.push(flt);
    return flt;
  }

  _panner(v, pan) {
    if (!this.ctx.createStereoPanner) return v.out;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(v.out);
    v.nodes.push(p);
    return p;
  }

  _g(value) { const g = this.ctx.createGain(); g.gain.value = value; return g; }

  _filt(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  _osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }

  _lfo(rate, depth, param, type = 'sine') { chain(this._osc(type, rate), this._g(depth), param); }

  // Looping buffer source; started immediately at a random offset unless `deferred`.
  _src(buf, offset, deferred) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    if (!deferred) s.start(0, offset ?? Math.random() * buf.duration * 0.9);
    return s;
  }

  // Smoothed parameter target; skips redundant automation events.
  _set(p, value, tc = 0.3) {
    const prev = this._tg.get(p);
    if (prev !== undefined && Math.abs(prev - value) <= 1e-4 * Math.max(1, Math.abs(value))) return;
    this._tg.set(p, value);
    p.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  _applyVolume() {
    try {
      if (this.ready) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.85, this.ctx.currentTime, 0.05);
    } catch (e) { /* ignore */ }
  }

  // ---- generated buffers --------------------------------------------------

  // Seamlessly looping, DC-free, peak-normalized noise.
  _noiseBuf(sec, kind) {
    const sr = this.ctx.sampleRate, n = Math.floor(sec * sr), fade = Math.floor(sr * 0.05);
    const raw = new Float32Array(n + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') raw[i] = w;
      else if (kind === 'brown') raw[i] = last = (last + 0.02 * w) / 1.02;
      else {
        // Paul Kellet's pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    }
    for (let i = 0; i < fade; i++) raw[i] = raw[i] * (i / fade) + raw[n + i] * (1 - i / fade);
    let mean = 0, peak = 0;
    for (let i = 0; i < n; i++) mean += raw[i];
    mean /= n;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(raw[i] - mean));
    const buf = this.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), s = 0.95 / (peak || 1);
    for (let i = 0; i < n; i++) d[i] = (raw[i] - mean) * s;
    return buf;
  }

  // Dark, smooth stereo reverb impulse: decaying noise whose tail is progressively low-passed.
  _impulse(sec) {
    const sr = this.ctx.sampleRate, n = Math.floor(sec * sr), pre = Math.floor(sr * 0.012);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.45 * t);
        d[i] = lp * Math.pow(1 - t, 2.2) * (i < pre ? i / pre : 1);
      }
    }
    return buf;
  }
}
