// COVENANT 04 — CRUCIBLE
// Defend the Temple of the First Shard against a Coalition siege. Twist: an Ion Uplink in the
// siege camp vaporises Brother Kade's outpost, then starts recharging with the Temple as its next
// target. Destroy the Uplink before it fires again, then break the siege camp.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { COLOR, COVENANT_CAST, CampaignScript, buildMap, layout, makeWorld, scaleHp, troops, wallLine, type Pt } from '../common';

const TEMPLE: Pt = { x: 22, z: 50 };
const KADE: Pt = { x: 48, z: 14 };
const CAMP: Pt = { x: 76, z: 74 };
const SE: Pt = { x: 90, z: 60 };
const S: Pt = { x: 56, z: 92 };
const ION_RECHARGE = 360;

interface Refs {
  me: Player;
  camp: Player;
  siege: Player;
  legion: Player;
  temple: Building;
  uplink: Building;
  campFactory: Building;
  kadeUnits: Unit[];
}

class Crucible extends CampaignScript {
  r: Refs;
  ionFired = false;
  uplinkDown = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, COVENANT_CAST);
    this.r = refs;
    this.checkpoints = [CAMP, KADE, SE, S];
  }

  campStructures() {
    return this.buildings(this.r.camp, (b) => !b.def.wall);
  }

  start() {
    const { me, camp, siege, legion, temple, uplink } = this.r;
    this.allowOnly([
      'c_power', 'c_refinery', 'c_barracks', 'c_factory', 'c_radar', 'c_repair', 'c_airfield',
      'c_turret', 'c_flak', 'c_obelisk', 'c_wall',
      'acolyte', 'zealot', 'seeker', 'c_engineer', 'raider', 'scorpion', 'inferno', 'c_harvester', 'wraith',
    ], 2);
    this.holdSuperweapon(camp, 'ionStrike');
    this.objective('temple', 'The Temple of the First Shard must not fall.');
    this.objective('siege', 'Break the Coalition siege: destroy their camp in the south-east.');
    this.beacon('temple', temple, 'TEMPLE', '#6aff8a');
    this.beacon('siege', CAMP, 'SIEGE CAMP', '#ff6a4a');
    this.loseWhenWiped('The faithful of the First Shard are no more.');
    this.reveal(CAMP.x, CAMP.z, 6);
    this.dialogue([
      ['commander', 'Harbinger, the Coalition has come for the Temple of the First Shard. The oldest shrine of our faith.'],
      ['ally', 'My Flame Legion holds the northern ridge. Nothing crosses it that I do not allow.'],
      ['intel', 'Their siege camp is dug in to the south-east. Tanks, artillery, and something the Oracle cannot read.'],
      ['commander', 'Hold, Harbinger. Then break them.'],
    ], 1);
    this.after(24, () =>
      this.hint('New: the <b>Obelisk of the Rift</b> (needs lots of power), <b>Flak Cannons</b> and the <b>Airstrip</b> for <b>Wraith</b> gunships.<br>When <b>Tempest</b> artillery shells you from long range, send fast units to kill it. Do not sit and take it.', 20),
    );
    this.when(() => temple.dead, () => {
      this.fail('temple');
      this.defeat('The Temple of the First Shard has fallen.');
    });

    // waves
    const tgt = { x: TEMPLE.x + 6, z: TEMPLE.z + 2 };
    this.hunt(siege, [me, legion], 4);
    const W = (t: number, ids: string[], from: Pt, line?: string) =>
      this.after(t, () => {
        if (this.uplinkDown && this.r.campFactory.dead) return;
        if (line) this.say(line, 'intel');
        this.wave(siege, ids, from, tgt);
      });
    W(60, ['guardian', 'guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rifleman'], SE, 'Coalition armour advancing from the south-east.');
    W(150, ['tempest', 'guardian', 'guardian', 'rocketeer', 'rocketeer', 'rocketeer'], S, 'Artillery! Tempest rocket carriers to the south. Hunt them down!');
    W(250, ['guardian', 'guardian', 'guardian', 'guardian', 'scout', 'scout', 'rifleman', 'rifleman', 'rifleman'], SE);
    W(430, ['titan', 'guardian', 'guardian', 'guardian', 'rocketeer', 'rocketeer'], SE, 'Titans! Their heaviest tanks. Seekers and Infernos, focus them!');
    W(530, ['guardian', 'guardian', 'guardian', 'marksman', 'marksman', 'rocketeer', 'rocketeer', 'rocketeer', 'rocketeer'], S);
    W(620, ['titan', 'titan', 'guardian', 'guardian'], SE);
    W(720, ['titan', 'titan', 'guardian', 'guardian', 'guardian', 'tempest'], S, 'Everything they have left is coming!');
    this.every(150, () => {
      if (this.t < 800 || this.r.campFactory.dead) return;
      this.wave(siege, ['guardian', 'guardian', 'rifleman', 'rifleman', 'rocketeer'], SE, tgt);
    });

    this.after(360, () => this.ionStrike());
    this.when(() => uplink.dead, () => this.uplinkDestroyed());
    this.when(() => this.campStructures().length === 0, () => {
      this.uplinkDestroyed();
      this.complete('siege');
      this.complete('temple');
      const t = this.dialogue([
        ['commander', 'The siege is broken. The First Shard still sings. You have earned your place at my side, Harbinger.'],
        ['ally', 'We paid for it in ash. Remember that, Prophet.'],
        ['intel', 'The Oracle shows me the last road. Geneva. The heart of the Coalition.'],
      ], 1);
      this.after(t, () => this.victory());
    });
  }

  ionStrike() {
    if (this.ionFired) return;
    this.ionFired = true;
    const { me, camp, legion, uplink } = this.r;
    if (uplink.dead) return;
    const kadeYard = this.buildings(legion)[0];
    const x = kadeYard?.x ?? KADE.x, z = kadeYard?.z ?? KADE.z;
    this.dialogue([
      ['intel', 'Harbinger! A light in the sky above the northern ridge. It is...'],
    ]);
    this.after(3, () => {
      this.fireSuperweapon(camp, 'ionStrike', x, z);
      this.reveal(x, z, 8);
    });
    this.after(7, () => {
      // the beam sweeps the rest of the outpost
      for (const b of this.buildings(legion)) this.world.damage(b, b.maxHp * 0.9, null);
      for (const u of this.units(legion)) if (Math.hypot(u.x - x, u.z - z) < 7) this.world.damage(u, u.maxHp * 0.8, null);
    });
    this.after(8, () => {
      this.dialogue([
        ['ally', 'My legion... my brothers... ash. All ash.'],
        ['commander', 'An orbital cannon. The Ion Uplink. Aurora\'s designs, built and aimed at us.'],
        ['intel', 'It is recharging, Prophet. The Oracle says its next target is the Temple itself.'],
        ['ally', 'Then I will ride with the Harbinger. Take what is left of the Flame Legion.'],
      ]);
      this.giveUnits(this.units(legion), me);
      this.reinforce(me, ['inferno', 'inferno', 'inferno', 'zealot', 'zealot'], KADE.x - 10, 4, KADE.x - 8, KADE.z + 10);
    });
    this.after(20, () => {
      this.objective('uplink', 'Destroy the Ion Uplink in the siege camp before it fires again.');
      if (!this.r.uplink.dead) this.beacon('uplink', this.r.uplink, 'ION UPLINK', '#ff4a3a');
      this.reveal(this.r.uplink.x, this.r.uplink.z, 5);
      this.countdown('ION CANNON', ION_RECHARGE, () => this.templeStrike());
      let stalled = false;
      this.every(1, () => {
        if (this.uplinkDown || this.countdownLeft() <= 0) return;
        if (this.r.camp.lowPower) {
          this.delayCountdown(1);
          if (!stalled) this.say('Their reactors are failing. The cannon\'s charge has stalled!', 'intel');
          stalled = true;
        } else stalled = false;
      });
      this.hint('The <b>Ion Uplink</b> sits at the back of the siege camp. Infernos melt structures; Wraith gunships can fly over the walls, but watch for SAM sites.<br>Like every superweapon, the Uplink needs <b>power</b>: knock out the camp\'s reactors and the charge stalls.', 18);
    });
  }

  templeStrike() {
    if (this.uplinkDown) return;
    const { camp, temple } = this.r;
    this.fail('uplink');
    this.say('The cannon! It is firing on the Temple!', 'intel');
    this.fireSuperweapon(camp, 'ionStrike', temple.x, temple.z);
    this.after(4, () => {
      if (!temple.dead) this.world.damage(temple, temple.maxHp * 2, null);
    });
  }

  uplinkDestroyed() {
    if (this.uplinkDown) return;
    this.uplinkDown = true;
    if (!this.ionFired) return;
    this.complete('uplink');
    this.stopCountdown();
    this.dialogue([
      ['intel', 'The Uplink is burning! The sky is ours again.'],
      ['enemy', 'All siege units: hold the camp. Reinforcements are... Negative? Then hold anyway.'],
      ['commander', 'Finish them, Harbinger.'],
    ], 1);
  }

  override cheatStep() {
    const { siege, uplink } = this.r;
    for (const u of this.units(siege)) this.world.kill(u, null);
    if (!this.ionFired) return;
    if (!uplink.dead && this.t > 400) {
      this.world.kill(uplink, null);
      return;
    }
    if (this.uplinkDown) {
      const b = this.campStructures()[0];
      if (b) this.world.kill(b, null);
    }
  }
}

