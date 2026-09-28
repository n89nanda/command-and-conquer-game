/** Rift Covenant structures: black/gunmetal, spiky, red trim, red-orange + teal Riftite glow. */
import * as THREE from 'three';
import { B, P, V3, Template, finalizeTemplate, node, strut, spike, byName, damp, T, windowsZ, hazardStripX } from './kit';
import { slabCov, beacon, dish, bAnim, chevron } from './structures_common';

type F = (team: THREE.Color) => Template;
const Y = 0.09; // top of plinth

function bld(): B {
  return new B({ aoHeight: 0.45, aoMin: 0.55 });
}
function mz(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    out.push(p);
    if (p[2] !== 0) out.push([p[0], p[1], -p[2]]);
  }
  return out;
}
/** Red/black warning stripes (Covenant hazard). */
function redStripX(b: B, x0: number, x1: number, y: number, z: number, d: number, n = 8): void {
  const len = (x1 - x0) / n;
  for (let i = 0; i < n; i++) b.box('paint', i % 2 ? P.cBlack : P.cRed, len, 0.012, d, x0 + len * (i + 0.5), y + 0.006, z);
}
function redStripZ(b: B, z0: number, z1: number, y: number, x: number, w: number, n = 8): void {
  const len = (z1 - z0) / n;
  for (let i = 0; i < n; i++) b.box('paint', i % 2 ? P.cBlack : P.cRed, w, 0.012, len, x, y + 0.006, z0 + len * (i + 0.5));
}
function redFrame(b: B, x: number, z: number, w: number, d: number, y: number, bw = 0.06): void {
  redStripX(b, x - w / 2, x + w / 2, y, z - d / 2 + bw / 2, bw, Math.round(w * 8));
  redStripX(b, x - w / 2, x + w / 2, y, z + d / 2 - bw / 2, bw, Math.round(w * 8));
  redStripZ(b, z - d / 2 + bw, z + d / 2 - bw, y, x - w / 2 + bw / 2, bw, Math.round(d * 8));
  redStripZ(b, z - d / 2 + bw, z + d / 2 - bw, y, x + w / 2 - bw / 2, bw, Math.round(d * 8));
}
/** Spiked pylon with glowing tip. */
function pylon(b: B, x: number, z: number, h: number, tip = 'e:red:blink', y = Y): void {
  b.taper('paint', P.cGun, 0.14, 0.14, 0.08, 0.08, h * 0.6, x, y, z);
  spike(b, 'paint', P.cBlack, x, y + h * 0.6, z, h * 0.4, 0.06);
  b.box('paint', P.cRed, 0.125, 0.02, 0.125, x, y + h * 0.35, z);
  b.sphere(tip, 0, 0.025, x, y + h * 0.62, z + 0.04, 1, 1, 1, 6, 4);
}
/** Clawed arm for the construction yard: base at origin, boom towards +X. */
function clawArm(b: B, len: number, team: THREE.Color): void {
  b.cyl('paint', P.cBlack, 0.14, 0.17, 0.12, 8, 0, 0.06, 0);
  b.cyl('paint', P.cRed, 0.145, 0.145, 0.02, 8, 0, 0.1, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    spike(b, 'paint', P.cGun, Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12, 0.12, 0.025, Math.sin(a) * 0.8, -Math.cos(a) * 0.8);
  }
  const j1: V3 = [len * 0.3, 0.85, 0], j2: V3 = [len, 0.7, 0], j3: V3 = [len * 1.05, 0.45, 0];
  strut(b, 'paint', P.cGun, [0, 0.1, 0], j1, 0.08, 0.07, 0.015);
  strut(b, 'paint', P.cGunLt, j1, j2, 0.06, 0.055, 0.012);
  strut(b, 'paint', P.cBlack, j2, j3, 0.045, 0.045, 0.01);
  b.box('paint', team, 0.2, 0.02, 0.075, len * 0.15, 0.48, 0, 0, 0, 1.2);
  b.sphere('paint', P.cRed, 0.045, j1[0], j1[1], j1[2], 1, 1, 1, 8, 6);
  b.sphere('paint', P.cRed, 0.035, j2[0], j2[1], j2[2], 1, 1, 1, 8, 6);
  spike(b, 'paint', P.cBlack, j1[0], j1[1], 0, 0.14, 0.03, 0, 0.6);
  // three-finger claw
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const dz = Math.cos(a) * 0.04, dx = Math.sin(a) * 0.04;
    strut(b, 'paint', P.cGunLt, j3, [j3[0] + dx, j3[1] - 0.1, j3[2] + dz], 0.022);
    spike(b, 'paint', P.cRed, j3[0] + dx, j3[1] - 0.1, j3[2] + dz, 0.07, 0.015, Math.PI - dz * 6, dx * 6);
  }
  b.sphere('e:orange:pulse', 0, 0.022, j3[0], j3[1] - 0.02, 0, 1, 1, 1, 6, 4);
}

