import * as THREE from 'three';

// ============================================================ particle atlas
function makeAtlas(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const ctx = c.getContext('2d')!;
  // 0: soft glow
  {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // 1: smoke puff (noisy blob)
  {
    const ox = S, oy = 0;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * S * 0.22;
      const x = ox + S / 2 + Math.cos(a) * r, y = oy + S / 2 + Math.sin(a) * r;
      const rr = S * (0.16 + Math.random() * 0.14);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 2: spark / star
  {
    const ox = 0, oy = S;
    const g = ctx.createRadialGradient(ox + S / 2, oy + S / 2, 0, ox + S / 2, oy + S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, S, S);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ox + S / 2, oy + 8);
    ctx.lineTo(ox + S / 2, oy + S - 8);
    ctx.moveTo(ox + 8, oy + S / 2);
    ctx.lineTo(ox + S - 8, oy + S / 2);
    ctx.stroke();
  }
  // 3: debris chunk
  {
    const ox = S, oy = S;
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = S * (0.22 + Math.random() * 0.18);
      const x = ox + S / 2 + Math.cos(a) * r, y = oy + S / 2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  float tx = mod(vTex, 2.0), ty = floor(vTex / 2.0);
  vec2 uv = (vec2(tx, 1.0 - ty) + vec2(p.x, 1.0 - p.y) - vec2(0.0, 1.0)) * 0.5;
  uv = vec2((tx + p.x) * 0.5, 1.0 - (ty + p.y) * 0.5);
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

  spawn(p: PInit) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    this.life[i] = 0;
    this.maxLife[i] = p.life;
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    this.c0[i * 4] = p.r;
    this.c0[i * 4 + 1] = p.g;
    this.c0[i * 4 + 2] = p.b;
    this.c0[i * 4 + 3] = p.a ?? 1;
    this.c1[i * 4] = p.r1 ?? p.r;
    this.c1[i * 4 + 1] = p.g1 ?? p.g;
    this.c1[i * 4 + 2] = p.b1 ?? p.b;
    this.c1[i * 4 + 3] = p.a1 ?? 0;
    this.phys[i * 4] = p.gravity ?? 0;
    this.phys[i * 4 + 1] = p.drag ?? 0;
    this.phys[i * 4 + 2] = p.vrot ?? 0;
    this.phys[i * 4 + 3] = p.fadeIn ?? 0;
    this.rot[i] = p.rot ?? Math.random() * Math.PI * 2;
    this.tex[i] = p.tex ?? 0;
    this.size[i] = p.size;
  }

  update(dt: number) {
    let n = this.count;
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
      const g = this.phys[i * 4], drag = this.phys[i * 4 + 1];
      const i3 = i * 3;
      this.vel[i3 + 1] -= g * dt;
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * dt);
        this.vel[i3] *= f;
        this.vel[i3 + 1] *= f;
        this.vel[i3 + 2] *= f;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (g > 0 && this.pos[i3 + 1] < -0.2) {
        this.pos[i3 + 1] = -0.2;
        this.vel[i3] *= 0.5;
        this.vel[i3 + 2] *= 0.5;
        this.vel[i3 + 1] = 0;
      }
      this.rot[i] += this.phys[i * 4 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const i4 = i * 4;
      const fi = this.phys[i4 + 3];
      const fade = fi > 0 && t < fi ? t / fi : 1;
      this.col[i4] = this.c0[i4] + (this.c1[i4] - this.c0[i4]) * t;
      this.col[i4 + 1] = this.c0[i4 + 1] + (this.c1[i4 + 1] - this.c0[i4 + 1]) * t;
      this.col[i4 + 2] = this.c0[i4 + 2] + (this.c1[i4 + 2] - this.c0[i4 + 2]) * t;
      this.col[i4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * t) * fade;
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
    }
    this.size[to] = this.size[from];
    this.rot[to] = this.rot[from];
    this.tex[to] = this.tex[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
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
  float core = pow(1.0 - d, 2.2);
  float hot = pow(1.0 - d, 8.0);
  gl_FragColor = vec4(vColor.rgb * core + vec3(hot) * 0.8, vColor.a * core);
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
      const a = b.a * (1 - t);
      // side vector = normalize(cross(dir, toCam))
      const dx = b.bx - b.ax, dy = b.by - b.ay, dz = b.bz - b.az;
      const mx = (b.ax + b.bx) / 2 - cp.x, my = (b.ay + b.by) / 2 - cp.y, mz = (b.az + b.bz) / 2 - cp.z;
      let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / sl) * w;
      sy = (sy / sl) * w;
      sz = (sz / sl) * w;
      const o = n * 12;
      this.pos[o] = b.ax - sx; this.pos[o + 1] = b.ay - sy; this.pos[o + 2] = b.az - sz;
      this.pos[o + 3] = b.ax + sx; this.pos[o + 4] = b.ay + sy; this.pos[o + 5] = b.az + sz;
      this.pos[o + 6] = b.bx - sx; this.pos[o + 7] = b.by - sy; this.pos[o + 8] = b.bz - sz;
      this.pos[o + 9] = b.bx + sx; this.pos[o + 10] = b.by + sy; this.pos[o + 11] = b.bz + sz;
      for (let k = 0; k < 4; k++) {
        const c = n * 16 + k * 4;
        this.col[c] = b.r;
        this.col[c + 1] = b.g;
        this.col[c + 2] = b.b;
        this.col[c + 3] = a;
      }
      n++;
    }
    this.beams = out;
    this.geo.setDrawRange(0, n * 6);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ============================================================ effects manager
export type ExplosionSize = 'small' | 'medium' | 'large' | 'huge' | 'infantry';

interface Delayed {
  t: number;
  fn: () => void;
}

export class Effects {
  group = new THREE.Group();
  private add: ParticleSystem;
  private alpha: ParticleSystem;
  private beams: BeamBatch;
  private lights: { l: THREE.PointLight; life: number; max: number; i0: number }[] = [];
  private rings: { m: THREE.Mesh; life: number; max: number; r0: number; r1: number }[] = [];
  private delayed: Delayed[] = [];
  shake = 0;
  /** returns fog visibility (0..1) at position; effects hidden in shroud */
  visibility: (x: number, z: number) => number = () => 1;
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
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 9;
      this.group.add(m);
      this.rings.push({ m, life: 1, max: 1, r0: 0, r1: 1 });
    }
  }

  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.scale = s;
    this.alpha.scale = s;
  }

  get particleCount() {
    return this.add.active + this.alpha.active;
  }

  update(dt: number, cam: THREE.Camera) {
    for (const d of this.delayed) d.t -= dt;
    const due = this.delayed.filter((d) => d.t <= 0);
    this.delayed = this.delayed.filter((d) => d.t > 0);
    for (const d of due) d.fn();
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
      const r = R.r0 + (R.r1 - R.r0) * (1 - (1 - t) * (1 - t));
      R.m.scale.set(r, 1, r);
      (R.m.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - t) * (1 - t);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  later(t: number, fn: () => void) {
    this.delayed.push({ t, fn });
  }

  flashLight(x: number, y: number, z: number, color: number, intensity: number, dur: number, dist = 7) {
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

  ring(x: number, y: number, z: number, r1: number, dur: number, color = 0xffd8a0) {
    const R = this.rings.find((r) => !r.m.visible) ?? this.rings[0];
    R.m.visible = true;
    R.m.position.set(x, y + 0.08, z);
    (R.m.material as THREE.MeshBasicMaterial).color.setHex(color);
    R.life = 0;
    R.max = dur;
    R.r0 = 0.2;
    R.r1 = r1;
  }

  // ---------------------------------------------------------- primitives
  glow(x: number, y: number, z: number, size: number, r: number, g: number, b: number, life: number, a = 1) {
    this.add.spawn({ x, y, z, life, size, size1: size * 0.6, r, g, b, a, a1: 0, tex: 0 });
  }

  smoke(x: number, y: number, z: number, size: number, life: number, dark = 0.3, rise = 0.6, a = 0.55) {
    const v = dark;
    this.alpha.spawn({
      x, y, z, vx: (Math.random() - 0.5) * 0.3, vy: rise * (0.6 + Math.random() * 0.8), vz: (Math.random() - 0.5) * 0.3,
      life, size: size * 0.5, size1: size * 1.6, r: v, g: v, b: v, r1: v * 1.3, g1: v * 1.3, b1: v * 1.3, a, a1: 0, drag: 0.5, tex: 1, vrot: (Math.random() - 0.5) * 0.8, fadeIn: 0.1,
    });
  }

  fire(x: number, y: number, z: number, size: number, life: number) {
    this.add.spawn({
      x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.4,
      life, size, size1: size * 0.4, r: 1, g: 0.62, b: 0.2, r1: 0.8, g1: 0.2, b1: 0.05, a: 0.9, a1: 0, tex: 1, vrot: 1.5, drag: 0.5,
    });
  }

  sparks(x: number, y: number, z: number, n: number, speed: number, r = 1, g = 0.8, b = 0.4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add.spawn({
        x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1, vz: Math.sin(a) * Math.cos(e) * s,
        life: 0.3 + Math.random() * 0.4, size: 0.12, size1: 0.04, r, g, b, a: 1, a1: 0, gravity: 9, drag: 1, tex: 2,
      });
    }
  }

  debris(x: number, y: number, z: number, n: number, speed: number, c = 0.18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.alpha.spawn({
        x, y, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * speed * 1.5, vz: Math.sin(a) * s,
        life: 0.8 + Math.random() * 0.6, size: 0.12 + Math.random() * 0.1, r: c, g: c * 0.95, b: c * 0.9, a: 1, a1: 0.8, gravity: 11, tex: 3, vrot: (Math.random() - 0.5) * 12,
      });
    }
  }

  dust(x: number, y: number, z: number, n: number, size: number, col: [number, number, number] = [0.55, 0.48, 0.38]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.2;
      this.alpha.spawn({
        x: x + Math.cos(a) * 0.1, y: y + 0.05, z: z + Math.sin(a) * 0.1, vx: Math.cos(a) * s, vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a) * s,
        life: 0.9 + Math.random() * 0.6, size: size * 0.5, size1: size * 1.5, r: col[0], g: col[1], b: col[2], a: 0.5, a1: 0, drag: 2.5, tex: 1, vrot: (Math.random() - 0.5),
      });
    }
  }

  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number, life: number, a = 1, w1?: number) {
    this.beams.add({ ax, ay, az, bx, by, bz, w0: width, w1: w1 ?? width, r, g, b, a, life: 0, maxLife: life });
  }

  // ---------------------------------------------------------- composite effects
  explosion(x: number, y: number, z: number, size: ExplosionSize) {
    if (this.visibility(x, z) < 0.3) return;
    const q = this.quality >= 2 ? 1 : 0.5;
    switch (size) {
      case 'infantry':
        this.dust(x, y, z, 5, 0.5, [0.45, 0.38, 0.3]);
        this.sparks(x, y + 0.2, z, 3, 2, 1, 0.3, 0.2);
        break;
      case 'small':
        this.glow(x, y + 0.2, z, 1.4, 1, 0.7, 0.35, 0.15, 0.7);
        for (let i = 0; i < 8 * q; i++) this.fire(x + (Math.random() - 0.5) * 0.4, y + 0.1 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.4, 0.4 + Math.random() * 0.3);
        for (let i = 0; i < 5 * q; i++) this.smoke(x, y + 0.3, z, 0.9, 1.4 + Math.random(), 0.22);
        this.sparks(x, y + 0.2, z, 10 * q, 4);
        this.debris(x, y + 0.2, z, 4 * q, 2.5);
        this.flashLight(x, y + 0.8, z, 0xffa050, 6, 0.25);
        break;
      case 'medium':
        this.glow(x, y + 0.3, z, 2.2, 1, 0.72, 0.38, 0.2, 0.75);
        for (let i = 0; i < 16 * q; i++) this.fire(x + (Math.random() - 0.5) * 0.7, y + 0.1 + Math.random() * 0.5, z + (Math.random() - 0.5) * 0.7, 0.8 + Math.random() * 0.6, 0.5 + Math.random() * 0.4);
        for (let i = 0; i < 10 * q; i++) this.smoke(x + (Math.random() - 0.5) * 0.5, y + 0.4, z + (Math.random() - 0.5) * 0.5, 1.3, 2 + Math.random() * 1.5, 0.18);
        this.sparks(x, y + 0.3, z, 18 * q, 5);
        this.debris(x, y + 0.3, z, 10 * q, 3.5);
        this.flashLight(x, y + 1, z, 0xff9040, 10, 0.35, 9);
        this.ring(x, y, z, 2.2, 0.45);
        this.onScorch?.(x, z, 0.9);
        this.shake = Math.max(this.shake, 0.12);
        break;
      case 'large':
        this.glow(x, y + 0.4, z, 3.6, 1, 0.75, 0.4, 0.28, 0.8);
        for (let i = 0; i < 28 * q; i++) this.fire(x + (Math.random() - 0.5) * 1.1, y + 0.1 + Math.random() * 0.9, z + (Math.random() - 0.5) * 1.1, 1.1 + Math.random() * 0.8, 0.6 + Math.random() * 0.5);
        for (let i = 0; i < 18 * q; i++) this.smoke(x + (Math.random() - 0.5), y + 0.6, z + (Math.random() - 0.5), 1.8, 2.5 + Math.random() * 2, 0.15, 0.8);
        this.sparks(x, y + 0.4, z, 30 * q, 6);
        this.debris(x, y + 0.4, z, 16 * q, 4.5);
        this.flashLight(x, y + 1.3, z, 0xff8a30, 16, 0.5, 12);
        this.ring(x, y, z, 3.5, 0.6);
        this.onScorch?.(x, z, 1.5);
        this.shake = Math.max(this.shake, 0.3);
        break;
      case 'huge': {
        this.explosion(x, y, z, 'large');
        for (let k = 0; k < 5; k++) {
          this.later(0.15 + k * 0.18, () => {
            const ox = x + (Math.random() - 0.5) * 2, oz = z + (Math.random() - 0.5) * 2;
            this.explosion(ox, y, oz, 'medium');
          });
        }
        for (let i = 0; i < 20 * q; i++) this.smoke(x + (Math.random() - 0.5) * 2, y + 1, z + (Math.random() - 0.5) * 2, 2.6, 4 + Math.random() * 3, 0.12, 1.1, 0.6);
        this.onScorch?.(x, z, 2.4);
        this.shake = Math.max(this.shake, 0.5);
        break;
      }
    }
  }

  muzzle(x: number, y: number, z: number, dirx: number, dirz: number, kind: string) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'bullet':
        this.glow(x, y, z, 0.45, 1, 0.85, 0.5, 0.06);
        break;
      case 'shell':
        this.glow(x, y, z, 1.1, 1, 0.8, 0.45, 0.09);
        for (let i = 0; i < 3; i++) this.smoke(x + dirx * 0.1, y, z + dirz * 0.1, 0.5, 0.8, 0.5, 0.3, 0.4);
        this.flashLight(x, y + 0.3, z, 0xffb060, 3, 0.1, 5);
        break;
      case 'rocket':
      case 'missile':
        this.glow(x, y, z, 0.7, 1, 0.7, 0.35, 0.1);
        this.smoke(x, y, z, 0.5, 0.8, 0.6, 0.2, 0.4);
        break;
      case 'artillery':
        this.glow(x, y, z, 1, 1, 0.65, 0.3, 0.12);
        for (let i = 0; i < 4; i++) this.smoke(x, y, z, 0.7, 1.4, 0.55, 0.4, 0.4);
        break;
      case 'laser':
      case 'railgun':
        this.glow(x, y, z, 1.2, 1, 0.3, 0.3, 0.2);
        break;
      default:
        break;
    }
  }

  impact(x: number, y: number, z: number, kind: string, big: boolean, hitEntity: boolean) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'bullet':
        this.sparks(x, y, z, hitEntity ? 3 : 1, 2.5, 1, 0.85, 0.5);
        if (!hitEntity) this.dust(x, y, z, 1, 0.3);
        break;
      case 'shell':
        this.explosion(x, y, z, 'small');
        if (!hitEntity) this.dust(x, y, z, 5, 0.7);
        break;
      case 'rocket':
      case 'missile':
        this.explosion(x, y, z, big ? 'medium' : 'small');
        break;
      case 'artillery':
        this.explosion(x, y, z, 'small');
        this.dust(x, y, z, 8, 0.9);
        this.onScorch?.(x, z, 0.7);
        break;
      case 'laser':
        this.glow(x, y, z, 1.4, 1, 0.3, 0.2, 0.25);
        this.sparks(x, y, z, 10, 3.5, 1, 0.4, 0.3);
        this.smoke(x, y, z, 0.7, 1.2, 0.25);
        break;
      case 'railgun':
        this.glow(x, y, z, 1.4, 0.5, 0.8, 1, 0.25);
        this.sparks(x, y, z, 12, 4, 0.6, 0.85, 1);
        break;
      case 'flame':
        for (let i = 0; i < 3; i++) this.fire(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, 0.7, 0.5);
        this.smoke(x, y + 0.3, z, 0.8, 1.4, 0.15, 0.7, 0.35);
        break;
    }
  }

  /** Visual for a weapon discharge between two points. */
  shot(kind: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, weaponId: string) {
    const vis = Math.max(this.visibility(ax, az), this.visibility(bx, bz));
    if (vis < 0.3) return;
    switch (kind) {
      case 'bullet': {
        // short tracer travelling to the target
        const n = weaponId === 'aaGun' || weaponId === 'wraithChaingun' ? 1 : 1;
        for (let i = 0; i < n; i++) {
          const t0 = Math.random() * 0.3;
          const mx = ax + (bx - ax) * t0, my = ay + (by - ay) * t0, mz = az + (bz - az) * t0;
          this.beam(mx, my, mz, bx, by, bz, 0.05, 1, 0.8, 0.4, 0.07, 0.9);
        }
        break;
      }
      case 'laser': {
        const obelisk = weaponId === 'obeliskBeam';
        const w = obelisk ? 0.32 : 0.2;
        const col: [number, number, number] = obelisk ? [1, 0.18, 0.12] : [1, 0.25, 0.6];
        this.beam(ax, ay, az, bx, by, bz, w * 2.5, col[0], col[1], col[2], 0.35, 0.5, w * 0.5);
        this.beam(ax, ay, az, bx, by, bz, w, 1, 0.8, 0.8, 0.3, 1, w * 0.3);
        this.flashLight(bx, by + 0.5, bz, 0xff4030, 8, 0.3, 6);
        break;
      }
      case 'railgun': {
        this.beam(ax, ay, az, bx, by, bz, 0.35, 0.3, 0.6, 1, 0.3, 0.6, 0.05);
        this.beam(ax, ay, az, bx, by, bz, 0.08, 1, 1, 1, 0.2, 1, 0.02);
        // spiral smoke trail
        const len = Math.hypot(bx - ax, by - ay, bz - az);
        const n = Math.min(24, Math.floor(len * 3));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          this.smoke(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0.35, 0.9, 0.7, 0.1, 0.3);
        }
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
            vx: ((bx - ax) / 0.3) * t * 1.0 + (Math.random() - 0.5) * 0.5, vy: ((by - ay) / 0.3) * t + 0.6, vz: ((bz - az) / 0.3) * t * 1.0 + (Math.random() - 0.5) * 0.5,
            life: 0.32 + Math.random() * 0.12, size: 0.2, size1: 0.6 + t * 0.6, r: 1, g: 0.75, b: 0.3, r1: 0.9, g1: 0.25, b1: 0.05, a: 0.95, a1: 0, tex: 1, drag: s,
          });
        }
        break;
      }
    }
  }

  /** Per-frame trail for travelling projectiles. */
  projectileTrail(kind: string, x: number, y: number, z: number, px: number, py: number, pz: number) {
    if (this.visibility(x, z) < 0.3) return;
    switch (kind) {
      case 'shell':
        this.beam(px, py, pz, x, y, z, 0.07, 1, 0.8, 0.4, 0.05, 0.9);
        break;
      case 'rocket':
      case 'missile':
        this.glow(x, y, z, 0.45, 1, 0.75, 0.4, 0.05);
        this.smoke(x, y, z, 0.35, 0.9, 0.65, 0.05, 0.4);
        this.beam(px, py, pz, x, y, z, 0.08, 1, 0.7, 0.3, 0.05, 0.8);
        break;
      case 'artillery':
        this.glow(x, y, z, 0.5, 1, 0.6, 0.3, 0.05);
        this.smoke(x, y, z, 0.4, 0.8, 0.55, 0.05, 0.3);
        break;
    }
  }

  damageSmoke(x: number, y: number, z: number, heavy: boolean) {
    if (this.visibility(x, z) < 0.3) return;
    this.smoke(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, heavy ? 1.2 : 0.8, 2 + Math.random() * 1.5, heavy ? 0.1 : 0.3, 0.9, 0.45);
    if (heavy && Math.random() < 0.5) this.fire(x, y, z, 0.6, 0.5);
  }

  ionStrike(x: number, y: number, z: number) {
    // charge-up: converging beams
    for (let k = 0; k < 12; k++) {
      this.later(k * 0.15, () => {
        const a = Math.random() * Math.PI * 2;
        this.beam(x + Math.cos(a) * 3, y + 30, z + Math.sin(a) * 3, x, y, z, 0.15, 0.4, 0.7, 1, 0.3, 0.8);
        this.glow(x, y + 0.3, z, 2 + k * 0.2, 0.4, 0.7, 1, 0.3);
      });
    }
  }
  ionImpact(x: number, y: number, z: number) {
    this.beam(x, y + 60, z, x, y, z, 3.2, 0.4, 0.7, 1, 1.2, 1, 0.2);
    this.beam(x, y + 60, z, x, y, z, 1.2, 1, 1, 1, 0.9, 1, 0.1);
    this.flashLight(x, y + 3, z, 0x80b0ff, 60, 1.2, 25);
    this.ring(x, y, z, 7, 1.2, 0x9cc8ff);
    this.later(0.1, () => this.ring(x, y, z, 5, 0.9, 0xffffff));
    for (let i = 0; i < 80; i++) this.sparks(x, y + 0.3, z, 1, 9, 0.6, 0.8, 1);
    this.explosion(x, y, z, 'huge');
    for (let i = 0; i < 30; i++) this.glow(x + (Math.random() - 0.5) * 5, y + Math.random() * 3, z + (Math.random() - 0.5) * 5, 2, 0.4, 0.6, 1, 0.8);
    this.shake = 1.2;
    this.onScorch?.(x, z, 4);
  }
  nukeImpact(x: number, y: number, z: number) {
    this.flashLight(x, y + 4, z, 0xffc070, 80, 2, 30);
    this.ring(x, y, z, 9, 1.6, 0xffe0a0);
    this.later(0.2, () => this.ring(x, y, z, 6, 1.2, 0xffffff));
    this.explosion(x, y, z, 'huge');
    for (let k = 0; k < 8; k++) this.later(k * 0.12, () => this.explosion(x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6, 'large'));
    // mushroom cloud
    for (let i = 0; i < 120; i++) {
      const t = i / 120;
      this.later(t * 1.2, () => {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
        this.add.spawn({ x: x + Math.cos(a) * r, y: y + 0.5, z: z + Math.sin(a) * r, vx: 0, vy: 4 + Math.random() * 2, vz: 0, life: 1.6, size: 2.5, size1: 3.5, r: 1, g: 0.6, b: 0.2, r1: 0.6, g1: 0.15, b1: 0.05, a: 0.8, a1: 0, tex: 1, drag: 0.6 });
        this.alpha.spawn({ x: x + Math.cos(a) * r, y: y + 1, z: z + Math.sin(a) * r, vx: Math.cos(a) * 0.4, vy: 3.2 + Math.random() * 1.5, vz: Math.sin(a) * 0.4, life: 5 + Math.random() * 2, size: 2.5, size1: 6, r: 0.25, g: 0.2, b: 0.18, r1: 0.45, g1: 0.42, b1: 0.4, a: 0.7, a1: 0, tex: 1, drag: 0.55, vrot: 0.3 });
      });
    }
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      this.alpha.spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * 7, vy: 0.2, vz: Math.sin(a) * 7, life: 2.5, size: 1.5, size1: 3.5, r: 0.5, g: 0.45, b: 0.4, a: 0.6, a1: 0, tex: 1, drag: 1.2 });
    }
    this.shake = 1.5;
    this.onScorch?.(x, z, 5);
  }

  missileTrail(x: number, y: number, z: number) {
    this.glow(x, y, z, 1.5, 1, 0.6, 0.3, 0.08);
    this.smoke(x, y, z, 1.2, 3, 0.7, 0.1, 0.5);
    this.fire(x, y, z, 0.8, 0.3);
  }

  harvestSparkle(x: number, y: number, z: number, rich: boolean) {
    if (this.visibility(x, z) < 0.3) return;
    const c = rich ? [0.6, 0.4, 1] : [0.3, 1, 0.75];
    this.add.spawn({ x: x + (Math.random() - 0.5) * 0.6, y: y + 0.2, z: z + (Math.random() - 0.5) * 0.6, vy: 0.8, life: 0.6, size: 0.2, size1: 0.05, r: c[0], g: c[1], b: c[2], a: 1, a1: 0, tex: 2, gravity: -0.5 });
    this.dust(x, y, z, 1, 0.5, [0.4, 0.38, 0.3]);
  }

  crush(x: number, y: number, z: number) {
    this.dust(x, y, z, 4, 0.4, [0.45, 0.35, 0.28]);
  }

  construction(x: number, y: number, z: number, w: number, h: number) {
    for (let i = 0; i < 2; i++) {
      this.dust(x + (Math.random() - 0.5) * w, y, z + (Math.random() - 0.5) * h, 1, 0.8);
    }
    if (Math.random() < 0.3) this.sparks(x + (Math.random() - 0.5) * w, y + Math.random() * 1.2, z + (Math.random() - 0.5) * h, 3, 1.5, 1, 0.9, 0.5);
  }
}
