const MAX = 2600;

export class Particles {
  constructor() {
    this.list = [];
  }

  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    p.age = 0;
    p.life = p.life || 1;
    p.vx = p.vx || 0;
    p.vy = p.vy || 0;
    p.size = p.size || 0.08;
    p.g = p.g === undefined ? -9.8 : p.g;
    p.drag = p.drag || 0;
    this.list.push(p);
    return p;
  }

  burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = (opts.angle ?? Math.PI / 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
      const sp = (opts.speed ?? 4) * (0.35 + Math.random() * 0.8);
      this.add({
        x: x + (Math.random() - 0.5) * (opts.jitter || 0),
        y: y + (Math.random() - 0.5) * (opts.jitter || 0),
        vx: Math.cos(a) * sp + (opts.vx || 0),
        vy: Math.sin(a) * sp + (opts.vy || 0),
        life: (opts.life ?? 1) * (0.5 + Math.random() * 0.8),
        size: (opts.size ?? 0.08) * (0.6 + Math.random() * 0.8),
        color: opts.color,
        kind: opts.kind || 'dot',
        g: opts.g,
        drag: opts.drag ?? 0.5,
        heat: opts.heat || 0,
        glow: opts.glow || 0,
      });
    }
  }

  update(dt, game) {
    const sea = game.sea;
    const t = game.time;
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.kind === 'bubble') {
        const k = sea.layerAt(p.x, p.y, t);
        if (k < 3 || k > 5) continue;
        const L = sea.layers[k];
        p.vy += (3.2 - p.vy) * dt * 2;
        p.vx += (L.current - p.vx) * dt * 1.5 + Math.sin(p.age * 9 + p.x * 3) * dt * 1.2;
      } else if (p.kind === 'smoke' || p.kind === 'steam') {
        p.vy += (p.rise || 1.6) * dt;
        p.size += dt * (p.grow || 0.6);
      } else {
        p.vy += p.g * dt;
        if (p.kind === 'drop' && p.y < sea.surfaceY(p.x, t) && p.vy < 0 && p.age > 0.05) {
          p.age = p.life;
          continue;
        }
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      list[w++] = p;
    }
    list.length = w;
  }
}
