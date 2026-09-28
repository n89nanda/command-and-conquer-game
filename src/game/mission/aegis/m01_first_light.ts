// AEGIS 01 — FIRST LIGHT
// Small-squad introduction: no base. Teaches selection, movement, attacking, attack-move
// and control groups. Find the wrecked survey camp, survive an ambush at the Kessel bridge
// and destroy the Covenant outpost holding the survey team.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, troops, wallLine, type Pt } from '../common';

const LZ: Pt = { x: 11, z: 11 };
const CAMP: Pt = { x: 37, z: 13 };
const WRECK: Pt = { x: 15, z: 38 };
const BRIDGE: Pt = { x: 47, z: 30 };
const OUTPOST: Pt = { x: 64, z: 50 };

interface Refs {
  me: Player;
  cov: Player;
  outpost: Building[];
  turret: Building;
  looters: Unit[];
}

class FirstLight extends CampaignScript {
  refs: Refs;
  stage = 0;
  constructor(host: MissionHost, refs: Refs) {
    super(host, AEGIS_CAST);
    this.refs = refs;
    this.checkpoints = [CAMP, WRECK, BRIDGE, OUTPOST];
  }

  start() {
    const { cov } = this.refs;
    this.host.alwaysRadar = true;
    this.allowOnly([]);
    this.loseWhenWiped('Squad Vanguard has been wiped out.');
    this.objective('camp', 'Reach the Kessel survey camp.');
    this.beacon('camp', CAMP, 'SURVEY CAMP');
    this.reveal(CAMP.x, CAMP.z, 5);
    const t = this.dialogue([
      ['commander', 'Captain Okafor, you are on the ground. Survey Team Kestrel went dark six hours ago.'],
      ['intel', 'Their last ping came from the survey camp, east of your landing zone. Something is jamming our uplink.'],
      ['ally', 'Copy, General. Vanguard is moving out.'],
    ], 1);
    this.hint(
      '<b>Welcome, Commander.</b><br>Left-click a unit to <b>select</b> it, or <b>drag a box</b> to select a group.<br><b>Right-click</b> the ground to move. Scroll with the <kbd>Arrow keys</kbd>, screen edges or middle-mouse drag; zoom with the wheel.',
    );
    this.after(t + 14, () => {
      if (!this.isComplete('camp')) this.hint('Tip: the survey camp is marked east of the landing zone. Select everyone with a box and <b>right-click</b> near it.', 14);
    });

    // --- the camp
    this.when(() => this.anyNear(this.me, CAMP.x, CAMP.z, 9), () => {
      this.say('Movement in the camp. Covenant looters!', 'ally');
      this.hint('<b>Right-click an enemy</b> to attack it. Units also return fire on their own when threatened.', 12);
    });
    this.when(() => this.alive(this.refs.looters).length === 0 && this.anyNear(this.me, CAMP.x, CAMP.z, 7), () => this.campCleared());

    // a patrol stumbles onto a squad that dawdles at the landing zone
    this.after(150, () => {
      if (this.stage > 0) return;
      this.say('Covenant patrol closing on the landing zone!', 'ally');
      this.wave(cov, ['acolyte', 'acolyte', 'acolyte'], { x: 30, z: 26 }, LZ);
      this.hunt(cov, [this.me], 6);
    });

    // --- optional: the downed Hawk
    this.after(40, () => {
      if (this.isComplete('wreck')) return;
      this.say('Commander, a Hawk went down south-west of the camp two days ago. Its gun camera may still be intact.', 'intel');
      this.objective('wreck', 'Recover the flight recorder from the downed Hawk.', true);
      this.beacon('wreck', WRECK, 'DOWNED HAWK', '#9fd8ff');
      this.reveal(WRECK.x, WRECK.z, 4);
    });
    this.when(() => this.anyNear(this.me, WRECK.x, WRECK.z, 3), () => {
      this.objective('wreck', 'Recover the flight recorder from the downed Hawk.', true);
      this.complete('wreck');
      this.reveal(OUTPOST.x, OUTPOST.z, 12);
      const tt = this.refs.turret;
      if (!tt.dead) tt.hp = Math.min(tt.hp, tt.maxHp * 0.5);
      this.dialogue([
        ['intel', 'Got it. The gun camera caught the Covenant outpost from the air. Uploading to your tactical map.'],
        ['intel', 'Their stinger turret took a Hawk missile before the crash. It is badly damaged.'],
      ]);
    });

    // --- bridge ambush
    this.when(() => this.stage >= 1 && this.anyNear(this.me, BRIDGE.x, BRIDGE.z, 8), () => this.ambush());
    // --- the outpost
    this.when(() => this.anyNear(this.me, OUTPOST.x, OUTPOST.z, 16), () => {
      this.dialogue([
        ['ally', 'Eyes on the outpost. Stinger turret covering the north road.'],
        ['commander', 'Lead with the Guardians, Captain. Keep the infantry behind the armour until that turret is scrap.'],
      ]);
    });
    this.when(() => this.stage >= 1 && this.alive(this.refs.outpost).length === 0, () => this.outpostDown());

    // enemy mood
    this.on('buildingDied', (e) => {
      if (e.building.owner === cov && e.building.def.id === 'c_barracks') this.say('You burn our shrine, but you cannot burn the faith. The Rift remembers.', 'enemy');
    });
  }

