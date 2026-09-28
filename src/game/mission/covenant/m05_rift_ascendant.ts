// COVENANT 05 — RIFT ASCENDANT (finale)
// Assault on the Coalition's headquarters at Lake Geneva. Build a Rift Missile Silo, survive
// scripted Ion Uplink strikes (stall them by cutting power, or destroy the Uplink), and bring down
// Bastion Prime. Dr. Voss, now with the Covenant, feeds intel; Kade leads the final charge.

import type { Building } from '../../Building';
import { SkirmishAI } from '../../ai/SkirmishAI';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { MissionDef, MissionHost } from '../MissionScript';
import { COLOR, COVENANT_CAST, CampaignScript, buildMap, layout, makeWorld, put, scaleHp, troops, wallLine, type Pt } from '../common';

const HOME: Pt = { x: 18, z: 94 };
const HQ: Pt = { x: 88, z: 24 };
const UPLINK: Pt = { x: 102, z: 8 };
const LAKE: Pt = { x: 56, z: 58 };
const FIRST_STRIKE = 600;
const STRIKE_GAP = 420;

interface Refs {
  me: Player;
  aegis: Player;
  guard: Player;
  hq: Building;
  uplink: Building;
}

class RiftAscendant extends CampaignScript {
  r: Refs;
  strikes = 0;
  siloBuilt = false;
  launched = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, COVENANT_CAST);
    this.r = refs;
    this.checkpoints = [HQ, { x: UPLINK.x - 4, z: UPLINK.z + 4 }, { x: 56, z: 30 }, { x: 72, z: 86 }];
  }

  voss(text: string, delay = 0) {
    this.sayAs('Dr. Voss', text, 'ally', delay);
  }

  start() {
    const { me, aegis, guard, hq, uplink } = this.r;
    this.allowOnly([
      'c_power', 'c_refinery', 'c_barracks', 'c_factory', 'c_radar', 'c_repair', 'c_airfield', 'c_temple', 'c_silo',
      'c_turret', 'c_flak', 'c_obelisk', 'c_wall',
      'acolyte', 'zealot', 'seeker', 'c_engineer', 'raider', 'scorpion', 'inferno', 'shade', 'prism', 'c_harvester', 'wraith', 'c_mcv',
    ], 4);
    this.holdSuperweapon(aegis, 'ionStrike');
    this.objective('silo', 'Build a Rift Missile Silo.');
    this.objective('hq', 'Destroy Bastion Prime, the Coalition command center.');
    this.beacon('hq', hq, 'BASTION PRIME', '#ff6a4a');
    this.loseWhenWiped('The Covenant\'s last army has fallen.');
    this.when(() => !me.has('c_yard') && !this.units(me).some((u) => !!u.def.mcv) && this.myStructures().length === 0, () => this.defeat('The MCV was destroyed.'));
    this.reveal(HQ.x, HQ.z, 8);
    this.dialogue([
      ['commander', 'Geneva. The heart of the Coalition, Harbinger. Bastion Prime. Hale commands his war from beneath that lake.'],
      ['commander', 'Raise a Temple, then a silo. When the Rift Missile flies, their heart stops.'],
      ['intel', 'Their Ion Uplink watches this whole valley. The Oracle feels it turning toward us.'],
    ], 1);
    this.after(22, () =>
      this.hint('The <b>Rift Missile Silo</b> requires a <b>Temple of the Rift</b>. Once built it charges for five and a half minutes, then click its icon to launch.<br>The <b>Prism Tank</b> and <b>Shade</b> are also unlocked at the Temple.', 22),
    );

    // Voss joins the channel
    this.after(150, () => {
      this.voss('Harbinger. This is Dr. Imani Voss. I built half the Coalition\'s defences. Now I will tell you how to break them.');
      this.voss('Bastion Prime draws on a single power grid. Kill enough reactors and the Rail Spires and the Uplink both go dark.', 9);
      this.after(18, () => {
        this.reveal(HQ.x, HQ.z, 18);
        this.reveal(UPLINK.x, UPLINK.z, 5);
        this.objective('uplink', 'Destroy the Coalition Ion Uplink.', true);
        if (this.isOpen('uplink')) this.beacon('uplink', uplink, 'ION UPLINK', '#ff4a3a');
      });
    });
    this.after(210, () => this.say('Voss. I trusted you with my soldiers\' lives. You will hang for every one of them.', 'enemy'));

    // Ion strikes
    const arm = (sec: number) =>
      this.countdown('ION STRIKE', sec, () => {
        this.ionStrike();
        if (!uplink.dead) this.after(10, () => arm(STRIKE_GAP));
      });
    this.after(60, () => {
      this.say('The Uplink is charging. The first strike comes in ten minutes, Harbinger.', 'intel');
      arm(FIRST_STRIKE - 60);
    });
    let stalled = false;
    let warned = -1;
    this.every(1, () => {
      if (uplink.dead || this.countdownLeft() <= 0) return;
      if (aegis.lowPower) {
        this.delayCountdown(1);
        if (!stalled) this.say('Their power grid is failing! The Uplink has stopped charging.', 'intel');
        stalled = true;
      } else stalled = false;
      if (this.countdownLeft() <= 60 && warned !== this.strikes) {
        warned = this.strikes;
        this.say('Sixty seconds until the Ion strike. Scatter what you can.', 'intel');
      }
    });
    this.when(() => uplink.dead, () => {
      this.objective('uplink', 'Destroy the Coalition Ion Uplink.', true);
      this.complete('uplink');
      this.stopCountdown();
      this.say('The Uplink is gone. Their eye in the sky is blind.', 'intel');
      this.voss('Beautiful. Marcus will be apoplectic.', 4);
    });

    // the silo
    this.on('buildingPlaced', (e) => {
      if (e.building.owner === me && e.building.def.id === 'c_silo') {
        scaleHp(e.building, 1.8);
        this.voss('I reinforced the silo design with Coalition armour plating. It will survive one Ion strike. Barely.');
      }
    });
    this.when(() => me.has('c_silo'), () => this.siloReady());
    this.on('superweaponLaunch', (e) => {
      if (e.player !== me || e.id !== 'riftMissile') return;
      if (!this.launched) {
        this.launched = true;
        this.dialogue([
          ['commander', 'The Rift ascends! Let the heavens witness!'],
          ['enemy', 'Missile inbound! All personnel, brace, brace, brace!'],
        ]);
        this.after(10, () => {
          this.say('Brothers of the Flame Legion! For the Rift, and for our dead! Ride!', 'ally');
          this.reinforce(me, ['raider', 'raider', 'raider', 'raider', 'inferno', 'inferno', 'inferno', 'prism'], 3, 60, 30, 50);
        });
      }
    });
    this.hunt(guard, [me], 4);

    // victory
    this.when(() => hq.dead, () => {
      this.complete('hq');
      if (!this.isComplete('silo')) this.complete('silo');
      const t = this.dialogue([
        ['enemy', 'This is Hale... Bastion Prime is... all stations, this is...'],
        ['intel', 'Bastion Prime has fallen. The Coalition\'s voice is silent across every frequency.'],
        ['commander', 'Nine years ago the Rift opened a door, and the world was afraid. Today, the world walks through it.'],
      ], 2);
      this.voss('Welcome to the new world, Harbinger.', t);
      this.after(t + 4, () => this.say('The Oracle shows me nothing beyond this day. Only light. So much light.', 'intel'));
      this.after(t + 10, () => this.victory());
    });
    this.after(300, () => this.say('The Covenant is at my door. Good. Let them come to Geneva and die here.', 'enemy'));
  }

  siloReady() {
    if (this.siloBuilt) return;
    this.siloBuilt = true;
    const { guard } = this.r;
    this.complete('silo');
    this.dialogue([
      ['intel', 'The silo stands! The missile is waking. Five and a half minutes, Harbinger.'],
      ['enemy', 'They have a launch site. All armoured units, destroy that silo. Now.'],
      ['commander', 'Every Coalition tank will come for it. Let them break upon us.'],
    ]);
    this.after(20, () => {
      const silo = this.buildings(this.me, (b) => b.def.id === 'c_silo')[0];
      const to = silo ?? { x: HOME.x, z: HOME.z };
      this.wave(guard, ['titan', 'titan', 'titan', 'guardian', 'guardian', 'guardian', 'guardian', 'rocketeer', 'rocketeer', 'rocketeer'], { x: 60, z: 104 }, to);
      this.wave(guard, ['guardian', 'guardian', 'tempest', 'tempest', 'rifleman', 'rifleman', 'rifleman'], { x: 4, z: 40 }, to);
    });
  }

  ionStrike() {
    const { aegis, me, uplink } = this.r;
    if (uplink.dead) return;
    this.strikes++;
    const prefer = ['c_silo', 'c_temple', 'c_yard', 'c_factory'];
    let target: Building | null = null;
    for (const id of prefer) {
      target = this.buildings(me, (b) => b.def.id === id)[0] ?? null;
      if (target) break;
    }
    const t = target ?? this.buildings(me)[0] ?? this.units(me)[0];
    if (!t) return;
    this.fireSuperweapon(aegis, 'ionStrike', t.x, t.z);
    this.say(this.strikes === 1 ? 'The light from the sky! It burns!' : 'Another Ion strike! Destroy that Uplink!', 'intel');
  }

  override cheatStep() {
    const { me, hq, guard } = this.r;
    const mcv = this.units(me, (u) => !!u.def.mcv)[0];
    if (mcv && !me.has('c_yard')) {
      if (mcv.order.type !== 'deploy') mcv.issue({ type: 'deploy' }, this.world);
      return;
    }
    const yard = this.buildings(me, (b) => b.def.id === 'c_yard')[0];
    if (!yard) return;
    for (const u of this.units(guard)) this.world.kill(u, null);
    if (!me.has('c_silo')) {
      try {
        put(this.world, me, 'c_silo', yard.tx + 5, yard.tz + 1, 8);
      } catch {
        /* retry */
      }
      return;
    }
    if (this.t > 200 && !this.r.uplink.dead) {
      this.world.kill(this.r.uplink, null);
      return;
    }
    if (this.t > 260) this.world.damage(hq, 800, null);
  }
}

