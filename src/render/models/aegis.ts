/** Aegis Coalition ground vehicles: clean military-industrial, olive-sand & steel with gold trim. */
import * as THREE from 'three';
import {
  B, P, Template, TrackOpts, finalizeTemplate, node, tracks, treadNode, wheel, vehicleAnim, ventTop,
  hazardStripZ, strut, byName, antenna, rng,
} from './kit';

function shell(): { root: THREE.Group; body: THREE.Group } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  return { root, body };
}

// ---------------------------------------------------------------------------
// Guardian MBT — ~1.0 x 0.7
// ---------------------------------------------------------------------------
function guardian(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 0.96, w: 0.15, h: 0.19, z: 0.27, wheels: 5 };
  const b = new B({ aoHeight: 0.22 });
  tracks(b, tr);
  // lower hull between tracks
  b.boxB('paint', P.aSandDk, 0.88, 0.12, 0.4, 0, 0.05, 0);
  // upper hull: side profile with long sloped glacis
  b.prism('paint', P.aSand, [[-0.48, 0.155], [0.36, 0.155], [0.5, 0.2], [0.3, 0.295], [-0.44, 0.295], [-0.49, 0.25]], 0.66);
  // fender lips
  b.box('paint', P.aSandDk, 0.9, 0.018, 0.03, -0.01, 0.165, 0.335);
  b.box('paint', P.aSandDk, 0.9, 0.018, 0.03, -0.01, 0.165, -0.335);
  // side skirts
  for (const s of [1, -1]) {
    b.prism('paint', P.aSand, [[-0.44, 0.1], [0.4, 0.1], [0.46, 0.16], [-0.46, 0.16]], 0.022, 0, 0, s * 0.345);
    b.box('paint', team, 0.5, 0.03, 0.006, -0.08, 0.135, s * 0.357); // team stripe on skirts
  }
  // team stripes on the rear deck fenders (seen from above)
  b.box('paint', team, 0.3, 0.012, 0.06, -0.28, 0.301, 0.27);
  b.box('paint', team, 0.3, 0.012, 0.06, -0.28, 0.301, -0.27);
  // engine deck grille and exhausts
  ventTop(b, -0.34, 0.295, 0, 0.18, 0.3, 6, P.aSandDk);
  b.box('paint', P.dark, 0.03, 0.05, 0.08, -0.49, 0.235, 0.2);
  b.box('paint', P.dark, 0.03, 0.05, 0.08, -0.49, 0.235, -0.2);
  // driver hatch + periscopes on glacis
  b.cbox('paint', P.aSandDk, 0.08, 0.02, 0.1, 0.01, 0.3, 0.3, 0.14, 0, 0, -0.43);
  b.box('glass', 0x111820, 0.02, 0.015, 0.05, 0.34, 0.285, 0.14, 0, 0, -0.43);
  // gold identification chevron on the glacis
  b.box('paint', P.aGold, 0.012, 0.01, 0.22, 0.44, 0.235, 0, 0, 0, -0.43);
  // headlights
  b.box('paint', P.aSteelDk, 0.03, 0.035, 0.05, 0.475, 0.22, 0.27);
  b.box('paint', P.aSteelDk, 0.03, 0.035, 0.05, 0.475, 0.22, -0.27);
  b.box('e:blue', 0, 0.01, 0.022, 0.035, 0.492, 0.22, 0.27);
  b.box('e:blue', 0, 0.01, 0.022, 0.035, 0.492, 0.22, -0.27);
  // stowage boxes + jerry cans on fenders
  b.cboxB('paint', P.aOlive, 0.14, 0.05, 0.05, 0.01, -0.1, 0.295, 0.305);
  b.cboxB('paint', P.aOlive, 0.14, 0.05, 0.05, 0.01, -0.1, 0.295, -0.305);
  b.cboxB('paint', 0x55583e, 0.05, 0.06, 0.035, 0.008, 0.08, 0.295, 0.305);
  b.cboxB('paint', 0x55583e, 0.05, 0.06, 0.035, 0.008, 0.14, 0.295, 0.305);
  // tow hooks
  b.box('paint', P.dark, 0.03, 0.02, 0.03, 0.5, 0.16, 0.16);
  b.box('paint', P.dark, 0.03, 0.02, 0.03, 0.5, 0.16, -0.16);
  body.add(b.meshes());
  body.add(treadNode(tr));

  // turret
  const t = new B({ aoBase: 0.3, aoHeight: 0.15, aoMin: 0.65 });
  t.hull('paint', P.aSand, [
    [-0.23, 0, 0.19], [-0.23, 0, -0.19], [0.12, 0, 0.21], [0.12, 0, -0.21], [0.26, 0, 0.1], [0.26, 0, -0.1],
    [-0.21, 0.14, 0.16], [-0.21, 0.14, -0.16], [0.08, 0.14, 0.17], [0.08, 0.14, -0.17], [0.2, 0.115, 0.08], [0.2, 0.115, -0.08],
  ]);
  t.box('paint', P.aSandDk, 0.5, 0.03, 0.44, -0.02, 0.0, 0); // turret ring collar
  // bustle rack
  t.box('paint', P.aSandDk, 0.08, 0.08, 0.3, -0.27, 0.07, 0);
  t.box('paint', P.aOlive, 0.06, 0.05, 0.12, -0.28, 0.12, 0.07);
  t.box('paint', 0x57583f, 0.06, 0.04, 0.1, -0.28, 0.115, -0.07);
  // team colour panels: roof stripe + cheek plates
  t.box('paint', team, 0.12, 0.014, 0.33, -0.1, 0.145, 0);
  for (const s of [1, -1]) {
    t.hull('paint', team, [
      [-0.15, 0.03, s * 0.19], [0.06, 0.03, s * 0.205], [-0.15, 0.1, s * 0.17], [0.05, 0.11, s * 0.18],
      [-0.15, 0.03, s * 0.2], [0.06, 0.03, s * 0.215], [-0.15, 0.1, s * 0.18], [0.05, 0.11, s * 0.19],
    ]);
    // smoke dischargers
    for (let i = 0; i < 3; i++) t.cyl('paint', P.aSteelDk, 0.012, 0.012, 0.05, 6, 0.1 + i * 0.022, 0.1, s * 0.18, 0, 0, -1.0);
  }
  // commander cupola + MG
  t.cyl('paint', P.aSandDk, 0.05, 0.055, 0.04, 10, -0.1, 0.16, 0.085);
  t.cyl('paint', P.aSand, 0.04, 0.04, 0.012, 10, -0.1, 0.186, 0.085);
  t.box('paint', P.gunmetal, 0.12, 0.015, 0.015, -0.04, 0.2, 0.085);
  // gunner sight with blue optic
  t.box('paint', P.aSteelDk, 0.06, 0.04, 0.05, 0.02, 0.16, -0.1);
  t.box('e:blue', 0, 0.006, 0.02, 0.035, 0.052, 0.16, -0.1);
  // antennas
  t.cyl('paint', 0x222222, 0.004, 0.006, 0.28, 4, -0.22, 0.28, -0.13);
  t.cyl('paint', 0x222222, 0.004, 0.006, 0.18, 4, -0.22, 0.23, 0.13);
  const turret = node('turret', t, -0.05, 0.3, 0);
  body.add(turret);

  // gun
  const g = new B({ aoHeight: 0 });
  g.cbox('paint', P.aSandDk, 0.1, 0.09, 0.14, 0.02, 0.02, 0, 0);
  g.cylX('paint', P.aSteelDk, 0.024, 0.027, 0.46, 10, 0.29, 0, 0);
  g.cylX('paint', P.aSandDk, 0.036, 0.036, 0.09, 10, 0.3, 0, 0); // fume extractor
  g.cbox('paint', P.gunmetal, 0.05, 0.05, 0.06, 0.01, 0.52, 0, 0); // muzzle brake
  const gun = node('gun', g, 0.2, 0.07, 0);
  turret.add(gun);

  return finalizeTemplate(root, [new THREE.Vector3(0.2 + 0.55, 0.07, 0)], vehicleAnim({ recoil: 0.07 }));
}

