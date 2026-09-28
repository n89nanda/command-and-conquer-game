/** Aircraft: Aegis Hawk VTOL and Covenant Wraith gunship. Modelled at y=0 (renderer lifts them). */
import * as THREE from 'three';
import { B, P, V3, Template, finalizeTemplate, node, strut, spike, byName } from './kit';

function mz(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    out.push(p);
    if (p[2] !== 0) out.push([p[0], p[1], -p[2]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hawk VTOL — swept wings with tip-mounted ducted fans
// ---------------------------------------------------------------------------
function hawk(team: THREE.Color): Template {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const b = new B({ aoHeight: 0, jitter: 0.02 });
  // fuselage
  b.hull('paint', P.aSteel, mz([
    [0.56, 0.12, 0], [0.4, 0.07, 0.05], [0.4, 0.18, 0.05], [0.1, 0.05, 0.1], [0.1, 0.22, 0.09],
    [-0.3, 0.07, 0.08], [-0.3, 0.2, 0.07], [-0.52, 0.12, 0.03], [-0.52, 0.16, 0.03],
  ]));
  // canopy
  b.sphere('paint', 0x22384c, 0.08, 0.26, 0.19, 0, 1.9, 0.6, 0.75, 12, 8);
  b.box('paint', 0x6cc4ff, 0.04, 0.01, 0.05, 0.3, 0.228, 0);
  // intakes
  for (const s of [1, -1]) b.cbox('paint', P.aSteelDk, 0.18, 0.08, 0.05, 0.012, 0.08, 0.13, s * 0.1);
  // swept wings
  for (const s of [1, -1]) {
    b.hull('paint', P.aSteel, [
      [0.12, 0.12, s * 0.08], [0.12, 0.15, s * 0.08], [-0.22, 0.12, s * 0.08], [-0.22, 0.15, s * 0.08],
      [-0.02, 0.125, s * 0.34], [-0.02, 0.14, s * 0.34], [-0.16, 0.125, s * 0.34], [-0.16, 0.14, s * 0.34],
    ]);
    // team colour wing panels (read strongly from above)
    b.hull('paint', team, [
      [0.02, 0.151, s * 0.14], [-0.18, 0.151, s * 0.14], [-0.04, 0.143, s * 0.3], [-0.15, 0.143, s * 0.3],
      [0.02, 0.157, s * 0.14], [-0.18, 0.157, s * 0.14], [-0.04, 0.149, s * 0.3], [-0.15, 0.149, s * 0.3],
    ]);
    // missile pods under the wings
    b.cylX('paint', P.aSteelDk, 0.028, 0.028, 0.22, 8, 0.0, 0.085, s * 0.2);
    b.cone('paint', P.red, 0.022, 0.05, 8, 0.13, 0.085, s * 0.2, 0, 0, -Math.PI / 2);
    b.cylX('paint', P.aSteelDk, 0.022, 0.022, 0.18, 8, 0.0, 0.085, s * 0.26);
    b.cone('paint', P.aSteelLt, 0.018, 0.04, 8, 0.11, 0.085, s * 0.26, 0, 0, -Math.PI / 2);
    b.box('paint', P.aSteelDk, 0.06, 0.03, 0.01, -0.02, 0.11, s * 0.2);
    // fan nacelle ring
    b.torus('paint', P.aSteelDk, 0.12, 0.022, -0.08, 0.135, s * 0.44, Math.PI / 2, 0, 0, 6, 18);
    b.torus('paint', P.aGold, 0.12, 0.008, -0.08, 0.16, s * 0.44, Math.PI / 2, 0, 0, 4, 18);
    b.cyl('paint', P.aSteelDk, 0.025, 0.03, 0.06, 8, -0.08, 0.13, s * 0.44);
    // strut from wing to hub
    strut(b, 'paint', P.aSteel, [-0.08, 0.135, s * 0.33], [-0.08, 0.135, s * 0.44], 0.03, 0.02);
  }
  // tail fins (V)
  for (const s of [1, -1]) {
    b.hull('paint', P.aSteel, [
      [-0.34, 0.18, s * 0.03], [-0.52, 0.18, s * 0.03], [-0.5, 0.32, s * 0.12], [-0.58, 0.32, s * 0.12],
      [-0.34, 0.19, s * 0.04], [-0.52, 0.19, s * 0.04], [-0.5, 0.33, s * 0.13], [-0.58, 0.33, s * 0.13],
    ]);
    b.box('paint', team, 0.06, 0.012, 0.03, -0.54, 0.325, s * 0.12);
  }
  b.box('paint', team, 0.3, 0.012, 0.08, -0.1, 0.221, 0);
  b.box('paint', P.aGold, 0.2, 0.01, 0.02, 0.3, 0.13, 0.055);
  b.box('paint', P.aGold, 0.2, 0.01, 0.02, 0.3, 0.13, -0.055);
  // engine exhaust + nav lights
  b.cylX('e:blue:pulse', 0, 0.04, 0.03, 0.02, 10, -0.53, 0.14, 0);
  b.sphere('e:red:blink', 0, 0.014, -0.02, 0.14, -0.35, 1, 1, 1, 6, 4);
  b.sphere('e:red:blink', 0, 0.014, -0.02, 0.14, 0.35, 1, 1, 1, 6, 4);
  b.sphere('e:red:blink', 0, 0.012, -0.57, 0.33, 0, 1, 1, 1, 6, 4);
  body.add(b.meshes({ receive: true }));

  // fans
  for (const s of [1, -1]) {
    const f = new B({ aoHeight: 0 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      f.box('paint', P.aSteelLt, 0.1, 0.006, 0.03, Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055, 0.3, -a, 0);
    }
    body.add(node(s > 0 ? 'rotorR' : 'rotorL', f, -0.08, 0.15, s * 0.44));
  }
  const muz = [new THREE.Vector3(0.16, 0.085, 0.2), new THREE.Vector3(0.16, 0.085, -0.2), new THREE.Vector3(0.13, 0.085, 0.26), new THREE.Vector3(0.13, 0.085, -0.26)];
  return finalizeTemplate(root, muz, (r) => {
    const rl = byName(r, 'rotorL');
    const rr = byName(r, 'rotorR');
    return (dt, s) => {
      const rate = s.moving ? 28 : 14;
      if (rl) rl.rotation.y += rate * dt;
      if (rr) rr.rotation.y -= rate * dt;
    };
  });
}

// ---------------------------------------------------------------------------
// Wraith gunship — hornet fuselage, main rotor, rotary chin cannon
// ---------------------------------------------------------------------------
function wraith(team: THREE.Color): Template {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const b = new B({ aoHeight: 0, jitter: 0.02 });
  // fuselage (hornet-like)
  b.hull('paint', P.cGun, mz([
    [0.5, 0.1, 0], [0.36, 0.05, 0.05], [0.36, 0.17, 0.06], [0.1, 0.03, 0.12], [0.08, 0.24, 0.1],
    [-0.14, 0.05, 0.1], [-0.14, 0.22, 0.08], [-0.26, 0.12, 0.04],
  ]));
  // cockpit visor
  b.hull('e:orange', 0, mz([[0.44, 0.13, 0.0], [0.34, 0.16, 0.05], [0.24, 0.2, 0.06], [0.3, 0.22, 0.0], [0.36, 0.12, 0.04]]));
  // tail boom
  b.hull('paint', P.cGunLt, mz([[-0.14, 0.1, 0.05], [-0.14, 0.2, 0.05], [-0.62, 0.14, 0.02], [-0.62, 0.18, 0.02]]));
  // tail fin + stabilisers
  b.hull('paint', P.cGun, [[-0.5, 0.17, 0], [-0.64, 0.17, 0], [-0.62, 0.34, 0.01], [-0.68, 0.34, 0.01], [-0.62, 0.34, -0.01], [-0.68, 0.34, -0.01], [-0.5, 0.17, 0.012], [-0.5, 0.17, -0.012]]);
  b.box('paint', P.cRed, 0.08, 0.012, 0.26, -0.56, 0.16, 0);
  spike(b, 'paint', P.cRed, -0.66, 0.33, 0, 0.1, 0.012, 0, 0.9);
  // stub wings with engine pods
  for (const s of [1, -1]) {
    b.hull('paint', P.cGun, [
      [0.08, 0.1, s * 0.1], [-0.12, 0.1, s * 0.1], [0.02, 0.13, s * 0.1], [-0.1, 0.13, s * 0.1],
      [-0.02, 0.09, s * 0.3], [-0.12, 0.09, s * 0.3], [-0.04, 0.11, s * 0.3], [-0.12, 0.11, s * 0.3],
    ]);
    b.box('paint', team, 0.1, 0.008, 0.14, -0.05, 0.128, s * 0.2);
    b.cylX('paint', P.cBlack, 0.045, 0.035, 0.24, 10, -0.04, 0.1, s * 0.33);
    b.cylX('paint', P.cRed, 0.05, 0.05, 0.02, 10, 0.05, 0.1, s * 0.33);
    b.cylX('e:orange', 0, 0.032, 0.032, 0.02, 10, -0.165, 0.1, s * 0.33);
    spike(b, 'paint', P.cBlack, 0.08, 0.1, s * 0.33, 0.1, 0.03, 0, -Math.PI / 2);
    b.cbox('paint', P.cBlack, 0.12, 0.04, 0.04, 0.01, 0.0, 0.06, s * 0.22); // hardpoint
  }
  // team colour spine + rotor mast
  b.box('paint', team, 0.2, 0.01, 0.06, -0.02, 0.232, 0);
  b.cyl('paint', P.cBlack, 0.03, 0.045, 0.08, 8, 0.0, 0.27, 0);
  b.box('paint', P.cRed, 0.12, 0.01, 0.02, 0.22, 0.2, 0.055, 0, 0, -0.35);
  b.box('paint', P.cRed, 0.12, 0.01, 0.02, 0.22, 0.2, -0.055, 0, 0, -0.35);
  b.sphere('e:orange:blink', 0, 0.012, -0.12, 0.09, 0.3, 1, 1, 1, 6, 4);
  b.sphere('e:orange:blink', 0, 0.012, -0.12, 0.09, -0.3, 1, 1, 1, 6, 4);
  // tail rotor (static at this scale)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box('paint', P.cGunLt, 0.012, 0.12, 0.012, -0.64 + Math.sin(a) * 0.05, 0.26 + Math.cos(a) * 0.05, 0.03, 0, 0, -a);
  }
  body.add(b.meshes());

  // main rotor
  const r = new B({ aoHeight: 0 });
  r.cyl('paint', P.cGunLt, 0.04, 0.04, 0.03, 8, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    r.box('paint', P.cBlack, 0.5, 0.008, 0.04, Math.cos(a) * 0.26, 0.004, -Math.sin(a) * 0.26, 0, a, 0);
    r.box('paint', P.cRed, 0.05, 0.009, 0.042, Math.cos(a) * 0.49, 0.004, -Math.sin(a) * 0.49, 0, a, 0);
  }
  body.add(node('rotor', r, 0, 0.32, 0));
  // rotary chin cannon
  const g = new B({ aoHeight: 0 });
  g.cylX('paint', P.cBlack, 0.03, 0.03, 0.06, 8, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.cylX('paint', P.gunmetal, 0.008, 0.008, 0.18, 5, 0.1, Math.cos(a) * 0.016, Math.sin(a) * 0.016);
  }
  g.cylX('paint', P.cRed, 0.024, 0.024, 0.012, 8, 0.16, 0, 0);
  body.add(node('cannon', g, 0.34, 0.03, 0));
  const muz = [new THREE.Vector3(0.53, 0.03, 0)];
  return finalizeTemplate(root, muz, (rt) => {
    const rotor = byName(rt, 'rotor');
    const cannon = byName(rt, 'cannon');
    return (dt, s) => {
      const rate = s.moving ? 22 : 12;
      if (rotor) rotor.rotation.y += rate * dt;
      if (cannon && s.firing > 0) cannon.rotation.x += dt * 30 * s.firing;
    };
  });
}

export const AIRCRAFT: Record<string, (team: THREE.Color) => Template> = { hawk, wraith };
