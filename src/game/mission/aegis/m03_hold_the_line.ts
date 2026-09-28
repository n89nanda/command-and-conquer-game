// AEGIS 03 — HOLD THE LINE
// Defend the town of Havnvik and the Skyhook relay against timed Covenant waves until the
// evacuation completes, then counter-attack the staging base at Svartdal.
// Introduces radar, repairs, SAM sites vs Wraith gunships, Tempest artillery.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, put, troops, wallLine, type Pt } from '../common';

const BASE: Pt = { x: 48, z: 18 };
const RELAY: Pt = { x: 58, z: 12 };
const ENEMY: Pt = { x: 48, z: 82 };
const W: Pt = { x: 10, z: 62 };
const C: Pt = { x: 48, z: 64 };
const E: Pt = { x: 86, z: 60 };
const EVAC_TIME = 720;

interface Refs {
  me: Player;
  cov: Player;
  strike: Player;
  relay: Building;
}

class HoldTheLine extends CampaignScript {
  r: Refs;
  phase = 0;
  warned = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, AEGIS_CAST);
    this.r = refs;
    this.checkpoints = [ENEMY, W, C, E];
  }

  start() {
    const { me, strike, relay } = this.r;
    this.allowOnly(['a_power', 'a_refinery', 'a_barracks', 'a_factory', 'a_radar', 'a_repair', 'a_tower', 'a_turret', 'a_sam', 'a_wall', 'rifleman', 'rocketeer', 'a_engineer', 'scout', 'guardian', 'tempest', 'a_harvester'], 2);
    this.objective('relay', 'The Skyhook relay must survive.');
    this.objective('hold', 'Hold Havnvik until the evacuation is complete.');
    this.loseWhenWiped('Havnvik has fallen.');
    this.countdown('EVACUATION', EVAC_TIME, () => this.evacDone());
    this.dialogue([
      ['commander', 'Commander, the Covenant is marching on Havnvik. Four thousand civilians are still boarding the ships in the fjord.'],
      ['intel', 'The Skyhook relay on the hill is our only link to the northern fleet. If it falls, the convoy sails blind.'],
      ['commander', 'Twelve minutes. Hold the town, protect the relay. Nobody retreats.'],
    ], 1);
    this.after(8, () =>
      this.hint('Your <b>Comms Center</b> gives you <b>radar</b>: the minimap now shows the whole battlefield. Click it to jump there.<br>New: <b>Bastion Turrets</b>, <b>Skyguard SAMs</b> and <b>Tempest MLRS</b> artillery.', 16),
    );

    // relay loss
    this.when(() => relay.dead || relay.owner !== me, () => {
      this.fail('relay');
      this.defeat(relay.dead ? 'The Skyhook relay has been destroyed.' : 'The Covenant has captured the Skyhook relay.');
    });
    this.on('damaged', (e) => {
      if (e.entity === relay && relay.hp < relay.maxHp * 0.6 && !this.warned) {
        this.warned = true;
        this.say('The relay is taking heavy damage!', 'intel');
        this.hint('Press <kbd>R</kbd> (or the Repair button) and click a damaged structure to <b>repair</b> it. Repairs cost credits.', 12);
      }
    });

    const to = { x: BASE.x, z: BASE.z + 6 };
    this.hunt(strike, [me], 4);
    // ---- the waves
    this.after(60, () => {
      this.say('First contact, west pass. Infantry and bikes.', 'intel');
      this.wave(strike, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'raider', 'raider'], W, to);
      this.hint('Press <kbd>Space</kbd> to jump to the latest alert. Select a group and press <kbd>Ctrl</kbd>+<kbd>1</kbd>..<kbd>9</kbd> to bind it; tap the number to recall it.', 14);
    });
    this.after(150, () => {
      this.say('Scorpion tanks on the main road!', 'intel');
      this.wave(strike, ['scorpion', 'scorpion', 'scorpion', 'acolyte', 'acolyte', 'acolyte', 'acolyte'], C, to);
    });
    this.after(240, () => {
      const harv = this.units(me, (u) => !!u.def.harvester)[0];
      this.say('Raiders on the eastern ice. They are going for the harvester.', 'intel');
      const us = this.wave(strike, ['raider', 'raider', 'raider', 'seeker', 'seeker'], E, to);
      if (harv) for (const u of us.slice(0, 3)) u.issue({ type: 'attack', target: harv }, this.world);
    });
    this.after(320, () => {
      this.say('Aircraft! Wraith gunships inbound from the south.', 'intel');
      this.say('Skyguard SAM sites will handle them. Rocket troopers can hit aircraft too.', 'commander');
      this.wave(strike, ['wraith', 'wraith'], { x: C.x, z: C.z + 8 }, RELAY);
      this.wave(strike, ['scorpion', 'scorpion', 'scorpion'], W, to);
    });
    this.after(420, () => {
      this.dialogue([
        ['intel', 'Flame tanks, east flank. And... Technicians. They want the relay intact.'],
        ['enemy', 'Your precious relay will sing for the Rift, Commander.'],
        ['commander', 'Kill those Technicians before they reach the hill!'],
      ]);
      this.wave(strike, ['inferno', 'zealot', 'zealot', 'zealot', 'zealot'], E, RELAY);
      const tech = this.spawn(strike, ['c_engineer', 'c_engineer'], E.x - 2, E.z);
      for (const u of tech) {
        u.tag = 'hold';
        u.issue({ type: 'enter', target: relay }, this.world);
      }
    });
    this.after(510, () => {
      this.say('Major assault! Two columns, west and centre!', 'intel');
      this.wave(strike, ['scorpion', 'scorpion', 'inferno', 'acolyte', 'acolyte', 'acolyte', 'seeker'], W, to);
      this.wave(strike, ['scorpion', 'scorpion', 'inferno', 'acolyte', 'acolyte', 'acolyte', 'seeker'], C, to);
    });
    this.after(600, () => {
      this.say('More gunships, and bikes on the ice.', 'intel');
      this.wave(strike, ['wraith', 'wraith', 'wraith'], { x: E.x, z: E.z + 8 }, BASE);
      this.wave(strike, ['raider', 'raider', 'raider', 'raider'], E, to);
    });
    this.after(660, () => {
      this.dialogue([
        ['intel', 'This is everything they have left. Last push!'],
        ['enemy', 'Burn the town. Let the Rift take what the ships leave behind.'],
      ]);
      this.wave(strike, ['scorpion', 'scorpion', 'scorpion', 'scorpion', 'inferno', 'inferno', 'zealot', 'zealot', 'zealot'], C, to);
      this.wave(strike, ['seeker', 'seeker', 'seeker', 'acolyte', 'acolyte', 'acolyte'], W, to);
    });
    this.after(360, () => this.say('Halfway there. The first ships are clearing the fjord.', 'commander'));

    // victory
    this.when(() => this.phase === 1 && this.buildings(this.r.cov, (b) => !b.def.wall).length === 0, () => {
      this.complete('svartdal');
      this.complete('relay');
      const t = this.dialogue([
        ['commander', 'Svartdal is burning. Havnvik stands. Well fought, Commander.'],
        ['intel', 'General, the Skyhook caught something as the base went down. A transmission to a place in the desert. Tabernacle.'],
      ], 1);
      this.after(t, () => this.victory());
    });
  }

  evacDone() {
    const { me, cov } = this.r;
    this.complete('hold');
    this.stopCountdown();
    this.phase = 1;
    this.dialogue([
      ['commander', 'Last ship is out of the fjord. Four thousand people, Commander. Every one of them owes you.'],
      ['commander', 'Now let us return the favour. Their staging base is at Svartdal, south of the lake. Burn it.'],
      ['intel', 'Northern fleet is sending armour and two Tempest batteries. Use the rockets on their defences, from range.'],
    ], 1);
    this.objective('svartdal', 'Destroy the Covenant staging base at Svartdal.');
    this.reveal(ENEMY.x, ENEMY.z, 10);
    this.reinforce(me, ['guardian', 'guardian', 'guardian', 'tempest', 'tempest'], BASE.x - 14, 3, BASE.x - 6, BASE.z + 8);
    this.after(6, () => this.hint('<b>Tempest MLRS</b> out-range every defence. Park them behind your tanks and let them bombard. Keep them away from bikes.', 14));
    // the staging base keeps throwing counter-attacks while its Forge stands
    this.every(100, () => {
      const forge = this.buildings(cov, (b) => b.def.id === 'c_factory')[0];
      if (!forge || this.units(cov).length > 30) return;
      this.wave(cov, ['scorpion', 'scorpion', 'acolyte', 'acolyte', 'seeker'], { x: forge.x, z: forge.z + 2 }, { x: BASE.x, z: BASE.z + 6 });
    });
    this.hunt(cov, [me], 5);
    this.after(40, () => this.say('Their Forge keeps pushing out tanks. Knock it out and Svartdal is defenceless.', 'intel'));
  }

  override cheatStep() {
    const { strike, cov } = this.r;
    for (const u of this.units(strike)) this.world.kill(u, null);
    if (this.phase === 0) {
      this.skipCountdown(1);
      return;
    }
    const b = this.buildings(cov, (x) => !x.def.wall)[0];
    if (b) this.world.kill(b, null);
  }
}