// ---------------------------------------------------------------------------
// Pathfinder scout — ~0.7 long, fast wheeled recon with MG turret
// ---------------------------------------------------------------------------
function scout(team: THREE.Color): Template {
  const { root, body } = shell();
  const b = new B({ aoHeight: 0.18 });
  // wheels
  for (const x of [0.22, -0.22]) for (const s of [1, -1]) wheel(b, x, 0.095, s * 0.2, 0.095, 0.07, P.aSteelDk, s);
  // chassis
  b.boxB('paint', P.aSandDk, 0.6, 0.06, 0.28, 0, 0.07, 0);
  // armoured wedge body
  b.prism('paint', P.aSand, [[-0.33, 0.11], [0.26, 0.11], [0.36, 0.15], [0.2, 0.225], [-0.08, 0.235], [-0.33, 0.21]], 0.32);
  // wheel arches / fenders
  for (const x of [0.22, -0.22]) for (const s of [1, -1]) {
    b.hull('paint', P.aSand, [
      [x - 0.12, 0.13, s * 0.16], [x + 0.12, 0.13, s * 0.16], [x - 0.1, 0.2, s * 0.16], [x + 0.1, 0.2, s * 0.16],
      [x - 0.12, 0.13, s * 0.25], [x + 0.12, 0.13, s * 0.25], [x - 0.09, 0.19, s * 0.245], [x + 0.09, 0.19, s * 0.245],
    ]);
  }
  // team stripe along the fenders
  b.box('paint', team, 0.12, 0.012, 0.05, 0.22, 0.2, 0.2);
  b.box('paint', team, 0.12, 0.012, 0.05, 0.22, 0.2, -0.2);
  b.box('paint', team, 0.12, 0.012, 0.05, -0.22, 0.2, 0.2);
  b.box('paint', team, 0.12, 0.012, 0.05, -0.22, 0.2, -0.2);
  // windscreen
  b.box('glass', 0x14202a, 0.02, 0.05, 0.24, 0.235, 0.21, 0, 0, 0, -0.9);
  b.box('paint', P.aSandDk, 0.03, 0.012, 0.26, 0.25, 0.23, 0, 0, 0, -0.9);
  // bull bar + headlights
  strut(b, 'paint', P.gunmetal, [0.37, 0.1, -0.14], [0.37, 0.1, 0.14], 0.02);
  strut(b, 'paint', P.gunmetal, [0.37, 0.1, 0.12], [0.34, 0.17, 0.12], 0.016);
  strut(b, 'paint', P.gunmetal, [0.37, 0.1, -0.12], [0.34, 0.17, -0.12], 0.016);
  b.box('e:blue', 0, 0.012, 0.022, 0.035, 0.355, 0.155, 0.1);
  b.box('e:blue', 0, 0.012, 0.022, 0.035, 0.355, 0.155, -0.1);
  // roll cage arch
  strut(b, 'paint', P.gunmetal, [-0.02, 0.23, 0.14], [-0.02, 0.31, 0.12], 0.018);
  strut(b, 'paint', P.gunmetal, [-0.02, 0.23, -0.14], [-0.02, 0.31, -0.12], 0.018);
  strut(b, 'paint', P.gunmetal, [-0.02, 0.31, 0.12], [-0.02, 0.31, -0.12], 0.018);
  // spare wheel + jerry cans at rear
  b.cylZ('paint', P.rubber, 0.07, 0.05, 10, -0.33, 0.22, 0);
  b.cbox('paint', P.aOlive, 0.05, 0.05, 0.05, 0.01, -0.3, 0.26, 0.1);
  b.cbox('paint', P.aOlive, 0.05, 0.05, 0.05, 0.01, -0.3, 0.26, -0.1);
  // antenna
  b.cyl('paint', 0x222222, 0.003, 0.005, 0.3, 4, -0.28, 0.36, -0.12);
  body.add(b.meshes());

  // MG turret
  const t = new B({ aoBase: 0.24, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.aSandDk, 0.075, 0.08, 0.03, 12, 0, 0.015, 0);
  t.hull('paint', P.aSand, [
    [0.05, 0.02, 0.09], [0.05, 0.02, -0.09], [0.08, 0.02, 0.06], [0.08, 0.02, -0.06],
    [0.05, 0.12, 0.08], [0.05, 0.12, -0.08], [0.075, 0.11, 0.05], [0.075, 0.11, -0.05],
  ]); // gun shield
  t.box('paint', team, 0.006, 0.05, 0.1, 0.082, 0.07, 0);
  t.box('paint', P.gunmetal, 0.1, 0.045, 0.04, 0.02, 0.07, 0);
  t.cylX('paint', 0x1c1c1c, 0.01, 0.012, 0.18, 6, 0.16, 0.075, 0.015);
  t.cylX('paint', 0x1c1c1c, 0.01, 0.012, 0.18, 6, 0.16, 0.075, -0.015);
  t.box('paint', 0x4a4a36, 0.04, 0.035, 0.03, 0.0, 0.06, 0.04); // ammo can
  const turret = node('turret', t, -0.05, 0.235, 0);
  body.add(turret);
  const gun = new THREE.Group();
  gun.name = 'gun';
  turret.add(gun);
  return finalizeTemplate(root, [new THREE.Vector3(0.25 - 0.05 + 0.05, 0.075, 0.015), new THREE.Vector3(0.25, 0.075, -0.015)], vehicleAnim({ bob: 0.01, recoil: 0.01 }));
}

// ---------------------------------------------------------------------------
// Tempest MLRS — 6x6 truck with rotating rocket box
// ---------------------------------------------------------------------------
function tempest(team: THREE.Color): Template {
  const { root, body } = shell();
  const b = new B({ aoHeight: 0.2 });
  for (const x of [0.3, -0.08, -0.3]) for (const s of [1, -1]) wheel(b, x, 0.09, s * 0.23, 0.09, 0.08, P.aSteelDk, s);
  b.boxB('paint', P.aSandDk, 0.92, 0.07, 0.3, -0.02, 0.07, 0); // chassis
  // cab
  b.prism('paint', P.aSand, [[0.22, 0.12], [0.48, 0.12], [0.5, 0.2], [0.44, 0.33], [0.22, 0.34]], 0.44);
  b.box('glass', 0x14202a, 0.02, 0.07, 0.36, 0.475, 0.27, 0, 0, 0, -0.39);
  b.box('glass', 0x14202a, 0.14, 0.06, 0.02, 0.33, 0.27, 0.222);
  b.box('glass', 0x14202a, 0.14, 0.06, 0.02, 0.33, 0.27, -0.222);
  b.box('paint', P.aSandDk, 0.2, 0.02, 0.4, 0.33, 0.345, 0); // roof
  b.box('e:amber:blink', 0, 0.03, 0.02, 0.03, 0.3, 0.365, 0.14);
  b.box('e:amber:blinkB', 0, 0.03, 0.02, 0.03, 0.3, 0.365, -0.14);
  b.box('e:blue', 0, 0.01, 0.025, 0.04, 0.5, 0.17, 0.17);
  b.box('e:blue', 0, 0.01, 0.025, 0.04, 0.5, 0.17, -0.17);
  b.box('paint', P.gunmetal, 0.03, 0.06, 0.38, 0.51, 0.13, 0); // bumper
  // flatbed with side boxes
  b.boxB('paint', P.aSand, 0.66, 0.08, 0.46, -0.13, 0.13, 0);
  for (const s of [1, -1]) {
    b.box('paint', team, 0.5, 0.035, 0.006, -0.14, 0.17, s * 0.232);
    b.cboxB('paint', P.aOlive, 0.18, 0.05, 0.06, 0.01, -0.36, 0.21, s * 0.19);
  }
  // stabiliser jacks
  for (const s of [1, -1]) {
    b.box('paint', P.aSteelDk, 0.04, 0.12, 0.04, -0.44, 0.1, s * 0.2);
    b.box('paint', P.hazardY, 0.06, 0.02, 0.06, -0.44, 0.04, s * 0.2);
  }
  body.add(b.meshes());

  // rotating launcher
  const t = new B({ aoBase: 0.21, aoHeight: 0.1, aoMin: 0.7 });
  t.cyl('paint', P.aSandDk, 0.15, 0.16, 0.04, 12, 0, 0.02, 0);
  t.box('paint', P.aSteelDk, 0.14, 0.1, 0.06, 0, 0.08, 0.13);
  t.box('paint', P.aSteelDk, 0.14, 0.1, 0.06, 0, 0.08, -0.13);
  const turret = node('turret', t, -0.14, 0.21, 0);
  body.add(turret);
  const pitch = 0.42;
  const l = new B({ aoHeight: 0 });
  l.cbox('paint', P.aSand, 0.46, 0.17, 0.3, 0.015, 0.0, 0.0, 0);
  l.box('paint', team, 0.2, 0.012, 0.26, -0.05, 0.091, 0);
  l.box('paint', P.aGold, 0.012, 0.012, 0.28, 0.1, 0.091, 0);
  l.box('paint', P.aSandDk, 0.02, 0.18, 0.31, 0.225, 0, 0);
  const tubes: [number, number][] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tubes.push([-0.04 + r * 0.075, -0.1 + c * 0.066]);
  for (const [ty, tz] of tubes) {
    l.cylX('paint', P.dark, 0.026, 0.026, 0.012, 8, 0.236, ty, tz);
    l.cone('paint', P.red, 0.017, 0.035, 6, 0.24, ty, tz, 0, 0, -Math.PI / 2);
  }
  const launcher = node('gun', l, 0, 0.14, 0);
  launcher.rotation.z = pitch;
  turret.add(launcher);
  const muzzles = tubes.map(([ty, tz]) => {
    const x = 0.26, y = ty;
    return new THREE.Vector3(x * Math.cos(pitch) - y * Math.sin(pitch), 0.14 + x * Math.sin(pitch) + y * Math.cos(pitch), tz);
  });
  return finalizeTemplate(root, muzzles, vehicleAnim({ bob: 0.006, recoil: 0.02 }));
}

// ---------------------------------------------------------------------------
// Titan assault tank — ~1.4 long, four track pods, twin cannons, missile pods
// ---------------------------------------------------------------------------
function titan(team: THREE.Color): Template {
  const { root, body } = shell();
  const b = new B({ aoHeight: 0.3 });
  const pods: TrackOpts[] = [];
  for (const x of [0.38, -0.38]) pods.push({ len: 0.6, w: 0.22, h: 0.26, z: 0.34, x, wheels: 4 });
  for (const p of pods) tracks(b, p);
  // pod armour housings
  for (const x of [0.38, -0.38]) for (const s of [1, -1]) {
    b.prism('paint', P.aSand, [[x - 0.3, 0.2], [x + 0.28, 0.2], [x + 0.33, 0.25], [x + 0.28, 0.33], [x - 0.3, 0.33], [x - 0.33, 0.28]], 0.24, 0, 0, s * 0.34);
    b.box('paint', team, 0.3, 0.014, 0.08, x - 0.03, 0.337, s * 0.34);
    b.box('paint', P.aSandDk, 0.6, 0.03, 0.012, x, 0.25, s * 0.463);
  }
  // central hull
  b.boxB('paint', P.aSandDk, 1.2, 0.2, 0.46, 0, 0.06, 0);
  b.prism('paint', P.aSand, [[-0.66, 0.24], [0.52, 0.24], [0.7, 0.3], [0.5, 0.42], [-0.62, 0.42], [-0.68, 0.36]], 0.5);
  ventTop(b, -0.48, 0.42, 0, 0.22, 0.36, 7, P.aSandDk);
  b.box('paint', P.dark, 0.04, 0.08, 0.1, -0.68, 0.34, 0.16);
  b.box('paint', P.dark, 0.04, 0.08, 0.1, -0.68, 0.34, -0.16);
  b.box('paint', P.aGold, 0.012, 0.012, 0.36, 0.62, 0.34, 0, 0, 0, -0.54);
  b.box('paint', P.aGold, 0.012, 0.012, 0.36, 0.58, 0.365, 0, 0, 0, -0.54);
  for (const s of [1, -1]) {
    b.box('paint', P.aSteelDk, 0.035, 0.04, 0.07, 0.68, 0.3, s * 0.2);
    b.box('e:blue', 0, 0.01, 0.025, 0.05, 0.7, 0.3, s * 0.2);
  }
  // spaced armour blocks on the glacis
  b.cbox('paint', P.aSandDk, 0.1, 0.03, 0.18, 0.008, 0.52, 0.405, 0.13, 0, 0, -0.54);
  b.cbox('paint', P.aSandDk, 0.1, 0.03, 0.18, 0.008, 0.52, 0.405, -0.13, 0, 0, -0.54);
  body.add(b.meshes());
  for (const p of pods) body.add(treadNode(p));

  // turret
  const t = new B({ aoBase: 0.42, aoHeight: 0.2, aoMin: 0.7 });
  t.hull('paint', P.aSand, [
    [-0.3, 0, 0.24], [-0.3, 0, -0.24], [0.2, 0, 0.26], [0.2, 0, -0.26], [0.34, 0, 0.13], [0.34, 0, -0.13],
    [-0.28, 0.18, 0.2], [-0.28, 0.18, -0.2], [0.14, 0.18, 0.21], [0.14, 0.18, -0.21], [0.27, 0.15, 0.09], [0.27, 0.15, -0.09],
  ]);
  t.box('paint', P.aSandDk, 0.66, 0.04, 0.54, -0.02, 0, 0);
  t.box('paint', team, 0.16, 0.014, 0.38, -0.12, 0.186, 0);
  t.box('paint', P.aSandDk, 0.1, 0.11, 0.36, -0.34, 0.09, 0); // bustle
  t.cyl('paint', P.aSandDk, 0.06, 0.066, 0.05, 10, -0.08, 0.205, 0.11);
  t.box('paint', P.aSteelDk, 0.07, 0.05, 0.06, 0.02, 0.205, -0.12);
  t.box('e:blue', 0, 0.006, 0.025, 0.04, 0.058, 0.205, -0.12);
  t.cyl('paint', 0x222222, 0.005, 0.007, 0.34, 4, -0.32, 0.36, -0.18);
  // missile pods on the flanks
  for (const s of [1, -1]) {
    t.box('paint', P.aSteelDk, 0.08, 0.05, 0.06, -0.02, 0.1, s * 0.27);
    t.cbox('paint', P.aSand, 0.3, 0.13, 0.12, 0.015, 0.0, 0.12, s * 0.33);
    t.box('paint', team, 0.18, 0.006, 0.09, -0.02, 0.188, s * 0.33);
    for (const dy of [-0.03, 0.03]) for (const dz of [-0.03, 0.03]) {
      t.cylX('paint', P.dark, 0.022, 0.022, 0.01, 8, 0.152, 0.12 + dy, s * 0.33 + dz);
      t.cone('paint', P.aSteelLt, 0.016, 0.03, 6, 0.16, 0.12 + dy, s * 0.33 + dz, 0, 0, -Math.PI / 2);
    }
  }
  const turret = node('turret', t, -0.06, 0.42, 0);
  body.add(turret);
  const g = new B({ aoHeight: 0 });
  g.cbox('paint', P.aSandDk, 0.14, 0.12, 0.26, 0.025, 0.02, 0, 0);
  for (const s of [1, -1]) {
    g.cylX('paint', P.aSteelDk, 0.03, 0.034, 0.56, 10, 0.36, 0, s * 0.07);
    g.cylX('paint', P.aSandDk, 0.042, 0.042, 0.1, 10, 0.3, 0, s * 0.07);
    g.cbox('paint', P.gunmetal, 0.06, 0.06, 0.07, 0.012, 0.64, 0, s * 0.07);
  }
  const gun = node('gun', g, 0.3, 0.08, 0);
  turret.add(gun);
  const muz = [
    new THREE.Vector3(0.3 + 0.68, 0.08, 0.07),
    new THREE.Vector3(0.3 + 0.68, 0.08, -0.07),
    new THREE.Vector3(0.17, 0.12, 0.33),
    new THREE.Vector3(0.17, 0.12, -0.33),
  ];
  return finalizeTemplate(root, muz, vehicleAnim({ bob: 0.004, recoil: 0.08 }));
}

// ---------------------------------------------------------------------------
// Harvester — ~1.2 long, hopper + cab + spinning collection drum
// ---------------------------------------------------------------------------
function harvester(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 1.02, w: 0.18, h: 0.2, z: 0.29, x: -0.06, wheels: 5 };
  const b = new B({ aoHeight: 0.25 });
  tracks(b, tr);
  b.boxB('paint', P.aSandDk, 1.0, 0.14, 0.42, -0.06, 0.05, 0);
  // hopper (sloped sides, open top showing ore)
  b.taper('paint', P.aSand, 0.66, 0.66, 0.74, 0.74, 0.34, -0.2, 0.18, 0);
  b.box('paint', P.aSandDk, 0.76, 0.03, 0.76, -0.2, 0.52, 0); // rim
  // ribs on hopper walls
  for (const x of [-0.46, -0.2, 0.06]) for (const s of [1, -1]) b.box('paint', P.aSandDk, 0.04, 0.3, 0.02, x, 0.35, s * 0.36);
  // team stripes along the rim
  b.box('paint', team, 0.62, 0.016, 0.05, -0.2, 0.54, 0.34);
  b.box('paint', team, 0.62, 0.016, 0.05, -0.2, 0.54, -0.34);
  b.box('paint', team, 0.05, 0.016, 0.62, -0.55, 0.54, 0);
  for (const s of [1, -1]) for (const x of [-0.33, -0.07]) b.box('paint', team, 0.2, 0.14, 0.012, x, 0.36, s * 0.363, s * 0.1, 0, 0);
  // cab
  b.cboxB('paint', P.aSand, 0.28, 0.26, 0.26, 0.03, 0.3, 0.2, -0.2);
  b.box('glass', 0x14202a, 0.02, 0.09, 0.22, 0.44, 0.38, -0.2);
  b.box('glass', 0x14202a, 0.2, 0.08, 0.02, 0.3, 0.38, -0.07);
  b.box('paint', P.aSandDk, 0.3, 0.02, 0.28, 0.3, 0.47, -0.2);
  b.box('e:amber:blink', 0, 0.035, 0.03, 0.035, 0.34, 0.5, -0.28);
  b.box('e:amber:blinkB', 0, 0.035, 0.03, 0.035, 0.24, 0.5, -0.12);
  // engine block beside cab
  b.cboxB('paint', P.aSteel, 0.24, 0.2, 0.2, 0.02, 0.3, 0.2, 0.13);
  ventTop(b, 0.3, 0.4, 0.13, 0.18, 0.14, 5, P.aSteelDk);
  b.cyl('paint', P.dark, 0.022, 0.025, 0.14, 8, 0.22, 0.47, 0.2);
  // drum housing
  b.box('paint', P.aSandDk, 0.1, 0.08, 0.64, 0.46, 0.25, 0);
  hazardStripZ(b, -0.32, 0.32, 0.29, 0.46, 0.1, 10);
  b.box('paint', P.aSteelDk, 0.18, 0.05, 0.05, 0.48, 0.15, 0.3);
  b.box('paint', P.aSteelDk, 0.18, 0.05, 0.05, 0.48, 0.15, -0.3);
  b.box('e:blue', 0, 0.01, 0.02, 0.04, 0.515, 0.25, 0.26);
  b.box('e:blue', 0, 0.01, 0.02, 0.04, 0.515, 0.25, -0.26);
  body.add(b.meshes());
  body.add(treadNode(tr));

  // ore load: a mound of dark riftite ore studded with glowing crystals
  const o = new B({ aoHeight: 0 });
  o.hull('paint', 0x1d3d36, [
    [-0.54, 0.5, -0.33], [0.14, 0.5, -0.33], [-0.54, 0.5, 0.33], [0.14, 0.5, 0.33],
    [-0.4, 0.6, -0.15], [0.0, 0.62, -0.12], [-0.38, 0.61, 0.16], [0.02, 0.6, 0.14], [-0.2, 0.65, 0.0],
  ]);
  const rnd = rng(7);
  for (let i = 0; i < 16; i++) {
    const x = -0.2 + (rnd() - 0.5) * 0.56, z = (rnd() - 0.5) * 0.52;
    const h = 0.06 + rnd() * 0.07;
    o.cone(i % 3 ? 'crystal' : 'crystalCore', 0, 0.022 + rnd() * 0.018, h, 5, x, 0.59 - Math.abs(z) * 0.2 + h * 0.3, z, (rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9);
  }
  body.add(o.meshes());

  // collection drum
  const d = new B({ aoHeight: 0 });
  d.cylZ('paint', P.aSteelDk, 0.08, 0.58, 10, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (const z of [-0.2, 0, 0.2]) d.box('paint', P.aSteel, 0.05, 0.03, 0.14, Math.cos(a) * 0.085, Math.sin(a) * 0.085, z + (i % 2) * 0.05, 0, 0, a);
  }
  const drum = node('drum', d, 0.56, 0.12, 0);
  body.add(drum);

  return finalizeTemplate(root, [], vehicleAnim({
    bob: 0.005,
    extra: (r) => {
      const dr = byName(r, 'drum');
      return (dt, s) => {
        if (dr && (s.harvesting || s.moving)) dr.rotation.z -= dt * (s.harvesting ? 9 : 2);
      };
    },
  }));
}

// ---------------------------------------------------------------------------
// MCV — ~1.4 long, 8-wheeled carrier with folded base modules & crane
// ---------------------------------------------------------------------------
function mcv(team: THREE.Color): Template {
  const { root, body } = shell();
  const b = new B({ aoHeight: 0.3 });
  for (const x of [0.46, 0.2, -0.26, -0.5]) for (const s of [1, -1]) wheel(b, x, 0.11, s * 0.33, 0.11, 0.1, P.aSteelDk, s);
  b.boxB('paint', P.aSandDk, 1.3, 0.1, 0.5, 0, 0.1, 0); // chassis
  // fenders over wheel pairs
  for (const cx of [0.33, -0.38]) for (const s of [1, -1]) {
    b.box('paint', P.aSand, 0.5, 0.03, 0.13, cx, 0.235, s * 0.33);
    b.box('paint', team, 0.3, 0.008, 0.08, cx, 0.254, s * 0.33);
  }
  // cab
  b.prism('paint', P.aSand, [[0.4, 0.2], [0.66, 0.2], [0.7, 0.28], [0.64, 0.46], [0.4, 0.48]], 0.52);
  b.box('glass', 0x14202a, 0.02, 0.1, 0.44, 0.67, 0.39, 0, 0, 0, -0.32);
  b.box('glass', 0x14202a, 0.16, 0.08, 0.02, 0.52, 0.4, 0.262);
  b.box('glass', 0x14202a, 0.16, 0.08, 0.02, 0.52, 0.4, -0.262);
  b.box('paint', P.aSandDk, 0.26, 0.025, 0.54, 0.53, 0.49, 0);
  b.box('e:amber:blink', 0, 0.04, 0.03, 0.04, 0.5, 0.515, 0.2);
  b.box('e:amber:blinkB', 0, 0.04, 0.03, 0.04, 0.5, 0.515, -0.2);
  b.box('paint', P.gunmetal, 0.04, 0.08, 0.5, 0.71, 0.22, 0);
  b.box('e:blue', 0, 0.01, 0.03, 0.06, 0.73, 0.26, 0.19);
  b.box('e:blue', 0, 0.01, 0.03, 0.06, 0.73, 0.26, -0.19);
  // folded construction module
  b.cboxB('paint', P.aSteel, 0.74, 0.3, 0.6, 0.03, -0.2, 0.2, 0);
  b.cboxB('paint', P.aSand, 0.6, 0.12, 0.5, 0.03, -0.24, 0.5, 0);
  b.box('paint', team, 0.3, 0.012, 0.52, -0.24, 0.625, 0);
  b.box('paint', P.aGold, 0.012, 0.012, 0.5, -0.07, 0.626, 0);
  // panel seams on module sides
  for (const x of [-0.45, -0.2, 0.05]) for (const s of [1, -1]) b.box('paint', P.aSteelDk, 0.012, 0.24, 0.006, x, 0.35, s * 0.302);
  for (const s of [1, -1]) {
    b.box('paint', team, 0.5, 0.05, 0.006, -0.2, 0.44, s * 0.302);
    b.box('e:win', 0, 0.1, 0.04, 0.006, -0.33, 0.3, s * 0.305);
    b.box('e:win', 0, 0.1, 0.04, 0.006, -0.08, 0.3, s * 0.305);
  }
  // folded crane boom lying along the top
  const boomY = 0.66;
  strut(b, 'paint', P.hazardY, [-0.52, boomY, 0.16], [0.36, boomY, 0.16], 0.04);
  strut(b, 'paint', P.hazardY, [-0.52, boomY, 0.08], [0.36, boomY, 0.08], 0.04);
  for (let i = 0; i < 7; i++) {
    const x = -0.48 + i * 0.13;
    strut(b, 'paint', P.hazardY, [x, boomY, 0.16], [x + 0.13, boomY, 0.08], 0.012);
  }
  b.box('paint', P.gunmetal, 0.1, 0.08, 0.14, 0.4, 0.62, 0.12);
  b.box('paint', P.aSteelDk, 0.08, 0.14, 0.08, -0.52, 0.6, 0.12);
  // mini radar mast
  b.cyl('paint', P.aSteelDk, 0.012, 0.015, 0.14, 6, -0.4, 0.69, -0.16);
  // rear hazard panel
  hazardStripZ(b, -0.28, 0.28, 0.2, -0.655, 0.02, 8);
  body.add(b.meshes());

  const dish = new B({ aoHeight: 0 });
  dish.cyl('metal', P.aSteelLt, 0.07, 0.02, 0.03, 10, 0, 0.0, 0, 0, 0, 0.5);
  dish.cyl('paint', P.gunmetal, 0.006, 0.006, 0.06, 4, 0.02, 0.02, 0, 0, 0, 0.5);
  const dn = node('dish', dish, -0.4, 0.78, -0.16);
  body.add(dn);
  body.add(nodeAntenna(-0.58, 0.5, 0.24));

  return finalizeTemplate(root, [], vehicleAnim({
    bob: 0.004,
    extra: (r) => {
      const d = byName(r, 'dish');
      return (dt) => {
        if (d) d.rotation.y += dt * 1.5;
      };
    },
  }));
}

function nodeAntenna(x: number, y: number, z: number): THREE.Group {
  const b = new B({ aoHeight: 0 });
  antenna(b, 0, 0, 0, 0.3, 0x222222, 'e:red:blink');
  return node('antenna', b, x, y, z);
}

export const AEGIS_UNITS: Record<string, (team: THREE.Color) => Template> = {
  guardian,
  scout,
  tempest,
  titan,
  a_harvester: harvester,
  a_mcv: mcv,
};
