// Faction-agnostic knowledge derived from the data tables.
// The AI never hardcodes unit ids: every role is inferred from the defs so
// that new units / buildings are picked up automatically.

import { BUILDING_LIST } from '../../data/buildings';
import { UNIT_LIST } from '../../data/units';
import { WEAPONS } from '../../data/weapons';
import type { ArmorType, BuildingDef, FactionId, UnitDef } from '../../data/types';

export const ARMORS: ArmorType[] = ['infantry', 'light', 'heavy', 'building', 'aircraft'];
export type ArmorMix = Record<ArmorType, number>;

export function emptyMix(): ArmorMix {
  return { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 0 };
}

/** Sustained damage per second of a weapon list against each armor class. */
export function dpsProfile(weaponIds: string[] | undefined): ArmorMix {
  const out = emptyMix();
  for (const id of weaponIds ?? []) {
    const w = WEAPONS[id];
    if (!w) continue;
    const base = (w.damage * (w.burst ?? 1)) / w.cooldown;
    for (const a of ARMORS) {
      if (a === 'aircraft' ? !w.targetsAir : !w.targetsGround) continue;
      out[a] += base * (w.vs[a] ?? 0);
    }
  }
  return out;
}

export type UnitRole =
  | 'harvester'
  | 'mcv'
  | 'engineer'
  | 'infantry' // generic combat infantry
  | 'vehicle' // generic combat vehicle
  | 'artillery'
  | 'aircraft';

export interface UnitInfo {
  def: UnitDef;
  role: UnitRole;
  dps: ArmorMix;
  range: number;
  minRange: number;
  /** can shoot at aircraft */
  antiAir: boolean;
  /** fast raider suitable for harassment / scouting */
  fast: boolean;
}

export type BuildingRole =
  | 'yard'
  | 'power'
  | 'refinery'
  | 'barracks'
  | 'factory'
  | 'radar'
  | 'repair'
  | 'airfield'
  | 'tech'
  | 'superweapon'
  | 'defense'
  | 'wall'
  | 'other';

export interface BuildingInfo {
  def: BuildingDef;
  role: BuildingRole;
  dps: ArmorMix;
  range: number;
}

export interface FactionKit {
  faction: FactionId;
  units: UnitInfo[];
  buildings: BuildingInfo[];
  unit: Record<string, UnitInfo>;
  building: Record<string, BuildingInfo>;
  /** first building of each role (for singletons like yard/power/refinery) */
  byRole: Partial<Record<BuildingRole, BuildingDef>>;
  harvester: UnitDef | undefined;
  mcv: UnitDef | undefined;
  engineer: UnitDef | undefined;
  combatUnits: UnitInfo[];
  defenses: BuildingInfo[];
  /** light, fast, cheap combat vehicle for scouting / harassment */
  scoutUnit: UnitInfo | undefined;
}

function classifyBuilding(b: BuildingDef): BuildingRole {
  if (b.wall) return 'wall';
  if (b.produces === 'yard') return 'yard';
  if (b.superweapon) return 'superweapon';
  if (b.refinery) return 'refinery';
  if (b.produces === 'barracks') return 'barracks';
  if (b.produces === 'factory') return 'factory';
  if (b.produces === 'airfield') return 'airfield';
  if (b.weapons && b.weapons.length > 0) return 'defense';
  if (b.repairPad) return 'repair';
  if (b.radar) return 'radar';
  if (b.power > 0) return 'power';
  if ((b.techLevel ?? 1) >= 3) return 'tech';
  return 'other';
}

function classifyUnit(u: UnitDef): UnitRole {
  if (u.harvester) return 'harvester';
  if (u.mcv) return 'mcv';
  if (u.engineer) return 'engineer';
  if (u.flying) return 'aircraft';
  const minR = Math.max(0, ...u.weapons.map((w) => WEAPONS[w]?.minRange ?? 0));
  if (minR > 0) return 'artillery';
  return u.category === 'infantry' ? 'infantry' : 'vehicle';
}

const kits = new Map<FactionId, FactionKit>();

export function getKit(faction: FactionId): FactionKit {
  const cached = kits.get(faction);
  if (cached) return cached;
  const units: UnitInfo[] = [];
  for (const u of UNIT_LIST) {
    if (u.faction !== faction && u.faction !== 'both') continue;
    if (u.prereqs.includes('__never')) continue;
    const ws = u.weapons.map((w) => WEAPONS[w]).filter(Boolean);
    const range = Math.max(0, ...ws.map((w) => w.range));
    const minRange = Math.max(0, ...ws.map((w) => w.minRange ?? 0));
    units.push({
      def: u,
      role: classifyUnit(u),
      dps: dpsProfile(u.weapons),
      range,
      minRange,
      antiAir: ws.some((w) => w.targetsAir),
      fast: u.speed >= 3.5 && u.category === 'vehicle' && ws.length > 0,
    });
  }
  const buildings: BuildingInfo[] = [];
  for (const b of BUILDING_LIST) {
    if (b.faction !== faction) continue;
    const ws = (b.weapons ?? []).map((w) => WEAPONS[w]).filter(Boolean);
    buildings.push({ def: b, role: classifyBuilding(b), dps: dpsProfile(b.weapons), range: Math.max(0, ...ws.map((w) => w.range)) });
  }
  const byRole: Partial<Record<BuildingRole, BuildingDef>> = {};
  // prefer the cheapest def for each role (e.g. the basic power plant)
  for (const bi of [...buildings].sort((a, b) => a.def.cost - b.def.cost)) if (!byRole[bi.role]) byRole[bi.role] = bi.def;
  const combatUnits = units.filter((u) => u.role === 'infantry' || u.role === 'vehicle' || u.role === 'artillery' || u.role === 'aircraft');
  const fast = combatUnits.filter((u) => u.fast).sort((a, b) => a.def.cost - b.def.cost);
  const kit: FactionKit = {
    faction,
    units,
    buildings,
    unit: Object.fromEntries(units.map((u) => [u.def.id, u])),
    building: Object.fromEntries(buildings.map((b) => [b.def.id, b])),
    byRole,
    harvester: units.find((u) => u.role === 'harvester')?.def,
    mcv: units.find((u) => u.role === 'mcv')?.def,
    engineer: units.find((u) => u.role === 'engineer')?.def,
    combatUnits,
    defenses: buildings.filter((b) => b.role === 'defense'),
    scoutUnit: fast[0],
  };
  kits.set(faction, kit);
  return kit;
}

/** Info for any unit id regardless of faction (used for enemy analysis). */
const anyUnit = new Map<string, UnitInfo>();
export function unitInfo(def: UnitDef): UnitInfo {
  let i = anyUnit.get(def.id);
  if (!i) {
    const kit = def.faction === 'both' ? null : getKit(def.faction);
    i = kit?.unit[def.id] ?? {
      def,
      role: classifyUnit(def),
      dps: dpsProfile(def.weapons),
      range: Math.max(0, ...def.weapons.map((w) => WEAPONS[w]?.range ?? 0)),
      minRange: 0,
      antiAir: def.weapons.some((w) => WEAPONS[w]?.targetsAir),
      fast: false,
    };
    anyUnit.set(def.id, i);
  }
  return i;
}

/** Mix-weighted effectiveness of a dps profile. */
export function effectiveness(dps: ArmorMix, mix: ArmorMix): number {
  let s = 0;
  for (const a of ARMORS) s += dps[a] * mix[a];
  return s;
}
