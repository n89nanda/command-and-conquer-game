/** Aegis Coalition structures. Centred on footprint, ground y=0, door/dock side = +Z. */
import * as THREE from 'three';
import {
  B, P, Template, finalizeTemplate, node, ventTop, windowsZ, windowsX, antenna, pipe, sandbags, strut,
  hazardStripX, hazardStripZ, byName, damp, T,
} from './kit';
import { slabAegis, beacon, lattice, dish, container, flag, hazardFrame, chevron, bAnim } from './structures_common';

type F = (team: THREE.Color) => Template;
const Y = 0.092; // top of the standard slab

function bld(): B {
  return new B({ aoHeight: 0.45, aoMin: 0.5 });
}

// ---------------------------------------------------------------------------
// Construction Yard 3x3
// ---------------------------------------------------------------------------
const aYard: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3);
  // main hall (back-left)
  b.boxB('paint', P.aSandDk, 1.64, 0.08, 1.34, -0.5, Y, -0.65);
  b.cboxB('paint', P.aSand, 1.6, 0.62, 1.3, 0.02, -0.5, Y, -0.65);
  b.hull('paint', P.aSteel, [
    [-1.33, Y + 0.6, -1.33], [0.33, Y + 0.6, -1.33], [-1.33, Y + 0.6, 0.03], [0.33, Y + 0.6, 0.03],
    [-1.26, Y + 0.8, -0.76], [0.26, Y + 0.8, -0.76], [-1.26, Y + 0.8, -0.54], [0.26, Y + 0.8, -0.54],
  ]);
  b.box('paint', team, 1.44, 0.02, 0.26, -0.5, Y + 0.806, -0.65);
  b.box('paint', team, 1.2, 0.012, 0.32, -0.5, Y + 0.715, -0.26, 0.31, 0, 0);
  b.box('paint', P.aGold, 1.62, 0.02, 0.012, -0.5, Y + 0.6, 0.012);
  // front face: big bay door + windows
  b.box('paint', P.dark, 0.6, 0.42, 0.02, -0.75, Y + 0.21, 0.0);
  for (let i = 0; i < 5; i++) b.box('paint', P.aSteelDk, 0.58, 0.012, 0.024, -0.75, Y + 0.05 + i * 0.08, 0.004);
  hazardStripX(b, -1.07, -0.43, Y + 0.44, 0.005, 0.03, 8);
  windowsZ(b, -0.35, 0.25, Y + 0.44, 0.0, 4, 0.1, 0.09);
  windowsZ(b, -0.35, 0.25, Y + 0.25, 0.0, 4, 0.1, 0.09);
  ventTop(b, -1.0, Y + 0.8, -0.65, 0.25, 0.2, 6, P.aSteelDk);
  // control tower (back-right)
  b.cboxB('paint', P.aSteel, 0.6, 1.08, 0.6, 0.02, 0.92, Y, -0.95);
  b.boxB('paint', team, 0.615, 0.1, 0.615, 0.92, Y + 0.72, -0.95);
  b.boxB('paint', P.aGold, 0.62, 0.02, 0.62, 0.92, Y + 0.84, -0.95);
  windowsX(b, -1.15, -0.75, Y + 0.45, 0.92 - 0.3, 3, 0.08, 0.1, 'e:win', -1);
  windowsZ(b, 0.72, 1.12, Y + 0.45, -0.95 + 0.3, 3, 0.08, 0.1);
  b.cboxB('paint', P.aSandDk, 0.72, 0.05, 0.72, 0.015, 0.92, Y + 1.08, -0.95);
  b.boxB('e:win', 0, 0.64, 0.15, 0.64, 0.92, Y + 1.13, -0.95);
  for (const s of [-1, 1]) for (const k of [-0.16, 0.16]) {
    b.box('paint', P.aSteelDk, 0.02, 0.15, 0.66, 0.92 + k, Y + 1.205, -0.95);
    b.box('paint', P.aSteelDk, 0.66, 0.15, 0.02, 0.92, Y + 1.205, -0.95 + k);
    void s;
  }
  b.cboxB('paint', P.aSteelDk, 0.76, 0.06, 0.76, 0.02, 0.92, Y + 1.28, -0.95);
  antenna(b, 1.12, Y + 1.34, -1.15, 0.4);
  antenna(b, 0.75, Y + 1.34, -1.12, 0.25, P.gunmetal, 'e:red:blink');
  // walkway tower <-> hall
  b.boxB('paint', P.aSteelDk, 0.36, 0.12, 0.24, 0.47, Y + 0.45, -0.95);
  // construction pad (front)
  b.boxB('paint', 0x8c897f, 1.7, 0.02, 1.2, 0.35, Y, 0.72);
  hazardFrame(b, 0.35, 0.72, 1.7, 1.2, Y + 0.02, 0.06);
  // container stack + crates at front-left
  container(b, -1.05, Y, 0.35, 0.5, 0x6d7f5a, Math.PI / 2);
  container(b, -0.85, Y, 0.35, 0.5, 0x8f5a3a, Math.PI / 2);
  container(b, -0.95, Y + 0.16, 0.35, 0.5, P.aSteel, Math.PI / 2);
  b.cboxB('paint', P.wood, 0.14, 0.12, 0.14, 0.01, -0.6, Y, 1.15);
  b.cboxB('paint', P.wood, 0.12, 0.1, 0.12, 0.01, -0.42, Y, 1.2);
  // pipes along hall
  pipe(b, 'paint', P.steel, [-1.37, Y + 0.12, -1.2], [-1.37, Y + 0.12, 0.0], 0.03);
  pipe(b, 'paint', P.steel, [-1.37, Y + 0.2, -1.2], [-1.37, Y + 0.2, 0.0], 0.03);
  beacon(b, 0.3, Y + 0.8, -1.3, 'e:amber:blink');
  beacon(b, -1.3, Y + 0.8, -1.3, 'e:amber:blink');
  // tower crane mast (front right)
  const mx = 1.08, mz = 1.02, mh = 1.72;
  b.boxB('paint', P.aConcreteDk, 0.26, 0.06, 0.26, mx, Y, mz);
  lattice(b, mx, Y + 0.06, mz, 0.14, mh, P.hazardY, 9, 0.025);
  // small jib crane (front left)
  const sx = -1.12, sz = 1.1, sh = 1.0;
  b.boxB('paint', P.aConcreteDk, 0.2, 0.05, 0.2, sx, Y, sz);
  lattice(b, sx, Y + 0.05, sz, 0.1, sh, P.hazardY, 6, 0.02);
  root.add(b.meshes());

  // crane 1 jib
  const c = new B({ aoHeight: 0 });
  c.boxB('paint', P.aSandDk, 0.2, 0.12, 0.18, 0, 0, 0); // slewing unit + cab
  c.box('paint', 0x5da6f0, 0.02, 0.06, 0.12, 0.1, 0.07, 0);
  // jib (towards -X)
  const jl = 1.45;
  strut(c, 'paint', P.hazardY, [0, 0.12, 0.05], [-jl, 0.12, 0.05], 0.022);
  strut(c, 'paint', P.hazardY, [0, 0.12, -0.05], [-jl, 0.12, -0.05], 0.022);
  strut(c, 'paint', P.hazardY, [0, 0.2, 0], [-jl, 0.14, 0], 0.02);
  for (let i = 0; i < 10; i++) {
    const x0 = -i * (jl / 10), x1 = -(i + 1) * (jl / 10);
    const y0 = 0.2 - (0.06 * i) / 10, y1 = 0.2 - (0.06 * (i + 1)) / 10;
    strut(c, 'paint', P.hazardY, [x0, 0.12, 0.05], [x1, y1, 0], 0.01);
    strut(c, 'paint', P.hazardY, [x0, y0, 0], [x1, 0.12, -0.05], 0.01);
  }
  // counter jib + weight
  strut(c, 'paint', P.hazardY, [0, 0.12, 0], [0.45, 0.12, 0], 0.05, 0.1);
  c.boxB('paint', P.aConcreteDk, 0.14, 0.12, 0.14, 0.4, 0.06, 0);
  // apex + ties
  strut(c, 'paint', P.hazardY, [0, 0.12, 0], [0, 0.42, 0], 0.03);
  strut(c, 'paint', P.gunmetal, [0, 0.42, 0], [-jl * 0.7, 0.16, 0], 0.008);
  strut(c, 'paint', P.gunmetal, [0, 0.42, 0], [0.4, 0.18, 0], 0.008);
  beacon(c, 0, 0.42, 0, 'e:red:blink');
  beacon(c, -jl, 0.13, 0, 'e:red:blink');
  // trolley, cable, hook + suspended beam
  c.box('paint', P.gunmetal, 0.06, 0.03, 0.12, -1.0, 0.1, 0);
  c.cyl('paint', 0x222222, 0.004, 0.004, 0.62, 4, -1.0, -0.22, 0);
  c.box('paint', P.hazardY, 0.04, 0.05, 0.04, -1.0, -0.55, 0);
  c.box('paint', P.aSteel, 0.5, 0.05, 0.06, -1.0, -0.6, 0);
  const crane = node('crane', c, mx, Y + 0.06 + mh, mz);
  crane.rotation.y = -0.9;
  root.add(crane);

  // crane 2 jib
  const c2 = new B({ aoHeight: 0 });
  c2.boxB('paint', P.aSandDk, 0.14, 0.09, 0.12, 0, 0, 0);
  strut(c2, 'paint', P.hazardY, [0, 0.08, 0], [0.95, 0.08, 0], 0.035, 0.05);
  strut(c2, 'paint', P.hazardY, [0, 0.08, 0], [-0.3, 0.08, 0], 0.035, 0.05);
  c2.boxB('paint', P.aConcreteDk, 0.1, 0.08, 0.1, -0.28, 0.02, 0);
  strut(c2, 'paint', P.hazardY, [0, 0.08, 0], [0, 0.26, 0], 0.025);
  strut(c2, 'paint', P.gunmetal, [0, 0.26, 0], [0.8, 0.1, 0], 0.007);
  c2.cyl('paint', 0x222222, 0.004, 0.004, 0.4, 4, 0.7, -0.14, 0);
  c2.box('paint', P.hazardY, 0.035, 0.04, 0.035, 0.7, -0.36, 0);
  beacon(c2, 0, 0.26, 0, 'e:red:blink');
  const crane2 = node('crane2', c2, sx, Y + 0.05 + sh, sz);
  crane2.rotation.y = 0.3;
  root.add(crane2);

  return finalizeTemplate(root, [], bAnim({
    sways: [
      { name: 'crane', axis: 'y', amp: 0.55, freq: 0.35 },
      { name: 'crane2', axis: 'y', amp: 0.7, freq: 0.5, phase: 1.3 },
    ],
  }));
};

