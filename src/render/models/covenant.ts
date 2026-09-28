/** Rift Covenant ground vehicles: sleek & menacing gunmetal/black, red trim, red-orange + teal Riftite glow. */
import * as THREE from 'three';
import {
  B, P, V3, Template, TrackOpts, finalizeTemplate, node, tracks, treadNode, wheel, vehicleAnim, strut, spike, byName, rng, riftCrystal,
} from './kit';

function shell(): { root: THREE.Group; body: THREE.Group } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  return { root, body };
}

/** Mirror a list of points across z (returns both sides). */
function mz(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    out.push(p);
    if (p[2] !== 0) out.push([p[0], p[1], -p[2]]);
  }
  return out;
}

/** Angular blade fender covering a track on side s. */
function fender(b: B, s: number, x0: number, x1: number, zin: number, zout: number, y0: number, y1: number, col: number): void {
  b.hull('paint', col, [
    [x0, y0, s * zin], [x0 + 0.02, y0, s * zout], [x1, y0, s * zin], [x1 - 0.06, y0, s * (zout - 0.02)],
    [x0 + 0.03, y1, s * zin], [x1 - 0.1, y1, s * zin], [x0 + 0.05, y1 - 0.03, s * (zout - 0.02)], [x1 - 0.12, y1 - 0.03, s * (zout - 0.03)],
  ]);
}

// ---------------------------------------------------------------------------
// Scorpion light tank — ~0.85 long, arrowhead hull, scorpion-tail sensor
// ---------------------------------------------------------------------------
function scorpion(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 0.78, w: 0.13, h: 0.15, z: 0.225, wheels: 4, col: 0x222124 };
  const b = new B({ aoHeight: 0.2 });
  tracks(b, tr);
  b.boxB('paint', P.cBlack, 0.72, 0.1, 0.32, 0, 0.05, 0);
  // arrowhead hull
  b.hull('paint', P.cGun, mz([[-0.4, 0.12, 0.2], [0.28, 0.12, 0.2], [0.47, 0.12, 0], [-0.38, 0.24, 0.14], [0.18, 0.24, 0.12], [0.36, 0.2, 0]]));
  for (const s of [1, -1]) {
    fender(b, s, -0.42, 0.44, 0.19, 0.3, 0.1, 0.2, P.cGun);
    b.box('paint', team, 0.42, 0.01, 0.08, -0.04, 0.2, s * 0.245); // team blades on fenders
    b.box('paint', P.cRed, 0.5, 0.012, 0.012, 0.0, 0.176, s * 0.296); // red trim edge
    b.box('e:teal', 0, 0.2, 0.012, 0.006, -0.12, 0.14, s * 0.3); // teal side glow strip
  }
  // pincer mandibles at the front
  for (const s of [1, -1]) {
    b.hull('paint', P.cBlack, [
      [0.3, 0.1, s * 0.2], [0.3, 0.19, s * 0.22], [0.3, 0.1, s * 0.3], [0.3, 0.17, s * 0.29],
      [0.52, 0.12, s * 0.22], [0.5, 0.16, s * 0.24], [0.58, 0.13, s * 0.14],
    ]);
    b.box('paint', P.cRed, 0.14, 0.01, 0.015, 0.46, 0.155, s * 0.21, 0, s * 0.5, 0);
  }
  // nose spine + red chevrons
  b.box('paint', P.cRed, 0.16, 0.012, 0.02, 0.3, 0.225, 0, 0, 0, -0.2);
  b.box('e:orange', 0, 0.02, 0.018, 0.1, 0.44, 0.13, 0);
  // rear engine glow vents
  b.box('paint', P.cBlack, 0.03, 0.08, 0.26, -0.405, 0.18, 0);
  b.box('e:orange', 0, 0.01, 0.03, 0.08, -0.42, 0.18, 0.07);
  b.box('e:orange', 0, 0.01, 0.03, 0.08, -0.42, 0.18, -0.07);
  // scorpion tail: segmented arc over the rear with glowing sting
  const tail: V3[] = [[-0.32, 0.24, 0.0], [-0.44, 0.34, 0], [-0.46, 0.47, 0], [-0.38, 0.57, 0], [-0.26, 0.6, 0], [-0.16, 0.56, 0]];
  for (let i = 0; i < tail.length - 1; i++) {
    strut(b, 'paint', i % 2 ? P.cGunLt : P.cGun, tail[i], tail[i + 1], 0.05 - i * 0.006, 0.05 - i * 0.006, 0.01);
    b.sphere('paint', P.cRed, 0.028 - i * 0.003, tail[i + 1][0], tail[i + 1][1], 0, 1, 1, 1, 6, 4);
  }
  spike(b, 'paint', P.cRed, -0.16, 0.56, 0, 0.1, 0.022, 0, -2.3);
  b.sphere('e:orange', 0, 0.022, -0.13, 0.52, 0, 1, 1, 1, 6, 4);
  body.add(b.meshes());
  body.add(treadNode(tr));

  const t = new B({ aoBase: 0.24, aoHeight: 0.1, aoMin: 0.7 });
  t.hull('paint', P.cGunLt, mz([[-0.16, 0, 0.13], [0.08, 0, 0.14], [0.2, 0, 0.05], [-0.14, 0.09, 0.09], [0.06, 0.09, 0.09], [0.15, 0.07, 0.03]]));
  t.box('paint', team, 0.16, 0.01, 0.17, -0.04, 0.093, 0);
  t.box('paint', P.cRed, 0.012, 0.012, 0.18, 0.07, 0.09, 0);
  for (const s of [1, -1]) spike(t, 'paint', P.cBlack, -0.12, 0.04, s * 0.12, 0.1, 0.02, s * 1.1, 1.0);
  t.box('paint', P.cRed, 0.02, 0.012, 0.05, 0.13, 0.07, 0.06);
  const turret = node('turret', t, -0.02, 0.24, 0);
  body.add(turret);
  const g = new B({ aoHeight: 0 });
  g.cylX('paint', P.cBlack, 0.017, 0.022, 0.42, 8, 0.21, 0, 0);
  g.cylX('paint', P.cRed, 0.025, 0.025, 0.04, 8, 0.12, 0, 0);
  g.hull('paint', P.cGun, mz([[0.4, -0.02, 0.02], [0.44, 0, 0.03], [0.46, 0.02, 0.02], [0.4, 0.02, 0.02], [0.44, -0.02, 0.03]]));
  const gun = node('gun', g, 0.14, 0.045, 0);
  turret.add(gun);
  return finalizeTemplate(root, [new THREE.Vector3(0.14 + 0.47, 0.045, 0)], vehicleAnim({ recoil: 0.05, bob: 0.007 }));
}

