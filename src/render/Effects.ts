import * as THREE from 'three';

// ============================================================ particle atlas
// 4x4 grid of 128px cells. Every cell's content is kept well inside a radial mask (r <= 0.47 of the
// cell) so a rotated point sprite never shows a square edge, and there are no mipmaps so neighbouring
// cells cannot bleed into each other.
export const TEX = {
  glow: 0,
  smoke: 1,
  spark: 2,
  debris: 3,
  flame: 4,
  smoke2: 5,
  flare: 6,
  flame2: 7,
  debris2: 8,
} as const;
const ATLAS_N = 4;

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeNoise(seed: number) {
  const N = 256;
  const rnd = new Float32Array(N * N);
  const r = makeRng(seed);
  for (let i = 0; i < rnd.length; i++) rnd[i] = r();
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) * N, y1 = ((yi + 1) & 255) * N;
    const a = rnd[y0 + x0], b = rnd[y0 + x1], c = rnd[y1 + x0], d = rnd[y1 + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number, oct: number) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += noise(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function makeAtlas(): THREE.CanvasTexture {
  const S = 128;
  const W = S * ATLAS_N;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, W);
  const px = img.data;
  const fbm = makeNoise(1337);
  /** paint one cell procedurally: fn(u, v, r) returns [grey, alpha] with u,v in -0.5..0.5 */
  const cell = (idx: number, fn: (u: number, v: number, r: number) => [number, number]) => {
    const ox = (idx % ATLAS_N) * S, oy = Math.floor(idx / ATLAS_N) * S;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S - 0.5, v = (y + 0.5) / S - 0.5;
        const r = Math.hypot(u, v);
        const mask = 1 - smooth(0.4, 0.47, r); // radial mask keeps everything off the cell border
        const [g, a] = fn(u, v, r);
        const o = ((oy + y) * W + ox + x) * 4;
        const gg = Math.max(0, Math.min(255, g * 255));
        px[o] = px[o + 1] = px[o + 2] = gg;
        px[o + 3] = Math.max(0, Math.min(255, a * mask * 255));
      }
    }
  };
  // 0: soft glow (gaussian)
  cell(TEX.glow, (_u, _v, r) => [1, Math.exp(-r * r * 26) - Math.exp(-0.47 * 0.47 * 26)]);
  // 1 & 5: billowing smoke puffs (fbm density, eroded edges, self-shading)
  const smokeCell = (idx: number, ox: number, oy: number) =>
    cell(idx, (u, v, r) => {
      const n = fbm(u * 5 + ox, v * 5 + oy, 5);
      const n2 = fbm(u * 11 + oy, v * 11 + ox, 3);
      const d = (1 - r / 0.4) * 1.35 + (n - 0.5) * 1.25 + (n2 - 0.5) * 0.35;
      const a = smooth(0.05, 0.62, d) * 0.96;
      const shade = 0.58 + 0.42 * Math.max(0, Math.min(1, (n - 0.32) * 1.7 - v * 0.5));
      return [shade, a];
    });
  smokeCell(TEX.smoke, 3.1, 7.7);
  smokeCell(TEX.smoke2, 19.4, 2.3);
  // 2: spark / ember (hot dot with tight halo)
  cell(TEX.spark, (_u, _v, r) => [1, Math.min(1, Math.exp(-r * r * 220) * 1.2 + Math.exp(-r * r * 40) * 0.35)]);
  // 4 & 7: turbulent flame (domain-warped fbm, grey = heat so vertex colour + tone mapping give the hue)
  const flameCell = (idx: number, ox: number, oy: number) =>
    cell(idx, (u, v, r) => {
      const w = fbm(u * 3 + ox, v * 3 + oy, 3);
      const n = fbm(u * 6.5 + w * 2.4 + ox, v * 6.5 - w * 2.4 + oy, 4);
      let heat = (1 - r / 0.4) * 1.15 + (n - 0.5) * 1.5;
      heat = Math.max(0, Math.min(1, heat * 1.3));
      return [0.3 + 0.7 * heat * heat, smooth(0.03, 0.5, heat)];
    });
  flameCell(TEX.flame, 5.5, 1.2);
  flameCell(TEX.flame2, 12.8, 9.1);
  // 6: muzzle flare (irregular 5-point star burst with hot core)
  cell(TEX.flare, (u, v, r) => {
    const ang = Math.atan2(v, u);
    const spikes = Math.pow(Math.max(0, Math.cos(ang * 2.5)), 6) * (0.75 + 0.25 * Math.cos(ang * 7));
    const a = Math.exp(-r * r * 120) + spikes * Math.exp(-r * 7.5) * 0.9 + Math.exp(-r * r * 30) * 0.25;
    return [1, Math.min(1, a)];
  });
  ctx.putImageData(img, 0, 0);
  // 3 & 8: debris chunks (faceted polygons with light / dark facets)
  const rnd = makeRng(99);
  const chunk = (idx: number, n: number, rMin: number, rMax: number) => {
    const ox = (idx % ATLAS_N) * S + S / 2, oy = Math.floor(idx / ATLAS_N) * S + S / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const r = S * (rMin + rnd() * (rMax - rMin));
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
    }
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      const shade = 0.55 + 0.45 * Math.max(0, Math.cos((i / n) * Math.PI * 2 + 2.3));
      const g = Math.round(shade * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      ctx.moveTo(ox + (rnd() - 0.5) * 6, oy + (rnd() - 0.5) * 6);
      ctx.lineTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.closePath();
      ctx.fill();
    }
  };
  chunk(TEX.debris, 7, 0.2, 0.34);
  chunk(TEX.debris2, 5, 0.12, 0.34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

const PVERT = `
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
attribute float aTex;
uniform float uScale;
varying vec4 vColor;
varying float vRot;
varying float vTex;
void main() {
  vColor = aColor;
  vRot = aRot;
  vTex = aTex;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  // pull the sprite towards the camera along its view ray (same screen position) so big puffs are not
  // sliced by the terrain behind/below them
  mv.xyz += normalize(-mv.xyz) * min(aSize * 0.42, -mv.z - 0.6);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
uniform sampler2D uTex;
varying vec4 vColor;
varying float vRot;
varying float vTex;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  if (dot(p, p) > 0.25) discard;
  p += 0.5;
  float ty = floor((vTex + 0.5) / ${ATLAS_N}.0);
  float tx = vTex - ty * ${ATLAS_N}.0;
  vec2 uv = vec2((tx + p.x) / ${ATLAS_N}.0, 1.0 - (ty + p.y) / ${ATLAS_N}.0);
  vec4 t = texture2D(uTex, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
}`;

interface PInit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  size1?: number;
  r: number;
  g: number;
  b: number;
  r1?: number;
  g1?: number;
  b1?: number;
  a?: number;
  a1?: number;
  gravity?: number;
  drag?: number;
  rot?: number;
  vrot?: number;
  tex?: number;
  fadeIn?: number;
  /** size easing exponent: size t' = 1-(1-t)^se (1 = linear, 2+ = fast growth then settle) */
  se?: number;
  /** colour easing exponent: t' = t^ce (<1 = quick cool-down) */
  ce?: number;
  /** alpha easing exponent: t' = t^ae (>1 = stays opaque longer) */
  ae?: number;
  /** random alpha flicker amount 0..1 */
  flick?: number;
  /** ground height for particles with gravity (bounce / settle) */
  floor?: number;
}

class ParticleSystem {
  readonly cap: number;
  points: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private rot: Float32Array;
  private tex: Float32Array;
  // simulation state
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private phys: Float32Array; // gravity, drag, vrot, fadeIn
  private ease: Float32Array; // se, ce, ae, flicker
  private floor: Float32Array;
  private count = 0;
  private geo: THREE.BufferGeometry;

  constructor(cap: number, atlas: THREE.Texture, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.col = new Float32Array(cap * 4);
    this.rot = new Float32Array(cap);
    this.tex = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.c0 = new Float32Array(cap * 4);
    this.c1 = new Float32Array(cap * 4);
    this.phys = new Float32Array(cap * 4);
    this.ease = new Float32Array(cap * 4);
    this.floor = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTex', new THREE.BufferAttribute(this.tex, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      uniforms: { uTex: { value: atlas }, uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  set scale(v: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = v;
  }

  get free() {
    return this.cap - this.count;
  }

  spawn(p: PInit) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0;
    this.vel[i3 + 1] = p.vy ?? 0;
    this.vel[i3 + 2] = p.vz ?? 0;
    this.life[i] = 0;
    this.maxLife[i] = p.life;
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    this.c0[i4] = p.r;
    this.c0[i4 + 1] = p.g;
    this.c0[i4 + 2] = p.b;
    this.c0[i4 + 3] = p.a ?? 1;
    this.c1[i4] = p.r1 ?? p.r;
    this.c1[i4 + 1] = p.g1 ?? p.g;
    this.c1[i4 + 2] = p.b1 ?? p.b;
    this.c1[i4 + 3] = p.a1 ?? 0;
    this.phys[i4] = p.gravity ?? 0;
    this.phys[i4 + 1] = p.drag ?? 0;
    this.phys[i4 + 2] = p.vrot ?? 0;
    this.phys[i4 + 3] = p.fadeIn ?? 0;
    this.ease[i4] = p.se ?? 1;
    this.ease[i4 + 1] = p.ce ?? 1;
    this.ease[i4 + 2] = p.ae ?? 1;
    this.ease[i4 + 3] = p.flick ?? 0;
    this.floor[i] = p.floor ?? -0.2;
    this.rot[i] = p.rot ?? Math.random() * Math.PI * 2;
    this.tex[i] = p.tex ?? 0;
    this.size[i] = p.size;
    // write initial colour so a particle spawned this frame is drawn correctly
    this.col[i4] = p.r;
    this.col[i4 + 1] = p.g;
    this.col[i4 + 2] = p.b;
    this.col[i4 + 3] = (p.a ?? 1) * (p.fadeIn ? 0 : 1);
  }

  update(dt: number) {
    let n = this.count;
    const pos = this.pos, vel = this.vel, phys = this.phys, ease = this.ease, col = this.col, c0 = this.c0, c1 = this.c1;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      const i3 = i * 3, i4 = i * 4;
      const g = phys[i4], drag = phys[i4 + 1];
      vel[i3 + 1] -= g * dt;
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * dt);
        vel[i3] *= f;
        vel[i3 + 1] *= f;
        vel[i3 + 2] *= f;
      }
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (g > 0 && pos[i3 + 1] < this.floor[i]) {
        pos[i3 + 1] = this.floor[i];
        const vy = vel[i3 + 1];
        vel[i3] *= 0.45;
        vel[i3 + 2] *= 0.45;
        vel[i3 + 1] = vy < -2 ? -vy * 0.28 : 0;
        phys[i4 + 2] *= 0.5;
      }
      this.rot[i] += phys[i4 + 2] * dt;
      const se = ease[i4], ce = ease[i4 + 1], ae = ease[i4 + 2], fl = ease[i4 + 3];
      const ts = se === 1 ? t : 1 - Math.pow(1 - t, se);
      const tc = ce === 1 ? t : Math.pow(t, ce);
      const ta = ae === 1 ? t : Math.pow(t, ae);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * ts;
      const fi = phys[i4 + 3];
      let fade = fi > 0 && t < fi ? t / fi : 1;
      if (fl > 0) fade *= 1 - fl * Math.random();
      col[i4] = c0[i4] + (c1[i4] - c0[i4]) * tc;
      col[i4 + 1] = c0[i4 + 1] + (c1[i4 + 1] - c0[i4 + 1]) * tc;
      col[i4 + 2] = c0[i4 + 2] + (c1[i4 + 2] - c0[i4 + 2]) * tc;
      col[i4 + 3] = (c0[i4 + 3] + (c1[i4 + 3] - c0[i4 + 3]) * ta) * fade;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aColor', 'aRot', 'aTex']) {
      const a = this.geo.getAttribute(k) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private copy(from: number, to: number) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      this.col[to * 4 + k] = this.col[from * 4 + k];
      this.c0[to * 4 + k] = this.c0[from * 4 + k];
      this.c1[to * 4 + k] = this.c1[from * 4 + k];
      this.phys[to * 4 + k] = this.phys[from * 4 + k];
      this.ease[to * 4 + k] = this.ease[from * 4 + k];
    }
    this.size[to] = this.size[from];
    this.rot[to] = this.rot[from];
    this.tex[to] = this.tex[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.floor[to] = this.floor[from];
  }

  get active() {
    return this.count;
  }
}

