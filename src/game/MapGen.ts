import { GameMap, ORE_MAX, RICH_MAX, Terrain, type Theater } from './GameMap';
import { Pathfinder } from './Pathfinding';
import { RNG, fbm, valueNoise } from './util';

export interface MapSpec {
  id: string;
  name: string;
  description: string;
  w: number;
  h: number;
  seed: number;
  theater: Theater;
  players: 2 | 3 | 4;
  /** 0..1 amounts */
  cliffs: number;
  water: number;
  trees: number;
  ore: number;
  river?: boolean;
  roads?: boolean;
  derricks?: number;
  civilians?: number;
  /** layout of starts */
  layout?: 'diagonal' | 'horizontal' | 'vertical' | 'corners';
}

export interface GeneratedMap {
  map: GameMap;
  starts: { x: number; z: number }[];
  derricks: { x: number; z: number }[];
  civilians: { x: number; z: number }[];
}

export const SKIRMISH_MAPS: MapSpec[] = [
  { id: 'greenvalley', name: 'Green Valley', description: 'Rolling hills and a lazy river. A classic 1v1 battleground.', w: 96, h: 96, seed: 1021, theater: 'temperate', players: 2, cliffs: 0.35, water: 0.25, trees: 0.6, ore: 0.6, river: true, roads: true, derricks: 2, civilians: 3, layout: 'diagonal' },
  { id: 'dustbowl', name: 'Dust Bowl', description: 'Open desert with rich Riftite in the centre. Fast and brutal.', w: 88, h: 88, seed: 777, theater: 'desert', players: 2, cliffs: 0.45, water: 0.0, trees: 0.15, ore: 0.8, roads: true, derricks: 4, civilians: 2, layout: 'horizontal' },
  { id: 'frostbite', name: 'Frostbite Pass', description: 'Frozen mountain passes funnel armies into deadly chokepoints.', w: 100, h: 100, seed: 4242, theater: 'winter', players: 2, cliffs: 0.75, water: 0.15, trees: 0.5, ore: 0.55, roads: true, derricks: 2, civilians: 2, layout: 'vertical' },
  { id: 'scorched', name: 'Scorched Earth', description: 'A Rift-ravaged wasteland. Crystals everywhere, cover nowhere.', w: 104, h: 104, seed: 9091, theater: 'wasteland', players: 2, cliffs: 0.3, water: 0.1, trees: 0.2, ore: 1.0, roads: false, derricks: 3, civilians: 4, layout: 'diagonal' },
  { id: 'fourcorners', name: 'Four Corners', description: 'Free-for-all on a large continent. Up to four commanders.', w: 128, h: 128, seed: 3131, theater: 'temperate', players: 4, cliffs: 0.4, water: 0.3, trees: 0.55, ore: 0.7, river: false, roads: true, derricks: 4, civilians: 4, layout: 'corners' },
  { id: 'twinrivers', name: 'Twin Rivers', description: 'Three-way conflict across fertile river plains.', w: 112, h: 112, seed: 5150, theater: 'temperate', players: 3, cliffs: 0.3, water: 0.35, trees: 0.5, ore: 0.7, roads: true, derricks: 3, civilians: 3, layout: 'corners' },
];

