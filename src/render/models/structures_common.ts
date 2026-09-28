/** Helpers shared by building models. */
import * as THREE from 'three';
import { B, P, Col, V2, Template, Updater, byName, damp, powerSwitch, strut, hazardStripX, hazardStripZ } from './kit';

/** Concrete foundation slab (Aegis): fills ~96% of the footprint, darker kerb, hazard front edge. */
export function slabAegis(b: B, w: number, d: number, h = 0.08, hazardFront = true): void {
  const W = w - 0.06, D = d - 0.06;
  b.cboxB('paint', P.aConcreteDk, W, h, D, 0.025, 0, 0, 0);
  b.boxB('paint', P.aConcrete, W - 0.08, 0.012, D - 0.08, 0, h, 0);
  // expansion joints
  for (let x = -W / 2 + 0.5; x < W / 2 - 0.2; x += 1) b.box('paint', 0x7b786f, 0.012, 0.004, D - 0.1, x + 0.0, h + 0.014, 0);
  for (let z = -D / 2 + 0.5; z < D / 2 - 0.2; z += 1) b.box('paint', 0x7b786f, W - 0.1, 0.004, 0.012, 0, h + 0.014, z);
  if (hazardFront) hazardStripX(b, -W / 2 + 0.06, W / 2 - 0.06, h + 0.008, D / 2 - 0.07, 0.05, Math.max(6, Math.round(w * 7)));
}

/** Covenant plinth: black stone with bevelled edges and red inlay. */
export function slabCov(b: B, w: number, d: number, h = 0.09, team?: Col): void {
  const W = w - 0.06, D = d - 0.06;
  b.taper('paint', P.cBlack, W, D, W - 0.1, D - 0.1, h, 0, 0, 0);
  b.boxB('paint', 0x26272c, W - 0.16, 0.01, D - 0.16, 0, h, 0);
  for (const s of [1, -1]) {
    b.box('paint', P.cRed, W - 0.14, 0.008, 0.02, 0, h + 0.004, s * (D / 2 - 0.08));
    b.box('paint', P.cRed, 0.02, 0.008, D - 0.14, s * (W / 2 - 0.08), h + 0.004, 0);
  }
  if (team) {
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      b.box('paint', team, 0.12, 0.01, 0.04, sx * (W / 2 - 0.16), h + 0.006, sz * (D / 2 - 0.08));
    }
  }
}

/** Warning beacon on a small housing. */
export function beacon(b: B, x: number, y: number, z: number, key = 'e:red:blink', housing: Col = P.gunmetal): void {
  b.cyl('paint', housing, 0.025, 0.03, 0.03, 6, x, y + 0.015, z);
  b.sphere(key, 0, 0.022, x, y + 0.04, z, 1, 1, 1, 6, 4);
}

/** Square lattice mast (4 posts + zig-zag bracing on each face). */
export function lattice(b: B, x: number, y0: number, z: number, w: number, h: number, col: Col, segs: number, post = 0.03): void {
  const hw = w / 2;
  const corners: V2[] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [cx, cz] of corners) b.box('paint', col, post, h, post, x + cx, y0 + h / 2, z + cz);
  const sh = h / segs;
  for (let i = 0; i < segs; i++) {
    const ya = y0 + i * sh, yb = ya + sh;
    for (let f = 0; f < 4; f++) {
      const a = corners[f], c = corners[(f + 1) % 4];
      const flip = i % 2 === 0;
      strut(b, 'paint', col, [x + (flip ? a : c)[0], ya, z + (flip ? a : c)[1]], [x + (flip ? c : a)[0], yb, z + (flip ? c : a)[1]], post * 0.5);
    }
    b.box('paint', col, w, post * 0.6, post * 0.6, x, yb, z + hw);
    b.box('paint', col, w, post * 0.6, post * 0.6, x, yb, z - hw);
  }
}

/** Parabolic dish (open lathe) facing +Y, rim radius r, depth dd. */
export function dish(b: B, m: string, col: Col, r: number, dd: number, x = 0, y = 0, z = 0, seg = 16): void {
  const pts: V2[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push([Math.max(0.001, t * r), t * t * dd]);
  }
  // make it double-sided by adding a slightly offset back surface
  const back: V2[] = pts.map(([pr, py]) => [pr, py - 0.012] as V2).reverse();
  b.lathe(m, col, [...back, ...pts].map(([pr, py]) => [pr, py] as V2), seg, x, y, z);
}