// ---------------------------------------------------------------------------
// Fusion Reactor 2x2
// ---------------------------------------------------------------------------
const aPower: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 2, 2);
  const rx = -0.25, rz = 0.1;
  b.cyl('paint', P.aSteelDk, 0.56, 0.6, 0.12, 20, rx, Y + 0.06, rz);
  b.cyl('paint', P.aSand, 0.48, 0.5, 0.42, 20, rx, Y + 0.33, rz);
  b.cyl('paint', team, 0.505, 0.505, 0.06, 20, rx, Y + 0.2, rz);
  b.cyl('paint', P.aGold, 0.49, 0.49, 0.02, 20, rx, Y + 0.545, rz);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box('paint', P.aSandDk, 0.05, 0.4, 0.05, rx + Math.cos(a) * 0.49, Y + 0.33, rz + Math.sin(a) * 0.49, 0, -a, 0);
  }
  b.dome('paint', P.aSteel, 0.47, rx, Y + 0.54, rz, 0.5, 20, 6);
  b.cyl('paint', P.aSteelDk, 0.14, 0.16, 0.08, 12, rx, Y + 0.8, rz);
  // cooling towers
  for (const [tx, tz] of [[0.6, -0.55], [0.62, 0.2]] as const) {
    b.lathe('paint', P.aConcrete, [[0.25, 0], [0.22, 0.2], [0.18, 0.45], [0.17, 0.6], [0.19, 0.78], [0.17, 0.78], [0.15, 0.6], [0.16, 0.45], [0.2, 0.2], [0.23, 0]], 16, tx, Y, tz);
    b.cyl('paint', P.aConcreteDk, 0.26, 0.26, 0.04, 16, tx, Y + 0.02, tz);
    b.cyl('paint', team, 0.185, 0.185, 0.05, 16, tx, Y + 0.64, tz);
    beacon(b, tx + 0.15, Y + 0.78, tz, 'e:red:blink');
  }
  // pipes reactor -> towers
  pipe(b, 'metal', P.steel, [rx + 0.45, Y + 0.25, rz - 0.2], [0.45, Y + 0.25, -0.5], 0.04);
  pipe(b, 'metal', P.steel, [rx + 0.5, Y + 0.25, rz + 0.1], [0.45, Y + 0.25, 0.2], 0.04);
  pipe(b, 'metal', P.steel, [rx + 0.5, Y + 0.12, rz - 0.05], [0.45, Y + 0.12, -0.5], 0.03);
  // transformer (front-right)
  b.cboxB('paint', P.aSteel, 0.42, 0.24, 0.3, 0.02, 0.58, Y, 0.72);
  for (let i = 0; i < 5; i++) b.box('paint', P.aSteelDk, 0.012, 0.2, 0.33, 0.42 + i * 0.08, Y + 0.12, 0.72);
  b.box('paint', team, 0.42, 0.04, 0.305, 0.58, Y + 0.2, 0.72);
  hazardStripX(b, 0.38, 0.78, Y + 0.24, 0.72, 0.1, 6);
  b.cyl('paint', P.white, 0.02, 0.025, 0.1, 6, 0.46, Y + 0.3, 0.64);
  b.cyl('paint', P.white, 0.02, 0.025, 0.1, 6, 0.58, Y + 0.3, 0.64);
  b.cyl('paint', P.white, 0.02, 0.025, 0.1, 6, 0.7, Y + 0.3, 0.64);
  // control hut (front-left)
  b.cboxB('paint', P.aSand, 0.36, 0.22, 0.24, 0.02, -0.68, Y, 0.78);
  b.box('e:win', 0, 0.2, 0.06, 0.02, -0.68, Y + 0.14, 0.9);
  b.box('paint', P.aSteelDk, 0.38, 0.03, 0.26, -0.68, Y + 0.235, 0.78);
  root.add(b.meshes());

  // glowing reactor parts (dim when unpowered)
  const g = new B({ aoHeight: 0 });
  g.torus('e:blue:pulse', 0, 0.5, 0.03, rx, Y + 0.42, rz, Math.PI / 2, 0, 0, 6, 24);
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    g.box('e:blue:softPulse', 0, 0.03, 0.1, 0.06, rx + Math.cos(a) * 0.485, Y + 0.3, rz + Math.sin(a) * 0.485, 0, -a, 0);
  }
  g.sphere('e:blue:pulse', 0, 0.1, rx, Y + 0.85, rz, 1, 0.6, 1, 10, 6);
  for (const [tx, tz] of [[0.6, -0.55], [0.62, 0.2]] as const) g.cyl('e:blue:softPulse', 0, 0.15, 0.15, 0.02, 12, tx, Y + 0.7, tz);
  root.add(node('glow', g));

  // fan on the transformer
  const f = new B({ aoHeight: 0 });
  f.cyl('paint', P.gunmetal, 0.11, 0.11, 0.03, 12, 0, 0, 0, 0, 0, 0, true);
  for (let i = 0; i < 4; i++) f.box('paint', P.aSteelLt, 0.18, 0.008, 0.04, 0, 0.0, 0, 0.3, (i * Math.PI) / 2, 0);
  root.add(node('fan', f, 0.58, Y + 0.26, 0.72));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'fan', axis: 'y', rate: 8 }] }));
};