// ---------------------------------------------------------------------------
const cYard: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.09, team);
  const cx = -0.25, cz = -0.3;
  // stepped core
  b.taper('paint', P.cGun, 1.7, 1.7, 1.45, 1.45, 0.34, cx, Y, cz);
  b.taper('paint', team, 1.46, 1.46, 1.42, 1.42, 0.06, cx, Y + 0.34, cz);
  b.taper('paint', P.cGunLt, 1.4, 1.4, 1.0, 1.0, 0.36, cx, Y + 0.4, cz);
  b.taper('paint', P.cBlack, 1.0, 1.0, 0.6, 0.6, 0.3, cx, Y + 0.76, cz);
  spike(b, 'paint', P.cGun, cx, Y + 1.06, cz, 0.62, 0.2);
  // buttress wings to the corners
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.hull('paint', P.cGun, [
      [cx + sx * 0.5, Y, cz + sz * 0.5], [cx + sx * 0.5, Y + 0.7, cz + sz * 0.5], [cx + sx * 1.02, Y, cz + sz * 1.02],
      [cx + sx * 0.44, Y + 0.7, cz + sz * 0.56], [cx + sx * 0.56, Y + 0.7, cz + sz * 0.44],
      [cx + sx * 0.96, Y, cz + sz * 1.08], [cx + sx * 1.08, Y, cz + sz * 0.96],
    ]);
    b.box('paint', P.cRed, 0.02, 0.02, 0.7, cx + sx * 0.76, Y + 0.36, cz + sz * 0.76, 0.6 * sz, Math.PI / 4 * sx * sz, 0);
  }
  // glowing seams + doorway
  b.taper('e:orange:pulse', 0, 1.42, 1.42, 1.405, 1.405, 0.02, cx, Y + 0.395, cz);
  b.box('paint', P.dark, 0.44, 0.28, 0.04, cx, Y + 0.14, cz + 0.84);
  b.box('e:red', 0, 0.36, 0.03, 0.02, cx, Y + 0.3, cz + 0.87);
  b.hull('paint', P.cBlack, [[cx - 0.3, Y, cz + 0.86], [cx + 0.3, Y, cz + 0.86], [cx - 0.26, Y + 0.34, cz + 0.84], [cx + 0.26, Y + 0.34, cz + 0.84], [cx, Y + 0.48, cz + 0.8], [cx - 0.3, Y, cz + 0.9], [cx + 0.3, Y, cz + 0.9]]);
  windowsZ(b, cx - 0.4, cx + 0.4, Y + 0.56, cz + 0.62, 4, 0.1, 0.05, 'e:red');
  // front assembly pad
  b.boxB('paint', 0x232428, 1.1, 0.015, 0.8, 0.8, Y, 0.95);
  redFrame(b, 0.8, 0.95, 1.1, 0.8, Y + 0.015, 0.05);
  chevron(b, 0.8, Y + 0.03, 0.95, 0.4, P.cRed, 1);
  // pylons
  pylon(b, 1.3, -1.3, 0.8);
  pylon(b, -1.3, 1.3, 0.8, 'e:red:blink');
  pylon(b, 1.3, 0.35, 0.6);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  g.add(new THREE.OctahedronGeometry(0.1, 0), 'crystal', 0, T(cx, Y + 1.75, cz, 0, 0, 0, 0.8, 1.6, 0.8));
  root.add(node('glow', g));
  const a = new B({ aoHeight: 0 });
  clawArm(a, 0.95, team);
  const arm = node('crane', a, -1.15, Y, 0.95);
  arm.rotation.y = 0.5;
  root.add(arm);
  const a2 = new B({ aoHeight: 0 });
  clawArm(a2, 0.7, team);
  const arm2 = node('crane2', a2, 1.1, Y, -0.6);
  arm2.rotation.y = 2.6;
  arm2.scale.setScalar(0.85);
  root.add(arm2);
  return finalizeTemplate(root, [], bAnim({
    sways: [
      { name: 'crane', axis: 'y', amp: 0.5, freq: 0.4 },
      { name: 'crane2', axis: 'y', amp: 0.6, freq: 0.55, phase: 2 },
    ],
  }));
};

// ---------------------------------------------------------------------------
const cPower: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 2, 2, 0.09, team);
  const cx = -0.1, cz = -0.05;
  b.add(new THREE.CylinderGeometry(0.66, 0.74, 0.14, 8), 'paint', P.cGun, T(cx, Y + 0.07, cz, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(0.5, 0.58, 0.1, 8), 'paint', P.cBlack, T(cx, Y + 0.19, cz, 0, Math.PI / 8, 0));
  b.add(new THREE.CylinderGeometry(0.665, 0.665, 0.02, 8), 'paint', P.cRed, T(cx, Y + 0.13, cz, 0, Math.PI / 8, 0));
  // claw pylons
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const p0: V3 = [cx + ca * 0.55, Y + 0.12, cz + sa * 0.55];
    const p1: V3 = [cx + ca * 0.62, Y + 0.6, cz + sa * 0.62];
    const p2: V3 = [cx + ca * 0.38, Y + 1.0, cz + sa * 0.38];
    strut(b, 'paint', P.cGun, p0, p1, 0.12, 0.12, 0.02);
    strut(b, 'paint', P.cGunLt, p1, p2, 0.09, 0.09, 0.015);
    b.box('paint', team, 0.13, 0.12, 0.13, p1[0] + (p0[0] - p1[0]) * 0.35, p1[1] - 0.17, p1[2] + (p0[2] - p1[2]) * 0.35, 0, -a, 0);
    b.sphere('paint', P.cRed, 0.06, p1[0], p1[1], p1[2], 1, 1, 1, 8, 6);
    spike(b, 'paint', P.cRed, p2[0], p2[1], p2[2], 0.22, 0.04, -sa * 2.2, ca * 2.2);
  }
  // capacitor block (front right)
  b.taper('paint', P.cGun, 0.4, 0.36, 0.3, 0.26, 0.28, 0.62, Y, 0.62);
  b.box('paint', team, 0.3, 0.05, 0.26, 0.62, Y + 0.22, 0.62);
  for (let i = 0; i < 3; i++) spike(b, 'paint', P.cBlack, 0.52 + i * 0.1, Y + 0.28, 0.62, 0.14, 0.025);
  pylon(b, -0.8, 0.78, 0.55);
  pylon(b, 0.78, -0.78, 0.55, 'e:red:blink');
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  // conduits in the plinth
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3 + Math.PI / 3;
    g.box('e:teal:pulse', 0, 0.5, 0.02, 0.04, cx + Math.cos(a) * 0.45, Y + 0.145, cz + Math.sin(a) * 0.45, 0, -a, 0);
  }
  g.add(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 8), 'e:teal:pulse', 0, T(cx, Y + 0.25, cz, 0, Math.PI / 8, 0));
  root.add(node('glow', g));
  const c = new B({ aoHeight: 0 });
  c.add(new THREE.OctahedronGeometry(0.2, 0), 'crystal', 0, T(0, 0, 0, 0, 0, 0, 0.8, 1.5, 0.8));
  c.torus('paint', P.cRed, 0.28, 0.012, 0, 0, 0, Math.PI / 2 + 0.3, 0, 0, 4, 20);
  root.add(node('core', c, cx, Y + 0.72, cz));
  return finalizeTemplate(root, [], bAnim({
    spins: [{ name: 'core', axis: 'y', rate: 1.2 }],
    bobs: [{ name: 'core', amp: 0.05, freq: 1.6, power: true }],
  }));
};

