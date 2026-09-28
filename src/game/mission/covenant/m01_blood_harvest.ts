// COVENANT 01 — BLOOD HARVEST
// Raid mission, no base. Brother Kade's raiders hit the Coalition "reclamation" operation that
// strip-mines the sacred crystal fields of the Vale. Teaches controls; converts join at Saint Ilya;
// a Guardian column responds; destroy the harvesters, then the reclamation outpost.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { COLOR, COVENANT_CAST, CampaignScript, buildMap, layout, makeWorld, put, troops, type Pt } from '../common';

const CAMP: Pt = { x: 10, z: 62 };
const VILLAGE: Pt = { x: 26, z: 40 };
const OUTPOST: Pt = { x: 66, z: 16 };
const FIELDS: Pt[] = [{ x: 44, z: 22 }, { x: 58, z: 46 }, { x: 40, z: 58 }];

interface Refs {
  me: Player;
  aegis: Player;
  harvesters: Unit[];
  outpost: Building[];
  wardens: Unit[];
}

class BloodHarvest extends CampaignScript {
  r: Refs;
  liberated = false;
  columnSent = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, COVENANT_CAST);
    this.r = refs;
    this.checkpoints = [VILLAGE, FIELDS[0], FIELDS[1], FIELDS[2], OUTPOST];
  }

  harvLeft() {
    return this.alive(this.r.harvesters).length;
  }

  start() {
    const { me, aegis, harvesters } = this.r;
    this.host.alwaysRadar = true;
    this.allowOnly([]);
    this.loseWhenWiped('The raid has failed. The faithful are scattered.');
    this.objective('harvesters', `Burn the defilers' harvesters (${3 - this.harvLeft()}/3).`);
    for (const f of FIELDS) this.reveal(f.x, f.z, 4);
    harvesters.forEach((h, i) => this.beacon('harvesters:' + i, h, 'HARVESTER', '#ff6a4a'));
    this.dialogue([
      ['commander', 'Harbinger. The Coalition calls this place a quarantine zone. We call it the Vale of Saint Ilya, and it is holy.'],
      ['commander', 'Their machines tear the sacred crystal from the earth and burn it in their engines. It ends today.'],
      ['ally', 'Brother Kade, riding with you. Three harvesters in the fields, Harbinger. Our bikes are the fastest things in this valley.'],
      ['intel', 'Sister Lysandra. The Oracle sees their harvesters glowing in the fields. I have marked them for you.'],
    ], 1);
    this.hint(
      '<b>Welcome, Harbinger.</b> Left-click a unit to <b>select</b> it, or <b>drag a box</b> to select several.<br><b>Right-click</b> the ground to move, <b>right-click an enemy</b> to attack. Scroll with the <kbd>Arrow keys</kbd> or screen edges.',
    );
    this.after(30, () =>
      this.hint('<b>Raider Bikes</b> are fast and hit hard with rockets, but they are fragile. Strike, then pull back. Press <kbd>S</kbd> to stop, <kbd>Ctrl</kbd>+<kbd>1</kbd> to bind a group and <kbd>1</kbd> to recall it.', 18),
    );
    // keep the harvesters working (the Coalition side here has no commander AI)
    this.every(6, () => {
      for (const h of this.alive(harvesters)) if (h.order.type === 'idle') h.issue({ type: 'harvest' }, this.world);
    });

    this.on('unitDied', (e) => {
      if (!harvesters.includes(e.unit)) return;
      this.clearBeacon('harvesters:' + harvesters.indexOf(e.unit));
      const n = 3 - this.harvLeft();
      const o = this.host.objectives.find((x) => x.id === 'harvesters');
      if (o) {
        o.text = `Burn the defilers' harvesters (${n}/3).`;
        this.host.objectives = [...this.host.objectives];
      }
      if (n === 1) {
        this.dialogue([
          ['ally', 'One defiler burns! Praise the Rift!'],
          ['enemy', 'Reclamation Three, this is Hale. You have hostiles in the fields. Armour is on its way.'],
        ]);
        this.after(10, () => this.sendColumn(e.unit.x, e.unit.z));
      }
      if (n === 3) this.harvestersDone();
    });

    // Saint Ilya
    this.after(50, () => {
      this.say('Harbinger, Coalition wardens are rounding up the villagers of Saint Ilya for "decontamination". Free them.', 'intel');
      this.objective('ilya', 'Liberate the village of Saint Ilya.', true);
      this.when(() => !this.isOpen('ilya') || (this.host.beacons?.length ?? 0) < 3, () => {
        if (this.isOpen('ilya')) this.beacon('ilya', VILLAGE, 'SAINT ILYA', '#9fd8ff');
      });
      this.reveal(VILLAGE.x, VILLAGE.z, 5);
    });
    this.when(() => !this.liberated && this.alive(this.r.wardens).length === 0 && this.anyNear(me, VILLAGE.x, VILLAGE.z, 7), () => {
      this.liberated = true;
      this.objective('ilya', 'Liberate the village of Saint Ilya.', true);
      this.complete('ilya');
      this.spawn(me, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'seeker', 'seeker'], VILLAGE.x, VILLAGE.z + 2);
      this.dialogue([
        ['ally', 'The villagers are taking up the wardens\' rifles. They want to fight.'],
        ['commander', 'Then let them. Every soul the Coalition wrongs is a soul the Rift welcomes.'],
      ]);
      this.hint('<b>Seekers</b> carry anti-armour rockets. Use them against tanks while Raiders and Acolytes handle the rest.', 12);
    });

    this.on('buildingDied', (e) => {
      if (e.building.owner === aegis && e.building.def.id === 'a_refinery') this.say('Their refinery burns. The fields are free.', 'ally');
    });
    this.when(() => this.isComplete('harvesters') && this.alive(this.r.outpost).length === 0, () => {
      this.objective('outpost', 'Destroy the Coalition reclamation outpost.');
      this.complete('outpost');
      const t = this.dialogue([
        ['commander', 'The Vale is ours again. You have done well, Harbinger. The Rift is pleased with you.'],
        ['intel', 'The Oracle stirs. It shows me a forge in the desert, and a great fire. Your next trial.'],
      ], 1);
      this.after(t, () => this.victory());
    });
  }

  sendColumn(x: number, z: number) {
    if (this.columnSent) return;
    this.columnSent = true;
    const { aegis } = this.r;
    this.say('Coalition tanks from the north! Too heavy to fight head-on, Harbinger. Draw them away from the fields, then circle back.', 'ally');
    this.wave(aegis, ['guardian', 'guardian', 'guardian', 'rifleman', 'rifleman', 'rocketeer'], { x: 42, z: 3 }, { x, z });
    this.hunt(aegis, [this.me], 6);
    this.hint('<b>Guardian tanks</b> crush infantry and shrug off rifles. Hit them with <b>Seeker</b> rockets and <b>Raider</b> volleys from several sides, or simply outrun them.', 16);
  }

  harvestersDone() {
    const { me } = this.r;
    this.complete('harvesters');
    this.dialogue([
      ['commander', 'The defilers\' machines are ash. Now finish what they built. Their reclamation outpost stands to the north-east.'],
      ['ally', 'My brothers are on the way. Flame for their walls.'],
    ]);
    this.after(10, () => {
      this.objective('outpost', 'Destroy the Coalition reclamation outpost.');
      if (this.isOpen('outpost')) this.beacon('outpost', OUTPOST, 'RECLAMATION OUTPOST', '#ff6a4a');
      this.reveal(OUTPOST.x, OUTPOST.z, 9);
      this.reinforce(me, ['zealot', 'zealot', 'zealot', 'raider', 'raider'], 3, 44, CAMP.x + 10, CAMP.z - 14);
      this.hint('<b>Flame Zealots</b> set structures and infantry ablaze. Press <kbd>A</kbd> and click to <b>attack-move</b>: everything in the group advances and fights along the way.', 16);
    });
  }

  override cheatStep() {
    const { harvesters, wardens, outpost } = this.r;
    const mine = this.units(this.me);
    if (!this.liberated) {
      for (const w of wardens) if (!w.dead) this.world.kill(w, null);
      this.teleport(mine.slice(0, 3), VILLAGE.x, VILLAGE.z);
      return;
    }
    const h = this.alive(harvesters)[0];
    if (h) {
      this.world.kill(h, mine[0] ?? null);
      return;
    }
    for (const u of this.units(this.r.aegis)) this.world.kill(u, null);
    if (this.isComplete('harvesters') && this.t > 60) {
      const b = this.alive(outpost)[0];
      if (b) this.world.kill(b, null);
    }
  }
}

