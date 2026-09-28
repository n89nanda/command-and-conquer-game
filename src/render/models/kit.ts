/**
 * Shared procedural-modelling toolkit for RIFTFALL.
 *
 * Strategy (performance):
 *  - All opaque surfaces use a tiny set of *global* vertex-coloured materials
 *    ('paint', 'metal', ...). Colour (including team colour) and a baked fake
 *    ambient-occlusion gradient live in the vertex colours, so every static
 *    group of parts collapses into ONE draw call per material.
 *  - Emissive accents use a handful of shared glow materials; blinking / pulsing
 *    is driven globally from `tickShared(time)` so materials stay shared.
 *  - A model type is built once per (type, team colour) into a Template, then
 *    instances are `Object3D.clone()`s that share geometry + materials.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { registerWorldMaterial } from '../materials';
import type { ModelAnimState, ModelInstance } from './ModelTypes';

export type Col = number | THREE.Color;
export type V3 = [number, number, number];
export type V2 = [number, number];

// ============================================================================
// Palette
// ============================================================================
export const P = {
  // Aegis Coalition — military-industrial
  aSand: 0x978c62,
  aSandLt: 0xb1a77d,
  aSandDk: 0x5f5a42,
  aOlive: 0x5b6043,
  aSteel: 0x6b737a,
  aSteelLt: 0x8a9298,
  aSteelDk: 0x40464c,
  aGold: 0xd0a444,
  aConcrete: 0x8a877e,
  aConcreteDk: 0x5f5d58,
  // Rift Covenant — sleek & menacing
  cBlack: 0x1a1b1f,
  cGun: 0x3a3d45,
  cGunLt: 0x585c66,
  cGunXl: 0x70747c,
  cRed: 0x9a1616,
  cRedDk: 0x5c0d0e,
  cBone: 0x8f877a,
  // Common
  rubber: 0x1b1b1c,
  track: 0x2a2826,
  gunmetal: 0x2f3236,
  steel: 0x7a7f84,
  chrome: 0x9ea3a8,
  dark: 0x161718,
  hazardY: 0xe0a91c,
  hazardK: 0x1e1e1e,
  sandbag: 0xa8925f,
  canvas: 0x7d7556,
  wood: 0x6b4b2f,
  rust: 0x7a4428,
  skin: 0xc79a78,
  white: 0xe6e6e0,
  red: 0xb52a22,
  asphalt: 0x3a3b3d,
  crystalDk: 0x0d4a3c,
} as const;

// ============================================================================
// Materials (global cache, all registered as world materials)
// ============================================================================
export const GLOW = {
  blue: 0x6cc4ff,
  white: 0xfff1d6,
  amber: 0xffa62e,
  red: 0xff2414,
  orange: 0xff5a12,
  teal: 0x2fe6b0,
  violet: 0x8a5cff,
  green: 0x5cff6a,
  win: 0x5da6f0,
  winWarm: 0xffc56e,
  fire: 0xff7a1e,
} as const;
export type GlowName = keyof typeof GLOW;
/** Per-colour gain so bright hues (teal, white) don't blow out to white under ACES. */
const GLOW_GAIN: Partial<Record<GlowName, number>> = { teal: 0.6, white: 0.75, green: 0.7, amber: 0.9, red: 1.2, orange: 1.05, violet: 1.2, blue: 0.9 };

type AnimKind = 'blink' | 'blinkB' | 'pulse' | 'pulseFast' | 'flicker';
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const animated: { m: THREE.MeshStandardMaterial; kind: AnimKind; base: number }[] = [];

function makeStd(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return registerWorldMaterial(new THREE.MeshStandardMaterial(p));
}

/**
 * Material keys:
 *  'paint' | 'metal' | 'matte' | 'foliage' | 'charred' | 'glass' | 'crystal' | 'crystalCore' | 'crystalRich' | 'crystalRichCore'
 *  'e:<glowName>[:blink|:blinkB|:pulse|:pulseFast|:flicker|:dim|:hot]'   emissive
 *  'e:#rrggbb[...]'                                                     emissive team glow
 */
