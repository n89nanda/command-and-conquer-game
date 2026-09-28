// COVENANT 03 — STOLEN FIRE
// Stealth infiltration, no base. Shade stealth tanks slip past Aurora Station's defences, knock out a
// reactor to silence the Rail Spires, clear the road for the Technicians, and capture the Tech Center.
// Then hold it while the Ion Uplink research uploads; Brother Kade rides to the rescue.

import type { Building } from '../../Building';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { Unit } from '../../Unit';
import type { MissionDef, MissionHost } from '../MissionScript';
import { COLOR, COVENANT_CAST, CampaignScript, buildMap, layout, makeWorld, put, troops, wallLine, type Pt } from '../common';

const LZ: Pt = { x: 10, z: 78 };
const STATION: Pt = { x: 48, z: 28 };
const REACTORS: Pt = { x: 30, z: 14 };
const GATE: Pt = { x: 48, z: 44 };
const UPLOAD_TIME = 120;

interface Refs {
  me: Player;
  aurora: Player;
  response: Player;
  techCenter: Building;
  reactors: Building[];
  patrols: { units: Unit[]; route: Pt[] }[];
}

class StolenFire extends CampaignScript {
  r: Refs;
  captured = false;
  constructor(host: MissionHost, refs: Refs) {
    super(host, COVENANT_CAST);
    this.r = refs;
    this.checkpoints = [REACTORS, GATE, STATION];
  }

  technicians() {
    return this.units(this.me, (u) => !!u.def.engineer);
  }

  start() {
    const { me, aurora, techCenter } = this.r;
    this.host.alwaysRadar = true;
    this.allowOnly([]);
    for (const p of this.r.patrols) this.patrol(p.units, p.route, 6);
    this.objective('capture', 'Capture the Coalition Tech Center with a Technician.');
    this.objective('keep', 'At least one Technician must survive until the Tech Center is taken.');
    this.beacon('capture', techCenter, 'TECH CENTER');
    this.beacon('reactors', REACTORS, 'REACTORS', '#ff6a4a');
    this.reveal(STATION.x, STATION.z, 6);
    this.reveal(REACTORS.x, REACTORS.z, 5);
    this.dialogue([
      ['commander', 'Aurora Station. The Coalition hides its most precious secret here, in the ice. The designs for their Ion Uplink.'],
      ['intel', 'Our friend inside the Coalition has done her part. The Tech Center\'s integrity field is down. A Technician can walk in.'],
      ['intel', 'But the road to it is watched by guard towers, and by Rail Spires that can split a tank in two.'],
      ['commander', 'You have the Shades, Harbinger. The Coalition cannot kill what it cannot see.'],
    ], 1);
    this.after(22, () =>
      this.hint('<b>Shade Stealth Tanks</b> are <b>invisible</b> to the enemy until they fire, or until an enemy stands right next to them. After firing they stay visible for a moment. Badly damaged Shades cannot cloak.<br><b>Rail Spires</b> need <b>power</b>. The reactor bank is north-west of the station.', 24),
    );
    this.after(50, () => this.hint('Keep the <b>Technicians</b> back at the landing zone until the road is clear. Guard towers shred infantry.', 12));

    // failure
    this.when(() => !this.captured && this.technicians().length === 0, () => {
      this.fail('keep');
      this.defeat('Every Technician has fallen. The designs are lost.');
    });
    this.when(() => techCenter.dead, () => {
      this.fail('capture');
      this.defeat('The Tech Center has been destroyed.');
    });
    this.loseWhenWiped();

    // power
    this.when(() => aurora.lowPower, () => {
      this.clearBeacon('reactors');
      this.dialogue([
        ['intel', 'Their reactors are failing! The Rail Spires are dark.'],
        ['commander', 'Now the towers on the south road. Clear a path for the Technicians.'],
      ]);
    });
    this.on('damaged', (e) => {
      if (e.entity === techCenter && e.attacker?.owner === me && techCenter.hp < techCenter.maxHp * 0.3) this.say('Do not destroy the Tech Center, Harbinger! We need it whole.', 'intel');
    });
    this.after(200, () => {
      if (this.captured) return;
      this.say('The ice is quiet tonight. Too quiet. Aurora, run a sensor sweep.', 'enemy');
      this.after(6, () => {
        this.say('A Coalition sweep team is heading for the landing zone. Protect the Technicians!', 'intel');
        this.wave(this.r.response, ['scout', 'scout', 'rifleman', 'rifleman', 'rifleman'], { x: 8, z: 46 }, LZ);
        this.hunt(this.r.response, [me], 5);
      });
    });
    this.on('captured', (e) => {
      if (e.building === techCenter && e.to === me) this.seized();
    });
  }