function create() {
  const seed = 5303;
  const map = buildMap(
    { id: 'aegis03', name: 'Havnvik', description: '', w: 96, h: 96, seed, theater: 'winter', players: 2, cliffs: 0.45, water: 0.12, trees: 0.6, ore: 0.3, river: false, roads: true, layout: 'vertical' },
    (e) => {
      // fjord along the north edge
      e.blob(20, 3, 7, Terrain.Water);
      e.blob(78, 4, 8, Terrain.Water);
      e.clear(BASE.x, BASE.z, 13);
      e.clear(ENEMY.x, ENEMY.z, 12);
      e.clear(W.x + 4, W.z - 2, 4, Terrain.Dirt, false);
      e.clear(E.x - 4, E.z - 2, 4, Terrain.Dirt, false);
      // frozen lakes funnel the three approaches
      e.blob(30, 50, 7, Terrain.Water);
      e.blob(68, 48, 6, Terrain.Water);
      e.ridge([{ x: 16, z: 36 }, { x: 24, z: 40 }], 2.5);
      e.ridge([{ x: 76, z: 36 }, { x: 84, z: 38 }], 2.5);
      e.road([{ x: BASE.x, z: BASE.z + 8 }, { x: 48, z: 40 }, { x: C.x, z: C.z }, { x: ENEMY.x, z: ENEMY.z - 9 }]);
      e.path([{ x: W.x, z: W.z }, { x: 14, z: 48 }, { x: 28, z: 34 }, { x: BASE.x - 8, z: BASE.z + 8 }], 4);
      e.path([{ x: E.x, z: E.z }, { x: 86, z: 46 }, { x: 70, z: 34 }, { x: BASE.x + 9, z: BASE.z + 8 }], 4);
      e.path([{ x: W.x, z: W.z }, { x: 24, z: 74 }, { x: ENEMY.x - 8, z: ENEMY.z }], 3);
      e.path([{ x: E.x, z: E.z }, { x: 74, z: 74 }, { x: ENEMY.x + 8, z: ENEMY.z }], 3);
      e.ore(30, 14, 4);
      e.ore(68, 12, 3.5);
      e.ore(48, 52, 4, true);
      e.ore(36, 84, 4);
      e.ore(62, 86, 3.5);
      e.scatter(['lamp', 'fence', 'barrel'], 42, 30, 7, 14);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Havnvik Garrison', faction: 'aegis', color: COLOR.aegis, team: 1, human: true, credits: 3000 },
    { name: 'Svartdal Host', faction: 'covenant', color: COLOR.covenant, team: 2 },
    { name: 'Covenant Vanguard', faction: 'covenant', color: COLOR.covenant, team: 2 },
  ], seed);
  const [neutral, me, cov, strike] = players;
  // Havnvik town
  for (const [x, z] of [[34, 26], [38, 31], [60, 31], [64, 27], [30, 20], [44, 34]] as [number, number][]) put(world, neutral, 'n_bunker', x, z);
  const base = layout(world, me, BASE.x, BASE.z, [
    ['a_yard', -1, -5],
    ['a_power', -6, -6],
    ['a_power', -6, -3],
    ['a_refinery', -12, -3],
    ['a_barracks', 4, -6],
    ['a_factory', 3, -2],
    ['a_radar', 9, -7],
    ['a_tower', -5, 4],
    ['a_tower', 1, 5],
    ['a_tower', 10, 3],
    ['a_turret', 6, 6],
  ]);
  const relay = base[6];
  relay.maxHp = relay.hp = 2000;
  troops(world, me, ['a_harvester'], BASE.x - 12, BASE.z + 2);
  troops(world, me, ['guardian', 'guardian', 'guardian', 'guardian'], BASE.x, BASE.z + 7, Math.PI / 2);
  troops(world, me, ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'rocketeer', 'scout'], BASE.x - 4, BASE.z + 8, Math.PI / 2);
  layout(world, cov, ENEMY.x, ENEMY.z, [
    ['c_yard', -1, -1],
    ['c_power', -6, -3],
    ['c_power', -6, 0],
    ['c_power', 4, 3],
    ['c_refinery', 4, -3],
    ['c_barracks', -4, 4],
    ['c_factory', 0, 4],
    ['c_radar', -9, 3],
    ['c_turret', -4, -7],
    ['c_turret', 3, -7],
    ['c_obelisk', 0, -6],
    ['c_flak', -2, 9],
  ]);
  wallLine(world, cov, 'c_wall', ENEMY.x - 6, ENEMY.z - 8, ENEMY.x - 2, ENEMY.z - 8);
  wallLine(world, cov, 'c_wall', ENEMY.x + 2, ENEMY.z - 8, ENEMY.x + 6, ENEMY.z - 8);
  troops(world, cov, ['c_harvester'], ENEMY.x + 6, ENEMY.z + 1);
  troops(world, cov, ['scorpion', 'scorpion', 'scorpion', 'acolyte', 'acolyte', 'acolyte', 'seeker', 'seeker', 'zealot', 'zealot', 'inferno'], ENEMY.x, ENEMY.z - 4);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new HoldTheLine(h, { me, cov, strike, relay }) };
}

export const aegis03: MissionDef = {
  id: 'aegis_03',
  faction: 'aegis',
  index: 3,
  name: 'Hold the Line',
  codename: 'Operation Northern Wall',
  location: 'Havnvik, Norwegian Highlands',
  briefing: `Havnvik is a fishing town at the mouth of a frozen fjord. Today it is the most important place in the north.

The Skyhook relay on the hill above the town is our only link to the northern fleet. Behind it, four thousand refugees from the Riftlands are boarding evacuation ships.

A Covenant host is massing at Svartdal, south of the lakes. They will come through the three passes: the west ridge, the main road and the eastern ice. They will come with bikes, tanks, flamers, and gunships.

You have the Havnvik garrison and a working base. Radar is online. Build defences, keep your harvester alive and repair what burns.

Hold for twelve minutes. Then we take the fight to Svartdal.`,
  objectives: ['The Skyhook relay must survive.', 'Hold Havnvik for 12 minutes until the evacuation is complete.', 'Destroy the Covenant staging base at Svartdal.'],
  music: 'battle2',
  create,
};