// ---------------------------------------------------------------------------
const cRefinery: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.09, team);
  // dock pad
  const px = 0.45, pz = 0.82, pw = 1.8, pd = 1.2;
  b.boxB('paint', 0x232428, pw, 0.02, pd, px, Y, pz);
  redFrame(b, px, pz, pw, pd, Y + 0.02, 0.07);
  chevron(b, px, Y + 0.035, pz + 0.25, 0.5, P.cRed, -1);
  chevron(b, px, Y + 0.035, pz - 0.05, 0.5, P.cRed, -1);
  for (const x of [px - 0.84, px + 0.84]) {
    b.taper('paint', P.cGun, 0.14, 0.18, 0.08, 0.1, 0.62, x, Y, 0.3);
    spike(b, 'paint', P.cBlack, x, Y + 0.62, 0.3, 0.2, 0.05);
    b.sphere('e:red:blink', 0, 0.025, x, Y + 0.5, 0.36, 1, 1, 1, 6, 4);
  }
  b.hull('paint', P.cGunLt, mz([[px - 0.84, Y + 0.5, 0.08], [px + 0.84, Y + 0.5, 0.08], [px, Y + 0.64, 0.08], [px - 0.84, Y + 0.56, 0.0], [px + 0.84, Y + 0.56, 0.0]]).map(([x, y, z]) => [x, y, z + 0.3] as V3));
  b.box('paint', team, 1.2, 0.05, 0.012, px, Y + 0.56, 0.39);
  // processing hall (angular)
  b.hull('paint', P.cGun, [
    [-1.38, Y, -1.38], [0.55, Y, -1.38], [-1.38, Y, 0.18], [0.55, Y, 0.18],
    [-1.3, Y + 0.7, -1.3], [0.45, Y + 0.7, -1.3], [-1.3, Y + 0.6, 0.1], [0.45, Y + 0.6, 0.1],
  ]);
  b.hull('paint', P.cGunLt, [[-1.2, Y + 0.64, -1.2], [0.3, Y + 0.64, -1.2], [-1.2, Y + 0.6, -0.1], [0.3, Y + 0.6, -0.1], [-1.0, Y + 0.95, -0.8], [0.1, Y + 0.95, -0.8], [-1.0, Y + 0.92, -0.5], [0.1, Y + 0.92, -0.5]]);
  b.box('paint', team, 1.0, 0.012, 0.28, -0.45, Y + 0.95, -0.65);
  for (let i = 0; i < 4; i++) spike(b, 'paint', P.cBlack, -1.1 + i * 0.4, Y + 0.64, -1.26, 0.35, 0.05, -0.4, 0);
  b.box('crystal', 0, 1.2, 0.07, 0.02, -0.45, Y + 0.25, 0.155);
  b.box('paint', P.cRed, 1.3, 0.02, 0.03, -0.45, Y + 0.31, 0.16);
  b.box('paint', P.cRed, 1.3, 0.02, 0.03, -0.45, Y + 0.19, 0.16);
  windowsZ(b, -1.2, 0.3, Y + 0.45, 0.13, 5, 0.12, 0.05, 'e:red');
  // crystal vats
  for (const vz of [-1.0, -0.35]) {
    const vx = 1.0;
    b.cyl('paint', P.cBlack, 0.3, 0.32, 0.12, 8, vx, Y + 0.06, vz);
    b.cyl('paint', P.cBlack, 0.29, 0.29, 0.08, 8, vx, Y + 0.76, vz);
    b.cyl('paint', P.cRed, 0.295, 0.295, 0.02, 8, vx, Y + 0.7, vz);
    spike(b, 'paint', P.cGun, vx, Y + 0.8, vz, 0.25, 0.1);
    for (let i = 0; i < 4; i++) b.box('paint', P.cGun, 0.04, 0.6, 0.04, vx + Math.cos(i * 1.57 + 0.78) * 0.26, Y + 0.42, vz + Math.sin(i * 1.57 + 0.78) * 0.26);
  }
  root.add(b.meshes());
  const c = new B({ aoHeight: 0 });
  for (const vz of [-1.0, -0.35]) {
    c.cone('crystal', 0, 0.12, 0.5, 6, 1.0, Y + 0.4, vz);
    c.cone('crystalCore', 0, 0.06, 0.4, 5, 1.0, Y + 0.42, vz, 0, 0.5, 0);
    c.cone('crystal', 0, 0.07, 0.3, 5, 1.08, Y + 0.3, vz + 0.05, 0.3, 0, -0.3);
  }
  root.add(c.meshes());
  return finalizeTemplate(root, [], bAnim({}));
};

