import type { ArmorType, WeaponDef } from './types';

const vs = (infantry: number, light: number, heavy: number, building: number, aircraft = 0): Record<ArmorType, number> => ({
  infantry,
  light,
  heavy,
  building,
  aircraft,
});

const list: WeaponDef[] = [
  // --- Infantry ---
  { id: 'rifle', damage: 11, range: 4.5, cooldown: 0.9, projectile: 'bullet', vs: vs(1, 0.45, 0.1, 0.2), targetsGround: true, targetsAir: false, sound: 'rifle' },
  { id: 'rocketInf', damage: 45, range: 5.5, cooldown: 2.4, projectile: 'rocket', projectileSpeed: 12, splash: 0.5, vs: vs(0.25, 1, 1, 0.55, 0.65), targetsGround: true, targetsAir: true, sound: 'rocket' },
  { id: 'flameInf', damage: 16, range: 2.6, cooldown: 0.5, projectile: 'flame', splash: 0.8, vs: vs(1.6, 0.55, 0.15, 0.9), targetsGround: true, targetsAir: false, sound: 'flame' },
  { id: 'sniper', damage: 120, range: 8.5, cooldown: 2.2, projectile: 'railgun', vs: vs(1, 0.05, 0.02, 0.02), targetsGround: true, targetsAir: false, sound: 'railgun' },

  // --- Vehicles ---
  { id: 'buggyMg', damage: 12, range: 5, cooldown: 0.45, burst: 1, projectile: 'bullet', vs: vs(1, 0.6, 0.15, 0.15, 0.5), targetsGround: true, targetsAir: true, sound: 'mg' },
  { id: 'bikeRockets', damage: 30, range: 5.5, cooldown: 1.9, burst: 2, burstDelay: 0.2, projectile: 'rocket', projectileSpeed: 13, splash: 0.4, vs: vs(0.3, 1, 0.9, 0.5, 0.9), targetsGround: true, targetsAir: true, sound: 'rocket' },
  { id: 'tankCannon', damage: 38, range: 5.5, cooldown: 1.7, projectile: 'shell', projectileSpeed: 22, splash: 0.35, vs: vs(0.5, 0.9, 1, 0.75), targetsGround: true, targetsAir: false, sound: 'cannon' },
  { id: 'lightCannon', damage: 26, range: 5, cooldown: 1.2, projectile: 'shell', projectileSpeed: 24, splash: 0.3, vs: vs(0.5, 1, 0.8, 0.6), targetsGround: true, targetsAir: false, sound: 'cannon' },
  { id: 'titanCannon', damage: 45, range: 6, cooldown: 2.2, burst: 2, burstDelay: 0.18, projectile: 'shell', projectileSpeed: 22, splash: 0.5, vs: vs(0.4, 0.9, 1, 0.8), targetsGround: true, targetsAir: false, sound: 'heavyCannon' },
  { id: 'titanMissiles', damage: 30, range: 7, cooldown: 2.5, burst: 2, burstDelay: 0.15, projectile: 'missile', projectileSpeed: 14, splash: 0.4, vs: vs(0.3, 0.5, 0.35, 0.3, 1.2), targetsGround: true, targetsAir: true, sound: 'missile' },
  { id: 'mlrs', damage: 34, range: 11, minRange: 3, cooldown: 4.5, burst: 4, burstDelay: 0.12, projectile: 'artillery', projectileSpeed: 9, splash: 1.2, inaccuracy: 1.1, vs: vs(1, 0.7, 0.45, 0.8), targetsGround: true, targetsAir: false, sound: 'artillery' },
  { id: 'flameTank', damage: 22, range: 3, cooldown: 0.35, projectile: 'flame', splash: 1, vs: vs(1.6, 0.6, 0.2, 1), targetsGround: true, targetsAir: false, sound: 'flame' },
  { id: 'shadeRockets', damage: 36, range: 6, cooldown: 2.2, burst: 2, burstDelay: 0.2, projectile: 'rocket', projectileSpeed: 14, splash: 0.4, vs: vs(0.35, 1, 1, 0.6, 1), targetsGround: true, targetsAir: true, sound: 'rocket' },
  { id: 'aaGun', damage: 18, range: 8, cooldown: 0.3, projectile: 'bullet', vs: vs(0.4, 0.2, 0.1, 0.1, 1.2), targetsGround: false, targetsAir: true, sound: 'mg' },
  { id: 'beamTank', damage: 70, range: 6.5, cooldown: 2.0, projectile: 'laser', vs: vs(0.6, 1, 1, 0.9), targetsGround: true, targetsAir: false, sound: 'laser' },

  // --- Aircraft ---
  { id: 'hawkMissiles', damage: 42, range: 5.5, cooldown: 1.1, projectile: 'missile', projectileSpeed: 18, splash: 0.4, vs: vs(0.4, 1, 1, 0.6, 0.8), targetsGround: true, targetsAir: true, sound: 'missile' },
  { id: 'wraithChaingun', damage: 12, range: 5, cooldown: 0.18, projectile: 'bullet', vs: vs(1, 0.7, 0.35, 0.3, 0.6), targetsGround: true, targetsAir: true, sound: 'mg' },

  // --- Structures ---
  { id: 'towerMg', damage: 14, range: 6, cooldown: 0.5, projectile: 'bullet', vs: vs(1, 0.55, 0.2, 0.1), targetsGround: true, targetsAir: false, sound: 'mg' },
  { id: 'turretCannon', damage: 45, range: 6.5, cooldown: 1.6, projectile: 'shell', projectileSpeed: 24, splash: 0.35, vs: vs(0.4, 1, 1, 0.6), targetsGround: true, targetsAir: false, sound: 'cannon' },
  { id: 'samMissile', damage: 55, range: 9, cooldown: 1.4, burst: 2, burstDelay: 0.2, projectile: 'missile', projectileSpeed: 20, vs: vs(0, 0, 0, 0, 1.2), targetsGround: false, targetsAir: true, sound: 'missile' },
  { id: 'obeliskBeam', damage: 200, range: 7.5, cooldown: 3.6, projectile: 'laser', splash: 0.3, vs: vs(1, 1, 1, 0.8), targetsGround: true, targetsAir: false, sound: 'obelisk' },
  { id: 'railTower', damage: 130, range: 8, cooldown: 3.0, projectile: 'railgun', vs: vs(0.8, 1, 1, 0.8), targetsGround: true, targetsAir: false, sound: 'railgun' },
];

export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(list.map((w) => [w.id, w]));