export function mat(key: string): THREE.MeshStandardMaterial {
  let m = matCache.get(key);
  if (m) return m;
  if (key.startsWith('e:')) {
    const [, name, mod] = key.split(':');
    const hex = name.startsWith('#') ? parseInt(name.slice(1), 16) : GLOW[name as GlowName] ?? 0xffffff;
    const base = name === 'win' || name === 'winWarm' ? 1.0 : 1.8;
    const gain = name.startsWith('#') ? 0.9 : GLOW_GAIN[name as GlowName] ?? 1;
    const lvl = base * gain;
    const intensity = mod === 'dim' ? lvl * 0.1 : mod === 'hot' ? lvl * 1.7 : lvl;
    const col = new THREE.Color(hex);
    m = makeStd({
      color: col.clone().multiplyScalar(mod === 'dim' ? 0.25 : 0.35),
      emissive: col,
      emissiveIntensity: intensity,
      roughness: 0.35,
      metalness: 0.0,
    });
    if (mod === 'blink' || mod === 'blinkB' || mod === 'pulse' || mod === 'pulseFast' || mod === 'flicker') {
      animated.push({ m, kind: mod, base: intensity });
    }
  } else {
    switch (key) {
      case 'metal':
        m = makeStd({ vertexColors: true, roughness: 0.36, metalness: 0.62 });
        break;
      case 'matte':
        m = makeStd({ vertexColors: true, roughness: 0.93, metalness: 0.0 });
        break;
      case 'foliage':
        m = makeStd({ vertexColors: true, roughness: 0.88, metalness: 0.0, flatShading: true });
        break;
      case 'charred':
        m = makeStd({ vertexColors: true, color: 0x4a4440, roughness: 0.95, metalness: 0.1 });
        break;
      case 'glass':
        m = makeStd({ vertexColors: true, roughness: 0.08, metalness: 0.4 });
        break;
      case 'crystal':
        m = makeStd({ color: 0x07503c, emissive: 0x19b886, emissiveIntensity: 0.75, roughness: 0.22, metalness: 0.2, flatShading: true });
        break;
      case 'crystalCore':
        m = makeStd({ color: 0x3fe0b0, emissive: 0x2fe6b0, emissiveIntensity: 1.5, roughness: 0.1, metalness: 0.1, flatShading: true });
        break;
      case 'crystalRich':
        m = makeStd({ color: 0x3b2380, emissive: GLOW.violet, emissiveIntensity: 0.95, roughness: 0.1, metalness: 0.3, flatShading: true });
        break;
      case 'crystalRichCore':
        m = makeStd({ color: 0x9a7cff, emissive: 0x9a70ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.1, flatShading: true });
        break;
      case 'paint':
      default:
        m = makeStd({ vertexColors: true, roughness: 0.6, metalness: 0.22 });
        break;
    }
  }
  matCache.set(key, m);
  return m;
}

let lastTick = Number.NaN;
/** Drive shared blink / pulse materials. Cheap & idempotent per timestamp. */
export function tickShared(t: number): void {
  if (t === lastTick) return;
  lastTick = t;
  for (const a of animated) {
    let f = 1;
    switch (a.kind) {
      case 'blink':
        f = (t % 1.3) < 0.55 ? 1 : 0.06;
        break;
      case 'blinkB':
        f = ((t + 0.65) % 1.3) < 0.55 ? 1 : 0.06;
        break;
      case 'pulse':
        f = 0.55 + 0.45 * Math.sin(t * 2.4);
        break;
      case 'pulseFast':
        f = 0.6 + 0.4 * Math.sin(t * 6.5);
        break;
      case 'flicker':
        f = 0.75 + 0.15 * Math.sin(t * 23) + 0.1 * Math.sin(t * 37.7);
        break;
    }
    a.m.emissiveIntensity = a.base * f;
  }
}

export function teamGlowKey(team: THREE.Color, mod = ''): string {
  return 'e:#' + team.getHexString() + (mod ? ':' + mod : '');
}