function create() {
  const seed = 12205;
  const map = buildMap(
    { id: 'cov05', name: 'Lake Geneva', description: '', w: 112, h: 112, seed, theater: 'temperate', players: 2, cliffs: 0.3, water: 0.1, trees: 0.6, ore: 0.55, river: false, roads: true, layout: 'diagonal' },
    (e) => {
      e.blob(LAKE.x, LAKE.z, 13, Terrain.Water);
      e.blob(LAKE.x + 10, LAKE.z - 8, 8, Terrain.Water);
      e.blob(LAKE.x - 9, LAKE.z + 9, 7, Terrain.Water);
      e.clear(HOME.x, HOME.z, 13);
      e.clear(HQ.x, HQ.z, 17);
      e.rect(HQ.x - 11, HQ.z - 12, HQ.x + 12, HQ.z + 11, Terrain.Concrete);
      e.clear(UPLINK.x - 1, UPLINK.z + 1, 5, Terrain.Concrete);
      // causeway across the lake and the two shore roads
      e.road([{ x: 34, z: 76 }, { x: LAKE.x - 4, z: LAKE.z + 2 }, { x: LAKE.x + 6, z: LAKE.z - 4 }, { x: 80, z: 40 }]);
      e.road([{ x: HOME.x + 6, z: HOME.z - 6 }, { x: 34, z: 76 }]);
      e.road([{ x: 80, z: 40 }, { x: HQ.x - 2, z: HQ.z + 12 }]);
      e.path([{ x: HOME.x, z: HOME.z - 10 }, { x: 14, z: 60 }, { x: 26, z: 34 }, { x: 56, z: 26 }, { x: HQ.x - 14, z: HQ.z }], 4);
      e.path([{ x: HOME.x + 10, z: HOME.z }, { x: 50, z: 92 }, { x: 76, z: 86 }, { x: 96, z: 62 }, { x: HQ.x + 4, z: HQ.z + 14 }], 4);
      e.path([{ x: HQ.x + 10, z: HQ.z - 8 }, { x: UPLINK.x - 2, z: UPLINK.z + 3 }], 3);
      e.path([{ x: 60, z: 104 }, { x: 50, z: 92 }], 3);
      e.path([{ x: 4, z: 40 }, { x: 14, z: 50 }], 3);
      e.path([{ x: 3, z: 60 }, { x: 14, z: 60 }], 3);
      e.ore(32, 104, 4);
      e.ore(6, 78, 4);
      e.ore(40, 88, 3.5, true);
      e.ore(30, 44, 4);
      e.ore(88, 76, 4);
      e.ore(104, 44, 4);
      e.ore(70, 12, 4);
      e.scatter(['lamp', 'fence', 'ruin'], 30, 70, 8, 12);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'The Harbinger', faction: 'covenant', color: COLOR.covenant, team: 1, human: true, credits: 10000 },
    { name: 'Aegis Coalition', faction: 'aegis', color: COLOR.aegis, team: 2, credits: 5000, techLimit: 3 },
    { name: 'Bastion Guard', faction: 'aegis', color: COLOR.aegis, team: 2 },
  ], seed);
  const [neutral, me, aegis, guard] = players;
  for (const [x, z] of [[28, 66], [36, 64], [26, 72]] as [number, number][]) put(world, neutral, 'n_bunker', x, z);
  const hx = HQ.x, hz = HQ.z;
  const hqB = layout(world, aegis, hx, hz, [
    ['a_yard', -1, -1],
    ['a_power', -10, -11],
    ['a_power', -7, -11],
    ['a_power', -4, -11],
    ['a_power', -1, -11],
    ['a_power', 2, -11],
    ['a_power', 5, -11],
    ['a_power', 10, -6],
    ['a_power', 10, -3],
    ['a_power', 10, 0],
    ['a_power', 10, 3],
    ['a_power', 13, -6],
    ['a_power', 13, -3],
    ['a_refinery', -8, 4],
    ['a_refinery', 5, 5],
    ['a_barracks', -6, -6],
    ['a_factory', -6, -1],
    ['a_radar', 3, -6],
    ['a_techlab', 3, -2],
    ['a_airfield', 0, 5],
    ['a_repair', -4, 8],
    ['a_railtower', -12, -4],
    ['a_railtower', -12, 3],
    ['a_railtower', -2, 12],
    ['a_turret', -13, 0],
    ['a_turret', -9, 10],
    ['a_turret', 6, 11],
    ['a_turret', 12, 8],
    ['a_sam', -3, -8],
    ['a_sam', 7, -8],
    ['a_sam', 2, 9],
    ['a_tower', -12, -9],
    ['a_tower', -11, 8],
    ['a_tower', 9, 10],
  ]);
  const hq = hqB[0];
  scaleHp(hq, 1.5);
  const uplink = put(world, aegis, 'a_uplink', UPLINK.x - 2, UPLINK.z - 1, 3);
  put(world, aegis, 'a_railtower', UPLINK.x - 4, UPLINK.z + 4, 2);
  put(world, aegis, 'a_sam', UPLINK.x + 1, UPLINK.z + 4, 2);
  wallLine(world, aegis, 'a_wall', hx - 14, hz - 8, hx - 14, hz - 2);
  wallLine(world, aegis, 'a_wall', hx - 14, hz + 2, hx - 14, hz + 7);
  troops(world, aegis, ['a_harvester', 'a_harvester'], hx - 5, hz + 12);
  troops(world, aegis, ['titan', 'guardian', 'guardian', 'guardian', 'guardian', 'tempest', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'rocketeer', 'marksman'], hx - 6, hz + 6);
  aegis.ai = new SkirmishAI(world, aegis, 'hard', { attackDelay: 480, aggression: 0.85, techLimit: 3, allowSuperweapons: false });
  troops(world, me, ['c_mcv'], HOME.x, HOME.z, -Math.PI / 4);
  troops(world, me, ['scorpion', 'scorpion', 'scorpion', 'scorpion', 'inferno', 'inferno', 'inferno', 'raider', 'raider', 'raider', 'shade', 'shade'], HOME.x + 7, HOME.z - 6, -Math.PI / 4);
  troops(world, me, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot', 'zealot', 'seeker', 'seeker', 'seeker', 'seeker', 'c_engineer'], HOME.x + 2, HOME.z - 8, -Math.PI / 4);
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new RiftAscendant(h, { me, aegis, guard, hq, uplink }) };
}

export const covenant05: MissionDef = {
  id: 'covenant_05',
  faction: 'covenant',
  index: 5,
  name: 'Rift Ascendant',
  codename: 'The Final Trial',
  location: 'Bastion Prime, Lake Geneva',
  briefing: `This is the hour the Prophet has waited nine years for, Harbinger.

Bastion Prime lies beneath the shore of Lake Geneva. From there General Hale commands every Coalition army on Earth. Cut off the head, and the body falls.

You will raise a base on the southern shore, build a Temple of the Rift, and beneath it a silo. When the Rift Missile flies, Bastion Prime will be the first place on Earth to be reborn.

The Coalition will not wait. Their Ion Uplink, built from the very designs you delivered to us, will strike at whatever you value most. Destroy it, or starve it of power.

You do not fight alone. A friend who once served the Coalition has joined the faithful. Listen to her.`,
  objectives: ['Build a Rift Missile Silo.', 'Destroy Bastion Prime, the Coalition command center.', 'Optional: destroy the Coalition Ion Uplink.'],
  music: 'battle3',
  create,
};