// ---------------------------------------------------------------------------
// Inferno flame tank — twin nozzles, glowing fuel tanks, no turret
// ---------------------------------------------------------------------------
function inferno(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 0.9, w: 0.16, h: 0.18, z: 0.25, wheels: 5, col: 0x222124 };
  const b = new B({ aoHeight: 0.22 });
  tracks(b, tr);
  b.boxB('paint', P.cBlack, 0.84, 0.12, 0.36, 0, 0.05, 0);
  // hull with raised armoured prow
  b.hull('paint', P.cGun, mz([[-0.45, 0.14, 0.22], [0.3, 0.14, 0.23], [0.48, 0.14, 0.12], [-0.43, 0.28, 0.17], [0.2, 0.3, 0.17], [0.36, 0.25, 0.1]]));
  for (const s of [1, -1]) {
    fender(b, s, -0.47, 0.47, 0.2, 0.34, 0.1, 0.21, P.cGun);
    b.box('paint', P.cRed, 0.6, 0.014, 0.014, -0.02, 0.185, s * 0.335);
    b.box('paint', team, 0.44, 0.01, 0.09, 0.1, 0.212, s * 0.275);
    spike(b, 'paint', P.cBlack, 0.36, 0.18, s * 0.33, 0.12, 0.025, 0, s * -1.3);
  }
  // fuel tanks on the back deck
  for (const s of [1, -1]) {
    b.cylX('paint', P.cGunLt, 0.075, 0.075, 0.42, 12, -0.18, 0.37, s * 0.1);
    b.sphere('paint', P.cGunLt, 0.075, 0.03, 0.37, s * 0.1, 0.5, 1, 1, 10, 6);
    b.sphere('paint', P.cGunLt, 0.075, -0.39, 0.37, s * 0.1, 0.5, 1, 1, 10, 6);
    for (const x of [-0.3, -0.18, -0.06]) b.cylX('e:orange:pulse', 0, 0.078, 0.078, 0.022, 12, x, 0.37, s * 0.1);
    b.box('paint', P.cBlack, 0.04, 0.09, 0.2, -0.3, 0.29, s * 0.1);
    b.box('paint', P.cBlack, 0.04, 0.09, 0.2, -0.06, 0.29, s * 0.1);
  }
  b.box('paint', team, 0.3, 0.012, 0.09, -0.18, 0.455, 0);
  // armoured nozzle sponsons
  for (const s of [1, -1]) {
    b.cbox('paint', P.cBlack, 0.16, 0.09, 0.1, 0.02, 0.36, 0.25, s * 0.1);
    b.cylX('paint', P.cGunLt, 0.03, 0.04, 0.16, 8, 0.48, 0.25, s * 0.1);
    b.cylX('paint', P.cRed, 0.042, 0.042, 0.025, 8, 0.44, 0.25, s * 0.1);
    b.cylX('e:orange:flicker', 0, 0.02, 0.02, 0.02, 8, 0.565, 0.25, s * 0.1);
  }
  // rear exhausts
  b.box('e:orange:pulse', 0, 0.01, 0.04, 0.1, -0.455, 0.2, 0);
  body.add(b.meshes());
  body.add(treadNode(tr));
  const muz = [new THREE.Vector3(0.58, 0.25, 0.1), new THREE.Vector3(0.58, 0.25, -0.1)];
  return finalizeTemplate(root, muz, vehicleAnim({ bob: 0.006 }));
}

