import { clamp, lerp } from './util';

export const enum Terrain {
  Grass = 0,
  Dirt = 1,
  Sand = 2,
  Rock = 3, // cliffs / mountains — impassable
  Water = 4, // impassable for ground
  Road = 5,
  Concrete = 6, // base pavement
}

export type Theater = 'temperate' | 'desert' | 'winter' | 'wasteland';

export interface Doodad {
  kind: string;
  variant: number;
  x: number;
  z: number;
  rot: number;
  scale: number;
  blocks: boolean;
}

/** Riftite amounts per tile. */
export const ORE_MAX = 600; // credits per normal tile when fully grown
export const RICH_MAX = 1000;

export class GameMap {
  readonly w: number;
  readonly h: number;
  theater: Theater = 'temperate';
  terrain: Uint8Array;
  /** vertex heights, (w+1)*(h+1) */
  heights: Float32Array;
  ore: Float32Array; // credits available on tile
  oreType: Uint8Array; // 0 none, 1 normal, 2 rich
  /** Blocking by static things: buildings (entity id + 1), 0 = free. */
  building: Int32Array;
  /** Blocked by doodads (trees / rocks). */
  doodadBlock: Uint8Array;
  doodads: Doodad[] = [];
  /** Incremented whenever passability changes (paths may need recompute). */
  passVersion = 0;
  /** Incremented when ore changes (renderer refresh). */
  oreVersion = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h);
    this.heights = new Float32Array((w + 1) * (h + 1));
    this.ore = new Float32Array(w * h);
    this.oreType = new Uint8Array(w * h);
    this.building = new Int32Array(w * h);
    this.doodadBlock = new Uint8Array(w * h);
  }

  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  idx(x: number, z: number) {
    return z * this.w + x;
  }

  terrainAt(x: number, z: number): Terrain {
    if (!this.inBounds(x, z)) return Terrain.Rock;
    return this.terrain[z * this.w + x] as Terrain;
  }

  /** Passable by ground units (ignores other units). */
  passable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = z * this.w + x;
    const t = this.terrain[i];
    if (t === Terrain.Rock || t === Terrain.Water) return false;
    if (this.building[i] !== 0) return false;
    if (this.doodadBlock[i]) return false;
    return true;
  }

  /** Can a building be placed here (terrain-wise; ignores units)? */
  buildable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = z * this.w + x;
    const t = this.terrain[i];
    if (t === Terrain.Rock || t === Terrain.Water) return false;
    if (this.building[i] !== 0) return false;
    if (this.doodadBlock[i]) return false;
    return true;
  }

  moveCost(x: number, z: number): number {
    const t = this.terrain[z * this.w + x];
    if (t === Terrain.Road || t === Terrain.Concrete) return 0.8;
    if (this.oreType[z * this.w + x]) return 1.15;
    return 1;
  }

  vh(x: number, z: number) {
    x = clamp(x, 0, this.w);
    z = clamp(z, 0, this.h);
    return this.heights[z * (this.w + 1) + x];
  }

  /** Bilinear terrain height at world position. */
  heightAt(fx: number, fz: number): number {
    const x = clamp(fx, 0, this.w - 0.0001);
    const z = clamp(fz, 0, this.h - 0.0001);
    const xi = Math.floor(x), zi = Math.floor(z);
    const tx = x - xi, tz = z - zi;
    const a = this.vh(xi, zi), b = this.vh(xi + 1, zi), c = this.vh(xi, zi + 1), d = this.vh(xi + 1, zi + 1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  setBuilding(x0: number, z0: number, w: number, h: number, id: number) {
    for (let z = z0; z < z0 + h; z++)
      for (let x = x0; x < x0 + w; x++) {
        if (!this.inBounds(x, z)) continue;
        this.building[z * this.w + x] = id;
      }
    this.passVersion++;
  }

  /** Remove the ore from footprint (e.g. building placed on crystals). */
  clearOre(x0: number, z0: number, w: number, h: number) {
    for (let z = z0; z < z0 + h; z++)
      for (let x = x0; x < x0 + w; x++) {
        if (!this.inBounds(x, z)) continue;
        const i = z * this.w + x;
        if (this.oreType[i]) {
          this.ore[i] = 0;
          this.oreType[i] = 0;
          this.oreVersion++;
        }
      }
  }

  /** Nearest passable tile to (x,z) (spiral search). */
  nearestPassable(x: number, z: number, maxR = 20): [number, number] | null {
    x = clamp(Math.floor(x), 0, this.w - 1);
    z = clamp(Math.floor(z), 0, this.h - 1);
    if (this.passable(x, z)) return [x, z];
    for (let r = 1; r <= maxR; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (this.passable(nx, nz)) {
            const d = dx * dx + dz * dz;
            if (d < bd) {
              bd = d;
              best = [nx, nz];
            }
          }
        }
      if (best) return best;
    }
    return null;
  }

  totalOre(): number {
    let s = 0;
    for (let i = 0; i < this.ore.length; i++) s += this.ore[i];
    return s;
  }
}
