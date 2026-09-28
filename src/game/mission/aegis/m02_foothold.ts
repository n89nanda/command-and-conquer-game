// AEGIS 02 — FOOTHOLD
// Base-building tutorial: deploy the MCV, power, refinery, barracks, war factory.
// Optional: capture oil derricks with engineers; intercept a Covenant MCV convoy.
// Goal: destroy the Covenant base at Vadu Crossing.

import type { Building } from '../../Building';
import { SkirmishAI } from '../../ai/SkirmishAI';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, put, troops, wallLine, type Pt } from '../common';

const HOME: Pt = { x: 16, z: 16 };
const ENEMY: Pt = { x: 78, z: 78 };
const CENTER: Pt = { x: 50, z: 46 };
const DERRICKS: Pt[] = [{ x: 30, z: 40 }, { x: 58, z: 20 }];
const CONVOY_FROM: Pt = { x: 92, z: 36 };

interface Refs {
  me: Player;
  cov: Player;
  raiders: Player;
  derricks: Building[];
}

class Foothold extends CampaignScript {
  r: Refs;
  mcvDeployed = false;
  convoy: Unit[] = [];
  constructor(host: MissionHost, refs: Refs) {
    super(host, AEGIS_CAST);
    this.r = refs;
    this.checkpoints = [ENEMY, CENTER, ...DERRICKS];
  }

  enemyStructures() {
    return this.world.buildings.filter((b) => !b.dead && (b.owner === this.r.cov || b.owner === this.r.raiders) && !b.def.wall);
  }

