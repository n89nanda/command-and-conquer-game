import type * as THREE from 'three';

/**
 * Contract between the procedural model library and the game renderer.
 *
 * World units: 1 unit == 1 map tile. Y is up. Ground is y = 0 in model space.
 * Units are built FACING +X (the renderer sets root.rotation.y = -heading).
 * Buildings are centred on their footprint: a [w,h] footprint spans
 * x in [-w/2, w/2], z in [-h/2, h/2].
 */
export interface ModelAnimState {
  /** seconds since game start */
  time: number;
  /** is the entity currently moving */
  moving: boolean;
  /** speed factor 0..1 */
  speed: number;
  /** recently fired (0..1, 1 = just fired, decays to 0) */
  firing: number;
  /** health ratio 0..1 */
  health: number;
  /** building: is powered */
  powered: boolean;
  /** building: currently producing something (factory doors, etc) */
  producing: boolean;
  /** harvester: currently harvesting */
  harvesting: boolean;
  /** construction progress for buildings being placed (0..1), 1 = done */
  build: number;
}

export interface ModelInstance {
  /** Root object, positioned/rotated by the renderer. */
  root: THREE.Object3D;
  /** Optional turret pivot; renderer sets turret.rotation.y relative to hull. */
  turret?: THREE.Object3D;
  /**
   * Muzzle positions in the local space of `turret` (if present) or `root`.
   * Used for spawning muzzle flashes and projectiles.
   */
  muzzles: THREE.Vector3[];
  /** Height of the model's top, used for health bar placement. */
  height: number;
  /** Per-frame animation hook (walk cycles, spinning radars, rotors...). */
  update?(dt: number, s: ModelAnimState): void;
  /** Free GPU resources that are unique to this instance (shared geometry must NOT be disposed). */
  dispose?(): void;
}

export interface ModelLibrary {
  unit(typeId: string, teamColor: THREE.Color): ModelInstance;
  building(typeId: string, teamColor: THREE.Color): ModelInstance;
}
