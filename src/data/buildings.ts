import type { BuildingDef, SuperweaponDef, SuperweaponId } from './types';

const list: BuildingDef[] = [
  // ============================ AEGIS COALITION ============================
  {
    id: 'a_yard', name: 'Construction Yard', faction: 'aegis', tab: 'structures', cost: 3000, buildTime: 30, hp: 2000,
    footprint: [3, 3], power: 10, sight: 6, prereqs: ['__never'], produces: 'yard', buildRadius: 8,
    description: 'The heart of your base. Constructs all other structures.',
  },
  {
    id: 'a_power', name: 'Fusion Reactor', faction: 'aegis', tab: 'structures', cost: 300, buildTime: 7, hp: 700,
    footprint: [2, 2], power: 100, sight: 4, prereqs: ['a_yard'], buildRadius: 4,
    description: 'Generates power for your base. Low power slows production and disables defences.',
  },
  {
    id: 'a_refinery', name: 'Riftite Refinery', faction: 'aegis', tab: 'structures', cost: 2000, buildTime: 18, hp: 1100,
    footprint: [3, 3], power: -30, sight: 5, prereqs: ['a_power'], refinery: true, freeUnit: 'a_harvester', buildRadius: 5,
    description: 'Processes Riftite into credits. Comes with a free Harvester.',
  },
  {
    id: 'a_barracks', name: 'Barracks', faction: 'aegis', tab: 'structures', cost: 400, buildTime: 8, hp: 800,
    footprint: [2, 2], power: -20, sight: 5, prereqs: ['a_power'], produces: 'barracks', buildRadius: 4,
    description: 'Trains Coalition infantry.',
  },
  {
    id: 'a_factory', name: 'War Factory', faction: 'aegis', tab: 'structures', cost: 2000, buildTime: 20, hp: 1500,
    footprint: [3, 3], power: -40, sight: 5, prereqs: ['a_refinery'], produces: 'factory', buildRadius: 5,
    description: 'Assembles Coalition ground vehicles.',
  },
  {
    id: 'a_radar', name: 'Comms Center', faction: 'aegis', tab: 'structures', cost: 1000, buildTime: 12, hp: 1000,
    footprint: [2, 2], power: -40, sight: 10, prereqs: ['a_refinery'], radar: true, buildRadius: 4,
    description: 'Provides tactical radar. Unlocks advanced units.',
  },
  {
    id: 'a_repair', name: 'Service Depot', faction: 'aegis', tab: 'structures', cost: 1200, buildTime: 12, hp: 900,
    footprint: [3, 3], power: -30, sight: 4, prereqs: ['a_factory'], repairPad: true, buildRadius: 4,
    description: 'Repairs vehicles parked on its pad.',
  },
  {
    id: 'a_airfield', name: 'Airfield', faction: 'aegis', tab: 'structures', cost: 1500, buildTime: 15, hp: 900,
    footprint: [3, 3], power: -30, sight: 5, prereqs: ['a_radar'], produces: 'airfield', buildRadius: 4,
    description: 'Builds and rearms Hawk VTOL aircraft.',
  },
  {
    id: 'a_techlab', name: 'Tech Center', faction: 'aegis', tab: 'structures', cost: 1500, buildTime: 18, hp: 1000,
    footprint: [3, 2], power: -100, sight: 5, prereqs: ['a_radar', 'a_factory'], buildRadius: 4, techLevel: 3,
    description: 'Unlocks the most advanced Coalition technology.',
  },
  {
    id: 'a_uplink', name: 'Ion Uplink', faction: 'aegis', tab: 'structures', cost: 3000, buildTime: 40, hp: 1400,
    footprint: [3, 3], power: -200, sight: 5, prereqs: ['a_techlab'], superweapon: 'ionStrike', buildRadius: 4, techLevel: 4,
    description: 'Commands an orbital ion cannon. Obliterates anything at the target location.',
  },
  {
    id: 'a_tower', name: 'Guard Tower', faction: 'aegis', tab: 'defense', cost: 500, buildTime: 6, hp: 500,
    footprint: [1, 1], power: -10, sight: 7, prereqs: ['a_barracks'], weapons: ['towerMg'], hasTurret: true, turretTurnRate: 6, buildRadius: 2,
    description: 'Machine gun emplacement. Shreds infantry.',
  },
  {
    id: 'a_turret', name: 'Bastion Turret', faction: 'aegis', tab: 'defense', cost: 800, buildTime: 10, hp: 800,
    footprint: [1, 1], power: -30, sight: 7, prereqs: ['a_factory'], weapons: ['turretCannon'], hasTurret: true, turretTurnRate: 3, buildRadius: 2,
    description: 'Armoured cannon turret. Stops tank assaults cold.',
  },
  {
    id: 'a_sam', name: 'Skyguard SAM', faction: 'aegis', tab: 'defense', cost: 700, buildTime: 9, hp: 600,
    footprint: [1, 1], power: -30, sight: 9, prereqs: ['a_radar'], weapons: ['samMissile'], hasTurret: true, turretTurnRate: 5, buildRadius: 2, needsPower: true,
    description: 'Surface-to-air missile launcher. Requires power.',
  },
  {
    id: 'a_railtower', name: 'Rail Spire', faction: 'aegis', tab: 'defense', cost: 1400, buildTime: 16, hp: 900,
    footprint: [1, 1], power: -80, sight: 9, prereqs: ['a_techlab'], weapons: ['railTower'], hasTurret: true, turretTurnRate: 2.5, buildRadius: 2, needsPower: true, techLevel: 3,
    description: 'Electromagnetic rail cannon. Punches through any armour. Requires power.',
  },
  {
    id: 'a_wall', name: 'Concrete Wall', faction: 'aegis', tab: 'defense', cost: 50, buildTime: 1.5, hp: 600,
    footprint: [1, 1], power: 0, sight: 1, prereqs: ['a_barracks'], wall: true, buildRadius: 2,
    description: 'Blocks enemy movement.',
  },

  // ============================ RIFT COVENANT ============================
  {
    id: 'c_yard', name: 'Construction Yard', faction: 'covenant', tab: 'structures', cost: 3000, buildTime: 30, hp: 1900,
    footprint: [3, 3], power: 10, sight: 6, prereqs: ['__never'], produces: 'yard', buildRadius: 8,
    description: 'The heart of your base. Constructs all other structures.',
  },
  {
    id: 'c_power', name: 'Rift Generator', faction: 'covenant', tab: 'structures', cost: 300, buildTime: 7, hp: 650,
    footprint: [2, 2], power: 100, sight: 4, prereqs: ['c_yard'], buildRadius: 4,
    description: 'Draws power from Rift energy. Low power slows production and disables defences.',
  },
  {
    id: 'c_refinery', name: 'Riftite Refinery', faction: 'covenant', tab: 'structures', cost: 2000, buildTime: 18, hp: 1000,
    footprint: [3, 3], power: -30, sight: 5, prereqs: ['c_power'], refinery: true, freeUnit: 'c_harvester', buildRadius: 5,
    description: 'Processes Riftite into credits. Comes with a free Harvester.',
  },
  {
    id: 'c_barracks', name: 'Hand of the Covenant', faction: 'covenant', tab: 'structures', cost: 400, buildTime: 8, hp: 850,
    footprint: [2, 2], power: -20, sight: 5, prereqs: ['c_power'], produces: 'barracks', buildRadius: 4,
    description: 'Trains Covenant infantry.',
  },
  {
    id: 'c_factory', name: 'Forge', faction: 'covenant', tab: 'structures', cost: 2000, buildTime: 20, hp: 1400,
    footprint: [3, 3], power: -40, sight: 5, prereqs: ['c_refinery'], produces: 'factory', buildRadius: 5,
    description: 'Forges Covenant war machines.',
  },
  {
    id: 'c_radar', name: 'Oracle Array', faction: 'covenant', tab: 'structures', cost: 1000, buildTime: 12, hp: 950,
    footprint: [2, 2], power: -40, sight: 10, prereqs: ['c_refinery'], radar: true, buildRadius: 4,
    description: 'Provides tactical radar. Unlocks advanced units.',
  },
  {
    id: 'c_repair', name: 'Reclamation Bay', faction: 'covenant', tab: 'structures', cost: 1200, buildTime: 12, hp: 850,
    footprint: [3, 3], power: -30, sight: 4, prereqs: ['c_factory'], repairPad: true, buildRadius: 4,
    description: 'Repairs vehicles parked on its pad.',
  },
  {
    id: 'c_airfield', name: 'Airstrip', faction: 'covenant', tab: 'structures', cost: 1500, buildTime: 15, hp: 850,
    footprint: [3, 3], power: -30, sight: 5, prereqs: ['c_radar'], produces: 'airfield', buildRadius: 4,
    description: 'Builds and rearms Wraith gunships.',
  },
  {
    id: 'c_temple', name: 'Temple of the Rift', faction: 'covenant', tab: 'structures', cost: 1500, buildTime: 18, hp: 1100,
    footprint: [3, 3], power: -100, sight: 5, prereqs: ['c_radar', 'c_factory'], buildRadius: 4, techLevel: 3,
    description: 'Sacred ground of the Covenant. Unlocks forbidden technology.',
  },
  {
    id: 'c_silo', name: 'Rift Missile Silo', faction: 'covenant', tab: 'structures', cost: 3000, buildTime: 40, hp: 1300,
    footprint: [3, 3], power: -200, sight: 5, prereqs: ['c_temple'], superweapon: 'riftMissile', buildRadius: 4, techLevel: 4,
    description: 'Launches a Riftite-laced ballistic missile. Annihilates everything in the blast.',
  },
  {
    id: 'c_turret', name: 'Stinger Turret', faction: 'covenant', tab: 'defense', cost: 600, buildTime: 8, hp: 600,
    footprint: [1, 1], power: -20, sight: 7, prereqs: ['c_barracks'], weapons: ['turretCannon'], hasTurret: true, turretTurnRate: 4, buildRadius: 2,
    description: 'Pop-up cannon turret. Effective against vehicles.',
  },
  {
    id: 'c_flak', name: 'Flak Cannon', faction: 'covenant', tab: 'defense', cost: 600, buildTime: 8, hp: 550,
    footprint: [1, 1], power: -20, sight: 9, prereqs: ['c_radar'], weapons: ['aaGun'], hasTurret: true, turretTurnRate: 6, buildRadius: 2,
    description: 'Rapid-fire anti-aircraft battery.',
  },
  {
    id: 'c_obelisk', name: 'Obelisk of the Rift', faction: 'covenant', tab: 'defense', cost: 1500, buildTime: 16, hp: 800,
    footprint: [1, 1], power: -120, sight: 9, prereqs: ['c_radar'], weapons: ['obeliskBeam'], buildRadius: 2, needsPower: true, techLevel: 2,
    description: 'Charges and fires a devastating Rift beam. Requires large amounts of power.',
  },
  {
    id: 'c_wall', name: 'Rift Barrier', faction: 'covenant', tab: 'defense', cost: 50, buildTime: 1.5, hp: 550,
    footprint: [1, 1], power: 0, sight: 1, prereqs: ['c_barracks'], wall: true, buildRadius: 2,
    description: 'Blocks enemy movement.',
  },

  // ============================ NEUTRAL ============================
  {
    id: 'n_derrick', name: 'Oil Derrick', faction: 'both', tab: 'structures', cost: 0, buildTime: 1, hp: 600,
    footprint: [2, 2], power: 0, sight: 3, prereqs: ['__never'], buildRadius: 0,
    description: 'Capture with an Engineer to receive a steady stream of credits.',
  },
  {
    id: 'n_bunker', name: 'Civilian Building', faction: 'both', tab: 'structures', cost: 0, buildTime: 1, hp: 500,
    footprint: [2, 2], power: 0, sight: 2, prereqs: ['__never'], buildRadius: 0,
    description: 'A civilian structure.',
  },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(list.map((b) => [b.id, b]));
export const BUILDING_LIST = list;

export const SUPERWEAPONS: Record<SuperweaponId, SuperweaponDef> = {
  ionStrike: {
    id: 'ionStrike', name: 'Ion Strike', chargeTime: 300, damage: 2400, radius: 3.5,
    readyLine: 'Ion cannon ready.', launchLine: 'Ion cannon activated.', detectedLine: 'Warning. Enemy ion cannon detected.',
  },
  riftMissile: {
    id: 'riftMissile', name: 'Rift Missile', chargeTime: 330, damage: 2800, radius: 4.5,
    readyLine: 'Rift missile ready.', launchLine: 'Rift missile launched.', detectedLine: 'Warning. Nuclear missile launch detected.',
  },
};
