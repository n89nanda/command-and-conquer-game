// Building placement for the computer player.
//
// Rules (all enforced before asking World.canPlace):
//  * 1-tile lanes: a structure never touches another structure (walls excepted),
//    so units can always walk between buildings.
//  * Exits / docks: factories, barracks and refineries need their exit tile and
//    the tile beyond it free; nothing is placed on the approach zone in front of them.
//  * No pockets: a flood fill checks that the placement doesn't enclose any
//    reachable tile of the base area.
//  * Ore is precious: covering crystals is heavily penalised (except refineries,
//    which want to be close to it).

import { BUILDINGS } from '../../data/buildings';
import type { BuildingDef } from '../../data/types';
import type { Building } from '../Building';
import type { Player } from '../Player';
import type { World } from '../World';
import type { BuildingRole } from './AIData';

export interface PlacementContext {
  /** main base centre (world coords) */
  cx: number;
  cz: number;
  /** unit vector pointing at the enemy */
  ex: number;
  ez: number;
  /** preferred spot (defences, expansion crawling) */
  spot?: { x: number; z: number } | null;
  /** minimum spacing between structures of the same def (defences) */
  spreadSameDef?: number;
}

export interface Spot {
  tx: number;
  tz: number;
}

const hasExit = (d: BuildingDef) => !!(d.refinery || d.produces === 'factory' || d.produces === 'barracks');

export class BasePlanner {
  private world: World;
  private player: Player;
  private stamp: Uint32Array;
  private stampGen = 1;
  private reserved: Uint8Array;
  private keepClear: Uint8Array;
  private sat: Float64Array | null = null;
  private satTime = -999;
  private reach: Uint32Array;
  private reachGen = 1;
  private bfsQueue: Int32Array;

  constructor(world: World, player: Player) {
    this.world = world;
    this.player = player;
    const n = world.map.w * world.map.h;
    this.stamp = new Uint32Array(n);
    this.reserved = new Uint8Array(n);
    this.keepClear = new Uint8Array(n);
    this.reach = new Uint32Array(n);
    this.bfsQueue = new Int32Array(n);
  }