// ---------------------------------------------------------------------------
// Shade stealth tank — flat faceted wedge with pop-up rocket pods
// ---------------------------------------------------------------------------
function shade(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 0.78, w: 0.13, h: 0.13, z: 0.23, wheels: 4, col: 0x1e1d20 };
  const b = new B({ aoHeight: 0.18 });
  tracks(b, tr);
  // arrowhead stealth shell
  b.hull('paint', P.cGun, mz([
    [-0.42, 0.08, 0.32], [0.1, 0.08, 0.3], [0.52, 0.08, 0.02], [-0.4, 0.16, 0.26], [0.06, 0.2, 0.16], [0.36, 0.14, 0.04], [-0.36, 0.2, 0.1],
  ]));
  // faceted dorsal ridge
  b.hull('paint', P.cGunLt, mz([[-0.34, 0.19, 0.1], [0.04, 0.21, 0.1], [0.3, 0.15, 0.02], [-0.3, 0.24, 0.05], [0.0, 0.25, 0.05]]));
  for (const s of [1, -1]) {
    // swept tail fins
    b.hull('paint', P.cBlack, [[-0.3, 0.14, s * 0.22], [-0.44, 0.14, s * 0.3], [-0.42, 0.14, s * 0.24], [-0.5, 0.34, s * 0.34], [-0.44, 0.3, s * 0.3]]);
    b.box('paint', P.cRed, 0.12, 0.012, 0.01, -0.46, 0.3, s * 0.325, 0, 0, 1.0);
    b.hull('paint', team, [[-0.3, 0.165, s * 0.2], [0.02, 0.19, s * 0.16], [-0.3, 0.13, s * 0.3], [0.04, 0.125, s * 0.27], [-0.3, 0.175, s * 0.2], [0.02, 0.2, s * 0.16], [-0.3, 0.14, s * 0.3], [0.04, 0.135, s * 0.27]]);
    b.box('e:teal', 0, 0.36, 0.006, 0.01, -0.06, 0.1, s * 0.312);
    b.box('paint', P.cRed, 0.3, 0.01, 0.012, 0.3, 0.1, s * 0.17, 0, s * 0.62, 0);
  }
  b.box('e:teal', 0, 0.1, 0.008, 0.03, 0.2, 0.18, 0, 0, 0, -0.3);
  // rocket pods (raised on struts)
  for (const s of [1, -1]) {
    strut(b, 'paint', P.cBlack, [-0.18, 0.2, s * 0.14], [-0.14, 0.26, s * 0.15], 0.03);
    b.cbox('paint', P.cBlack, 0.24, 0.07, 0.09, 0.015, -0.1, 0.28, s * 0.15);
    b.box('paint', P.cRed, 0.02, 0.072, 0.092, 0.0, 0.28, s * 0.15);
    for (const dz of [-0.022, 0.022]) b.cylX('e:orange', 0, 0.014, 0.014, 0.01, 6, 0.022, 0.28, s * 0.15 + dz);
  }
  body.add(b.meshes());
  body.add(treadNode(tr));
  const muz = [new THREE.Vector3(0.04, 0.28, 0.15), new THREE.Vector3(0.04, 0.28, -0.15)];
  return finalizeTemplate(root, muz, vehicleAnim({ bob: 0.004 }));
}