  start() {
    this.host.alwaysRadar = true; // radar isn't buildable yet in this operation

    const { me, cov, raiders } = this.r;
    this.allowOnly(['a_power', 'a_refinery', 'a_barracks', 'a_factory', 'a_tower', 'a_wall', 'a_turret', 'rifleman', 'rocketeer', 'a_engineer', 'scout', 'guardian', 'a_harvester'], 1);
    this.objective('base', 'Deploy the MCV and build a Fusion Reactor and a Riftite Refinery.');
    this.dialogue([
      ['commander', 'Commander, this valley is the only road into the Carpathian zone. I want a firebase on it by nightfall.'],
      ['intel', 'Riftite fields to the east and south of your drop point. Rich ones in the valley floor. Mind the glow; it bites.'],
      ['commander', 'Deploy the MCV. Power first, then a refinery. Money wins wars.'],
    ], 1);
    this.hint('Select the <b>MCV</b> (Mobile Construction Vehicle) and press <kbd>D</kbd> to <b>deploy</b> it into a Construction Yard. Pick open, flat ground.');

    // MCV lost before deploying = mission over
    this.when(() => !this.mcvDeployed && !this.units(me).some((u) => !!u.def.mcv) && !me.has('a_yard'), () => this.defeat('The MCV was destroyed.'));
    this.when(() => this.mcvDeployed, () => this.loseWhenWiped('Firebase Anvil has fallen.'));
    this.on('deployed', (e) => {
      if (e.unit.owner !== me || this.mcvDeployed) return;
      this.mcvDeployed = true;
      this.say('Construction Yard deployed. Firebase Anvil is live.', 'commander');
      this.hint('Open the <b>Structures</b> tab in the sidebar and click <b>Fusion Reactor</b>. When it says <i>Construction complete</i>, click the ground next to your yard to place it. Right-click a sidebar item to hold or cancel it.');
    });
    this.when(() => me.has('a_power'), () =>
      this.hint('Every structure draws <b>power</b> (bar in the sidebar). If demand exceeds supply, production slows and defences go dark.<br>Now build a <b>Riftite Refinery</b>. It comes with a free <b>Harvester</b>.'),
    );
    this.when(() => me.has('a_power') && me.has('a_refinery'), () => {
      this.complete('base');
      this.dialogue([
        ['intel', 'Harvester is rolling. It will gather Riftite and haul it home to the refinery automatically.'],
        ['commander', 'Good. Now give me soldiers. Barracks, then a War Factory.'],
      ]);
      this.hint('<b>Harvesters</b> work on their own. Protect them: no harvesters, no credits.<br>Build a <b>Barracks</b> to train infantry, then a <b>War Factory</b> for Guardian tanks. Click a unit icon several times to queue more.');
      this.after(8, () => {
        this.objective('destroy', 'Destroy the Covenant base at Vadu Crossing.');
        this.beacon('destroy', ENEMY, 'VADU CROSSING', '#ff6a4a');
        this.reveal(ENEMY.x, ENEMY.z, 7);
      });
    });
    this.when(() => me.has('a_barracks'), () =>
      this.after(4, () => this.hint('Tip: <b>Guard Towers</b> (Defence tab) shred infantry. <b>Field Engineers</b> capture structures: right-click an Oil Derrick with an Engineer selected for a steady income.', 16)),
    );
    this.when(() => me.has('a_factory'), () => {
      this.say('War Factory online. Guardians are yours to command.', 'commander');
      this.hint('<b>Guardian MBTs</b> are your backbone. Mass six or more, then <kbd>A</kbd> attack-move them together. Press <kbd>H</kbd> to jump back to your base and <kbd>Space</kbd> to jump to the latest alert.', 18);
    });
    this.when(() => this.mcvDeployed && me.lowPower && me.powerUsed > 0, () => this.hint('<b>Low power!</b> Build another <b>Fusion Reactor</b>. Production is slowed until supply exceeds demand.', 12));

    // derricks
    this.after(170, () => {
      this.objective('derricks', 'Capture the two oil derricks with Field Engineers.', true);
      for (const d of DERRICKS) this.reveal(d.x + 1, d.z + 1, 3);
      this.r.derricks.forEach((d, i) => {
        if (d.owner !== me) this.beacon('derricks:' + i, d, 'OIL DERRICK', '#9fd8ff');
      });
      this.say('Two oil derricks in the valley, abandoned when the Rift came. Put an engineer in each and they pay for themselves.', 'intel');
    });
    this.when(() => this.r.derricks.every((d) => d.owner === me), () => {
      this.objective('derricks', 'Capture the two oil derricks with Field Engineers.', true);
      this.complete('derricks');
    });
    this.on('captured', (e) => {
      const di = this.r.derricks.indexOf(e.building);
      if (di >= 0 && e.to === me) this.clearBeacon('derricks:' + di);
      if (e.to === cov && e.building.def.id === 'n_derrick') this.say('The Covenant took one of the derricks. Take it back.', 'intel');
    });

    // scripted raid on the harvester
    this.after(300, () => {
      const harv = this.units(me, (u) => !!u.def.harvester)[0];
      if (!harv) return;
      const us = this.spawn(raiders, ['raider', 'raider'], 60, 40);
      for (const u of us) {
        u.tag = 'hunter';
        u.issue({ type: 'attack', target: harv }, this.world);
      }
      this.say('Raider bikes heading for our harvester!', 'intel');
      this.hint('Your <b>Harvester</b> is under attack. Send units to protect it. Rocket Troopers and Guardians handle bikes well.', 12);
      this.hunt(raiders, [me], 6);
    });

    // the convoy: a Covenant MCV heading for the rich field
    this.after(420, () => {
      this.objective('convoy', 'Intercept the Covenant MCV before it deploys in the valley.', true);
      this.say('Commander, a Covenant MCV and escort just crossed the eastern ridge. They are heading for the rich field in the valley.', 'intel');
      this.say('If that MCV deploys we will have two bases to dig out. Stop it.', 'commander');
      this.convoy = this.spawn(raiders, ['c_mcv', 'scorpion', 'scorpion', 'acolyte', 'acolyte'], CONVOY_FROM.x, CONVOY_FROM.z);
      if (this.convoy[0]) this.beacon('convoy', this.convoy[0], 'COVENANT MCV', '#ff6a4a');
      for (const u of this.convoy) u.tag = 'hold';
      this.attackMove(this.convoy.filter((u) => !u.def.mcv), CENTER.x + 2, CENTER.z);
      this.convoy[0].issue({ type: 'move', x: CENTER.x, z: CENTER.z }, this.world);
      this.reveal(CONVOY_FROM.x - 4, CONVOY_FROM.z, 6);
    });
    this.when(() => this.convoy.length > 0 && this.convoy[0].dead && !this.world.buildings.some((b) => b.owner === raiders && b.def.produces === 'yard'), () => {
      this.complete('convoy');
      me.credits += 1500;
      this.say('MCV destroyed. Salvage crews recovered fifteen hundred credits of parts.', 'intel');
    });
    this.when(() => this.convoy.length > 0 && !this.convoy[0].dead && Math.hypot(this.convoy[0].x - CENTER.x, this.convoy[0].z - CENTER.z) < 1.5, () => {
      const mcv = this.convoy[0];
      if (this.world.deployMcv(mcv)) {
        this.fail('convoy');
        this.say('They deployed. A second Covenant base in the valley. Burn it out.', 'commander');
        this.after(6, () => {
          this.place(raiders, 'c_power', CENTER.x + 3, CENTER.z - 3);
          this.place(raiders, 'c_turret', CENTER.x - 3, CENTER.z - 2);
          this.place(raiders, 'c_turret', CENTER.x - 1, CENTER.z + 3);
        });
        for (const u of this.convoy) u.tag = '';
      } else mcv.issue({ type: 'move', x: CENTER.x + 1, z: CENTER.z + 1 }, this.world);
    });

    // victory
    this.when(() => this.isComplete('base') && this.enemyStructures().length === 0, () => {
      if (!this.host.objectives.some((o) => o.id === 'destroy')) this.objective('destroy', 'Destroy the Covenant base at Vadu Crossing.');
      this.complete('destroy');
      const t = this.dialogue([
        ['intel', 'Vadu Crossing is clear. The road into the zone is ours.'],
        ['commander', 'Outstanding, Commander. The Coalition finally has a foothold. Now we push.'],
      ], 1);
      this.after(t, () => this.victory());
    });
    this.on('buildingDied', (e) => {
      if (e.building.owner === cov && e.building.def.id === 'c_yard') this.say('You think a yard is the Covenant? We are a faith, Commander. Faith does not burn.', 'enemy');
    });
    this.after(200, () => this.say('A new commander in my valley. The Rift will teach you humility.', 'enemy'));
  }