function create() {
  const seed = 4401;
  const map = buildMap(
    { id: 'cov01', name: 'Vale of Saint Ilya', description: '', w: 80, h: 72, seed, theater: 'temperate', players: 2, cliffs: 0.3, water: 0.12, trees: 0.7, ore: 0.2, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.clear(CAMP.x, CAMP.z, 6);
      e.clear(VILLAGE.x, VILLAGE.z, 6);
      e.clear(OUTPOST.x, OUTPOST.z, 9);
      for (const f of FIELDS) e.clear(f.x, f.z, 6, Terrain.Dirt, false);
      e.road([{ x: VILLAGE.x, z: VILLAGE.z }, { x: 36, z: 30 }, { x: FIELDS[0].x, z: FIELDS[0].z }, { x: 56, z: 18 }, { x: OUTPOST.x - 4, z: OUTPOST.z + 2 }]);
      e.road([{ x: OUTPOST.x, z: OUTPOST.z + 6 }, { x: FIELDS[1].x + 2, z: FIELDS[1].z }, { x: FIELDS[2].x, z: FIELDS[2].z }]);
      e.path([{ x: CAMP.x, z: CAMP.z }, { x: 16, z: 50 }, { x: VILLAGE.x, z: VILLAGE.z }], 3);
      e.path([{ x: CAMP.x + 3, z: CAMP.z }, { x: 26, z: 64 }, { x: FIELDS[2].x, z: FIELDS[2].z }], 3);
      e.path([{ x: 42, z: 3 }, { x: FIELDS[0].x, z: FIELDS[0].z }], 3);
      e.path([{ x: 3, z: 44 }, { x: 14, z: 48 }], 3);
      e.ore(FIELDS[0].x, FIELDS[0].z, 4.5, true);
      e.ore(FIELDS[1].x, FIELDS[1].z, 4.5);
      e.ore(FIELDS[2].x, FIELDS[2].z, 4.5);
      e.scatter(['fence', 'lamp', 'barrel', 'ruin'], VILLAGE.x, VILLAGE.z, 5.5, 12);
      e.scatter(['barrel', 'lamp'], OUTPOST.x, OUTPOST.z, 8, 8);
      e.scatter(['pine', 'tree', 'bush'], CAMP.x + 4, CAMP.z - 4, 4, 10, true);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Hand of Kade', faction: 'covenant', color: COLOR.covenant, team: 1, human: true },
    { name: 'Reclamation Corps', faction: 'aegis', color: COLOR.aegis, team: 2 },
  ], seed);
  const [neutral, me, aegis] = players;
  put(world, neutral, 'n_bunker', VILLAGE.x - 4, VILLAGE.z - 3);
  put(world, neutral, 'n_bunker', VILLAGE.x + 1, VILLAGE.z - 4);
  put(world, neutral, 'n_bunker', VILLAGE.x + 3, VILLAGE.z + 1);
  const outpost = layout(world, aegis, OUTPOST.x, OUTPOST.z, [
    ['a_refinery', -1, -3],
    ['a_power', 4, -4],
    ['a_power', 4, -1],
    ['a_barracks', -5, 0],
    ['a_tower', -5, 4],
    ['a_tower', 1, 4],
  ]);
  const harvesters = FIELDS.map((f) => troops(world, aegis, ['a_harvester'], f.x + 1, f.z + 1)[0]);
  troops(world, aegis, ['rifleman', 'rifleman', 'rifleman', 'rocketeer', 'guardian'], OUTPOST.x - 2, OUTPOST.z + 3);
  troops(world, aegis, ['rifleman', 'rifleman'], FIELDS[1].x, FIELDS[1].z - 3);
  const wardens = troops(world, aegis, ['rifleman', 'rifleman', 'rifleman', 'scout'], VILLAGE.x + 2, VILLAGE.z + 3);
  for (const w of wardens) w.tag = 'guard';
  troops(world, me, ['raider', 'raider', 'raider', 'raider'], CAMP.x + 2, CAMP.z - 2, -Math.PI / 4);
  troops(world, me, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot'], CAMP.x - 1, CAMP.z + 1, -Math.PI / 4);
  for (const h of harvesters) h.issue({ type: 'harvest', x: h.x, z: h.z }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new BloodHarvest(h, { me, aegis, harvesters, outpost, wardens }) };
}

export const covenant01: MissionDef = {
  id: 'covenant_01',
  faction: 'covenant',
  index: 1,
  name: 'Blood Harvest',
  codename: 'The First Trial',
  location: 'Vale of Saint Ilya, Serbian Riftlands',
  briefing: `Rise, Harbinger. The Prophet Azrael has seen your face in the Rift, and he has chosen you.

The Coalition calls the Riftite a resource. They cut it from the living earth, feed it to their engines, and call the villages that grow near it "contaminated". In the Vale of Saint Ilya, their reclamation teams are doing all of this at once.

Three of their harvesters gorge on the sacred fields. Brother Kade and his raiders will ride with you. Burn the machines. Then burn the outpost that feeds them.

Their tanks are heavy and slow. Your bikes are neither. Remember that.

Go with the Rift.`,
  objectives: ['Destroy the three Coalition harvesters.', 'Destroy the Coalition reclamation outpost.', 'Optional: liberate the village of Saint Ilya.'],
  music: 'tension',
  create,
};