export function generateMap(spec: MapSpec): GeneratedMap {
  const { w, h } = spec;
  const rng = new RNG(spec.seed);
  const seed = spec.seed;
  const map = new GameMap(w, h);
  map.theater = spec.theater;

  // ---- starting positions
  const m = 13;
  let starts: { x: number; z: number }[];
  const layout = spec.layout ?? 'diagonal';
  if (spec.players === 2) {
    if (layout === 'horizontal') starts = [{ x: m, z: h / 2 }, { x: w - m, z: h / 2 }];
    else if (layout === 'vertical') starts = [{ x: w / 2, z: m }, { x: w / 2, z: h - m }];
    else starts = [{ x: m, z: m }, { x: w - m, z: h - m }];
  } else if (spec.players === 3) {
    starts = [{ x: m, z: m }, { x: w - m, z: m + 6 }, { x: w / 2, z: h - m }];
  } else {
    starts = [{ x: m, z: m }, { x: w - m, z: h - m }, { x: w - m, z: m }, { x: m, z: h - m }];
  }

  // symmetric sampling: evaluate noise in a way that's rotationally symmetric for 2p diagonal/horizontal maps
  const sym = (x: number, z: number, f: (x: number, z: number) => number) => {
    if (spec.players === 2) return Math.max(f(x, z), f(w - 1 - x, h - 1 - z)) * 0.5 + Math.min(f(x, z), f(w - 1 - x, h - 1 - z)) * 0.5;
    return f(x, z);
  };
  const distToStart = (x: number, z: number) => Math.min(...starts.map((s) => Math.hypot(s.x - x, s.z - z)));

  // ---- base terrain types
  const baseTerrain = spec.theater === 'desert' ? Terrain.Sand : Terrain.Grass;
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      let t: Terrain = baseTerrain;
      const n = sym(x, z, (a, b) => fbm(a * 0.07, b * 0.07, 3, seed + 3));
      if (spec.theater === 'desert') {
        if (n > 0.62) t = Terrain.Dirt;
      } else if (spec.theater === 'wasteland') {
        t = n > 0.5 ? Terrain.Dirt : Terrain.Grass;
      } else if (n > 0.64) t = Terrain.Dirt;
      map.terrain[i] = t;
    }

  // ---- cliffs (ridges)
  if (spec.cliffs > 0) {
    const thr = 0.018 + spec.cliffs * 0.035;
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const v = sym(x, z, (a, b) => fbm(a * 0.035, b * 0.035, 4, seed + 11));
        const mask = sym(x, z, (a, b) => valueNoise(a * 0.05, b * 0.05, seed + 29));
        if (Math.abs(v - 0.5) < thr && mask > 0.42) map.terrain[z * w + x] = Terrain.Rock;
        // mountain clusters
        const mnt = sym(x, z, (a, b) => fbm(a * 0.05, b * 0.05, 3, seed + 41));
        if (mnt > 0.76 - spec.cliffs * 0.06) map.terrain[z * w + x] = Terrain.Rock;
      }
  }
  // map border mountains (thin)
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const e = Math.min(x, z, w - 1 - x, h - 1 - z);
      if (e === 0 || (e === 1 && valueNoise(x * 0.3, z * 0.3, seed) > 0.55)) map.terrain[z * w + x] = Terrain.Rock;
    }

  // ---- water
  if (spec.water > 0) {
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const v = sym(x, z, (a, b) => fbm(a * 0.04, b * 0.04, 4, seed + 57));
        if (v < 0.2 + spec.water * 0.14) map.terrain[z * w + x] = Terrain.Water;
      }
  }
  if (spec.river) {
    // sinuous river across the anti-diagonal with two fords
    const fords: number[] = [0.3, 0.7];
    for (let s = 0; s <= 1; s += 0.002) {
      const cx = s * w;
      const cz = h - s * h + Math.sin(s * Math.PI * 3 + seed) * 6;
      const width = 1.6 + valueNoise(s * 10, 0, seed) * 1.2;
      const isFord = fords.some((f) => Math.abs(s - f) < 0.035);
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = Math.floor(cx + dx), z = Math.floor(cz + dz);
          if (!map.inBounds(x, z)) continue;
          if (Math.hypot(dx, dz) <= width) map.terrain[z * w + x] = isFord ? Terrain.Sand : Terrain.Water;
        }
    }
  }
  // sand shores
  const t0 = map.terrain.slice();
  for (let z = 1; z < h - 1; z++)
    for (let x = 1; x < w - 1; x++) {
      const i = z * w + x;
      if (t0[i] === Terrain.Water || t0[i] === Terrain.Rock) continue;
      let nearWater = false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (t0[(z + dz) * w + x + dx] === Terrain.Water) nearWater = true;
      if (nearWater) map.terrain[i] = Terrain.Sand;
    }

  // ---- clear start areas
  for (const s of starts) {
    for (let z = -10; z <= 10; z++)
      for (let x = -10; x <= 10; x++) {
        const tx = Math.floor(s.x + x), tz = Math.floor(s.z + z);
        if (!map.inBounds(tx, tz) || Math.min(tx, tz, w - 1 - tx, h - 1 - tz) < 1) continue;
        const d = Math.hypot(x, z);
        if (d < 9 + valueNoise(tx * 0.4, tz * 0.4, seed) * 2) {
          const i = tz * w + tx;
          if (map.terrain[i] === Terrain.Rock || map.terrain[i] === Terrain.Water || map.terrain[i] === Terrain.Sand)
            map.terrain[i] = spec.theater === 'desert' ? Terrain.Sand : Terrain.Grass;
        }
      }
  }

  // ---- connectivity: carve roads between starts (and to centre)
  const pf = new Pathfinder(map);
  const carve = (ax: number, az: number, bx: number, bz: number, asRoad: boolean) => {
    // straight-ish carve with noise wobble, turns rock/water to dirt/sand
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const wob = Math.sin(t * Math.PI * 2 + seed) * 4 * Math.sin(t * Math.PI);
      const nx = -(bz - az), nz = bx - ax;
      const nl = Math.hypot(nx, nz) || 1;
      const x = ax + (bx - ax) * t + (nx / nl) * wob;
      const z = az + (bz - az) * t + (nz / nl) * wob;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const tx = Math.floor(x + dx), tz = Math.floor(z + dz);
          if (!map.inBounds(tx, tz) || Math.min(tx, tz, w - 1 - tx, h - 1 - tz) < 1) continue;
          const i = tz * w + tx;
          const tt = map.terrain[i];
          if (tt === Terrain.Rock) map.terrain[i] = Terrain.Dirt;
          if (tt === Terrain.Water) map.terrain[i] = Terrain.Sand;
          if (asRoad && Math.abs(dx) + Math.abs(dz) <= 1 && tt !== Terrain.Water) map.terrain[i] = Terrain.Road;
        }
    }
  };
  const cx = w / 2, cz = h / 2;
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const p = pf.find(s.x, s.z, cx, cz, 60000);
    const last = p[p.length - 1];
    if (!last || Math.hypot(last.x - cx, last.z - cz) > 3) carve(s.x, s.z, cx, cz, false);
  }
  if (spec.roads) {
    // roads following actual paths
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const p = pf.find(s.x, s.z + 5, cx, cz, 60000);
      let px = s.x, pz = s.z + 5;
      for (const pt of p) {
        const steps = Math.ceil(Math.hypot(pt.x - px, pt.z - pz) * 3);
        for (let k = 0; k <= steps; k++) {
          const x = px + ((pt.x - px) * k) / steps, z = pz + ((pt.z - pz) * k) / steps;
          const tx = Math.floor(x), tz = Math.floor(z);
          if (!map.inBounds(tx, tz)) continue;
          const ii = tz * w + tx;
          if (map.terrain[ii] !== Terrain.Water && map.terrain[ii] !== Terrain.Rock) map.terrain[ii] = Terrain.Road;
        }
        px = pt.x;
        pz = pt.z;
      }
    }
  }

  // ---- heights (see bakeHeights below)
  bakeHeights(map, seed, (x, z) => {
    const ds = distToStart(x, z);
    return ds < 12 ? Math.max(0, (ds - 6) / 6) : 1; // flatten bases
  });

  // ---- ore fields
  const placeField = (fx: number, fz: number, r: number, rich: boolean, flip = false) => {
    for (let z = Math.floor(fz - r - 1); z <= fz + r + 1; z++)
      for (let x = Math.floor(fx - r - 1); x <= fx + r + 1; x++) {
        if (!map.inBounds(x, z)) continue;
        const lx = (x - fx) * (flip ? -1 : 1), lz = (z - fz) * (flip ? -1 : 1);
        const d = Math.hypot(x - fx, z - fz) / r + (valueNoise(lx * 0.5 + 50, lz * 0.5 + 50, seed + 77) - 0.5) * 0.7;
        if (d > 1) continue;
        const i = z * w + x;
        const t = map.terrain[i];
        if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Road) continue;
        const richTile = rich && d < 0.55;
        map.oreType[i] = richTile ? 2 : 1;
        const max = richTile ? RICH_MAX : ORE_MAX;
        map.ore[i] = max * (1 - d * 0.6) * (0.78 + valueNoise(lx * 1.3 + 9, lz * 1.3 + 9, seed + 5) * 0.22);
      }
  };
  const oreAmt = spec.ore;
  // identical home fields for every start (same offsets relative to the map centre) so no start is favoured
  const homeA = (rng.next() - 0.5) * 1.2;
  const sideB = (rng.next() > 0.5 ? 1 : -1) * 1.3;
  const homeFields: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    let fields: { x: number; z: number; r: number }[];
    if (spec.players === 2 && i === 1) {
      // exact point-mirror of start 0's fields
      fields = homeFields.map((f) => ({ x: w - 1 - f.x, z: h - 1 - f.z, r: f.r }));
    } else {
      const a = Math.atan2(cz - s.z, cx - s.x) + homeA;
      const b = a + sideB;
      fields = [
        { x: s.x + Math.cos(a) * 11, z: s.z + Math.sin(a) * 11, r: 3.2 + oreAmt },
        { x: s.x + Math.cos(b) * 17, z: s.z + Math.sin(b) * 17, r: 2.6 + oreAmt },
      ];
      if (i === 0) homeFields.push(...fields);
    }
    for (const f of fields) placeField(f.x, f.z, f.r, false, spec.players === 2 && i === 1);
  }
  // contested fields
  placeField(cx, cz, 3 + oreAmt * 2, true);
  const nContested = Math.round(2 + oreAmt * 3);
  for (let k = 0; k < nContested; k++) {
    const a = (k / nContested) * Math.PI * 2 + seed;
    const r = Math.min(w, h) * (0.22 + rng.next() * 0.1);
    const fx = cx + Math.cos(a) * r, fz = cz + Math.sin(a) * r;
    const rich = rng.chance(0.35);
    placeField(fx, fz, 2.5 + oreAmt * 1.5, rich);
    if (spec.players === 2) placeField(w - 1 - fx, h - 1 - fz, 2.5 + oreAmt * 1.5, rich, true);
  }
  // remove ore from start centres
  for (const s of starts)
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const tx = Math.floor(s.x + x), tz = Math.floor(s.z + z);
        if (!map.inBounds(tx, tz)) continue;
        if (Math.hypot(x, z) < 6) {
          map.ore[tz * w + tx] = 0;
          map.oreType[tz * w + tx] = 0;
        }
      }

  // ---- neutral structures spots
  const derricks: { x: number; z: number }[] = [];
  const civilians: { x: number; z: number }[] = [];
  const freeArea = (x: number, z: number, fw: number, fh: number) => {
    for (let dz = -1; dz <= fh; dz++)
      for (let dx = -1; dx <= fw; dx++) {
        const tx = x + dx, tz = z + dz;
        if (!map.inBounds(tx, tz)) return false;
        const i = tz * w + tx;
        const t = map.terrain[i];
        if (t === Terrain.Rock || t === Terrain.Water || map.oreType[i]) return false;
      }
    return true;
  };
  const pickSpots = (n: number, out: { x: number; z: number }[], minStart: number) => {
    let tries = 0;
    while (out.length < n && tries++ < 400) {
      const x = rng.int(6, w - 8), z = rng.int(6, h - 8);
      if (distToStart(x, z) < minStart) continue;
      if (!freeArea(x, z, 2, 2)) continue;
      if ([...derricks, ...civilians].some((d) => Math.hypot(d.x - x, d.z - z) < 10)) continue;
      out.push({ x, z });
      if (spec.players === 2 && out.length < n) {
        const mx = w - 2 - x, mz = h - 2 - z;
        if (freeArea(mx, mz, 2, 2)) out.push({ x: mx, z: mz });
      }
    }
  };
  pickSpots(spec.derricks ?? 0, derricks, 18);
  pickSpots(spec.civilians ?? 0, civilians, 16);

  // ---- doodads
  const addDoodad = (kind: string, x: number, z: number, blocks: boolean, scale = 1) => {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (!map.inBounds(tx, tz)) return;
    map.doodads.push({ kind, variant: rng.int(0, 3), x, z, rot: rng.next() * Math.PI * 2, scale: scale * (0.85 + rng.next() * 0.3), blocks });
    if (blocks) map.doodadBlock[tz * w + tx] = 1;
  };
  const reserved = (tx: number, tz: number) =>
    derricks.some((d) => tx >= d.x - 1 && tx <= d.x + 2 && tz >= d.z - 1 && tz <= d.z + 2) ||
    civilians.some((d) => tx >= d.x - 1 && tx <= d.x + 2 && tz >= d.z - 1 && tz <= d.z + 2);
  const treeKinds = spec.theater === 'desert' ? ['deadTree', 'bush'] : spec.theater === 'winter' ? ['pine', 'pine', 'deadTree'] : spec.theater === 'wasteland' ? ['deadTree', 'deadTree', 'bush'] : ['pine', 'tree', 'tree', 'bush'];
  for (let z = 1; z < h - 1; z++)
    for (let x = 1; x < w - 1; x++) {
      const i = z * w + x;
      const t = map.terrain[i];
      if (t === Terrain.Water || t === Terrain.Road || map.oreType[i]) continue;
      if (reserved(x, z)) continue;
      const ds = distToStart(x, z);
      if (t === Terrain.Rock) {
        if (rng.chance(0.08)) addDoodad('rock', x + rng.next(), z + rng.next(), false, 1.2);
        continue;
      }
      if (ds < 10) continue;
      const forest = sym(x, z, (a, b) => fbm(a * 0.08, b * 0.08, 3, seed + 201));
      if (forest > 0.66 - spec.trees * 0.12 && rng.chance(0.55)) {
        const kind = rng.pick(treeKinds);
        addDoodad(kind, x + 0.5 + (rng.next() - 0.5) * 0.4, z + 0.5 + (rng.next() - 0.5) * 0.4, kind !== 'bush');
      } else if (rng.chance(0.012 * (0.5 + spec.trees))) {
        const kind = rng.pick(treeKinds);
        addDoodad(kind, x + 0.5, z + 0.5, kind !== 'bush');
      } else if (rng.chance(0.006)) {
        addDoodad(rng.chance(0.6) ? 'rock' : 'boulder', x + 0.5, z + 0.5, false, 0.8);
      } else if (spec.theater === 'wasteland' && rng.chance(0.004)) {
        addDoodad('wreck', x + 0.5, z + 0.5, false);
      }
    }
  // decorate civilians
  for (const c of civilians) {
    for (let k = 0; k < 5; k++) {
      const a = rng.next() * Math.PI * 2;
      const x = c.x + 1 + Math.cos(a) * 2.6, z = c.z + 1 + Math.sin(a) * 2.6;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (!map.inBounds(tx, tz) || map.terrain[tz * w + tx] === Terrain.Rock || map.terrain[tz * w + tx] === Terrain.Water || map.oreType[tz * w + tx]) continue;
      addDoodad(rng.pick(['barrel', 'fence', 'lamp', 'ruin']), x, z, false, 0.9);
    }
  }
  return { map, starts, derricks, civilians };
}

