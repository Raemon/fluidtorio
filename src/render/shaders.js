export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform vec2 uCam;
uniform float uZoom;
uniform float uTime;
uniform sampler2D uObj;
uniform sampler2D uDen;
uniform sampler2D uIface;
uniform float uRhoVis[6];
uniform vec3 uCol[6];
uniform float uTop[6];
uniform float uCurrent[6];
uniform float uSchl;
uniform vec3 uLens;
uniform float uLensOn;
uniform float uDoom;
uniform float uFlash;
uniform float uErupt;
uniform float uAlt;
uniform float uWin;
uniform vec2 uSun;
uniform float uQuality;

out vec4 outColor;

#define TAU 6.28318530718

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec3 film(float t) {
  return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)));
}

int W;
float ifc(int col, int k) {
  return texelFetch(uIface, ivec2(clamp(col, 0, W - 1), k), 0).r;
}

vec2 tuv(vec2 frag) {
  return vec2(frag.x / uRes.x, 1.0 - frag.y / uRes.y);
}

vec2 toWorld(vec2 frag) {
  return uCam + (frag - 0.5 * uRes) / uZoom;
}

float fluidRho(int col, float y, float sm) {
  float r = uRhoVis[0];
  for (int k = 1; k < 6; k++) {
    float h = ifc(col, k);
    float s = k < 3 ? 1.2 : sm;
    r += (uRhoVis[k] - uRhoVis[k - 1]) * (1.0 - smoothstep(h - s, h + s, y));
  }
  float f = ifc(col, 6);
  r += (3.2 - uRhoVis[5]) * (1.0 - smoothstep(f - sm, f + sm, y));
  return r;
}

float ventHeat(vec2 w, float floorY) {
  float cell = floor(w.x / 41.0);
  float vx = (cell + 0.25 + 0.5 * hash12(vec2(cell, 7.0))) * 41.0;
  float h = w.y - floorY;
  if (h < 0.0 || h > 22.0) return 0.0;
  float wid = 0.5 + 0.11 * h;
  float sway = 0.8 * sin(uTime * 0.7 + h * 0.4 + cell);
  float d = (w.x - vx - sway * h * 0.08) / wid;
  float n = vnoise(vec2(w.x * 1.3, w.y * 0.8 - uTime * 1.6));
  return exp(-d * d) * exp(-h / 9.0) * (0.55 + 0.9 * n);
}

float densityAt(vec2 frag, float sm) {
  int col = int(frag.x);
  vec2 w = toWorld(frag);
  vec4 d = texture(uDen, tuv(frag));
  float rf = fluidRho(col, w.y, sm);
  float r = mix(rf, d.r * 4.0, d.g);
  float heat = d.b * (0.7 + 0.6 * vnoise(w * 2.3 + vec2(0.0, -uTime * 2.2)));
  heat += ventHeat(w, ifc(col, 6)) * 0.35;
  return r - heat * 0.5;
}

