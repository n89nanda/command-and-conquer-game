/** Neutral / civilian structures. */
import * as THREE from 'three';
import { B, P, Template, finalizeTemplate, node, strut, pipe, windowsZ, windowsX, hazardStripX, antenna } from './kit';
import { lattice, bAnim, flag } from './structures_common';

type F = (team: THREE.Color) => Template;

// ---------------------------------------------------------------------------
// Oil derrick 2x2 — lattice tower, nodding pumpjack, tanks
// ---------------------------------------------------------------------------
const nDerrick: F = (team) => {
  const root = new THREE.Group();
  const b = new B({ aoHeight: 0.4, aoMin: 0.5 });
  // compacted dirt pad + oily stain
  b.cboxB('matte', 0x6e5f47, 1.9, 0.05, 1.9, 0.02, 0, 0, 0);
  b.cyl('matte', 0x2a2420, 0.26, 0.3, 0.008, 12, 0.35, 0.054, 0.3);
  // derrick tower
  const dx = -0.5, dz = -0.45;
  b.boxB('paint', P.aConcreteDk, 0.5, 0.06, 0.5, dx, 0.05, dz);
  lattice(b, dx, 0.11, dz, 0.34, 0.5, P.rust, 3, 0.03);
  lattice(b, dx, 0.61, dz, 0.24, 0.5, P.rust, 3, 0.026);
  lattice(b, dx, 1.11, dz, 0.14, 0.3, P.rust, 2, 0.022);
  b.boxB('paint', P.rust, 0.24, 0.04, 0.24, dx, 1.41, dz);
  b.sphere('e:red:blink', 0, 0.025, dx, 1.48, dz, 1, 1, 1, 6, 4);
  b.boxB('paint', P.white, 0.36, 0.03, 0.36, dx, 0.6, dz);
  b.cboxB('paint', 0x8a8a80, 0.22, 0.14, 0.2, 0.01, dx + 0.3, 0.05, dz + 0.1);
  // storage tanks
  for (const [tx, tz, r] of [[0.55, -0.55, 0.26], [-0.55, 0.55, 0.22]] as const) {
    b.cyl('paint', P.white, r, r, 0.46, 14, tx, 0.05 + 0.23, tz);
    b.cyl('paint', P.red, r + 0.004, r + 0.004, 0.06, 14, tx, 0.05 + 0.36, tz);
    b.dome('paint', 0xbdbdb5, r, tx, 0.51, tz, 0.3, 14, 3);
    b.box('paint', 0x444444, 0.03, 0.46, 0.05, tx + r, 0.28, tz, 0, 0, 0);
  }
  b.cyl('paint', team, 0.265, 0.265, 0.04, 14, 0.55, 0.2, -0.55);
  pipe(b, 'metal', 0x6a6a64, [0.29, 0.12, -0.55], [0.05, 0.12, 0.25], 0.025);
  pipe(b, 'metal', 0x6a6a64, [-0.33, 0.12, 0.55], [0.0, 0.12, 0.3], 0.025);
  pipe(b, 'metal', 0x6a6a64, [dx + 0.17, 0.12, dz], [0.05, 0.12, 0.25], 0.025);
  // pumpjack base + A-frame
  const px = 0.2, pz = 0.3;
  b.boxB('paint', 0x4a4a44, 0.8, 0.05, 0.22, px, 0.05, pz);
  strut(b, 'paint', P.hazardY, [px - 0.05, 0.1, pz + 0.08], [px + 0.02, 0.42, pz], 0.035);
  strut(b, 'paint', P.hazardY, [px - 0.05, 0.1, pz - 0.08], [px + 0.02, 0.42, pz], 0.035);
  strut(b, 'paint', P.hazardY, [px + 0.12, 0.1, pz], [px + 0.02, 0.42, pz], 0.03);
  b.cboxB('paint', 0x55554c, 0.16, 0.12, 0.14, 0.01, px - 0.3, 0.1, pz); // gearbox
  b.cyl('paint', 0x333333, 0.02, 0.025, 0.12, 6, px + 0.3, 0.16, pz); // wellhead
  flag(b, 0.8, 0.05, 0.8, 0.6, team);
  hazardStripX(b, -0.9, 0.9, 0.05, 0.9, 0.04, 12);
  root.add(b.meshes());
  // walking beam (pivots at A-frame apex)
  const w = new B({ aoHeight: 0 });
  w.box('paint', P.hazardY, 0.62, 0.04, 0.05, 0.02, 0, 0);
  w.prism('paint', P.hazardY, [[0.3, 0.05], [0.36, 0.03], [0.37, -0.08], [0.33, -0.12], [0.3, -0.04]], 0.07);
  w.cyl('paint', 0x222222, 0.004, 0.004, 0.22, 4, 0.35, -0.2, 0);
  w.box('paint', 0x55554c, 0.06, 0.03, 0.08, -0.28, -0.03, 0);
  root.add(node('beam', w, px + 0.02, 0.44, pz));
  // crank counterweights
  const c = new B({ aoHeight: 0 });
  c.box('paint', P.red, 0.18, 0.06, 0.02, 0.05, 0, 0.09);
  c.box('paint', P.red, 0.18, 0.06, 0.02, 0.05, 0, -0.09);
  c.cylZ('paint', 0x333333, 0.02, 0.22, 6, 0, 0, 0);
  root.add(node('crank', c, px - 0.3, 0.2, pz));
  return finalizeTemplate(root, [], bAnim({
    power: false,
    sways: [{ name: 'beam', axis: 'z', amp: 0.28, freq: 2.2 }],
    spins: [{ name: 'crank', axis: 'z', rate: 2.2, power: false }],
  }));
};

