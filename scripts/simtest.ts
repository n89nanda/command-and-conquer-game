import { createSkirmish } from '../src/game/Scenario';
const t0 = performance.now();
const { world } = createSkirmish({ mapId: 'greenvalley', players: [
  { faction: 'aegis', colorIndex: 0, team: 1, human: true, difficulty: 'normal' },
  { faction: 'covenant', colorIndex: 1, team: 2, human: false, difficulty: 'normal' },
], credits: 5000, startUnits: 'mcv', shroud: true, gameSpeed: 1 });
console.log('gen ms', (performance.now() - t0).toFixed(0), 'units', world.units.length, 'buildings', world.buildings.length, 'ore', world.map.totalOre());
// deploy MCVs
for (const u of world.units) if (u.def.mcv) u.issue({ type: 'deploy' }, world);
const dt = 1 / 30;
for (let i = 0; i < 30; i++) world.tick(dt);
console.log('buildings after deploy', world.buildings.map(b => b.def.id + ':' + b.owner.name).join(','));
const p = world.players[1];
// build power, refinery
const steps: string[] = ['a_power', 'a_refinery', 'a_barracks', 'a_factory'];
let built = 0;
const t1 = performance.now();
for (let i = 0; i < 30 * 240; i++) {
  const q = p.queues.structures;
  if (q.ready) {
    const yard = world.buildings.find(b => b.owner === p && b.def.id === 'a_yard')!;
    // find placement spot
    let placed = false;
    for (let r = 3; r < 10 && !placed; r++) for (let dz = -r; dz <= r && !placed; dz++) for (let dx = -r; dx <= r && !placed; dx++) {
      if (world.canPlace(p, q.ready, yard.tx + dx, yard.tz + dz)) { world.placeBuilding(p, q.ready, yard.tx + dx, yard.tz + dz); placed = true; built++; }
    }
  } else if (q.items.length === 0 && built < steps.length) p.enqueue(steps[built], world);
  if (built >= 4 && p.queues.vehicles.items.length === 0) p.enqueue('guardian', world);
  world.tick(dt);
}
console.log('sim 240s ms', (performance.now() - t1).toFixed(0));
console.log('credits', p.credits.toFixed(0), 'harvested', p.stats.creditsHarvested, 'units', world.units.filter(u => u.owner === p).map(u => u.def.id).join(','));
console.log('buildings', world.buildings.filter(b => b.owner === p).map(b => b.def.id).join(','), 'power', p.powerProduced, p.powerUsed);
const h = world.units.find(u => u.owner === p && u.def.harvester);
console.log('harv', h?.harvState, h?.cargo, h?.x.toFixed(1), h?.z.toFixed(1));
const r = world.buildings.find(b => b.owner === p && b.def.refinery)!;
console.log('ref', r.tx, r.tz, 'dock', r.dockPoint(), 'passable', world.map.passable(Math.floor(r.dockPoint().x), Math.floor(r.dockPoint().z)));
console.log('harv path', h?.path, h?.needsPath, h?.pathIdx, 'docked', r.docked?.id, 'h', h?.id);
for (const b of world.buildings.filter(b => b.owner === p)) console.log(b.def.id, b.tx, b.tz, b.w, b.h);