vec3 skyColor(vec2 w, vec2 frag, int col) {
  vec3 cThin = uCol[0], cClear = uCol[1], cMurk = uCol[2];
  float hC = ifc(col, 1), hM = ifc(col, 2);
  float y = w.y;
  float aThin = smoothstep(hC - 2.5, hC + 4.0, y);
  float aClear = smoothstep(hM - 1.2, hM + 1.6, y);
  vec3 clear = mix(cClear * 1.25, cClear * 0.85, smoothstep(hM, hC, y));
  vec3 thin = mix(cThin * 1.6, cThin * 0.5, smoothstep(hC, hC + 40.0, y));
  float murkN = fbm(vec2(w.x * 0.07 - uTime * 0.05, w.y * 0.35 + uTime * 0.02));
  float streak = fbm3(vec2(w.x * 0.02 + uTime * 0.01, w.y * 1.4));
  float thick = clamp(1.0 - (y - ifc(col, 3)) / max(1.0, hM - ifc(col, 3)), 0.0, 1.0);
  vec3 murk = mix(clear * 0.95, cMurk * (0.85 + 0.5 * murkN), 0.45 + 0.45 * thick) + vec3(0.07, 0.04, 0.01) * streak * thick;
  vec3 c = mix(murk, clear, aClear);
  c = mix(c, thin, aThin);

  // stars in the high, thin air
  float starZone = smoothstep(hC - 2.0, hC + 30.0, y) + uWin;
  if (starZone > 0.01) {
    vec2 sp = frag / 2.2;
    vec2 cell = floor(sp);
    vec2 h = hash22(cell);
    vec2 sc = cell + h;
    float dd = length(sp - sc);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h.x * 3.0) + h.y * 20.0);
    float star = smoothstep(0.55, 0.0, dd) * step(0.86, hash12(cell * 1.7)) * tw;
    c += vec3(0.9, 0.95, 1.0) * star * clamp(starZone, 0.0, 1.0) * 0.9;
  }

  // the sun, low over the haze
  vec2 sunP = uSun;
  float sd = length((frag - sunP) / uRes.y);
  c += vec3(1.0, 0.88, 0.66) * (smoothstep(0.021, 0.016, sd) * 1.3 + exp(-sd * 16.0) * 0.3 + exp(-sd * 4.0) * 0.08) * (1.0 - 0.6 * uDoom);
  float rays = fbm3(vec2(atan(frag.y - sunP.y, frag.x - sunP.x) * 6.0, uTime * 0.05));
  c += vec3(0.6, 0.45, 0.25) * rays * exp(-sd * 3.0) * 0.18 * (1.0 - aThin);

  // the volcano: a far silhouette that sits on the horizon
  float vs = uRes.y;
  float vx = (frag.x - 0.5 * uRes.x) / vs + uCam.x * 0.0015 - 0.42;
  float hz = (frag.y - (0.5 * uRes.y - uCam.y * uZoom)) / vs;
  float prof = 0.27 * pow(max(0.0, 1.0 - abs(vx) / 0.62), 1.35);
  prof -= 0.035 * smoothstep(0.07, 0.0, abs(vx));
  prof += 0.012 * (fbm3(vec2(vx * 14.0, 0.5)) - 0.5);
  float mount = smoothstep(prof + 0.002, prof - 0.002, hz) * step(0.0, hz + 0.02);
  float glowT = 0.35 + 0.65 * uDoom + uErupt;
  if (mount > 0.0) {
    vec3 rock = mix(vec3(0.05, 0.04, 0.05), cMurk * 0.35, 0.4);
    float lava = smoothstep(0.03, 0.0, abs(vx + 0.02 * sin(hz * 60.0 + vx * 30.0) - 0.0)) * smoothstep(prof - 0.12 * glowT, prof, hz);
    float streak = pow(max(0.0, 1.0 - abs(fract(vx * 13.0 + 0.3 * sin(hz * 30.0)) - 0.5) * 2.0), 18.0) * smoothstep(prof - 0.09, prof, hz) * step(0.35, uDoom);
    rock += vec3(1.0, 0.3, 0.05) * (lava + streak * 0.6) * glowT * 1.6;
    rock = mix(rock, c, 0.35 * (1.0 - smoothstep(0.0, 0.15, hz)));
    c = mix(c, rock, mount);
  }
  // the plume
  float py = hz - 0.24;
  if (py > -0.05) {
    float bend = py * py * 1.5;
    float pw = 0.04 + py * 0.55;
    float n = fbm(vec2(vx * 9.0 - bend * 6.0, py * 7.0 - uTime * 0.12));
    float plume = smoothstep(pw, pw * 0.35, abs(vx - bend * 0.6 + 0.05 * sin(py * 9.0 + uTime * 0.2))) * smoothstep(-0.05, 0.02, py);
    plume *= smoothstep(1.4, 0.2, py) * (0.55 + 0.6 * uDoom + 0.8 * uErupt);
    float dens = clamp(plume * (0.6 + 0.9 * n), 0.0, 1.0);
    vec3 smoke = mix(vec3(0.13, 0.11, 0.12), vec3(0.35, 0.3, 0.3), n);
    smoke += vec3(0.9, 0.25, 0.05) * smoothstep(0.25, 0.0, py) * glowT * 0.8;
    float flash = step(0.985, hash12(vec2(floor(uTime * 7.0), 3.0))) * step(0.55, uDoom) * smoothstep(0.6, 0.2, abs(py - 0.35));
    smoke += vec3(0.8, 0.85, 1.0) * flash * 1.5;
    c = mix(c, smoke, dens * 0.92);
  }
  // eruption: lava fountains and a spreading ash cloud
  if (uErupt > 0.0) {
    float fx = vx + 0.03 * sin(hz * 40.0 + uTime * 6.0);
    float fountain = smoothstep(0.05, 0.0, abs(fx)) * smoothstep(prof + 0.25 * uErupt, prof, hz) * step(prof - 0.01, hz);
    c += vec3(1.0, 0.45, 0.1) * fountain * 2.0 * uErupt;
    float ash = fbm(vec2(frag.x / uRes.y * 3.0 + uTime * 0.05, frag.y / uRes.y * 3.0 - uTime * 0.12));
    float reach = smoothstep(0.0, 1.0, uErupt * 1.6 - (0.5 - vx) * 0.6);
    c = mix(c, vec3(0.08, 0.06, 0.06) + vec3(0.5, 0.12, 0.02) * ash * smoothstep(0.4, 0.0, hz), clamp(reach * (0.5 + 0.5 * ash), 0.0, 0.92) * step(0.0, hz));
  }
  // doom reddens the sky
  c = mix(c, c * vec3(1.25, 0.72, 0.55) + vec3(0.12, 0.02, 0.0), uDoom * 0.55 + uErupt * 0.4);
  // falling ash late in the countdown
  if (uDoom > 0.45) {
    vec2 ap = vec2(frag.x + uTime * 30.0, frag.y + uTime * 55.0) / 5.0;
    vec2 cell = floor(ap);
    float a = step(0.993 - 0.008 * uDoom, hash12(cell)) * smoothstep(0.6, 0.0, length(fract(ap) - 0.5));
    c = mix(c, vec3(0.5, 0.45, 0.42), a * (uDoom - 0.45) * 1.5);
  }
  return c;
}

