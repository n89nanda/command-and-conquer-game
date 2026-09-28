/**
 * Map decoration ("doodads") for instanced rendering. Each kind/variant returns
 * one (geometry, material) pair per material; geometry & materials are shared
 * and cached. Model space: 1 tile, sits on y = 0; the engine applies random yaw.
 */
import * as THREE from 'three';
import { B, P, V3, rng, strut, T, cboxGeo } from './kit';

export type DoodadKind = 'pine' | 'tree' | 'deadTree' | 'bush' | 'rock' | 'boulder' | 'crystal' | 'crystalRich' | 'barrel' | 'wreck' | 'ruin' | 'fence' | 'lamp';
export const DOODAD_KINDS: DoodadKind[] = ['pine', 'tree', 'deadTree', 'bush', 'rock', 'boulder', 'crystal', 'crystalRich', 'barrel', 'wreck', 'ruin', 'fence', 'lamp'];
export interface DoodadPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const cache = new Map<string, DoodadPart[]>();

export function doodadParts(kind: DoodadKind, variant: number): DoodadPart[] {
  const v = Math.max(0, Math.min(3, Math.floor(variant) || 0));
  const key = `${kind}|${v}`;
  let parts = cache.get(key);
  if (parts) return parts;
  const b = new B({ aoHeight: 0.25, aoMin: 0.55, jitter: 0.06, seed: 97 + v * 13 + kind.length * 7 });
  const r = rng(1000 + v * 31 + kind.charCodeAt(0) * 7 + kind.length);
  try {
    BUILDERS[kind]?.(b, v, r);
  } catch (e) {
    console.error('[doodads] failed', kind, v, e);
  }
  if (b.empty) b.box('matte', 0x777777, 0.2, 0.2, 0.2, 0, 0.1, 0);
  parts = b.parts();
  cache.set(key, parts);
  return parts;
}

type Rnd = () => number;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Noisy, flat-shaded rock geometry. */
function rockGeo(r: Rnd, radius: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let f = seen.get(k);
    if (f === undefined) {
      f = 0.72 + r() * 0.5;
      seen.set(k, f);
    }
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return ng;
}

function tint(hex: number, r: Rnd, amt = 0.12): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h + (r() - 0.5) * amt * 0.3, hsl.s, hsl.l * (1 + (r() - 0.5) * amt * 2));
  return c;
}

/** One hexagonal crystal shard (prism + pointed tip) standing on base, tilted. */
function shard(b: B, x: number, z: number, h: number, rad: number, tiltX: number, tiltZ: number, yaw: number, body: string, tip: string): void {
  const bodyH = h * 0.72;
  const g = new THREE.CylinderGeometry(rad, rad * 1.1, bodyH, 6);
  g.translate(0, bodyH / 2, 0);
  const tg = new THREE.ConeGeometry(rad, h - bodyH, 6);
  tg.translate(0, bodyH + (h - bodyH) / 2, 0);
  g.rotateY(yaw);
  tg.rotateY(yaw);
  const m = T(x, -0.02, z, tiltX, 0, tiltZ);
  b.add(g, body, 0, m);
  b.add(tg, tip, 0, m.clone());
}