// ---------------------------------------------------------------------------
// Refinery 3x3 — dock pad on +Z
// ---------------------------------------------------------------------------
const aRefinery: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3, 0.08, false);
  // dock pad
  const px = 0.45, pz = 0.82, pw = 1.8, pd = 1.2;
  b.boxB('paint', P.asphalt, pw, 0.025, pd, px, Y, pz);
  hazardFrame(b, px, pz, pw, pd, Y + 0.025, 0.07);
  chevron(b, px, Y + 0.035, pz + 0.25, 0.5, P.hazardY, -1);
  chevron(b, px, Y + 0.035, pz - 0.05, 0.5, P.hazardY, -1);
  b.box('paint', P.white, 0.04, 0.01, 0.9, px - 0.42, Y + 0.035, pz);
  b.box('paint', P.white, 0.04, 0.01, 0.9, px + 0.42, Y + 0.035, pz);
  // dock arch
  for (const x of [px - 0.82, px + 0.82]) {
    b.cboxB('paint', P.aSteel, 0.1, 0.62, 0.14, 0.015, x, Y, 0.3);
    beacon(b, x, Y + 0.62, 0.3, 'e:amber:blink');
  }
  b.cboxB('paint', P.aSand, 1.76, 0.12, 0.18, 0.015, px, Y + 0.56, 0.3);
  b.box('paint', team, 1.4, 0.06, 0.012, px, Y + 0.62, 0.395);
  b.box('e:blue', 0, 1.0, 0.02, 0.02, px, Y + 0.55, 0.38);
  // unloading chute
  b.taper('paint', P.aSteelDk, 0.5, 0.3, 0.6, 0.4, 0.2, px, Y + 0.35, 0.12);
  // processing hall
  b.boxB('paint', P.aSandDk, 1.84, 0.08, 1.44, -0.45, Y, -0.6);
  b.cboxB('paint', P.aSand, 1.8, 0.66, 1.4, 0.02, -0.45, Y, -0.6);
  b.cboxB('paint', P.aSteel, 1.1, 0.3, 0.9, 0.02, -0.7, Y + 0.66, -0.75);
  b.box('paint', team, 1.12, 0.06, 0.92, -0.7, Y + 0.88, -0.75);
  b.box('paint', P.aGold, 1.82, 0.02, 1.42, -0.45, Y + 0.6, -0.6);
  windowsZ(b, -1.25, 0.05, Y + 0.45, 0.1, 6, 0.12, 0.09);
  // riftite processing window (glowing ore on conveyor)
  b.box('e:teal:soft', 0, 0.9, 0.08, 0.02, -0.55, Y + 0.2, 0.105);
  b.box('paint', P.aSteelDk, 0.96, 0.02, 0.03, -0.55, Y + 0.25, 0.11);
  b.box('paint', P.aSteelDk, 0.96, 0.02, 0.03, -0.55, Y + 0.15, 0.11);
  ventTop(b, -0.1, Y + 0.66, -1.0, 0.4, 0.4, 7, P.aSandDk);
  // stacks
  for (const [sx, sz] of [[0.2, -0.45], [0.2, -0.2]] as const) {
    b.cyl('paint', P.aSteelDk, 0.07, 0.08, 0.7, 10, sx, Y + 1.0, sz);
    b.cyl('paint', P.hazardY, 0.075, 0.075, 0.06, 10, sx, Y + 1.25, sz);
  }
  // silos
  for (const sz of [-1.0, -0.35]) {
    const sx = 1.0;
    b.cyl('paint', P.aSteel, 0.29, 0.29, 0.8, 16, sx, Y + 0.4, sz);
    b.dome('paint', P.aSteelLt, 0.29, sx, Y + 0.8, sz, 0.45, 16, 4);
    b.cyl('paint', team, 0.295, 0.295, 0.08, 16, sx, Y + 0.62, sz);
    b.cyl('paint', P.aGold, 0.295, 0.295, 0.015, 16, sx, Y + 0.12, sz);
    b.box('e:teal:soft', 0, 0.02, 0.4, 0.05, sx + 0.29, Y + 0.38, sz);
    b.box('paint', P.aSteelDk, 0.03, 0.8, 0.07, sx - 0.2, Y + 0.4, sz + 0.2, 0, 0.8, 0);
  }
  pipe(b, 'metal', P.steel, [0.45, Y + 0.5, -1.0], [0.72, Y + 0.5, -1.0], 0.04);
  pipe(b, 'metal', P.steel, [0.45, Y + 0.5, -0.35], [0.72, Y + 0.5, -0.35], 0.04);
  // tanks + crates at front-left
  b.cylX('paint', P.aSteelLt, 0.12, 0.12, 0.6, 12, -1.0, Y + 0.14, 0.55);
  b.cylX('paint', P.aSteelLt, 0.12, 0.12, 0.6, 12, -1.0, Y + 0.14, 0.85);
  b.box('paint', P.aSteelDk, 0.04, 0.1, 0.5, -1.2, Y + 0.05, 0.7);
  b.box('paint', P.aSteelDk, 0.04, 0.1, 0.5, -0.8, Y + 0.05, 0.7);
  container(b, -1.0, Y, 1.2, 0.5, 0x6d7f5a, 0);
  beacon(b, -1.3, Y + 0.96, -1.25, 'e:red:blink');
  root.add(b.meshes());
  return finalizeTemplate(root, [], bAnim({}));
};

// ---------------------------------------------------------------------------
// Barracks 2x2 — quonset hut, sandbags, flag
// ---------------------------------------------------------------------------
const aBarracks: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 2, 2, 0.08, false);
  const hz = -0.3, r = 0.46, len = 1.4;
  const half = (rr: number, l: number, col: number | THREE.Color, x = -0.05) =>
    b.add(new THREE.CylinderGeometry(rr, rr, l, 16, 1, false, Math.PI, Math.PI), 'paint', col, T(x, Y, hz, 0, 0, -Math.PI / 2));
  half(r, len, P.aOlive);
  for (let i = 0; i < 6; i++) half(r + 0.012, 0.03, 0x4c5038, -0.72 + i * 0.27);
  b.box('paint', team, len * 0.9, 0.02, 0.14, -0.05, Y + r + 0.004, hz);
  // front windows along the +Z flank
  for (let i = 0; i < 4; i++) {
    const x = -0.55 + i * 0.3;
    b.box('e:winWarm', 0, 0.12, 0.07, 0.03, x, Y + 0.22, hz + 0.43, -0.4, 0, 0);
  }
  // entrance vestibule on +X end
  b.cboxB('paint', P.aSand, 0.22, 0.36, 0.36, 0.015, 0.73, Y, hz);
  b.box('paint', P.dark, 0.02, 0.24, 0.16, 0.845, Y + 0.12, hz);
  b.box('paint', P.aSandDk, 0.26, 0.03, 0.4, 0.74, Y + 0.37, hz);
  b.box('e:blue', 0, 0.02, 0.02, 0.08, 0.85, Y + 0.28, hz);
  // gold emblem on the end wall
  b.box('paint', P.aGold, 0.02, 0.1, 0.1, -0.76, Y + 0.25, hz, 0.785, 0, 0);
  // sandbag walls along the front
  sandbags(b, [-0.88, 0.55], [0.05, 0.55], 2, Y);
  sandbags(b, [0.35, 0.55], [0.88, 0.55], 2, Y);
  sandbags(b, [-0.88, 0.55], [-0.88, 0.2], 2, Y);
  // flag + crates + barrels
  flag(b, 0.72, Y, 0.78, 0.75, team);
  b.cboxB('paint', P.wood, 0.14, 0.12, 0.14, 0.01, -0.6, Y, 0.3);
  b.cboxB('paint', 0x6a5a3a, 0.12, 0.1, 0.12, 0.01, -0.44, Y, 0.28);
  b.cyl('paint', 0x4f5a3a, 0.05, 0.05, 0.13, 8, 0.6, Y + 0.065, 0.25);
  b.cyl('paint', 0x4f5a3a, 0.05, 0.05, 0.13, 8, 0.48, Y + 0.065, 0.28);
  // radio mast
  antenna(b, -0.7, Y + r - 0.05, hz - 0.2, 0.45);
  root.add(b.meshes());
  return finalizeTemplate(root, [], bAnim({}));
};