// ---------------------------------------------------------------------------
const cBarracks: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 2, 2, 0.09, team);
  const hz = -0.2;
  b.taper('paint', P.cGun, 1.6, 1.3, 1.24, 1.0, 0.46, 0, Y, hz);
  b.taper('paint', team, 1.25, 1.01, 1.2, 0.97, 0.05, 0, Y + 0.46, hz);
  b.taper('paint', P.cBlack, 1.18, 0.95, 0.8, 0.7, 0.14, 0, Y + 0.51, hz);
  // entrance on +Z
  b.hull('paint', P.cGunLt, [[-0.28, Y, 0.45], [0.28, Y, 0.45], [-0.22, Y + 0.36, 0.42], [0.22, Y + 0.36, 0.42], [0, Y + 0.5, 0.38], [-0.28, Y, 0.3], [0.28, Y, 0.3], [0, Y + 0.5, 0.3]]);
  b.box('paint', P.dark, 0.26, 0.28, 0.02, 0, Y + 0.14, 0.455);
  b.box('e:red', 0, 0.2, 0.02, 0.02, 0, Y + 0.3, 0.46);
  b.boxB('paint', P.cBlack, 0.5, 0.03, 0.2, 0, Y, 0.56);
  // braziers
  for (const s of [1, -1]) {
    b.cyl('paint', P.cBlack, 0.05, 0.07, 0.22, 6, s * 0.55, Y + 0.11, 0.62);
    b.cyl('paint', P.cRed, 0.08, 0.05, 0.06, 6, s * 0.55, Y + 0.25, 0.62);
    b.cone('e:orange:flicker', 0, 0.05, 0.1, 5, s * 0.55, Y + 0.32, 0.62);
    spike(b, 'paint', P.cBlack, s * 0.78, Y, -0.72, 0.5, 0.06);
  }
  root.add(b.meshes());
  // The Hand: forearm rising from the roof, open clawed hand (own node, scaled up)
  const h = new B({ aoHeight: 0 });
  const hx = 0, hy = 0, hzz = 0;
  h.taper('paint', P.cGunLt, 0.28, 0.26, 0.2, 0.18, 0.38, hx, hy, hzz);
  h.cyl('paint', team, 0.15, 0.15, 0.06, 8, hx, hy + 0.32, hzz);
  h.cyl('paint', P.cRed, 0.155, 0.155, 0.015, 8, hx, hy + 0.36, hzz);
  const palmY = hy + 0.5;
  h.cbox('paint', P.cGun, 0.3, 0.26, 0.1, 0.03, hx, palmY, hzz, -0.25, 0, 0);
  h.box('e:red:pulse', 0, 0.09, 0.09, 0.02, hx, palmY, hzz + 0.055, -0.25, 0, 0);
  for (let i = 0; i < 4; i++) {
    const fx = hx - 0.105 + i * 0.07;
    const len = i === 1 || i === 2 ? 0.17 : 0.14;
    const a: V3 = [fx, palmY + 0.12, hzz - 0.03];
    const m: V3 = [fx + (fx - hx) * 0.15, palmY + 0.12 + len, hzz + 0.0];
    const t: V3 = [m[0], m[1] + len * 0.6, m[2] + 0.1];
    strut(h, 'paint', P.cGun, a, m, 0.055, 0.055, 0.012);
    strut(h, 'paint', P.cGunLt, m, t, 0.045, 0.045, 0.01);
    spike(h, 'paint', P.cRed, t[0], t[1], t[2], 0.09, 0.022, 1.2, 0);
  }
  strut(h, 'paint', P.cGun, [hx + 0.15, palmY - 0.05, hzz], [hx + 0.26, palmY + 0.08, hzz + 0.06], 0.06, 0.06, 0.012);
  spike(h, 'paint', P.cRed, hx + 0.26, palmY + 0.08, hzz + 0.06, 0.09, 0.024, 0.8, -0.8);
  const hand = node('hand', h, 0, Y + 0.6, hz - 0.1);
  hand.scale.setScalar(1.75);
  root.add(hand);
  return finalizeTemplate(root, [], bAnim({}));
};
// ---------------------------------------------------------------------------
const cFactory: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.09, team);
  const H = 0.9, fz = 0.6;
  // angular hangar
  b.hull('paint', P.cGun, [
    [-1.38, Y, -1.38], [1.38, Y, -1.38], [-1.38, Y, fz], [1.38, Y, fz],
    [-1.2, Y + H, -1.2], [1.2, Y + H, -1.2], [-1.2, Y + H, fz], [1.2, Y + H, fz],
  ]);
  b.hull('paint', P.cGunLt, [
    [-1.22, Y + H, -1.22], [1.22, Y + H, -1.22], [-1.22, Y + H, fz + 0.02], [1.22, Y + H, fz + 0.02],
    [-1.0, Y + H + 0.22, -0.55], [1.0, Y + H + 0.22, -0.55], [-1.0, Y + H + 0.18, -0.15], [1.0, Y + H + 0.18, -0.15],
  ]);
  // front portal
  for (const s of [1, -1]) {
    b.hull('paint', P.cGun, [
      [s * 0.66, Y, fz], [s * 1.38, Y, fz], [s * 0.66, Y, fz + 0.26], [s * 1.3, Y, fz + 0.26],
      [s * 0.66, Y + H + 0.1, fz], [s * 1.2, Y + H, fz], [s * 0.66, Y + H + 0.1, fz + 0.16], [s * 1.15, Y + H - 0.1, fz + 0.2],
    ]);
    b.box('paint', team, 0.4, 0.2, 0.012, s * 1.0, Y + 0.35, fz + 0.24, -0.1, 0, 0);
    b.box('e:orange:pulse', 0, 0.3, 0.03, 0.02, s * 1.0, Y + 0.62, fz + 0.21, -0.1, 0, 0);
    spike(b, 'paint', P.cBlack, s * 0.72, Y + H + 0.08, fz + 0.1, 0.45, 0.07, 0, s * -0.25);
    b.sphere('e:red:blink', 0, 0.025, s * 0.7, Y + H - 0.05, fz + 0.2, 1, 1, 1, 6, 4);
  }
  b.hull('paint', P.cBlack, [[-0.68, Y + H - 0.16, fz], [0.68, Y + H - 0.16, fz], [-0.68, Y + H - 0.16, fz + 0.2], [0.68, Y + H - 0.16, fz + 0.2], [-0.68, Y + H + 0.1, fz], [0.68, Y + H + 0.1, fz], [0, Y + H + 0.1, fz + 0.18]]);
  b.box('paint', P.cRed, 1.3, 0.02, 0.02, 0, Y + H - 0.15, fz + 0.21);
  // dark interior with forge glow
  b.box('paint', 0x0b0b0c, 1.34, 0.74, 0.02, 0, Y + 0.37, fz + 0.005);
  b.box('e:orange:pulse', 0, 1.1, 0.06, 0.02, 0, Y + 0.1, fz + 0.02);
  // roof: forge vents, chimneys, fins
  for (const x of [-0.7, 0, 0.7]) {
    b.box('paint', P.cBlack, 0.4, 0.05, 0.22, x, Y + H + 0.15, 0.25, 0.5, 0, 0);
    b.box('e:orange:pulse', 0, 0.3, 0.02, 0.14, x, Y + H + 0.175, 0.25, 0.5, 0, 0);
  }
  for (const x of [-0.9, 0.9]) {
    b.taper('paint', P.cBlack, 0.16, 0.16, 0.1, 0.1, 0.5, x, Y + H + 0.05, -0.9);
    b.box('e:orange:flicker', 0, 0.08, 0.02, 0.08, x, Y + H + 0.56, -0.9);
  }
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.4;
    b.hull('paint', P.cGun, [[x - 0.12, Y + H + 0.2, -0.4], [x + 0.12, Y + H + 0.2, -0.4], [x - 0.1, Y + H + 0.2, -0.3], [x + 0.1, Y + H + 0.2, -0.3], [x - 0.02, Y + H + 0.55, -0.6]]);
  }
  b.box('paint', team, 1.6, 0.012, 0.3, 0, Y + H + 0.15, -1.0, -0.33, 0, 0);
  // ramp
  b.hull('paint', 0x26272c, [
    [-0.68, Y, fz + 0.2], [0.68, Y, fz + 0.2], [-0.68, Y + 0.03, fz + 0.2], [0.68, Y + 0.03, fz + 0.2],
    [-0.74, Y, 1.44], [0.74, Y, 1.44], [-0.74, Y + 0.01, 1.44], [0.74, Y + 0.01, 1.44],
  ]);
  chevron(b, 0, Y + 0.03, 1.0, 0.45, P.cRed, 1);
  chevron(b, 0, Y + 0.025, 1.25, 0.45, P.cRed, 1);
  redStripZ(b, fz + 0.22, 1.42, Y + 0.015, -0.68, 0.05, 6);
  redStripZ(b, fz + 0.22, 1.42, Y + 0.015, 0.68, 0.05, 6);
  pylon(b, -1.25, 1.25, 0.6);
  pylon(b, 1.25, 1.25, 0.6, 'e:red:blink');
  root.add(b.meshes());
  // blast door
  const d = new B({ aoHeight: 0 });
  d.box('paint', P.cGunLt, 1.34, 0.74, 0.03, 0, -0.37, 0);
  for (let i = 0; i < 6; i++) d.box('paint', P.cBlack, 1.34, 0.015, 0.036, 0, -0.06 - i * 0.12, 0);
  d.hull('paint', team, [[-0.3, -0.2, 0.02], [0.3, -0.2, 0.02], [0, -0.55, 0.02], [-0.3, -0.2, 0.035], [0.3, -0.2, 0.035], [0, -0.55, 0.035]]);
  redStripX(d, -0.67, 0.67, -0.74, 0, 0.04, 10);
  root.add(node('door', d, 0, Y + 0.74, fz + 0.04));
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
const cRadar: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 2, 2, 0.09, team);
  const cx = -0.1, cz = -0.1;
  b.add(new THREE.CylinderGeometry(0.55, 0.66, 0.32, 6), 'paint', P.cGun, T(cx, Y + 0.16, cz));
  b.add(new THREE.CylinderGeometry(0.585, 0.59, 0.05, 6), 'paint', team, T(cx, Y + 0.25, cz));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.box('e:red', 0, 0.12, 0.03, 0.02, cx + Math.cos(a) * 0.54, Y + 0.18, cz + Math.sin(a) * 0.54, 0, -a + Math.PI / 2, 0.0);
  }
  b.taper('paint', P.cGunLt, 0.34, 0.34, 0.1, 0.1, 1.0, cx, Y + 0.32, cz);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    strut(b, 'paint', P.cRed, [cx + sx * 0.165, Y + 0.34, cz + sz * 0.165], [cx + sx * 0.05, Y + 1.3, cz + sz * 0.05], 0.018);
  }
  spike(b, 'paint', P.cBlack, cx, Y + 1.32, cz, 0.3, 0.06);
  // side dish (static)
  b.cyl('paint', P.cBlack, 0.1, 0.12, 0.2, 6, 0.6, Y + 0.1, 0.62);
  dish(b, 'paint', P.cGun, 0.22, 0.06, 0.6, Y + 0.22, 0.62, 12);
  pylon(b, -0.8, 0.75, 0.5);
  pylon(b, 0.75, -0.8, 0.5, 'e:red:blink');
  root.add(b.meshes());
  const r = new B({ aoHeight: 0 });
  r.torus('paint', P.cGun, 0.36, 0.022, 0, 0, 0, Math.PI / 2, 0, 0, 5, 20);
  r.torus('paint', P.cRed, 0.36, 0.008, 0, 0.022, 0, Math.PI / 2, 0, 0, 3, 20);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    strut(r, 'paint', P.cGunLt, [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08], [Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36], 0.03, 0.02);
    r.hull('paint', P.cBlack, [
      [Math.cos(a) * 0.36, -0.12, Math.sin(a) * 0.36], [Math.cos(a) * 0.36, 0.18, Math.sin(a) * 0.36],
      [Math.cos(a) * 0.44, 0.02, Math.sin(a) * 0.44], [Math.cos(a + 0.12) * 0.37, 0, Math.sin(a + 0.12) * 0.37], [Math.cos(a - 0.12) * 0.37, 0, Math.sin(a - 0.12) * 0.37],
    ]);
  }
  r.sphere('e:red:pulse', 0, 0.05, 0.42, 0.02, 0, 1, 1, 1, 8, 6);
  r.cyl('paint', P.cBlack, 0.09, 0.09, 0.06, 8, 0, 0, 0);
  root.add(node('dish', r, cx, Y + 0.95, cz));
  const e = new B({ aoHeight: 0 });
  e.sphere('e:red:pulse', 0, 0.06, 0, 0, 0, 1, 1.3, 1, 8, 6);
  root.add(node('eye', e, cx, Y + 1.25, cz));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'dish', axis: 'y', rate: 1.1 }] }));
};