// ---------------------------------------------------------------------------
// Civilian building 2x2 — two-storey house/shop
// ---------------------------------------------------------------------------
const nBunker: F = (team) => {
  const root = new THREE.Group();
  const b = new B({ aoHeight: 0.4, aoMin: 0.5 });
  b.cboxB('paint', 0x8f8c84, 1.92, 0.05, 1.92, 0.015, 0, 0, 0);
  // yard lawn
  b.boxB('matte', 0x55683a, 1.7, 0.01, 0.5, 0, 0.05, 0.65);
  // main house
  const hx = -0.1, hz = -0.25, W = 1.4, D = 1.0, H = 0.62;
  b.boxB('paint', 0x6d4a3a, W + 0.04, 0.08, D + 0.04, hx, 0.05, hz);
  b.boxB('paint', 0xcfc2a2, W, H, D, hx, 0.05, hz);
  b.box('paint', 0xa89a7a, W + 0.02, 0.03, D + 0.02, hx, 0.05 + H * 0.5, hz);
  // pitched roof (ridge along X)
  b.hull('paint', 0x7a3a2c, [
    [hx - W / 2 - 0.05, 0.05 + H, hz - D / 2 - 0.07], [hx + W / 2 + 0.05, 0.05 + H, hz - D / 2 - 0.07],
    [hx - W / 2 - 0.05, 0.05 + H, hz + D / 2 + 0.07], [hx + W / 2 + 0.05, 0.05 + H, hz + D / 2 + 0.07],
    [hx - W / 2 - 0.05, 0.05 + H + 0.32, hz], [hx + W / 2 + 0.05, 0.05 + H + 0.32, hz],
  ]);
  for (let i = 0; i < 5; i++) b.box('paint', 0x5f2c22, W + 0.1, 0.012, 0.02, hx, 0.05 + H + 0.05 + i * 0.06, hz + D / 2 + 0.03 - i * 0.11, 0.57, 0, 0);
  // windows (warm lit) front and side
  windowsZ(b, hx - W / 2 + 0.1, hx + W / 2 - 0.1, 0.48, hz + D / 2, 4, 0.14, 0.12, 'e:winWarm');
  windowsZ(b, hx - W / 2 + 0.1, hx + 0.1, 0.22, hz + D / 2, 2, 0.14, 0.12, 'e:winWarm');
  windowsX(b, hz - D / 2 + 0.1, hz + D / 2 - 0.1, 0.48, hx + W / 2, 3, 0.14, 0.12, 'e:winWarm');
  windowsX(b, hz - D / 2 + 0.1, hz + D / 2 - 0.1, 0.48, hx - W / 2, 3, 0.14, 0.12, 'e:winWarm', -1);
  // shop front: door + awning
  b.box('paint', 0x4a3024, 0.16, 0.28, 0.02, hx + 0.35, 0.19, hz + D / 2 + 0.005);
  b.box('paint', 0x2e6e6a, 0.6, 0.02, 0.18, hx + 0.3, 0.38, hz + D / 2 + 0.09, 0.3, 0, 0);
  for (let i = 0; i < 6; i++) b.box('paint', i % 2 ? P.white : 0x2e6e6a, 0.1, 0.05, 0.005, hx + 0.05 + i * 0.1, 0.35, hz + D / 2 + 0.18);
  // chimney, AC units, antenna, sign
  b.boxB('paint', 0x6d4a3a, 0.12, 0.32, 0.12, hx - 0.45, 0.05 + H + 0.05, hz - 0.2);
  b.cboxB('paint', 0x9a9a92, 0.16, 0.12, 0.1, 0.01, hx + W / 2 + 0.06, 0.1, hz - 0.1);
  b.cboxB('paint', 0x9a9a92, 0.16, 0.12, 0.1, 0.01, hx + W / 2 + 0.06, 0.1, hz + 0.2);
  antenna(b, hx + 0.4, 0.05 + H + 0.18, hz, 0.25, 0x444444, 'e:red');
  b.box('paint', team, 0.3, 0.1, 0.02, hx - 0.35, 0.3, hz + D / 2 + 0.012);
  // picket fence along the front
  for (let i = 0; i < 14; i++) b.boxB('paint', 0xe0ddd0, 0.02, 0.1 + (i % 2) * 0.02, 0.02, -0.85 + i * 0.13, 0.05, 0.9);
  b.box('paint', 0xe0ddd0, 1.75, 0.02, 0.012, 0, 0.12, 0.9);
  // bushes + mailbox
  b.ico('foliage', 0x3f5a2a, 0.1, -0.7, 0.13, 0.6, 1, 0.8, 1);
  b.ico('foliage', 0x4a6a30, 0.08, 0.7, 0.12, 0.62, 1, 0.8, 1);
  b.boxB('paint', 0x3a5a8a, 0.05, 0.04, 0.08, 0.35, 0.16, 0.8);
  b.cyl('paint', 0x444444, 0.008, 0.008, 0.12, 4, 0.35, 0.1, 0.8);
  // shed at the back-right
  b.boxB('paint', 0x8a7a5a, 0.3, 0.25, 0.3, 0.72, 0.05, -0.6);
  b.hull('paint', 0x5a5a52, [[0.55, 0.3, -0.77], [0.89, 0.3, -0.77], [0.55, 0.36, -0.43], [0.89, 0.36, -0.43], [0.55, 0.3, -0.43], [0.89, 0.3, -0.43]]);
  root.add(b.meshes());
  return finalizeTemplate(root, [], bAnim({ power: false }));
};

export const NEUTRAL_STRUCTURES: Record<string, F> = {
  n_derrick: nDerrick,
  n_bunker: nBunker,
};