// ---------------------------------------------------------------------------
// Rift Prism tank — heavy hull, cradle with a giant focusing crystal
// ---------------------------------------------------------------------------
function prism(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 1.0, w: 0.17, h: 0.2, z: 0.29, wheels: 5, col: 0x222124 };
  const b = new B({ aoHeight: 0.25 });
  tracks(b, tr);
  b.boxB('paint', P.cBlack, 0.92, 0.14, 0.42, 0, 0.05, 0);
  b.hull('paint', P.cGun, mz([[-0.5, 0.16, 0.26], [0.36, 0.16, 0.27], [0.55, 0.16, 0.12], [-0.48, 0.31, 0.2], [0.26, 0.32, 0.2], [0.42, 0.26, 0.1]]));
  for (const s of [1, -1]) {
    fender(b, s, -0.52, 0.53, 0.24, 0.38, 0.11, 0.23, P.cGun);
    b.box('paint', P.cRed, 0.66, 0.014, 0.014, -0.03, 0.2, s * 0.375);
    b.box('paint', team, 0.5, 0.01, 0.1, -0.08, 0.232, s * 0.31);
    b.box('e:teal', 0, 0.26, 0.012, 0.008, 0.1, 0.15, s * 0.382);
    spike(b, 'paint', P.cBlack, -0.44, 0.2, s * 0.36, 0.14, 0.03, 0, s * -1.2);
  }
  // energy conduits on the rear deck
  for (const s of [1, -1]) b.cylX('e:teal', 0, 0.02, 0.02, 0.26, 8, -0.32, 0.33, s * 0.12);
  b.box('paint', P.cBlack, 0.3, 0.04, 0.3, -0.32, 0.31, 0);
  b.box('paint', P.cRed, 0.02, 0.02, 0.12, 0.52, 0.18, 0);
  body.add(b.meshes());
  body.add(treadNode(tr));

  const t = new B({ aoBase: 0.32, aoHeight: 0.15, aoMin: 0.7 });
  t.cyl('paint', P.cBlack, 0.2, 0.22, 0.05, 12, 0, 0.025, 0);
  t.hull('paint', P.cGunLt, mz([[-0.22, 0.04, 0.14], [0.05, 0.04, 0.17], [-0.2, 0.12, 0.1], [0.02, 0.12, 0.12]]));
  t.box('paint', team, 0.2, 0.01, 0.2, -0.1, 0.125, 0);
  // cradle arms (curved forks)
  for (const s of [1, -1]) {
    strut(t, 'paint', P.cGun, [0.0, 0.08, s * 0.15], [0.12, 0.2, s * 0.13], 0.05, 0.04, 0.01);
    strut(t, 'paint', P.cGun, [0.12, 0.2, s * 0.13], [0.3, 0.2, s * 0.09], 0.04, 0.035, 0.01);
    spike(t, 'paint', P.cRed, 0.3, 0.2, s * 0.09, 0.08, 0.018, 0, -Math.PI / 2);
  }
  // focusing rings
  t.torus('paint', P.cRed, 0.075, 0.012, 0.14, 0.2, 0, 0, Math.PI / 2, 0, 6, 16);
  t.torus('paint', P.cGunXl, 0.06, 0.01, 0.26, 0.2, 0, 0, Math.PI / 2, 0, 6, 14);
  // crystal lens
  const c = new THREE.OctahedronGeometry(0.1, 0);
  t.add(c, 'crystal', 0, new THREE.Matrix4().compose(new THREE.Vector3(0.16, 0.2, 0), new THREE.Quaternion(), new THREE.Vector3(1.9, 0.62, 0.62)));
  t.add(new THREE.OctahedronGeometry(0.035, 0), 'crystalCore', 0, new THREE.Matrix4().compose(new THREE.Vector3(0.33, 0.2, 0), new THREE.Quaternion(), new THREE.Vector3(1.6, 1, 1)));
  const turret = node('turret', t, -0.04, 0.32, 0);
  body.add(turret);
  const gun = new THREE.Group();
  gun.name = 'gun';
  turret.add(gun);
  return finalizeTemplate(root, [new THREE.Vector3(0.36, 0.2, 0)], vehicleAnim({ bob: 0.005, recoil: 0 }));
}