// ============================================================================
// Geometry primitives (all return fresh geometries in local space)
// ============================================================================
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order: THREE.EulerOrder = 'XYZ'): THREE.Matrix4 {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function hullGeo(pts: V3[]): THREE.BufferGeometry {
  return new ConvexGeometry(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
}

/** Box with chamfered edges (flat-shaded convex hull). */
export function cboxGeo(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  c = Math.min(c, hw * 0.95, hh * 0.95, hd * 0.95);
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([sx * hw, sy * (hh - c), sz * (hd - c)]);
    pts.push([sx * (hw - c), sy * hh, sz * (hd - c)]);
    pts.push([sx * (hw - c), sy * (hh - c), sz * hd]);
  }
  return hullGeo(pts);
}

/** Polygon in XY extruded along Z by depth, centred on z=0. */
export function prismGeo(profile: V2[], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Tapered block: bottom rectangle (w0,d0) at y=0, top rectangle (w1,d1) at y=h, top offset by (ox,oz). */
export function taperGeo(w0: number, d0: number, w1: number, d1: number, h: number, ox = 0, oz = 0): THREE.BufferGeometry {
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([(sx * w0) / 2, 0, (sz * d0) / 2]);
    pts.push([(sx * w1) / 2 + ox, h, (sz * d1) / 2 + oz]);
  }
  return hullGeo(pts);
}

// ============================================================================
// Builder: accumulates coloured parts grouped by material key, then merges.
// ============================================================================
export interface BuilderOpts {
  /** y of this builder's origin in model space (for baked AO). */
  aoBase?: number;
  /** height over which AO fades out. 0 disables AO. */
  aoHeight?: number;
  /** minimum AO multiplier at ground. */
  aoMin?: number;
  /** per-part random tint amount */
  jitter?: number;
  seed?: number;
}

const _c = new THREE.Color();

export class B {
  private groups = new Map<string, THREE.BufferGeometry[]>();
  private rnd: () => number;
  aoBase: number;
  aoHeight: number;
  aoMin: number;
  jitter: number;

  constructor(o: BuilderOpts = {}) {
    this.aoBase = o.aoBase ?? 0;
    this.aoHeight = o.aoHeight ?? 0.28;
    this.aoMin = o.aoMin ?? 0.5;
    this.jitter = o.jitter ?? 0.03;
    this.rnd = rng(o.seed ?? 1234);
  }

  get empty(): boolean {
    return this.groups.size === 0;
  }

  add(geo: THREE.BufferGeometry, m: string, col: Col, mtx?: THREE.Matrix4): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g === geo) g = geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (mtx) g.applyMatrix4(mtx);
    if (typeof col === 'number') _c.setHex(col);
    else _c.copy(col);
    const j = 1 + (this.rnd() * 2 - 1) * this.jitter;
    const r = _c.r * j, gg = _c.g * j, bb = _c.b * j;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    const arr = new Float32Array(n * 3);
    const aoOn = this.aoHeight > 0;
    for (let i = 0; i < n; i++) {
      let f = 1;
      if (aoOn) {
        const y = (pos.getY(i) + this.aoBase) / this.aoHeight;
        const t = y <= 0 ? 0 : y >= 1 ? 1 : y * y * (3 - 2 * y);
        f = this.aoMin + (1 - this.aoMin) * t;
      }
      if (nor.getY(i) < -0.6) f *= 0.7;
      arr[i * 3] = r * f;
      arr[i * 3 + 1] = gg * f;
      arr[i * 3 + 2] = bb * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    let list = this.groups.get(m);
    if (!list) this.groups.set(m, (list = []));
    list.push(g);
    return this;
  }

  // ---- shapes ----------------------------------------------------------------
  box(m: string, c: Col, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), m, c, T(x, y, z, rx, ry, rz));
  }
  /** Box resting on y (bottom at y). */
  boxB(m: string, c: Col, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), m, c, T(x, y + h / 2, z, 0, ry, 0));
  }
  cbox(m: string, c: Col, w: number, h: number, d: number, ch: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(cboxGeo(w, h, d, ch), m, c, T(x, y, z, rx, ry, rz));
  }
  cboxB(m: string, c: Col, w: number, h: number, d: number, ch: number, x = 0, y = 0, z = 0, ry = 0): this {
    return this.add(cboxGeo(w, h, d, ch), m, c, T(x, y + h / 2, z, 0, ry, 0));
  }
  /** Cylinder along Y centred at (x,y,z). */
  cyl(m: string, c: Col, rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, open = false): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m, c, T(x, y, z, rx, ry, rz));
  }
  /** Cylinder along X (e.g. barrels pointing forward). rt is the +X end. */
  cylX(m: string, c: Col, rt: number, rb: number, len: number, seg: number, x = 0, y = 0, z = 0): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, len, seg), m, c, T(x, y, z, 0, 0, -Math.PI / 2));
  }
  /** Cylinder along Z (e.g. wheels, axles). */
  cylZ(m: string, c: Col, r: number, len: number, seg: number, x = 0, y = 0, z = 0): this {
    return this.add(new THREE.CylinderGeometry(r, r, len, seg), m, c, T(x, y, z, Math.PI / 2, 0, 0));
  }
  sphere(m: string, c: Col, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 12, hs = 8): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs), m, c, T(x, y, z, 0, 0, 0, sx, sy, sz));
  }
  /** Hemisphere dome (top half), base at y. */
  dome(m: string, c: Col, r: number, x = 0, y = 0, z = 0, sy = 1, ws = 14, hs = 5): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2), m, c, T(x, y, z, 0, 0, 0, 1, sy, 1));
  }
  ico(m: string, c: Col, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 0, ry = 0): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), m, c, T(x, y, z, 0, ry, 0, sx, sy, sz));
  }
  hull(m: string, c: Col, pts: V3[], x = 0, y = 0, z = 0, ry = 0): this {
    return this.add(hullGeo(pts), m, c, T(x, y, z, 0, ry, 0));
  }
  /** XY profile extruded along Z (depth), placed at (x,y,z). */
  prism(m: string, c: Col, profile: V2[], depth: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(prismGeo(profile, depth), m, c, T(x, y, z, rx, ry, rz));
  }
  /** XZ footprint polygon extruded upward by h starting at y. */
  plan(m: string, c: Col, poly: V2[], h: number, x = 0, y = 0, z = 0): this {
    // profile in XY with y := -z so that after rotating -90deg about X, profile y maps to +z... simpler: build explicitly
    const g = prismGeo(poly.map(([px, pz]) => [px, -pz] as V2), h);
    // prism extrudes along z centred; rotate so extrusion is along +y
    return this.add(g, m, c, T(x, y + h / 2, z, -Math.PI / 2, 0, 0));
  }
  taper(m: string, c: Col, w0: number, d0: number, w1: number, d1: number, h: number, x = 0, y = 0, z = 0, ox = 0, oz = 0, ry = 0): this {
    return this.add(taperGeo(w0, d0, w1, d1, h, ox, oz), m, c, T(x, y, z, 0, ry, 0));
  }
  torus(m: string, c: Col, R: number, r: number, x = 0, y = 0, z = 0, rx = Math.PI / 2, ry = 0, rz = 0, rs = 6, ts = 16): this {
    return this.add(new THREE.TorusGeometry(R, r, rs, ts), m, c, T(x, y, z, rx, ry, rz));
  }
  cone(m: string, c: Col, r: number, h: number, seg: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), m, c, T(x, y, z, rx, ry, rz));
  }
  lathe(m: string, c: Col, pts: V2[], seg: number, x = 0, y = 0, z = 0): this {
    return this.add(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg), m, c, T(x, y, z));
  }

  // ---- output ----------------------------------------------------------------
  /** Merge into one mesh per material key. */
  meshes(opts: { receive?: boolean; cast?: boolean } = {}): THREE.Group {
    const grp = new THREE.Group();
    for (const [key, list] of this.groups) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      for (const g of list) if (g !== merged) g.dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat(key));
      const glow = key.startsWith('e:') || key.startsWith('crystal');
      mesh.castShadow = opts.cast ?? !glow;
      mesh.receiveShadow = opts.receive ?? true;
      mesh.name = key;
      mesh.userData.matKey = key;
      grp.add(mesh);
    }
    this.groups.clear();
    return grp;
  }

  /** Merge into (geometry, material) parts without Mesh wrappers (for instancing). */
  parts(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    for (const [key, list] of this.groups) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      out.push({ geometry: merged, material: mat(key) });
    }
    this.groups.clear();
    return out;
  }
}