vec3 seaColor(vec2 w, int col, int k, float surf, out float fog) {
  float top = k == 3 ? surf : ifc(col, k);
  float bot = k == 5 ? ifc(col, 6) : ifc(col, k + 1);
  float depth = surf - w.y;
  float rel = clamp((top - w.y) / max(0.1, top - bot), 0.0, 1.0);
  vec3 base = uCol[k];
  float light = exp(-depth * 0.045);
  float body = fbm3(vec2(w.x * 0.05 + uTime * 0.01 * uCurrent[k], w.y * 0.6));
  vec3 c = mix(base * 1.35, base * 0.45, pow(rel, 0.8)) * (0.42 + 0.7 * light);
  c *= 0.85 + 0.3 * body;
  c += base * 0.6 * exp(-(top - w.y) * 3.0);
  c *= 1.0 - 0.35 * exp(-(w.y - bot) * 1.5);
  fog = clamp(0.12 + depth * 0.012, 0.0, 0.55);

  // caustic web near the surface
  if (k == 3) {
    vec2 p = w * vec2(0.55, 0.8) + vec2(uTime * 0.25, 0.0);
    float cs = 0.0;
    vec2 q = p;
    for (int i = 0; i < 3; i++) {
      q = p + vec2(cos(uTime * 0.6 + q.y * 1.3), sin(uTime * 0.5 + q.x * 1.1));
      cs += 1.0 / length(vec2(sin(q.x * 2.2 + uTime * 0.3), cos(q.y * 2.0)) * 6.0 + 0.4);
    }
    cs = pow(cs / 3.0, 1.6);
    c += base * 1.8 * cs * exp(-depth * 0.35) * 0.9 + vec3(1.0, 0.95, 0.8) * cs * exp(-depth * 0.6) * 0.15;
  }
  // god rays slanting down from the surface
  float ray = fbm3(vec2((w.x + w.y * 0.38) * 0.22, uTime * 0.04));
  c += vec3(1.0, 0.92, 0.75) * pow(ray, 3.0) * exp(-depth * 0.08) * 0.45 * (1.0 - 0.5 * uDoom);
  // drifting motes; the fuel layer glows
  vec2 mp = vec2(w.x - uTime * uCurrent[k] * 0.6, w.y + uTime * 0.05) * (k == 5 ? 2.2 : 3.0);
  vec2 cell = floor(mp);
  vec2 hh = hash22(cell + float(k) * 17.0);
  float mote = smoothstep(0.09, 0.0, length(fract(mp) - hh)) * step(0.82, hash12(cell + 3.0));
  if (k == 5) {
    float pulse = 0.5 + 0.5 * sin(uTime * 1.7 + hh.x * 30.0);
    c += vec3(1.0, 0.45, 0.85) * mote * (0.6 + pulse) * 0.9;
    c += base * 0.35 * fbm3(w * 0.15 + vec2(uTime * 0.03, 0.0));
  } else {
    c += mix(base, vec3(1.0), 0.5) * mote * 0.35 * light;
  }
  return c;
}