// ---------------------------------------------------------------------------
// War Factory 3x3 — big roller door facing +Z
// ---------------------------------------------------------------------------
const aFactory: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3, 0.08, false);
  const H = 0.88, fz = 0.62; // wall height, front face z
  // main hangar body (back to front face)
  b.boxB('paint', P.aSandDk, 2.74, 0.08, 2.0, 0, Y, -0.37);
  b.cboxB('paint', P.aSand, 2.7, H, 1.96, 0.02, 0, Y, -0.36);
  // front portal: pillars + lintel
  for (const s of [1, -1]) {
    b.cboxB('paint', P.aSand, 0.66, H, 0.22, 0.02, s * 1.02, Y, fz + 0.09);
    b.box('e:win', 0, 0.4, 0.07, 0.02, s * 1.02, Y + 0.6, fz + 0.205);
    b.box('e:win', 0, 0.4, 0.07, 0.02, s * 1.02, Y + 0.45, fz + 0.205);
    b.box('paint', team, 0.64, 0.12, 0.012, s * 1.02, Y + 0.22, fz + 0.205);
    hazardStripZ(b, fz - 0.02, fz + 0.2, Y + 0.0, s * 0.66, 0.06, 3);
    beacon(b, s * 0.74, Y + H, fz + 0.14, s > 0 ? 'e:amber:blink' : 'e:amber:blink');
  }
  b.cboxB('paint', P.aSandDk, 1.4, 0.18, 0.24, 0.02, 0, Y + H - 0.16, fz + 0.1);
  hazardStripX(b, -0.68, 0.68, Y + H - 0.17, fz + 0.225, 0.02, 10);
  b.box('paint', P.aGold, 1.2, 0.03, 0.012, 0, Y + H - 0.05, fz + 0.225);
  // dark interior visible when the door is open
  b.box('paint', 0x0c0d0e, 1.36, 0.72, 0.02, 0, Y + 0.36, fz + 0.005);
  b.box('e:win', 0, 1.2, 0.02, 0.02, 0, Y + 0.66, fz + 0.02);
  // roof: shallow ridge along X
  b.hull('paint', P.aSteel, [
    [-1.38, Y + H, -1.37], [1.38, Y + H, -1.37], [-1.38, Y + H, fz + 0.22], [1.38, Y + H, fz + 0.22],
    [-1.34, Y + H + 0.2, -0.45], [1.34, Y + H + 0.2, -0.45], [-1.34, Y + H + 0.2, -0.25], [1.34, Y + H + 0.2, -0.25],
  ]);
  // team panels on the front roof slope
  b.box('paint', team, 0.8, 0.012, 0.5, -0.8, Y + H + 0.11, 0.3, 0.22, 0, 0);
  b.box('paint', team, 0.8, 0.012, 0.5, 0.8, Y + H + 0.11, 0.3, 0.22, 0, 0);
  // corrugated roof ribs
  for (let i = 0; i < 18; i++) {
    const x = -1.3 + i * (2.6 / 17);
    if (Math.abs(Math.abs(x) - 0.8) < 0.42) continue; // leave the team panels clean
    strut(b, 'paint', P.aSteelDk, [x, Y + H + 0.205, -0.35], [x, Y + H + 0.015, fz + 0.2], 0.018, 0.018);
  }
  for (let i = 0; i < 18; i++) {
    const x = -1.3 + i * (2.6 / 17);
    strut(b, 'paint', P.aSteelDk, [x, Y + H + 0.205, -0.35], [x, Y + H + 0.015, -1.35], 0.018, 0.018);
  }
  // skylights + vents + stacks
  for (const x of [-0.8, 0, 0.8]) b.box('e:win', 0, 0.3, 0.012, 0.3, x, Y + H + 0.14, -0.85, -0.28, 0, 0);
  ventTop(b, 0, Y + H + 0.15, 0.2, 0.4, 0.3, 7, P.aSteelDk);
  b.cboxB('paint', P.aSteelDk, 0.26, 0.14, 0.2, 0.02, -1.0, Y + H + 0.08, -0.35);
  b.cboxB('paint', P.aSteelDk, 0.26, 0.14, 0.2, 0.02, 1.0, Y + H + 0.08, -0.35);
  b.cyl('paint', P.aSteelDk, 0.05, 0.06, 0.4, 8, 1.15, Y + H + 0.3, -1.1);
  b.cyl('paint', P.aSteelDk, 0.05, 0.06, 0.4, 8, 1.0, Y + H + 0.3, -1.1);
  antenna(b, -1.2, Y + H + 0.02, -1.2, 0.35);
  // wall panel seams
  for (const x of [-0.9, -0.3, 0.3, 0.9]) b.box('paint', P.aSandDk, 0.02, H - 0.1, 0.012, x, Y + H / 2, -1.345);
  for (const z of [-1.0, -0.4, 0.2]) for (const s of [1, -1]) b.box('paint', P.aSandDk, 0.012, H - 0.1, 0.02, s * 1.355, Y + H / 2, z);
  // exit ramp with chevrons
  b.hull('paint', P.aConcreteDk, [
    [-0.68, Y, fz + 0.2], [0.68, Y, fz + 0.2], [-0.68, Y + 0.035, fz + 0.2], [0.68, Y + 0.035, fz + 0.2],
    [-0.72, Y, 1.44], [0.72, Y, 1.44], [-0.72, Y + 0.01, 1.44], [0.72, Y + 0.01, 1.44],
  ]);
  chevron(b, 0, Y + 0.035, 1.0, 0.45, P.hazardY, 1);
  chevron(b, 0, Y + 0.03, 1.25, 0.45, P.hazardY, 1);
  hazardStripZ(b, fz + 0.22, 1.42, Y + 0.02, -0.66, 0.05, 6);
  hazardStripZ(b, fz + 0.22, 1.42, Y + 0.02, 0.66, 0.05, 6);
  // side annex tanks
  for (const s of [1, -1]) {
    b.cboxB('paint', P.aSteelDk, 0.22, 0.14, 0.16, 0.015, s * 1.12, Y, 1.12);
    b.box('paint', P.hazardY, 0.224, 0.03, 0.164, s * 1.12, Y + 0.1, 1.12);
    b.cyl('paint', 0x4f5a3a, 0.05, 0.05, 0.13, 8, s * 1.2, Y + 0.065, 0.86);
  }
  root.add(b.meshes());

  // roller door (hangs from the lintel; scales up to open)
  const d = new B({ aoHeight: 0 });
  d.box('paint', P.aSteel, 1.34, 0.72, 0.03, 0, -0.36, 0);
  for (let i = 0; i < 9; i++) d.box('paint', P.aSteelDk, 1.34, 0.012, 0.036, 0, -0.04 - i * 0.08, 0);
  hazardStripX(d, -0.67, 0.67, -0.72, 0, 0.04, 10);
  d.box('paint', team, 0.5, 0.18, 0.036, 0, -0.34, 0.002);
  d.box('paint', P.aGold, 0.52, 0.02, 0.04, 0, -0.24, 0.002);
  const door = node('door', d, 0, Y + 0.72, fz + 0.04);
  root.add(door);
  return finalizeTemplate(root, [], bAnim({
    extra: (r) => {
      const dr = byName(r, 'door');
      let t = 0;
      return (dt, s) => {
        t = damp(t, s.producing ? 1 : 0, 3, dt);
        if (dr) dr.scale.y = 1 - t * 0.92;
      };
    },
  }));
};

