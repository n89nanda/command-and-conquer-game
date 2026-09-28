import { FACTIONS, TEAM_COLORS } from '../data/factions';
import type { FactionId } from '../data/types';
import { resetEntityIds } from './Entity';
import { generateMap, SKIRMISH_MAPS, type MapSpec } from './MapGen';
import { Player } from './Player';
import { World } from './World';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export interface SkirmishPlayerSetup {
  faction: FactionId;
  colorIndex: number;
  team: number;
  human: boolean;
  difficulty: Difficulty;
  name?: string;
}

export interface SkirmishSetup {
  mapId: string;
  players: SkirmishPlayerSetup[];
  credits: number;
  startUnits: 'mcv' | 'base';
  shroud: boolean;
  gameSpeed: number;
  crates?: boolean;
}

export interface SkirmishResult {
  world: World;
  spec: MapSpec;
}

export const AI_NAMES = ['General Kessler', 'Commander Vex', 'Marshal Ortega', 'Prophet Azrael', 'Colonel Haldane', 'Overseer Nyx', 'Warlord Krane'];

export function createSkirmish(setup: SkirmishSetup): SkirmishResult {
  resetEntityIds();
  const spec = SKIRMISH_MAPS.find((m) => m.id === setup.mapId) ?? SKIRMISH_MAPS[0];
  const n = Math.min(setup.players.length, spec.players);
  const gen = generateMap(spec);
  const players: Player[] = [];
  const neutral = new Player(0, 'Civilians', 'aegis', 0xbbbbbb, -1, false, 0, true);
  players.push(neutral);
  const usedNames = new Set<string>();
  for (let i = 0; i < n; i++) {
    const s = setup.players[i];
    let name = s.name ?? (s.human ? 'Commander' : AI_NAMES[(i * 3 + spec.seed) % AI_NAMES.length]);
    while (usedNames.has(name)) name = AI_NAMES[(AI_NAMES.indexOf(name) + 1) % AI_NAMES.length];
    usedNames.add(name);
    const p = new Player(i + 1, name, s.faction, TEAM_COLORS[s.colorIndex % TEAM_COLORS.length], s.team, s.human, setup.credits);
    players.push(p);
  }
  const world = new World(gen.map, players, { seed: spec.seed, buildSpeed: 1 });
  // assign start positions (shuffle for variety, but keep human at a fixed spot for 2p)
  const starts = gen.starts.slice(0, n);
  const order = starts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const active = players.filter((p) => !p.isNeutral);
  active.forEach((p, i) => {
    const s = starts[order[i]];
    spawnStart(world, p, s.x, s.z, setup.startUnits);
  });
  for (const d of gen.derricks) world.addBuilding(neutral, 'n_derrick', d.x, d.z);
  for (const c of gen.civilians) world.addBuilding(neutral, 'n_bunker', c.x, c.z);
  if (!setup.shroud) for (const f of world.fogs.values()) f.revealAll = true;
  world.updateFog();
  return { world, spec };
}

export function spawnStart(world: World, p: Player, x: number, z: number, mode: 'mcv' | 'base') {
  const f = FACTIONS[p.faction];
  const inf = p.faction === 'aegis' ? 'rifleman' : 'acolyte';
  const at = p.faction === 'aegis' ? 'rocketeer' : 'seeker';
  const light = p.faction === 'aegis' ? 'scout' : 'raider';
  if (mode === 'base') {
    world.addBuilding(p, f.yard, Math.floor(x) - 1, Math.floor(z) - 1);
    world.addBuilding(p, p.faction === 'aegis' ? 'a_power' : 'c_power', Math.floor(x) + 3, Math.floor(z) - 1);
  } else {
    world.addUnit(p, f.mcv, x + 0.5, z + 0.5, Math.PI / 2);
  }
  const place = (id: string, dx: number, dz: number) => {
    const np = world.map.nearestPassable(x + dx, z + dz, 5);
    if (np) world.addUnit(p, id, np[0] + 0.5, np[1] + 0.5, Math.PI / 2);
  };
  place(inf, -2, 3);
  place(inf, -1, 3.5);
  place(inf, 0, 3);
  place(at, 1, 3.5);
  place(light, 3, 2);
  if (mode === 'base') place(f.harvester, 4, 4);
}