  seized() {
    if (this.captured) return;
    this.captured = true;
    const { me, response, techCenter } = this.r;
    this.complete('capture');
    this.complete('keep');
    techCenter.hp = Math.max(techCenter.hp, techCenter.maxHp * 0.6);
    this.clearBeacon('reactors');
    this.objective('upload', 'Hold the Tech Center until the upload completes.');
    this.beacon('upload', techCenter, 'HOLD', '#6aff8a');
    this.countdown('DATA UPLOAD', UPLOAD_TIME, () => this.uploaded());
    this.dialogue([
      ['intel', 'We are inside! The Ion Uplink schematics are flowing to the Oracle.'],
      ['enemy', 'Aurora has been breached! All units, retake that Tech Center. If you cannot retake it, destroy it.'],
      ['intel', 'And something else. The Coalition has learned of the Wound. They are coming for the Missile.'],
      ['commander', 'Then the Rift will be ready for them. Hold, Harbinger. Kade is on his way.'],
    ]);
    this.hint('Hold the Tech Center. <b>Right-click</b> it with a Technician to repair it if it gets low.', 12);
    this.hunt(response, [me], 4);
    const N: Pt = { x: 48, z: 3 }, E: Pt = { x: 85, z: 28 };
    this.after(8, () => this.wave(response, ['guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rocketeer'], N, techCenter));
    this.after(20, () => {
      this.say('Harbinger! The Flame Legion rides!', 'ally');
      this.reinforce(me, ['raider', 'raider', 'raider', 'scorpion', 'scorpion', 'inferno', 'inferno'], 3, 64, GATE.x - 6, GATE.z + 4);
    });
    this.after(45, () => this.wave(response, ['guardian', 'guardian', 'scout', 'scout', 'rocketeer', 'rocketeer'], E, techCenter));
    this.after(75, () => this.wave(response, ['guardian', 'guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rifleman'], N, techCenter));
    this.after(100, () => this.say('Nearly there. The Oracle drinks the last of it.', 'intel'));
  }

  uploaded() {
    const { techCenter, me } = this.r;
    if (techCenter.dead || techCenter.owner !== me) return;
    this.complete('upload');
    this.stopCountdown();
    const t = this.dialogue([
      ['intel', 'The upload is complete. Every secret of their orbital cannon is ours.'],
      ['commander', 'Burn the station behind you, Harbinger. Let them wonder what we took.'],
    ], 1);
    this.after(t, () => this.victory());
  }

  override cheatStep() {
    const { reactors, techCenter, response } = this.r;
    const r = this.alive(reactors)[0];
    if (r && this.alive(reactors).length > 4) {
      this.world.kill(r, null);
      return;
    }
    if (!this.captured) {
      const tech = this.technicians()[0];
      this.cheatClear(techCenter.x, techCenter.z, 10);
      if (tech && tech.order.type !== 'enter') {
        this.teleport([tech], techCenter.x, techCenter.z + 2.5);
        tech.issue({ type: 'enter', target: techCenter }, this.world);
      }
      return;
    }
    for (const u of this.units(response)) this.world.kill(u, null);
    this.skipCountdown(3);
  }
}

