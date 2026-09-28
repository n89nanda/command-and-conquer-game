import type { Unit } from './Unit';

/** Uniform grid spatial hash for units (rebuilt each tick). */
export class SpatialHash {
  readonly cell: number;
  readonly cw: number;
  readonly ch: number;
  private cells: Unit[][];

  constructor(w: number, h: number, cell = 4) {
    this.cell = cell;
    this.cw = Math.ceil(w / cell) + 1;
    this.ch = Math.ceil(h / cell) + 1;
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }

  rebuild(units: Unit[]) {
    for (const c of this.cells) c.length = 0;
    for (const u of units) {
      if (u.dead) continue;
      const cx = Math.max(0, Math.min(this.cw - 1, Math.floor(u.x / this.cell)));
      const cz = Math.max(0, Math.min(this.ch - 1, Math.floor(u.z / this.cell)));
      this.cells[cz * this.cw + cx].push(u);
    }
  }

  query(x: number, z: number, r: number, cb: (u: Unit) => void) {
    const x0 = Math.max(0, Math.floor((x - r) / this.cell));
    const x1 = Math.min(this.cw - 1, Math.floor((x + r) / this.cell));
    const z0 = Math.max(0, Math.floor((z - r) / this.cell));
    const z1 = Math.min(this.ch - 1, Math.floor((z + r) / this.cell));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells[cz * this.cw + cx];
        for (let i = 0; i < c.length; i++) cb(c[i]);
      }
  }

  forEachPairCandidate(cb: (list: Unit[], neighbours: Unit[][]) => void) {
    for (let cz = 0; cz < this.ch; cz++)
      for (let cx = 0; cx < this.cw; cx++) {
        const c = this.cells[cz * this.cw + cx];
        if (c.length === 0) continue;
        const nb: Unit[][] = [];
        // right, down-left, down, down-right neighbours (each pair once)
        if (cx + 1 < this.cw) nb.push(this.cells[cz * this.cw + cx + 1]);
        if (cz + 1 < this.ch) {
          if (cx > 0) nb.push(this.cells[(cz + 1) * this.cw + cx - 1]);
          nb.push(this.cells[(cz + 1) * this.cw + cx]);
          if (cx + 1 < this.cw) nb.push(this.cells[(cz + 1) * this.cw + cx + 1]);
        }
        cb(c, nb);
      }
  }
}