  override cheatStep() {
    const me = this.me;
    const mcv = this.units(me, (u) => !!u.def.mcv)[0];
    if (!this.mcvDeployed && mcv) {
      if (mcv.order.type !== 'deploy') mcv.issue({ type: 'deploy' }, this.world);
      return;
    }
    const yard = this.buildings(me, (b) => b.def.id === 'a_yard')[0];
    if (!yard) return;
    for (const id of ['a_power', 'a_refinery', 'a_barracks', 'a_factory']) if (!me.has(id)) {
      try {
        put(this.world, me, id, yard.tx + (id === 'a_power' ? -3 : 4), yard.tz + (id === 'a_barracks' ? -3 : 1), 8);
      } catch {
        /* try later */
      }
      return;
    }
    for (const d of this.r.derricks) if (d.owner !== me) this.transfer(d, me);
    if (this.convoy.length && !this.convoy[0].dead) this.world.kill(this.convoy[0], null);
    if (this.t > 440) {
      const s = this.enemyStructures()[0];
      if (s) this.world.kill(s, null);
    }
  }
}

function create() {
  const seed = 3207;
  const map = buildMap(
    { id: 'aegis02', name: 'Vadu Crossing', description: '', w: 96, h: 96, seed, theater: 'temperate', players: 2, cliffs: 0.35, water: 0.18, trees: 0.55, ore: 0.4, river: false, roads: true, layout: 'diagonal' },
    (e) => {
      e.clear(HOME.x, HOME.z, 11);
      e.clear(ENEMY.x, ENEMY.z, 12);
      e.clear(CENTER.x, CENTER.z, 7, Terrain.Dirt, false);
      for (const d of DERRICKS) e.clear(d.x + 1, d.z + 1, 3, Terrain.Dirt);
      e.clear(40, 72, 5);
      e.road([{ x: HOME.x + 2, z: HOME.z + 4 }, { x: 30, z: 30 }, { x: CENTER.x, z: CENTER.z }, { x: 66, z: 64 }, { x: ENEMY.x - 3, z: ENEMY.z - 3 }]);
      e.path([{ x: HOME.x, z: HOME.z + 6 }, { x: 22, z: 50 }, { x: 40, z: 72 }, { x: 62, z: 82 }, { x: ENEMY.x - 4, z: ENEMY.z + 2 }], 3);
      e.path([{ x: CONVOY_FROM.x, z: CONVOY_FROM.z }, { x: 74, z: 40 }, { x: CENTER.x + 3, z: CENTER.z }], 3);
      e.path([{ x: 30, z: 30 }, { x: DERRICKS[0].x + 1, z: DERRICKS[0].z + 1 }], 3);
      e.path([{ x: HOME.x + 6, z: HOME.z }, { x: DERRICKS[1].x + 1, z: DERRICKS[1].z + 1 }, { x: 74, z: 40 }], 3);
      e.ore(30, 13, 4);
      e.ore(12, 31, 3.5);
      e.ore(CENTER.x, CENTER.z, 5, true);
      e.ore(66, 84, 4);
      e.ore(86, 62, 3.5);
      e.ore(46, 28, 3);
      e.ore(26, 62, 3);
      e.scatter(['ruin', 'fence', 'lamp', 'barrel'], 40, 72, 5, 10);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Firebase Anvil', faction: 'aegis', color: COLOR.aegis, team: 1, human: true, credits: 4000 },
    { name: 'Covenant of Vadu', faction: 'covenant', color: COLOR.covenant, team: 2, credits: 2500, techLimit: 1 },
    { name: 'Covenant Raiders', faction: 'covenant', color: COLOR.covenant, team: 2 },
  ], seed);
  const [neutral, me, cov, raiders] = players;
  const derricks = DERRICKS.map((d) => world.addBuilding(neutral, 'n_derrick', d.x, d.z));
  put(world, neutral, 'n_bunker', 38, 70);
  put(world, neutral, 'n_bunker', 42, 73);
  layout(world, cov, ENEMY.x, ENEMY.z, [
    ['c_yard', -1, -1],
    ['c_power', 4, -4],
    ['c_power', 4, -1],
    ['c_refinery', -6, 2],
    ['c_barracks', -5, -4],
    ['c_turret', -7, -6],
    ['c_turret', -3, -7],
  ]);
  wallLine(world, cov, 'c_wall', ENEMY.x - 8, ENEMY.z - 4, ENEMY.x - 8, ENEMY.z - 1);
  troops(world, cov, ['c_harvester'], ENEMY.x - 5, ENEMY.z + 6);
  troops(world, cov, ['acolyte', 'acolyte', 'acolyte', 'seeker', 'seeker', 'scorpion'], ENEMY.x - 4, ENEMY.z - 2);
  cov.restricted.add('c_obelisk');
  cov.ai = new SkirmishAI(world, cov, 'easy', { attackDelay: 480, aggression: 0.7, techLimit: 1, allowSuperweapons: false });
  troops(world, me, ['a_mcv'], HOME.x, HOME.z, 0.8);
  troops(world, me, ['rifleman', 'rifleman', 'rifleman', 'rocketeer', 'scout'], HOME.x + 3, HOME.z + 4, 0.8);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new Foothold(h, { me, cov, raiders, derricks }) };
}

export const aegis02: MissionDef = {
  id: 'aegis_02',
  faction: 'aegis',
  index: 2,
  name: 'Foothold',
  codename: 'Operation Anvil',
  location: 'Vadu Crossing, Dniester Valley',
  briefing: `The survivors of Kestrel told us two things. The Covenant is moving prisoners east along the Dniester valley. And they are building something they call "the Missile."

The valley road runs through Vadu Crossing, and the Covenant holds it. Nothing of ours gets into the zone while they do.

You are taking a Mobile Construction Vehicle and a light escort into the western end of the valley. Deploy it, build Firebase Anvil, and get your refinery running. Riftite fields surround your landing site.

When your forces are ready, destroy the Covenant base at Vadu Crossing.

Intelligence reports the Covenant is moving construction equipment through the region. Keep your eyes on the ridgelines.`,
  objectives: ['Deploy the MCV and establish Firebase Anvil.', 'Build a refinery and start harvesting Riftite.', 'Destroy the Covenant base at Vadu Crossing.'],
  music: 'battle1',
  create,
};