  campCleared() {
    this.complete('camp');
    this.stage = 1;
    const { me } = this.refs;
    const t = this.dialogue([
      ['ally', 'Camp is clear. Tents burned, the lab trucks stripped. No bodies. They took the survey team alive.'],
      ['intel', 'I am picking up a Covenant carrier signal south-east, across the Kessel river. An outpost.'],
      ['commander', 'Then that is where our people are. Armour is inbound, Captain. Take that outpost apart.'],
    ]);
    this.after(t - 2, () => {
      this.objective('outpost', 'Destroy the Covenant outpost across the Kessel river.');
      this.beacon('outpost', OUTPOST, 'COVENANT OUTPOST', '#ff6a4a');
      this.reveal(BRIDGE.x, BRIDGE.z, 4);
      this.reinforce(me, ['guardian', 'guardian', 'guardian', 'rifleman', 'rifleman'], 20, 3, CAMP.x - 5, CAMP.z + 2);
      this.hint(
        '<b>Reinforcements!</b> Drag a box around your whole force. Press <kbd>A</kbd> then left-click the ground to <b>attack-move</b>: units advance and engage anything they meet on the way.<br>Press <kbd>Ctrl</kbd>+<kbd>1</kbd> to save a <b>control group</b>, then <kbd>1</kbd> to reselect it (double-tap to jump to it).',
      );
    });
  }

  ambush() {
    const { cov } = this.refs;
    this.say('Contact! Ambush on the bridge!', 'ally');
    this.after(1.5, () => this.say('You trespass on holy ground, soldier of Aegis. The Rift sees you.', 'enemy'));
    this.wave(cov, ['acolyte', 'acolyte', 'acolyte', 'acolyte', 'raider'], { x: 60, z: 34 }, BRIDGE);
    this.wave(cov, ['seeker', 'seeker', 'acolyte'], { x: 40, z: 42 }, BRIDGE);
    this.hunt(cov, [this.me], 5);
    this.hint(
      'Match your weapons to the target: <b>Riflemen</b> shred infantry, <b>Rocket Troopers</b> and <b>Guardians</b> crack vehicles. Tanks can <b>crush</b> infantry by driving over them. Press <kbd>S</kbd> to stop a selected unit.',
      18,
    );
    // the outpost shrine keeps sending zealots while it stands
    this.every(55, () => {
      const bar = this.refs.outpost.find((b) => b.def.id === 'c_barracks' && !b.dead);
      if (!bar) return;
      this.wave(cov, ['acolyte', 'acolyte'], { x: bar.x, z: bar.z + 2 }, BRIDGE);
    });
  }

  outpostDown() {
    this.objective('outpost', 'Destroy the Covenant outpost across the Kessel river.');
    this.complete('outpost');
    this.hint(null);
    const { me, cov } = this.refs;
    // mop up remaining guards so the ending is clean
    for (const u of this.units(cov)) if (Math.hypot(u.x - OUTPOST.x, u.z - OUTPOST.z) < 18) u.issue({ type: 'move', x: 78, z: 62 }, this.world);
    const survivors = this.spawn(me, ['a_engineer', 'a_engineer', 'rifleman'], OUTPOST.x + 1, OUTPOST.z + 2);
    for (const s of survivors) s.hp = s.maxHp * 0.5;
    this.say('Survivors! Kestrel team, crawling out of the rubble.', 'ally');
    const t = this.dialogue([
      ['intel', 'They were being moved deeper into the zone. They mention a place called the Wound. And a missile.'],
      ['commander', 'Good work, Commander. Get them to the medics. This war just got a name.'],
    ], 3);
    this.after(t + 1, () => this.victory());
  }

  override cheatStep() {
    const mine = this.units(this.me);
    const hit = (x: number, z: number, r: number) => {
      for (const u of this.enemyPlayers().flatMap((p) => this.unitsInArea(p, x, z, r))) this.world.kill(u, null);
    };
    if (!this.isComplete('camp')) {
      this.teleport(mine, CAMP.x, CAMP.z);
      hit(CAMP.x, CAMP.z, 12);
    } else if (!this.isComplete('wreck')) {
      this.teleport(mine.slice(0, 1), WRECK.x, WRECK.z);
    } else if (this.refs.outpost.some((b) => !b.dead)) {
      this.teleport(mine, BRIDGE.x - 2, BRIDGE.z);
      hit(BRIDGE.x, BRIDGE.z, 20);
      if (this.t > 200) for (const b of this.refs.outpost) this.world.kill(b, null);
    }
  }
}

