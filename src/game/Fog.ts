import type { Entity } from './Entity';

const circleCache = new Map<number, Int16Array>();
function circle(r: number): Int16Array {
  const key = Math.round(r * 2);
  let c = circleCache.get(key);
  if (c) return c;
  const rr = key / 2;
  const pts: number[] = [];
  const R = Math.ceil(rr);
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) if (x * x + z * z <= rr * rr + 0.5) pts.push(x, z);
  c = new Int16Array(pts);
  circleCache.set(key, c);
  return c;
}

/** Visibility for one player. */
export class Fog {
  readonly w: number;
  readonly h: number;
  visible: Uint8Array;
  explored: Uint8Array;
  version = 0;
  revealAll = false;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.visible = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
  }

  recompute(entities: Iterable<Entity>) {
    const { w, h, visible, explored } = this;
    visible.fill(0);
    for (const e of entities) {
      const cx = Math.floor(e.x), cz = Math.floor(e.z);
      const c = circle(e.sight + (e.kind === 'building' ? 1 : 0));
      for (let i = 0; i < c.length; i += 2) {
        const x = cx + c[i], z = cz + c[i + 1];
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const k = z * w + x;
        visible[k] = 1;
        explored[k] = 1;
      }
    }
    if (this.revealAll) {
      visible.fill(1);
      explored.fill(1);
    }
    this.version++;
  }

  reveal(x: number, z: number, r: number) {
    const c = circle(r);
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let i = 0; i < c.length; i += 2) {
      const tx = cx + c[i], tz = cz + c[i + 1];
      if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) continue;
      this.explored[tz * this.w + tx] = 1;
    }
    this.version++;
  }

  isVisible(x: number, z: number) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) return false;
    return this.visible[tz * this.w + tx] === 1;
  }
  isExplored(x: number, z: number) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) return false;
    return this.explored[tz * this.w + tx] === 1;
  }
}