function create() {
  const seed = 9904;
  const map = buildMap(
    { id: 'cov04', name: 'First Shard', description: '', w: 96, h: 96, seed, theater: 'wasteland', players: 2, cliffs: 0.45, water: 0.06, trees: 0.25, ore: 0.5, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.clear(TEMPLE.x, TEMPLE.z, 13);
      e.clear(KADE.x, KADE.z, 7);
      e.clear(CAMP.x, CAMP.z, 13, Terrain.Dirt);
      e.rect(CAMP.x - 8, CAMP.z - 8, CAMP.x + 9, CAMP.z + 9, Terrain.Concrete);
      e.ridge([{ x: 30, z: 26 }, { x: 44, z: 28 }, { x: 58, z: 24 }], 2.5);
      e.path([{ x: TEMPLE.x + 4, z: TEMPLE.z - 8 }, { x: 32, z: 20 }, { x: KADE.x, z: KADE.z + 4 }], 4);
      e.path([{ x: KADE.x + 6, z: KADE.z }, { x: 72, z: 22 }, { x: 88, z: 40 }, { x: SE.x, z: SE.z }], 3);
      e.path([{ x: TEMPLE.x + 8, z: TEMPLE.z + 2 }, { x: 44, z: 52 }, { x: 62, z: 60 }, { x: CAMP.x - 10, z: CAMP.z - 4 }], 4);
      e.path([{ x: SE.x, z: SE.z }, { x: CAMP.x + 8, z: CAMP.z - 10 }, { x: 64, z: 54 }], 4);
      e.path([{ x: S.x, z: S.z }, { x: 50, z: 76 }, { x: 36, z: 62 }, { x: TEMPLE.x + 4, z: TEMPLE.z + 8 }], 4);
      e.path([{ x: S.x, z: S.z }, { x: CAMP.x - 6, z: CAMP.z + 10 }], 3);
      e.path([{ x: KADE.x - 10, z: 4 }, { x: KADE.x - 4, z: KADE.z - 2 }], 3);
      e.ore(10, 36, 4);
      e.ore(12, 66, 4);
      e.ore(40, 44, 3.5, true);
      e.ore(60, 40, 4);
      e.ore(86, 88, 4);
      e.ore(30, 80, 3.5);
      e.scatter(['ruin', 'lamp', 'rock'], TEMPLE.x, TEMPLE.z, 12, 12);
      e.scatter(['wreck', 'deadTree', 'rock'], 50, 64, 10, 16);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'The Harbinger', faction: 'covenant', color: COLOR.covenant, team: 1, human: true, credits: 3000 },
    { name: 'Coalition Siege Camp', faction: 'aegis', color: COLOR.aegis, team: 2 },
    { name: 'Coalition Siege Group', faction: 'aegis', color: COLOR.aegis, team: 2 },
    { name: 'Flame Legion', faction: 'covenant', color: COLOR.orange, team: 1 },
  ], seed);
  const [, me, camp, siege, legion] = players;
  const tx = TEMPLE.x, tz = TEMPLE.z;
  const mine = layout(world, me, tx, tz, [
    ['c_temple', -1, -1],
    ['c_yard', -8, -6],
    ['c_power', -8, -1],
    ['c_power', -8, 2],
    ['c_power', -5, 5],
    ['c_power', -2, 5],
    ['c_refinery', -4, -8],
    ['c_barracks', 4, -6],
    ['c_factory', 3, 3],
    ['c_radar', -12, 3],
    ['c_turret', 8, 1],
    ['c_turret', 7, 7],
    ['c_obelisk', 9, 4],
  ]);
  const temple = mine[0];
  scaleHp(temple, 1.6);
  troops(world, me, ['c_harvester'], tx - 6, tz - 11);
  troops(world, me, ['scorpion', 'scorpion', 'scorpion', 'scorpion', 'inferno', 'inferno'], tx + 6, tz - 2, 0);
  troops(world, me, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot', 'zealot', 'zealot', 'seeker', 'seeker', 'seeker'], tx + 4, tz + 8, 0);
  // Kade's outpost
  layout(world, legion, KADE.x, KADE.z, [
    ['c_barracks', -2, -2],
    ['c_power', 2, -3],
    ['c_turret', -4, 3],
    ['c_turret', 3, 3],
  ]);
  const kadeUnits = troops(world, legion, ['inferno', 'inferno', 'zealot', 'zealot', 'zealot', 'zealot', 'raider', 'raider'], KADE.x, KADE.z + 4);
  for (const u of kadeUnits) u.tag = 'guard';
  // the siege camp
  const cx = CAMP.x, cz = CAMP.z;
  const campB = layout(world, camp, cx, cz, [
    ['a_uplink', 4, 3],
    ['a_factory', -4, -2],
    ['a_yard', 1, -4],
    ['a_power', 6, -6],
    ['a_power', 6, -3],
    ['a_power', 9, 0],
    ['a_power', 9, 3],
    ['a_power', 8, 7],
    ['a_power', 5, 7],
    ['a_barracks', -3, 3],
    ['a_radar', 0, 7],
    ['a_turret', -9, -4],
    ['a_turret', -8, 2],
    ['a_turret', -3, -9],
    ['a_tower', -7, -8],
    ['a_tower', -6, 7],
    ['a_sam', 1, 0],
    ['a_sam', 4, -1],
    ['a_railtower', -6, -1],
  ]);
  wallLine(world, camp, 'a_wall', cx - 10, cz - 2, cx - 10, cz + 1);
  troops(world, camp, ['guardian', 'guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer'], cx - 5, cz + 2);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new Crucible(h, { me, camp, siege, legion, temple, uplink: campB[0], campFactory: campB[1], kadeUnits }) };
}

export const covenant04: MissionDef = {
  id: 'covenant_04',
  faction: 'covenant',
  index: 4,
  name: 'Crucible',
  codename: 'The Fourth Trial',
  location: 'Temple of the First Shard, Cappadocia',
  briefing: `The Coalition knows what we took from Aurora, Harbinger. Now they want vengeance, and they have chosen the one target that will wound us most.

The Temple of the First Shard stands where the first Rift crystal fell in Anatolia. Pilgrims have walked to it for nine years. General Hale has surrounded it with a siege camp and an army.

Brother Kade's Flame Legion holds the northern ridge. You hold the Temple and its base. The Obelisk of the Rift and the Wraith gunship are yours to command.

Hold the Temple. When their assault breaks, break their camp.

The Oracle is troubled, Harbinger. There is something in that camp she cannot see. Be ready for anything.`,
  objectives: ['The Temple of the First Shard must survive.', 'Break the Coalition siege.', 'Destroy the Coalition siege camp.'],
  music: 'battle2',
  create,
};