// ---------------------------------------------------------------------------
// Comms Center 2x2 — rotating radar dish
// ---------------------------------------------------------------------------
const aRadar: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 2, 2);
  b.boxB('paint', P.aSandDk, 1.34, 0.06, 1.14, -0.2, Y, -0.28);
  b.cboxB('paint', P.aSand, 1.3, 0.46, 1.1, 0.02, -0.2, Y, -0.28);
  b.box('paint', team, 1.31, 0.07, 1.11, -0.2, Y + 0.36, -0.28);
  b.box('paint', P.aGold, 1.32, 0.015, 1.12, -0.2, Y + 0.32, -0.28);
  windowsZ(b, -0.8, 0.4, Y + 0.2, 0.27, 5, 0.12, 0.08);
  b.box('paint', P.aSteelDk, 1.34, 0.03, 1.14, -0.2, Y + 0.47, -0.28);
  ventTop(b, -0.62, Y + 0.485, -0.6, 0.3, 0.3, 6, P.aSteel);
  // equipment shed
  b.cboxB('paint', P.aSteel, 0.36, 0.26, 0.5, 0.02, 0.66, Y, 0.55);
  b.box('paint', P.dark, 0.02, 0.18, 0.14, 0.47, Y + 0.09, 0.55);
  b.box('e:green', 0, 0.02, 0.02, 0.02, 0.47, Y + 0.21, 0.63);
  // dish pedestal
  b.cyl('paint', P.aSteelDk, 0.14, 0.18, 0.2, 10, -0.2, Y + 0.57, -0.28);
  // mast
  lattice(b, 0.66, Y, -0.66, 0.1, 0.8, P.aSteel, 5, 0.018);
  beacon(b, 0.66, Y + 0.8, -0.66, 'e:red:blink');
  root.add(b.meshes());

  const d = new B({ aoHeight: 0 });
  d.cyl('paint', P.aSteelDk, 0.08, 0.1, 0.06, 10, 0, 0.03, 0);
  strut(d, 'paint', P.aSteel, [0, 0.05, 0.08], [0.02, 0.18, 0.08], 0.03);
  strut(d, 'paint', P.aSteel, [0, 0.05, -0.08], [0.02, 0.18, -0.08], 0.03);
  const dg = new B({ aoHeight: 0 });
  dish(dg, 'metal', P.aSteelLt, 0.42, 0.12, 0, 0, 0, 18);
  dg.torus('paint', team, 0.42, 0.012, 0, 0.12, 0, Math.PI / 2, 0, 0, 4, 24);
  strut(dg, 'paint', P.gunmetal, [0, 0, 0], [0, 0.3, 0], 0.02);
  dg.box('e:blue', 0, 0.04, 0.04, 0.04, 0, 0.32, 0);
  const dgn = dg.meshes();
  dgn.position.set(0.03, 0.2, 0);
  dgn.rotation.z = -0.8;
  const dn = node('dish', d, -0.2, Y + 0.67, -0.28);
  dn.add(dgn);
  root.add(dn);
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'dish', axis: 'y', rate: 0.9 }] }));
};

// ---------------------------------------------------------------------------
// Service Depot 3x3 — flat repair pad
// ---------------------------------------------------------------------------
const aRepair: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3, 0.07, false);
  const Yr = 0.082;
  b.boxB('paint', P.aSteelDk, 2.2, 0.04, 2.2, 0.1, Yr, 0.1);
  for (let i = 0; i < 10; i++) b.box('paint', 0x3c4146, 2.1, 0.006, 0.02, 0.1, Yr + 0.043, -0.9 + i * 0.22);
  hazardFrame(b, 0.1, 0.1, 2.2, 2.2, Yr + 0.04, 0.08);
  // big repair cross
  b.box('paint', team, 0.9, 0.012, 0.22, 0.1, Yr + 0.046, 0.1);
  b.box('paint', team, 0.22, 0.012, 0.9, 0.1, Yr + 0.046, 0.1);
  b.box('paint', P.white, 0.94, 0.008, 0.26, 0.1, Yr + 0.043, 0.1);
  b.box('paint', P.white, 0.26, 0.008, 0.94, 0.1, Yr + 0.043, 0.1);
  for (const [x, z] of [[-0.95, -0.95], [1.15, -0.95], [-0.95, 1.15], [1.15, 1.15]]) {
    b.cyl('paint', P.aSteel, 0.06, 0.07, 0.1, 8, x, Yr + 0.09, z);
    b.sphere('e:blue', 0, 0.03, x, Yr + 0.16, z, 1, 1, 1, 6, 4);
  }
  // control booth
  b.cboxB('paint', P.aSand, 0.34, 0.32, 0.34, 0.02, -1.18, Y - 0.01, -1.18);
  b.box('e:win', 0, 0.25, 0.08, 0.02, -1.18, Y + 0.22, -1.0);
  b.box('e:win', 0, 0.02, 0.08, 0.25, -1.0, Y + 0.22, -1.18);
  b.box('paint', P.aSteelDk, 0.38, 0.03, 0.38, -1.18, Y + 0.33, -1.18);
  antenna(b, -1.28, Y + 0.34, -1.28, 0.3);
  // tool racks / gas bottles
  for (let i = 0; i < 4; i++) b.cyl('paint', i % 2 ? P.red : P.aOlive, 0.03, 0.03, 0.16, 6, -1.3, Y + 0.08, -0.5 + i * 0.08);
  root.add(b.meshes());

  // swivelling repair arms (one node, four arms)
  const a = new B({ aoHeight: 0 });
  for (const [x, z] of [[-0.8, -0.8], [1.0, -0.8], [-0.8, 1.0], [1.0, 1.0]]) {
    const lx = x - 0.1, lz = z - 0.1;
    a.cyl('paint', P.aSandDk, 0.07, 0.08, 0.12, 8, lx, 0.06, lz);
    strut(a, 'paint', P.hazardY, [lx, 0.1, lz], [lx * 0.8, 0.5, lz * 0.8], 0.05, 0.05, 0.008);
    strut(a, 'paint', P.hazardY, [lx * 0.8, 0.5, lz * 0.8], [lx * 0.45, 0.36, lz * 0.45], 0.04, 0.04, 0.008);
    a.cbox('paint', P.gunmetal, 0.07, 0.07, 0.07, 0.01, lx * 0.45, 0.34, lz * 0.45);
    a.cone('e:blue:pulse', 0, 0.02, 0.06, 6, lx * 0.45, 0.28, lz * 0.45, Math.PI, 0, 0);
  }
  const arms = node('arms', a, 0.1, Yr + 0.04, 0.1);
  root.add(arms);
  return finalizeTemplate(root, [], bAnim({ sways: [{ name: 'arms', axis: 'y', amp: 0.18, freq: 0.8, power: true }] }));
};

