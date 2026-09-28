import type { UnitDef } from './types';

const list: UnitDef[] = [
  // ============================ AEGIS COALITION ============================
  {
    id: 'rifleman', name: 'Rifle Squad', faction: 'aegis', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 100, buildTime: 5, hp: 90, armor: 'infantry', speed: 1.35, turnRate: 10, sight: 6, radius: 0.18,
    weapons: ['rifle'], prereqs: ['a_barracks'], crushable: true, voice: 'infantry', deathExplosion: 'infantry',
    description: 'Standard Coalition infantry. Cheap, versatile, effective against enemy troops.',
  },
  {
    id: 'rocketeer', name: 'Rocket Trooper', faction: 'aegis', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 300, buildTime: 7, hp: 80, armor: 'infantry', speed: 1.2, turnRate: 10, sight: 6.5, radius: 0.18,
    weapons: ['rocketInf'], prereqs: ['a_barracks'], crushable: true, voice: 'infantry', deathExplosion: 'infantry',
    description: 'Shoulder-launched missiles. Strong against vehicles and aircraft.',
  },
  {
    id: 'a_engineer', name: 'Field Engineer', faction: 'aegis', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 500, buildTime: 8, hp: 70, armor: 'infantry', speed: 1.3, turnRate: 10, sight: 5, radius: 0.18,
    weapons: [], prereqs: ['a_barracks'], engineer: true, crushable: true, voice: 'engineer', deathExplosion: 'infantry',
    description: 'Captures enemy structures and repairs friendly ones. Unarmed.',
  },
  {
    id: 'marksman', name: 'Ghost Marksman', faction: 'aegis', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 600, buildTime: 11, hp: 100, armor: 'infantry', speed: 1.3, turnRate: 10, sight: 9.5, radius: 0.18,
    weapons: ['sniper'], prereqs: ['a_barracks', 'a_techlab'], crushable: true, voice: 'infantry', deathExplosion: 'infantry', techLevel: 3,
    description: 'Elite long-range rail-rifle. Eliminates infantry with a single shot.',
  },
  {
    id: 'scout', name: 'Pathfinder Scout', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 400, buildTime: 7, hp: 220, armor: 'light', speed: 4.2, turnRate: 5, sight: 8, radius: 0.35,
    weapons: ['buggyMg'], prereqs: ['a_factory'], hasTurret: true, turretTurnRate: 8, voice: 'vehicle', deathExplosion: 'small',
    description: 'Fast armoured recon vehicle with a heavy machine gun. Can engage aircraft.',
  },
  {
    id: 'guardian', name: 'Guardian MBT', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 800, buildTime: 12, hp: 480, armor: 'heavy', speed: 2.3, turnRate: 2.6, sight: 6.5, radius: 0.45,
    weapons: ['tankCannon'], prereqs: ['a_factory'], hasTurret: true, turretTurnRate: 3, crusher: true, voice: 'vehicle', deathExplosion: 'medium',
    description: 'Main battle tank. Reliable armour and a 120mm cannon.',
  },
  {
    id: 'tempest', name: 'Tempest MLRS', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 950, buildTime: 14, hp: 220, armor: 'light', speed: 2.1, turnRate: 2.4, sight: 7, radius: 0.45,
    weapons: ['mlrs'], prereqs: ['a_factory', 'a_radar'], hasTurret: true, turretTurnRate: 2, voice: 'vehicle', deathExplosion: 'medium',
    description: 'Long-range rocket artillery. Devastating against massed troops and defences. Vulnerable up close.',
  },
  {
    id: 'titan', name: 'Titan Assault Tank', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 2000, buildTime: 25, hp: 1050, armor: 'heavy', speed: 1.5, turnRate: 1.6, sight: 7, radius: 0.6,
    weapons: ['titanCannon', 'titanMissiles'], prereqs: ['a_factory', 'a_techlab'], hasTurret: true, turretTurnRate: 1.8, crusher: true,
    selfHeal: 2, voice: 'heavy', deathExplosion: 'large', techLevel: 3,
    description: 'Twin-cannon behemoth with anti-air missile pods. Self-repairs when damaged.',
  },
  {
    id: 'a_harvester', name: 'Harvester', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 1400, buildTime: 16, hp: 700, armor: 'heavy', speed: 1.7, turnRate: 2.2, sight: 4, radius: 0.55,
    weapons: [], prereqs: ['a_factory', 'a_refinery'], harvester: true, capacity: 700, crusher: true, voice: 'vehicle', deathExplosion: 'medium',
    description: 'Collects Riftite crystals and delivers them to a Refinery.',
  },
  {
    id: 'a_mcv', name: 'Mobile Construction Vehicle', faction: 'aegis', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 3000, buildTime: 30, hp: 1000, armor: 'heavy', speed: 1.3, turnRate: 1.6, sight: 5, radius: 0.65,
    weapons: [], prereqs: ['a_factory', 'a_repair'], mcv: true, crusher: true, voice: 'heavy', deathExplosion: 'large',
    description: 'Deploys into a Construction Yard, establishing a new base.',
  },
  {
    id: 'hawk', name: 'Hawk VTOL', faction: 'aegis', category: 'aircraft', tab: 'aircraft', producer: 'airfield',
    cost: 1200, buildTime: 16, hp: 260, armor: 'aircraft', speed: 5.5, turnRate: 3, sight: 8, radius: 0.5,
    weapons: ['hawkMissiles'], prereqs: ['a_airfield'], flying: true, ammo: 6, voice: 'pilot', deathExplosion: 'medium',
    description: 'Vertical take-off strike craft armed with guided missiles. Rearms at the Airfield.',
  },

  // ============================ RIFT COVENANT ============================
  {
    id: 'acolyte', name: 'Acolyte', faction: 'covenant', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 100, buildTime: 5, hp: 85, armor: 'infantry', speed: 1.45, turnRate: 10, sight: 6, radius: 0.18,
    weapons: ['rifle'], prereqs: ['c_barracks'], crushable: true, voice: 'zealot', deathExplosion: 'infantry',
    description: 'Fanatical foot soldier of the Covenant. Fast and cheap.',
  },
  {
    id: 'zealot', name: 'Flame Zealot', faction: 'covenant', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 220, buildTime: 6, hp: 110, armor: 'infantry', speed: 1.3, turnRate: 10, sight: 5, radius: 0.18,
    weapons: ['flameInf'], prereqs: ['c_barracks'], crushable: true, voice: 'zealot', deathExplosion: 'infantry',
    description: 'Short-ranged flamethrower. Incinerates infantry and structures.',
  },
  {
    id: 'seeker', name: 'Seeker', faction: 'covenant', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 300, buildTime: 7, hp: 80, armor: 'infantry', speed: 1.25, turnRate: 10, sight: 6.5, radius: 0.18,
    weapons: ['rocketInf'], prereqs: ['c_barracks'], crushable: true, voice: 'zealot', deathExplosion: 'infantry',
    description: 'Anti-armour infantry armed with Rift-tipped rockets. Can hit aircraft.',
  },
  {
    id: 'c_engineer', name: 'Technician', faction: 'covenant', category: 'infantry', tab: 'infantry', producer: 'barracks',
    cost: 500, buildTime: 8, hp: 70, armor: 'infantry', speed: 1.3, turnRate: 10, sight: 5, radius: 0.18,
    weapons: [], prereqs: ['c_barracks'], engineer: true, crushable: true, voice: 'engineer', deathExplosion: 'infantry',
    description: 'Captures enemy structures and repairs friendly ones. Unarmed.',
  },
  {
    id: 'raider', name: 'Raider Bike', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 550, buildTime: 8, hp: 180, armor: 'light', speed: 4.8, turnRate: 5.5, sight: 7.5, radius: 0.3,
    weapons: ['bikeRockets'], prereqs: ['c_factory'], voice: 'zealot', deathExplosion: 'small',
    description: 'Blisteringly fast attack bike with twin rocket pods. Hit and run.',
  },
  {
    id: 'scorpion', name: 'Scorpion Tank', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 650, buildTime: 10, hp: 360, armor: 'heavy', speed: 3.0, turnRate: 3.2, sight: 6.5, radius: 0.42,
    weapons: ['lightCannon'], prereqs: ['c_factory'], hasTurret: true, turretTurnRate: 4, crusher: true, voice: 'vehicle', deathExplosion: 'medium',
    description: 'Light, agile battle tank. Outmanoeuvres heavier armour.',
  },
  {
    id: 'inferno', name: 'Inferno Tank', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 800, buildTime: 12, hp: 420, armor: 'heavy', speed: 2.6, turnRate: 2.6, sight: 5.5, radius: 0.45,
    weapons: ['flameTank'], prereqs: ['c_factory', 'c_radar'], crusher: true, voice: 'zealot', deathExplosion: 'medium',
    description: 'Twin-nozzle flame tank. Turns infantry and bases into ash.',
  },
  {
    id: 'shade', name: 'Shade Stealth Tank', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 1000, buildTime: 14, hp: 280, armor: 'light', speed: 3.2, turnRate: 3, sight: 7, radius: 0.42,
    weapons: ['shadeRockets'], prereqs: ['c_factory', 'c_temple'], stealth: true, voice: 'vehicle', deathExplosion: 'medium', techLevel: 3,
    description: 'Cloaked rocket tank. Invisible to the enemy unless firing or adjacent.',
  },
  {
    id: 'prism', name: 'Rift Prism Tank', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 1300, buildTime: 18, hp: 750, armor: 'heavy', speed: 1.9, turnRate: 2, sight: 7, radius: 0.55,
    weapons: ['beamTank'], prereqs: ['c_factory', 'c_temple'], hasTurret: true, turretTurnRate: 2.5, crusher: true, voice: 'heavy', deathExplosion: 'large', techLevel: 3,
    description: 'Focuses raw Rift energy into a searing beam. Melts armour and buildings alike.',
  },
  {
    id: 'c_harvester', name: 'Harvester', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 1400, buildTime: 16, hp: 650, armor: 'heavy', speed: 1.9, turnRate: 2.4, sight: 4, radius: 0.55,
    weapons: [], prereqs: ['c_factory', 'c_refinery'], harvester: true, capacity: 700, crusher: true, voice: 'vehicle', deathExplosion: 'medium',
    description: 'Collects Riftite crystals and delivers them to a Refinery.',
  },
  {
    id: 'c_mcv', name: 'Mobile Construction Vehicle', faction: 'covenant', category: 'vehicle', tab: 'vehicles', producer: 'factory',
    cost: 3000, buildTime: 30, hp: 950, armor: 'heavy', speed: 1.4, turnRate: 1.7, sight: 5, radius: 0.65,
    weapons: [], prereqs: ['c_factory', 'c_repair'], mcv: true, crusher: true, voice: 'heavy', deathExplosion: 'large',
    description: 'Deploys into a Construction Yard, establishing a new base.',
  },
  {
    id: 'wraith', name: 'Wraith Gunship', faction: 'covenant', category: 'aircraft', tab: 'aircraft', producer: 'airfield',
    cost: 1100, buildTime: 15, hp: 240, armor: 'aircraft', speed: 6, turnRate: 3.4, sight: 8, radius: 0.5,
    weapons: ['wraithChaingun'], prereqs: ['c_airfield'], flying: true, ammo: 30, voice: 'pilot', deathExplosion: 'medium',
    description: 'Fast attack gunship with a rotary cannon. Rearms at the Airstrip.',
  },
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(list.map((u) => [u.id, u]));
export const UNIT_LIST = list;