/** Shipping container. */
export function container(b: B, x: number, y: number, z: number, len: number, col: Col, ry = 0): void {
  const g = new THREE.BoxGeometry(len, 0.16, 0.17);
  b.add(g, 'paint', col, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y + 0.08, z));
  const n = Math.round(len / 0.05);
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (i + 0.5) * (len / n);
    const cx = Math.cos(ry) * t, cz = -Math.sin(ry) * t;
    const r = new THREE.BoxGeometry(0.012, 0.15, 0.176);
    b.add(r, 'paint', new THREE.Color(col as number).multiplyScalar(0.8), new THREE.Matrix4().makeRotationY(ry).setPosition(x + cx, y + 0.08, z + cz));
  }
}

/** Flag pole with a team flag. */
export function flag(b: B, x: number, y: number, z: number, h: number, team: Col): void {
  b.cyl('metal', P.steel, 0.008, 0.012, h, 6, x, y + h / 2, z);
  b.sphere('metal', P.aGold, 0.016, x, y + h + 0.01, z, 1, 1, 1, 6, 4);
  b.box('paint', team, 0.2, 0.12, 0.008, x + 0.1, y + h - 0.08, z);
}

/** Hazard frame around a rectangle on the ground (at height y). */
export function hazardFrame(b: B, x: number, z: number, w: number, d: number, y: number, bw = 0.06): void {
  hazardStripX(b, x - w / 2, x + w / 2, y, z - d / 2 + bw / 2, bw, Math.round(w * 8));
  hazardStripX(b, x - w / 2, x + w / 2, y, z + d / 2 - bw / 2, bw, Math.round(w * 8));
  hazardStripZ(b, z - d / 2 + bw, z + d / 2 - bw, y, x - w / 2 + bw / 2, bw, Math.round(d * 8));
  hazardStripZ(b, z - d / 2 + bw, z + d / 2 - bw, y, x + w / 2 - bw / 2, bw, Math.round(d * 8));
}

/** Arrow / chevron marking on the ground pointing to +Z (or -Z with dir -1). */
export function chevron(b: B, x: number, y: number, z: number, s: number, col: Col, dir = 1): void {
  b.box('paint', col, s * 0.5, 0.01, s * 0.12, x - s * 0.18, y, z, 0, dir * 0.8, 0);
  b.box('paint', col, s * 0.5, 0.01, s * 0.12, x + s * 0.18, y, z, 0, -dir * 0.8, 0);
}

// ---------------------------------------------------------------------------
// Building animation
// ---------------------------------------------------------------------------
export interface BAnimOpts {
  spins?: { name: string; axis: 'x' | 'y' | 'z'; rate: number; power?: boolean }[];
  sways?: { name: string; axis: 'x' | 'y' | 'z'; amp: number; freq: number; power?: boolean; phase?: number }[];
  bobs?: { name: string; amp: number; freq: number; power?: boolean }[];
  door?: { name: string; axis: 'x' | 'y' | 'z'; open: number };
  extra?: (root: THREE.Object3D) => Updater | undefined;
  /** dim glows when unpowered (default true) */
  power?: boolean;
}

export function bAnim(o: BAnimOpts): Template['anim'] {
  return (root) => {
    const sw = o.power === false ? null : powerSwitch(root);
    const spins = (o.spins ?? []).map((s) => ({ ...s, obj: byName(root, s.name) }));
    const sways = (o.sways ?? []).map((s) => ({ ...s, obj: byName(root, s.name), base: byName(root, s.name)?.rotation[s.axis] ?? 0 }));
    const bobs = (o.bobs ?? []).map((s) => ({ ...s, obj: byName(root, s.name), base: byName(root, s.name)?.position.y ?? 0 }));
    const door = o.door ? byName(root, o.door.name) : undefined;
    const doorBase = door ? door.position[o.door!.axis] : 0;
    let doorT = 0;
    let spinSpeed = 1;
    const extra = o.extra?.(root);
    const phase = Math.random() * 10;
    return (dt, s) => {
      sw?.(s.powered);
      spinSpeed = damp(spinSpeed, s.powered ? 1 : 0, 2, dt);
      for (const sp of spins) if (sp.obj) sp.obj.rotation[sp.axis] += sp.rate * dt * (sp.power === false ? 1 : spinSpeed);
      for (const sy of sways) {
        if (!sy.obj) continue;
        const k = sy.power ? spinSpeed : 1;
        sy.obj.rotation[sy.axis] = sy.base + Math.sin(s.time * sy.freq + phase + (sy.phase ?? 0)) * sy.amp * k;
      }
      for (const bo of bobs) {
        if (!bo.obj) continue;
        const k = bo.power ? spinSpeed : 1;
        bo.obj.position.y = bo.base + Math.sin(s.time * bo.freq + phase) * bo.amp * k;
      }
      if (door && o.door) {
        doorT = damp(doorT, s.producing ? 1 : 0, 3, dt);
        door.position[o.door.axis] = doorBase + doorT * o.door.open;
      }
      extra?.(dt, s);
    };
  };
}