// ---- heights
/**
 * Bake vertex heights from terrain types. Passable ground stays smooth and walkable (never below
 * -0.2, so nothing on land dips under the water plane at -0.32); impassable Rock rises in noisy
 * terraces (~0.6 steps) that climb toward the interior of each rock mass so ridges read as cliffs;
 * Water deepens with distance from the shore so the water shader gets a real depth gradient.
 * `flatten(x, z)` scales the rolling-ground noise (0 = flat, 1 = full), e.g. around base sites.
 * Shared by generateMap and the mission MapEditor.
 */
export function bakeHeights(map: GameMap, seed: number, flatten?: (x: number, z: number) => number) {
  const { w, h } = map;
  const T = map.terrain;
  // chamfer distance (in tiles) from the nearest tile outside the set; the map outside counts as rock
  const distInto = (isIn: (t: number) => boolean, outsideIn: boolean) => {
    const d = new Float32Array(w * h);
    const BIG = 1e4;
    for (let i = 0; i < w * h; i++) d[i] = isIn(T[i]) ? BIG : 0;
    const at = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h ? (outsideIn ? BIG : 0) : d[z * w + x]);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x - 1, z) + 1, at(x, z - 1) + 1, at(x - 1, z - 1) + 1.414, at(x + 1, z - 1) + 1.414);
      }
    for (let z = h - 1; z >= 0; z--)
      for (let x = w - 1; x >= 0; x--) {
        const i = z * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x + 1, z) + 1, at(x, z + 1) + 1, at(x + 1, z + 1) + 1.414, at(x - 1, z + 1) + 1.414);
      }
    for (let i = 0; i < w * h; i++) if (d[i] >= 1e4) d[i] = 8; // fully enclosed (only when outsideIn)
    return d;
  };
  const rockD = distInto((t) => t === Terrain.Rock, true);
  const waterD = distInto((t) => t === Terrain.Water, false);
  const ss = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const STEP = 0.6;
  const target = new Float32Array(w * h);
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      const t = T[i];
      let y = (fbm(x * 0.045, z * 0.045, 4, seed + 101) - 0.5) * 1.6;
      if (flatten) y *= flatten(x + 0.5, z + 0.5);
      if (t === Terrain.Rock) {
        // rises toward the interior of the mass, then quantised into terraces with noisy risers
        const d = Math.min(rockD[i], 5);
        const r = 0.9 + d * 0.38 + fbm(x * 0.19, z * 0.19, 3, seed + 7) * 1.25;
        const q = r / STEP + (valueNoise(x * 0.6, z * 0.6, seed + 13) - 0.5) * 0.35;
        const fl = Math.floor(q);
        y = (fl + ss(0.6, 1, q - fl)) * STEP + (valueNoise(x * 1.3, z * 1.3, seed + 17) - 0.5) * 0.12;
      } else if (t === Terrain.Water) {
        y = -0.5 - Math.min(waterD[i], 4) * 0.15;
      } else {
        if (t === Terrain.Sand) y = Math.min(y, 0) - 0.12;
        else if (t === Terrain.Road) y *= 0.8;
        else if (t === Terrain.Concrete) y *= 0.3;
        y = Math.max(y, -0.2);
      }
      target[i] = y;
    }
  for (let z = 0; z <= h; z++)
    for (let x = 0; x <= w; x++) {
      // passable tiles own their corners: a vertex shared with rock follows the ground (plus a small
      // lip) so the cliff rises entirely inside the rock tile and walkable ground stays flat
      let n = 0, sum = 0, rockN = 0, rockSum = 0, waterN = 0, groundN = 0, groundSum = 0;
      for (let dz = -1; dz <= 0; dz++)
        for (let dx = -1; dx <= 0; dx++) {
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= w || tz >= h) continue;
          const i = tz * w + tx;
          const t = T[i];
          n++;
          sum += target[i];
          if (t === Terrain.Rock) {
            rockN++;
            rockSum += target[i];
          } else {
            if (t === Terrain.Water) waterN++;
            else {
              groundN++;
              groundSum += target[i];
            }
          }
        }
      let y = n ? sum / n : 0;
      if (rockN === n && n > 0) y = rockSum / rockN;
      else if (rockN > 0) {
        const other = n - rockN;
        y = groundN ? groundSum / groundN : (sum - rockSum) / other;
        y += (rockN / n) * 0.18;
      }
      // shoreline corners sit just above the water plane so land never dips under it
      if (waterN > 0 && groundN > 0) y = Math.min(groundSum / groundN, -0.24) + (rockN / n) * 0.18;
      else if (waterN > 0 && rockN > 0) y = Math.min(y, -0.1);
      map.heights[z * (w + 1) + x] = y;
    }
}