/** Build a named node from a builder at a given position. */
export function node(name: string, b: B | null, x = 0, y = 0, z = 0): THREE.Group {
  const g = b ? b.meshes() : new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

// ============================================================================
// Templates & instances
// ============================================================================
export type Updater = (dt: number, s: ModelAnimState) => void;

export interface Template {
  root: THREE.Group;
  muzzles: THREE.Vector3[];
  height: number;
  /** Given a fresh clone of root, returns its per-frame updater. */
  anim?: (root: THREE.Object3D) => Updater | undefined;
  /** name of the turret node */
  turret?: string;
}

export function finalizeTemplate(root: THREE.Group, muzzles: THREE.Vector3[], anim?: Template['anim'], height?: number): Template {
  root.updateMatrixWorld(true);
  let h = height;
  if (h === undefined) {
    const box = new THREE.Box3().setFromObject(root);
    h = Number.isFinite(box.max.y) ? box.max.y : 0.5;
  }
  const hasTurret = !!root.getObjectByName('turret');
  return { root, muzzles, height: h, anim, turret: hasTurret ? 'turret' : undefined };
}

export function instantiate(t: Template): ModelInstance {
  const root = t.root.clone(true);
  const turret = t.turret ? root.getObjectByName(t.turret) ?? undefined : undefined;
  const upd = t.anim?.(root);
  return {
    root,
    turret,
    muzzles: t.muzzles.map((v) => v.clone()),
    height: t.height,
    update: upd
      ? (dt, s) => {
          tickShared(s.time);
          upd(dt, s);
        }
      : (_dt, s) => tickShared(s.time),
    dispose() {
      /* geometry & materials are shared */
    },
  };
}

export function byName(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return root.getObjectByName(name) ?? undefined;
}

export function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * Swap steady / pulsing glow materials to their dim versions when a building is unpowered.
 * Blinking warning lights are left alone.
 */
export function powerSwitch(root: THREE.Object3D): (powered: boolean) => void {
  const list: { mesh: THREE.Mesh; on: THREE.Material; off: THREE.Material }[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const key = mesh.userData?.matKey as string | undefined;
    if (!mesh.isMesh || !key || !key.startsWith('e:') || key.includes('blink')) return;
    const parts = key.split(':');
    list.push({ mesh, on: mat(key), off: mat(`e:${parts[1]}:dim`) });
  });
  let state = true;
  return (powered: boolean) => {
    if (powered === state) return;
    state = powered;
    for (const l of list) l.mesh.material = powered ? l.on : l.off;
  };
}