vec3 interfaceGlow(vec2 w, int col, float surf) {
  vec3 add = vec3(0.0);
  // surface foam & specular line
  float ds = w.y - surf;
  float foamN = vnoise(vec2(w.x * 2.5 + uTime * 0.6, uTime * 0.3));
  add += vec3(1.0, 0.97, 0.9) * exp(-abs(ds) * 14.0 / max(0.4, uZoom / 22.0)) * (0.55 + 0.45 * foamN);
  add += vec3(1.0) * smoothstep(0.12, 0.0, abs(ds + 0.08 + 0.1 * foamN)) * 0.25 * foamN;
  // iridescent films between immiscible liquids
  for (int k = 4; k < 6; k++) {
    float h = ifc(col, k);
    float d = w.y - h;
    float thick = fbm3(vec2(w.x * 0.3 + uTime * 0.04 * float(k), float(k) * 3.1)) * 2.5 + w.x * 0.02;
    float band = exp(-d * d * 40.0);
    add += film(thick) * band * 0.65 + vec3(1.0) * exp(-d * d * 400.0) * 0.25;
  }
  return add;
}

vec3 floorColor(vec2 w, float floorY) {
  float d = floorY - w.y;
  float n = fbm(w * 0.35);
  vec3 c = vec3(0.04, 0.035, 0.05) + vec3(0.06, 0.04, 0.05) * n;
  float crack = smoothstep(0.04, 0.0, abs(fbm3(w * 0.22) - 0.5)) * exp(-d * 0.35);
  c += vec3(1.0, 0.32, 0.06) * crack * (0.5 + 0.8 * uDoom) * (0.6 + 0.4 * sin(uTime * 1.3 + w.x));
  c += vec3(0.25, 0.1, 0.2) * exp(-d * 2.5) * 0.4;
  return c;
}

