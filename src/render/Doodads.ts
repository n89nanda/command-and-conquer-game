import * as THREE from 'three';
import { Terrain, type GameMap } from '../game/GameMap';
import { registerWorldMaterial } from './materials';
import { paletteFor, surfaceHeightAt } from './Terrain';

export interface DoodadPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
export type DoodadProvider = (kind: string, variant: number) => DoodadPart[];

// ------------------------------------------------------------- fallback doodads
const fbMats = new Map<string, THREE.Material>();
function fbMat(key: string, make: () => THREE.Material) {
  let m = fbMats.get(key);
  if (!m) {
    m = registerWorldMaterial(make());
    fbMats.set(key, m);
  }
  return m;
}
const fbGeo = new Map<string, THREE.BufferGeometry>();
export const fallbackDoodads: DoodadProvider = (kind, variant) => {
  const key = kind + variant;
  const g = (k: string, make: () => THREE.BufferGeometry) => {
    let x = fbGeo.get(k);
    if (!x) {
      x = make();
      fbGeo.set(k, x);
    }
    return x;
  };
  switch (kind) {
    case 'pine':
    case 'tree':
      return [
        { geometry: g('trunk', () => new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6).translate(0, 0.2, 0)), material: fbMat('bark', () => new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 })) },
        { geometry: g(key + 'c', () => new THREE.ConeGeometry(0.35 + variant * 0.04, 0.9 + variant * 0.1, 7).translate(0, 0.8, 0)), material: fbMat('leaf', () => new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9 })) },
      ];
    case 'deadTree':
      return [{ geometry: g('dead', () => new THREE.CylinderGeometry(0.03, 0.07, 0.9, 5).translate(0, 0.45, 0)), material: fbMat('dbark', () => new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1 })) }];
    case 'bush':
      return [{ geometry: g('bush', () => new THREE.IcosahedronGeometry(0.22, 0).translate(0, 0.12, 0)), material: fbMat('bush', () => new THREE.MeshStandardMaterial({ color: 0x3f5f2c, roughness: 1, flatShading: true })) }];
    case 'rock':
    case 'boulder':
      return [{ geometry: g('rock' + variant, () => new THREE.DodecahedronGeometry(0.25 + variant * 0.05, 0).translate(0, 0.1, 0)), material: fbMat('rock', () => new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 0.95, flatShading: true })) }];
    case 'crystal':
    case 'crystalRich': {
      const rich = kind === 'crystalRich';
      const s = 0.15 + variant * 0.08;
      return [
        {
          geometry: g(key, () => {
            const geos: THREE.BufferGeometry[] = [];
            const n = 2 + variant;
            for (let i = 0; i < n; i++) {
              const c = new THREE.OctahedronGeometry(s * (0.6 + (i % 3) * 0.25), 0);
              c.scale(0.6, 1.8, 0.6);
              c.rotateZ((i - n / 2) * 0.25);
              c.translate(((i * 37) % 7) / 7 - 0.5, s, ((i * 53) % 7) / 7 - 0.5);
              geos.push(c.toNonIndexed());
            }
            return mergeSimple(geos);
          }),
          material: fbMat(kind, () => new THREE.MeshStandardMaterial({ color: rich ? 0x8a5cff : 0x2fe6b0, emissive: rich ? 0x5a2cff : 0x12b080, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1, flatShading: true })),
        },
      ];
    }
    default:
      return [{ geometry: g('box', () => new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.15, 0)), material: fbMat('grey', () => new THREE.MeshStandardMaterial({ color: 0x666666 })) }];
  }
};

function mergeSimple(geos: THREE.BufferGeometry[]) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return m;
}

// ------------------------------------------------------------- static doodads
export class DoodadLayer {
  group = new THREE.Group();
  constructor(map: GameMap, provider: DoodadProvider) {
    // bucket by kind+variant
    const buckets = new Map<string, { kind: string; variant: number; items: typeof map.doodads }>();
    for (const d of map.doodads) {
      const k = d.kind + ':' + d.variant;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { kind: d.kind, variant: d.variant, items: [] }));
      b.items.push(d);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of buckets.values()) {
      let parts: DoodadPart[];
      try {
        parts = provider(b.kind, b.variant);
      } catch {
        parts = fallbackDoodads(b.kind, b.variant);
      }
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, b.items.length);
        b.items.forEach((d, i) => {
          p.set(d.x, surfaceHeightAt(map, d.x, d.z) - 0.02, d.z);
          q.setFromAxisAngle(up, d.rot);
          s.setScalar(d.scale);
          m4.compose(p, q, s);
          im.setMatrixAt(i, m4);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }
    const chunks = cliffChunks(map);
    if (chunks) this.group.add(chunks);
  }
}

