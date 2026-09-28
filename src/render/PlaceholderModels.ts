import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { registerWorldMaterial } from './materials';
import type { ModelInstance, ModelLibrary } from './models/ModelTypes';

// Simple fallback models used until/unless the full procedural library is present.
const matCache = new Map<number, THREE.MeshStandardMaterial>();
const mat = (c: number) => {
  let m = matCache.get(c);
  if (!m) {
    m = registerWorldMaterial(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 }));
    matCache.set(c, m);
  }
  return m;
};

export const placeholderModels: ModelLibrary = {
  unit(id, team) {
    const def = UNITS[id];
    const root = new THREE.Group();
    const s = def ? def.radius * 2 : 0.6;
    const inf = def?.category === 'infantry';
    const body = new THREE.Mesh(inf ? new THREE.CapsuleGeometry(0.08, 0.2, 2, 6) : new THREE.BoxGeometry(s * 1.2, s * 0.45, s * 0.9), mat(team.getHex()));
    body.position.y = inf ? 0.2 : s * 0.25;
    body.castShadow = true;
    root.add(body);
    let turret: THREE.Object3D | undefined;
    if (def?.hasTurret) {
      turret = new THREE.Group();
      turret.position.y = s * 0.5;
      const t = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.25, s * 0.45), mat(0x555555));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, 0.06, 0.06), mat(0x333333));
      barrel.position.x = s * 0.4;
      turret.add(t, barrel);
      root.add(turret);
    }
    const inst: ModelInstance = { root, turret, muzzles: [new THREE.Vector3(s * 0.7, 0.05, 0)], height: inf ? 0.45 : s * 0.7 };
    return inst;
  },
  building(id, team) {
    const def = BUILDINGS[id];
    const [w, h] = def?.footprint ?? [2, 2];
    const root = new THREE.Group();
    const hh = def?.wall ? 0.6 : 0.8 + Math.min(w, h) * 0.3;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, hh, h * 0.9), mat(0x888880));
    box.position.y = hh / 2;
    box.castShadow = box.receiveShadow = true;
    root.add(box);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.12, h * 0.92), mat(team.getHex()));
    stripe.position.y = hh * 0.7;
    root.add(stripe);
    let turret: THREE.Object3D | undefined;
    if (def?.hasTurret) {
      turret = new THREE.Group();
      turret.position.y = hh;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), mat(0x333333));
      barrel.position.x = 0.3;
      turret.add(barrel);
      root.add(turret);
    }
    return { root, turret, muzzles: [new THREE.Vector3(0.6, 0, 0)], height: hh };
  },
};
