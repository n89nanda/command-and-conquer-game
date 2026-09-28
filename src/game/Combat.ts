import { WEAPONS } from '../data/weapons';
import type { WeaponDef } from '../data/types';
import type { Entity } from './Entity';
import type { World } from './World';

export interface WeaponState {
  def: WeaponDef;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
  muzzleIdx: number;
}

export function makeWeapons(ids: string[] | undefined): WeaponState[] {
  return (ids ?? []).map((id) => ({ def: WEAPONS[id], cooldown: Math.random() * 0.5, burstLeft: 0, burstTimer: 0, muzzleIdx: 0 })).filter((w) => !!w.def);
}

export function canWeaponHit(w: WeaponDef, target: Entity): boolean {
  if (target.isAir) return w.targetsAir;
  if (!w.targetsGround) return false;
  return w.vs[target.armor] > 0;
}

export function canAnyHit(ws: WeaponState[], target: Entity): boolean {
  for (const w of ws) if (canWeaponHit(w.def, target)) return true;
  return false;
}

/** Max range of weapons that can hit the target (0 if none). */
export function rangeVs(ws: WeaponState[], target: Entity): number {
  let r = 0;
  for (const w of ws) if (canWeaponHit(w.def, target) && w.def.range > r) r = w.def.range;
  return r;
}

export function maxRange(ws: WeaponState[]): number {
  let r = 0;
  for (const w of ws) if (w.def.range > r) r = w.def.range;
  return r;
}

/** Is the target visible (not cloaked) to the given observer's owner? */
export function isTargetable(world: World, observer: Entity, target: Entity): boolean {
  if (target.dead) return false;
  if (target.kind === 'unit') {
    const u = target as import('./Unit').Unit;
    if (u.isCloaked()) {
      // detected only if very close
      if (Math.hypot(observer.x - target.x, observer.z - target.z) > 1.8) return false;
    }
  }
  return true;
}

/**
 * Pick the best target within `radius` of (x,z) for the given weapons.
 * Prefers armed threats, effective matchups, and closer targets.
 */
export function acquireTarget(world: World, self: Entity, ws: WeaponState[], x: number, z: number, radius: number): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const owner = self.owner;
  const consider = (e: Entity) => {
    if (e.dead || e === self) return;
    if (!e.owner.isEnemyOf(owner)) return;
    if (!canAnyHit(ws, e)) return;
    const d = e.distTo(x, z);
    if (d > radius) return;
    if (!isTargetable(world, self, e)) return;
    let eff = 0;
    for (const w of ws) if (canWeaponHit(w.def, e)) eff = Math.max(eff, w.def.vs[e.armor]);
    let score = d - eff * 3;
    if (e.kind === 'unit') {
      const u = e as import('./Unit').Unit;
      if (u.weapons.length > 0) score -= 2.5;
      if (u.def.harvester) score += 0.5;
    } else {
      const b = e as import('./Building').Building;
      if (b.weapons.length > 0) score -= 2;
      else score += 4; // prefer units / defences over plain buildings
      if (b.def.wall) score += 6;
    }
    if (e === self.lastAttacker) score -= 2;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  };
  world.spatial.query(x, z, radius + 1, consider);
  for (const b of world.buildings) {
    if (b.dead) continue;
    if (Math.abs(b.x - x) > radius + 3 || Math.abs(b.z - z) > radius + 3) continue;
    consider(b);
  }
  return best;
}

/** Damage calculation including veterancy. */
export function computeDamage(w: WeaponDef, attacker: Entity | null, target: Entity): number {
  let dmg = w.damage * (w.vs[target.armor] ?? 1);
  if (attacker) dmg *= 1 + attacker.rank * 0.2;
  if (target.rank) dmg *= 1 - target.rank * 0.1;
  return dmg;
}