// ---------------------------------------------------------------------------
// Airfield 3x3 — landing pad with markings + control tower
// ---------------------------------------------------------------------------
const aAirfield: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3, 0.07, false);
  const Yr = 0.082;
  const cx = -0.2, cz = 0.15, S = 2.2;
  b.boxB('paint', P.asphalt, S, 0.02, S, cx, Yr, cz);
  // ring
  const seg = 28;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    b.box('paint', P.white, 0.16, 0.008, 0.05, cx + Math.cos(a0) * 0.82, Yr + 0.024, cz + Math.sin(a0) * 0.82, 0, -a0 + Math.PI / 2, 0);
  }
  // H
  b.box('paint', P.white, 0.1, 0.008, 0.72, cx - 0.24, Yr + 0.024, cz);
  b.box('paint', P.white, 0.1, 0.008, 0.72, cx + 0.24, Yr + 0.024, cz);
  b.box('paint', P.white, 0.4, 0.008, 0.1, cx, Yr + 0.024, cz);
  // team corner marks
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    b.box('paint', team, 0.3, 0.01, 0.06, cx + sx * 0.9, Yr + 0.025, cz + sz * 1.02);
    b.box('paint', team, 0.06, 0.01, 0.3, cx + sx * 1.02, Yr + 0.025, cz + sz * 0.9);
  }
  // edge lights
  for (let i = 0; i < 4; i++) {
    const t = -S / 2 + 0.25 + (i * (S - 0.5)) / 3;
    for (const s of [1, -1]) {
      b.box(i % 2 ? 'e:blue' : 'e:white', 0, 0.04, 0.03, 0.04, cx + t, Yr + 0.035, cz + s * (S / 2 - 0.04));
      b.box(i % 2 ? 'e:blue' : 'e:white', 0, 0.04, 0.03, 0.04, cx + s * (S / 2 - 0.04), Yr + 0.035, cz + t);
    }
  }
  // control tower (back-right corner)
  const tx = 1.17, tz = -1.17;
  b.cboxB('paint', P.aSand, 0.36, 0.7, 0.36, 0.02, tx, Y - 0.01, tz);
  b.box('paint', team, 0.37, 0.07, 0.37, tx, Y + 0.45, tz);
  b.cboxB('paint', P.aSandDk, 0.46, 0.04, 0.46, 0.01, tx, Y + 0.68, tz);
  b.boxB('e:win', 0, 0.42, 0.13, 0.42, tx, Y + 0.72, tz);
  b.cboxB('paint', P.aSteelDk, 0.5, 0.04, 0.5, 0.01, tx, Y + 0.85, tz);
  antenna(b, tx - 0.15, Y + 0.89, tz - 0.15, 0.3);
  // fuel bowser + windsock
  b.cylX('paint', P.aSteelLt, 0.1, 0.1, 0.4, 10, 1.15, Y + 0.14, 0.9);
  b.box('paint', P.aSteelDk, 0.44, 0.04, 0.16, 1.15, Y + 0.03, 0.9);
  b.box('paint', P.hazardY, 0.4, 0.03, 0.005, 1.15, Y + 0.14, 1.0);
  b.cyl('metal', P.steel, 0.008, 0.01, 0.5, 5, 1.3, Y + 0.25, 0.3);
  b.cone('paint', 0xff6a1e, 0.035, 0.18, 6, 1.21, Y + 0.47, 0.3, 0, 0, Math.PI / 2 + 0.2);
  root.add(b.meshes());

  const r = new B({ aoHeight: 0 });
  r.cyl('paint', P.gunmetal, 0.035, 0.04, 0.05, 8, 0, 0.025, 0);
  r.box('e:amber', 0, 0.05, 0.035, 0.03, 0.03, 0.06, 0);
  r.box('paint', P.gunmetal, 0.02, 0.04, 0.04, -0.01, 0.06, 0);
  root.add(node('beacon', r, tx + 0.1, Y + 0.87, tz + 0.1));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'beacon', axis: 'y', rate: 4 }] }));
};

// ---------------------------------------------------------------------------
// Tech Center 3x2
// ---------------------------------------------------------------------------
const aTechlab: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 2);
  // main block
  b.boxB('paint', P.aSandDk, 1.94, 0.06, 1.24, -0.35, Y, -0.22);
  b.cboxB('paint', P.aSand, 1.9, 0.48, 1.2, 0.02, -0.35, Y, -0.22);
  windowsZ(b, -1.25, 0.55, Y + 0.28, 0.38, 8, 0.14, 0.12);
  b.box('paint', P.aGold, 1.92, 0.02, 1.22, -0.35, Y + 0.44, -0.22);
  // glass upper storey
  b.boxB('e:win', 0, 1.3, 0.2, 0.8, -0.5, Y + 0.48, -0.3);
  for (let i = 0; i <= 8; i++) b.box('paint', P.aSteelDk, 0.02, 0.2, 0.82, -1.15 + i * 0.1625, Y + 0.58, -0.3);
  b.box('paint', P.aSteelDk, 1.32, 0.02, 0.82, -0.5, Y + 0.58, -0.3);
  b.cboxB('paint', P.aSteel, 1.4, 0.05, 0.9, 0.015, -0.5, Y + 0.68, -0.3);
  b.box('paint', team, 1.0, 0.012, 0.3, -0.5, Y + 0.735, -0.3);
  // roof antenna array
  for (let i = 0; i < 3; i++) antenna(b, -1.05 + i * 0.25, Y + 0.73, -0.62, 0.3 + i * 0.06, P.gunmetal, i % 2 ? 'e:red:blink' : 'e:red:blink');
  // observatory dome (right)
  b.cyl('paint', P.aSteel, 0.38, 0.4, 0.34, 18, 0.95, Y + 0.17, -0.3);
  b.cyl('paint', team, 0.385, 0.385, 0.05, 18, 0.95, Y + 0.28, -0.3);
  b.dome('paint', P.aSteelLt, 0.38, 0.95, Y + 0.34, -0.3, 0.85, 18, 6);
  b.box('paint', P.dark, 0.1, 0.3, 0.02, 0.95, Y + 0.5, -0.02, -0.55, 0, 0);
  b.box('e:blue', 0, 0.05, 0.26, 0.02, 0.95, Y + 0.5, -0.01, -0.55, 0, 0);
  // entrance canopy
  b.box('paint', P.aSteelDk, 0.5, 0.03, 0.3, -0.35, Y + 0.3, 0.52);
  strut(b, 'paint', P.aSteelDk, [-0.57, Y, 0.64], [-0.57, Y + 0.3, 0.64], 0.025);
  strut(b, 'paint', P.aSteelDk, [-0.13, Y, 0.64], [-0.13, Y + 0.3, 0.64], 0.025);
  b.box('e:blue', 0, 0.3, 0.02, 0.02, -0.35, Y + 0.28, 0.66);
  // pedestal emitter
  b.cyl('paint', P.aSteelDk, 0.1, 0.14, 0.18, 8, 0.95, Y + 0.09, 0.55);
  b.cyl('paint', P.aGold, 0.04, 0.06, 0.15, 8, 0.95, Y + 0.25, 0.55);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  g.sphere('e:blue:pulse', 0, 0.07, 0, 0, 0, 1, 1, 1, 10, 8);
  g.torus('paint', P.aGold, 0.11, 0.01, 0, 0, 0, Math.PI / 2, 0, 0, 4, 16);
  root.add(node('orb', g, 0.95, Y + 0.42, 0.55));
  return finalizeTemplate(root, [], bAnim({ bobs: [{ name: 'orb', amp: 0.03, freq: 2, power: true }], spins: [{ name: 'orb', axis: 'y', rate: 1.5 }] }));
};