// ------------------------------------------------------------- cliff talus
/** Jittered low-poly boulder shared by all cliff chunks. */
function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // jitter shared corners consistently (keyed by rounded position) so the faceted shape stays closed
  const key = (x: number, y: number, z: number) => `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
  const off = new Map<string, number>();
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    let f = off.get(k);
    if (f === undefined) off.set(k, (f = 0.72 + rnd() * 0.5));
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.62, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Instanced rock chunks along the foot of every cliff (inside the rock tiles, so units never clip
 * them) plus a sparse scatter of talus on the rock masses.
 */
function cliffChunks(map: GameMap) {
  const { w, h } = map;
  const T = map.terrain;
  const rock = (x: number, z: number) => x < 0 || z < 0 || x >= w || z >= h || T[z * w + x] === Terrain.Rock;
  const items: { x: number; z: number; s: number; seed: number }[] = [];
  const hash = (x: number, z: number, k: number) => {
    let v = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(k, 83492791);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let z = 1; z < h - 1; z++)
    for (let x = 1; x < w - 1; x++) {
      if (!rock(x, z)) continue;
      let edges = 0;
      for (const [dx, dz] of N4) {
        if (rock(x + dx, z + dz)) continue;
        edges++;
        // 1-2 chunks hugging the edge that faces open ground
        const n = hash(x, z, dx * 3 + dz) < 0.3 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const along = hash(x, z, 10 + k + dx * 5 + dz * 7);
          const inset = 0.12 + hash(x, z, 20 + k + dx * 5 + dz * 7) * 0.22;
          const px = dx !== 0 ? x + 0.5 + dx * (0.5 - inset) : x + 0.1 + along * 0.8;
          const pz = dz !== 0 ? z + 0.5 + dz * (0.5 - inset) : z + 0.1 + along * 0.8;
          items.push({ x: px, z: pz, s: 0.08 + hash(x, z, 30 + k + dx) * 0.14, seed: items.length });
        }
      }
      if (edges === 0 && hash(x, z, 99) < 0.05) items.push({ x: x + 0.2 + hash(x, z, 98) * 0.6, z: z + 0.2 + hash(x, z, 97) * 0.6, s: 0.12 + hash(x, z, 96) * 0.16, seed: items.length });
    }
  if (!items.length) return null;
  const pal = paletteFor(map.theater);
  const mat = registerWorldMaterial(new THREE.MeshStandardMaterial({ color: pal.cliff, roughness: 0.95, metalness: 0, flatShading: true }));
  const im = new THREE.InstancedMesh(chunkGeometry(), mat, items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    const r1 = hash(it.seed, 1, 2), r2 = hash(it.seed, 3, 4), r3 = hash(it.seed, 5, 6);
    e.set((r1 - 0.5) * 0.9, r2 * Math.PI * 2, (r3 - 0.5) * 0.9);
    q.setFromEuler(e);
    sc.set(it.s * (0.8 + r1 * 0.5), it.s * (0.7 + r2 * 0.6), it.s * (0.8 + r3 * 0.5));
    p.set(it.x, surfaceHeightAt(map, it.x, it.z) + it.s * 0.15, it.z);
    m4.compose(p, q, sc);
    im.setMatrixAt(i, m4);
    const v = 0.9 + r2 * 0.45;
    im.setColorAt(i, c.setRGB(v, v * (0.97 + r3 * 0.05), v * (0.95 + r1 * 0.08)));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

// ------------------------------------------------------------- crystals (dynamic)
export class CrystalLayer {
  group = new THREE.Group();
  private map: GameMap;
  private meshes = new Map<string, THREE.InstancedMesh[]>();
  private provider: DoodadProvider;
  private lastVersion = -1;
  private timer = 0;
  private cap: number;

  constructor(map: GameMap, provider: DoodadProvider) {
    this.map = map;
    this.provider = provider;
    this.cap = Math.max(64, Math.ceil(map.w * map.h * 0.3));
    for (const kind of ['crystal', 'crystalRich'])
      for (let st = 0; st < 4; st++) {
        let parts: DoodadPart[];
        try {
          parts = provider(kind, st);
        } catch {
          parts = fallbackDoodads(kind, st);
        }
        const arr: THREE.InstancedMesh[] = [];
        for (const part of parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, this.cap);
          im.count = 0;
          im.castShadow = false;
          im.receiveShadow = true;
          im.frustumCulled = false;
          this.group.add(im);
          arr.push(im);
        }
        this.meshes.set(kind + st, arr);
      }
    this.rebuild();
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.map.oreVersion !== this.lastVersion && this.timer <= 0) {
      this.timer = 0.4;
      this.rebuild();
    }
  }

  private rebuild() {
    this.lastVersion = this.map.oreVersion;
    const map = this.map;
    const counts = new Map<string, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let z = 0; z < map.h; z++)
      for (let x = 0; x < map.w; x++) {
        const i = z * map.w + x;
        const t = map.oreType[i];
        if (!t) continue;
        const amt = map.ore[i];
        const max = t === 2 ? 1000 : 600;
        const r = amt / max;
        const stage = r > 0.7 ? 3 : r > 0.4 ? 2 : r > 0.15 ? 1 : 0;
        const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
        const put = (st: number, ox: number, oz: number, sc: number, rot: number) => {
          const key = (t === 2 ? 'crystalRich' : 'crystal') + st;
          const arr = this.meshes.get(key)!;
          const c = counts.get(key)!;
          if (c >= this.cap) return;
          p.set(x + 0.5 + ox, surfaceHeightAt(map, x + 0.5 + ox, z + 0.5 + oz) - 0.02, z + 0.5 + oz);
          q.setFromAxisAngle(up, rot);
          s.setScalar(sc);
          m4.compose(p, q, s);
          for (const im of arr) im.setMatrixAt(c, m4);
          counts.set(key, c + 1);
        };
        const jx = ((h % 100) / 100 - 0.5) * 0.36, jz = (((h >> 8) % 100) / 100 - 0.5) * 0.36;
        put(stage, jx, jz, 0.85 + ((h >> 12) % 30) / 100, ((h >> 4) % 628) / 100);
        if (stage >= 1) {
          // a smaller satellite cluster fills the tile
          const a = ((h >> 6) % 628) / 100;
          put(Math.max(0, stage - 1 - ((h >> 3) & 1)), -jx + Math.cos(a) * 0.3, -jz + Math.sin(a) * 0.3, 0.55 + ((h >> 14) % 25) / 100, a * 2.3);
        }
      }
    for (const [k, arr] of this.meshes) {
      for (const im of arr) {
        im.count = counts.get(k)!;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