// ---------------------------------------------------------------------------
// Raider bike — two-wheeled attack bike with twin rocket pods
// ---------------------------------------------------------------------------
function raider(team: THREE.Color): Template {
  const { root, body } = shell();
  const b = new B({ aoHeight: 0.15 });
  wheel(b, 0.2, 0.085, 0, 0.085, 0.07, P.cGunLt, 1);
  wheel(b, -0.2, 0.09, 0, 0.09, 0.09, P.cGunLt, 1);
  // front fork
  strut(b, 'paint', P.chrome, [0.2, 0.085, 0.045], [0.14, 0.24, 0.04], 0.016);
  strut(b, 'paint', P.chrome, [0.2, 0.085, -0.045], [0.14, 0.24, -0.04], 0.016);
  // fairing body
  b.hull('paint', P.cGun, mz([[-0.26, 0.14, 0.06], [0.1, 0.13, 0.07], [0.24, 0.2, 0.04], [0.28, 0.24, 0], [-0.22, 0.24, 0.05], [0.12, 0.27, 0.06], [-0.3, 0.2, 0.03]]));
  b.hull('paint', team, mz([[0.1, 0.24, 0.065], [0.26, 0.24, 0.03], [0.12, 0.28, 0.06], [0.22, 0.28, 0.02], [0.28, 0.25, 0]]));
  b.box('e:orange', 0, 0.012, 0.02, 0.05, 0.285, 0.225, 0);
  b.box('paint', P.cRed, 0.3, 0.01, 0.012, -0.04, 0.2, 0.068);
  b.box('paint', P.cRed, 0.3, 0.01, 0.012, -0.04, 0.2, -0.068);
  // side rocket pods
  for (const s of [1, -1]) {
    b.cbox('paint', P.cBlack, 0.2, 0.06, 0.06, 0.012, -0.05, 0.2, s * 0.11);
    b.cylX('paint', P.cRed, 0.02, 0.02, 0.012, 6, 0.056, 0.21, s * 0.11);
    b.cylX('e:orange', 0, 0.012, 0.012, 0.01, 6, 0.062, 0.21, s * 0.11);
    strut(b, 'paint', P.cBlack, [-0.05, 0.2, s * 0.06], [-0.05, 0.2, s * 0.09], 0.02);
  }
  // exhaust glow
  b.cylX('e:orange', 0, 0.02, 0.025, 0.02, 6, -0.3, 0.2, 0.0);
  // rider (hunched)
  b.cbox('paint', 0x2a2627, 0.12, 0.06, 0.1, 0.02, -0.05, 0.28, 0); // hips/thighs
  b.hull('paint', P.cGunLt, mz([[-0.1, 0.29, 0.06], [0.0, 0.3, 0.07], [0.06, 0.37, 0.05], [-0.06, 0.39, 0.05]])); // torso leaning
  b.cbox('paint', team, 0.05, 0.03, 0.04, 0.01, 0.01, 0.385, 0.07);
  b.cbox('paint', team, 0.05, 0.03, 0.04, 0.01, 0.01, 0.385, -0.07);
  b.sphere('paint', P.cBlack, 0.042, 0.06, 0.41, 0, 1.1, 1, 1, 10, 7); // helmet
  b.box('e:orange', 0, 0.01, 0.012, 0.05, 0.1, 0.41, 0);
  strut(b, 'paint', P.cGunLt, [0.02, 0.36, 0.06], [0.14, 0.27, 0.06], 0.03);
  strut(b, 'paint', P.cGunLt, [0.02, 0.36, -0.06], [0.14, 0.27, -0.06], 0.03);
  strut(b, 'paint', 0x2a2627, [-0.02, 0.27, 0.05], [0.04, 0.17, 0.08], 0.03);
  strut(b, 'paint', 0x2a2627, [-0.02, 0.27, -0.05], [0.04, 0.17, -0.08], 0.03);
  body.add(b.meshes());
  const muz = [new THREE.Vector3(0.07, 0.21, 0.11), new THREE.Vector3(0.07, 0.21, -0.11)];
  return finalizeTemplate(root, muz, vehicleAnim({ bob: 0.008 }));
}

