// AEGIS 06 — STARFALL (finale)
// Race the Rift Missile countdown at the Wound: build a base, unlock the Ion Uplink, and
// destroy the Rift Missile Silo inside a full-strength Covenant stronghold. Then end Azrael
// in Temple Prime. Voss taunts from her forward base; Okafor returns mid-mission.

import type { Building } from '../../Building';
import { SkirmishAI } from '../../ai/SkirmishAI';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, put, scaleHp, troops, wallLine, type Pt } from '../common';

const HOME: Pt = { x: 18, z: 94 };
const ENEMY: Pt = { x: 86, z: 26 };
const SILO: Pt = { x: 98, z: 10 };
const WOUND: Pt = { x: 56, z: 58 };
const FWD: Pt = { x: 92, z: 92 };
const LAUNCH_TIME = 25 * 60;

interface Refs {
  me: Player;
  cov: Player;
  voss: Player;
  silo: Building;
  temple: Building;
  fwdFactory: Building;
}

class Starfall extends CampaignScript {
  r: Refs;
  siloDown = false;
  launched = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, { ...AEGIS_CAST, intel: 'Lt. Reyes' });
    this.r = refs;
    this.checkpoints = [ENEMY, WOUND, FWD, { x: SILO.x - 3, z: SILO.z + 4 }];
  }

  /** Voss speaks on the enemy channel. */
  voss(text: string, delay = 0) {
    this.sayAs('Dr. Voss', text, 'enemy', delay);
  }

  start() {
    const { me, voss, silo, temple, fwdFactory } = this.r;
    this.allowOnly([
      'a_power', 'a_refinery', 'a_barracks', 'a_factory', 'a_radar', 'a_repair', 'a_airfield', 'a_techlab', 'a_uplink',
      'a_tower', 'a_turret', 'a_sam', 'a_railtower', 'a_wall',
      'rifleman', 'rocketeer', 'a_engineer', 'marksman', 'scout', 'guardian', 'tempest', 'titan', 'a_harvester', 'hawk', 'a_mcv',
    ], 4);
    this.objective('silo', 'Destroy the Rift Missile Silo before launch.');
    this.objective('temple', 'Destroy Temple Prime and end the Prophet\'s reign.');
    this.loseWhenWiped('The Coalition has lost its last army.');
    this.when(() => !me.has('a_yard') && !this.units(me).some((u) => !!u.def.mcv) && this.myStructures().length === 0, () => this.defeat('The MCV was destroyed.'));
    this.reveal(ENEMY.x, ENEMY.z, 10);
    this.reveal(SILO.x, SILO.z, 4);
    this.countdown('RIFT MISSILE LAUNCH', LAUNCH_TIME, () => this.launch());
    // the launch is scripted: keep the silo from charging on its own (the AI fires anything ready)
    this.holdSuperweapon(this.r.cov, 'riftMissile');
    this.dialogue([
      ['commander', 'Commander, this is the Wound. Ground zero of the Riftfall. Everything began here, and here it ends.'],
      ['intel', 'Reyes, sir. The Rift Missile silo is in the north-east corner of their stronghold. Launch in twenty-five minutes.'],
      ['intel', 'If that warhead flies, it seeds a Rift storm across half a continent.'],
      ['commander', 'Every weapon we have is yours, Commander. Including the Ion Uplink. Deploy, build, and burn that silo.'],
    ], 1);
    this.after(30, () =>
      this.hint('<b>Ion Uplink</b> unlocked: requires a <b>Tech Center</b> and lots of power. When charged, click its icon to strike anywhere on the map.<br>The silo is armoured: an ion strike alone will not finish it. Follow up with armour or Hawks.', 22),
    );
    this.after(55, () => this.say('Their base swallows power like a black hole. Kill the generators and the Obelisks go dark, same as Tabernacle.', 'intel'));

    // Voss
    this.after(150, () => {
      this.voss('Hello, Marcus. I hoped you would come yourself.');
      this.after(5, () => this.say('Voss. You sold out the whole human race.', 'commander'));
      this.voss('Sold? No. I chose. The Rift is not a plague, it is a door. Tomorrow the whole world walks through it.', 10);
      this.after(19, () => {
        this.say('Voss has a forward base in the south-east. It is feeding armour into your flank.', 'intel');
        this.objective('fwd', 'Destroy Dr. Voss\'s forward base.', true);
        this.reveal(FWD.x, FWD.z, 8);
      });
    });
    this.hunt(voss, [me], 4);
    this.every(150, () => {
      if (fwdFactory.dead || this.siloDown) return;
      this.wave(voss, ['scorpion', 'scorpion', 'inferno', 'prism', 'acolyte', 'acolyte', 'seeker'], { x: FWD.x - 6, z: FWD.z - 2 }, { x: HOME.x + 6, z: HOME.z - 6 });
    });
    this.when(() => fwdFactory.dead, () => {
      this.objective('fwd', 'Destroy Dr. Voss\'s forward base.', true);
      this.complete('fwd');
      this.voss('Crude, Marcus. You always did prefer a hammer.');
    });

    // Okafor returns
    this.after(480, () => {
      this.speakerNames.ally = 'Capt. Okafor';
      this.say('Vanguard is back in the fight, Commander. Brought friends.', 'ally');
      this.reinforce(me, ['titan', 'titan', 'marksman', 'marksman', 'marksman', 'a_engineer', 'a_engineer'], 3, 70, HOME.x + 10, HOME.z - 16);
    });

    // time pressure
    this.after(LAUNCH_TIME - 720, () => {
      this.say('Twelve minutes to launch. Their gunships are lifting off. They know what we are building.', 'intel');
      const uplink = this.buildings(me, (b) => b.def.id === 'a_uplink' || b.def.id === 'a_techlab')[0];
      const t = uplink ?? this.buildings(me, (b) => b.def.produces === 'yard')[0];
      if (t && !this.siloDown) this.wave(voss, ['wraith', 'wraith', 'wraith', 'wraith'], { x: 104, z: 60 }, t);
    });
    this.after(LAUNCH_TIME - 300, () => { if (!this.siloDown) this.say('Five minutes! Missile is on internal power!', 'intel'); });
    this.after(LAUNCH_TIME - 60, () => { if (!this.siloDown) this.say('Sixty seconds! Silo doors are opening!', 'intel'); });
    this.after(LAUNCH_TIME - 240, () => { if (!this.siloDown) this.say('Four minutes, Hale. Pray, if you remember how.', 'enemy'); });

    // silo and temple
    this.when(() => silo.dead, () => this.siloDestroyed());
    this.when(() => this.siloDown && temple.dead, () => {
      this.complete('temple');
      const t = this.dialogue([
        ['enemy', 'No... the Rift... it was supposed to...'],
        ['commander', 'It is over, Azrael.'],
        ['intel', 'Temple Prime is down. Covenant forces are scattering across the zone.'],
        ['commander', 'Commander. Whatever the Rift is, it will not be decided by fanatics and missiles. Not today. Well done.'],
      ], 2);
      this.voss('This is not the end, Marcus. The door is still open.', t - 1);
      this.after(t + 5, () => this.victory());
    });
    this.when(() => !this.siloDown && temple.dead, () => this.say('Temple Prime is down but the silo is still counting! Hit the silo!', 'commander'));
    this.on('superweaponImpact', (e) => {
      if (e.player === me && Math.hypot(e.x - silo.x, e.z - silo.z) < 5 && !silo.dead) this.say('Direct hit on the silo! It is still standing. Finish it!', 'intel');
    });
  }

  siloDestroyed() {
    if (this.siloDown) return;
    this.siloDown = true;
    this.complete('silo');
    this.stopCountdown();
    const { cov, voss } = this.r;
    this.dialogue([
      ['intel', 'The silo is gone! No launch! Repeat, no launch!'],
      ['enemy', 'You have torn out the heart of the Rift! Then the faithful will be its fists. All of you. Now!'],
      ['commander', 'Here they come. Everything they have. Hold together and push to Temple Prime.'],
    ], 1);
    this.voss('Azrael, it is finished. Leave this place.', 16);
    // the zealots throw everything at the player
    this.after(8, () => {
      for (const u of this.units(cov, (x) => x.weapons.length > 0 && !x.def.flying)) {
        u.tag = 'hunter';
      }
      this.hunt(cov, [this.me], 6);
      this.wave(voss, ['prism', 'prism', 'shade', 'shade', 'inferno', 'zealot', 'zealot', 'zealot'], { x: WOUND.x, z: WOUND.z }, { x: HOME.x + 6, z: HOME.z - 6 });
    });
  }

  launch() {
    if (this.launched || this.siloDown) return;
    this.launched = true;
    const { cov, me, silo } = this.r;
    const target = this.buildings(me, (b) => b.def.produces === 'yard')[0] ?? this.buildings(me)[0] ?? this.units(me)[0];
    if (target && !silo.dead) this.fireSuperweapon(cov, 'riftMissile', target.x, target.z);
    this.say('Launch detected! God help us all...', 'intel');
    this.after(9, () => this.defeat('The Rift Missile has been launched.'));
  }

  override cheatStep() {
    const { silo, temple, voss } = this.r;
    const me = this.me;
    const mcv = this.units(me, (u) => !!u.def.mcv)[0];
    if (mcv && !me.has('a_yard')) {
      if (mcv.order.type !== 'deploy') mcv.issue({ type: 'deploy' }, this.world);
      return;
    }
    for (const u of this.units(voss)) this.world.kill(u, null);
    if (this.t < 240) return;
    if (!silo.dead) {
      this.world.damage(silo, 900, null);
      return;
    }
    this.cheatClear(temple.x, temple.z, 30);
    if (!temple.dead) this.world.damage(temple, 600, null);
  }
}