function create() {
  const seed = 2101;
  const map = buildMap(
    { id: 'aegis01', name: 'Kessel Valley', description: '', w: 80, h: 64, seed, theater: 'temperate', players: 2, cliffs: 0.3, water: 0.05, trees: 0.75, ore: 0.25, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.river([{ x: 18, z: 64 }, { x: 33, z: 44 }, { x: 48, z: 30 }, { x: 62, z: 22 }, { x: 80, z: 15 }], 3.2);
      e.clear(LZ.x, LZ.z, 6);
      e.clear(CAMP.x, CAMP.z, 5.5, Terrain.Dirt);
      e.clear(WRECK.x, WRECK.z, 3);
      e.clear(OUTPOST.x, OUTPOST.z, 9.5);
      e.clear(BRIDGE.x + 7, BRIDGE.z + 6, 4, Terrain.Dirt, false);
      e.road([{ x: LZ.x + 2, z: LZ.z + 1 }, { x: 24, z: 12 }, { x: CAMP.x, z: CAMP.z + 1 }, { x: 44, z: 22 }, { x: BRIDGE.x, z: BRIDGE.z }, { x: 52, z: 38 }, { x: 58, z: 45 }, { x: OUTPOST.x - 1, z: OUTPOST.z - 1 }]);
      e.path([{ x: LZ.x, z: LZ.z + 3 }, { x: 13, z: 26 }, { x: WRECK.x, z: WRECK.z }], 3);
      e.path([{ x: 60, z: 34 }, { x: 55, z: 36 }], 3);
      e.path([{ x: 40, z: 42 }, { x: 47, z: 36 }], 3);
      e.ore(26, 22, 3);
      e.ore(72, 40, 3.5);
      e.ore(54, 56, 3, true);
      e.doodad('wreck', WRECK.x + 0.5, WRECK.z + 0.5, false, 1.4);
      e.scatter(['barrel', 'ruin', 'fence', 'wreck'], CAMP.x, CAMP.z, 4.5, 12);
      e.scatter(['pine', 'tree', 'tree'], 24, 30, 6, 30, true);
      e.scatter(['barrel', 'lamp', 'fence'], OUTPOST.x, OUTPOST.z, 8, 8);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Squad Vanguard', faction: 'aegis', color: COLOR.aegis, team: 1, human: true },
    { name: 'Rift Covenant', faction: 'covenant', color: COLOR.covenant, team: 2 },
  ], seed);
  const [neutral, me, cov] = players;
  world.addBuilding(neutral, 'n_bunker', CAMP.x - 4, CAMP.z - 3);
  world.addBuilding(neutral, 'n_bunker', CAMP.x + 2, CAMP.z - 4);
  const outpost = layout(world, cov, OUTPOST.x, OUTPOST.z, [
    ['c_barracks', -4, -3],
    ['c_power', 1, -5],
    ['c_power', 4, -1],
    ['c_radar', 0, 2],
  ]);
  const turret = world.addBuilding(cov, 'c_turret', OUTPOST.x - 6, OUTPOST.z - 5);
  outpost.push(turret);
  wallLine(world, cov, 'c_wall', OUTPOST.x - 7, OUTPOST.z - 2, OUTPOST.x - 7, OUTPOST.z + 2);
  troops(world, me, ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'scout'], LZ.x, LZ.z, 0);
  const looters = troops(world, cov, ['acolyte', 'acolyte', 'acolyte'], CAMP.x + 1, CAMP.z + 1);
  troops(world, cov, ['acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot', 'seeker'], OUTPOST.x - 1, OUTPOST.z - 1);
  for (const u of looters) u.tag = 'guard';
  world.updateFog();
  return { world, script: (h: MissionHost) => new FirstLight(h, { me, cov, outpost, turret, looters }) };
}

export const aegis01: MissionDef = {
  id: 'aegis_01',
  faction: 'aegis',
  index: 1,
  name: 'First Light',
  codename: 'Operation First Light',
  location: 'Kessel Valley, Carpathian Exclusion Zone',
  briefing: `Commander, welcome to the Aegis Coalition. You have arrived at the worst possible time.

Nine years ago the Riftfall scarred the Earth and seeded it with Riftite. The crystal fuels our world. It is also killing it. The Rift Covenant calls that a miracle.

Six hours ago Survey Team Kestrel stopped transmitting from the Kessel Valley, deep in the Carpathian Exclusion Zone. Their last message was a single word: "Covenant."

Captain Rhea Okafor and Squad Vanguard are on the ground. You will command them. Locate the survey camp, find out what happened, and bring our people home.

Keep your troops together. The Covenant fights like wolves: they hunt the stragglers first.`,
  objectives: ['Reach the Kessel survey camp.', 'Find and destroy the Covenant outpost holding Survey Team Kestrel.', 'Keep Squad Vanguard alive.'],
  music: 'tension',
  create,
};
