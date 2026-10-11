import { Rng } from './rng.js';
import { G, WORLD_HALF_WIDTH } from './config.js';

export const N_LAYERS = 6;
export const SURFACE = 3;
export const MAX_PACKETS = 4;

export class Sea {
  constructor(planet) {
    this.planet = planet;
    this.layers = planet.layers;
    this.floor = planet.floor;
    this.base = this.layers.map((l) => l.top);
    const rng = new Rng(planet.seed ^ 0x5eaf00d);
    this.sines = [];
    const lens = [38, 21, 13, 8.5];
    for (let i = 0; i < 4; i++) {
      const wl = lens[i] * rng.range(0.85, 1.2);
      const k = (2 * Math.PI) / wl;
      this.sines.push({
        a: [0.16, 0.11, 0.07, 0.045][i] * rng.range(0.8, 1.2),
        k,
        w: Math.sqrt(G * k) * 0.75 * rng.sign(),
        p: rng.range(0, Math.PI * 2),
      });
    }
    this.mods = [
      null,
      { A: 0, W: 0, P: 0, Q: 0 },
      { A: 0, W: 0, P: 0, Q: 0 },
      { A: 1, W: 1, P: 0, Q: 1 },
      { A: 0.55, W: 0.35, P: 1.7, Q: 0.18 },
      { A: 0.4, W: 0.22, P: 3.9, Q: 0.08 },
    ];
    this.airPhase = [0, rng.range(0, 6), rng.range(0, 6)];
    this.packets = [];
    this.calm = 1;
  }

  addPacket(t, amplitude, width = 10, speed = 9, dir = -1) {
    const x0 = dir < 0 ? WORLD_HALF_WIDTH + width * 2 : -WORLD_HALF_WIDTH - width * 2;
    this.packets.push({ t0: t, x0, A: amplitude, w: width, c: speed, dir, xc: x0 });
    if (this.packets.length > MAX_PACKETS) this.packets.shift();
  }

  update(t) {
    for (const p of this.packets) p.xc = p.x0 + p.dir * p.c * (t - p.t0);
    this.packets = this.packets.filter((p) => Math.abs(p.xc) < WORLD_HALF_WIDTH + p.w * 4);
  }

  packetHeight(x) {
    let h = 0;
    for (const p of this.packets) {
      const u = (x - p.xc) / p.w;
      if (u > 6 || u < -6) continue;
      const v = u + p.dir * 1.7;
      h += p.A * (Math.exp(-u * u) - 0.38 * Math.exp(-v * v));
    }
    return h;
  }

  ifaceY(k, x, t) {
    if (k <= 0) return Infinity;
    if (k >= N_LAYERS) return this.floor;
    const base = this.base[k];
    if (k < SURFACE) {
      const ph = this.airPhase[k];
      return base + 0.55 * Math.sin(0.045 * x + 0.06 * t + ph) + 0.3 * Math.sin(0.12 * x - 0.045 * t + ph * 2.1);
    }
    const m = this.mods[k];
    let h = 0;
    for (const s of this.sines) h += s.a * Math.sin(s.k * x + s.w * m.W * t + s.p + m.P);
    h *= m.A * this.calm;
    if (m.Q > 0 && this.packets.length) h += m.Q * this.packetHeight(x);
    return base + h;
  }

  surfaceY(x, t) {
    return this.ifaceY(SURFACE, x, t);
  }

  layerAt(x, y, t) {
    if (y < this.floor) return N_LAYERS;
    for (let k = 1; k < N_LAYERS; k++) {
      if (y > this.ifaceY(k, x, t)) return k - 1;
    }
    return N_LAYERS - 1;
  }

  rho(k) {
    return k >= N_LAYERS ? 99 : this.layers[k].rho;
  }

  shaderWaves() {
    return this.sines.map((s) => [s.a, s.k, s.w, s.p]);
  }
}