// ---------------------------------------------------------------------------
const cRepair: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.08, team);
  const Yr = 0.08;
  b.boxB('paint', 0x26272c, 2.2, 0.035, 2.2, 0.1, Yr, 0.1);
  redFrame(b, 0.1, 0.1, 2.2, 2.2, Yr + 0.035, 0.08);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box('paint', team, 0.3, 0.01, 0.08, 0.1 + Math.cos(a) * 0.55, Yr + 0.04, 0.1 + Math.sin(a) * 0.55, 0, -a + Math.PI / 2, 0);
  }
  // control spire
  b.taper('paint', P.cGun, 0.36, 0.36, 0.18, 0.18, 0.6, -1.18, Y - 0.01, -1.18);
  b.box('e:red', 0, 0.2, 0.04, 0.02, -1.18, Y + 0.35, -1.05);
  spike(b, 'paint', P.cBlack, -1.18, Y + 0.58, -1.18, 0.3, 0.07);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    if (i % 4 === 3) continue;
    g.box('e:teal:pulse', 0, 0.2, 0.01, 0.04, 0.1 + Math.cos(a) * 0.82, Yr + 0.042, 0.1 + Math.sin(a) * 0.82, 0, -a + Math.PI / 2, 0);
  }
  root.add(node('glow', g));
  const a = new B({ aoHeight: 0 });
  for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) {
    a.cyl('paint', P.cBlack, 0.08, 0.1, 0.1, 6, x, 0.05, z);
    const m: V3 = [x * 0.95, 0.55, z * 0.95], t: V3 = [x * 0.5, 0.36, z * 0.5];
    strut(a, 'paint', P.cGun, [x, 0.08, z], m, 0.06, 0.06, 0.01);
    strut(a, 'paint', P.cGunLt, m, t, 0.045, 0.045, 0.01);
    a.sphere('paint', P.cRed, 0.04, m[0], m[1], m[2], 1, 1, 1, 6, 4);
    spike(a, 'paint', P.cRed, t[0], t[1], t[2], 0.1, 0.025, Math.PI, 0);
    a.sphere('e:teal:pulse', 0, 0.025, t[0], t[1] - 0.1, t[2], 1, 1, 1, 6, 4);
  }
  root.add(node('arms', a, 0.1, Yr + 0.035, 0.1));
  return finalizeTemplate(root, [], bAnim({ sways: [{ name: 'arms', axis: 'y', amp: 0.2, freq: 0.9, power: true }] }));
};

// ---------------------------------------------------------------------------
const cAirfield: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.08, team);
  const Yr = 0.08;
  const rz = 0.35;
  b.boxB('paint', 0x2a2b2f, 2.7, 0.02, 1.5, 0, Yr, rz);
  for (let i = 0; i < 7; i++) b.box('paint', i % 2 ? P.white : P.cRed, 0.22, 0.008, 0.05, -1.05 + i * 0.35, Yr + 0.024, rz);
  for (let i = 0; i < 5; i++) {
    b.box('paint', P.white, 0.2, 0.008, 0.04, -1.15, Yr + 0.024, rz - 0.5 + i * 0.25);
    b.box('paint', P.white, 0.2, 0.008, 0.04, 1.15, Yr + 0.024, rz - 0.5 + i * 0.25);
  }
  b.box('paint', team, 0.1, 0.01, 1.3, -1.3, Yr + 0.025, rz);
  b.box('paint', team, 0.1, 0.01, 1.3, 1.3, Yr + 0.025, rz);
  for (let i = 0; i < 6; i++) {
    const x = -1.25 + i * 0.5;
    b.box(i % 2 ? 'e:red' : 'e:red:blink', 0, 0.04, 0.03, 0.04, x, Yr + 0.035, rz + 0.72);
    b.box(i % 2 ? 'e:red' : 'e:red:blink', 0, 0.04, 0.03, 0.04, x, Yr + 0.035, rz - 0.72);
  }
  // hangar bunker (back right)
  b.hull('paint', P.cGun, [[0.0, Y, -1.38], [1.38, Y, -1.38], [0.0, Y, -0.5], [1.38, Y, -0.5], [0.1, Y + 0.42, -1.3], [1.3, Y + 0.42, -1.3], [0.1, Y + 0.3, -0.62], [1.3, Y + 0.3, -0.62]]);
  b.box('paint', P.dark, 0.7, 0.24, 0.02, 0.7, Y + 0.12, -0.5);
  b.box('e:orange', 0, 0.6, 0.02, 0.02, 0.7, Y + 0.26, -0.49);
  b.box('paint', team, 0.8, 0.012, 0.3, 0.7, Y + 0.37, -0.95, -0.17, 0, 0);
  for (let i = 0; i < 3; i++) spike(b, 'paint', P.cBlack, 0.25 + i * 0.45, Y + 0.38, -1.25, 0.25, 0.04, -0.3, 0);
  // control spire (back left)
  const tx = -0.95, tz = -0.95;
  b.taper('paint', P.cGun, 0.5, 0.5, 0.26, 0.26, 0.9, tx, Y, tz);
  b.taper('paint', P.cBlack, 0.34, 0.34, 0.4, 0.4, 0.14, tx, Y + 0.9, tz);
  b.taper('e:red', 0, 0.4, 0.4, 0.38, 0.38, 0.05, tx, Y + 0.97, tz);
  spike(b, 'paint', P.cGunLt, tx, Y + 1.04, tz, 0.4, 0.1);
  b.box('paint', team, 0.4, 0.06, 0.4, tx, Y + 0.4, tz);
  root.add(b.meshes());
  const r = new B({ aoHeight: 0 });
  r.box('e:red', 0, 0.06, 0.03, 0.03, 0.05, 0, 0);
  r.box('paint', P.cBlack, 0.03, 0.05, 0.05, 0, 0, 0);
  root.add(node('beacon', r, tx, Y + 1.3, tz));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'beacon', axis: 'y', rate: 4 }] }));
};