function create() {
  const seed = 11206;
  const map = buildMap(
    { id: 'aegis06', name: 'The Wound', description: '', w: 112, h: 112, seed, theater: 'wasteland', players: 2, cliffs: 0.35, water: 0.08, trees: 0.25, ore: 0.6, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.clear(HOME.x, HOME.z, 13);
      e.clear(ENEMY.x, ENEMY.z, 18, Terrain.Dirt);
      e.rect(ENEMY.x - 12, ENEMY.z - 14, ENEMY.x + 14, ENEMY.z + 10, Terrain.Concrete);
      e.clear(FWD.x, FWD.z, 9);
      e.clear(WOUND.x, WOUND.z, 14, Terrain.Dirt);
      // the crater ring with three breaches
      const seg = (a0: number, a1: number) => {
        const pts: { x: number; z: number }[] = [];
        for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / 8) pts.push({ x: WOUND.x + Math.cos(a) * 11, z: WOUND.z + Math.sin(a) * 11 });
        return pts;
      };
      const g = 0.32;
      for (const [a0, a1] of [[g, (2 * Math.PI) / 3 - g], [(2 * Math.PI) / 3 + g, (4 * Math.PI) / 3 - g], [(4 * Math.PI) / 3 + g, 2 * Math.PI - g]]) {
        e.ridge(seg(a0 + 0.6, a1 + 0.6), 2.2);
      }
      e.ore(WOUND.x, WOUND.z, 8, true);
      e.path([{ x: HOME.x + 8, z: HOME.z - 8 }, { x: 30, z: 66 }, { x: 34, z: 44 }, { x: 56, z: 32 }, { x: ENEMY.x - 16, z: ENEMY.z + 4 }], 4);
      e.path([{ x: HOME.x + 10, z: HOME.z }, { x: 50, z: 92 }, { x: FWD.x - 8, z: FWD.z }, { x: 94, z: 70 }, { x: ENEMY.x + 2, z: ENEMY.z + 16 }], 4);
      e.path([{ x: 34, z: 76 }, { x: WOUND.x, z: WOUND.z }, { x: 74, z: 42 }, { x: ENEMY.x - 6, z: ENEMY.z + 12 }], 3);
      e.path([{ x: 3, z: 70 }, { x: HOME.x + 4, z: HOME.z - 12 }], 3);
      e.path([{ x: ENEMY.x + 8, z: ENEMY.z - 8 }, { x: SILO.x, z: SILO.z + 3 }], 3);
      e.path([{ x: 104, z: 60 }, { x: 94, z: 60 }], 3);
      e.ore(32, 102, 4);
      e.ore(6, 80, 3.5);
      e.ore(40, 84, 3.5);
      e.ore(100, 44, 4);
      e.ore(70, 12, 4);
      e.ore(80, 100, 3.5, true);
      e.scatter(['wreck', 'ruin', 'deadTree'], 40, 60, 14, 24);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Aegis Coalition', faction: 'aegis', color: COLOR.aegis, team: 1, human: true, credits: 8000 },
    { name: 'Rift Covenant', faction: 'covenant', color: COLOR.covenant, team: 2, credits: 4000, techLimit: 3 },
    { name: 'The Chosen of Voss', faction: 'covenant', color: COLOR.purple, team: 2 },
  ], seed);
  const [, me, cov, voss] = players;
  const ex = ENEMY.x, ez = ENEMY.z;
  const base = layout(world, cov, ex, ez, [
    ['c_temple', 2, -4],
    ['c_yard', -3, -4],
    ['c_power', -10, -12],
    ['c_power', -7, -12],
    ['c_power', -4, -12],
    ['c_power', -1, -12],
    ['c_power', 2, -12],
    ['c_power', 5, -12],
    ['c_power', 12, -4],
    ['c_power', 12, -1],
    ['c_power', 12, 2],
    ['c_power', 12, 5],
    ['c_power', 9, 5],
    ['c_barracks', -8, -4],
    ['c_refinery', -9, 1],
    ['c_refinery', 7, 1],
    ['c_factory', -4, 1],
    ['c_radar', 1, 1],
    ['c_airfield', 3, 5],
    ['c_repair', -2, 6],
    ['c_obelisk', -13, -3],
    ['c_obelisk', -13, 4],
    ['c_obelisk', -6, 9],
    ['c_obelisk', 4, 10],
    ['c_turret', -14, 0],
    ['c_turret', -10, 8],
    ['c_turret', 8, 9],
    ['c_flak', -4, -7],
    ['c_flak', 6, -7],
    ['c_flak', 0, 9],
  ]);
  const temple = base[0];
  scaleHp(temple, 2.5);
  const silo = put(world, cov, 'c_silo', SILO.x - 1, SILO.z - 1, 3);
  scaleHp(silo, 2);
  put(world, cov, 'c_obelisk', SILO.x - 4, SILO.z + 3, 2);
  put(world, cov, 'c_flak', SILO.x + 2, SILO.z + 3, 2);
  wallLine(world, cov, 'c_wall', ex - 15, ez - 8, ex - 15, ez - 2);
  wallLine(world, cov, 'c_wall', ex - 15, ez + 2, ex - 15, ez + 8);
  troops(world, cov, ['c_harvester', 'c_harvester'], ex, ez + 12);
  troops(world, cov, ['prism', 'prism', 'scorpion', 'scorpion', 'scorpion', 'inferno', 'inferno', 'shade', 'seeker', 'seeker', 'seeker', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot'], ex - 6, ez + 6);
  cov.ai = new SkirmishAI(world, cov, 'hard', { attackDelay: 360, aggression: 0.85, techLimit: 3, allowSuperweapons: false });
  // Voss's forward base
  const fwd = layout(world, voss, FWD.x, FWD.z, [
    ['c_factory', -1, -1],
    ['c_barracks', 4, -3],
    ['c_power', 4, 1],
    ['c_power', 4, 4],
    ['c_power', -5, 3],
    ['c_turret', -5, -3],
    ['c_turret', -2, -5],
    ['c_obelisk', -6, 0],
  ]);
  troops(world, voss, ['scorpion', 'scorpion', 'acolyte', 'acolyte', 'seeker'], FWD.x - 4, FWD.z + 2);
  // the player
  troops(world, me, ['a_mcv'], HOME.x, HOME.z, -Math.PI / 4);
  troops(world, me, ['guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'titan', 'titan', 'tempest', 'tempest'], HOME.x + 7, HOME.z - 6, -Math.PI / 4);
  troops(world, me, ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'rocketeer', 'rocketeer', 'marksman', 'marksman', 'a_engineer'], HOME.x + 2, HOME.z - 8, -Math.PI / 4);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new Starfall(h, { me, cov, voss, silo, temple, fwdFactory: fwd[0] }) };
}

export const aegis06: MissionDef = {
  id: 'aegis_06',
  faction: 'aegis',
  index: 6,
  name: 'Starfall',
  codename: 'Operation Starfall',
  location: 'The Wound, Tunguska Basin, Siberia',
  briefing: `Nine years ago the first Rift shard struck the Tunguska Basin. The crater it left is called the Wound, and it is where the Covenant has built its holiest stronghold.

Inside that stronghold is the Rift Missile. Its warhead is a core of raw Riftite. If it launches, it will seed a Rift storm across half of Asia. Launch is in twenty-five minutes.

Dr. Voss is with them. She knows our tactics, our codes, and our weaknesses. Expect her to use all of them.

You have an MCV, the strongest armoured force the Coalition could scrape together, and clearance for the Ion Uplink. The silo is hardened: an ion strike will cripple it, not finish it.

Destroy the silo. Then go into Temple Prime and end Azrael's war.`,
  objectives: ['Destroy the Rift Missile Silo before the countdown ends.', 'Destroy Temple Prime.', 'Optional: destroy Dr. Voss\'s forward base.'],
  music: 'battle3',
  create,
};