// ============================================================================
// Detail helpers
// ============================================================================

/** Alternating hazard stripes along X on top of a surface at height y. */
export function hazardStripX(b: B, x0: number, x1: number, y: number, z: number, depth: number, n = 8, m = 'paint'): void {
  const len = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    b.box(m, i % 2 ? P.hazardK : P.hazardY, len, 0.012, depth, x0 + len * (i + 0.5), y + 0.006, z);
  }
}
export function hazardStripZ(b: B, z0: number, z1: number, y: number, x: number, width: number, n = 8, m = 'paint'): void {
  const len = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    b.box(m, i % 2 ? P.hazardK : P.hazardY, width, 0.012, len, x, y + 0.006, z0 + len * (i + 0.5));
  }
}

/** Slatted vent grille lying on a surface (top face at y). Slats run along Z. */
export function ventTop(b: B, x: number, y: number, z: number, w: number, d: number, n: number, frame: Col, slat: Col = P.dark): void {
  b.box('paint', frame, w, 0.014, d, x, y + 0.007, z);
  const s = (w * 0.86) / n;
  for (let i = 0; i < n; i++) b.box('paint', slat, s * 0.55, 0.012, d * 0.82, x - w * 0.43 + s * (i + 0.5), y + 0.016, z);
}

/** Row of windows on the +Z/-Z face (normal along z sign). */
export function windowsZ(b: B, x0: number, x1: number, y: number, z: number, n: number, ww: number, wh: number, key = 'e:win', sign = 1): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) b.box(key, 0, ww, wh, 0.02, x0 + step * (i + 0.5), y, z + sign * 0.006);
}
export function windowsX(b: B, z0: number, z1: number, y: number, x: number, n: number, ww: number, wh: number, key = 'e:win', sign = 1): void {
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) b.box(key, 0, 0.02, wh, ww, x + sign * 0.006, y, z0 + step * (i + 0.5));
}