const BUILDERS: Record<DoodadKind, (b: B, v: number, r: Rnd) => void> = {
  pine(b, v, r) {
    const h = [1.0, 1.25, 0.85, 1.4][v];
    b.cyl('matte', 0x4a3522, 0.035, 0.05, h * 0.3, 6, 0, h * 0.15, 0);
    const tiers = v === 2 ? 3 : 4;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const rad = lerp(0.36, 0.12, t) * (v === 3 ? 0.85 : 1);
      const th = h * 0.42;
      const y = h * 0.18 + t * h * 0.62 + th / 2;
      const col = tint(i === 0 ? 0x24401f : 0x2e5226, r, 0.18);
      b.add(new THREE.ConeGeometry(rad, th, 7), 'foliage', col, T((r() - 0.5) * 0.03, y, (r() - 0.5) * 0.03, 0, r() * 3, 0));
    }
  },
  tree(b, v, r) {
    const h = [0.95, 1.1, 0.8, 1.0][v];
    const base = v === 3 ? 0x8a6a26 : v === 2 ? 0x55702e : 0x46662a;
    strut(b, 'matte', 0x4d3826, [0, 0, 0], [0.02, h * 0.5, 0.01], 0.07, 0.07);
    strut(b, 'matte', 0x4d3826, [0.02, h * 0.35, 0.01], [0.14, h * 0.6, 0.05], 0.04, 0.04);
    strut(b, 'matte', 0x4d3826, [0.02, h * 0.35, 0.01], [-0.12, h * 0.58, -0.06], 0.04, 0.04);
    const blobs = 5 + v;
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * Math.PI * 2 + r();
      const rr = i === 0 ? 0 : 0.14 + r() * 0.08;
      const y = h * (0.62 + r() * 0.22) + (i === 0 ? 0.1 : 0);
      const s = 0.17 + r() * 0.08;
      b.add(new THREE.IcosahedronGeometry(s, 1), 'foliage', tint(base, r, 0.25), T(Math.cos(a) * rr, y, Math.sin(a) * rr, r(), r(), r(), 1, 0.85, 1));
    }
  },
  deadTree(b, v, r) {
    const h = [0.8, 1.0, 0.65, 0.9][v];
    const col = 0x5a4c40;
    const top: V3 = [0.03, h, 0.02];
    strut(b, 'matte', col, [0, 0, 0], top, 0.06, 0.06);
    const n = 3 + v;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const y = h * (0.4 + r() * 0.5);
      const len = 0.18 + r() * 0.2;
      const end: V3 = [Math.cos(a) * len, y + 0.12 + r() * 0.15, Math.sin(a) * len];
      strut(b, 'matte', col, [0.015, y, 0.01], end, 0.028, 0.028);
      strut(b, 'matte', col, end, [end[0] * 1.4, end[1] + 0.1, end[2] * 1.4], 0.016, 0.016);
    }
    if (v === 1) b.add(rockGeo(r, 0.08, 0), 'matte', 0x6b6358, T(0.2, 0.03, 0.1));
  },
  bush(b, v, r) {
    const n = 3 + v;
    const base = [0x3f5f2a, 0x4d6a2e, 0x5a6a34, 0x3a5a30][v];
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.14;
      const s = 0.09 + r() * 0.07;
      b.add(new THREE.IcosahedronGeometry(s, 1), 'foliage', tint(base, r, 0.3), T(Math.cos(a) * d, s * 0.7, Math.sin(a) * d, r(), r(), 0, 1, 0.8, 1));
    }
    if (v === 3) for (let i = 0; i < 5; i++) b.box('matte', i % 2 ? 0xd8c040 : 0xe0e0d0, 0.025, 0.025, 0.025, (r() - 0.5) * 0.25, 0.14 + r() * 0.06, (r() - 0.5) * 0.25);
  },
  rock(b, v, r) {
    const n = [1, 2, 3, 2][v];
    for (let i = 0; i < n; i++) {
      const s = i === 0 ? 0.16 + v * 0.03 : 0.06 + r() * 0.06;
      const a = r() * Math.PI * 2, d = i === 0 ? 0 : 0.18 + r() * 0.1;
      b.add(rockGeo(r, s, 1), 'matte', tint(0x7d766a, r, 0.2), T(Math.cos(a) * d, s * 0.45, Math.sin(a) * d, r(), r(), r(), 1.2, 0.8, 1));
    }
  },
  boulder(b, v, r) {
    const s = [0.34, 0.42, 0.3, 0.38][v];
    b.add(rockGeo(r, s, 1), 'matte', tint(0x736c62, r, 0.15), T(0, s * 0.55, 0, r(), r(), 0, 1.25, 0.9, 1.05));
    b.add(rockGeo(r, s * 0.55, 1), 'matte', tint(0x80796d, r, 0.15), T(s * 0.9, s * 0.25, s * 0.4, r(), r(), 0, 1, 0.8, 1));
    if (v !== 2) b.add(rockGeo(r, s * 0.4, 0), 'matte', tint(0x6a645a, r, 0.15), T(-s * 0.8, s * 0.2, -s * 0.5, r(), r(), 0));
    // moss cap
    if (v === 1 || v === 3) b.add(rockGeo(r, s * 0.7, 1), 'foliage', 0x4a5e2e, T(0, s * 0.95, 0, 0, r(), 0, 1.3, 0.25, 1.1));
  },
  crystal(b, v, r) {
    crystalCluster(b, v, r, 'crystal', 'crystalCore');
  },
  crystalRich(b, v, r) {
    crystalCluster(b, v, r, 'crystalRich', 'crystalRichCore');
  },
  barrel(b, v, r) {
    const n = [1, 2, 3, 4][v];
    const cols = [0xa8321e, 0xd6a21e, 0x3d5a8a, 0x4c5a3a];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const d = n === 1 ? 0 : 0.12;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const col = cols[(i + v) % cols.length];
      const tipped = v >= 2 && i === n - 1;
      const m = tipped ? T(x + 0.1, 0.07, z + 0.1, Math.PI / 2, r() * 3, 0) : T(x, 0.09, z);
      b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10), 'paint', tint(col, r, 0.15), m);
      const m2 = tipped ? T(x + 0.1, 0.07, z + 0.1, Math.PI / 2, 0, 0) : T(x, 0.09, z);
      void m2;
      for (const dy of [-0.05, 0.05]) {
        const band = new THREE.CylinderGeometry(0.073, 0.073, 0.012, 10);
        band.translate(0, dy, 0);
        b.add(band, 'paint', 0x2a2a2a, m.clone());
      }
      const top = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 10);
      top.translate(0, 0.09, 0);
      b.add(top, 'paint', 0x333333, m.clone());
    }
    if (v === 3) b.cyl('matte', 0x221c16, 0.18, 0.2, 0.008, 12, 0.05, 0.004, 0.05);
  },
  wreck(b, v, r) {
    // burnt out civilian car / truck hulk: rusty, scorched, missing wheels
    const len = [0.5, 0.62, 0.45, 0.7][v];
    const roll = v === 2 ? 0.12 : 0;
    const rust = tint(0x6a3f26, r, 0.2);
    b.add(cboxGeo(len, 0.1, 0.26, 0.02), 'matte', rust, T(0, 0.1, 0, 0, 0, roll));
    b.add(cboxGeo(len * 0.5, 0.08, 0.22, 0.02), 'charred', 0x6a5a4a, T(-len * 0.05, 0.19, 0, 0, 0, roll));
    b.box('matte', 0x14100e, len * 0.42, 0.05, 0.225, -len * 0.05, 0.2, 0, 0, 0, roll); // burnt-out cabin windows
    if (v === 3) {
      b.add(cboxGeo(len * 0.45, 0.14, 0.26, 0.02), 'matte', tint(0x5d6a4a, r, 0.2), T(-len * 0.22, 0.2, 0));
      b.box('matte', 0x3a2a1e, len * 0.4, 0.012, 0.2, -len * 0.22, 0.275, 0);
    }
    b.box('matte', tint(0x8a4a2a, r, 0.2), len * 0.28, 0.014, 0.22, len * 0.3, 0.157, 0, 0, 0, roll);
    for (const x of [len * 0.32, -len * 0.32]) for (const s of [1, -1]) {
      if (r() < 0.3) continue;
      b.cylZ('matte', 0x1c1a18, 0.05, 0.04, 8, x, 0.05, s * 0.13);
    }
    for (let i = 0; i < 4; i++) b.add(rockGeo(r, 0.03, 0), 'matte', 0x3a332c, T((r() - 0.5) * 0.7, 0.01, (r() - 0.5) * 0.5));
  },
  ruin(b, v, r) {
    const col = 0x8a857a;
    // jagged broken wall corner
    const h = [0.45, 0.6, 0.35, 0.5][v];
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) pts.push([-0.35 + i * 0.18, 0, 0]);
    const wallA: V3[] = [[-0.38, 0, -0.04], [0.38, 0, -0.04], [-0.38, 0, 0.04], [0.38, 0, 0.04], [-0.38, h, -0.04], [-0.38, h, 0.04], [0.0, h * 0.7, -0.04], [0.0, h * 0.7, 0.04], [0.38, h * 0.3, -0.04], [0.38, h * 0.3, 0.04]];
    b.hull('matte', col, wallA, 0, 0, -0.3);
    const wallB: V3[] = [[-0.04, 0, 0], [0.04, 0, 0], [-0.04, 0, 0.6], [0.04, 0, 0.6], [-0.04, h * 0.95, 0], [0.04, h * 0.95, 0], [-0.04, h * 0.4, 0.6], [0.04, h * 0.4, 0.6]];
    b.hull('matte', 0x7e796e, wallB, -0.34, 0, -0.3);
    // window hole trims + rebar
    b.box('matte', 0x4a4640, 0.12, 0.1, 0.1, -0.1, h * 0.45, -0.3);
    strut(b, 'metal', 0x5a3a28, [0.1, h * 0.55, -0.3], [0.16, h * 0.8, -0.28], 0.008);
    strut(b, 'metal', 0x5a3a28, [0.2, h * 0.4, -0.3], [0.24, h * 0.62, -0.32], 0.008);
    // rubble
    for (let i = 0; i < 6 + v; i++) {
      b.add(cboxGeo(0.06 + r() * 0.08, 0.04 + r() * 0.05, 0.06 + r() * 0.07, 0.012), 'matte', tint(col, r, 0.25), T((r() - 0.3) * 0.7, 0.02, (r() - 0.2) * 0.6, r(), r() * 3, r()));
    }
    b.box('matte', 0x6a665e, 0.8, 0.02, 0.7, 0.02, 0.01, 0.02);
  },
  fence(b, v, r) {
    if (v < 2) {
      // wooden rail fence spanning the tile along X
      const col = v === 0 ? 0x6b5236 : 0x7a6a50;
      for (let i = 0; i < 4; i++) b.boxB('matte', tint(col, r, 0.2), 0.04, 0.26 + (r() - 0.5) * 0.03, 0.04, -0.45 + i * 0.3, 0, 0);
      b.box('matte', col, 1.0, 0.03, 0.02, 0, 0.18, 0.02, 0, 0, (r() - 0.5) * 0.02);
      b.box('matte', col, 1.0, 0.03, 0.02, 0, 0.09, 0.02, 0, 0, v === 1 ? 0.12 : 0);
    } else {
      // chain-link / wire fence
      for (let i = 0; i < 3; i++) b.cyl('metal', 0x7a7f84, 0.012, 0.014, 0.34, 6, -0.45 + i * 0.45, 0.17, 0);
      b.box('metal', 0x55595e, 1.0, 0.012, 0.012, 0, 0.33, 0);
      b.box('paint', 0x3c4044, 0.9, 0.28, 0.006, 0, 0.17, 0);
      for (let i = 0; i < 9; i++) b.box('paint', 0x6a6e72, 0.004, 0.28, 0.01, -0.44 + i * 0.11, 0.17, 0, 0, 0, 0.5);
      if (v === 3) for (let i = 0; i < 8; i++) b.box('metal', 0x8a8f94, 0.1, 0.008, 0.008, -0.45 + i * 0.125, 0.36, 0, 0.8 * (i % 2 ? 1 : -1), 0, 0);
    }
  },
  lamp(b, v, r) {
    void r;
    const h = [0.75, 0.8, 0.6, 0.75][v];
    b.cyl('paint', 0x3a3d40, 0.035, 0.045, 0.06, 8, 0, 0.03, 0);
    if (v === 2) {
      // floodlight tower
      strut(b, 'paint', 0x4a4d50, [0, 0, 0], [0, h, 0], 0.03);
      b.box('paint', 0x2a2c2e, 0.2, 0.08, 0.06, 0, h, 0);
      for (const x of [-0.05, 0.05]) b.box('e:white', 0, 0.07, 0.05, 0.012, x, h, 0.032);
      return;
    }
    b.cyl('paint', 0x4a4d50, 0.012, 0.018, h, 6, 0, h / 2, 0);
    const arms = v === 1 ? [1, -1] : [1];
    for (const s of arms) {
      strut(b, 'paint', 0x4a4d50, [0, h - 0.02, 0], [s * 0.18, h + 0.03, 0], 0.014);
      b.box('paint', 0x2a2c2e, 0.1, 0.03, 0.06, s * 0.2, h + 0.02, 0);
      if (v !== 3) b.box('e:winWarm', 0, 0.08, 0.012, 0.045, s * 0.2, h + 0.002, 0);
    }
    if (v === 3) b.box('paint', 0x333333, 0.06, 0.012, 0.04, 0.2, h - 0.01, 0);
  },
};