// ---------------------------------------------------------------------------
const cTemple: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.09, team);
  const cz = -0.15;
  b.taper('paint', P.cGun, 2.5, 2.3, 2.1, 1.9, 0.32, 0, Y, cz);
  b.taper('paint', P.cRed, 2.1, 1.9, 2.06, 1.86, 0.03, 0, Y + 0.32, cz);
  b.taper('paint', P.cGunLt, 1.9, 1.7, 1.4, 1.2, 0.36, 0, Y + 0.35, cz);
  b.taper('paint', team, 1.4, 1.2, 1.36, 1.16, 0.04, 0, Y + 0.71, cz);
  b.taper('paint', P.cGun, 1.26, 1.06, 0.8, 0.6, 0.36, 0, Y + 0.75, cz);
  b.taper('paint', P.cBlack, 0.7, 0.54, 0.3, 0.24, 0.3, 0, Y + 1.11, cz);
  // stairway down the +Z face
  for (let i = 0; i < 6; i++) b.boxB('paint', P.cBlack, 0.44, 0.12 + i * 0.12, 0.12, 0, Y, cz + 1.12 - i * 0.12);
  for (const s of [1, -1]) {
    b.box('e:red', 0, 0.02, 0.02, 0.72, s * 0.235, Y + 0.38, cz + 0.8, 0.8, 0, 0);
    b.cyl('paint', P.cBlack, 0.05, 0.07, 0.22, 6, s * 0.4, Y + 0.11, 1.2);
    b.cone('e:orange:flicker', 0, 0.05, 0.1, 5, s * 0.4, Y + 0.27, 1.2);
  }
  // red glowing slits on the tiers
  for (const s of [1, -1]) {
    windowsZ(b, -0.8, -0.3, Y + 0.18, cz + 1.12 * s, 2, 0.12, 0.05, 'e:red', s);
    windowsZ(b, 0.3, 0.8, Y + 0.18, cz + 1.12 * s, 2, 0.12, 0.05, 'e:red', s);
  }
  // corner obelisks
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.taper('paint', P.cGun, 0.16, 0.16, 0.06, 0.06, 0.7, sx * 1.25, Y, sz * 1.25);
    spike(b, 'paint', P.cRed, sx * 1.25, Y + 0.7, sz * 1.25, 0.12, 0.04);
  }
  // apex spikes cradling the crystal
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    spike(b, 'paint', P.cGunLt, Math.cos(a) * 0.14, Y + 1.38, cz + Math.sin(a) * 0.14, 0.5, 0.05, Math.sin(a) * 0.35, -Math.cos(a) * 0.35);
  }
  root.add(b.meshes());
  const c = new B({ aoHeight: 0 });
  c.add(new THREE.OctahedronGeometry(0.16, 0), 'crystal', 0, T(0, 0, 0, 0, 0, 0, 0.8, 1.6, 0.8));
  c.torus('paint', P.cRed, 0.22, 0.012, 0, 0, 0, Math.PI / 2, 0, 0, 4, 20);
  root.add(node('core', c, 0, Y + 1.72, cz));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'core', axis: 'y', rate: 0.8 }], bobs: [{ name: 'core', amp: 0.04, freq: 1.3, power: true }] }));
};

// ---------------------------------------------------------------------------
const cSilo: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  slabCov(b, 3, 3, 0.09, team);
  const hx = 0.15, hz = 0.2;
  b.taper('paint', P.cGun, 2.4, 2.1, 2.1, 1.8, 0.24, 0, Y, 0.1);
  b.cyl('paint', P.cBlack, 0.78, 0.84, 0.1, 16, hx, Y + 0.29, hz);
  b.cyl('paint', P.cRed, 0.785, 0.785, 0.02, 16, hx, Y + 0.33, hz);
  // hatch doors (two halves)
  for (const s of [1, -1]) {
    b.add(new THREE.CylinderGeometry(0.68, 0.68, 0.06, 16, 1, false, s > 0 ? 0 : Math.PI, Math.PI), 'paint', P.cGunLt, T(hx + s * 0.02, Y + 0.36, hz));
    for (let i = 0; i < 3; i++) b.box('paint', P.cBlack, 0.02, 0.012, 1.1 - i * 0.3, hx + s * (0.15 + i * 0.17), Y + 0.395, hz);
  }
  b.box('paint', team, 0.3, 0.012, 0.3, hx + 0.38, Y + 0.395, hz, 0, Math.PI / 4, 0);
  b.box('paint', team, 0.3, 0.012, 0.3, hx - 0.38, Y + 0.395, hz, 0, Math.PI / 4, 0);
  // warning chevrons around hatch
  redStripX(b, -0.9, 1.2, Y + 0.24, 1.05, 0.08, 14);
  // control block (back left)
  b.hull('paint', P.cGunLt, [[-1.3, Y, -1.3], [-0.3, Y, -1.3], [-1.3, Y, -0.6], [-0.3, Y, -0.6], [-1.2, Y + 0.55, -1.2], [-0.4, Y + 0.55, -1.2], [-1.2, Y + 0.45, -0.7], [-0.4, Y + 0.45, -0.7]]);
  windowsZ(b, -1.1, -0.5, Y + 0.3, -0.62, 3, 0.1, 0.05, 'e:red');
  spike(b, 'paint', P.cBlack, -0.8, Y + 0.52, -0.95, 0.55, 0.08);
  // missile tip braces
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    spike(b, 'paint', P.cGun, hx + Math.cos(a) * 0.85, Y + 0.24, hz + Math.sin(a) * 0.85, 0.5, 0.06, Math.sin(a) * 0.5, -Math.cos(a) * 0.5);
  }
  pylon(b, 1.25, -1.25, 0.7);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  g.box('e:teal:pulse', 0, 0.04, 0.02, 1.3, hx, Y + 0.39, hz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.box('e:orange:pulse', 0, 0.06, 0.02, 0.1, hx + Math.cos(a) * 0.74, Y + 0.345, hz + Math.sin(a) * 0.74, 0, -a, 0);
  }
  root.add(node('glow', g));
  const r = new B({ aoHeight: 0 });
  r.cyl('paint', P.cBlack, 0.04, 0.05, 0.05, 6, 0, 0.025, 0);
  r.box('e:red', 0, 0.07, 0.04, 0.035, 0.035, 0.06, 0);
  root.add(node('beacon', r, -0.4, Y + 0.55, -0.7));
  return finalizeTemplate(root, [], bAnim({ spins: [{ name: 'beacon', axis: 'y', rate: 3.5, power: false }] }));
};

