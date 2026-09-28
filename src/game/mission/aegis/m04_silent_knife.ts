// AEGIS 04 — SILENT KNIFE
// Commando infiltration, no base. Captain Okafor's Ghost team must black out the compound's
// Rift Generators (which silences the Obelisks), capture the Oracle Array with an engineer,
// optionally free prisoners, then reach extraction before the window closes.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, put, scaleHp, troops, wallLine, type Pt } from '../common';

const LZ: Pt = { x: 8, z: 72 };
const GEN: Pt = { x: 20, z: 15 };
const COMPOUND: Pt = { x: 52, z: 26 };
const STOCKADE: Pt = { x: 63, z: 33 };
const EVAC: Pt = { x: 73, z: 71 };

interface Refs {
  me: Player;
  cov: Player;
  hunters: Player;
  okafor: Unit;
  generators: Building[];
  array: Building;
  stockadeGuards: Unit[];
  patrols: { units: Unit[]; route: Pt[] }[];
}

class SilentKnife extends CampaignScript {
  r: Refs;
  captured = false;
  freed = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, AEGIS_CAST);
    this.r = refs;
    this.checkpoints = [GEN, COMPOUND, STOCKADE, EVAC];
  }

  engineers() {
    return this.units(this.me, (u) => !!u.def.engineer);
  }

  start() {
    const { me, cov, okafor, array } = this.r;
    this.host.alwaysRadar = true;
    this.allowOnly([]);
    for (const p of this.r.patrols) this.patrol(p.units, p.route, 5);
    this.objective('okafor', 'Captain Okafor must survive.');
    this.objective('power', 'Black out the compound: destroy the Rift Generators west of the walls.');
    this.reveal(GEN.x, GEN.z, 6);
    this.reveal(COMPOUND.x, COMPOUND.z, 5);
    this.dialogue([
      ['commander', 'Captain, you are inside the wire. Site Tabernacle is two kilometres north-east of your position.'],
      ['intel', 'The compound is ringed by Obelisks of the Rift. Nothing we have survives a direct approach.'],
      ['intel', 'But Obelisks are hungry. They drink power from a generator yard outside the western wall. Starve them.'],
      ['ally', 'Ghosts, rail rifles up. We go quiet, we go slow.'],
    ], 1);
    this.after(4, () =>
      this.hint('<b>Ghost Marksmen</b> fire a rail rifle further than Covenant infantry can see. Stop at the edge of vision and let them pick targets.<br><b>Rocket Troopers</b> are your only demolition. Keep the <b>Engineers</b> at the back: you need one alive to capture the Oracle Array.', 22),
    );

    // failure states
    this.when(() => okafor.dead, () => {
      this.fail('okafor');
      this.defeat('Captain Okafor is down.');
    });
    this.when(() => !this.captured && this.engineers().length === 0, () => {
      this.fail('array');
      this.defeat('Without an engineer the Oracle Array cannot be taken.');
    });
    this.loseWhenWiped('The Ghost team has been lost.');

    // generators
    this.when(() => this.anyNear(me, GEN.x, GEN.z, 11), () => this.say('Generator yard in sight. Four Rift Generators, lightly guarded.', 'ally'));
    this.when(() => cov.lowPower || this.alive(this.r.generators).length <= 3, () => this.blackout());
    this.when(() => this.r.generators.some((g) => g.hp < g.maxHp * 0.9), () => this.say('The grid is running at its limit. Knock out one generator and the whole thing browns out.', 'intel'));

    // stockade
    this.after(90, () => {
      this.say('Captain, thermal shows people in a pen on the east side of the compound. Could be Recon Team Hammer. They went missing in March.', 'intel');
      this.objective('hammer', 'Free the prisoners held in the stockade.', true);
      this.reveal(STOCKADE.x, STOCKADE.z, 3);
    });
    this.when(() => !this.freed && this.alive(this.r.stockadeGuards).length === 0 && this.anyNear(me, STOCKADE.x, STOCKADE.z, 4), () => {
      this.freed = true;
      this.objective('hammer', 'Free the prisoners held in the stockade.', true);
      this.complete('hammer');
      const s = this.spawn(me, ['rifleman', 'rifleman', 'rifleman', 'a_engineer'], STOCKADE.x, STOCKADE.z + 3);
      for (const u of s) u.hp = u.maxHp * 0.6;
      this.dialogue([
        ['ally', 'Hammer Team, on your feet. You are coming home.'],
        ['intel', 'One of them is an engineer. That gives us a spare, Captain.'],
      ]);
    });

    // capture
    this.on('captured', (e) => {
      if (e.building === array && e.to === me) this.arrayCaptured();
    });
    this.on('damaged', (e) => {
      if (e.entity === array && e.attacker?.owner === me && array.hp < array.maxHp * 0.25) this.say('Careful! We need that Array in one piece!', 'intel');
    });
    this.when(() => array.dead, () => {
      this.fail('array');
      this.defeat('The Oracle Array was destroyed. The intelligence is lost.');
    });
  }

  blackout() {
    const { array } = this.r;
    this.complete('power');
    array.hp = Math.min(array.hp, array.maxHp * 0.42);
    this.reveal(COMPOUND.x, COMPOUND.z, 13);
    this.dialogue([
      ['intel', 'Power is failing across the compound. The Obelisks are dark!'],
      ['intel', 'And the surge cracked the Oracle Array\'s shielding. An engineer can walk right in.'],
      ['ally', 'Moving in. Engineers, stay on my six.'],
    ]);
    this.objective('array', 'Capture the Oracle Array with a Field Engineer.');
    this.hint('Select an <b>Engineer</b> and <b>right-click</b> the Oracle Array to capture it. Clear the guards first: engineers are unarmed.', 16);
  }

  arrayCaptured() {
    if (this.captured) return;
    this.captured = true;
    const { me, hunters } = this.r;
    this.complete('array');
    this.dialogue([
      ['intel', 'We are in. Pulling everything. Project Ascension... the Rift Missile. Schematics, launch sites...'],
      ['intel', 'Wait. There are Aegis security codes in here. Our codes. Someone on our side has been feeding them.'],
      ['commander', 'Say nothing of that on an open channel, Doctor. Captain, alarms are going up across the valley. Get out.'],
      ['enemy', 'Little thieves. Run, then. The Rift has a long reach.'],
    ]);
    this.after(12, () => {
      this.objective('evac', 'Get Captain Okafor to extraction point Zulu.');
      this.reveal(EVAC.x, EVAC.z, 5);
      this.countdown('EXTRACTION', 300, () => {
        this.fail('evac');
        this.defeat('The extraction window has closed.');
      });
      this.hint('The Array is yours and gives you its vision. Now <b>run</b>: get Captain Okafor to the extraction point in the south-east. Nobody else has to make it, but bring who you can.', 14);
    });
    this.hunt(hunters, [me], 4);
    const N: Pt = { x: 52, z: 4 };
    this.after(16, () => this.wave(hunters, ['raider', 'raider', 'acolyte', 'acolyte', 'acolyte'], N, COMPOUND));
    this.after(60, () => this.wave(hunters, ['raider', 'raider', 'zealot', 'zealot'], { x: 76, z: 30 }, { x: 64, z: 50 }));
    this.after(110, () => this.wave(hunters, ['scorpion', 'acolyte', 'acolyte', 'seeker'], { x: 40, z: 76 }, EVAC));
    this.when(() => this.isComplete('array') && !this.r.okafor.dead && Math.hypot(this.r.okafor.x - EVAC.x, this.r.okafor.z - EVAC.z) < 4, () => {
      this.objective('evac', 'Get Captain Okafor to extraction point Zulu.');
      this.complete('evac');
      this.complete('okafor');
      this.stopCountdown();
      const t = this.dialogue([
        ['ally', 'Zulu, Vanguard. We are at the LZ. Bring the bird in.'],
        ['commander', 'Good work, Captain. Commander. We know where the missile is being built. Now we go and take it apart.'],
      ], 1);
      this.after(t, () => this.victory());
    });
  }

  override cheatStep() {
    const { okafor, generators, array, stockadeGuards } = this.r;
    if (!this.isComplete('power')) {
      const g = this.alive(generators);
      if (g.length) this.world.kill(g[0], null);
      return;
    }
    if (!this.freed) {
      for (const u of stockadeGuards) if (!u.dead) this.world.kill(u, null);
      this.cheatClear(STOCKADE.x, STOCKADE.z, 6);
      this.teleport([okafor], STOCKADE.x, STOCKADE.z + 2);
      return;
    }
    if (!this.captured) {
      const eng = this.engineers()[0];
      this.cheatClear(array.x, array.z, 8);
      if (eng && eng.order.type !== 'enter') {
        this.teleport([eng], array.x, array.z + 2);
        eng.issue({ type: 'enter', target: array }, this.world);
      }
      return;
    }
    this.cheatClear(EVAC.x, EVAC.z, 10);
    this.cheatClear(okafor.x, okafor.z, 8);
    if (this.t > 0 && this.host.objectives.some((o) => o.id === 'evac')) this.teleport([okafor], EVAC.x, EVAC.z);
  }
}

