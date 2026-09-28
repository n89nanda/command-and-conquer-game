// AEGIS 05 — IRON TIDE
// Full-scale assault on the fortified Citadel of Ash alongside Col. Brandt's allied division.
// Twist: Dr. Voss defects and blinds Brandt's base for a stealth-tank strike. Save him (optional).

import type { Building } from '../../Building';
import { SkirmishAI } from '../../ai/SkirmishAI';
import { Terrain } from '../../GameMap';
import type { Player } from '../../Player';
import type { MissionDef, MissionHost } from '../MissionScript';
import { AEGIS_CAST, COLOR, CampaignScript, buildMap, layout, makeWorld, put, troops, wallLine, type Pt } from '../common';

const HOME: Pt = { x: 20, z: 84 };
const BRANDT: Pt = { x: 20, z: 22 };
const CITADEL: Pt = { x: 80, z: 52 };
const CENTER: Pt = { x: 46, z: 52 };
const STRIKE_FROM: Pt = { x: 44, z: 6 };

interface Refs {
  me: Player;
  cov: Player;
  ally: Player;
  strike: Player;
  temple: Building;
  brandtYard: Building;
}

class IronTide extends CampaignScript {
  r: Refs;
  betrayed = false;
  helped = 0;
  strikeUnits: import('../../Unit').Unit[] = [];
  constructor(host: MissionHost, refs: Refs) {
    super(host, { ...AEGIS_CAST, ally: 'Col. Brandt' });
    this.r = refs;
    this.checkpoints = [CITADEL, CENTER, BRANDT];
  }

  citadel() {
    return this.buildings(this.r.cov, (b) => !b.def.wall);
  }

  start() {
    const { me, cov, temple } = this.r;
    this.allowOnly([
      'a_power', 'a_refinery', 'a_barracks', 'a_factory', 'a_radar', 'a_repair', 'a_airfield', 'a_techlab',
      'a_tower', 'a_turret', 'a_sam', 'a_railtower', 'a_wall',
      'rifleman', 'rocketeer', 'a_engineer', 'marksman', 'scout', 'guardian', 'tempest', 'titan', 'a_harvester', 'hawk',
    ], 3);
    this.objective('temple', 'Destroy the Temple of the Rift inside the Citadel of Ash.');
    this.objective('citadel', 'Raze the Citadel of Ash: destroy every Covenant structure.');
    this.beacon('temple', temple, 'TEMPLE OF THE RIFT', '#ff6a4a');
    this.loseWhenWiped('Your command has been destroyed.');
    this.reveal(CITADEL.x, CITADEL.z, 8);
    this.dialogue([
      ['commander', 'This is it, Commander. The Citadel of Ash. The Tabernacle data says their missile research runs through this fortress.'],
      ['ally', 'Colonel Brandt, Third Armoured. My division holds the northern flank. We hit them together or not at all.'],
      ['intel', 'I am feeding you both the Citadel layout. Obelisks on the western walls, flak batteries, and a Temple at the heart.'],
      ['commander', 'Full arsenal is unlocked: Tech Center, Titans, Hawks. Build up and break that fortress.'],
    ], 1);
    this.after(24, () =>
      this.hint('<b>Green</b> forces belong to Col. Brandt. You cannot command them, but they fight on your side.<br><b>Titan Assault Tanks</b> need a <b>Tech Center</b>. <b>Hawks</b> rearm at an <b>Airfield</b>. Use <b>Tempests</b> to crack Obelisks from outside their range.', 20),
    );

    this.after(360, () => this.betrayal());
    this.when(() => temple.dead, () => {
      this.complete('temple');
      if (this.citadel().length > 0) this.beacon('citadel', CITADEL, 'CITADEL OF ASH', '#ff6a4a');
      this.dialogue([
        ['enemy', 'You burn an empty shrine, Hale. The Rift Missile was never here.'],
        ['enemy', 'It waits at the Wound. Where the Rift first touched the Earth. Come and watch it rise.'],
        ['commander', 'Then we will finish it at the Wound. Clear the Citadel, Commander.'],
      ], 1);
    });
    this.when(() => this.citadel().length === 0, () => {
      this.complete('temple');
      this.complete('citadel');
      const t = this.dialogue([
        ['ally', 'Citadel is down. Third Armoured salutes you, Commander.'],
        ['commander', 'One more fight. The Wound. Get some rest, Commander. You will not get any there.'],
      ], 1);
      this.after(t, () => this.victory());
    });
    this.on('buildingDied', (e) => {
      if (e.building.owner === cov && e.building.def.id === 'c_obelisk') this.say('Obelisk down! Push through the gap!', 'commander');
    });
    this.after(150, () => this.say('The Citadel breeds fanatics, Commander. Watch your harvesters, their bikes love an easy kill.', 'intel'));
    this.after(200, () => {
      if (me.has('a_techlab')) return;
      this.hint('Tip: build a <b>Comms Center</b> and <b>Tech Center</b> to unlock <b>Titans</b>, <b>Ghost Marksmen</b> and the <b>Rail Spire</b>.', 12);
    });
  }