// ---------------------------------------------------------------------------
// Defences
// ---------------------------------------------------------------------------
function smallPlinth(b: B, team?: THREE.Color): void {
  b.taper('paint', P.cBlack, 0.94, 0.94, 0.84, 0.84, 0.07, 0, 0, 0);
  b.boxB('paint', 0x26272c, 0.8, 0.008, 0.8, 0, 0.07, 0);
  if (team) for (const s of [1, -1]) b.box('paint', team, 0.3, 0.01, 0.04, 0, 0.075, s * 0.38);
}

const cTurret: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallPlinth(b, team);
  b.hull('paint', P.cGun, [
    [-0.4, 0.07, -0.2], [-0.4, 0.07, 0.2], [0.4, 0.07, -0.2], [0.4, 0.07, 0.2], [-0.2, 0.07, -0.4], [0.2, 0.07, -0.4], [-0.2, 0.07, 0.4], [0.2, 0.07, 0.4],
    [-0.26, 0.22, -0.12], [-0.26, 0.22, 0.12], [0.26, 0.22, -0.12], [0.26, 0.22, 0.12], [-0.12, 0.22, -0.26], [0.12, 0.22, -0.26], [-0.12, 0.22, 0.26], [0.12, 0.22, 0.26],
  ]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    spike(b, 'paint', P.cBlack, Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36, 0.22, 0.04, Math.sin(a) * 0.5, -Math.cos(a) * 0.5);
  }
  b.cyl('e:orange:pulse', 0, 0.2, 0.2, 0.02, 12, 0, 0.225, 0);
  root.add(b.meshes());
  const t = new B({ aoBase: 0.23, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.cBlack, 0.18, 0.2, 0.04, 10, 0, 0.02, 0);
  t.hull('paint', P.cGunLt, mz([[-0.2, 0.03, 0.14], [0.1, 0.03, 0.16], [0.24, 0.03, 0.05], [-0.18, 0.15, 0.09], [0.06, 0.15, 0.1], [0.18, 0.11, 0.03]]));
  t.box('paint', team, 0.12, 0.01, 0.14, -0.06, 0.153, 0);
  t.box('paint', P.cRed, 0.012, 0.012, 0.18, 0.07, 0.15, 0);
  spike(t, 'paint', P.cBlack, -0.16, 0.1, 0.12, 0.12, 0.025, 1.0, 0.8);
  spike(t, 'paint', P.cBlack, -0.16, 0.1, -0.12, 0.12, 0.025, -1.0, 0.8);
  t.box('e:red', 0, 0.02, 0.015, 0.06, 0.18, 0.11, 0.06);
  const turret = node('turret', t, 0, 0.23, 0);
  root.add(turret);
  const g = new B({ aoHeight: 0 });
  g.cylX('paint', P.cBlack, 0.024, 0.03, 0.46, 8, 0.23, 0, 0);
  g.cylX('paint', P.cRed, 0.034, 0.034, 0.04, 8, 0.1, 0, 0);
  g.hull('paint', P.cGun, mz([[0.44, -0.03, 0.03], [0.5, 0, 0.04], [0.52, 0.03, 0.03], [0.44, 0.03, 0.03], [0.5, -0.03, 0.04]]));
  turret.add(node('gun', g, 0.14, 0.08, 0));
  return finalizeTemplate(root, [new THREE.Vector3(0.14 + 0.53, 0.08, 0)], bAnim({
    extra: (r) => {
      const gun = byName(r, 'gun');
      const gx = gun?.position.x ?? 0;
      return (_dt, s) => {
        if (gun) gun.position.x = gx - s.firing * s.firing * 0.06;
      };
    },
  }));
};

const cFlak: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallPlinth(b, team);
  b.taper('paint', P.cGun, 0.66, 0.66, 0.5, 0.5, 0.16, 0, 0.07, 0);
  for (const k of [1, -1]) {
    b.box('paint', P.cRed, 0.5, 0.012, 0.03, 0, 0.232, k * 0.235);
    b.box('paint', P.cRed, 0.03, 0.012, 0.44, k * 0.235, 0.232, 0);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    spike(b, 'paint', P.cBlack, Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36, 0.3, 0.04, Math.sin(a) * 0.3, -Math.cos(a) * 0.3);
  }
  root.add(b.meshes());
  const t = new B({ aoBase: 0.23, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.cBlack, 0.18, 0.2, 0.05, 8, 0, 0.025, 0);
  for (const s of [1, -1]) t.hull('paint', P.cGunLt, [[-0.12, 0.05, s * 0.12], [0.1, 0.05, s * 0.12], [-0.12, 0.05, s * 0.18], [0.1, 0.05, s * 0.18], [-0.06, 0.26, s * 0.13], [0.02, 0.26, s * 0.13], [-0.06, 0.26, s * 0.17], [0.02, 0.26, s * 0.17]]);
  t.box('paint', team, 0.1, 0.01, 0.06, -0.02, 0.265, 0.15);
  t.box('paint', team, 0.1, 0.01, 0.06, -0.02, 0.265, -0.15);
  const turret = node('turret', t, 0, 0.23, 0);
  root.add(turret);
  const pitch = 0.55;
  const g = new B({ aoHeight: 0 });
  g.cbox('paint', P.cGun, 0.2, 0.12, 0.2, 0.02, 0, 0, 0);
  g.box('paint', P.cRed, 0.02, 0.122, 0.2, 0.08, 0, 0);
  const barrels: [number, number][] = [[0.03, 0.05], [0.03, -0.05], [-0.03, 0.05], [-0.03, -0.05]];
  for (const [by, bz] of barrels) g.cylX('paint', P.cBlack, 0.014, 0.018, 0.34, 6, 0.24, by, bz);
  g.box('e:orange', 0, 0.02, 0.02, 0.06, -0.1, 0.0, 0);
  const gn = node('gun', g, 0, 0.18, 0);
  gn.rotation.z = pitch;
  turret.add(gn);
  const muz = barrels.map(([by, bz]) => {
    const x = 0.41;
    return new THREE.Vector3(x * Math.cos(pitch) - by * Math.sin(pitch), 0.18 + x * Math.sin(pitch) + by * Math.cos(pitch), bz);
  });
  return finalizeTemplate(root, muz, bAnim({}));
};