function create() {
  const seed = 7401;
  const map = buildMap(
    { id: 'aegis04', name: 'Site Tabernacle', description: '', w: 80, h: 80, seed, theater: 'desert', players: 2, cliffs: 0.6, water: 0, trees: 0.2, ore: 0.3, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.clear(LZ.x, LZ.z, 5);
      e.clear(GEN.x, GEN.z, 6.5, Terrain.Dirt);
      e.clear(COMPOUND.x, COMPOUND.z, 13, Terrain.Sand);
      e.rect(COMPOUND.x - 9, COMPOUND.z - 9, COMPOUND.x + 9, COMPOUND.z + 9, Terrain.Concrete);
      e.clear(EVAC.x, EVAC.z, 4.5);
      // canyon from the landing zone north to the generator yard
      e.path([{ x: LZ.x, z: LZ.z }, { x: 10, z: 56 }, { x: 18, z: 44 }, { x: 14, z: 30 }, { x: GEN.x, z: GEN.z + 4 }], 4);
      // generator yard to the west gate
      e.path([{ x: GEN.x + 5, z: GEN.z }, { x: 32, z: 20 }, { x: COMPOUND.x - 12, z: COMPOUND.z }], 3);
      // side route from the canyon to the south gate
      e.path([{ x: 18, z: 44 }, { x: 34, z: 48 }, { x: COMPOUND.x, z: COMPOUND.z + 12 }], 3);
      // compound to extraction
      e.path([{ x: COMPOUND.x + 8, z: COMPOUND.z + 12 }, { x: 64, z: 48 }, { x: 70, z: 60 }, { x: EVAC.x, z: EVAC.z }], 4);
      e.path([{ x: 40, z: 76 }, { x: 56, z: 66 }, { x: EVAC.x - 2, z: EVAC.z }], 3);
      e.path([{ x: 52, z: 4 }, { x: COMPOUND.x, z: COMPOUND.z - 12 }], 3);
      e.path([{ x: 76, z: 30 }, { x: COMPOUND.x + 12, z: COMPOUND.z + 4 }], 3);
      e.ore(32, 62, 3.5, true);
      e.ore(64, 10, 3);
      e.scatter(['rock', 'boulder', 'deadTree'], 16, 56, 6, 14);
      e.scatter(['barrel', 'lamp'], COMPOUND.x, COMPOUND.z, 11, 10);
      e.scatter(['wreck', 'barrel'], EVAC.x, EVAC.z, 4, 4);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Ghost Team', faction: 'aegis', color: COLOR.aegis, team: 1, human: true },
    { name: 'Site Tabernacle', faction: 'covenant', color: COLOR.covenant, team: 2 },
    { name: 'Tabernacle Guard', faction: 'covenant', color: COLOR.covenant, team: 2 },
  ], seed);
  const [neutral, me, cov, hunters] = players;
  const generators = layout(world, cov, GEN.x, GEN.z, [
    ['c_power', -5, -3],
    ['c_power', -2, -3],
    ['c_power', 1, -3],
    ['c_power', -5, 0],
    ['c_power', -2, 0],
  ]);
  const cx = COMPOUND.x, cz = COMPOUND.z;
  const [array] = layout(world, cov, cx, cz, [
    ['c_radar', 1, -3],
    ['c_barracks', -5, 2],
    ['c_refinery', 2, 3],
    ['c_repair', -6, -6],
  ]);
  // walls with west and south gates guarded by Obelisks
  wallLine(world, cov, 'c_wall', cx - 10, cz - 10, cx + 10, cz - 10);
  wallLine(world, cov, 'c_wall', cx - 10, cz - 10, cx - 10, cz - 2);
  wallLine(world, cov, 'c_wall', cx - 10, cz + 2, cx - 10, cz + 10);
  wallLine(world, cov, 'c_wall', cx - 10, cz + 10, cx - 2, cz + 10);
  wallLine(world, cov, 'c_wall', cx + 2, cz + 10, cx + 10, cz + 10);
  wallLine(world, cov, 'c_wall', cx + 10, cz - 10, cx + 10, cz + 10);
  put(world, cov, 'c_obelisk', cx - 9, cz - 3, 1);
  put(world, cov, 'c_obelisk', cx + 3, cz + 9, 1);
  put(world, cov, 'c_obelisk', cx + 7, cz - 7, 1);
  // stockade inside the east wall
  put(world, neutral, 'n_bunker', STOCKADE.x - 1, STOCKADE.z - 1);
  const stockadeGuards = troops(world, cov, ['zealot', 'zealot', 'acolyte'], STOCKADE.x - 3, STOCKADE.z - 2);
  troops(world, cov, ['acolyte', 'acolyte', 'seeker'], cx + 1, cz + 1);
  const patrols = [
    { units: troops(world, cov, ['acolyte', 'acolyte', 'acolyte'], 12, 50), route: [{ x: 12, z: 50 }, { x: 20, z: 40 }, { x: 14, z: 30 }, { x: 20, z: 40 }] },
    { units: troops(world, cov, ['acolyte', 'acolyte', 'zealot'], GEN.x + 4, GEN.z + 5), route: [{ x: GEN.x + 4, z: GEN.z + 5 }, { x: GEN.x - 5, z: GEN.z + 5 }, { x: GEN.x - 5, z: GEN.z - 5 }, { x: GEN.x + 5, z: GEN.z - 5 }] },
    { units: troops(world, cov, ['acolyte', 'acolyte', 'acolyte', 'acolyte'], cx - 5, cz - 5), route: [{ x: cx - 6, z: cz - 6 }, { x: cx + 6, z: cz - 6 }, { x: cx + 6, z: cz + 6 }, { x: cx - 6, z: cz + 6 }] },
    { units: troops(world, cov, ['seeker', 'seeker', 'raider'], 40, 54), route: [{ x: 38, z: 50 }, { x: 60, z: 52 }] },
  ];
  // the Ghost team
  world.buildingsDirty = true;
  const [okafor] = troops(world, me, ['marksman'], LZ.x, LZ.z, -Math.PI / 2);
  scaleHp(okafor, 2.5);
  okafor.tag = 'okafor';
  troops(world, me, ['marksman', 'marksman', 'rocketeer', 'rocketeer', 'rocketeer', 'a_engineer', 'a_engineer'], LZ.x + 1, LZ.z + 1, -Math.PI / 2);
  world.updateFog();
  return { world, script: (h: MissionHost) => new SilentKnife(h, { me, cov, hunters, okafor, generators, array, stockadeGuards, patrols }) };
}

export const aegis04: MissionDef = {
  id: 'aegis_04',
  faction: 'aegis',
  index: 4,
  name: 'Silent Knife',
  codename: 'Operation Silent Knife',
  location: 'Site Tabernacle, Wadi Rum, Jordan',
  briefing: `Havnvik's relay caught a Covenant transmission bouncing through the Jordanian desert. Its source is a research compound the zealots call Tabernacle.

Whatever they are building, the plans are in the compound's Oracle Array. We want them. Intact.

An armoured assault would be seen from forty kilometres away, and the compound is ringed with Obelisks of the Rift. So we are sending a knife instead of a hammer: Captain Okafor and a Ghost team, two engineers and a demolition section.

Obelisks draw enormous power. Kill the generators and the Obelisks go dark. Then put an engineer in the Array and get out before the whole valley wakes up.

Captain Okafor is not expendable, Commander. Bring her back.`,
  objectives: ['Destroy the Rift Generators to black out the compound.', 'Capture the Oracle Array with a Field Engineer.', 'Get Captain Okafor to the extraction point.'],
  music: 'tension',
  create,
};
