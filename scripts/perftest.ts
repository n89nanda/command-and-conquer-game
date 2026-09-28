import { createSkirmish } from '../src/game/Scenario';
const { world } = createSkirmish({ mapId: 'greenvalley', players: [
  { faction: 'aegis', colorIndex: 0, team: 1, human: true, difficulty: 'normal' },
  { faction: 'covenant', colorIndex: 1, team: 2, human: false, difficulty: 'normal' },
], credits: 5000, startUnits: 'base', shroud: true, gameSpeed: 1 });
const [, a, b] = world.players;
const cx = 48, cz = 48;
const A = ['guardian', 'titan', 'rifleman', 'rocketeer', 'tempest', 'scout', 'marksman'];
const B = ['scorpion', 'prism', 'acolyte', 'zealot', 'seeker', 'raider', 'inferno'];
for (let i = 0; i < 120; i++) {
  const p = world.map.nearestPassable(cx - 20 + (i % 10), cz - 6 + Math.floor(i / 10), 10)!;
  world.addUnit(a, A[i % A.length], p[0] + 0.5, p[1] + 0.5);
  const q = world.map.nearestPassable(cx + 20 - (i % 10), cz - 6 + Math.floor(i / 10), 10)!;
  world.addUnit(b, B[i % B.length], q[0] + 0.5, q[1] + 0.5);
}
for (const u of world.units) if (u.weapons.length && !u.def.harvester) u.issue({ type: 'move', x: u.owner === a ? cx + 20 : cx - 20, z: cz, attackMove: true }, world);
const dt = 1 / 30;
let worst = 0; const t0 = performance.now();
for (let i = 0; i < 30 * 60; i++) {
  const s = performance.now(); world.tick(dt); const e = performance.now() - s; if (e > worst) worst = e;
  if (i % 300 === 0) console.log('t', (i / 30).toFixed(0), 'units', world.units.length, 'proj', world.projectiles.length, 'A', world.units.filter(u => u.owner === a).length, 'B', world.units.filter(u => u.owner === b).length);
}
console.log('avg tick ms', ((performance.now() - t0) / 1800).toFixed(2), 'worst', worst.toFixed(1));
