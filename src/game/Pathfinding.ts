import type { GameMap } from './GameMap';

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Binary min-heap keyed by f score, storing node indices. */
class Heap {
  items: Int32Array;
  keys: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.items = new Int32Array(cap);
    this.keys = new Float32Array(cap);
  }
  clear() {
    this.size = 0;
  }
  push(item: number, key: number) {
    if (this.size >= this.items.length) {
      const ni = new Int32Array(this.items.length * 2);
      ni.set(this.items);
      this.items = ni;
      const nk = new Float32Array(this.keys.length * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    let i = this.size++;
    const items = this.items, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop(): number {
    const items = this.items, keys = this.keys;
    const top = items[0];
    const lastI = items[--this.size];
    const lastK = keys[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = i * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= lastK) break;
      items[i] = items[c];
      keys[i] = keys[c];
      i = c;
    }
    items[i] = lastI;
    keys[i] = lastK;
    return top;
  }
}

export class Pathfinder {
  private map: GameMap;
  private g: Float32Array;
  private parent: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private curGen = 1;
  private heap: Heap;
  /** nodes expanded by the last search (for budgeting) */
  lastExpanded = 0;

  constructor(map: GameMap) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Heap(4096);
  }

  /**
   * Find a path from (sx,sz) to (tx,tz) in tile coordinates.
   * Returns list of tile centers (world coords) excluding the start, smoothed.
   * If the target is unreachable, returns a path to the closest reachable tile.
   * `extraBlocked` lets callers treat some tiles as passable (e.g. own destination building).
   */
  find(sx: number, sz: number, tx: number, tz: number, maxNodes = 12000, ignoreBuildingId = 0): { x: number; z: number }[] {
    this.lastExpanded = 0;
    const map = this.map;
    const W = map.w;
    sx = Math.floor(sx);
    sz = Math.floor(sz);
    tx = Math.floor(tx);
    tz = Math.floor(tz);
    if (!map.inBounds(tx, tz)) {
      tx = Math.max(0, Math.min(map.w - 1, tx));
      tz = Math.max(0, Math.min(map.h - 1, tz));
    }
    const passable = (x: number, z: number) => {
      if (map.passable(x, z)) return true;
      if (ignoreBuildingId && map.inBounds(x, z) && map.building[z * W + x] === ignoreBuildingId) {
        const t = map.terrain[z * W + x];
        return t !== 3 && t !== 4;
      }
      return false;
    };

    // If target blocked, retarget to nearest passable.
    if (!passable(tx, tz)) {
      const np = map.nearestPassable(tx, tz, 12);
      if (!np) return [];
      [tx, tz] = np;
    }
    // If start blocked (unit pushed onto blocked tile), allow leaving it.
    if (sx === tx && sz === tz) return [{ x: tx + 0.5, z: tz + 0.5 }];

    this.curGen++;
    if (this.curGen > 0xfffffff0) {
      this.gen.fill(0);
      this.closed.fill(0);
      this.curGen = 1;
    }
    const gen = this.curGen;
    const g = this.g, parent = this.parent, genA = this.gen, closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const start = sz * W + sx;
    const goal = tz * W + tx;
    g[start] = 0;
    parent[start] = -1;
    genA[start] = gen;
    const h = (x: number, z: number) => {
      const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * 1.0;
    };
    heap.push(start, h(sx, sz));
    let best = start;
    let bestH = h(sx, sz);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cz = (cur - cx) / W;
      const hc = h(cx, cz);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      for (let d = 0; d < 8; d++) {
        const dir = DIRS[d];
        const nx = cx + dir[0], nz = cz + dir[1];
        if (!passable(nx, nz)) continue;
        if (dir[2] !== 1) {
          // no corner cutting
          if (!passable(cx + dir[0], cz) || !passable(cx, cz + dir[1])) continue;
        }
        const ni = nz * W + nx;
        if (closed[ni] === gen) continue;
        const ng = g[cur] + dir[2] * map.moveCost(nx, nz);
        if (genA[ni] !== gen || ng < g[ni]) {
          genA[ni] = gen;
          g[ni] = ng;
          parent[ni] = cur;
          heap.push(ni, ng + h(nx, nz) * 1.001);
        }
      }
    }
    this.lastExpanded = expanded;
    const end = found ? goal : best;
    const tiles: number[] = [];
    for (let c = end; c !== -1 && c !== start; c = parent[c]) tiles.push(c);
    tiles.reverse();
    if (tiles.length === 0) return [];
    // Smooth path with line-of-sight string pulling.
    const pts = tiles.map((i) => ({ x: (i % W) + 0.5, z: Math.floor(i / W) + 0.5 }));
    return this.smooth(sx + 0.5, sz + 0.5, pts, passable);
  }

  private smooth(sx: number, sz: number, pts: { x: number; z: number }[], passable: (x: number, z: number) => boolean) {
    if (pts.length <= 2) return pts;
    const out: { x: number; z: number }[] = [];
    let ax = sx, az = sz;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      // find farthest visible point (limit look-ahead for performance)
      const limit = Math.min(pts.length - 1, i + 24);
      j = limit;
      while (j > i && !this.lineClear(ax, az, pts[j].x, pts[j].z, passable)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      az = pts[j].z;
      i = j + 1;
    }
    return out;
  }

  /** Conservative line-of-sight check sampling along the segment with unit clearance. */
  lineClear(ax: number, az: number, bx: number, bz: number, passable: (x: number, z: number) => boolean) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(len / 0.25);
    const r = 0.35; // clearance
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t, z = az + dz * t;
      if (!passable(Math.floor(x - r), Math.floor(z - r))) return false;
      if (!passable(Math.floor(x + r), Math.floor(z - r))) return false;
      if (!passable(Math.floor(x - r), Math.floor(z + r))) return false;
      if (!passable(Math.floor(x + r), Math.floor(z + r))) return false;
    }
    return true;
  }
}