  betrayal() {
    const { ally, strike, me, brandtYard } = this.r;
    this.betrayed = true;
    this.dialogue([
      ['ally', 'Command, my sensor grid just went black. Every screen. Someone sent a shutdown code with Aegis clearance.'],
      ['intel', 'I am sorry, Marcus. The Rift chose me long before the Coalition did.'],
      ['commander', 'Voss? Doctor Voss! Respond!'],
      ['intel', 'Goodbye, General. Look to the Wound.'],
      ['ally', 'Stealth tanks! They are inside my perimeter! Commander, I need help up here!'],
    ], 0);
    this.after(22, () => {
      this.speakerNames = { ...this.speakerNames, intel: 'Lt. Reyes' };
      this.say('Lieutenant Reyes, taking over intelligence. Voss is gone, sir. She wiped her files on the way out.', 'intel');
      this.objective('brandt', 'Save Colonel Brandt: destroy the strike force in his base.', true);
      if (this.isOpen('brandt')) this.beacon('brandt', BRANDT, 'COL. BRANDT', '#6aff8a');
      this.reveal(BRANDT.x, BRANDT.z, 10);
    });
    // Voss's kill code overloads Brandt's reactors, then the strike comes in cloaked
    for (const b of this.buildings(ally, (x) => x.def.power > 0)) {
      this.world.damage(b, b.maxHp * 0.7, null);
      this.world.events.emit('explosion', { x: b.x, y: 0.5, z: b.z, size: 'large' });
    }
    this.strikeUnits = this.wave(strike, ['shade', 'shade', 'shade', 'shade', 'shade', 'inferno', 'inferno', 'inferno', 'scorpion', 'scorpion', 'zealot', 'zealot', 'zealot', 'zealot', 'zealot', 'zealot'], STRIKE_FROM, BRANDT);
    this.hunt(strike, [ally, me], 4);
    this.after(10, () =>
      this.hint('<b>Shade Stealth Tanks</b> are invisible until they fire or an enemy stands right beside them. Attack-move into the area, and keep infantry close: they spot for the tanks.', 16),
    );
    this.on('unitDied', (e) => {
      if (e.unit.owner === strike && e.killer?.owner === me) this.helped++;
    });
    this.when(() => this.betrayed && this.alive(this.strikeUnits).length === 0 && !brandtYard.dead, () => {
      this.objective('brandt', 'Save Colonel Brandt: destroy the strike force in his base.', true);
      if (this.helped >= 2) {
        this.complete('brandt');
        this.say('Strike force destroyed. Third Armoured owes you one, Commander. My Titans are yours.', 'ally');
        this.reinforce(me, ['titan', 'titan', 'guardian', 'guardian'], BRANDT.x, BRANDT.z + 8, CENTER.x - 8, CENTER.z);
      } else {
        this.fail('brandt');
        this.say('We held them. Barely. Could have used you up here, Commander.', 'ally');
      }
    });
    this.when(() => brandtYard.dead, () => {
      this.fail('brandt');
      this.say('This is Brandt... the yard is gone. Sending what I have left to your lines.', 'ally');
      this.reinforce(me, ['guardian', 'guardian', 'rocketeer', 'rocketeer'], 4, 52, HOME.x + 4, HOME.z - 10);
      for (const u of this.units(ally)) u.issue({ type: 'move', x: HOME.x + 6, z: HOME.z - 12, attackMove: true }, this.world);
    });
  }

  override cheatStep() {
    const { strike, temple } = this.r;
    const k = this.units(this.me)[0] ?? null;
    if (this.betrayed) for (const u of this.units(strike)) this.world.kill(u, k);
    if (this.t < 400) return;
    if (!temple.dead) {
      this.world.kill(temple, null);
      return;
    }
    for (const b of this.citadel().slice(0, 3)) this.world.kill(b, null);
  }
}

