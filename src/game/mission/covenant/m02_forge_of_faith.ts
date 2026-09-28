// COVENANT 02 — FORGE OF FAITH
// Base building for the Covenant: deploy, power, refinery, Hand of the Covenant, Forge, Oracle Array.
// Twist: the Coalition attacks the pilgrims at the Well of Ashur; saving them brings converts and tithes.
// Goal: destroy Firebase Sentinel.

import type { Building } from '../../Building';
import { SkirmishAI } from '../../ai/SkirmishAI';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { COLOR, COVENANT_CAST, CampaignScript, buildMap, layout, makeWorld, put, troops, wallLine, type Pt } from '../common';

const HOME: Pt = { x: 16, z: 80 };
const ENEMY: Pt = { x: 80, z: 18 };
const WELL: Pt = { x: 50, z: 56 };
const DERRICKS: Pt[] = [{ x: 30, z: 52 }, { x: 64, z: 76 }];

interface Refs {
  me: Player;
  aegis: Player;
  rangers: Player;
  pilgrims: Player;
  shrines: Building[];
  militia: Unit[];
  derricks: Building[];
}

class ForgeOfFaith extends CampaignScript {
  r: Refs;
  deployed = false;
  raid: Unit[] = [];
  constructor(host: MissionHost, refs: Refs) {
    super(host, COVENANT_CAST);
    this.r = refs;
    this.checkpoints = [ENEMY, WELL, ...DERRICKS];
  }

  sentinel() {
    return this.buildings(this.r.aegis, (b) => !b.def.wall);
  }

