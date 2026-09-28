// Core data definitions shared by simulation, rendering, audio and UI.

export type FactionId = 'aegis' | 'covenant';
export type ArmorType = 'infantry' | 'light' | 'heavy' | 'building' | 'aircraft';
export type UnitCategory = 'infantry' | 'vehicle' | 'aircraft';
export type ProducerKind = 'barracks' | 'factory' | 'airfield' | 'yard';
export type BuildTab = 'structures' | 'defense' | 'infantry' | 'vehicles' | 'aircraft';

export type ProjectileKind =
  | 'bullet' // instant tracer
  | 'shell' // fast cannon shell
  | 'rocket' // homing-ish rocket with smoke trail
  | 'missile' // AA / long range missile
  | 'artillery' // ballistic arc
  | 'laser' // instant beam
  | 'flame' // short range flame stream
  | 'railgun'; // instant heavy beam

export interface WeaponDef {
  id: string;
  damage: number;
  range: number; // tiles
  minRange?: number;
  cooldown: number; // seconds between shots (or bursts)
  burst?: number; // shots per burst
  burstDelay?: number;
  projectile: ProjectileKind;
  projectileSpeed?: number; // tiles / s (for travelling projectiles)
  splash?: number; // splash radius in tiles
  vs: Record<ArmorType, number>; // damage multipliers
  targetsGround: boolean;
  targetsAir: boolean;
  sound: SoundId;
  /** Deviation in tiles at max range (artillery inaccuracy). */
  inaccuracy?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: FactionId | 'both';
  category: UnitCategory;
  tab: BuildTab;
  producer: ProducerKind;
  cost: number;
  buildTime: number; // seconds
  hp: number;
  armor: ArmorType;
  speed: number; // tiles / s
  turnRate: number; // radians / s
  turretTurnRate?: number;
  sight: number; // tiles
  radius: number; // collision radius in tiles
  weapons: string[];
  prereqs: string[]; // building ids
  description: string;
  hotkey?: string;
  // flags
  hasTurret?: boolean;
  harvester?: boolean;
  mcv?: boolean;
  engineer?: boolean;
  stealth?: boolean;
  selfHeal?: number; // hp / s
  crusher?: boolean;
  crushable?: boolean;
  flying?: boolean;
  capacity?: number; // harvester capacity (credits)
  /** Aircraft returns to pad to reload after N shots. */
  ammo?: number;
  techLevel?: number;
  voice?: 'infantry' | 'vehicle' | 'heavy' | 'pilot' | 'engineer' | 'zealot';
  deathExplosion?: 'small' | 'medium' | 'large' | 'infantry';
}

export interface BuildingDef {
  id: string;
  name: string;
  faction: FactionId | 'both';
  tab: BuildTab;
  cost: number;
  buildTime: number;
  hp: number;
  footprint: [number, number]; // tiles (w along x, h along z)
  power: number; // +produces / -consumes
  sight: number;
  prereqs: string[];
  description: string;
  produces?: ProducerKind;
  weapons?: string[];
  refinery?: boolean;
  radar?: boolean;
  repairPad?: boolean;
  superweapon?: SuperweaponId;
  /** Defensive structures need power to fire (e.g. obelisk). */
  needsPower?: boolean;
  wall?: boolean;
  hasTurret?: boolean;
  turretTurnRate?: number;
  /** Granted free unit when built (e.g. refinery gives harvester). */
  freeUnit?: string;
  techLevel?: number;
  /** Tiles within which new buildings may be placed. */
  buildRadius?: number;
  stealthField?: boolean;
}

export type SuperweaponId = 'ionStrike' | 'riftMissile';

export interface SuperweaponDef {
  id: SuperweaponId;
  name: string;
  chargeTime: number; // seconds
  damage: number;
  radius: number;
  readyLine: string;
  launchLine: string;
  detectedLine: string;
}

export type SoundId =
  | 'mg' // machine gun burst
  | 'rifle'
  | 'cannon'
  | 'heavyCannon'
  | 'rocket'
  | 'missile'
  | 'artillery'
  | 'laser'
  | 'obelisk'
  | 'flame'
  | 'railgun'
  | 'explosionSmall'
  | 'explosionMedium'
  | 'explosionLarge'
  | 'buildingCollapse'
  | 'infantryDie'
  | 'placeBuilding'
  | 'sell'
  | 'click'
  | 'select'
  | 'cancel'
  | 'error'
  | 'powerDown'
  | 'buildComplete'
  | 'unitReady'
  | 'moneyTick'
  | 'harvest'
  | 'ionCharge'
  | 'ionStrike'
  | 'nukeLaunch'
  | 'nukeImpact'
  | 'radarOn'
  | 'repair'
  | 'crush'
  | 'rotor'
  | 'uiHover'
  | 'briefingType'
  | 'victory'
  | 'defeat';