function create() {
  const seed = 8803;
  const map = buildMap(
    { id: 'cov03', name: 'Aurora Station', description: '', w: 88, h: 88, seed, theater: 'winter', players: 2, cliffs: 0.5, water: 0.1, trees: 0.55, ore: 0.2, river: false, roads: false, layout: 'diagonal' },
    (e) => {
      e.clear(LZ.x, LZ.z, 6);
      e.clear(STATION.x, STATION.z, 14);
      e.rect(STATION.x - 10, STATION.z - 10, STATION.x + 10, STATION.z + 10, Terrain.Concrete);
      e.clear(REACTORS.x, REACTORS.z, 6.5, Terrain.Concrete);
      e.clear(GATE.x, GATE.z + 3, 4, Terrain.Dirt, false);
      e.road([{ x: 20, z: 72 }, { x: 30, z: 60 }, { x: 42, z: 50 }, { x: GATE.x, z: GATE.z }, { x: STATION.x, z: STATION.z + 4 }]);
      e.path([{ x: LZ.x, z: LZ.z }, { x: 20, z: 72 }], 4);
      e.path([{ x: LZ.x - 2, z: LZ.z - 4 }, { x: 8, z: 50 }, { x: 14, z: 30 }, { x: 24, z: 20 }, { x: REACTORS.x, z: REACTORS.z + 4 }], 3);
      e.path([{ x: REACTORS.x + 6, z: REACTORS.z }, { x: STATION.x - 12, z: STATION.z - 6 }], 3);
      e.path([{ x: 48, z: 3 }, { x: STATION.x, z: STATION.z - 12 }], 4);
      e.path([{ x: 85, z: 28 }, { x: STATION.x + 12, z: STATION.z }], 4);
      e.path([{ x: 3, z: 64 }, { x: 20, z: 72 }], 3);
      e.ore(20, 44, 3.5, true);
      e.ore(70, 62, 4);
      e.scatter(['pine', 'pine', 'deadTree'], 24, 58, 8, 30, true);
      e.scatter(['lamp', 'barrel', 'fence'], STATION.x, STATION.z, 12, 12);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'The Harbinger', faction: 'covenant', color: COLOR.covenant, team: 1, human: true },
    { name: 'Aurora Station', faction: 'aegis', color: COLOR.aegis, team: 2 },
    { name: 'Coalition Rapid Response', faction: 'aegis', color: COLOR.aegis, team: 2 },
  ], seed);
  const [, me, aurora, response] = players;
  const reactors = layout(world, aurora, REACTORS.x, REACTORS.z, [
    ['a_power', -4, -3],
    ['a_power', -1, -3],
    ['a_power', 2, -3],
    ['a_power', -4, 0],
    ['a_power', -1, 0],
  ]);
  const sx = STATION.x, sz = STATION.z;
  const [techCenter] = layout(world, aurora, sx, sz, [
    ['a_techlab', 0, -6],
    ['a_radar', 6, -2],
    ['a_barracks', -7, -3],
    ['a_factory', -1, 1],
    ['a_tower', -4, 12],
    ['a_tower', 4, 12],
    ['a_turret', 0, 14],
    ['a_railtower', -5, 8],
    ['a_railtower', 5, 8],
    ['a_turret', 12, -2],
    ['a_turret', 12, 3],
    ['a_tower', 0, -12],
    ['a_tower', -12, -4],
  ]);
  techCenter.hp = techCenter.maxHp * 0.45;
  wallLine(world, aurora, 'a_wall', sx - 10, sz + 10, sx - 3, sz + 10);
  wallLine(world, aurora, 'a_wall', sx + 3, sz + 10, sx + 10, sz + 10);
  put(world, aurora, 'a_tower', REACTORS.x + 5, REACTORS.z + 3, 2);
  world.buildingsDirty = true;
  const patrols = [
    { units: troops(world, aurora, ['guardian', 'guardian'], 36, 52), route: [{ x: 34, z: 56 }, { x: GATE.x - 2, z: GATE.z + 3 }] },
    { units: troops(world, aurora, ['rifleman', 'rifleman', 'rifleman', 'rocketeer'], sx - 5, sz + 5), route: [{ x: sx - 6, z: sz + 6 }, { x: sx + 6, z: sz + 6 }, { x: sx + 6, z: sz - 3 }, { x: sx - 6, z: sz - 3 }] },
    { units: troops(world, aurora, ['rifleman', 'rifleman', 'scout'], REACTORS.x, REACTORS.z + 5), route: [{ x: REACTORS.x - 5, z: REACTORS.z + 5 }, { x: REACTORS.x + 6, z: REACTORS.z + 5 }] },
  ];
  troops(world, aurora, ['rifleman', 'rifleman', 'rocketeer'], sx + 2, sz - 2);
  troops(world, me, ['shade', 'shade', 'shade', 'shade'], LZ.x + 2, LZ.z - 2, -Math.PI / 4);
  troops(world, me, ['c_engineer', 'c_engineer', 'c_engineer'], LZ.x - 2, LZ.z + 1, -Math.PI / 4);
  world.updateFog();
  return { world, script: (h: MissionHost) => new StolenFire(h, { me, aurora, response, techCenter, reactors, patrols }) };
}

export const covenant03: MissionDef = {
  id: 'covenant_03',
  faction: 'covenant',
  index: 3,
  name: 'Stolen Fire',
  codename: 'The Third Trial',
  location: 'Aurora Research Station, Svalbard',
  briefing: `The Coalition has a new weapon, Harbinger: a cannon in orbit that burns cities with a beam of light. They call it the Ion Uplink. Its designs sleep in the Tech Center of Aurora Station, deep in the Svalbard ice.

We have a friend inside the Coalition. She has lowered the Tech Center's integrity field for us. A Technician need only reach it.

Reaching it is the problem. Guard towers watch the south road, and two Rail Spires cover the gate. The Spires feed on a reactor bank north-west of the station.

You will take four Shade stealth tanks and three Technicians. The Shades are invisible until they strike. Use that. Starve the Spires, clear the road, and bring a Technician home to the Tech Center.

Then hold. The upload will take time, and the Coalition will not let it go quietly.`,
  objectives: ['Silence the Rail Spires by knocking out a reactor.', 'Capture the Tech Center with a Technician.', 'Hold the Tech Center until the upload completes.'],
  music: 'tension',
  create,
};