  start() {
    const { me, aegis, rangers, pilgrims, shrines } = this.r;
    this.allowOnly(['c_power', 'c_refinery', 'c_barracks', 'c_factory', 'c_radar', 'c_turret', 'c_wall', 'acolyte', 'zealot', 'seeker', 'c_engineer', 'raider', 'scorpion', 'inferno', 'c_harvester'], 1);
    this.objective('forge', 'Deploy the MCV and raise the Forge: Rift Generator, Refinery and Forge.');
    this.dialogue([
      ['commander', 'Harbinger, the Sinai basin is soaked in Riftite. Here we will raise a forge worthy of the faith.'],
      ['intel', 'A Coalition firebase called Sentinel watches the basin from the north-east. Their guns cover every well and road.'],
      ['commander', 'Build. Grow strong. Then silence Sentinel.'],
    ], 1);
    this.hint('Select the <b>MCV</b> and press <kbd>D</kbd> to <b>deploy</b> it into a Construction Yard.');
    this.when(() => !this.deployed && !this.units(me).some((u) => !!u.def.mcv) && !me.has('c_yard'), () => this.defeat('The MCV was destroyed.'));
    this.when(() => this.deployed, () => this.loseWhenWiped('The Forge has fallen.'));
    this.on('deployed', (e) => {
      if (e.unit.owner !== me || this.deployed) return;
      this.deployed = true;
      this.hint('Build a <b>Rift Generator</b> from the <b>Structures</b> tab, then click near the yard to place it. Everything draws power: watch the power bar.');
    });
    this.when(() => me.has('c_power'), () => this.hint('Now a <b>Riftite Refinery</b>. It comes with a <b>Harvester</b> that gathers crystal on its own.'));
    this.when(() => me.has('c_refinery'), () =>
      this.hint('Build the <b>Hand of the Covenant</b> to train infantry, then the <b>Forge</b> for vehicles. An <b>Oracle Array</b> gives radar and unlocks the <b>Inferno</b> flame tank.', 18),
    );
    this.when(() => me.has('c_power') && me.has('c_refinery') && me.has('c_factory'), () => {
      this.complete('forge');
      this.dialogue([
        ['commander', 'The Forge burns. Now it will make war.'],
        ['intel', 'Scorpions are quick. Infernos will burn Sentinel\'s walls. Bring both.'],
      ]);
      this.objective('sentinel', 'Destroy Firebase Sentinel.');
      if (this.isOpen('sentinel')) this.beacon('sentinel', ENEMY, 'FIREBASE SENTINEL', '#ff6a4a');
      this.reveal(ENEMY.x, ENEMY.z, 8);
    });
    this.when(() => me.has('c_radar'), () => this.hint('<b>Oracle Array</b> online: you have <b>radar</b>. The <b>Inferno</b> tank is now available at the Forge.', 12));

    // derricks
    this.after(150, () => {
      this.objective('oil', 'Capture both oil derricks with Technicians.', true);
      for (const d of DERRICKS) this.reveal(d.x + 1, d.z + 1, 3);
      if (this.isOpen('oil')) this.r.derricks.forEach((d, i) => d.owner !== me && this.beacon('oil:' + i, d, 'OIL DERRICK', '#9fd8ff'));
      this.say('Two derricks lie in the basin. A Technician can bring them into the fold.', 'intel');
      this.hint('Train a <b>Technician</b>, select it and <b>right-click</b> an Oil Derrick to capture it for steady income.', 12);
    });
    this.on('captured', (e) => {
      const i = this.r.derricks.indexOf(e.building);
      if (i >= 0 && e.to === me) this.clearBeacon('oil:' + i);
    });
    this.when(() => this.r.derricks.every((d) => d.owner === me), () => {
      this.objective('oil', 'Capture both oil derricks with Technicians.', true);
      this.complete('oil');
    });

    // the pilgrims
    this.after(390, () => {
      this.dialogue([
        ['intel', 'Harbinger! Coalition rangers are moving on the Well of Ashur. Our pilgrims are camped there.'],
        ['enemy', 'All units, the pilgrim camp is a Covenant staging area. Clear it.'],
        ['commander', 'They are unarmed, Hale, and you know it. Harbinger, save them.'],
      ]);
      this.objective('well', 'Protect the pilgrims at the Well of Ashur.', true);
      this.beacon('well', WELL, 'WELL OF ASHUR', '#6aff8a');
      this.reveal(WELL.x, WELL.z, 7);
      this.raid = this.wave(rangers, ['guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'scout'], { x: 66, z: 30 }, WELL);
      this.hunt(rangers, [pilgrims, me], 5);
    });
    this.when(() => this.raid.length > 0 && this.alive(this.raid).length === 0 && this.alive(shrines).length > 0, () => {
      this.complete('well');
      me.credits += 1500;
      this.giveUnits(this.alive(this.r.militia), me);
      this.dialogue([
        ['intel', 'The pilgrims are safe. They offer a tithe of fifteen hundred credits, and their sons.'],
        ['commander', 'Accept both. Faith repays faith.'],
      ]);
    });
    this.when(() => this.raid.length > 0 && this.alive(shrines).length === 0, () => {
      this.fail('well');
      this.say('The Well of Ashur is ash. Remember this day, Harbinger. Remember who did it.', 'commander');
    });

    // victory
    this.when(() => this.isComplete('forge') && this.sentinel().length === 0, () => {
      this.complete('sentinel');
      const t = this.dialogue([
        ['intel', 'Sentinel is silent. The basin belongs to the faithful.'],
        ['commander', 'Well done. Now, a gift from our friend inside the Coalition: the location of their most precious secret.'],
      ], 1);
      this.after(t, () => this.victory());
    });
    this.when(() => !this.isComplete('forge') && this.sentinel().length === 0, () => {
      this.objective('sentinel', 'Destroy Firebase Sentinel.');
      this.complete('sentinel');
      this.complete('forge');
    });
    this.after(240, () => this.say('Another Covenant camp in my basin. Sentinel, stay sharp. They will come at night.', 'enemy'));
    this.on('buildingDied', (e) => {
      if (e.building.owner === aegis && e.building.def.id === 'a_yard') this.say('Sentinel\'s yard is burning. They cannot rebuild now.', 'intel');
    });
  }

  override cheatStep() {
    const me = this.me;
    const mcv = this.units(me, (u) => !!u.def.mcv)[0];
    if (!this.deployed && mcv) {
      if (mcv.order.type !== 'deploy') mcv.issue({ type: 'deploy' }, this.world);
      return;
    }
    const yard = this.buildings(me, (b) => b.def.id === 'c_yard')[0];
    if (!yard) return;
    for (const id of ['c_power', 'c_refinery', 'c_factory']) if (!me.has(id)) {
      try {
        put(this.world, me, id, yard.tx + (id === 'c_power' ? -3 : 4), yard.tz + 1, 8);
      } catch {
        /* retry */
      }
      return;
    }
    for (const d of this.r.derricks) if (d.owner !== me) this.transfer(d, me);
    const k = this.units(me)[0] ?? null;
    for (const u of this.alive(this.raid)) this.world.kill(u, k);
    if (this.t > 420) {
      const b = this.sentinel()[0];
      if (b) this.world.kill(b, null);
    }
  }
}

function create() {
  const seed = 6602;
  const map = buildMap(
    { id: 'cov02', name: 'Sinai Basin', description: '', w: 96, h: 96, seed, theater: 'desert', players: 2, cliffs: 0.4, water: 0.02, trees: 0.2, ore: 0.45, river: false, roads: true, layout: 'diagonal' },
    (e) => {
      e.clear(HOME.x, HOME.z, 11);
      e.clear(ENEMY.x, ENEMY.z, 12);
      e.clear(WELL.x, WELL.z, 6);
      e.blob(WELL.x + 1, WELL.z + 1, 1.2, Terrain.Water);
      for (const d of DERRICKS) e.clear(d.x + 1, d.z + 1, 3, Terrain.Dirt);
      e.road([{ x: HOME.x + 4, z: HOME.z - 4 }, { x: 32, z: 64 }, { x: WELL.x - 3, z: WELL.z + 2 }, { x: 60, z: 40 }, { x: ENEMY.x - 4, z: ENEMY.z + 6 }]);
      e.path([{ x: HOME.x, z: HOME.z - 8 }, { x: 18, z: 44 }, { x: 40, z: 26 }, { x: ENEMY.x - 8, z: ENEMY.z }], 3);
      e.path([{ x: HOME.x + 8, z: HOME.z }, { x: DERRICKS[1].x, z: DERRICKS[1].z + 1 }, { x: 84, z: 60 }, { x: ENEMY.x + 2, z: ENEMY.z + 8 }], 3);
      e.path([{ x: 32, z: 64 }, { x: DERRICKS[0].x + 1, z: DERRICKS[0].z + 1 }], 3);
      e.path([{ x: 66, z: 30 }, { x: 60, z: 40 }], 3);
      e.ore(28, 88, 4);
      e.ore(8, 64, 3.5);
      e.ore(WELL.x - 8, WELL.z - 8, 4, true);
      e.ore(68, 10, 4);
      e.ore(88, 36, 3.5);
      e.ore(44, 78, 3.5);
      e.scatter(['ruin', 'fence', 'lamp', 'barrel'], WELL.x, WELL.z, 5.5, 12);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'The Harbinger', faction: 'covenant', color: COLOR.covenant, team: 1, human: true, credits: 4000 },
    { name: 'Firebase Sentinel', faction: 'aegis', color: COLOR.aegis, team: 2, credits: 2500, techLimit: 1 },
    { name: 'Sentinel Rangers', faction: 'aegis', color: COLOR.aegis, team: 2 },
    { name: 'Pilgrims of Ashur', faction: 'covenant', color: COLOR.orange, team: 1 },
  ], seed);
  const [neutral, me, aegis, rangers, pilgrims] = players;
  const derricks = DERRICKS.map((d) => world.addBuilding(neutral, 'n_derrick', d.x, d.z));
  const shrines = [put(world, pilgrims, 'n_bunker', WELL.x - 4, WELL.z - 3), put(world, pilgrims, 'n_bunker', WELL.x + 3, WELL.z - 3), put(world, pilgrims, 'n_bunker', WELL.x - 1, WELL.z + 3)];
  const militia = troops(world, pilgrims, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot'], WELL.x, WELL.z - 1);
  for (const u of militia) u.tag = 'guard';
  layout(world, aegis, ENEMY.x, ENEMY.z, [
    ['a_yard', -1, -1],
    ['a_power', 4, -5],
    ['a_power', 4, -2],
    ['a_refinery', -7, -4],
    ['a_barracks', -5, 2],
    ['a_factory', 2, 2],
    ['a_tower', -8, 5],
    ['a_tower', -3, 7],
    ['a_turret', 1, 8],
  ]);
  wallLine(world, aegis, 'a_wall', ENEMY.x - 10, ENEMY.z + 1, ENEMY.x - 10, ENEMY.z + 5);
  troops(world, aegis, ['a_harvester'], ENEMY.x - 6, ENEMY.z + 2);
  troops(world, aegis, ['guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rocketeer'], ENEMY.x - 4, ENEMY.z + 6);
  for (const id of ['a_airfield', 'a_techlab', 'a_uplink', 'tempest', 'hawk', 'a_sam']) aegis.restricted.add(id);
  aegis.ai = new SkirmishAI(world, aegis, 'easy', { attackDelay: 480, aggression: 0.7, techLimit: 1, allowSuperweapons: false });
  troops(world, me, ['c_mcv'], HOME.x, HOME.z, -Math.PI / 4);
  troops(world, me, ['acolyte', 'acolyte', 'acolyte', 'seeker', 'raider'], HOME.x + 3, HOME.z - 4, -Math.PI / 4);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new ForgeOfFaith(h, { me, aegis, rangers, pilgrims, shrines, militia, derricks }) };
}

export const covenant02: MissionDef = {
  id: 'covenant_02',
  faction: 'covenant',
  index: 2,
  name: 'Forge of Faith',
  codename: 'The Second Trial',
  location: 'Sinai Rift Basin, Egypt',
  briefing: `The Vale remembers your name, Harbinger. Now the Prophet asks more of you.

In the Sinai basin the Riftite grows thick as desert grass. The faithful need a forge there: a base to build the war machines of the Covenant. You will carry the Mobile Construction Vehicle into the basin and raise it.

A Coalition firebase called Sentinel watches from the north-east. While it stands, no pilgrim road is safe and no refinery will run for long.

Build your strength. Power, crystal, soldiers, then the Forge itself. When you are ready, grind Sentinel into the sand.

Pilgrims gather at the Well of Ashur in the heart of the basin. They trust the Covenant to keep them safe.`,
  objectives: ['Deploy the MCV and raise the Forge.', 'Destroy Firebase Sentinel.', 'Optional: capture the oil derricks and protect the pilgrims.'],
  music: 'battle1',
  create,
};
