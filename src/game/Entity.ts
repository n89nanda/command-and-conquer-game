import type { ArmorType } from '../data/types';
import type { Player } from './Player';
import type { World } from './World';

let nextId = 1;
export function resetEntityIds() {
  nextId = 1;
}

export abstract class Entity {
  readonly id: number;
  abstract readonly kind: 'unit' | 'building';
  owner: Player;
  x: number;
  z: number;
  /** previous tick position for render interpolation */
  px: number;
  pz: number;
  hp: number;
  maxHp: number;
  dead = false;
  /** last time damaged (world time) */
  lastHitTime = -999;
  lastAttacker: Entity | null = null;
  /** recently fired (1 -> 0) for animations/stealth */
  firing = 0;
  /** render object handle (owned by renderer) */
  view: unknown = null;
  selected = false;
  /** group number for control groups */
  xp = 0;
  rank = 0;

  constructor(owner: Player, x: number, z: number, hp: number) {
    this.id = nextId++;
    this.owner = owner;
    this.x = this.px = x;
    this.z = this.pz = z;
    this.hp = this.maxHp = hp;
  }

  abstract get armor(): ArmorType;
  abstract get radius(): number;
  abstract get sight(): number;
  abstract get name(): string;
  abstract get typeId(): string;
  abstract get cost(): number;
  get isAir(): boolean {
    return false;
  }
  /** Distance from point to this entity's surface. */
  distTo(x: number, z: number): number {
    const d = Math.hypot(this.x - x, this.z - z) - this.radius;
    return d < 0 ? 0 : d;
  }
  isEnemyOf(p: Player): boolean {
    return this.owner.isEnemyOf(p);
  }
  abstract update(world: World, dt: number): void;
}