// ---------------------------------------------------------------------------
// Covenant harvester — claw scoops, drum, glowing ore tank
// ---------------------------------------------------------------------------
function cHarvester(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 1.02, w: 0.18, h: 0.2, z: 0.29, x: -0.06, wheels: 5, col: 0x222124 };
  const b = new B({ aoHeight: 0.25 });
  tracks(b, tr);
  b.boxB('paint', P.cBlack, 0.98, 0.14, 0.42, -0.06, 0.05, 0);
  // armoured ore tank: long rounded capsule-ish shell
  b.hull('paint', P.cGun, mz([
    [-0.6, 0.18, 0.3], [0.12, 0.18, 0.32], [-0.6, 0.44, 0.24], [0.1, 0.46, 0.26], [-0.56, 0.54, 0.12], [0.06, 0.56, 0.14],
  ]));
  // glowing ore slits on the tank top
  for (const x of [-0.46, -0.3, -0.14]) b.box('e:teal:soft', 0, 0.07, 0.012, 0.18, x, 0.56 - (x + 0.46) * -0.02, 0);
  for (const s of [1, -1]) {
    b.box('paint', team, 0.55, 0.012, 0.1, -0.25, 0.505, s * 0.19, s * 0.6);
    b.box('paint', P.cRed, 0.66, 0.014, 0.014, -0.24, 0.44, s * 0.255);
    fender(b, s, -0.62, 0.3, 0.22, 0.38, 0.1, 0.2, P.cGun);
    b.box('e:teal', 0, 0.36, 0.014, 0.006, -0.24, 0.3, s * 0.3);
    spike(b, 'paint', P.cBlack, -0.56, 0.5, s * 0.16, 0.12, 0.03, 0, s * -0.6);
  }
  // cab (angular, red visor windows)
  b.hull('paint', P.cGunLt, mz([[0.14, 0.2, 0.2], [0.42, 0.2, 0.16], [0.14, 0.44, 0.14], [0.34, 0.4, 0.1], [0.46, 0.28, 0.1]]));
  b.box('e:orange', 0, 0.012, 0.03, 0.16, 0.41, 0.36, 0, 0, 0, -0.9);
  b.box('paint', team, 0.14, 0.01, 0.16, 0.24, 0.44, 0);
  b.box('paint', P.cRed, 0.03, 0.03, 0.03, 0.2, 0.46, 0.08);
  // scoop claws
  for (const s of [1, -1]) {
    b.hull('paint', P.cBlack, [[0.4, 0.05, s * 0.2], [0.4, 0.26, s * 0.2], [0.4, 0.05, s * 0.36], [0.4, 0.2, s * 0.36], [0.66, 0.03, s * 0.34], [0.62, 0.12, s * 0.36]]);
    spike(b, 'paint', P.cRed, 0.62, 0.05, s * 0.3, 0.1, 0.02, 0, -1.5);
  }
  body.add(b.meshes());
  body.add(treadNode(tr));
  const d = new B({ aoHeight: 0 });
  d.cylZ('paint', P.cGunLt, 0.075, 0.42, 10, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (const z of [-0.14, 0.02, 0.16]) spike(d, 'paint', i % 2 ? P.cRed : P.cBlack, Math.cos(a) * 0.07, Math.sin(a) * 0.07, z - (i % 2) * 0.04, 0.06, 0.02, 0, a - Math.PI / 2);
  }
  body.add(node('drum', d, 0.54, 0.12, 0));
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
// Covenant MCV — tracked carrier with folded pyramid core and claw arm
// ---------------------------------------------------------------------------
function cMcv(team: THREE.Color): Template {
  const { root, body } = shell();
  const tr: TrackOpts = { len: 1.3, w: 0.2, h: 0.22, z: 0.34, wheels: 6, col: 0x222124 };
  const b = new B({ aoHeight: 0.3 });
  tracks(b, tr);
  b.boxB('paint', P.cBlack, 1.26, 0.16, 0.5, 0, 0.06, 0);
  // arrow-shaped deck, narrowing to a prow
  b.hull('paint', P.cGun, mz([[-0.68, 0.18, 0.3], [0.3, 0.18, 0.32], [0.78, 0.18, 0.06], [-0.66, 0.29, 0.28], [0.28, 0.29, 0.28], [0.7, 0.25, 0.04]]));
  for (const s of [1, -1]) {
    fender(b, s, -0.68, 0.72, 0.28, 0.46, 0.11, 0.24, P.cGun);
    b.box('paint', P.cRed, 0.9, 0.014, 0.014, 0, 0.21, s * 0.455);
    b.box('e:teal', 0, 0.5, 0.012, 0.006, 0.1, 0.16, s * 0.46);
    spike(b, 'paint', P.cBlack, 0.5, 0.16, s * 0.42, 0.22, 0.035, 0, -1.25);
  }
  // cab on the prow
  b.hull('paint', P.cGunLt, mz([[0.34, 0.29, 0.18], [0.6, 0.27, 0.1], [0.36, 0.46, 0.12], [0.52, 0.41, 0.07], [0.72, 0.28, 0.03]]));
  b.box('e:orange', 0, 0.012, 0.035, 0.14, 0.6, 0.37, 0, 0, 0, -0.9);
  // folded ziggurat core with crystal apex
  const cx = -0.2;
  b.taper('paint', P.cGun, 0.84, 0.5, 0.66, 0.38, 0.16, cx, 0.29, 0);
  b.taper('paint', P.cRed, 0.67, 0.39, 0.65, 0.37, 0.025, cx, 0.45, 0);
  b.taper('paint', P.cGunLt, 0.62, 0.35, 0.3, 0.16, 0.24, cx, 0.475, 0);
  b.taper('paint', P.cBlack, 0.3, 0.16, 0.12, 0.08, 0.1, cx, 0.715, 0);
  riftCrystal(b, cx, 0.9, 0, 0.07, 1.6);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) spike(b, 'paint', P.cGun, cx + sx * 0.1, 0.8, sz * 0.05, 0.2, 0.03, sz * 0.35, -sx * 0.35);
  // folded petal wings (team colour inner faces) rising from the deck edges
  for (const s of [1, -1]) {
    b.hull('paint', P.cGun, [
      [-0.62, 0.29, s * 0.28], [0.22, 0.29, s * 0.28], [-0.62, 0.29, s * 0.2], [0.22, 0.29, s * 0.2],
      [-0.5, 0.62, s * 0.2], [0.12, 0.6, s * 0.2], [-0.2, 0.7, s * 0.16],
    ]);
    b.hull('paint', team, [
      [-0.5, 0.36, s * 0.285], [0.12, 0.36, s * 0.285], [-0.42, 0.56, s * 0.235], [0.04, 0.55, s * 0.235], [-0.2, 0.62, s * 0.215],
      [-0.5, 0.36, s * 0.295], [0.12, 0.36, s * 0.295], [-0.42, 0.56, s * 0.245], [0.04, 0.55, s * 0.245], [-0.2, 0.62, s * 0.225],
    ]);
    spike(b, 'paint', P.cBlack, -0.55, 0.55, s * 0.22, 0.24, 0.04, s * 0.7, 0.6);
    spike(b, 'paint', P.cBlack, 0.16, 0.55, s * 0.22, 0.2, 0.035, s * 0.7, -0.6);
    b.box('e:orange', 0, 0.5, 0.012, 0.012, -0.2, 0.46, s * 0.3);
  }
  // folded claw arm over the back
  strut(b, 'paint', P.cBlack, [-0.66, 0.32, 0], [-0.52, 0.8, 0], 0.06, 0.06, 0.012);
  strut(b, 'paint', P.cGunLt, [-0.52, 0.8, 0], [-0.1, 1.02, 0], 0.045, 0.045, 0.01);
  b.sphere('paint', P.cRed, 0.045, -0.52, 0.8, 0, 1, 1, 1, 8, 6);
  spike(b, 'paint', P.cRed, -0.1, 1.02, 0.02, 0.12, 0.022, 0.2, -2.3);
  spike(b, 'paint', P.cRed, -0.1, 1.02, -0.02, 0.12, 0.022, -0.2, -2.3);
  b.box('e:amber:blink', 0, 0.03, 0.03, 0.03, 0.46, 0.46, 0.08);
  b.box('e:amber:blink', 0, 0.03, 0.03, 0.03, 0.46, 0.46, -0.08);
  body.add(b.meshes());
  body.add(treadNode(tr));
  return finalizeTemplate(root, [], vehicleAnim({ bob: 0.004 }));
}

void rng;

export const COVENANT_UNITS: Record<string, (team: THREE.Color) => Template> = {
  scorpion,
  inferno,
  shade,
  prism,
  raider,
  c_harvester: cHarvester,
  c_mcv: cMcv,
};