const cObelisk: F = (team) => {
  const root = new THREE.Group();
  const b = bld();
  smallPlinth(b, team);
  b.taper('paint', P.cGun, 0.72, 0.72, 0.54, 0.54, 0.14, 0, 0.07, 0);
  for (const k of [1, -1]) {
    b.box('paint', P.cRed, 0.54, 0.012, 0.03, 0, 0.212, k * 0.255);
    b.box('paint', P.cRed, 0.03, 0.012, 0.48, k * 0.255, 0.212, 0);
  }
  // obelisk shaft with a slanted crystal face towards +X
  const H = 1.45;
  b.hull('paint', P.cBlack, [
    [-0.2, 0.21, -0.2], [0.2, 0.21, -0.2], [-0.2, 0.21, 0.2], [0.2, 0.21, 0.2],
    [-0.1, H, -0.08], [0.02, H + 0.08, -0.08], [-0.1, H, 0.08], [0.02, H + 0.08, 0.08], [-0.06, H + 0.2, 0],
  ]);
  // raised edge ribs
  for (const s of [1, -1]) {
    strut(b, 'paint', P.cGunLt, [0.2, 0.21, s * 0.2], [0.02, H + 0.08, s * 0.08], 0.035, 0.035, 0.006);
    strut(b, 'paint', P.cGunLt, [-0.2, 0.21, s * 0.2], [-0.1, H, s * 0.08], 0.035, 0.035, 0.006);
  }
  b.box('paint', team, 0.2, 0.06, 0.42, -0.02, 0.36, 0);
  // wing fins
  for (const s of [1, -1]) b.hull('paint', P.cGun, [[0, 0.21, s * 0.2], [-0.16, 0.21, s * 0.2], [-0.05, 0.9, s * 0.1], [0, 0.21, s * 0.34], [-0.1, 0.21, s * 0.36]]);
  root.add(b.meshes());
  // red energy seam running up the front face
  const g = new B({ aoHeight: 0 });
  const face = new THREE.Vector3(0.2 - 0.02, 0.21 - (H + 0.08), 0).normalize();
  const ang = Math.atan2(face.x, -face.y);
  g.box('e:red:pulse', 0, 0.02, H - 0.25, 0.05, 0.12, 0.21 + (H - 0.1) / 2, 0, 0, 0, ang);
  for (let i = 0; i < 4; i++) g.box('e:red:pulse', 0, 0.022, 0.03, 0.2 - i * 0.02, 0.18 - i * 0.04, 0.4 + i * 0.28, 0, 0, 0, ang);
  root.add(node('glow', g));
  const tip = new B({ aoHeight: 0 });
  tip.add(new THREE.OctahedronGeometry(0.09, 0), 'e:red:pulse', 0, T(0, 0, 0, 0, 0, 0, 1.2, 1.6, 1.2));
  const tipY = H + 0.02;
  root.add(node('tip', tip, 0.06, tipY, 0));
  return finalizeTemplate(root, [new THREE.Vector3(0.1, tipY, 0)], bAnim({
    extra: (r) => {
      const t = byName(r, 'tip');
      let charge = 0;
      return (dt, s) => {
        charge = Math.max(s.firing, damp(charge, 0, 2, dt));
        const k = s.powered ? 1 + charge * 1.8 + Math.sin(s.time * 3) * 0.06 : 0.6;
        if (t) t.scale.setScalar(k);
      };
    },
  }));
};

const cWall: F = (team) => {
  const root = new THREE.Group();
  const b = new B({ aoHeight: 0.3, aoMin: 0.55, jitter: 0.04, seed: 5 });
  b.taper('paint', P.cBlack, 1.0, 1.0, 0.92, 0.92, 0.06, 0, 0, 0);
  b.taper('paint', P.cGun, 0.9, 0.9, 0.66, 0.66, 0.38, 0, 0.06, 0);
  for (const s of [1, -1]) {
    b.hull('paint', P.cGun, [[s * 0.44, 0.06, -0.3], [s * 0.5, 0.06, -0.3], [s * 0.44, 0.06, 0.3], [s * 0.5, 0.06, 0.3], [s * 0.34, 0.36, -0.24], [s * 0.5, 0.36, -0.24], [s * 0.34, 0.36, 0.24], [s * 0.5, 0.36, 0.24]]);
    b.hull('paint', P.cGun, [[-0.3, 0.06, s * 0.44], [-0.3, 0.06, s * 0.5], [0.3, 0.06, s * 0.44], [0.3, 0.06, s * 0.5], [-0.24, 0.36, s * 0.34], [-0.24, 0.36, s * 0.5], [0.24, 0.36, s * 0.34], [0.24, 0.36, s * 0.5]]);
  }
  b.taper('paint', P.cBlack, 0.66, 0.66, 0.5, 0.5, 0.06, 0, 0.44, 0);
  b.hull('paint', P.cGunLt, [[-0.3, 0.5, -0.05], [0.3, 0.5, -0.05], [-0.3, 0.5, 0.05], [0.3, 0.5, 0.05], [-0.2, 0.72, 0], [0.12, 0.66, 0], [0.26, 0.56, 0]]);
  b.hull('paint', P.cGun, [[-0.05, 0.5, -0.3], [-0.05, 0.5, 0.3], [0.05, 0.5, -0.3], [0.05, 0.5, 0.3], [0, 0.66, -0.16], [0, 0.62, 0.2]]);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) spike(b, 'paint', P.cBlack, sx * 0.26, 0.44, sz * 0.26, 0.14, 0.05, sz * 0.3, -sx * 0.3);
  b.box('paint', team, 0.2, 0.012, 0.2, 0, 0.44, 0, 0, Math.PI / 4, 0);
  root.add(b.meshes());
  const g = new B({ aoHeight: 0 });
  g.taper('e:red:pulse', 0, 0.845, 0.845, 0.83, 0.83, 0.025, 0, 0.18, 0);
  root.add(g.meshes());
  return finalizeTemplate(root, []);
};

void hazardStripX;

export const COVENANT_STRUCTURES: Record<string, F> = {
  c_yard: cYard,
  c_power: cPower,
  c_refinery: cRefinery,
  c_barracks: cBarracks,
  c_factory: cFactory,
  c_radar: cRadar,
  c_repair: cRepair,
  c_airfield: cAirfield,
  c_temple: cTemple,
  c_silo: cSilo,
  c_turret: cTurret,
  c_flak: cFlak,
  c_obelisk: cObelisk,
  c_wall: cWall,
};