function crystalCluster(b: B, stage: number, r: Rnd, body: string, tip: string): void {
  const counts = [3, 5, 8, 12];
  const scale = [0.55, 0.8, 1.05, 1.3][stage];
  const n = counts[stage];
  // dark rock bed
  for (let i = 0; i < 2 + stage; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.25 * scale;
    b.add(rockGeo(r, (0.06 + r() * 0.05) * (0.6 + scale * 0.6), 0), 'matte', tint(0x2e3a36, r, 0.2), T(Math.cos(a) * d, 0.015, Math.sin(a) * d, r(), r(), r(), 1.3, 0.6, 1.2));
  }
  // main cluster
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const d = i === 0 ? 0 : (0.06 + r() * 0.16) * scale;
    const h = (i === 0 ? 0.5 : 0.18 + r() * 0.28) * scale;
    const rad = (i === 0 ? 0.06 : 0.03 + r() * 0.03) * (0.6 + scale * 0.4);
    const tilt = i === 0 ? 0.08 : 0.25 + r() * 0.45;
    shard(b, Math.cos(a) * d, Math.sin(a) * d, h, rad, Math.sin(a) * tilt, -Math.cos(a) * tilt, r() * 3, body, tip);
  }
  // scattered satellite shards across the tile
  const sat = 2 + stage * 3;
  for (let i = 0; i < sat; i++) {
    const a = r() * Math.PI * 2, d = 0.22 + r() * 0.22;
    const h = (0.06 + r() * 0.1) * scale;
    shard(b, Math.cos(a) * d, Math.sin(a) * d, h, 0.015 + r() * 0.012, (r() - 0.5) * 0.8, (r() - 0.5) * 0.8, r() * 3, body, tip);
  }
}