function create() {
  const seed = 9105;
  const map = buildMap(
    { id: 'aegis05', name: 'Qattara', description: '', w: 104, h: 104, seed, theater: 'desert', players: 2, cliffs: 0.4, water: 0.05, trees: 0.15, ore: 0.4, river: false, roads: true, layout: 'horizontal' },
    (e) => {
      e.ridge([{ x: 52, z: 10 }, { x: 50, z: 26 }, { x: 52, z: 38 }], 3);
      e.ridge([{ x: 52, z: 68 }, { x: 50, z: 82 }, { x: 52, z: 96 }], 3);
      e.blob(66, 22, 6, Terrain.Water);
      e.blob(66, 84, 6, Terrain.Water);
      e.clear(HOME.x, HOME.z, 12);
      e.clear(BRANDT.x, BRANDT.z, 11);
      e.clear(CITADEL.x, CITADEL.z, 15, Terrain.Sand);
      e.rect(CITADEL.x - 10, CITADEL.z - 11, CITADEL.x + 11, CITADEL.z + 10, Terrain.Concrete);
      e.clear(CENTER.x, CENTER.z, 7, Terrain.Dirt, false);
      e.road([{ x: HOME.x + 6, z: HOME.z - 6 }, { x: 34, z: 66 }, { x: CENTER.x, z: CENTER.z }, { x: CITADEL.x - 16, z: CITADEL.z }]);
      e.road([{ x: BRANDT.x + 6, z: BRANDT.z + 6 }, { x: 34, z: 40 }, { x: CENTER.x, z: CENTER.z }]);
      e.path([{ x: BRANDT.x + 8, z: BRANDT.z - 4 }, { x: STRIKE_FROM.x, z: STRIKE_FROM.z }, { x: 60, z: 8 }, { x: 80, z: 14 }, { x: 84, z: 34 }, { x: CITADEL.x, z: CITADEL.z - 14 }], 4);
      e.path([{ x: HOME.x + 8, z: HOME.z + 4 }, { x: 44, z: 96 }, { x: 62, z: 96 }, { x: 80, z: 90 }, { x: 84, z: 72 }, { x: CITADEL.x, z: CITADEL.z + 14 }], 4);
      e.path([{ x: HOME.x, z: HOME.z - 10 }, { x: 14, z: 52 }, { x: BRANDT.x, z: BRANDT.z + 10 }], 3);
      e.ore(34, 92, 4);
      e.ore(8, 70, 3.5);
      e.ore(34, 12, 4);
      e.ore(8, 36, 3.5);
      e.ore(40, 52, 4, true);
      e.ore(96, 38, 4);
      e.ore(96, 68, 4);
      e.ore(68, 52, 3, true);
      for (const d of [{ x: 34, z: 42 }, { x: 34, z: 62 }]) e.clear(d.x + 1, d.z + 1, 2.5, Terrain.Dirt);
      e.scatter(['rock', 'boulder', 'deadTree'], 46, 30, 8, 12);
      e.scatter(['rock', 'boulder', 'wreck'], 46, 76, 8, 12);
      e.scatter(['lamp', 'barrel'], CITADEL.x, CITADEL.z, 12, 12);
    },
  );
  const { world, players } = makeWorld(map, [
    { name: 'Aegis Expeditionary Force', faction: 'aegis', color: COLOR.aegis, team: 1, human: true, credits: 5000 },
    { name: 'Citadel of Ash', faction: 'covenant', color: COLOR.covenant, team: 2, credits: 2000, techLimit: 3 },
    { name: 'Third Armoured', faction: 'aegis', color: COLOR.green, team: 1, credits: 1000, techLimit: 2 },
    { name: 'Veiled Hand', faction: 'covenant', color: COLOR.covenant, team: 2 },
  ], seed);
  const [neutral, me, cov, ally, strike] = players;
  put(world, neutral, 'n_derrick', 34, 42);
  put(world, neutral, 'n_derrick', 34, 62);
  // player
  layout(world, me, HOME.x, HOME.z, [
    ['a_yard', -1, -1],
    ['a_power', -6, -5],
    ['a_power', -6, -2],
    ['a_refinery', 4, -5],
    ['a_barracks', -5, 3],
    ['a_factory', 3, 2],
    ['a_radar', -1, 5],
  ]);
  troops(world, me, ['a_harvester'], HOME.x + 8, HOME.z - 1);
  troops(world, me, ['guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'tempest', 'tempest'], HOME.x + 6, HOME.z - 8, -Math.PI / 4);
  troops(world, me, ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'rocketeer', 'rocketeer'], HOME.x + 1, HOME.z - 8, -Math.PI / 4);
  // Brandt
  const brandt = layout(world, ally, BRANDT.x, BRANDT.z, [
    ['a_yard', -1, -1],
    ['a_power', -6, -5],
    ['a_power', -6, -2],
    ['a_power', -9, -5],
    ['a_refinery', 4, -5],
    ['a_barracks', -5, 3],
    ['a_factory', 3, 2],
    ['a_radar', -1, 5],
    ['a_turret', 8, 7],
    ['a_turret', 9, 1],
  ]);
  troops(world, ally, ['a_harvester'], BRANDT.x + 8, BRANDT.z - 1);
  troops(world, ally, ['guardian', 'guardian', 'guardian', 'guardian', 'rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer'], BRANDT.x + 6, BRANDT.z + 6);
  ally.ai = new SkirmishAI(world, ally, 'easy', { aggression: 0.5, attackDelay: 900, techLimit: 2, allowSuperweapons: false });
  // the Citadel
  const cx = CITADEL.x, cz = CITADEL.z;
  const cit = layout(world, cov, cx, cz, [
    ['c_temple', -2, -5],
    ['c_yard', 2, -5],
    ['c_power', -2, -10],
    ['c_power', 1, -10],
    ['c_power', 4, -10],
    ['c_power', 7, -10],
    ['c_power', 10, -7],
    ['c_barracks', -6, -5],
    ['c_refinery', 7, -5],
    ['c_factory', -6, 0],
    ['c_radar', -1, 0],
    ['c_airfield', 3, 0],
    ['c_refinery', 8, 1],
    ['c_repair', -1, 4],
    ['c_obelisk', -10, -6],
    ['c_obelisk', -10, 4],
    ['c_turret', -11, -1],
    ['c_turret', -9, -11],
    ['c_turret', -9, 9],
    ['c_turret', 2, -13],
    ['c_turret', 2, 12],
    ['c_flak', 0, 8],
    ['c_flak', 5, -2],
  ]);
  wallLine(world, cov, 'c_wall', cx - 12, cz - 9, cx - 12, cz - 3);
  wallLine(world, cov, 'c_wall', cx - 12, cz + 2, cx - 12, cz + 8);
  troops(world, cov, ['c_harvester', 'c_harvester'], cx + 9, cz + 6);
  troops(world, cov, ['scorpion', 'scorpion', 'scorpion', 'inferno', 'seeker', 'seeker', 'acolyte', 'acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot'], cx - 6, cz + 6);
  cov.ai = new SkirmishAI(world, cov, 'normal', { attackDelay: 420, aggression: 0.7, techLimit: 3, allowSuperweapons: false });
  for (const u of world.units) if (u.def.harvester) u.issue({ type: 'harvest' }, world);
  world.updateFog();
  return { world, script: (h: MissionHost) => new IronTide(h, { me, cov, ally, strike, temple: cit[0], brandtYard: brandt[0] }) };
}

export const aegis05: MissionDef = {
  id: 'aegis_05',
  faction: 'aegis',
  index: 5,
  name: 'Iron Tide',
  codename: 'Operation Iron Tide',
  location: 'The Citadel of Ash, Qattara Depression, Egypt',
  briefing: `The Tabernacle data gave us a name: the Citadel of Ash. A Covenant fortress in the Qattara Depression, where they refine Riftite for Project Ascension.

It is the most heavily defended position the Covenant holds. Obelisks on the western walls. Flak over the airstrip. And at its heart, a Temple of the Rift.

You will not go in alone. Colonel Brandt's Third Armoured Division holds the northern flank. Your expeditionary force takes the south. Tech Center, Titan assault tanks and Hawk VTOLs are cleared for your use.

Destroy the Temple. Then raze the Citadel to the sand.

One more thing, Commander. The security codes found at Tabernacle are still unexplained. Trust your own eyes out there.`,
  objectives: ['Destroy the Temple of the Rift.', 'Destroy every structure in the Citadel of Ash.', 'Support Colonel Brandt\'s division.'],
  music: 'battle3',
  create,
};