export function antenna(b: B, x: number, y: number, z: number, h: number, col: Col = P.gunmetal, tip = 'e:red:blink'): void {
  b.cyl('metal', col, 0.006, 0.01, h, 5, x, y + h / 2, z);
  b.sphere(tip, 0, 0.014, x, y + h, z, 1, 1, 1, 6, 4);
}

/** Pipe run from a to b (straight). */
export function pipe(b: B, m: string, col: Col, a: V3, c: V3, r: number, seg = 8): void {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const dir = vc.clone().sub(va);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const mtx = new THREE.Matrix4().compose(va.add(vc).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  b.add(g, m, col, mtx);
}

/** Line of sandbags between two points on the ground. */
export function sandbags(b: B, a: V2, c: V2, rows = 2, y0 = 0): void {
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(-dz, dx);
  const bagL = 0.11;
  const n = Math.max(1, Math.round(len / bagL));
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.5 : 0;
    for (let i = 0; i < n - (r % 2); i++) {
      const t = (i + 0.5 + off) / n;
      const shade = (i * 7 + r * 3) % 5 === 0 ? 0x927e50 : P.sandbag;
      b.add(cboxGeo(bagL * 0.96, 0.05, 0.075, 0.018), 'matte', shade, T(a[0] + dx * t, y0 + 0.025 + r * 0.046, a[1] + dz * t, 0, ang, 0));
    }
  }
}

/** A tracked running gear pair. Returns nothing; adds to b. */
export interface TrackOpts {
  len: number;
  w: number;
  h: number;
  z: number; // centre offset of each track (|z|)
  x?: number;
  wheels: number;
  col?: Col;
  wheelCol?: Col;
  sides?: (1 | -1)[];
}
export function tracks(b: B, o: TrackOpts): void {
  const { len, w, h } = o;
  const x = o.x ?? 0;
  const col = o.col ?? P.track;
  const wc = o.wheelCol ?? P.gunmetal;
  const prof: V2[] = [
    [-len / 2 + h * 0.45, 0],
    [len / 2 - h * 0.45, 0],
    [len / 2, h * 0.5],
    [len / 2 - h * 0.2, h],
    [-len / 2 + h * 0.2, h],
    [-len / 2, h * 0.5],
  ];
  for (const s of o.sides ?? [1, -1]) {
    const zc = s * o.z;
    b.prism('paint', col, prof, w, x, 0, zc);
    // road wheels, visible on the outer face
    const r = h * 0.3;
    const n = o.wheels;
    for (let i = 0; i < n; i++) {
      const wx = x - len / 2 + h * 0.5 + ((len - h) * i) / Math.max(1, n - 1);
      b.cylZ('metal', wc, r, 0.02, 10, wx, r + 0.012, zc + s * (w / 2 + 0.004));
      b.cylZ('paint', P.dark, r * 0.45, 0.024, 6, wx, r + 0.012, zc + s * (w / 2 + 0.008));
    }
    // sprocket + idler
    b.cylZ('metal', wc, h * 0.33, w * 0.7, 10, x + len / 2 - h * 0.3, h * 0.5, zc + s * 0.01);
    b.cylZ('metal', wc, h * 0.3, w * 0.7, 10, x - len / 2 + h * 0.3, h * 0.5, zc + s * 0.01);
  }
}