// ============================================================ beams (billboard ribbons)
interface Beam {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  w0: number; w1: number;
  r: number; g: number; b: number;
  a: number;
  /** alpha multiplier at the A end (tracer tails) */
  aTail: number;
  /** travelling segment length as a fraction of the path (0 = static beam) */
  seg: number;
  /** fade exponent (0 = constant, 1 = linear) */
  fp: number;
  life: number;
  maxLife: number;
}

const BVERT = `
attribute vec4 aColor;
attribute float aV;
varying vec4 vColor;
varying float vV;
void main() {
  vColor = aColor;
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BFRAG = `
varying vec4 vColor;
varying float vV;
void main() {
  float d = abs(vV * 2.0 - 1.0);
  float s = 1.0 - d;
  float soft = s * s;
  float hot = pow(s, 9.0);
  gl_FragColor = vec4(vColor.rgb * (soft + hot * 1.6), vColor.a * soft);
}`;

class BeamBatch {
  mesh: THREE.Mesh;
  private beams: Beam[] = [];
  private cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vv: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(cap = 1500) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 4 * 3);
    this.col = new Float32Array(cap * 4 * 4);
    this.vv = new Float32Array(cap * 4);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      idx[i * 6] = i * 4;
      idx[i * 6 + 1] = i * 4 + 1;
      idx[i * 6 + 2] = i * 4 + 2;
      idx[i * 6 + 3] = i * 4 + 2;
      idx[i * 6 + 4] = i * 4 + 1;
      idx[i * 6 + 5] = i * 4 + 3;
      this.vv[i * 4] = 0;
      this.vv[i * 4 + 1] = 1;
      this.vv[i * 4 + 2] = 0;
      this.vv[i * 4 + 3] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aV', new THREE.BufferAttribute(this.vv, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    const m = new THREE.ShaderMaterial({ vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }
  add(b: Beam) {
    if (this.beams.length < this.cap) this.beams.push(b);
  }
  update(dt: number, cam: THREE.Camera) {
    const cp = cam.position;
    let n = 0;
    const out: Beam[] = [];
    for (const b of this.beams) {
      b.life += dt;
      if (b.life > b.maxLife) continue;
      out.push(b);
      const t = b.life / b.maxLife;
      const w = (b.w0 + (b.w1 - b.w0) * t) * 0.5;
      const a = b.fp === 0 ? b.a : b.a * Math.pow(1 - t, b.fp);
      let ax = b.ax, ay = b.ay, az = b.az, bx = b.bx, by = b.by, bz = b.bz;
      if (b.seg > 0) {
        // travelling segment: head moves A→B over the life, tail follows seg behind
        const head = Math.min(1, t * (1 + b.seg));
        const tail = Math.max(0, head - b.seg);
        ax = b.ax + (b.bx - b.ax) * tail; ay = b.ay + (b.by - b.ay) * tail; az = b.az + (b.bz - b.az) * tail;
        bx = b.ax + (b.bx - b.ax) * head; by = b.ay + (b.by - b.ay) * head; bz = b.az + (b.bz - b.az) * head;
      }
      // side vector = normalize(cross(dir, toCam))
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const mx = (ax + bx) / 2 - cp.x, my = (ay + by) / 2 - cp.y, mz = (az + bz) / 2 - cp.z;
      let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / sl) * w;
      sy = (sy / sl) * w;
      sz = (sz / sl) * w;
      const o = n * 12;
      this.pos[o] = ax - sx; this.pos[o + 1] = ay - sy; this.pos[o + 2] = az - sz;
      this.pos[o + 3] = ax + sx; this.pos[o + 4] = ay + sy; this.pos[o + 5] = az + sz;
      this.pos[o + 6] = bx - sx; this.pos[o + 7] = by - sy; this.pos[o + 8] = bz - sz;
      this.pos[o + 9] = bx + sx; this.pos[o + 10] = by + sy; this.pos[o + 11] = bz + sz;
      for (let k = 0; k < 4; k++) {
        const c = n * 16 + k * 4;
        this.col[c] = b.r;
        this.col[c + 1] = b.g;
        this.col[c + 2] = b.b;
        this.col[c + 3] = k < 2 ? a * b.aTail : a;
      }
      n++;
    }
    this.beams = out;
    this.geo.setDrawRange(0, n * 6);
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const ca = this.geo.getAttribute('aColor') as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, n * 12);
    pa.needsUpdate = true;
    ca.clearUpdateRanges();
    ca.addUpdateRange(0, n * 16);
    ca.needsUpdate = true;
  }
}

// ============================================================ ground decals (shockwaves, target markers)
const DVERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DFRAG = `
uniform float uKind;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uW;
uniform float uK;
varying vec2 vUv;
#define TAU 6.2831853
float band(float x, float c, float w) { float f = fwidth(x) * 1.25; return 1.0 - smoothstep(w, w + f, abs(x - c)); }
float spoke(float ang, float n, float w, float r) { float s = abs(fract(ang / TAU * n) - 0.5) * TAU / n * r; float f = fwidth(s) * 1.25; return 1.0 - smoothstep(w, w + f, s); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float a = 0.0;
  if (uKind < 0.5) {
    // thin shockwave: crisp leading edge, short soft trailing wake (never a filled disc)
    float d = (1.0 - r) / max(uW, 0.0005);
    a = smoothstep(0.0, 0.18, d) * (1.0 - smoothstep(0.18, 1.0, d));
  } else if (uKind < 1.5) {
    // Ion Strike targeting reticle
    float rot = uTime;
    a += band(r, 0.965, 0.008) * 0.9;
    float dash = step(0.38, fract((ang + rot * 0.6) / TAU * 24.0));
    a += band(r, 0.9, 0.012) * dash * 0.75;
    float ticks = spoke(ang - rot * 1.4, 4.0, 0.035, r) * step(0.58, r) * step(r, 0.8);
    a += ticks;
    float gaps = step(0.14, fract((ang + rot * 2.0) / TAU * 3.0));
    a += band(r, 0.44, 0.012) * gaps;
    a += band(r, mix(0.85, 0.06, uK), 0.01) * 0.9;
    float cross = (spoke(ang + 0.7854, 4.0, 0.008, r)) * step(0.1, r) * step(r, 0.3);
    a += cross;
    a += (1.0 - smoothstep(0.0, 0.05 + 0.04 * uK, r)) * (0.6 + 0.4 * sin(uTime * 14.0));
    a += (1.0 - r) * 0.07;
    a *= 0.8 + 0.2 * sin(uTime * 9.0);
  } else {
    // Rift Missile impact marker: converging pulse rings + rotating Rift trefoil
    float rot = uTime * 0.35;
    a += band(r, 0.965, 0.012);
    for (int i = 0; i < 3; i++) {
      float ph = fract(uTime * 0.5 + float(i) / 3.0);
      a += band(r, 1.0 - ph * 0.9, 0.01 + 0.02 * ph) * smoothstep(0.0, 0.2, ph) * (1.0 - ph) * 1.2;
    }
    float sect = step(0.5, fract((ang + rot) / TAU * 3.0));
    a += sect * step(0.2, r) * step(r, 0.52) * 0.12;
    a += band(r, 0.52, 0.01) + band(r, 0.2, 0.01);
    a += spoke(ang, 4.0, 0.012, r) * step(0.62, r) * step(r, 0.9);
    a += (1.0 - smoothstep(0.0, 0.05, r));
    a *= 0.65 + 0.35 * sin(uTime * 3.14159 * 2.0);
  }
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.5) * uAlpha);
}`;

interface Decal {
  m: THREE.Mesh;
  u: { [k: string]: THREE.IUniform };
  life: number;
  max: number;
  r0: number;
  r1: number;
  /** ring thickness in world units */
  w: number;
  a0: number;
  /** per-frame animation (target markers) */
  anim?: (d: Decal, dt: number, t: number) => void;
}

// ============================================================ effects manager
export type ExplosionSize = 'small' | 'medium' | 'large' | 'huge' | 'infantry';

interface Delayed {
  t: number;
  fn: () => void;
}
interface Seq {
  t: number;
  dur: number;
  fn: (t: number, dt: number, k: number) => void;
}

const rs = () => Math.random() - 0.5;
const pick = <T,>(a: T, b: T) => (Math.random() < 0.5 ? a : b);

export class Effects {
  group = new THREE.Group();
  private add: ParticleSystem;
  private alpha: ParticleSystem;
  private beams: BeamBatch;
  private lights: { l: THREE.PointLight; life: number; max: number; i0: number }[] = [];
  private rings: Decal[] = [];
  private markers: Decal[] = [];
  private delayed: Delayed[] = [];
  private seqs: Seq[] = [];
  private flashMesh: THREE.Mesh;
  private flashU: { uColor: THREE.IUniform<THREE.Color> };
  private flashMulMesh: THREE.Mesh;
  private flashMulU: { uColor: THREE.IUniform<THREE.Color> };
  private missileMesh: THREE.Group | null = null;
  private frameDt = 1 / 60;
  shake = 0;
  /** Full-screen flash amount 0..1 (decays). Renderer may read it to drive a vignette/exposure pulse. */
  flash = 0;
  /** Colour of the current full-screen flash. */
  flashColor = new THREE.Color(1, 0.9, 0.75);
  /** returns fog visibility (0..1) at position; effects hidden in shroud */
  visibility: (x: number, z: number) => number = () => 1;
  /** optional terrain height lookup (debris bounce, dust skirts). Falls back to y - 0.4. */
  groundAt: ((x: number, z: number) => number) | null = null;
  onScorch: ((x: number, z: number, r: number) => void) | null = null;
  quality = 2;

  constructor() {
    const atlas = makeAtlas();
    this.alpha = new ParticleSystem(5000, atlas, false);
    this.add = new ParticleSystem(7000, atlas, true);
    this.beams = new BeamBatch(2000);
    this.group.add(this.alpha.points, this.add.points, this.beams.mesh);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 7, 1.6);
      l.visible = true;
      this.group.add(l);
      this.lights.push({ l, life: 1, max: 1, i0: 0 });
    }
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const mkDecal = (kind: number, depthTest: boolean, order: number): Decal => {
      const u = {
        uKind: { value: kind },
        uColor: { value: new THREE.Color(1, 0.8, 0.5) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uW: { value: 0.1 },
        uK: { value: 0 },
      };
      const m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: DVERT, fragmentShader: DFRAG, uniforms: u, transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending }));
      m.visible = false;
      m.renderOrder = order;
      m.frustumCulled = false;
      this.group.add(m);
      return { m, u, life: 1, max: 1, r0: 0, r1: 1, w: 0.1, a0: 0.3 };
    };
    for (let i = 0; i < 12; i++) this.rings.push(mkDecal(0, true, 9));
    for (let i = 0; i < 3; i++) this.markers.push(mkDecal(1, false, 13));
    // full-screen flash overlay (additive, capped)
    // full-screen flash = exposure boost (multiplicative) + a brief additive white-out; both capped
    const mkFlash = (u: { uColor: THREE.IUniform<THREE.Color> }, mul: boolean, order: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          uniforms: u,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * 1.2; gl_FragColor = vec4(uColor * v, 1.0); }',
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: mul ? THREE.CustomBlending : THREE.AdditiveBlending,
          ...(mul ? { blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor } : {}),
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = order;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.flashU = { uColor: { value: new THREE.Color(0, 0, 0) } };
    this.flashMulU = { uColor: { value: new THREE.Color(0, 0, 0) } };
    this.flashMulMesh = mkFlash(this.flashMulU, true, 998);
    this.flashMesh = mkFlash(this.flashU, false, 999);
  }

  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.scale = s;
    this.alpha.scale = s;
  }

  get particleCount() {
    return this.add.active + this.alpha.active;
  }

  /** 1 at high quality, 0.5 at lower; also backs off when the pools are getting full */
  private get q() {
    const base = this.quality >= 2 ? 1 : 0.55;
    const load = Math.min(this.add.free / this.add.cap, this.alpha.free / this.alpha.cap);
    return load < 0.25 ? base * 0.5 : base;
  }

  private gy(x: number, z: number, y: number) {
    return this.groundAt ? this.groundAt(x, z) : y - 0.4;
  }

  update(dt: number, cam: THREE.Camera) {
    this.frameDt = Math.max(1 / 240, dt);
    if (this.delayed.length) {
      for (const d of this.delayed) d.t -= dt;
      const due = this.delayed.filter((d) => d.t <= 0);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.t > 0);
        for (const d of due) d.fn();
      }
    }
    if (this.seqs.length) {
      const cur = this.seqs;
      this.seqs = []; // sequences started from inside a callback land here
      for (const s of cur) {
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        s.fn(s.t, dt, k);
        if (s.t < s.dur) this.seqs.push(s);
      }
    }
    this.add.update(dt);
    this.alpha.update(dt);
    this.beams.update(dt, cam);
    for (const L of this.lights) {
      if (L.life < L.max) {
        L.life += dt;
        const t = Math.min(1, L.life / L.max);
        L.l.intensity = L.i0 * (1 - t) * (1 - t);
      } else L.l.intensity = 0;
    }
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.life += dt;
      const t = R.life / R.max;
      if (t >= 1) {
        R.m.visible = false;
        continue;
      }
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      const r = R.r0 + (R.r1 - R.r0) * e;
      R.m.scale.set(r, 1, r);
      R.u.uW.value = Math.min(0.9, (R.w * (1 - t * 0.5)) / Math.max(0.05, r));
      R.u.uAlpha.value = R.a0 * (1 - t) * (1 - t) * Math.min(1, t * 12);
    }
    for (const M of this.markers) {
      if (!M.m.visible) continue;
      M.life += dt;
      const t = M.life / M.max;
      if (t >= 1) {
        M.m.visible = false;
        M.anim = undefined;
        continue;
      }
      M.anim?.(M, dt, t);
    }
    // full-screen flash
    if (this.flash > 0.002) {
      this.flash *= Math.exp(-dt * 3.2);
      const f = Math.min(0.6, this.flash);
      // exposure boost up to ~2x, plus an additive white-out that dies off much faster (f^3)
      this.flashMulU.uColor.value.copy(this.flashColor).multiplyScalar(f * 1.8);
      this.flashU.uColor.value.copy(this.flashColor).multiplyScalar(Math.min(0.35, f * f * f * 1.6));
      this.flashMesh.visible = this.flashMulMesh.visible = true;
    } else {
      this.flash = 0;
      this.flashMesh.visible = this.flashMulMesh.visible = false;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  later(t: number, fn: () => void) {
    this.delayed.push({ t, fn });
  }

  /** Run fn every frame for dur seconds: fn(elapsed, dt, k 0..1). */
  run(dur: number, fn: (t: number, dt: number, k: number) => void) {
    this.seqs.push({ t: 0, dur, fn });
  }

  /** Continuous emitter: calls fn(k) `rate` times per second (rate may be a function of k). */
  emit(dur: number, rate: number | ((k: number) => number), fn: (k: number) => void) {
    let acc = Math.random();
    this.run(dur, (_t, dt, k) => {
      acc += (typeof rate === 'number' ? rate : rate(k)) * dt;
      let guard = 0;
      while (acc >= 1 && guard++ < 12) {
        acc -= 1;
        fn(k);
      }
    });
  }

  flashLight(x: number, y: number, z: number, color: number, intensity: number, dur: number, dist = 7) {
    intensity = Math.min(10, intensity);
    // pick the light with most elapsed life
    let best = this.lights[0];
    let bestT = -1;
    for (const L of this.lights) {
      const t = L.life / L.max;
      if (t > bestT) {
        bestT = t;
        best = L;
      }
    }
    if (bestT < 0.5 && intensity < best.i0) return;
    best.l.position.set(x, y, z);
    best.l.color.setHex(color);
    best.l.distance = dist;
    best.i0 = intensity;
    best.life = 0;
    best.max = dur;
  }

  /** Thin additive ground shockwave. Colour may be HDR. */
  ring(x: number, y: number, z: number, r1: number, dur: number, color: number | [number, number, number] = [1.6, 1.05, 0.6], alpha = 0.32, width?: number) {
    const R = this.rings.find((r) => !r.m.visible) ?? this.rings.reduce((a, b) => (a.life / a.max > b.life / b.max ? a : b));
    R.m.visible = true;
    R.m.position.set(x, y + 0.12, z);
    const c = R.u.uColor.value as THREE.Color;
    if (typeof color === 'number') c.setHex(color);
    else c.setRGB(color[0], color[1], color[2]);
    R.life = 0;
    R.max = Math.max(0.05, dur);
    R.r0 = r1 * 0.12;
    R.r1 = r1;
    R.w = width ?? Math.max(0.12, r1 * 0.09);
    R.a0 = alpha;
    R.m.scale.set(R.r0, 1, R.r0);
    R.u.uAlpha.value = 0;
  }

  private marker(kind: number, x: number, y: number, z: number, radius: number, dur: number, anim: (d: Decal, dt: number, t: number) => void) {
    const M = this.markers.find((m) => !m.m.visible) ?? this.markers[0];
    M.m.visible = true;
    M.m.position.set(x, y + 0.15, z);
    M.m.scale.set(radius, 1, radius);
    M.u.uKind.value = kind;
    M.u.uTime.value = 0;
    M.u.uK.value = 0;
    M.u.uAlpha.value = 0;
    M.life = 0;
    M.max = dur;
    M.anim = anim;
    return M;
  }

  /** Trigger a (capped) full-screen flash. */
  screenFlash(amount: number, r = 1, g = 0.9, b = 0.75) {
    if (amount > this.flash) {
      this.flash = amount;
      this.flashColor.setRGB(r, g, b);
    }
  }

  // ---------------------------------------------------------- primitives
  glow(x: number, y: number, z: number, size: number, r: number, g: number, b: number, life: number, a = 1) {
    this.add.spawn({ x, y, z, life, size, size1: size * 0.6, r, g, b, a, a1: 0, tex: TEX.glow });
  }

  /** Alpha-blended smoke puff. dark = grey level. */
  smoke(x: number, y: number, z: number, size: number, life: number, dark = 0.3, rise = 0.6, a = 0.55) {
    const v = dark;
    this.alpha.spawn({
      x, y, z, vx: rs() * 0.3, vy: rise * (0.6 + Math.random() * 0.8), vz: rs() * 0.3,
      life, size: size * 0.5, size1: size * 1.6, r: v, g: v * 0.97, b: v * 0.93, r1: v * 1.25 + 0.05, g1: v * 1.22 + 0.05, b1: v * 1.2 + 0.05, a, a1: 0, drag: 0.5,
      tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.8, fadeIn: 0.1, se: 1.6, ae: 1.3,
    });
  }

  /** Additive flame tongue. */
  fire(x: number, y: number, z: number, size: number, life: number, heat = 1) {
    this.add.spawn({
      x, y, z, vx: rs() * 0.4, vy: 0.8 + Math.random() * 0.6, vz: rs() * 0.4,
      life, size, size1: size * 0.35, r: 2.6 * heat, g: 1.1 * heat, b: 0.28 * heat, r1: 0.5, g1: 0.1, b1: 0.02, a: 0.55, a1: 0, tex: pick(TEX.flame, TEX.flame2),
      vrot: rs() * 3, drag: 0.8, ce: 0.7, flick: 0.25,
    });
  }

  sparks(x: number, y: number, z: number, n: number, speed: number, r = 1, g = 0.8, b = 0.4) {
    // colours are treated as a hue; sparks are always rendered hot (HDR)
    const k = 4.5 / Math.max(r, g, b, 0.01);
    const floor = this.gy(x, z, y);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add.spawn({
        x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1, vz: Math.sin(a) * Math.cos(e) * s,
        life: 0.3 + Math.random() * 0.45, size: 0.1 + Math.random() * 0.05, size1: 0.03, r: r * k, g: g * k, b: b * k, r1: r * k * 0.6, g1: g * k * 0.3, b1: b * k * 0.15,
        a: 1, a1: 0, gravity: 9, drag: 1, tex: TEX.spark, floor, ae: 2,
      });
    }
  }

  /** Solid debris chunks (optionally with a burning ember riding the same trajectory). */
  debris(x: number, y: number, z: number, n: number, speed: number, c = 0.14, size = 1, burning = 0.4) {
    const floor = this.gy(x, z, y) + 0.04;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.8);
      const vx = Math.cos(a) * s, vz = Math.sin(a) * s, vy = 2 + Math.random() * speed * 1.4;
      const life = 1.3 + Math.random() * 0.9;
      const sz = (0.13 + Math.random() * 0.14) * size;
      const cc = c * (0.7 + Math.random() * 0.6);
      this.alpha.spawn({
        x, y, z, vx, vy, vz, life, size: sz, r: cc, g: cc * 0.93, b: cc * 0.86, a: 1, a1: 0, ae: 4, gravity: 13, drag: 0.15, floor,
        tex: pick(TEX.debris, TEX.debris2), vrot: rs() * 14,
      });
      if (Math.random() < burning) {
        // same kinematics → the ember sticks to the chunk
        this.add.spawn({
          x, y, z, vx, vy, vz, life: life * (0.4 + Math.random() * 0.3), size: sz * 1.5, size1: sz * 0.6, r: 3.2, g: 1.3, b: 0.35, r1: 1.2, g1: 0.25, b1: 0.05,
          a: 0.9, a1: 0, gravity: 13, drag: 0.15, floor, tex: TEX.spark, flick: 0.3,
        });
      }
    }
  }

  dust(x: number, y: number, z: number, n: number, size: number, col: [number, number, number] = [0.52, 0.46, 0.37]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.2;
      this.alpha.spawn({
        x: x + Math.cos(a) * 0.1, y: y + 0.05, z: z + Math.sin(a) * 0.1, vx: Math.cos(a) * s, vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a) * s,
        life: 0.9 + Math.random() * 0.6, size: size * 0.5, size1: size * 1.5, r: col[0], g: col[1], b: col[2], a: 0.45, a1: 0, drag: 2.5,
        tex: pick(TEX.smoke, TEX.smoke2), vrot: rs(), se: 2, fadeIn: 0.08,
      });
    }
  }

  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number, life: number, a = 1, w1?: number, opts?: { seg?: number; tail?: number; fp?: number }) {
    this.beams.add({ ax, ay, az, bx, by, bz, w0: width, w1: w1 ?? width, r, g, b, a, aTail: opts?.tail ?? 1, seg: opts?.seg ?? 0, fp: opts?.fp ?? 1, life: 0, maxLife: life });
  }

  /** Jagged electric arc from A to B (with an optional side branch). */
  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number, life: number, jitter = 0.35, branch = true) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(3, Math.min(10, Math.round(len * 2.2)));
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const j = i === n ? 0 : jitter * Math.sin(t * Math.PI) * len * 0.25;
      const nx = ax + (bx - ax) * t + rs() * j, ny = ay + (by - ay) * t + rs() * j * 0.6, nz = az + (bz - az) * t + rs() * j;
      this.beam(px, py, pz, nx, ny, nz, width * 3, r * 0.5, g * 0.5, b * 0.5, life, 0.7, width * 1.5, { fp: 1.5 });
      this.beam(px, py, pz, nx, ny, nz, width, r, g, b, life, 1, width * 0.5, { fp: 1.5 });
      if (branch && i === Math.floor(n / 2) && len > 1.2) {
        const bl = len * 0.35;
        this.lightning(nx, ny, nz, nx + rs() * bl, ny + rs() * bl * 0.3, nz + rs() * bl, width * 0.6, r, g, b, life * 0.8, jitter, false);
      }
      px = nx; py = ny; pz = nz;
    }
  }

  // ---------------------------------------------------------- composite effects
  /**
   * Core fireball. s = scale (small ≈0.55, medium ≈0.8, large ≈1.15).
   * Layers: brief HDR flash, dark smoke puff under the fire (contrast), turbulent HDR flame tongues,
   * hot sparks, solid (partly burning) debris, ground dust skirt, rising smoke column, thin shockwave.
   */
  private blast(x: number, y: number, z: number, s: number, nFire: number, nSpark: number, nDebris: number, nDark: number, nCol: number, opts: { ring?: boolean; light?: boolean } = {}) {
    const q = this.q;
    const g = this.gy(x, z, y);
    const fy = Math.max(y, g + 0.25 * s);
    // 1. flash core (very short)
    this.add.spawn({ x, y: fy + 0.2 * s, z, life: 0.08 + 0.03 * s, size: 1.5 * s, size1: 2.1 * s, r: 4.5, g: 2.8, b: 1.4, a: 0.4, a1: 0, tex: TEX.glow, ce: 0.5 });
    // 2. dark smoke puffs under the fire at t=0
    for (let i = 0; i < Math.max(1, Math.round(nDark * q)); i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.35 * s;
      this.alpha.spawn({
        x: x + Math.cos(a) * rr, y: fy + (0.15 + Math.random() * 0.35) * s, z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * 0.5 * s, vy: 0.45 * s, vz: Math.sin(a) * 0.5 * s,
        life: (1.9 + Math.random() * 0.9) * (0.7 + 0.3 * s), size: 1.0 * s, size1: 2.5 * s,
        r: 0.08, g: 0.07, b: 0.06, r1: 0.2, g1: 0.18, b1: 0.16, a: 0.8, a1: 0, ae: 1.7, se: 2.2,
        tex: pick(TEX.smoke, TEX.smoke2), drag: 1.4, vrot: rs() * 0.6,
      });
    }
    // 3. flame tongues (HDR orange → deep red, shrinking)
    const nf = Math.max(3, Math.round(nFire * q));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.1 + 0.15;
      const sp = (1.6 + Math.random() * 2.6) * s;
      this.add.spawn({
        x: x + Math.cos(a) * 0.3 * s * Math.random(), y: fy + (0.1 + Math.random() * 0.3) * s, z: z + Math.sin(a) * 0.3 * s * Math.random(),
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp * 0.7 + 0.9 * s, vz: Math.sin(a) * Math.cos(e) * sp,
        life: (0.42 + Math.random() * 0.38) * (0.75 + 0.25 * s), size: (0.95 + Math.random() * 0.55) * s, size1: 0.4 * s,
        r: 3.0, g: 1.3, b: 0.35, r1: 0.6, g1: 0.12, b1: 0.02, a: 0.4, a1: 0, ce: 0.6, ae: 1.2,
        tex: pick(TEX.flame, TEX.flame2), drag: 3.2, vrot: rs() * 4,
      });
    }
    // 4. sparks / embers
    const floor = g;
    const ns = Math.round(nSpark * q);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.15;
      const sp = (3 + Math.random() * 5) * s;
      this.add.spawn({
        x, y: fy + 0.2 * s, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1.5, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.45 + Math.random() * 0.8, size: 0.09 + Math.random() * 0.07, size1: 0.03,
        r: 5, g: 2.6, b: 0.9, r1: 2.2, g1: 0.5, b1: 0.1, a: 1, a1: 0, ae: 2, gravity: 9, drag: 0.9, tex: TEX.spark, floor, flick: 0.2,
      });
    }
    // 5. debris
    if (nDebris > 0) this.debris(x, fy + 0.1, z, Math.max(1, Math.round(nDebris * q)), 2.6 + 2 * s, 0.13, 0.8 + 0.5 * s, 0.35);
    // 6. ground dust skirt
    const nd = Math.round((3 + 4 * s) * q);
    for (let i = 0; i < nd; i++) {
      const a = (i / nd) * Math.PI * 2 + Math.random() * 0.5;
      const sp = (1.8 + Math.random() * 1.2) * s;
      this.alpha.spawn({
        x: x + Math.cos(a) * 0.3 * s, y: g + 0.15 * s, z: z + Math.sin(a) * 0.3 * s, vx: Math.cos(a) * sp, vy: 0.25, vz: Math.sin(a) * sp,
        life: 1.1 + Math.random() * 0.6, size: 0.6 * s, size1: 1.7 * s, r: 0.42, g: 0.37, b: 0.3, a: 0.42, a1: 0, drag: 2.6, se: 2, fadeIn: 0.05,
        tex: pick(TEX.smoke, TEX.smoke2), vrot: rs(),
      });
    }
    // 7. rising grey-brown smoke column
    if (nCol > 0) {
      this.later(0.1 + Math.random() * 0.08, () => {
        const nc = Math.max(1, Math.round(nCol * q));
        for (let i = 0; i < nc; i++) {
          const rr = Math.random() * 0.35 * s;
          const a = Math.random() * Math.PI * 2;
          this.alpha.spawn({
            x: x + Math.cos(a) * rr, y: fy + (0.3 + i * 0.25) * s, z: z + Math.sin(a) * rr,
            vx: rs() * 0.3 + 0.12, vy: (0.8 + Math.random() * 0.7) * (0.6 + 0.4 * s), vz: rs() * 0.3,
            life: (2.6 + Math.random() * 1.6) * (0.7 + 0.3 * s), size: 0.8 * s, size1: 2.6 * s,
            r: 0.11, g: 0.095, b: 0.08, r1: 0.32, g1: 0.3, b1: 0.27, a: 0.65, a1: 0, ae: 1.3, se: 1.4, fadeIn: 0.12,
            drag: 0.35, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.5,
          });
        }
      });
    }
    // 8. thin shockwave
    if (opts.ring !== false && s >= 0.7) this.ring(x, g, z, 2.1 * s, 0.22, [1.7, 1.1, 0.6], 0.22, 0.12 * s);
    // 9. light
    if (opts.light !== false) this.flashLight(x, fy + 1.0 * s, z, 0xff8a3a, 4 + 5 * s, 0.25 + 0.15 * s, 1.8 * s * 3);
  }

  explosion(x: number, y: number, z: number, size: ExplosionSize) {
    if (this.visibility(x, z) < 0.3) return;
    switch (size) {
      case 'infantry': {
        const g = this.gy(x, z, y);
        this.dust(x, g, z, 4, 0.5, [0.45, 0.38, 0.3]);
        this.sparks(x, y + 0.1, z, 3, 2, 1, 0.35, 0.2);
        this.alpha.spawn({ x, y: g + 0.25, z, vy: 0.3, life: 1.2, size: 0.4, size1: 0.9, r: 0.35, g: 0.12, b: 0.08, a: 0.35, a1: 0, tex: TEX.smoke, drag: 1 });
        break;
      }
      case 'small':
        this.blast(x, y, z, 0.55, 6, 8, 3, 1, 2, { ring: false });
        break;
      case 'medium':
        this.blast(x, y, z, 0.8, 10, 12, 6, 2, 4);
        this.onScorch?.(x, z, 0.9);
        this.shake = Math.max(this.shake, 0.12);
        break;
      case 'large':
        this.blast(x, y, z, 1.15, 13, 18, 9, 3, 5);
        this.onScorch?.(x, z, 1.4);
        this.shake = Math.max(this.shake, 0.28);
        break;
      case 'huge':
        // buildings (w*h >= 6). Footprint is unknown here; assume 3x3.
        this.buildingCollapse(x, y, z, 3, 3);
        break;
    }
  }

  /**
   * Building destruction: staggered blasts across the footprint, big burning debris, a dust wave and
   * lingering fires + smoke for 6-10 s. y is roughly ground + 0.5 (as emitted by World).
   */
  buildingCollapse(x: number, y: number, z: number, w: number, h: number) {
    if (this.visibility(x, z) < 0.3) return;
    const area = w * h;
    const g = this.gy(x, z, y);
    const sz = Math.sqrt(area);
    const hw = w * 0.5, hh = h * 0.5;
    const nBlasts = Math.max(3, Math.min(5, Math.round(1.5 + area / 2.5)));
    this.blast(x, g + 0.6, z, Math.min(1.25, 0.8 + sz * 0.12), 12, 16, 6, 3, 4);
    for (let k = 0; k < nBlasts; k++) {
      this.later(0.14 + k * (0.18 + Math.random() * 0.12), () => {
        const ox = x + rs() * w * 0.8, oz = z + rs() * h * 0.8;
        this.blast(ox, g + 0.3 + Math.random() * 0.9, oz, 0.75 + Math.random() * 0.2, 9, 10, 4, 2, 3, { ring: k === nBlasts - 1 });
        this.shake = Math.max(this.shake, 0.18);
      });
    }
    // the structure gives way: big debris + ground dust wave
    this.later(0.3, () => {
      const q = this.q;
      this.debris(x, g + 0.8, z, Math.round((8 + area * 0.9) * q), 4.5, 0.11, 2.0, 0.45);
      const nd = Math.round((10 + area) * q);
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * Math.PI * 2 + Math.random() * 0.3;
        const ex = Math.cos(a), ez = Math.sin(a);
        const sp = 1.6 + Math.random() * 1.4;
        this.alpha.spawn({
          x: x + ex * hw * 0.9, y: g + 0.35, z: z + ez * hh * 0.9, vx: ex * sp, vy: 0.35 + Math.random() * 0.3, vz: ez * sp,
          life: 2.2 + Math.random() * 1.2, size: 1.1, size1: 3.0, r: 0.4, g: 0.36, b: 0.3, r1: 0.5, g1: 0.47, b1: 0.42, a: 0.5, a1: 0, drag: 1.6, se: 2, ae: 1.3, fadeIn: 0.06,
          tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.5,
        });
      }
      this.ring(x, g, z, 2.2 + sz, 0.25, [1.2, 0.95, 0.7], 0.22, 0.25);
    });
    // lingering fires and a black smoke column
    const dur = Math.min(10, 6 + area * 0.4);
    const floor = g;
    this.emit(dur, (k) => (5 + area * 0.5) * (1 - k * 0.8) * (this.quality >= 2 ? 1 : 0.5), (k) => {
      const fx = x + rs() * w * 0.75, fz = z + rs() * h * 0.75;
      const heat = 1 - k * 0.5;
      this.add.spawn({
        x: fx, y: g + 0.15 + Math.random() * 0.3, z: fz, vx: rs() * 0.3, vy: 0.9 + Math.random() * 0.8, vz: rs() * 0.3,
        life: 0.55 + Math.random() * 0.45, size: (0.7 + Math.random() * 0.6) * heat, size1: 0.25,
        r: 2.6 * heat, g: 1.05 * heat, b: 0.25 * heat, r1: 0.5, g1: 0.08, b1: 0.02, a: 0.55, a1: 0, ce: 0.7, flick: 0.35,
        tex: pick(TEX.flame, TEX.flame2), drag: 0.8, vrot: rs() * 3,
      });
      if (Math.random() < 0.18) {
        this.add.spawn({
          x: fx, y: g + 0.3, z: fz, vx: rs() * 0.8, vy: 1.8 + Math.random() * 1.5, vz: rs() * 0.8, life: 1 + Math.random() * 0.8, size: 0.07, size1: 0.03,
          r: 4.5, g: 2, b: 0.5, r1: 2, g1: 0.4, b1: 0.05, a: 1, a1: 0, drag: 0.6, gravity: -0.3, tex: TEX.spark, flick: 0.5, floor,
        });
      }
    });
    this.emit(dur + 1, (k) => (2.4 + area * 0.25) * (1 - k * 0.7) * (this.quality >= 2 ? 1 : 0.5), (k) => {
      const sx = x + rs() * w * 0.6, sz2 = z + rs() * h * 0.6;
      const v = 0.07 + k * 0.12;
      this.alpha.spawn({
        x: sx, y: g + 0.6, z: sz2, vx: rs() * 0.3 + 0.15, vy: 1.0 + Math.random() * 0.6, vz: rs() * 0.3,
        life: 3.5 + Math.random() * 1.8, size: 0.9, size1: 3.2, r: v, g: v * 0.95, b: v * 0.9, r1: v + 0.17, g1: v + 0.16, b1: v + 0.15,
        a: 0.62 * (1 - k * 0.5), a1: 0, ae: 1.3, se: 1.3, fadeIn: 0.1, drag: 0.3, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.4,
      });
    });
    this.onScorch?.(x, z, Math.max(w, h) * 0.85);
    this.shake = Math.max(this.shake, 0.45);
  }

  muzzle(x: number, y: number, z: number, dirx: number, dirz: number, kind: string) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'bullet':
        this.add.spawn({ x, y, z, life: 0.05, size: 0.34, size1: 0.22, r: 4, g: 2.7, b: 1.3, a: 0.9, a1: 0, tex: TEX.flare });
        break;
      case 'shell': {
        this.add.spawn({ x, y, z, life: 0.07, size: 0.95, size1: 0.6, r: 5, g: 3, b: 1.4, a: 0.9, a1: 0, tex: TEX.flare });
        for (let i = 0; i < 3; i++) {
          const sp = 3 + i * 2;
          this.add.spawn({ x, y, z, vx: dirx * sp + rs(), vy: rs() * 0.5, vz: dirz * sp + rs(), life: 0.1 + i * 0.02, size: 0.42 - i * 0.08, size1: 0.12, r: 3.5, g: 1.6, b: 0.45, a: 0.6, a1: 0, tex: TEX.flame, drag: 10 });
        }
        for (let i = 0; i < 3; i++) {
          this.alpha.spawn({
            x: x + dirx * 0.15, y, z: z + dirz * 0.15, vx: dirx * (0.8 + Math.random()) + rs() * 0.4, vy: 0.25 + Math.random() * 0.2, vz: dirz * (0.8 + Math.random()) + rs() * 0.4,
            life: 0.9 + Math.random() * 0.5, size: 0.25, size1: 0.95, r: 0.55, g: 0.53, b: 0.5, a: 0.38, a1: 0, drag: 2, se: 2, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs(),
          });
        }
        this.flashLight(x, y + 0.3, z, 0xffb060, 3, 0.08, 4);
        break;
      }
      case 'rocket':
      case 'missile':
        this.add.spawn({ x, y, z, life: 0.08, size: 0.55, size1: 0.3, r: 3.5, g: 2, b: 0.8, a: 0.8, a1: 0, tex: TEX.flare });
        for (let i = 0; i < 2; i++) {
          this.alpha.spawn({ x: x - dirx * 0.2, y, z: z - dirz * 0.2, vx: -dirx * 1.5 + rs() * 0.5, vy: 0.3, vz: -dirz * 1.5 + rs() * 0.5, life: 0.9, size: 0.3, size1: 0.9, r: 0.6, g: 0.58, b: 0.55, a: 0.4, a1: 0, drag: 2.2, se: 2, tex: TEX.smoke });
        }
        break;
      case 'artillery':
        this.add.spawn({ x, y, z, life: 0.09, size: 1.2, size1: 0.8, r: 5, g: 2.8, b: 1.1, a: 0.9, a1: 0, tex: TEX.flare });
        for (let i = 0; i < 4; i++) this.smoke(x + dirx * 0.2, y, z + dirz * 0.2, 0.7, 1.4, 0.5, 0.4, 0.4);
        this.flashLight(x, y + 0.3, z, 0xffa050, 4, 0.1, 5);
        break;
      case 'laser':
        this.add.spawn({ x, y, z, life: 0.14, size: 0.55, size1: 0.3, r: 3.5, g: 0.5, b: 0.9, a: 0.8, a1: 0, tex: TEX.glow });
        break;
      case 'railgun':
        this.add.spawn({ x, y, z, life: 0.12, size: 0.7, size1: 0.3, r: 1.5, g: 2.6, b: 5, a: 0.9, a1: 0, tex: TEX.flare });
        break;
      default:
        break;
    }
  }

  impact(x: number, y: number, z: number, kind: string, big: boolean, hitEntity: boolean) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'bullet':
        this.sparks(x, y, z, hitEntity ? 3 : 1, 2.5, 1, 0.8, 0.45);
        if (hitEntity) this.add.spawn({ x, y, z, life: 0.05, size: 0.25, r: 3, g: 2.2, b: 1.2, a: 0.8, a1: 0, tex: TEX.flare });
        else this.dust(x, y, z, 1, 0.3);
        break;
      case 'shell':
        this.explosion(x, y, z, 'small');
        if (!hitEntity) this.dust(x, y, z, 3, 0.7);
        break;
      case 'rocket':
      case 'missile':
        this.explosion(x, y, z, big ? 'medium' : 'small');
        break;
      case 'artillery':
        this.explosion(x, y, z, 'small');
        this.dust(x, y, z, 5, 0.9);
        this.onScorch?.(x, z, 0.7);
        break;
      case 'laser':
        this.add.spawn({ x, y, z, life: 0.2, size: 1.1, size1: 0.5, r: 3.5, g: 0.7, b: 0.6, a: 0.7, a1: 0, tex: TEX.glow });
        this.sparks(x, y, z, 8, 3.5, 1, 0.4, 0.3);
        this.smoke(x, y, z, 0.6, 1.2, 0.2);
        break;
      case 'railgun':
        this.add.spawn({ x, y, z, life: 0.18, size: 1.1, size1: 0.4, r: 1.6, g: 2.6, b: 5, a: 0.8, a1: 0, tex: TEX.glow });
        this.sparks(x, y, z, 12, 4.5, 0.55, 0.8, 1);
        this.ring(x, this.gy(x, z, y), z, 0.9, 0.16, [0.8, 1.4, 3], 0.4, 0.08);
        break;
      case 'flame':
        for (let i = 0; i < 3; i++) this.fire(x + rs() * 0.5, y, z + rs() * 0.5, 0.6, 0.45);
        this.smoke(x, y + 0.3, z, 0.8, 1.4, 0.12, 0.7, 0.35);
        break;
    }
  }

  /** Visual for a weapon discharge between two points. */
  shot(kind: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, weaponId: string) {
    const vis = Math.max(this.visibility(ax, az), this.visibility(bx, bz));
    if (vis < 0.3) return;
    switch (kind) {
      case 'bullet': {
        // short HDR tracer travelling to the target, fading towards its tail
        const t0 = Math.random() * 0.25;
        const mx = ax + (bx - ax) * t0, my = ay + (by - ay) * t0, mz = az + (bz - az) * t0;
        const len = Math.hypot(bx - mx, by - my, bz - mz) || 1;
        this.beam(mx, my, mz, bx, by, bz, 0.055, 4.5, 2.8, 1.2, 0.1, 1, 0.04, { seg: Math.min(0.6, 1.4 / len), tail: 0, fp: 0.5 });
        break;
      }
      case 'laser': {
        if (weaponId === 'obeliskBeam') this.obeliskShot(ax, ay, az, bx, by, bz);
        else if (weaponId === 'beamTank') this.prismShot(ax, ay, az, bx, by, bz);
        else {
          this.beam(ax, ay, az, bx, by, bz, 0.5, 2.4, 0.35, 0.8, 0.3, 0.9, 0.15, { fp: 1.5 });
          this.beam(ax, ay, az, bx, by, bz, 0.12, 5, 3.2, 3.8, 0.22, 1, 0.03, { fp: 1.5 });
          this.flashLight(bx, by + 0.5, bz, 0xff4060, 6, 0.25, 5);
        }
        break;
      }
      case 'railgun': {
        this.beam(ax, ay, az, bx, by, bz, 0.42, 0.6, 1.2, 3.2, 0.38, 0.9, 0.06, { fp: 1.4 });
        this.beam(ax, ay, az, bx, by, bz, 0.09, 6, 7, 8, 0.24, 1, 0.02, { fp: 1.5 });
        // helix of charged particles + lingering vapour trail
        const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
        const n = Math.min(40, Math.floor(len * 5));
        const dx = (bx - ax) / len, dy = (by - ay) / len, dz = (bz - az) / len;
        // basis perpendicular to the beam
        let ux = -dz, uy = 0, uz = dx;
        const ul = Math.hypot(ux, uz) || 1;
        ux /= ul; uz /= ul;
        const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const ph = t * len * 5;
          const c = Math.cos(ph) * 0.12, s = Math.sin(ph) * 0.12;
          const px = ax + (bx - ax) * t + ux * c + vx * s, py = ay + (by - ay) * t + uy * c + vy * s, pz = az + (bz - az) * t + uz * c + vz * s;
          this.add.spawn({ x: px, y: py, z: pz, vx: (ux * c + vx * s) * 2, vy: (uy * c + vy * s) * 2 + 0.1, vz: (uz * c + vz * s) * 2, life: 0.45 + Math.random() * 0.25, size: 0.13, size1: 0.04, r: 1, g: 1.8, b: 3.6, a: 0.8, a1: 0, drag: 2, tex: TEX.spark });
          this.alpha.spawn({ x: px, y: py, z: pz, vx: rs() * 0.2, vy: 0.15, vz: rs() * 0.2, life: 1.3 + Math.random() * 0.6, size: 0.22, size1: 0.75, r: 0.72, g: 0.76, b: 0.82, a: 0.24, a1: 0, drag: 1, se: 1.8, fadeIn: 0.05, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() });
        }
        this.flashLight(bx, by + 0.4, bz, 0x80b0ff, 5, 0.2, 5);
        break;
      }
      case 'flame': {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.ceil(len * 3);
        for (let i = 0; i < n; i++) {
          const t = (i + Math.random()) / n;
          const s = 1.6 + Math.random();
          this.add.spawn({
            x: ax, y: ay, z: az,
            vx: ((bx - ax) / 0.3) * t * 1.0 + rs() * 0.5, vy: ((by - ay) / 0.3) * t + 0.6, vz: ((bz - az) / 0.3) * t * 1.0 + rs() * 0.5,
            life: 0.32 + Math.random() * 0.12, size: 0.2, size1: 0.55 + t * 0.6, r: 3.2, g: 1.6, b: 0.45, r1: 0.9, g1: 0.2, b1: 0.03, a: 0.6, a1: 0, ce: 0.7,
            tex: pick(TEX.flame, TEX.flame2), drag: s, vrot: rs() * 4,
          });
        }
        break;
      }
    }
  }

  /** Obelisk of the Rift: charged red beam with a charge burst at the crystal and crackling arcs. */
  private obeliskShot(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    // charge burst at the emitter
    this.add.spawn({ x: ax, y: ay, z: az, life: 0.35, size: 1.8, size1: 0.4, r: 5, g: 0.6, b: 0.35, a: 0.8, a1: 0, tex: TEX.glow, ce: 0.5 });
    this.add.spawn({ x: ax, y: ay, z: az, life: 0.12, size: 1.4, size1: 1.0, r: 6, g: 3, b: 2.4, a: 0.9, a1: 0, tex: TEX.flare });
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add.spawn({ x: ax + Math.cos(a) * 0.9, y: ay + rs() * 0.8, z: az + Math.sin(a) * 0.9, vx: -Math.cos(a) * 3.5, vy: 0, vz: -Math.sin(a) * 3.5, life: 0.25, size: 0.12, size1: 0.05, r: 5, g: 0.8, b: 0.4, a: 1, a1: 0, tex: TEX.spark });
    }
    // main beam: pulses three times
    for (let k = 0; k < 3; k++) {
      const go = () => {
        const a = 1 - k * 0.25;
        this.beam(ax, ay, az, bx, by, bz, 0.85, 3.2, 0.3, 0.18, 0.32, 0.8 * a, 0.3, { fp: 1.5 });
        this.beam(ax, ay, az, bx, by, bz, 0.18, 7, 3, 2.2, 0.24, a, 0.05, { fp: 1.5 });
      };
      if (k === 0) go();
      else this.later(k * 0.07, go);
    }
    this.lightning(ax, ay, az, bx, by, bz, 0.05, 4, 0.6, 0.4, 0.14, 0.18, false);
    this.later(0.07, () => this.lightning(ax, ay, az, bx, by, bz, 0.04, 4, 0.8, 0.5, 0.12, 0.22, false));
    this.flashLight(bx, by + 0.5, bz, 0xff3020, 8, 0.35, 6);
    this.onScorch?.(bx, bz, 0.5);
  }

  /** Rift Prism tank: white core that refracts into a braided spectrum converging on the target. */
  private prismShot(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l, pz = dx / l;
    this.add.spawn({ x: ax, y: ay, z: az, life: 0.25, size: 1.3, size1: 0.5, r: 3.5, g: 3.5, b: 5, a: 0.8, a1: 0, tex: TEX.flare });
    this.beam(ax, ay, az, bx, by, bz, 0.4, 1.4, 1.6, 3.2, 0.34, 0.7, 0.12, { fp: 1.5 });
    this.beam(ax, ay, az, bx, by, bz, 0.1, 6, 6, 7, 0.26, 1, 0.03, { fp: 1.5 });
    // split point a short way out of the prism; three coloured rays fan out and reconverge on target
    const sx = ax + dx * 0.18, sy = ay + (by - ay) * 0.18, sz = az + dz * 0.18;
    const cols: [number, number, number][] = [[4, 0.5, 1.8], [0.5, 3.2, 3.6], [4, 2.8, 0.4]];
    const offs = [-0.42, 0.42, 0];
    for (let i = 0; i < 3; i++) {
      const o = offs[i], c = cols[i];
      const mx = ax + dx * 0.55 + px * o, my = ay + (by - ay) * 0.55 + (i === 2 ? 0.38 : 0), mz = az + dz * 0.55 + pz * o;
      this.beam(sx, sy, sz, mx, my, mz, 0.1, c[0], c[1], c[2], 0.3, 0.9, 0.04, { fp: 1.5 });
      this.beam(mx, my, mz, bx, by, bz, 0.1, c[0], c[1], c[2], 0.3, 0.9, 0.04, { fp: 1.5 });
    }
    this.add.spawn({ x: sx, y: sy, z: sz, life: 0.2, size: 0.7, size1: 0.3, r: 3, g: 3, b: 4.5, a: 0.8, a1: 0, tex: TEX.glow });
    this.flashLight(bx, by + 0.5, bz, 0xa0c0ff, 6, 0.3, 5);
  }

  /** Per-frame trail for travelling projectiles. */
  projectileTrail(kind: string, x: number, y: number, z: number, px: number, py: number, pz: number) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'shell':
        this.beam(px, py, pz, x, y, z, 0.07, 4, 2.4, 1, 0.06, 0.9, 0.03, { tail: 0.2 });
        break;
      case 'rocket':
      case 'missile':
        this.add.spawn({ x, y, z, life: 0.05, size: 0.38, r: 4, g: 2, b: 0.7, a: 0.8, a1: 0, tex: TEX.glow });
        this.alpha.spawn({ x, y, z, vx: rs() * 0.1, vy: 0.08, vz: rs() * 0.1, life: 0.9 + Math.random() * 0.4, size: 0.2, size1: 0.75, r: 0.62, g: 0.6, b: 0.57, a: 0.4, a1: 0, drag: 0.8, se: 1.6, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() });
        this.beam(px, py, pz, x, y, z, 0.07, 3.5, 1.7, 0.6, 0.05, 0.8, 0.03, { tail: 0.3 });
        break;
      case 'artillery':
        this.add.spawn({ x, y, z, life: 0.05, size: 0.45, r: 4, g: 1.9, b: 0.6, a: 0.8, a1: 0, tex: TEX.glow });
        this.smoke(x, y, z, 0.4, 0.8, 0.55, 0.05, 0.3);
        break;
    }
  }

  /**
   * Damage emitter for units/buildings. level 1 (<66% hp): grey smoke, sparks and small fires.
   * level 2 (<33% hp): thick black smoke and flickering fire.
   */
  damageFx(x: number, y: number, z: number, level: number) {
    if (level <= 0 || this.visibility(x, z) < 0.3) return;
    const x0 = x + rs() * 0.25, z0 = z + rs() * 0.25;
    if (level >= 2) {
      // black smoke column
      const v = 0.045 + Math.random() * 0.035;
      this.alpha.spawn({
        x: x0, y, z: z0, vx: rs() * 0.25 + 0.1, vy: 1.0 + Math.random() * 0.5, vz: rs() * 0.25,
        life: 2.8 + Math.random() * 1.4, size: 0.6, size1: 2.3, r: v, g: v * 0.95, b: v * 0.9, r1: v + 0.13, g1: v + 0.125, b1: v + 0.12,
        a: 0.72, a1: 0, ae: 1.4, se: 1.4, drag: 0.35, fadeIn: 0.1, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.5,
      });
      // flickering fire
      for (let i = 0; i < 2; i++) {
        if (i === 1 && Math.random() < 0.5) break;
        this.add.spawn({
          x: x0 + rs() * 0.2, y: y - 0.1, z: z0 + rs() * 0.2, vx: rs() * 0.2, vy: 0.9 + Math.random() * 0.6, vz: rs() * 0.2,
          life: 0.45 + Math.random() * 0.3, size: 0.5 + Math.random() * 0.3, size1: 0.18, r: 2.8, g: 1.15, b: 0.28, r1: 0.5, g1: 0.08, b1: 0.02, a: 0.6, a1: 0, ce: 0.7, flick: 0.4,
          tex: pick(TEX.flame, TEX.flame2), drag: 0.8, vrot: rs() * 3,
        });
      }
      if (Math.random() < 0.15) this.sparks(x0, y, z0, 3, 1.8, 1, 0.6, 0.25);
    } else {
      // grey smoke wisps
      const v = 0.32 + Math.random() * 0.1;
      this.alpha.spawn({
        x: x0, y, z: z0, vx: rs() * 0.2 + 0.08, vy: 0.7 + Math.random() * 0.4, vz: rs() * 0.2,
        life: 1.8 + Math.random() * 1, size: 0.35, size1: 1.3, r: v, g: v * 0.97, b: v * 0.94, r1: v + 0.1, g1: v + 0.1, b1: v + 0.1,
        a: 0.42, a1: 0, ae: 1.3, se: 1.5, drag: 0.4, fadeIn: 0.12, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.5,
      });
      if (Math.random() < 0.35) this.sparks(x0, y, z0, 2 + Math.floor(Math.random() * 3), 2.2, 1, 0.75, 0.4);
      if (Math.random() < 0.4) {
        this.add.spawn({
          x: x0, y: y - 0.1, z: z0, vx: rs() * 0.15, vy: 0.6 + Math.random() * 0.4, vz: rs() * 0.15,
          life: 0.35 + Math.random() * 0.2, size: 0.32 + Math.random() * 0.15, size1: 0.1, r: 2.6, g: 1.1, b: 0.3, r1: 0.5, g1: 0.1, b1: 0.02, a: 0.55, a1: 0, ce: 0.7, flick: 0.4,
          tex: pick(TEX.flame, TEX.flame2), drag: 0.8, vrot: rs() * 3,
        });
      }
    }
  }

  /** Legacy entry point (EntityViews): heavy = below 25% hp. */
  damageSmoke(x: number, y: number, z: number, heavy: boolean) {
    this.damageFx(x, y, z, heavy ? 2 : 1);
  }

  // ---------------------------------------------------------- superweapons
  /** Ion Strike charge-up (2.2 s): rotating reticle, 8 converging beams, ground arcs. */
  ionStrike(x: number, y: number, z: number, dur = 2.2) {
    const R = 4.2;
    this.marker(1, x, y, z, R, dur + 0.35, (d, dt, t) => {
      const k = Math.min(1, t * (dur + 0.35) / dur);
      d.u.uTime.value += dt * (1.2 + k * 3);
      d.u.uK.value = k;
      const s = R * (1.15 - 0.3 * k);
      d.m.scale.set(s, 1, s);
      (d.u.uColor.value as THREE.Color).setRGB(0.05 + k * 0.15, 0.3 + k * 0.35, 1.2 + k * 1.0);
      d.u.uAlpha.value = Math.min(1, t * 8) * (k >= 1 ? Math.max(0, 1 - (t * (dur + 0.35) - dur) / 0.35) : 0.75);
    });
    let arcT = 0;
    this.run(dur, (t, dt, k) => {
      const rot = t * 0.8 + k * k * 2.5;
      const rg = 4.2 * (1 - k * k) + 0.12;
      const life = Math.max(dt, this.frameDt) * 1.5;
      const a = 0.35 + 0.55 * k;
      for (let i = 0; i < 8; i++) {
        const ang = rot + (i * Math.PI) / 4;
        const tx = x + Math.cos(ang) * 7, tz = z + Math.sin(ang) * 7;
        const gx = x + Math.cos(ang) * rg, gz = z + Math.sin(ang) * rg;
        this.beam(tx, y + 28, tz, gx, y + 0.1, gz, 0.35, 0.15, 0.45, 1.8, life, a, 0.35, { fp: 0 });
        this.beam(tx, y + 28, tz, gx, y + 0.1, gz, 0.08, 1.2, 2.2, 4.5, life, a, 0.08, { fp: 0 });
        if (Math.random() < dt * 8) this.add.spawn({ x: gx, y: y + 0.15, z: gz, vy: 0.4, life: 0.25, size: 0.6, size1: 0.2, r: 1, g: 1.8, b: 4, a: 0.7, a1: 0, tex: TEX.glow });
      }
      // centre energy build-up
      if (Math.random() < dt * 20) {
        const ang = Math.random() * Math.PI * 2, r0 = 1.5 + Math.random() * 2.5;
        this.add.spawn({ x: x + Math.cos(ang) * r0, y: y + 0.2, z: z + Math.sin(ang) * r0, vx: -Math.cos(ang) * r0 * 1.6, vy: 0.5, vz: -Math.sin(ang) * r0 * 1.6, life: 0.55, size: 0.12, size1: 0.05, r: 1.5, g: 2.5, b: 5, a: 1, a1: 0, tex: TEX.spark });
      }
      if (Math.random() < dt * 10) this.add.spawn({ x, y: y + 0.3, z, life: 0.25, size: 0.8 + k * 2.2, size1: 0.5, r: 0.6, g: 1.1, b: 2.6, a: 0.35 + k * 0.3, a1: 0, tex: TEX.glow });
      // ground arcs between the beam footprints and the centre
      arcT -= dt;
      if (arcT <= 0) {
        arcT = 0.12 - k * 0.07;
        const ang = rot + Math.floor(Math.random() * 8) * (Math.PI / 4);
        this.lightning(x + Math.cos(ang) * rg, y + 0.15, z + Math.sin(ang) * rg, x + rs() * 0.4, y + 0.2, z + rs() * 0.4, 0.04, 0.6, 1.4, 4, 0.12, 0.4, rg > 1.5);
      }
      if (Math.random() < dt * 4) this.flashLight(x, y + 1.5, z, 0x6090ff, 2 + 5 * k, 0.3, 10);
    });
  }

  ionImpact(x: number, y: number, z: number) {
    this.screenFlash(0.4, 0.6, 0.8, 1.0);
    // HDR column: outer glow, bright body, white-hot core
    this.beam(x, y + 60, z, x, y, z, 3.4, 0.5, 1.0, 3.0, 1.1, 1, 0.4, { fp: 1.6 });
    this.beam(x, y + 60, z, x, y, z, 1.3, 2.4, 3.6, 7, 0.85, 1, 0.12, { fp: 1.4 });
    this.beam(x, y + 60, z, x, y, z, 0.4, 8, 8, 10, 0.55, 1, 0.05, { fp: 1.2 });
    for (let i = 0; i < 10; i++) this.add.spawn({ x: x + rs() * 0.6, y: y + 1 + i * 2.2, z: z + rs() * 0.6, vy: 2, life: 0.5 + Math.random() * 0.3, size: 2.4, size1: 0.8, r: 0.5, g: 0.9, b: 2.4, a: 0.35, a1: 0, tex: TEX.glow });
    // plasma burst hugging the ground
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 5 + Math.random() * 3;
      this.add.spawn({
        x, y: y + 0.4, z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random(), vz: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.3, size: 1.5, size1: 0.5,
        r: 1.2, g: 2.2, b: 5, r1: 0.15, g1: 0.25, b1: 0.8, a: 0.5, a1: 0, ce: 0.6, drag: 3, tex: pick(TEX.flame, TEX.flame2), vrot: rs() * 3,
      });
    }
    this.add.spawn({ x, y: y + 0.6, z, life: 0.3, size: 6, size1: 8, r: 2, g: 3, b: 6, a: 0.5, a1: 0, tex: TEX.glow, ce: 0.5 });
    // shock rings
    this.ring(x, y, z, 7.5, 0.55, [0.8, 1.5, 3.4], 0.6, 0.35);
    this.later(0.07, () => this.ring(x, y, z, 4.5, 0.35, [2.5, 3, 4], 0.45, 0.18));
    // ground lightning arcs radiating out
    for (let k = 0; k < 5; k++) {
      this.later(k * 0.11, () => {
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, r1 = 2.5 + Math.random() * 3.5;
          this.lightning(x, y + 0.2, z, x + Math.cos(a) * r1, y + 0.15, z + Math.sin(a) * r1, 0.05, 0.6, 1.4, 4.5, 0.16, 0.45);
        }
      });
    }
    this.sparks(x, y + 0.3, z, 50, 9, 0.6, 0.8, 1);
    this.debris(x, y + 0.3, z, 16, 5, 0.1, 1.4, 0.2);
    // aftermath: blue-grey smoke and lingering motes (no orange fireball)
    this.later(0.25, () => {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, r0 = Math.random() * 1.8;
        this.alpha.spawn({
          x: x + Math.cos(a) * r0, y: y + 0.4 + Math.random(), z: z + Math.sin(a) * r0, vx: Math.cos(a) * 0.6, vy: 1 + Math.random() * 0.8, vz: Math.sin(a) * 0.6,
          life: 4 + Math.random() * 2, size: 1.4, size1: 4, r: 0.12, g: 0.13, b: 0.16, r1: 0.4, g1: 0.42, b1: 0.47, a: 0.6, a1: 0, ae: 1.3, se: 1.5, drag: 0.4, fadeIn: 0.1,
          tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.4,
        });
      }
    });
    this.emit(3, (k) => 18 * (1 - k), () => {
      const a = Math.random() * Math.PI * 2, r0 = Math.random() * 3;
      this.add.spawn({ x: x + Math.cos(a) * r0, y: y + 0.2, z: z + Math.sin(a) * r0, vy: 1 + Math.random() * 1.5, life: 1 + Math.random(), size: 0.12, size1: 0.04, r: 1.4, g: 2.4, b: 5, a: 1, a1: 0, tex: TEX.spark, flick: 0.4 });
    });
    this.flashLight(x, y + 3, z, 0x80b0ff, 10, 1.2, 20);
    this.shake = 1.1;
    this.onScorch?.(x, z, 3.8);
  }

  private getMissile(): THREE.Group {
    if (this.missileMesh) return this.missileMesh;
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x220a10, emissive: new THREE.Color(1.0, 0.08, 0.1), emissiveIntensity: 1.2 });
    const rift = new THREE.MeshStandardMaterial({ color: 0x100818, emissive: new THREE.Color(0.7, 0.2, 1.4), emissiveIntensity: 3 });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.7, 10), body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 10), accent);
    nose.position.y = 1.15;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.14, 10), rift);
    band.position.y = 0.45;
    g.add(cyl, nose, band);
    const finGeo = new THREE.BoxGeometry(0.04, 0.5, 0.36);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(finGeo, body);
      const a = (i * Math.PI) / 2;
      f.position.set(Math.cos(a) * 0.24, -0.62, Math.sin(a) * 0.24);
      f.rotation.y = -a;
      g.add(f);
    }
    g.scale.setScalar(1.25);
    g.visible = false;
    this.group.add(g);
    this.missileMesh = g;
    return g;
  }

  /**
   * Rift Missile flight (launch → impact in `dur` s): pulsing target marker, missile body rising out of
   * the silo on an exhaust plume, then diving on the target. Impact itself is `nukeImpact`.
   */
  riftMissile(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, dur = 5.5) {
    const m = this.getMissile();
    const R = 4.5;
    this.marker(2, tx, ty, tz, R, dur + 0.1, (d, dt, t) => {
      const k = t;
      d.u.uTime.value += dt * (0.8 + k * k * 3.5);
      (d.u.uColor.value as THREE.Color).setRGB(1.8, 0.1, 0.06);
      d.u.uAlpha.value = Math.min(1, t * 10) * (0.3 + 0.35 * k);
    });
    // launch plume at the silo
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2;
      this.alpha.spawn({ x: sx, y: sy + 0.3, z: sz, vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.8, vz: Math.sin(a) * sp, life: 3 + Math.random() * 1.5, size: 1, size1: 3, r: 0.55, g: 0.52, b: 0.5, a: 0.5, a1: 0, drag: 1.2, se: 2, fadeIn: 0.05, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.4 });
    }
    this.flashLight(sx, sy + 2, sz, 0xffa060, 8, 0.8, 10);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const p = new THREE.Vector3(), prev = new THREE.Vector3(sx, sy, sz);
    // dive start point: high above, offset back towards the silo and "up-screen"
    let ddx = sx - tx, ddz = sz - tz;
    const dl = Math.hypot(ddx, ddz) || 1;
    ddx /= dl; ddz /= dl;
    const dsx = tx + ddx * 8, dsy = ty + 42, dsz = tz + ddz * 8 - 9;
    const k1 = 0.34, k2 = 0.56;
    const posAt = (k: number, out: THREE.Vector3) => {
      if (k < k1) {
        const u = k / k1;
        return out.set(sx + ddx * -u * u * 3, sy + 0.5 + u * u * 46, sz + ddz * -u * u * 3);
      }
      const u = Math.max(0, (k - k2) / (1 - k2));
      const e = u * u * (0.35 + 0.65 * u);
      return out.set(dsx + (tx - dsx) * e, dsy + (ty - dsy) * e, dsz + (tz - dsz) * e);
    };
    let started = false;
    this.run(dur, (_t, _dt, k) => {
      const hidden = k >= k1 && k < k2;
      m.visible = !hidden && k < 0.995;
      if (hidden) {
        started = false;
        return;
      }
      posAt(k, p);
      posAt(Math.min(1, k + 0.004), dir);
      dir.sub(p);
      if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
      dir.normalize();
      m.position.copy(p);
      m.quaternion.setFromUnitVectors(up, dir);
      if (!started) {
        prev.copy(p).addScaledVector(dir, -0.3);
        started = true;
      }
      // exhaust + trail, interpolated along the path so fast segments stay continuous
      const tail = p.clone().addScaledVector(dir, -1.2);
      const ptail = prev.clone().addScaledVector(dir, -1.2);
      const dist = tail.distanceTo(ptail);
      const n = Math.min(10, Math.max(1, Math.ceil(dist / 0.35)));
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        const qx = ptail.x + (tail.x - ptail.x) * f, qy = ptail.y + (tail.y - ptail.y) * f, qz = ptail.z + (tail.z - ptail.z) * f;
        this.alpha.spawn({ x: qx + rs() * 0.1, y: qy, z: qz + rs() * 0.1, vx: rs() * 0.4, vy: rs() * 0.3, vz: rs() * 0.4, life: 2.2 + Math.random() * 1.4, size: 0.5, size1: 2.0, r: 0.6, g: 0.57, b: 0.56, a: 0.5, a1: 0, drag: 0.8, se: 1.8, fadeIn: 0.04, tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.5 });
        if (i % 2 === 0) this.add.spawn({ x: qx, y: qy, z: qz, vx: -dir.x * 3 + rs(), vy: -dir.y * 3 + rs(), vz: -dir.z * 3 + rs(), life: 0.22, size: 0.9, size1: 0.3, r: 3.5, g: 1.6, b: 0.5, r1: 0.8, g1: 0.2, b1: 0.05, a: 0.6, a1: 0, ce: 0.6, drag: 3, tex: pick(TEX.flame, TEX.flame2), vrot: rs() * 3 });
      }
      this.add.spawn({ x: tail.x, y: tail.y, z: tail.z, life: 0.05, size: 1.1, r: 5, g: 3, b: 1.6, a: 0.8, a1: 0, tex: TEX.flare });
      this.beam(ptail.x, ptail.y, ptail.z, tail.x, tail.y, tail.z, 0.3, 3, 1.4, 0.5, 0.12, 0.8, 0.1);
      prev.copy(p);
    });
    this.later(dur + 0.05, () => (m.visible = false));
  }

  nukeImpact(x: number, y: number, z: number) {
    const q = this.quality >= 2 ? 1 : 0.6;
    this.screenFlash(0.6, 1.0, 0.85, 0.7);
    if (this.missileMesh) this.missileMesh.visible = false;
    // HDR fireball
    this.add.spawn({ x, y: y + 1, z, life: 0.4, size: 8, size1: 11, r: 5, g: 3.6, b: 2.2, a: 0.55, a1: 0, tex: TEX.glow, ce: 0.5 });
    for (let i = 0; i < 20 * q; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = 2.5 + Math.random() * 3.5;
      this.add.spawn({
        x, y: y + 0.6, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1.8, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 1.2 + Math.random() * 0.7, size: 2.4 + Math.random(), size1: 1.1, r: 4, g: 1.9, b: 0.55, r1: 0.7, g1: 0.14, b1: 0.03, a: 0.5, a1: 0, ce: 0.6, drag: 1.8,
        tex: pick(TEX.flame, TEX.flame2), vrot: rs() * 2,
      });
    }
    // the fireball rises into the cap
    this.emit(1.8, (k) => 34 * (1 - k * 0.6) * q, (k) => {
      const hgt = y + 1 + 5.2 * (1 - (1 - k) * (1 - k));
      const a = Math.random() * Math.PI * 2, r0 = Math.random() * (1 + k * 1.5);
      this.add.spawn({
        x: x + Math.cos(a) * r0, y: hgt + rs(), z: z + Math.sin(a) * r0, vx: Math.cos(a) * 0.8, vy: 1.5, vz: Math.sin(a) * 0.8,
        life: 0.8 + Math.random() * 0.5, size: 2.2 - k * 0.6, size1: 0.8, r: 3.6 - k * 1.2, g: 1.5 - k * 0.6, b: 0.4, r1: 0.6, g1: 0.1, b1: 0.03, a: 0.45, a1: 0, ce: 0.6, drag: 1,
        tex: pick(TEX.flame, TEX.flame2), vrot: rs() * 2,
      });
    });
    // rings: warm shockwave + violet Rift wave
    this.ring(x, y, z, 10, 0.7, [2.2, 1.6, 1.0], 0.55, 0.45);
    this.later(0.12, () => this.ring(x, y, z, 7, 0.6, [1.6, 0.4, 2.8], 0.55, 0.3));
    // base surge
    for (let i = 0; i < 36 * q; i++) {
      const a = (i / (36 * q)) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 6 + Math.random() * 2.5;
      this.alpha.spawn({
        x: x + Math.cos(a) * 0.8, y: y + 0.4, z: z + Math.sin(a) * 0.8, vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.3, vz: Math.sin(a) * sp,
        life: 3 + Math.random() * 1.5, size: 1.5, size1: 4, r: 0.36, g: 0.32, b: 0.28, r1: 0.5, g1: 0.47, b1: 0.44, a: 0.55, a1: 0, ae: 1.3, se: 1.6, drag: 1.1, fadeIn: 0.04,
        tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.4,
      });
    }
    // stem: dark smoke column rising and decelerating into the cap
    this.emit(3.2, (k) => 26 * (1 - k * 0.5) * q, (k) => {
      const a = Math.random() * Math.PI * 2, r0 = Math.random() * 0.8;
      this.alpha.spawn({
        x: x + Math.cos(a) * r0, y: y + 0.8, z: z + Math.sin(a) * r0, vx: Math.cos(a) * 0.2, vy: 4.2 + Math.random() * 1.0, vz: Math.sin(a) * 0.2,
        life: 5 + Math.random() * 1.5, size: 1.1, size1: 2.2, r: 0.1, g: 0.085, b: 0.08, r1: 0.3, g1: 0.28, b1: 0.27, a: 0.75 * (1 - k * 0.3), a1: 0, ae: 1.5, drag: 0.68, fadeIn: 0.06,
        tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.4,
      });
    });
    // cap: compact billowing dome/torus at the top of the stem, with a thin glowing violet Rift rim
    this.later(0.35, () => {
      this.emit(3.4, (k) => 26 * (1 - k * 0.5) * q, (k) => {
        const dome = Math.random() < 0.3;
        const a = Math.random() * Math.PI * 2;
        const r0 = dome ? Math.random() * 1.2 : 1.1 + Math.random() * 0.8 + k * 1.0;
        const sp = dome ? 0.25 : 0.5 + Math.random() * 0.8;
        const v = 0.1 + Math.random() * 0.05;
        this.alpha.spawn({
          x: x + Math.cos(a) * r0, y: y + 5.8 + (dome ? 0.8 : 0) + Math.random() * 0.6 + k * 0.6, z: z + Math.sin(a) * r0,
          vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * 0.2, vz: Math.sin(a) * sp,
          life: 6 + Math.random() * 1.6, size: 1.8, size1: 3.6, r: v, g: v * 0.88, b: v * 0.9, r1: 0.3, g1: 0.28, b1: 0.3, a: 0.85, a1: 0, ae: 1.6, se: 1.5, drag: 0.6, fadeIn: 0.05,
          tex: pick(TEX.smoke, TEX.smoke2), vrot: rs() * 0.3,
        });
      });
      this.emit(3.0, (k) => 36 * (1 - k * 0.6) * q, (k) => {
        const a = Math.random() * Math.PI * 2, rr = 2.5 + k * 1.6 + Math.random() * 0.3;
        this.add.spawn({
          x: x + Math.cos(a) * rr, y: y + 6 + Math.random() * 0.5 + k * 0.6, z: z + Math.sin(a) * rr, vx: Math.cos(a) * 0.45, vy: 0.2, vz: Math.sin(a) * 0.45,
          life: 1 + Math.random() * 0.5, size: 0.8, size1: 1.3, r: 1.3, g: 0.25, b: 2.4, r1: 0.5, g1: 0.05, b1: 1.0, a: 0.22, a1: 0, fadeIn: 0.25, tex: TEX.glow,
        });
      });
    });
    // violet Rift arcs crackling through the cloud
    for (let k = 0; k < 6; k++) {
      this.later(0.5 + k * 0.35, () => {
        const a = Math.random() * Math.PI * 2, a2 = a + 1 + Math.random() * 2;
        const h = y + 5 + Math.random() * 2;
        this.lightning(x + Math.cos(a) * 2.5, h, z + Math.sin(a) * 2.5, x + Math.cos(a2) * 3, h + rs() * 2, z + Math.sin(a2) * 3, 0.06, 2.6, 0.7, 4.5, 0.18, 0.4);
      });
    }
    // secondary blasts and debris
    for (let k = 0; k < 6; k++) {
      this.later(0.15 + k * 0.13, () => {
        const a = Math.random() * Math.PI * 2, r0 = 2 + Math.random() * 2.5;
        this.blast(x + Math.cos(a) * r0, y + 0.3, z + Math.sin(a) * r0, 0.85, 8, 8, 4, 2, 2, { ring: false, light: false });
      });
    }
    this.debris(x, y + 0.5, z, Math.round(30 * q), 7, 0.1, 1.8, 0.5);
    this.sparks(x, y + 0.5, z, Math.round(40 * q), 10, 1, 0.6, 0.25);
    this.flashLight(x, y + 4, z, 0xffb070, 10, 2, 30);
    this.shake = 1.5;
    this.onScorch?.(x, z, 5);
  }

  /** Legacy: one frame of the Rift missile exhaust (superseded by riftMissile()). */
  missileTrail(x: number, y: number, z: number) {
    this.add.spawn({ x, y, z, life: 0.06, size: 1.2, r: 5, g: 3, b: 1.6, a: 0.8, a1: 0, tex: TEX.flare });
    this.smoke(x, y, z, 1.2, 3, 0.6, 0.1, 0.5);
    this.fire(x, y, z, 0.8, 0.3);
  }

  harvestSparkle(x: number, y: number, z: number, rich: boolean) {
    if (this.visibility(x, z) < 0.3) return;
    const c = rich ? [1.2, 0.8, 2.4] : [0.6, 2.2, 1.5];
    this.add.spawn({ x: x + rs() * 0.6, y: y + 0.2, z: z + rs() * 0.6, vy: 0.8, life: 0.6, size: 0.18, size1: 0.05, r: c[0], g: c[1], b: c[2], a: 1, a1: 0, tex: TEX.spark, gravity: -0.5 });
    this.dust(x, y, z, 1, 0.5, [0.4, 0.38, 0.3]);
  }

  crush(x: number, y: number, z: number) {
    this.dust(x, y, z, 4, 0.4, [0.45, 0.35, 0.28]);
  }

  construction(x: number, y: number, z: number, w: number, h: number) {
    for (let i = 0; i < 2; i++) {
      this.dust(x + rs() * w, y, z + rs() * h, 1, 0.8);
    }
    if (Math.random() < 0.3) this.sparks(x + rs() * w, y + Math.random() * 1.2, z + rs() * h, 3, 1.5, 1, 0.9, 0.5);
  }
}