// ---------------------------------------------------------------------------
// Ion Uplink 3x3 — giant dish, capacitor pylons
// ---------------------------------------------------------------------------
const aUplink: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabAegis(b, 3, 3);
  b.add(new THREE.CylinderGeometry(1.08, 1.14, 0.34, 8), 'paint', P.aSand, T(0, Y + 0.17, 0, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(1.1, 1.1, 0.06, 8), 'paint', team, T(0, Y + 0.26, 0, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(0.72, 0.8, 0.2, 8), 'paint', P.aSteel, T(0, Y + 0.44, 0, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(0.735, 0.735, 0.02, 8), 'paint', P.aGold, T(0, Y + 0.54, 0, 0, Math.PI / 8, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('e:win', 0, 0.2, 0.06, 0.02, Math.cos(a) * 1.02, Y + 0.14, Math.sin(a) * 1.02, 0, -a + Math.PI / 2, 0);
  }
  b.box('paint', P.dark, 0.3, 0.22, 0.04, 0, Y + 0.11, 1.06);
  // capacitor pylons in the corners
  for (const [x, z] of [[-1.18, -1.18], [1.18, -1.18], [-1.18, 1.18], [1.18, 1.18]]) {
    b.cyl('paint', P.aSteelDk, 0.12, 0.14, 0.1, 8, x, Y + 0.05, z);
    b.cyl('paint', P.aSteel, 0.06, 0.08, 0.72, 8, x, Y + 0.46, z);
    for (let k = 0; k < 3; k++) b.torus('paint', P.aGold, 0.085, 0.014, x, Y + 0.3 + k * 0.17, z, Math.PI / 2, 0, 0, 4, 12);
    b.sphere('paint', P.aSteelLt, 0.05, x, Y + 0.84, z, 1, 1, 1, 8, 6);
  }
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  for (const [x, z] of [[-1.18, -1.18], [1.18, -1.18], [-1.18, 1.18], [1.18, 1.18]]) {
    for (let k = 0; k < 2; k++) g.cyl('e:blue:pulse', 0, 0.075, 0.075, 0.06, 8, x, Y + 0.385 + k * 0.17, z);
  }
  root.add(node('glow', g));

  const d = new B({ aoHeight: 0 });
  d.cyl('paint', P.aSteelDk, 0.2, 0.26, 0.14, 12, 0, 0.07, 0);
  const dg = new B({ aoHeight: 0 });
  dish(dg, 'metal', P.aSteelLt, 0.95, 0.28, 0, 0, 0, 24);
  dg.torus('paint', P.aSteelDk, 0.95, 0.025, 0, 0.28, 0, Math.PI / 2, 0, 0, 4, 32);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    strut(dg, 'paint', P.aSteelDk, [Math.cos(a) * 0.85, 0.24, Math.sin(a) * 0.85], [0, 0.85, 0], 0.03);
  }
  dg.cyl('paint', P.aSteelDk, 0.08, 0.05, 0.14, 8, 0, 0.9, 0);
  dg.sphere('e:blue:pulse', 0, 0.07, 0, 0.99, 0, 1, 1, 1, 10, 8);
  dg.cone('e:blue', 0, 0.03, 0.2, 6, 0, 1.12, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    dg.box('paint', team, 0.18, 0.012, 0.06, Math.cos(a) * 0.72, 0.16, Math.sin(a) * 0.72, 0, -a, -0.6);
  }
  const dgn = dg.meshes();
  dgn.position.y = 0.14;
  dgn.rotation.z = -0.22;
  const dn = node('dish', d, 0, Y + 0.54, 0);
  dn.add(dgn);
  root.add(dn);
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'dish', axis: 'y', rate: 0.25 }] }));
};

// ---------------------------------------------------------------------------
// Defences (1x1)
// ---------------------------------------------------------------------------
function smallSlab(b: B): void {
  b.cboxB('paint', P.aConcreteDk, 0.94, 0.06, 0.94, 0.02, 0, 0, 0);
  b.boxB('paint', P.aConcrete, 0.86, 0.01, 0.86, 0, 0.06, 0);
}

const aTower: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallSlab(b);
  sandbags(b, [-0.42, -0.42], [0.42, -0.42], 2, 0.07);
  sandbags(b, [-0.42, 0.42], [0.42, 0.42], 2, 0.07);
  sandbags(b, [-0.42, -0.34], [-0.42, 0.34], 2, 0.07);
  sandbags(b, [0.42, -0.34], [0.42, 0.34], 2, 0.07);
  b.taper('paint', P.aConcrete, 0.52, 0.52, 0.4, 0.4, 0.44, 0, 0.07, 0);
  b.box('paint', P.aConcreteDk, 0.02, 0.35, 0.3, 0.235, 0.26, 0, 0, 0, -0.13);
  b.cboxB('paint', P.aSand, 0.56, 0.06, 0.56, 0.015, 0, 0.5, 0);
  b.box('paint', team, 0.565, 0.03, 0.565, 0, 0.53, 0);
  b.box('paint', P.dark, 0.02, 0.12, 0.1, -0.22, 0.2, 0.0);
  root.add(b.meshes());
  const t = new B({ aoBase: 0.56, aoHeight: 0.1, aoMin: 0.7 });
  t.cboxB('paint', P.aSand, 0.34, 0.16, 0.34, 0.03, 0, 0, 0);
  t.box('paint', P.dark, 0.02, 0.035, 0.22, 0.17, 0.1, 0);
  t.cboxB('paint', P.aSandDk, 0.4, 0.04, 0.4, 0.015, 0, 0.16, 0);
  t.box('paint', team, 0.2, 0.012, 0.2, -0.04, 0.206, 0);
  t.box('paint', P.gunmetal, 0.1, 0.05, 0.08, 0.2, 0.08, 0);
  t.cylX('paint', 0x1c1c1c, 0.012, 0.014, 0.22, 6, 0.33, 0.09, 0.022);
  t.cylX('paint', 0x1c1c1c, 0.012, 0.014, 0.22, 6, 0.33, 0.09, -0.022);
  t.box('e:blue', 0, 0.02, 0.02, 0.05, 0.14, 0.215, 0.1);
  antenna(t, -0.13, 0.2, -0.13, 0.22, P.gunmetal, 'e:red:blink');
  const turret = node('turret', t, 0, 0.56, 0);
  root.add(turret);
  const gun = new THREE.Group();
  gun.name = 'gun';
  turret.add(gun);
  return finalizeTemplate(root, [new THREE.Vector3(0.45, 0.09, 0.022), new THREE.Vector3(0.45, 0.09, -0.022)], bAnim({}));
};

const aTurret: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallSlab(b);
  b.add(new THREE.CylinderGeometry(0.38, 0.45, 0.2, 8), 'paint', P.aConcrete, T(0, 0.17, 0, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.04, 8), 'paint', team, T(0, 0.26, 0, 0, Math.PI / 8, 0));
  hazardStripX(b, -0.3, 0.3, 0.06, 0.42, 0.04, 6);
  root.add(b.meshes());
  const t = new B({ aoBase: 0.28, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.aSteelDk, 0.28, 0.3, 0.04, 12, 0, 0.02, 0);
  t.hull('paint', P.aSand, [
    [-0.26, 0.02, 0.22], [-0.26, 0.02, -0.22], [0.12, 0.02, 0.25], [0.12, 0.02, -0.25], [0.28, 0.02, 0.1], [0.28, 0.02, -0.1],
    [-0.24, 0.2, 0.18], [-0.24, 0.2, -0.18], [0.06, 0.2, 0.19], [0.06, 0.2, -0.19], [0.2, 0.17, 0.08], [0.2, 0.17, -0.08],
  ]);
  t.box('paint', team, 0.14, 0.014, 0.34, -0.1, 0.205, 0);
  t.box('paint', P.aGold, 0.012, 0.012, 0.3, 0.04, 0.206, 0);
  t.box('paint', P.aSteelDk, 0.08, 0.05, 0.06, -0.12, 0.23, -0.1);
  t.box('e:blue', 0, 0.006, 0.03, 0.04, -0.08, 0.23, -0.1);
  const turret = node('turret', t, 0, 0.28, 0);
  root.add(turret);
  const g = new B({ aoHeight: 0 });
  g.cbox('paint', P.aSandDk, 0.12, 0.11, 0.16, 0.02, 0.02, 0, 0);
  g.cylX('paint', P.aSteelDk, 0.03, 0.034, 0.5, 10, 0.3, 0, 0);
  g.cylX('paint', P.aSandDk, 0.042, 0.042, 0.08, 10, 0.28, 0, 0);
  g.cbox('paint', P.gunmetal, 0.06, 0.06, 0.07, 0.012, 0.55, 0, 0);
  turret.add(node('gun', g, 0.2, 0.1, 0));
  return finalizeTemplate(root, [new THREE.Vector3(0.2 + 0.59, 0.1, 0)], bAnim({
    extra: (r) => {
      const gun = byName(r, 'gun');
      const gx = gun?.position.x ?? 0;
      return (_dt, s) => {
        if (gun) gun.position.x = gx - s.firing * s.firing * 0.07;
      };
    },
  }));
};

