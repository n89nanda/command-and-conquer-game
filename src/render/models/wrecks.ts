/** Destroyed-vehicle husks and destroyed-building rubble. */
import * as THREE from 'three';
import { B, P, Template, finalizeTemplate, mat, rng, cboxGeo, strut, T } from './kit';

/** Charred copy of a live template: same shared geometry, charred material, glows removed, parts knocked askew. */
export function makeHusk(live: Template, seed: number): Template {
  const r = rng(seed);
  const root = live.root.clone(true);
  const charred = mat('charred');
  const kill: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const key = (m.userData.matKey as string) ?? '';
    const sm = m.material as THREE.MeshStandardMaterial;
    const glows = !!sm.emissive && sm.emissiveIntensity > 0.2 && sm.emissive.getHex() !== 0;
    if (key.startsWith('e:') || key.startsWith('crystal') || glows || o.parent?.name === 'treads') {
      kill.push(o);
      return;
    }
    m.material = charred;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  for (const k of kill) k.parent?.remove(k);
  // knock things about
  const turret = root.getObjectByName('turret');
  if (turret) {
    turret.rotation.y = (r() - 0.5) * 2.2;
    turret.rotation.z = (r() - 0.5) * 0.12;
    turret.position.y -= 0.02;
    turret.name = 'turret_dead';
  }
  for (const n of ['rotor', 'rotorL', 'rotorR', 'tailRotor']) {
    const o = root.getObjectByName(n);
    if (o) {
      o.rotation.y = r() * 3;
      o.rotation.z = (r() - 0.5) * 0.4;
    }
  }
  const body = root.getObjectByName('body') ?? root;
  body.rotation.z = (r() - 0.5) * 0.06;
  body.rotation.x = (r() - 0.5) * 0.08;
  body.position.y = -0.02;
  // scorch mark under the wreck
  const b = new B({ aoHeight: 0 });
  const box = new THREE.Box3().setFromObject(live.root);
  const rad = Math.max(0.25, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.6);
  for (let i = 0; i < 5; i++) {
    b.add(cboxGeo(0.04 + r() * 0.05, 0.02 + r() * 0.02, 0.04 + r() * 0.04, 0.008), 'charred', 0x6a5e54, T((r() - 0.5) * rad * 1.6, 0.012, (r() - 0.5) * rad * 1.6, r(), r() * 3, r()));
  }
  root.add(b.meshes());
  return finalizeTemplate(root, [], undefined, live.height * 0.9);
}

/** Pile of broken concrete, twisted beams and scorch covering a building footprint. */
export function makeRubble(fp: [number, number]): Template {
  const [w, d] = fp;
  const r = rng(w * 131 + d * 17);
  const root = new THREE.Group();
  const b = new B({ aoHeight: 0.2, aoMin: 0.5, jitter: 0.08, seed: w * 7 + d });
  b.cboxB('matte', 0x4a443e, w * 0.9, 0.03, d * 0.9, 0.012, 0, 0, 0);
  const area = w * d;
  const chunks = Math.round(11 * area);
  for (let i = 0; i < chunks; i++) {
    const x = (r() - 0.5) * w * 0.85, z = (r() - 0.5) * d * 0.85;
    const centre = 1 - Math.min(1, Math.hypot(x / (w * 0.5), z / (d * 0.5)));
    const s = 0.05 + r() * 0.1 + centre * 0.07;
    const col = r() < 0.25 ? 0x57504a : r() < 0.6 ? 0x6a665f : 0x76726a;
    b.add(cboxGeo(s * (1 + r()), s * (0.5 + r() * 0.6), s * (1 + r()), s * 0.15), r() < 0.15 ? 'charred' : 'matte', col, T(x, 0.03 + s * 0.2 + centre * 0.08, z, r() - 0.5, r() * 3, r() - 0.5));
  }
  // broken wall stubs at corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1]]) {
    if (area === 1 && sx > 0) continue;
    const h = 0.12 + r() * 0.2;
    b.hull('matte', 0x77736b, [
      [0, 0, 0], [0.3, 0, 0], [0, 0, 0.06], [0.3, 0, 0.06], [0, h, 0], [0, h, 0.06], [0.12, h * 0.6, 0], [0.12, h * 0.6, 0.06], [0.3, h * 0.2, 0], [0.3, h * 0.2, 0.06],
    ], sx * (w * 0.45 - 0.05) - (sx > 0 ? 0.3 : 0), 0.02, sz * (d * 0.45 - 0.05));
  }
  // twisted girders
  for (let i = 0; i < Math.round(area * 1.5); i++) {
    const x = (r() - 0.5) * w * 0.7, z = (r() - 0.5) * d * 0.7;
    const a = r() * Math.PI * 2, len = 0.3 + r() * 0.4;
    strut(b, 'charred', P.rust, [x, 0.05, z], [x + Math.cos(a) * len, 0.08 + r() * 0.25, z + Math.sin(a) * len], 0.03, 0.02);
  }
  root.add(b.meshes());
  // a few smouldering embers
  const e = new B({ aoHeight: 0 });
  for (let i = 0; i < Math.max(2, Math.round(area)); i++) e.box('e:fire:flicker', 0, 0.04, 0.02, 0.04, (r() - 0.5) * w * 0.6, 0.05, (r() - 0.5) * d * 0.6);
  root.add(e.meshes());
  return finalizeTemplate(root, [], undefined);
}