/** Track-link ridges on the top run (separate node so it can scroll). */
export function treadNode(o: TrackOpts, spacing = 0.05): THREE.Group {
  const b = new B({ aoHeight: 0 });
  const x = o.x ?? 0;
  const top = o.len - o.h * 0.4 - spacing * 2;
  const n = Math.floor(top / spacing);
  for (const s of o.sides ?? [1, -1]) {
    for (let i = 0; i <= n; i++) {
      b.box('paint', 0x3b3936, 0.018, 0.014, o.w * 1.04, x - top / 2 + i * spacing, o.h + 0.004, s * o.z);
    }
  }
  const g = b.meshes();
  g.name = 'treads';
  g.userData.spacing = spacing;
  return g;
}

/** Wheel (axis along Z) with tyre and hub. */
export function wheel(b: B, x: number, y: number, z: number, r: number, w: number, hubCol: Col = P.gunmetal, side = 1): void {
  b.cylZ('paint', P.rubber, r, w, 12, x, y, z);
  b.cylZ('paint', 0x2a2a2a, r * 0.82, w + 0.004, 12, x, y, z);
  b.cylZ('metal', hubCol, r * 0.5, w + 0.012, 8, x, y, z + side * 0.002);
  b.cylZ('metal', P.dark, r * 0.18, w + 0.02, 6, x, y, z + side * 0.004);
}

/** Generic vehicle animator: body bob, tread scroll, barrel recoil, drum spin, extra hook. */
export function vehicleAnim(opts: { bob?: number; recoil?: number; extra?: (root: THREE.Object3D) => Updater | undefined } = {}): Template['anim'] {
  return (root) => {
    const body = byName(root, 'body');
    const treads: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name === 'treads') treads.push(o);
    });
    const guns: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith('gun')) guns.push(o);
    });
    const gunX = guns.map((g) => g.position.x);
    const extra = opts.extra?.(root);
    let dist = 0;
    let phase = Math.random() * 10;
    const bob = opts.bob ?? 0.006;
    const recoil = opts.recoil ?? 0.06;
    return (dt, s) => {
      if (s.moving) {
        dist += dt * (0.4 + s.speed * 1.6);
        phase += dt * (6 + s.speed * 10);
      }
      if (body) {
        body.position.y = s.moving ? Math.abs(Math.sin(phase)) * bob : 0;
        body.rotation.z = s.moving ? Math.sin(phase * 0.5) * bob * 0.5 : 0;
      }
      for (const t of treads) {
        const sp = t.userData.spacing as number;
        t.position.x = -(dist % sp);
      }
      const r = s.firing * s.firing;
      for (let i = 0; i < guns.length; i++) guns[i].position.x = gunX[i] - r * recoil;
      extra?.(dt, s);
    };
  };
}

/** A simple spinner updater. */
export function spinner(o: THREE.Object3D | undefined, axis: 'x' | 'y' | 'z', rate: number): Updater {
  return (dt) => {
    if (o) o.rotation[axis] += rate * dt;
  };
}

/** Chamfered box spanning from a to c (for limbs, struts, girders). */
export function strut(b: B, m: string, col: Col, a: V3, c: V3, w: number, d = w, ch = 0): void {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const dir = vc.clone().sub(va);
  const len = dir.length();
  const g = ch > 0 ? cboxGeo(w, len, d, ch) : new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  b.add(g, m, col, new THREE.Matrix4().compose(va.add(vc).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/** Four-sided spike / pyramid with base centre at (x,y,z), pointing along +Y (optionally tilted). */
export function spike(b: B, m: string, col: Col, x: number, y: number, z: number, h: number, r: number, rx = 0, rz = 0, ry = Math.PI / 4): void {
  const g = new THREE.ConeGeometry(r, h, 4, 1);
  g.translate(0, h / 2, 0);
  g.rotateY(ry);
  b.add(g, m, col, T(x, y, z, rx, 0, rz));
}