const aSam: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallSlab(b);
  b.cboxB('paint', P.aSand, 0.62, 0.14, 0.62, 0.03, 0, 0.06, 0);
  b.box('paint', team, 0.625, 0.04, 0.625, 0, 0.16, 0);
  hazardStripX(b, -0.3, 0.3, 0.2, 0.28, 0.04, 6);
  b.cboxB('paint', P.aSteelDk, 0.2, 0.2, 0.14, 0.02, -0.28, 0.06, -0.3);
  root.add(b.meshes());
  const t = new B({ aoBase: 0.2, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.aSteelDk, 0.18, 0.2, 0.06, 12, 0, 0.03, 0);
  t.box('paint', P.aSand, 0.12, 0.2, 0.05, 0, 0.14, 0.17);
  t.box('paint', P.aSand, 0.12, 0.2, 0.05, 0, 0.14, -0.17);
  // radar panel on the back
  t.box('paint', P.aSteel, 0.02, 0.16, 0.2, -0.16, 0.2, 0, 0, 0, 0.3);
  t.box('paint', P.aSteelDk, 0.08, 0.1, 0.04, -0.12, 0.1, 0);
  const turret = node('turret', t, 0, 0.2, 0);
  root.add(turret);
  const pitch = 0.5;
  const l = new B({ aoHeight: 0 });
  l.box('paint', P.aSteelDk, 0.08, 0.06, 0.3, 0, 0, 0);
  const tubes: [number, number][] = [[0.05, 0.08], [0.05, -0.08], [-0.05, 0.08], [-0.05, -0.08]];
  for (const [ty, tz] of tubes) {
    l.cylX('paint', P.aSand, 0.035, 0.035, 0.38, 10, 0.05, ty, tz);
    l.cone('paint', P.white, 0.03, 0.08, 8, 0.28, ty, tz, 0, 0, -Math.PI / 2);
    l.cylX('paint', P.red, 0.036, 0.036, 0.02, 10, 0.2, ty, tz);
  }
  l.box('paint', team, 0.3, 0.01, 0.06, 0.05, 0.09, 0);
  const lnode = node('gun', l, 0, 0.18, 0);
  lnode.rotation.z = pitch;
  turret.add(lnode);
  const muz = tubes.map(([ty, tz]) => {
    const x = 0.32;
    return new THREE.Vector3(x * Math.cos(pitch) - ty * Math.sin(pitch), 0.18 + x * Math.sin(pitch) + ty * Math.cos(pitch), tz);
  });
  return finalizeTemplate(root, muz, bAnim({}));
};

const aRailtower: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallSlab(b);
  b.taper('paint', P.aSteelDk, 0.66, 0.66, 0.5, 0.5, 0.16, 0, 0.06, 0);
  b.box('paint', team, 0.5, 0.05, 0.5, 0, 0.19, 0);
  b.box('paint', P.aSteelDk, 0.42, 0.012, 0.42, 0, 0.222, 0);
  b.taper('paint', P.aSteel, 0.38, 0.38, 0.22, 0.22, 0.86, 0, 0.22, 0);
  for (let k = 0; k < 4; k++) b.torus('paint', P.aGold, 0.2 - k * 0.018, 0.022, 0, 0.36 + k * 0.17, 0, Math.PI / 2, 0, 0, 4, 12);
  for (const s of [1, -1]) {
    b.box('paint', P.aSteelDk, 0.04, 0.7, 0.06, s * 0.2, 0.5, 0, 0, 0, s * -0.1);
    b.box('paint', P.aSteelDk, 0.06, 0.7, 0.04, 0, 0.5, s * 0.2, s * 0.1, 0, 0);
  }
  b.cboxB('paint', P.aSandDk, 0.34, 0.05, 0.34, 0.012, 0, 1.06, 0);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  for (let k = 0; k < 3; k++) g.cyl('e:blue:pulse', 0, 0.16 - k * 0.018, 0.17 - k * 0.018, 0.05, 8, 0, 0.44 + k * 0.17, 0);
  root.add(node('glow', g));
  const t = new B({ aoBase: 1.11, aoHeight: 0 });
  t.cyl('paint', P.aSteelDk, 0.15, 0.16, 0.05, 10, 0, 0.025, 0);
  t.cbox('paint', P.aSand, 0.3, 0.13, 0.22, 0.02, -0.02, 0.11, 0);
  t.box('paint', team, 0.16, 0.012, 0.2, -0.06, 0.18, 0);
  for (const s of [1, -1]) t.box('paint', P.aSteelDk, 0.52, 0.03, 0.035, 0.3, 0.11, s * 0.045);
  t.box('e:blue:pulse', 0, 0.48, 0.016, 0.03, 0.3, 0.11, 0);
  for (let i = 0; i < 4; i++) t.box('paint', P.aGold, 0.02, 0.06, 0.13, 0.12 + i * 0.12, 0.11, 0);
  t.cbox('paint', P.aSteelDk, 0.06, 0.08, 0.12, 0.01, -0.2, 0.12, 0);
  const turret = node('turret', t, 0, 1.11, 0);
  root.add(turret);
  return finalizeTemplate(root, [new THREE.Vector3(0.58, 0.11, 0)], bAnim({}));
};

const aWall: F = () => {
  const root = new THREE.Group();
  const b = new B({ aoHeight: 0.3, aoMin: 0.55, jitter: 0.05, seed: 11 });
  b.boxB('paint', P.aConcreteDk, 1.0, 0.06, 1.0, 0, 0, 0);
  b.boxB('paint', P.aConcrete, 0.9, 0.3, 0.9, 0, 0.06, 0);
  b.hull('paint', P.aConcrete, [
    [-0.45, 0.36, -0.45], [0.45, 0.36, -0.45], [-0.45, 0.36, 0.45], [0.45, 0.36, 0.45],
    [-0.36, 0.44, -0.36], [0.36, 0.44, -0.36], [-0.36, 0.44, 0.36], [0.36, 0.44, 0.36],
  ]);
  // connectors so neighbouring walls read as a continuous barrier
  for (const s of [1, -1]) {
    b.boxB('paint', P.aConcrete, 0.06, 0.34, 0.8, s * 0.47, 0.06, 0);
    b.boxB('paint', P.aConcrete, 0.8, 0.34, 0.06, 0, 0.06, s * 0.47);
  }
  b.box('paint', 0x7e7b73, 0.92, 0.03, 0.92, 0, 0.2, 0);
  b.box('paint', 0x6a675f, 0.72, 0.01, 0.02, 0, 0.442, 0);
  b.box('paint', 0x6a675f, 0.02, 0.01, 0.72, 0, 0.442, 0);
  root.add(b.meshes());
  return finalizeTemplate(root, []);
};

export const AEGIS_STRUCTURES: Record<string, F> = {
  a_yard: aYard,
  a_power: aPower,
  a_refinery: aRefinery,
  a_barracks: aBarracks,
  a_factory: aFactory,
  a_radar: aRadar,
  a_repair: aRepair,
  a_airfield: aAirfield,
  a_techlab: aTechlab,
  a_uplink: aUplink,
  a_tower: aTower,
  a_turret: aTurret,
  a_sam: aSam,
  a_railtower: aRailtower,
  a_wall: aWall,
};
