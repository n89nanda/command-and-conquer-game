import * as THREE from 'three';

/**
 * Every material used for world objects (terrain, doodads, units, buildings)
 * must be passed through registerWorldMaterial so the renderer can inject
 * shared shader features (fog of war, damage flash, etc).
 */
type Hook = (m: THREE.Material) => void;
const hooks: Hook[] = [];
const registered = new Set<THREE.Material>();

export function registerWorldMaterial<T extends THREE.Material>(m: T): T {
  if (registered.has(m)) return m;
  registered.add(m);
  for (const h of hooks) h(m);
  return m;
}

export function addWorldMaterialHook(h: Hook) {
  hooks.push(h);
  for (const m of registered) h(m);
}