vec3 scene(vec2 frag, out float objA, out vec3 objC) {
  int col = int(frag.x);
  vec2 w = toWorld(frag);
  float surf = ifc(col, 3);
  float floorY = ifc(col, 6);
  vec3 bg;
  float fog = 0.0;
  int k = 5;
  if (w.y > surf) {
    bg = skyColor(w, frag, col);
    k = w.y > ifc(col, 2) ? (w.y > ifc(col, 1) ? 0 : 1) : 2;
  } else if (w.y < floorY) {
    bg = floorColor(w, floorY);
    k = 6;
  } else {
    k = 3;
    if (w.y < ifc(col, 4)) k = 4;
    if (w.y < ifc(col, 5)) k = 5;
    bg = seaColor(w, col, k, surf, fog);
  }
  bg += interfaceGlow(w, col, surf) * (w.y < floorY ? 0.0 : 1.0);

  vec4 o = texture(uObj, tuv(frag));
  objA = o.a;
  vec3 oc = o.rgb;
  if (k >= 3 && k <= 5) {
    vec3 tint = mix(vec3(1.0), uCol[k] * 2.2, 0.35);
    oc = mix(oc * tint, uCol[k] * 0.8 * o.a, fog);
  } else if (k == 2) {
    oc = mix(oc, uCol[2] * o.a, 0.12);
  }
  objC = oc;
  return bg * (1.0 - o.a) + oc;
}

void main() {
  W = textureSize(uIface, 0).x;
  vec2 frag = gl_FragCoord.xy;

  // density field and its gradient
  float e = 1.5;
  float sm = max(0.06, 1.2 / uZoom);
  float dR = densityAt(frag + vec2(e, 0.0), sm);
  float dL = densityAt(frag - vec2(e, 0.0), sm);
  float dU = densityAt(frag + vec2(0.0, e), sm);
  float dD = densityAt(frag - vec2(0.0, e), sm);
  vec2 grad = vec2(dR - dL, dU - dD) / (2.0 * e / uZoom);

  // refraction: light bends toward denser fluid
  vec2 off = -grad * 0.9;
  float ol = length(off);
  if (ol > 5.0) off *= 5.0 / ol;
  float objA;
  vec3 objC;
  vec3 col = scene(frag + off, objA, objC);

  // schlieren: hue is the direction density changes, brightness how fast
  float gm = length(grad);
  float mag = clamp(log(1.0 + gm * 2.5) / log(1.0 + 80.0), 0.0, 1.0);
  float knife = tanh(dot(grad, vec2(0.6, 0.8)) * 0.35);
  vec3 schl = vec3(0.2, 0.205, 0.22) * (1.0 + 0.9 * knife);
  schl += hsv(atan(grad.y, grad.x) / TAU + 0.5, 0.8, 1.0) * mag * 1.05;
  schl += (hash12(frag * 0.7 + 3.1) - 0.5) * 0.025;
  float lens = 0.0;
  if (uLensOn > 0.0) {
    float d = length(frag - uLens.xy);
    lens = smoothstep(uLens.z, uLens.z - 2.0, d) * uLensOn;
    float ring = smoothstep(4.0, 0.0, abs(d - uLens.z)) * uLensOn;
    float ang = atan(frag.y - uLens.y, frag.x - uLens.x);
    vec3 brass = vec3(0.85, 0.66, 0.35) * (0.6 + 0.4 * cos(ang * 2.0 - 1.0));
    schl = mix(schl, schl + objC * 0.12, 0.5);
    col = mix(col, schl, lens);
    col = mix(col, brass, ring * 0.9);
    col += vec3(1.0, 0.95, 0.8) * smoothstep(1.5, 0.0, abs(d - uLens.z + 5.0)) * 0.25 * uLensOn;
  }
  col = mix(col, schl + objC * 0.08, uSchl * (1.0 - lens));

  col += vec3(1.0, 0.75, 0.45) * uFlash;
  // vignette, gentle filmic curve, grain
  vec2 uv = frag / uRes;
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
  col *= mix(0.72, 1.0, vig);
  col = col / (1.0 + col * 0.18);
  col = pow(max(col, 0.0), vec3(0.95));
  col += (hash12(frag + fract(uTime) * 100.0) - 0.5) * 0.018;
  outColor = vec4(col, 1.0);
}`;