  // ---------------------------------------------------------------- ore density
  /** Summed-area table over ore amounts, refreshed at most every 10 s. */
  private oreSat(): Float64Array {
    const world = this.world;
    if (this.sat && world.time - this.satTime < 10) return this.sat;
    const { w, h, ore } = world.map;
    const W = w + 1;
    const sat = this.sat ?? new Float64Array(W * (h + 1));
    for (let z = 0; z < h; z++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += ore[z * w + x];
        sat[(z + 1) * W + x + 1] = sat[z * W + x + 1] + row;
      }
    }
    this.sat = sat;
    this.satTime = world.time;
    return sat;
  }

  /** Total ore in the square of half-size r around (x,z). */
  oreAround(x: number, z: number, r: number): number {
    const sat = this.oreSat();
    const { w, h } = this.world.map;
    const W = w + 1;
    const x0 = Math.max(0, Math.floor(x - r)), z0 = Math.max(0, Math.floor(z - r));
    const x1 = Math.min(w, Math.floor(x + r) + 1), z1 = Math.min(h, Math.floor(z + r) + 1);
    if (x1 <= x0 || z1 <= z0) return 0;
    return sat[z1 * W + x1] - sat[z0 * W + x1] - sat[z1 * W + x0] + sat[z0 * W + x0];
  }

  // ---------------------------------------------------------------- masks
  private buildMasks(own: Building[]) {
    const { w } = this.world.map;
    this.reserved.fill(0);
    this.keepClear.fill(0);
    const mark = (arr: Uint8Array, x: number, z: number) => {
      if (this.world.map.inBounds(x, z)) arr[z * w + x] = 1;
    };
    for (const b of this.world.buildings) {
      if (b.dead) continue;
      if (b.def.repairPad) {
        for (let z = b.tz - 1; z <= b.tz + b.h; z++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) mark(this.reserved, x, z);
      }
      if (!hasExit(b.def)) continue;
      const ex = b.tx + Math.floor(b.w / 2), ez = b.tz + b.h;
      const wide = b.def.refinery ? 1 : 0;
      for (let dx = -wide; dx <= wide; dx++) mark(this.reserved, ex + dx, ez);
      if (b.def.refinery) mark(this.reserved, ex, ez + 1);
      // approach / exit lane (soft)
      if (b.owner === this.player) {
        for (let dz = 1; dz <= 3; dz++) for (let dx = -1 - wide; dx <= 1 + wide; dx++) mark(this.keepClear, ex + dx, ez + dz);
      }
    }
    // rally area in front of the construction yard is kept clear too
    for (const b of own) {
      if (b.def.produces !== 'yard') continue;
      for (let dz = 0; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) mark(this.keepClear, b.tx + 1 + dx, b.tz + b.h + dz);
    }
  }

  private tileFree(x: number, z: number): boolean {
    const m = this.world.map;
    if (!m.buildable(x, z)) return false;
    if (this.reserved[z * m.w + x]) return false;
    return true;
  }

  /** Structures within the 1-tile ring around the rectangle? */
  private laneClear(tx: number, tz: number, w: number, h: number, isSmall: boolean): boolean {
    const m = this.world.map;
    for (let z = tz - 1; z <= tz + h; z++)
      for (let x = tx - 1; x <= tx + w; x++) {
        if (x >= tx && x < tx + w && z >= tz && z < tz + h) continue;
        if (!m.inBounds(x, z)) continue;
        const id = m.building[z * m.w + x];
        if (id !== 0) {
          if (isSmall) {
            const b = this.buildingById(id);
            if (b && b.def.wall) continue;
          }
          return false;
        }
      }
    return true;
  }

  private idCache = new Map<number, Building>();
  private buildingById(id: number): Building | undefined {
    let b = this.idCache.get(id);
    if (!b || b.dead) {
      b = this.world.buildings.find((x) => x.id === id);
      if (b) this.idCache.set(id, b);
    }
    return b;
  }

  // ---------------------------------------------------------------- connectivity
  private window = { x0: 0, z0: 0, x1: 0, z1: 0 };

  /** Flood fill from the window border. Returns reached passable tile count. */
  private flood(blockTx: number, blockTz: number, bw: number, bh: number): number {
    const m = this.world.map;
    const { x0, z0, x1, z1 } = this.window;
    const gen = ++this.reachGen;
    const reach = this.reach;
    const q = this.bfsQueue;
    let qh = 0, qt = 0;
    const blocked = (x: number, z: number) => x >= blockTx && x < blockTx + bw && z >= blockTz && z < blockTz + bh;
    const push = (x: number, z: number) => {
      const i = z * m.w + x;
      if (reach[i] === gen) return;
      if (!m.passable(x, z) || blocked(x, z)) return;
      reach[i] = gen;
      q[qt++] = i;
    };
    for (let x = x0; x <= x1; x++) {
      push(x, z0);
      push(x, z1);
    }
    for (let z = z0; z <= z1; z++) {
      push(x0, z);
      push(x1, z);
    }
    while (qh < qt) {
      const i = q[qh++];
      const x = i % m.w, z = (i - x) / m.w;
      if (x > x0) push(x - 1, z);
      if (x < x1) push(x + 1, z);
      if (z > z0) push(x, z - 1);
      if (z < z1) push(x, z + 1);
    }
    return qt;
  }

  private isReached(x: number, z: number) {
    const m = this.world.map;
    return m.inBounds(x, z) && this.reach[z * m.w + x] === this.reachGen;
  }

  // ---------------------------------------------------------------- main search
  findPlacement(defId: string, role: BuildingRole, ctx: PlacementContext): Spot | null {
    const world = this.world;
    const m = world.map;
    const def = BUILDINGS[defId];
    if (!def) return null;
    const [bw, bh] = def.footprint;
    const own = world.buildings.filter((b) => !b.dead && b.owner === this.player && !b.def.wall && b.def.faction !== 'both');
    if (own.length === 0) return null;
    this.buildMasks(own);
    const isSmall = bw === 1 && bh === 1;
    const exit = hasExit(def);

    // window for connectivity checks
    let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
    for (const b of own) {
      wx0 = Math.min(wx0, b.tx);
      wz0 = Math.min(wz0, b.tz);
      wx1 = Math.max(wx1, b.tx + b.w);
      wz1 = Math.max(wz1, b.tz + b.h);
    }
    const pad = 9;
    this.window = {
      x0: Math.max(0, wx0 - pad),
      z0: Math.max(0, wz0 - pad),
      x1: Math.min(m.w - 1, wx1 + pad),
      z1: Math.min(m.h - 1, wz1 + pad),
    };

    const gen = ++this.stampGen;
    const cands: { tx: number; tz: number; s: number }[] = [];
    const sameDef = ctx.spreadSameDef
      ? world.buildings.filter((b) => !b.dead && b.owner === this.player && b.def.id === defId)
      : [];
    const ownRefs = own.filter((b) => b.def.refinery);

    for (const b of own) {
      const r = Math.min(b.def.buildRadius ?? 3, 3);
      for (let tz = b.tz - r - bh; tz <= b.tz + b.h + r; tz++)
        for (let tx = b.tx - r - bw; tx <= b.tx + b.w + r; tx++) {
          if (tx < 1 || tz < 1 || tx + bw >= m.w - 1 || tz + bh >= m.h - 1) continue;
          const si = tz * m.w + tx;
          if (this.stamp[si] === gen) continue;
          this.stamp[si] = gen;
          // hard checks
          let ok = true;
          let oreTiles = 0, clearTiles = 0;
          for (let z = tz; z < tz + bh && ok; z++)
            for (let x = tx; x < tx + bw; x++) {
              if (!this.tileFree(x, z)) {
                ok = false;
                break;
              }
              const i = z * m.w + x;
              if (m.oreType[i]) oreTiles++;
              if (this.keepClear[i]) clearTiles++;
            }
          if (!ok) continue;
          if (!this.laneClear(tx, tz, bw, bh, isSmall)) continue;
          let exX = 0, exZ = 0;
          if (exit) {
            exX = tx + Math.floor(bw / 2);
            exZ = tz + bh;
            if (!m.passable(exX, exZ) || !m.passable(exX, exZ + 1)) continue;
            if (this.reserved[exZ * m.w + exX]) continue;
            // the whole row in front of a refinery must be open for docking
            if (def.refinery && (!m.passable(exX - 1, exZ) || !m.passable(exX + 1, exZ))) continue;
          }
          // soft score
          const cx = tx + bw / 2, cz = tz + bh / 2;
          const dx = cx - ctx.cx, dz = cz - ctx.cz;
          const d = Math.hypot(dx, dz);
          const along = dx * ctx.ex + dz * ctx.ez; // + toward enemy
          let s = d;
          s += clearTiles * 6;
          switch (role) {
            case 'power':
            case 'tech':
            case 'superweapon':
            case 'radar':
              s += along * 0.5;
              break;
            case 'barracks':
            case 'factory':
            case 'airfield':
              s -= along * 0.25;
              break;
            case 'refinery': {
              const ore = this.oreAround(exX + 0.5, exZ + 1, 6) / 600; // ~full tiles
              s = d * 0.25 - Math.min(ore, 40) * 1.2;
              for (const r2 of ownRefs) if (Math.hypot(r2.x - cx, r2.z - cz) < 7) s += 14;
              break;
            }
            default:
              break;
          }
          if (role !== 'refinery') s += oreTiles * 5;
          else s += oreTiles * 1.5;
          if (ctx.spot) {
            const ds = Math.hypot(cx - ctx.spot.x, cz - ctx.spot.z);
            s = role === 'defense' || role === 'wall' ? ds * 2 + d * 0.1 : s * 0.3 + ds * 1.5;
          }
          if (ctx.spreadSameDef) {
            for (const o of sameDef) {
              const dd = Math.hypot(o.x - cx, o.z - cz);
              if (dd < ctx.spreadSameDef) s += (ctx.spreadSameDef - dd) * 4;
            }
          }
          cands.push({ tx, tz, s });
        }
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => a.s - b.s);

    // baseline reachability
    const before = this.flood(-99, -99, 0, 0);
    let tested = 0;
    for (const c of cands) {
      if (tested >= 30) break;
      if (!world.canPlace(this.player, defId, c.tx, c.tz)) continue;
      tested++;
      // how many of the footprint tiles were reachable before (they'll vanish)
      this.flood(-99, -99, 0, 0);
      let footReach = 0;
      for (let z = c.tz; z < c.tz + bh; z++) for (let x = c.tx; x < c.tx + bw; x++) if (this.isReached(x, z)) footReach++;
      const after = this.flood(c.tx, c.tz, bw, bh);
      if (after < before - footReach) continue; // would enclose something
      if (exit) {
        const exX = c.tx + Math.floor(bw / 2), exZ = c.tz + bh;
        if (!this.isReached(exX, exZ)) continue;
      }
      return { tx: c.tx, tz: c.tz };
    }
    return null;
  }

  /**
   * Find a spot near (x,z) where an MCV can deploy a 3x3 yard: returns the
   * tile the MCV should drive to.
   */
  findDeploySpot(x: number, z: number, maxR = 10, avoidOre = true): { x: number; z: number } | null {
    const m = this.world.map;
    let best: { x: number; z: number } | null = null;
    let bs = Infinity;
    for (let dz = -maxR; dz <= maxR; dz++)
      for (let dx = -maxR; dx <= maxR; dx++) {
        const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz;
        const tx = cx - 1, tz = cz - 1;
        let ok = true;
        let ore = 0;
        for (let zz = tz - 1; zz <= tz + 3 && ok; zz++)
          for (let xx = tx - 1; xx <= tx + 3; xx++) {
            const inner = xx >= tx && xx < tx + 3 && zz >= tz && zz < tz + 3;
            if (inner) {
              if (!m.buildable(xx, zz) || this.world.padAt(xx, zz) || this.world.isReserved(xx, zz)) {
                ok = false;
                break;
              }
            } else if (!m.passable(xx, zz)) {
              // keep a lane around the yard
              ok = false;
              break;
            }
            if (m.inBounds(xx, zz) && m.oreType[zz * m.w + xx]) ore++;
          }
        if (!ok) continue;
        const s = Math.hypot(dx, dz) + (avoidOre ? ore * 2 : 0);
        if (s < bs) {
          bs = s;
          best = { x: cx + 0.5, z: cz + 0.5 };
        }
      }
    return best;
  }
}
