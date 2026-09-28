// RIFTFALL computer opponent.
//
// A layered "commander" that thinks a few times per second:
//   intel      – what it knows about the enemy (fog-aware below hard difficulty)
//   economy    – build order, power, refineries, harvesters, derricks, expansion
//   production – keeps barracks / factory / airfield busy with a counter-composition
//   military   – rally pool, attack waves (squads with waypoints & regrouping),
//                base defence, harassment, aircraft, scouting, micro at hard+
//   upkeep     – repairs, emergency selling, superweapons
//
// Faction agnostic: every unit / structure is picked by role derived from data.

import { BUILDINGS, SUPERWEAPONS } from '../../data/buildings';
import { UNITS } from '../../data/units';
import type { BuildTab, BuildingDef, UnitDef } from '../../data/types';
import type { Building } from '../Building';
import type { Entity } from '../Entity';
import type { Player } from '../Player';
import type { Difficulty } from '../Scenario';
import type { Unit } from '../Unit';
import type { World } from '../World';
import { buildProfile, effectiveness, emptyMix, fightValue, getKit, unitInfo, type ArmorMix, type BuildingRole, type EnemyProfile, type FactionKit, type UnitInfo } from './AIData';
import { BasePlanner } from './BasePlanner';

export interface SkirmishAIOptions {
  /** 0.5 = cautious … 1 = default … 2 = very aggressive */
  aggression?: number;
  /** structure build order: building ids or roles ('power','refinery','barracks','factory','radar','repair','airfield','tech','superweapon') */
  buildOrder?: string[];
  allowSuperweapons?: boolean;
  techLimit?: number;
  /** never attacks: defends, repairs and rebuilds only (mission bases) */
  passive?: boolean;
  /** seconds before the first attack wave (overrides the difficulty default) */
  attackDelay?: number;
  /** advanced: override individual difficulty parameters (tuning / scripted missions) */
  tuning?: Partial<AITuning>;
}

export interface AITuning {
  think: number;
  firstAttack: number;
  minAttackGap: number;
  waveMin: number;
  waveGrowth: number;
  waveMax: number;
  harvPerRef: number;
  maxRefineries: number;
  maxDefenses: number;
  micro: boolean;
  retreatHp: number;
  /** squad-level retreat when strength drops below this fraction */
  squadRetreat: number;
  counter: number;
  incomeBonus: number;
  cheatBase: boolean;
  mistakes: number;
  buildDelay: [number, number];
  armyQueue: number;
  prodPause: number;
  maxAircraft: number;
  harass: boolean;
  earlyHarass: boolean;
  engineers: number;
  expand: boolean;
  sellDying: boolean;
  techTime: number;
  swTime: number;
  repairBelow: number;
  reinforce: boolean;
  focusFire: boolean;
  armyCap: number;
}

const PARAMS: Record<Difficulty, AITuning> = {
  easy: {
    think: 1.0, firstAttack: 540, minAttackGap: 150, waveMin: 4, waveGrowth: 1, waveMax: 10,
    harvPerRef: 1, maxRefineries: 2, maxDefenses: 2, micro: false, retreatHp: 0, squadRetreat: 0,
    counter: 0.15, incomeBonus: 0, cheatBase: false, mistakes: 0.3, buildDelay: [2, 6], armyQueue: 1, prodPause: 6,
    maxAircraft: 1, harass: false, earlyHarass: false, engineers: 1, expand: false, sellDying: false,
    techTime: 1e9, swTime: 1e9, repairBelow: 0.4, reinforce: false, focusFire: false, armyCap: 25,
  },
  normal: {
    think: 0.6, firstAttack: 330, minAttackGap: 90, waveMin: 6, waveGrowth: 2, waveMax: 18,
    harvPerRef: 1.5, maxRefineries: 3, maxDefenses: 4, micro: false, retreatHp: 0, squadRetreat: 0.25,
    counter: 0.6, incomeBonus: 0, cheatBase: false, mistakes: 0.05, buildDelay: [0.6, 2], armyQueue: 2, prodPause: 1,
    maxAircraft: 2, harass: false, earlyHarass: false, engineers: 2, expand: true, sellDying: false,
    techTime: 660, swTime: 1080, repairBelow: 0.7, reinforce: true, focusFire: false, armyCap: 45,
  },
  hard: {
    think: 0.4, firstAttack: 270, minAttackGap: 75, waveMin: 9, waveGrowth: 2, waveMax: 26,
    harvPerRef: 2, maxRefineries: 4, maxDefenses: 6, micro: true, retreatHp: 0.3, squadRetreat: 0.35,
    counter: 0.9, incomeBonus: 0, cheatBase: true, mistakes: 0, buildDelay: [0.2, 0.8], armyQueue: 2, prodPause: 0,
    maxAircraft: 4, harass: true, earlyHarass: false, engineers: 3, expand: true, sellDying: true,
    techTime: 480, swTime: 840, repairBelow: 0.8, reinforce: true, focusFire: true, armyCap: 60,
  },
  brutal: {
    think: 0.25, firstAttack: 180, minAttackGap: 60, waveMin: 6, waveGrowth: 3, waveMax: 30,
    harvPerRef: 2, maxRefineries: 4, maxDefenses: 8, micro: true, retreatHp: 0.3, squadRetreat: 0.35,
    counter: 1, incomeBonus: 0.25, cheatBase: true, mistakes: 0, buildDelay: [0, 0.3], armyQueue: 3, prodPause: 0,
    maxAircraft: 6, harass: true, earlyHarass: true, engineers: 3, expand: true, sellDying: true,
    techTime: 400, swTime: 720, repairBelow: 0.85, reinforce: true, focusFire: true, armyCap: 75,
  },
};

type Job = 'pool' | 'squad' | 'defend' | 'scout' | 'engineer' | 'repair' | 'air' | 'deploy' | 'expand' | 'harvester' | 'harass' | 'idle';

interface UState {
  job: Job;
  squad: Squad | null;
  slot: number;
  lastOrder: number;
  since: number;
  target: Entity | null;
  spot: { x: number; z: number } | null;
  lastX: number;
  lastZ: number;
  stillT: number;
}

interface Squad {
  id: number;
  kind: 'attack' | 'harass';
  units: Unit[];
  state: 'advance' | 'regroup' | 'fight';
  objective: Entity | null;
  objX: number;
  objZ: number;
  path: { x: number; z: number }[];
  wp: number;
  startValue: number;
  created: number;
  regroupT: number;
  lastCx: number;
  lastCz: number;
  progressT: number;
  fightX: number;
  fightZ: number;
  lastEngageT: number;
  /** reinforcement group heading to join this squad */
  join: Squad | null;
  /** has gathered outside the target area once (stageT < 0: not yet) */
  staged: boolean;
  stageT: number;
}

interface SeenUnit {
  def: UnitDef;
  x: number;
  z: number;
  t: number;
  unit: Unit;
}

interface OreCell {
  x: number;
  z: number;
  ore: number;
}

export interface SkirmishAIStats {
  attacks: number;
  harassRaids: number;
  defenses: number;
  superweapons: number;
  expansions: number;
  derricksCaptured: number;
  placementsFailed: number;
  thinkMs: number;
  thinks: number;
}

let squadIds = 1;

export class SkirmishAI {
  readonly world: World;
  readonly player: Player;
  readonly difficulty: Difficulty;
  readonly P: AITuning;
  readonly kit: FactionKit;
  readonly opts: SkirmishAIOptions;
  readonly planner: BasePlanner;
  stats: SkirmishAIStats = {
    attacks: 0, harassRaids: 0, defenses: 0, superweapons: 0, expansions: 0, derricksCaptured: 0, placementsFailed: 0, thinkMs: 0, thinks: 0,
  };
  /** Optional log sink (the test harness uses it for the timeline). */
  log: ((msg: string) => void) | null = null;

  private now = 0;
  private thinkTimer = 0;
  private frame = 0;
  private rngState: number;
  private techLimit: number;
  private allowSW: boolean;
  private aggression: number;
  private buildOrder: BuildingDef[];

  private my: Unit[] = [];
  private myBuildings: Building[] = [];
  private states = new Map<Unit, UState>();
  private squads: Squad[] = [];
  private slots: (Unit | null)[] = [];
  private slotOffsets: { x: number; z: number }[] = [];

  // geometry
  private cx = 0;
  private cz = 0;
  private baseR = 6;
  private ex = 1;
  private ez = 0;
  private rallyX = 0;
  private rallyZ = 0;
  private lastGeom = -999;
  private homeX = -1;
  private homeZ = -1;

  // intel
  private enemies: Player[] = [];
  private knownBuildings: Building[] = [];
  private visibleEnemies: Unit[] = [];
  private seen = new Map<number, SeenUnit>();
  private candidates: { x: number; z: number }[] = [];
  private lastIntel = -999;
  private oreCells: OreCell[] = [];
  private lastOre = -999;
  private cellSeen: Float32Array;
  private cellSize = 8;
  private cw: number;
  private ch: number;
  private lastCellUpdate = -999;
  private mixCache: ArmorMix | null = null;
  /** ground distance (tiles) from our refinery docks, refreshed periodically */
  private refDist: Uint16Array | null = null;
  private refDistT = -999;
  private refDistKey = '';
  private bfsQ: Int32Array | null = null;
  private mixTime = -999;

  // defence
  private threats: { x: number; z: number; t: number; attacker: Entity | null; harvester: boolean }[] = [];
  private lastThreatT = -999;
  private lastSquadLost = -999;
  private powerRequest = 0;

  // economy / production
  private readySince: Record<string, number> = {};
  private readyDelay: Record<string, number> = {};
  private placeFails: Record<string, number> = {};
  private blocked = new Map<string, number>();
  private prodPauseUntil: Record<string, number> = {};
  private lastAttackT = -999;
  private waves = 0;
  private expansionTarget: { x: number; z: number } | null = null;
  private lastUpkeep = -999;
  private lastSW = -999;
  private swHold = 0;
  private lowPowerSince = -1;
  private engineerTargets = new Map<Unit, Building>();
  private engineersBuilt = 0;
  private scoutAssigned = false;
  private lastHarvCare = -999;
  private offThink = 0;
  private unsub: (() => void)[] = [];

  constructor(world: World, player: Player, difficulty: Difficulty, opts: SkirmishAIOptions = {}) {
    this.world = world;
    this.player = player;
    this.difficulty = difficulty;
    this.P = { ...(PARAMS[difficulty] ?? PARAMS.normal), ...(opts.tuning ?? {}) };
    this.opts = opts;
    this.kit = getKit(player.faction);
    this.planner = new BasePlanner(world, player);
    this.rngState = (player.index * 7919 + 17) >>> 0;
    this.techLimit = Math.min(opts.techLimit ?? 99, player.techLimit);
    this.allowSW = opts.allowSuperweapons ?? difficulty !== 'easy';
    this.aggression = Math.max(0.25, opts.aggression ?? 1);
    this.buildOrder = this.resolveBuildOrder(opts.buildOrder);
    this.cw = Math.ceil(world.map.w / this.cellSize);
    this.ch = Math.ceil(world.map.h / this.cellSize);
    this.cellSeen = new Float32Array(this.cw * this.ch).fill(-999);
    // spread thinking of multiple AIs over different ticks
    this.thinkTimer = 0.05 * player.index;
    for (let r = 1; r <= 7; r++) {
      const n = Math.max(1, Math.round(r * 2 * Math.PI / 1.25));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.7;
        this.slotOffsets.push({ x: Math.cos(a) * r * 1.2, z: Math.sin(a) * r * 1.2 });
      }
    }
    this.unsub.push(
      world.events.on('damaged', (e) => {
        if (e.entity.owner !== this.player || !e.attacker || !e.attacker.owner.isEnemyOf(this.player)) return;
        const harv = e.entity.kind === 'unit' && !!(e.entity as Unit).def.harvester;
        if (e.entity.kind === 'building' || harv) {
          this.threats.push({ x: e.entity.x, z: e.entity.z, t: this.world.time, attacker: e.attacker, harvester: harv });
          if (this.threats.length > 40) this.threats.splice(0, this.threats.length - 40);
        }
      }),
      world.events.on('unitDied', (e) => {
        this.seen.delete(e.unit.id);
      }),
      world.events.on('captured', (e) => {
        if (e.to === this.player && e.building.def.id === 'n_derrick') this.stats.derricksCaptured++;
      }),
    );
    if (this.P.incomeBonus > 0) {
      this.unsub.push(
        world.events.on('credits', (e) => {
          if (e.player !== this.player) return;
          // only refinery deliveries (derricks also emit credits)
          const b = this.myBuildings.find((x) => x.def.refinery && Math.abs(x.x - e.x) < 0.01 && Math.abs(x.z - e.z) < 0.01);
          if (b) this.player.credits += e.amount * this.P.incomeBonus;
        }),
      );
    }
  }

  /** One-line summary of the AI's internal state (debugging / test harness). */
  debugState(): string {
    const jobs: Record<string, number> = {};
    for (const u of this.my) {
      const j = this.states.get(u)?.job ?? '?';
      jobs[j] = (jobs[j] ?? 0) + 1;
    }
    const q = (t: BuildTab) => this.player.queues[t].items.map((i) => i.defId).join('+') || '-';
    return (
      `jobs ${JSON.stringify(jobs)} squads ${this.squads.map((s) => `${s.kind}#${s.id}:${s.units.length}:${s.state}`).join(',') || '-'} ` +
      `lastThreat ${(this.now - this.lastThreatT).toFixed(0)}s ago waves ${this.waves} want ${this.waveSize()} ` +
      `queues S:${q('structures')}${this.player.queues.structures.ready ? '(ready ' + this.player.queues.structures.ready + ')' : ''} D:${q('defense')} I:${q('infantry')} V:${q('vehicles')} A:${q('aircraft')} ` +
      `known ${this.knownBuildings.length} cand ${this.candidates.length} exp ${this.expansionTarget ? 'yes' : 'no'}`
    );
  }

  /** Detach event listeners (call when the AI is removed). */
  dispose() {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  // ================================================================== helpers
  private rand(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private say(msg: string) {
    this.log?.(`[${fmt(this.world.time)}] ${this.player.name}: ${msg}`);
  }

  private resolveBuildOrder(list?: string[]): BuildingDef[] {
    const def = (s: string): BuildingDef | undefined => {
      if (BUILDINGS[s]) return BUILDINGS[s].faction === this.player.faction ? BUILDINGS[s] : undefined;
      return this.kit.byRole[s as BuildingRole];
    };
    const d = this.difficulty;
    const roles =
      list ??
      (d === 'easy'
        ? ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery', 'radar', 'power']
        : ['power', 'refinery', 'barracks', 'refinery', 'factory', 'power', 'radar', 'power', 'repair']);
    return roles.map(def).filter((x): x is BuildingDef => !!x);
  }

  private techOk(d: { techLevel?: number }) {
    return (d.techLevel ?? 1) <= this.techLimit;
  }

  private canBuild(id: string): boolean {
    const d = UNITS[id] ?? BUILDINGS[id];
    if (!d || !this.techOk(d)) return false;
    const until = this.blocked.get(id);
    if (until !== undefined && until > this.now) return false;
    return this.player.canBuild(id);
  }

  private st(u: Unit): UState {
    let s = this.states.get(u);
    if (!s) {
      s = { job: 'idle', squad: null, slot: -1, lastOrder: -999, since: this.now, target: null, spot: null, lastX: u.x, lastZ: u.z, stillT: 0 };
      this.states.set(u, s);
    }
    return s;
  }

  private setJob(u: Unit, job: Job) {
    const s = this.st(u);
    if (s.job === job) return;
    if (s.job === 'pool' && s.slot >= 0) {
      if (this.slots[s.slot] === u) this.slots[s.slot] = null;
      s.slot = -1;
    }
    if (s.squad && job !== 'squad') {
      s.squad.units = s.squad.units.filter((x) => x !== u);
      s.squad = null;
    }
    s.job = job;
    s.since = this.now;
    s.lastOrder = -999;
  }

  private orderMove(u: Unit, x: number, z: number, attackMove: boolean, minInterval = 2): void {
    const s = this.st(u);
    const o = u.order;
    if (o.type === 'move' && Math.abs(o.x - x) < 1.5 && Math.abs(o.z - z) < 1.5 && !!o.attackMove === attackMove) return;
    if (this.now - s.lastOrder < minInterval) return;
    s.lastOrder = this.now;
    u.issue({ type: 'move', x, z, attackMove }, this.world);
  }

  private orderAttack(u: Unit, target: Entity, minInterval = 1.2) {
    const s = this.st(u);
    if (u.order.type === 'attack' && u.order.target === target) return;
    if (this.now - s.lastOrder < minInterval) return;
    s.lastOrder = this.now;
    u.issue({ type: 'attack', target }, this.world);
  }

  private value(u: Unit): number {
    if (u.weapons.length === 0) return 0;
    return u.def.cost * (0.3 + 0.7 * (u.hp / u.maxHp));
  }

  private isCombat(u: Unit): boolean {
    const r = unitInfo(u.def).role;
    return r === 'infantry' || r === 'vehicle' || r === 'artillery';
  }

  private buildingRole(b: BuildingDef): BuildingRole {
    return this.kit.building[b.id]?.role ?? (b.refinery ? 'refinery' : b.produces === 'yard' ? 'yard' : 'other');
  }

  // ================================================================== main loop
  update(dt: number): void {
    if (this.player.defeated) return;
    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = this.P.think * (0.85 + this.rand() * 0.3);
    const t0 = performance.now();
    try {
      this.think();
    } finally {
      this.stats.thinkMs += performance.now() - t0;
      this.stats.thinks++;
    }
  }

  private think() {
    const world = this.world;
    this.now = world.time;
    this.frame++;
    const p = this.player;
    this.my = [];
    for (const u of world.units) if (u.owner === p && !u.dead) this.my.push(u);
    this.myBuildings = [];
    for (const b of world.buildings) if (b.owner === p && !b.dead) this.myBuildings.push(b);
    // forget dead units
    if (this.frame % 10 === 0) {
      for (const [u, s] of this.states) {
        if (u.dead || u.owner !== p) {
          if (s.slot >= 0 && this.slots[s.slot] === u) this.slots[s.slot] = null;
          this.states.delete(u);
          this.engineerTargets.delete(u);
        }
      }
    }
    for (const sq of this.squads) sq.units = sq.units.filter((u) => !u.dead && u.owner === p);

    if (this.now - this.lastGeom > 5) this.updateGeometry();
    if (this.now - this.lastIntel >= 1) this.updateIntel();
    if (this.now - this.lastOre > 20) this.updateOre();

    this.assignNewUnits();
    this.handleMcvs();
    this.economy();
    this.production();
    this.engineers();
    this.military();

    // rotate the less urgent work over thinks
    this.offThink = (this.offThink + 1) % 3;
    if (this.offThink === 0 && this.now - this.lastUpkeep > 2.5) this.upkeep();
    else if (this.offThink === 1 && this.now - this.lastHarvCare > 3) this.harvesterCare();
    else if (this.offThink === 2 && this.now - this.lastSW > 2) this.superweapons();
  }

  // ================================================================== geometry
  private updateGeometry() {
    this.lastGeom = this.now;
    const yards = this.myBuildings.filter((b) => b.def.produces === 'yard');
    const main = yards[0];
    if (main) {
      this.cx = main.x;
      this.cz = main.z;
      if (this.homeX < 0) {
        this.homeX = main.x;
        this.homeZ = main.z;
      }
    } else if (this.myBuildings.length) {
      let sx = 0, sz = 0;
      for (const b of this.myBuildings) {
        sx += b.x;
        sz += b.z;
      }
      this.cx = sx / this.myBuildings.length;
      this.cz = sz / this.myBuildings.length;
    } else if (this.my.length) {
      const mcv = this.my.find((u) => u.def.mcv) ?? this.my[0];
      this.cx = mcv.x;
      this.cz = mcv.z;
    }
    if (this.homeX < 0 && this.my.length) {
      this.homeX = this.cx;
      this.homeZ = this.cz;
    }
    let r = 5;
    for (const b of this.myBuildings) {
      if (b.def.wall || b.def.faction === 'both') continue;
      const d = Math.hypot(b.x - this.cx, b.z - this.cz);
      if (d < 30) r = Math.max(r, d + 2);
    }
    this.baseR = r;
    // enemy direction
    const eb = this.enemyBasePos(this.cx, this.cz);
    const tx = eb ? eb.x : this.world.map.w / 2, tz = eb ? eb.z : this.world.map.h / 2;
    const dl = Math.hypot(tx - this.cx, tz - this.cz) || 1;
    this.ex = (tx - this.cx) / dl;
    this.ez = (tz - this.cz) / dl;
    // rally point: in front of the base toward the enemy, on open ground
    const m = this.world.map;
    const want = Math.min(this.baseR + 6, dl * 0.4);
    let best: { x: number; z: number } | null = null;
    let bs = Infinity;
    const rx = this.cx + this.ex * want, rz = this.cz + this.ez * want;
    for (let dz = -6; dz <= 6; dz++)
      for (let dx = -6; dx <= 6; dx++) {
        const x = Math.floor(rx) + dx, z = Math.floor(rz) + dz;
        let open = 0;
        for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) if (m.passable(x + ox, z + oz) && !m.oreType[(z + oz) * m.w + x + ox]) open++;
        if (open < 18) continue;
        const s = Math.hypot(dx, dz) - open * 0.3;
        if (s < bs) {
          bs = s;
          best = { x: x + 0.5, z: z + 0.5 };
        }
      }
    if (best) {
      if (Math.hypot(best.x - this.rallyX, best.z - this.rallyZ) > 3) {
        // slots move with the rally point
        this.rallyX = best.x;
        this.rallyZ = best.z;
      }
    } else if (this.rallyX === 0) {
      this.rallyX = this.cx;
      this.rallyZ = this.cz + 4;
    }
  }

  // ================================================================== intel
  private updateIntel() {
    this.lastIntel = this.now;
    const world = this.world;
    const p = this.player;
    this.enemies = world.players.filter((o) => !o.isNeutral && o.isEnemyOf(p) && !o.defeated);
    const fog = world.fogs.get(p);
    const late = this.now > 1500; // stalemate breaker: late game the AI learns where remaining buildings are
    this.knownBuildings = [];
    for (const b of world.buildings) {
      if (b.dead || !b.owner.isEnemyOf(p)) continue;
      if (this.P.cheatBase || late || !fog || fog.isExplored(b.x, b.z)) this.knownBuildings.push(b);
    }
    this.visibleEnemies = [];
    for (const u of world.units) {
      if (u.dead || !u.owner.isEnemyOf(p)) continue;
      if (!world.visibleTo(u, p)) continue;
      this.visibleEnemies.push(u);
      this.seen.set(u.id, { def: u.def, x: u.x, z: u.z, t: this.now, unit: u });
    }
    if (this.frame % 20 === 0) for (const [id, s] of this.seen) if (this.now - s.t > 150 || s.unit.dead) this.seen.delete(id);
    // exploration candidates (likely enemy start spots)
    if (this.candidates.length === 0 && this.homeX >= 0 && this.frame < 50) {
      const { w, h } = world.map;
      const m = 13;
      const pts = [
        { x: w - this.homeX, z: h - this.homeZ },
        { x: m, z: m }, { x: w - m, z: m }, { x: m, z: h - m }, { x: w - m, z: h - m },
        { x: w / 2, z: m }, { x: w / 2, z: h - m }, { x: m, z: h / 2 }, { x: w - m, z: h / 2 }, { x: w - m, z: m + 6 },
        { x: w / 2, z: h / 2 },
      ];
      const out: { x: number; z: number }[] = [];
      for (const q of pts) {
        if (Math.hypot(q.x - this.homeX, q.z - this.homeZ) < 25) continue;
        if (out.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 10)) continue;
        out.push(q);
      }
      const mx = w - this.homeX, mz = h - this.homeZ;
      out.sort((a, b) => Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz));
      this.candidates = out;
    }
    if (fog) this.candidates = this.candidates.filter((c) => !fog.isVisible(c.x, c.z) || this.knownBuildings.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < 14));
    // coarse "last seen" grid for hunting
    if (fog && this.now - this.lastCellUpdate > 4) {
      this.lastCellUpdate = this.now;
      for (let j = 0; j < this.ch; j++)
        for (let i = 0; i < this.cw; i++) {
          const x = i * this.cellSize + this.cellSize / 2, z = j * this.cellSize + this.cellSize / 2;
          if (fog.isVisible(x, z)) this.cellSeen[j * this.cw + i] = this.now;
        }
    }
  }

  /** Where we believe the (nearest) enemy base is. */
  private enemyBasePos(fromX: number, fromZ: number): { x: number; z: number } | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.knownBuildings) {
      if (b.def.wall || b.owner.isNeutral) continue;
      const d = Math.hypot(b.x - fromX, b.z - fromZ) - (b.def.produces === 'yard' ? 8 : 0);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) return { x: best.x, z: best.z };
    if (this.candidates.length) return this.candidates[0];
    return null;
  }

  /** Cost-weighted armor mix of the enemy army we have seen (blended with a prior). */
  private enemyMix(): ArmorMix {
    if (this.mixCache && this.now - this.mixTime < 5) return this.mixCache;
    const obs = emptyMix();
    let total = 0;
    for (const s of this.seen.values()) {
      const info = unitInfo(s.def);
      if (info.role === 'harvester' || info.role === 'mcv') continue;
      const a = s.def.flying ? 'aircraft' : s.def.armor;
      obs[a] += s.def.cost;
      total += s.def.cost;
    }
    let defCost = 0;
    for (const b of this.knownBuildings) if (b.weapons.length) defCost += b.def.cost;
    const prior: ArmorMix = { infantry: 0.3, light: 0.2, heavy: 0.35, building: 0.15, aircraft: 0 };
    const w = this.P.counter * Math.min(1, total / 3000);
    const mix = emptyMix();
    for (const k of Object.keys(mix) as (keyof ArmorMix)[]) mix[k] = prior[k] * (1 - w) + (total > 0 ? (obs[k] / total) * w : 0);
    mix.building = Math.max(mix.building, 0.1 + Math.min(0.15, defCost / 20000));
    if (obs.aircraft > 0) mix.aircraft = Math.max(mix.aircraft, 0.15);
    this.mixCache = mix;
    this.mixTime = this.now;
    return mix;
  }

  private updateOre() {
    this.lastOre = this.now;
    const m = this.world.map;
    const cs = 6;
    const cells: OreCell[] = [];
    for (let cz = 0; cz < m.h; cz += cs)
      for (let cx = 0; cx < m.w; cx += cs) {
        let sum = 0, sx = 0, sz = 0;
        for (let z = cz; z < Math.min(m.h, cz + cs); z++)
          for (let x = cx; x < Math.min(m.w, cx + cs); x++) {
            const o = m.ore[z * m.w + x];
            if (o > 0) {
              sum += o;
              sx += x * o;
              sz += z * o;
            }
          }
        if (sum > 1200) cells.push({ x: sx / sum + 0.5, z: sz / sum + 0.5, ore: sum });
      }
    this.oreCells = cells;
  }

  /** Is (x,z) close to known enemy structures / defences? */
  private dangerAt(x: number, z: number, r = 12): number {
    let d = 0;
    for (const b of this.knownBuildings) {
      if (b.owner.isNeutral) continue;
      const dist = Math.hypot(b.x - x, b.z - z);
      if (b.weapons.length && dist < r) d += b.def.cost;
      else if (dist < r * 0.6) d += 100;
    }
    for (const u of this.visibleEnemies) if (u.weapons.length && Math.hypot(u.x - x, u.z - z) < r) d += u.def.cost * 0.7;
    return d;
  }

  /** Ground distance from the nearest own refinery dock (65535 = unreachable / no refinery). */
  private refineryDist(x: number, z: number): number {
    const m = this.world.map;
    const refs = this.myBuildings.filter((b) => b.def.refinery && !b.dead);
    const key = refs.map((b) => b.id).join(',');
    if (!this.refDist || key !== this.refDistKey || this.now - this.refDistT > 20) {
      this.refDistKey = key;
      this.refDistT = this.now;
      const n = m.w * m.h;
      const dist = this.refDist ?? new Uint16Array(n);
      dist.fill(65535);
      const q = this.bfsQ ?? new Int32Array(n);
      this.bfsQ = q;
      let qh = 0, qt = 0;
      for (const r of refs) {
        const dp = r.dockPoint();
        const np = m.nearestPassable(dp.x, dp.z, 3);
        if (!np) continue;
        const i = np[1] * m.w + np[0];
        if (dist[i] === 0) continue;
        dist[i] = 0;
        q[qt++] = i;
      }
      while (qh < qt) {
        const i = q[qh++];
        const cx = i % m.w, cz = (i - cx) / m.w;
        const d = dist[i] + 1;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || nz < 0 || nx >= m.w || nz >= m.h) continue;
          const j = nz * m.w + nx;
          if (dist[j] <= d) continue;
          // ore tiles are passable; buildings are not
          if (!m.passable(nx, nz)) continue;
          dist[j] = d;
          q[qt++] = j;
        }
      }
      this.refDist = dist;
    }
    const tx = Math.floor(x), tz = Math.floor(z);
    if (!m.inBounds(tx, tz)) return 65535;
    const d = this.refDist[tz * m.w + tx];
    if (d !== 65535) return d;
    // blocked tile (e.g. ore under a unit, building edge): look at neighbours
    let best = 65535;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (m.inBounds(tx + dx, tz + dz)) best = Math.min(best, this.refDist[(tz + dz) * m.w + tx + dx] + 1);
    return best;
  }

  private bestOreCell(nearX: number, nearZ: number, avoidX?: number, avoidZ?: number): OreCell | null {
    let best: OreCell | null = null;
    let bs = -Infinity;
    const hasRef = this.myBuildings.some((b) => b.def.refinery);
    for (const c of this.oreCells) {
      let d = Math.hypot(c.x - nearX, c.z - nearZ);
      if (hasRef) {
        const g = this.refineryDist(c.x, c.z);
        if (g >= 65535) continue; // unreachable
        d = Math.max(d, g);
      }
      let s = Math.min(c.ore, 8000) / 1000 - d * 0.35;
      if (avoidX !== undefined && avoidZ !== undefined && Math.hypot(c.x - avoidX, c.z - avoidZ) < 10) s -= 20;
      if (this.dangerAt(c.x, c.z, 10) > 600) s -= 15;
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    return best;
  }

  // ================================================================== unit bookkeeping
  private assignNewUnits() {
    for (const u of this.my) {
      if (this.states.has(u)) continue;
      const s = this.st(u);
      const info = unitInfo(u.def);
      switch (info.role) {
        case 'harvester':
          s.job = 'harvester';
          break;
        case 'mcv':
          s.job = this.myBuildings.some((b) => b.def.produces === 'yard') && this.expansionTarget ? 'expand' : 'deploy';
          break;
        case 'engineer':
          s.job = 'engineer';
          break;
        case 'aircraft':
          s.job = 'air';
          break;
        default:
          if (!this.scoutAssigned && info.fast && this.difficulty !== 'easy' && !this.opts.passive) {
            this.scoutAssigned = true;
            s.job = 'scout';
          } else if (!this.scoutAssigned && info.fast && this.difficulty === 'easy' && this.now > 60 && !this.opts.passive) {
            this.scoutAssigned = true;
            s.job = 'scout';
          } else s.job = 'pool';
      }
    }
  }

  // ================================================================== MCV handling
  private handleMcvs() {
    for (const u of this.my) {
      if (!u.def.mcv) continue;
      const s = this.st(u);
      if (s.job !== 'deploy' && s.job !== 'expand') s.job = 'deploy';
      if (u.order.type === 'deploy') continue;
      if (!s.spot) {
        const hasYard = this.myBuildings.some((b) => b.def.produces === 'yard');
        let tx = u.x, tz = u.z;
        if (s.job === 'expand' && this.expansionTarget) {
          tx = this.expansionTarget.x;
          tz = this.expansionTarget.z;
        } else if (hasYard || this.myBuildings.length > 0) {
          tx = this.cx;
          tz = this.cz;
        }
        s.spot = this.planner.findDeploySpot(tx, tz, s.job === 'expand' ? 9 : 10, s.job === 'expand');
        if (!s.spot) s.spot = this.planner.findDeploySpot(u.x, u.z, 16, false);
        if (!s.spot) continue;
      }
      const d = Math.hypot(u.x - s.spot.x, u.z - s.spot.z);
      if (d < 0.7 && !u.moving) {
        u.issue({ type: 'deploy' }, this.world);
        s.lastOrder = this.now;
        // if the deploy fails (units in the way) the order drops to idle: pick another spot later
        s.stillT++;
        if (s.stillT > 4) {
          s.spot = null;
          s.stillT = 0;
        }
      } else if (u.order.type === 'idle' || this.now - s.lastOrder > 12) {
        s.lastOrder = this.now;
        u.issue({ type: 'move', x: s.spot.x, z: s.spot.z }, this.world);
      }
    }
  }

  // ================================================================== economy
  private roleCounts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const b of this.myBuildings) {
      const r = this.buildingRole(b.def);
      c[r] = (c[r] ?? 0) + 1;
    }
    for (const tab of ['structures', 'defense'] as BuildTab[]) {
      const q = this.player.queues[tab];
      const ids = [q.ready, ...q.items.map((i) => i.defId)].filter((x): x is string => !!x);
      for (const id of ids) {
        const r = this.buildingRole(BUILDINGS[id]);
        c[r] = (c[r] ?? 0) + 1;
      }
    }
    return c;
  }

  /** Do our harvesters currently work far away from every refinery? */
  private harvestersFar(): boolean {
    let far = 0, n = 0;
    const m = this.world.map;
    for (const u of this.my) {
      if (!u.def.harvester || u.harvTile < 0) continue;
      n++;
      const tx = u.harvTile % m.w, tz = Math.floor(u.harvTile / m.w);
      if (this.refineryDist(tx + 0.5, tz + 0.5) > 30) far++;
    }
    return n > 0 && far * 2 >= n;
  }

  private harvesterCount(): number {
    let n = 0;
    for (const u of this.my) if (u.def.harvester) n++;
    const q = this.player.queues.vehicles;
    for (const it of q.items) if (UNITS[it.defId]?.harvester) n++;
    return n;
  }

  private wantedHarvesters(refs: number): number {
    const early = this.now < 150 ? 0 : 1;
    const per = this.isBehind() ? Math.min(this.P.harvPerRef, 1.5) : this.P.harvPerRef;
    return Math.min(10, Math.max(refs, Math.round(refs * per) - (this.difficulty === 'normal' ? 1 - early : 0)));
  }

  /** Projected power balance once everything placed / in production is finished. */
  private powerMargin(): number {
    let prod = 0, used = 0;
    for (const b of this.myBuildings) {
      if (b.selling) continue;
      if (b.def.power > 0) prod += b.def.power * (b.constructing >= 1 ? 0.5 + 0.5 * (b.hp / b.maxHp) : 1);
      else used -= b.def.power;
    }
    for (const tab of ['structures', 'defense'] as BuildTab[]) {
      const q = this.player.queues[tab];
      for (const id of [q.ready, q.items[0]?.defId]) {
        if (!id) continue;
        const pw = BUILDINGS[id].power;
        if (pw > 0) prod += pw;
        else used -= pw;
      }
    }
    return prod - used;
  }

  private canAffordEventually(d: BuildingDef) {
    return this.player.credits > d.cost * 0.25 || this.harvesterCount() > 0;
  }

  private nextStructure(): BuildingDef | null {
    const kit = this.kit;
    const counts = this.roleCounts();
    const has = (r: BuildingRole) => counts[r] ?? 0;
    const power = kit.byRole.power;
    const margin = this.powerMargin();
    const needPowerFor = (d: BuildingDef) => power && d.power < 0 && margin + d.power < 0 && d !== power;
    const pick = (d: BuildingDef | undefined): BuildingDef | null => {
      if (!d || !this.canBuild(d.id)) return null;
      if (needPowerFor(d) && power && this.canBuild(power.id)) return power;
      return d;
    };
    if (!this.myBuildings.some((b) => b.def.produces === 'yard')) return null;
    if ((margin < 0 || margin < this.powerRequest) && power && this.canBuild(power.id)) return power;

    // scripted opening
    const seen: Record<string, number> = {};
    for (const d of this.buildOrder) {
      const r = this.buildingRole(d);
      seen[d.id] = (seen[d.id] ?? 0) + 1;
      const haveN = this.countDef(d.id, counts, r);
      if (haveN >= seen[d.id]) continue;
      if (r === 'refinery' && has('refinery') >= 1 && !this.refinerySiteOk()) continue;
      if (r === 'superweapon' && !this.allowSW) continue;
      if (!this.techOk(d)) continue;
      const got = pick(d);
      if (got) return got;
      // prerequisites still under construction: wait for them instead of skipping ahead
      if (d.prereqs.every((pr) => this.myBuildings.some((b) => b.def.id === pr))) return null;
    }

    const credits = this.player.credits;
    const refs = has('refinery');
    const harv = this.harvesterCount();
    // more refineries while there is ore to take
    const behind = this.isBehind();
    const yards = this.myBuildings.filter((b) => b.def.produces === 'yard').length;
    if (!behind && refs < this.P.maxRefineries + Math.max(0, yards - 1) && harv >= this.wantedHarvesters(refs) - 1 && (credits > 1500 || this.now > 420) && this.now > 200) {
      if (this.refinerySiteOk()) {
        const r = pick(kit.byRole.refinery);
        if (r) return r;
      }
    }
    // floating money: more production first
    if (credits > 3000 && this.now > 360) {
      const fMax = this.difficulty === 'brutal' || this.difficulty === 'hard' ? 3 : 2;
      if (has('factory') < fMax) {
        const f = pick(kit.byRole.factory);
        if (f) return f;
      }
      if (has('barracks') < 2 && credits > 4000) {
        const f = pick(kit.byRole.barracks);
        if (f) return f;
      }
    }
    // core tech
    const passive = !!this.opts.passive;
    if (!has('factory')) {
      const f = pick(kit.byRole.factory);
      if (f) return f;
    }
    if (!has('barracks')) {
      const f = pick(kit.byRole.barracks);
      if (f) return f;
    }
    if (!has('radar') && this.now > 200) {
      const f = pick(kit.byRole.radar);
      if (f) return f;
    }
    if (!has('repair') && this.now > 300 && this.difficulty !== 'easy') {
      const f = pick(kit.byRole.repair);
      if (f) return f;
    }
    // extra production when floating money
    if (credits > 3500 && has('factory') < (this.difficulty === 'brutal' || this.difficulty === 'hard' ? 3 : 2) && this.now > 420) {
      const f = pick(kit.byRole.factory);
      if (f) return f;
    }
    if (credits > 4500 && has('barracks') < 2 && this.now > 480) {
      const f = pick(kit.byRole.barracks);
      if (f) return f;
    }
    if (behind && credits < 3000) {
      // out-numbered: only keep the power up, spend the rest on the army
      if (power && margin < 30 && this.canBuild(power.id)) return power;
      return null;
    }
    if (!has('tech') && this.now > this.P.techTime) {
      const f = pick(kit.byRole.tech);
      if (f) return f;
    }
    if (!has('airfield') && this.P.maxAircraft > 0 && this.now > this.P.techTime * 0.8 && !passive) {
      const f = pick(kit.byRole.airfield);
      if (f) return f;
    }
    if (this.allowSW && !has('superweapon') && this.now > this.P.swTime && credits > 2000) {
      const f = pick(kit.byRole.superweapon);
      if (f) return f;
    }
    // stay ahead on power
    if (power && margin < 40 && this.canBuild(power.id) && (credits > 800 || margin < 15)) return power;
    return null;
  }

  private countDef(id: string, counts: Record<string, number>, role: BuildingRole): number {
    // for roles with a single def (all of ours) the role count is exact
    const sameRole = this.kit.buildings.filter((b) => b.role === role);
    if (sameRole.length <= 1) return counts[role] ?? 0;
    let n = 0;
    for (const b of this.myBuildings) if (b.def.id === id) n++;
    for (const tab of ['structures', 'defense'] as BuildTab[]) {
      const q = this.player.queues[tab];
      if (q.ready === id) n++;
      for (const it of q.items) if (it.defId === id) n++;
    }
    return n;
  }

  private refSiteCache: { t: number; ok: boolean } = { t: -999, ok: false };
  /** Is there a refinery site with a worthwhile amount of ore? Sets expansionTarget otherwise. */
  private refinerySiteOk(): boolean {
    if (this.now - this.refSiteCache.t < 8) return this.refSiteCache.ok;
    const ref = this.kit.byRole.refinery;
    let ok = false;
    if (ref) {
      const spot = this.planner.findPlacement(ref.id, 'refinery', { cx: this.cx, cz: this.cz, ex: this.ex, ez: this.ez });
      if (spot) {
        const ore = this.planner.oreAround(spot.tx + 1.5, spot.tz + 4, 7);
        ok = ore > 5000 || (this.myBuildings.every((b) => !b.def.refinery) && ore > 800);
      }
    }
    const richLate = this.now > 600 && this.player.credits > 5000 && this.P.expand;
    if (!ok || richLate) {
      // find an ore field worth expanding to
      let best: OreCell | null = null;
      let bs = -Infinity;
      for (const c of this.oreCells) {
        const d = Math.hypot(c.x - this.cx, c.z - this.cz);
        if (d < 10) continue;
        if (this.myBuildings.some((b) => b.def.refinery && Math.hypot(b.x - c.x, b.z - c.z) < 10)) continue;
        if (this.dangerAt(c.x, c.z, 16) > 300) continue;
        const nearEnemy = this.knownBuildings.some((b) => !b.owner.isNeutral && Math.hypot(b.x - c.x, b.z - c.z) < 22);
        if (nearEnemy) continue;
        const s = Math.min(c.ore, 10000) / 1000 - d * 0.3;
        if (s > bs) {
          bs = s;
          best = c;
        }
      }
      this.expansionTarget = best && (!ok || best.ore > 6000) ? { x: best.x, z: best.z } : null;
    } else this.expansionTarget = null;
    this.refSiteCache = { t: this.now, ok };
    return ok;
  }

  private economy() {
    const p = this.player;
    const sq = p.queues.structures;
    // ---- placement of finished structures
    for (const tab of ['structures', 'defense'] as BuildTab[]) {
      const q = p.queues[tab];
      if (!q.ready) {
        this.readySince[tab] = -1;
        continue;
      }
      if ((this.readySince[tab] ?? -1) < 0) {
        this.readySince[tab] = this.now;
        const [a, b] = this.P.buildDelay;
        this.readyDelay[tab] = a + this.rand() * (b - a);
      }
      if (this.now - this.readySince[tab] < this.readyDelay[tab]) continue;
      this.placeReady(tab);
    }
    // ---- structure queue
    if (!sq.ready && sq.items.length === 0 && this.myBuildings.some((b) => b.def.produces === 'yard')) {
      const next = this.nextStructure();
      if (next && this.canAffordEventually(next)) {
        if (p.enqueue(next.id, this.world)) this.say(`builds ${next.name}`);
      }
    }
    // ---- defence queue
    const dq = p.queues.defense;
    if (!dq.ready && dq.items.length === 0) {
      const d = this.nextDefense();
      if (d && p.enqueue(d.id, this.world)) this.say(`builds defence ${d.name}`);
    }
    // ---- harvesters
    const refs = this.myBuildings.filter((b) => b.def.refinery && b.operational).length;
    const harvDef = this.kit.harvester;
    if (harvDef && refs > 0 && this.canBuild(harvDef.id)) {
      const want = this.wantedHarvesters(refs);
      const have = this.harvesterCount();
      const skip = this.difficulty === 'easy' && this.rand() < 0.5; // easy forgets sometimes
      if (have < want && !skip && (p.credits > 600 || have === 0)) {
        const q = p.queues.vehicles;
        // make room at the front of the queue: drop unstarted army items
        for (let i = q.items.length - 1; i >= 0; i--) {
          const it = q.items[i];
          if (it.progress === 0 && !UNITS[it.defId]?.harvester && !UNITS[it.defId]?.mcv) p.dequeue(it.defId, this.world);
        }
        if (!q.items.some((i) => UNITS[i.defId]?.harvester)) p.enqueue(harvDef.id, this.world);
      }
    }
    // ---- rebuild the construction yard
    const mcv = this.kit.mcv;
    if (mcv && !this.myBuildings.some((b) => b.def.produces === 'yard') && !this.my.some((u) => u.def.mcv)) {
      const q = p.queues.vehicles;
      if (!q.items.some((i) => i.defId === mcv.id) && this.canBuild(mcv.id)) {
        for (let i = q.items.length - 1; i >= 0; i--) if (q.items[i].progress === 0) p.dequeue(q.items[i].defId, this.world);
        if (p.enqueue(mcv.id, this.world)) this.say('rebuilding construction yard (MCV)');
      }
    }
    // ---- expansion with an MCV toward a fresh ore field
    if (this.P.expand && this.now > 420 && !this.opts.passive) this.refinerySiteOk();
    if (mcv && this.P.expand && !this.opts.passive && this.expansionTarget && this.now > 420 && p.credits > (this.harvestersFar() ? 2200 : 4000)) {
      const yards = this.myBuildings.filter((b) => b.def.produces === 'yard').length;
      const maxYards = this.difficulty === 'normal' ? 2 : 3;
      const q = p.queues.vehicles;
      if (yards > 0 && yards < maxYards && !this.my.some((u) => u.def.mcv) && !q.items.some((i) => i.defId === mcv.id) && this.canBuild(mcv.id)) {
        if (p.enqueue(mcv.id, this.world)) {
          this.stats.expansions++;
          this.say('expanding with a new MCV');
        }
      }
    }
  }

  private placeReady(tab: BuildTab) {
    const p = this.player;
    const q = p.queues[tab];
    const id = q.ready!;
    const def = BUILDINGS[id];
    const role = this.buildingRole(def);
    let spot: { x: number; z: number } | null = null;
    let spread = 0;
    if (role === 'defense' || role === 'wall') {
      spot = this.defenseSpot(def);
      spread = 3;
    } else if (role === 'power' && this.expansionTarget && this.difficulty !== 'easy' && !this.kit.mcv) {
      spot = this.expansionTarget; // crawl toward ore (factions without MCV)
    }
    const res = this.planner.findPlacement(id, role, { cx: this.cx, cz: this.cz, ex: this.ex, ez: this.ez, spot, spreadSameDef: spread });
    const placed = res ? this.world.placeBuilding(p, id, res.tx, res.tz) : null;
    if (placed) {
      this.myBuildings.push(placed); // keep this think's bookkeeping current
      if (role === 'defense') this.stats.defenses++;
      this.placeFails[tab] = 0;
      this.readySince[tab] = -1;
      this.refSiteCache.t = -999;
      this.lastGeom = -999;
      return;
    }
    this.placeFails[tab] = (this.placeFails[tab] ?? 0) + 1;
    this.stats.placementsFailed++;
    this.readySince[tab] = this.now - this.readyDelay[tab] + 1.5; // retry soon
    if (this.placeFails[tab] >= 4) {
      p.dequeue(id, this.world); // refund
      this.blocked.set(id, this.now + 45);
      this.placeFails[tab] = 0;
      this.say(`cannot place ${def.name}, cancelled`);
    }
  }

  // ---------------------------------------------------------------- defences
  private defenseCount(): number {
    let n = 0;
    for (const b of this.myBuildings) if (b.weapons.length) n++;
    return n;
  }

  private nextDefense(): BuildingDef | null {
    if (!this.myBuildings.some((b) => b.def.produces === 'yard')) return null;
    const counts = this.roleCounts();
    if (!(counts.factory ?? 0) && !(counts.barracks ?? 0)) return null;
    if (this.now < (this.difficulty === 'brutal' ? 150 : this.difficulty === 'hard' ? 200 : this.difficulty === 'normal' ? 300 : 480)) return null;
    // economy first
    if ((counts.refinery ?? 0) < Math.min(2, this.P.maxRefineries) && this.player.credits < 2500) return null;
    const n = this.defenseCount();
    const timeCap = Math.floor(1 + this.now / 150);
    const pressure = this.now - this.lastThreatT < 60 || this.now - this.lastSquadLost < 90 ? 2 : 0;
    const rich = this.player.credits > 5000 || this.armyUnits().length >= this.P.armyCap - 2 ? 4 : 0;
    const cap = Math.min(this.P.maxDefenses + (this.opts.passive ? 4 : 0) + pressure + rich, timeCap + pressure + rich);
    const mix = this.enemyMix();
    const airSeen = mix.aircraft > 0.05;
    const aaDefs = this.myBuildings.filter((b) => b.weapons.length && b.weapons.every((w) => !w.def.targetsGround)).length;
    const wantAA = airSeen ? Math.min(3, 1 + Math.floor(this.visibleAirCount() / 2)) : 0;
    const credits = this.player.credits;
    const needAA = aaDefs < wantAA;
    if (n >= cap && !needAA) return null;
    if (credits < (n < 2 ? 300 : 800) && !needAA) return null;
    let best: BuildingDef | null = null;
    let bs = -Infinity;
    const margin = this.powerMargin();
    for (const bi of this.kit.defenses) {
      const d = bi.def;
      if (!this.canBuild(d.id)) continue;
      const aaOnly = bi.dps.infantry + bi.dps.light + bi.dps.heavy === 0;
      if (needAA !== aaOnly) continue;
      const groundMix = { ...mix, building: 0 };
      let s = (effectiveness(bi.dps, needAA ? { ...emptyMix(), aircraft: 1 } : groundMix) * Math.sqrt(d.hp)) / d.cost;
      s *= 1 + (bi.range - 6) * 0.1;
      if (d.needsPower && margin + d.power < 30) s *= 0.8;
      if (this.difficulty === 'easy') s = -d.cost; // easy: cheapest only
      s *= 0.9 + this.rand() * 0.2;
      if (s > bs) {
        bs = s;
        best = d;
      }
    }
    if (best && margin + best.power < -10) {
      // not enough power for it yet: ask the structure queue for a power plant first
      this.powerRequest = -best.power + 10;
      return null;
    }
    this.powerRequest = 0;
    return best;
  }

  private visibleAirCount(): number {
    let n = 0;
    for (const s of this.seen.values()) if (s.def.flying) n++;
    return n;
  }

  private defenseSpot(def: BuildingDef): { x: number; z: number } {
    const spots: { x: number; z: number; w: number }[] = [];
    const R = Math.min(this.baseR, 14) + 1.5;
    for (const a of [0, -0.55, 0.55, -1.1, 1.1]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = this.ex * ca - this.ez * sa, dz = this.ex * sa + this.ez * ca;
      spots.push({ x: this.cx + dx * R, z: this.cz + dz * R, w: 1 + Math.abs(a) * 0.4 });
    }
    // in front of the structures closest to the enemy
    const front = this.myBuildings
      .filter((b) => !b.weapons.length && !b.def.wall && b.def.faction !== 'both')
      .map((b) => ({ b, along: (b.x - this.cx) * this.ex + (b.z - this.cz) * this.ez }))
      .sort((a, b) => b.along - a.along)
      .slice(0, 3);
    for (const f of front) spots.push({ x: f.b.x + this.ex * 3.5, z: f.b.z + this.ez * 3.5, w: 0.9 });
    for (const b of this.myBuildings) {
      if (!b.def.refinery) continue;
      spots.push({ x: b.x + this.ex * 3.5, z: b.z + this.ez * 3.5, w: 1.1 });
      const oc = this.bestOreCell(b.x, b.z);
      if (oc && Math.hypot(oc.x - b.x, oc.z - b.z) < 14) spots.push({ x: (oc.x + b.x) / 2, z: (oc.z + b.z) / 2, w: 1.3 });
    }
    // if we were attacked recently from a direction, reinforce it
    const recent = this.threats.filter((t) => this.now - t.t < 90 && t.attacker);
    if (recent.length) {
      const t = recent[recent.length - 1];
      const a = t.attacker!;
      const dx = a.x - this.cx, dz = a.z - this.cz, dl = Math.hypot(dx, dz) || 1;
      spots.push({ x: this.cx + (dx / dl) * R, z: this.cz + (dz / dl) * R, w: 0.8 });
    }
    const isAA = !(def.weapons ?? []).some((w) => BUILDINGS[def.id] && w !== 'samMissile' && w !== 'aaGun');
    let best = spots[0];
    let bs = Infinity;
    for (const s of spots) {
      let cover = 0;
      for (const b of this.myBuildings) if (b.weapons.length && Math.hypot(b.x - s.x, b.z - s.z) < 5) cover += 1;
      const sc = cover * s.w + (isAA ? Math.hypot(s.x - this.cx, s.z - this.cz) * 0.1 : 0);
      if (sc < bs) {
        bs = sc;
        best = s;
      }
    }
    if (isAA) return { x: (best.x + this.cx * 2) / 3, z: (best.z + this.cz * 2) / 3 };
    return best;
  }

  // ================================================================== production
  private armyUnits(): Unit[] {
    return this.my.filter((u) => this.isCombat(u) || u.def.flying);
  }

  private production() {
    const p = this.player;
    const army = this.armyUnits();
    const cap = this.P.armyCap;
    if (army.length >= cap) return;
    // economic reserve: keep money for the structure being built and a pending harvester
    let reserve = 0;
    const sq = p.queues.structures.items[0];
    if (sq) reserve += BUILDINGS[sq.defId].cost * (1 - sq.progress) * 0.6;
    const dq = p.queues.defense.items[0];
    if (dq) reserve += BUILDINGS[dq.defId].cost * (1 - dq.progress) * 0.5;
    const refs = this.myBuildings.filter((b) => b.def.refinery).length;
    if (refs > 0 && this.harvesterCount() < this.wantedHarvesters(refs)) reserve += 700;
    if (this.now < 90) reserve += 1500; // opening: economy first
    if (this.isBehind()) reserve *= 0.3; // out-numbered: army first
    const credits = p.credits;
    const rich = credits > 3000;
    // share of infantry in the army: once vehicles are available keep it moderate
    let infV = 0, allV = 1;
    for (const u of army) {
      allV += u.def.cost;
      if (u.def.category === 'infantry') infV += u.def.cost;
    }
    for (const it of p.queues.infantry.items) infV += UNITS[it.defId].cost;
    const hasFactory = this.myBuildings.some((b) => b.def.produces === 'factory' && b.operational);
    const infCap = 0.25 + this.enemyMix().infantry * 0.3;
    for (const tab of ['infantry', 'vehicles', 'aircraft'] as BuildTab[]) {
      const q = p.queues[tab];
      const extra = rich ? 1 : 0;
      if (tab === 'infantry' && hasFactory && infV / allV > infCap && credits < 2500 && army.length > 6) continue;
      if (q.items.length >= this.P.armyQueue + extra) continue;
      if ((this.prodPauseUntil[tab] ?? 0) > this.now) continue;
      const id = this.chooseUnit(tab, army);
      if (!id) continue;
      const cost = UNITS[id].cost;
      if (credits - reserve < cost * 0.4 && !(credits > cost && q.items.length === 0 && reserve < credits)) continue;
      if (p.enqueue(id, this.world)) {
        if (this.P.prodPause > 0) this.prodPauseUntil[tab] = this.now + this.P.prodPause * (0.5 + this.rand());
      }
    }
  }

  private profCache: EnemyProfile | null = null;
  private profTime = -999;
  /** Enemy army profile: what we have seen, blended with the enemy factions' basic line-up. */
  private enemyProfile(): EnemyProfile {
    if (this.profCache && this.now - this.profTime < 5) return this.profCache;
    const entries: { def: UnitDef; weight: number }[] = [];
    let seenTotal = 0;
    for (const sv of this.seen.values()) {
      if (sv.unit.dead || this.now - sv.t > 180) continue;
      if (sv.def.harvester || sv.def.mcv || sv.def.weapons.length === 0) continue;
      entries.push({ def: sv.def, weight: sv.def.cost });
      seenTotal += sv.def.cost;
    }
    const w = this.P.counter * Math.min(1, seenTotal / 4000);
    // prior: the enemy factions' basic combat units, equal cost share
    const prior: UnitDef[] = [];
    for (const e of this.enemies) for (const ui of getKit(e.faction).combatUnits) if ((ui.def.techLevel ?? 1) <= 2 && ui.role !== 'aircraft') prior.push(ui.def);
    const pw = prior.length ? ((1 - w) * Math.max(seenTotal, 1)) / Math.max(w, 0.0001) / prior.length : 0;
    if (w <= 0.0001) entries.length = 0;
    for (const d of prior) entries.push({ def: d, weight: w <= 0.0001 ? 1 : pw });
    this.profCache = buildProfile(entries);
    this.profTime = this.now;
    return this.profCache;
  }

  private chooseUnit(tab: BuildTab, army: Unit[]): string | null {
    const mix = this.enemyMix();
    const prof = this.enemyProfile();
    const counts = new Map<string, number>();
    let arty = 0, air = 0, inf = 0;
    for (const u of army) {
      counts.set(u.def.id, (counts.get(u.def.id) ?? 0) + 1);
      const r = unitInfo(u.def).role;
      if (r === 'artillery') arty++;
      if (r === 'aircraft') air++;
      if (r === 'infantry') inf++;
    }
    for (const t of ['infantry', 'vehicles', 'aircraft'] as BuildTab[])
      for (const it of this.player.queues[t].items) {
        counts.set(it.defId, (counts.get(it.defId) ?? 0) + 1);
        const ui = this.kit.unit[it.defId];
        if (ui?.role === 'aircraft') air++;
        if (ui?.role === 'artillery') arty++;
      }
    const total = Math.max(1, army.length);
    // raiders for harassment (hard+)
    const scout = this.kit.scoutUnit;
    if (tab === 'vehicles' && scout && this.P.harass && !this.opts.passive && this.now > (this.P.earlyHarass ? 90 : 240) && this.canBuild(scout.def.id)) {
      let fast = 0;
      for (const u of army) if (unitInfo(u.def).fast) fast++;
      for (const it of this.player.queues.vehicles.items) if (this.kit.unit[it.defId]?.fast) fast++;
      if (fast < 2 && this.now - this.lastHarass > 60) return scout.def.id;
    }
    // enemy aircraft around and too little anti-air: build some
    let enemyAir = 0;
    for (const sv of this.seen.values()) if (sv.def.flying && !sv.unit.dead && this.now - sv.t < 150) enemyAir++;
    if (enemyAir > 0) {
      let aa = 0;
      for (const u of army) if (u.weapons.some((w) => w.def.targetsAir)) aa++;
      if (aa < enemyAir * 2 + 1) {
        let best: UnitInfo | null = null;
        let bs = -Infinity;
        for (const ui of this.kit.combatUnits) {
          if (ui.def.tab !== tab || !ui.antiAir || ui.role === 'aircraft' || !this.canBuild(ui.def.id)) continue;
          const sc = (ui.dps.aircraft * Math.sqrt(ui.def.hp)) / ui.def.cost;
          if (sc > bs) {
            bs = sc;
            best = ui;
          }
        }
        if (best && this.rand() < 0.7) return best.def.id;
      }
    }
    const all: { id: string; s: number; tab: BuildTab }[] = [];
    for (const ui of this.kit.combatUnits) {
      const d = ui.def;
      if (!this.canBuild(d.id)) continue;
      let s = fightValue(ui, prof, mix.building);
      s *= 1 + (ui.range - 5) * 0.05;
      if (d.category === 'vehicle') s *= 1.1;
      if (d.crusher) s *= 1 + prof.mix.infantry * 0.3;
      if ((d.techLevel ?? 1) >= 3) s *= 1.1;
      if (d.stealth) s *= 1.1;
      if (d.selfHeal) s *= 1.1;
      const share = (counts.get(d.id) ?? 0) / total;
      if (share > 0.3) s *= Math.max(0.25, 1 - (share - 0.3) * 2.5);
      if (ui.role === 'artillery') {
        if (arty / total > 0.15 || total < 6) s *= 0.25;
        else s *= 1.1;
      }
      if (ui.role === 'aircraft') {
        if (air >= this.P.maxAircraft) continue;
        if (this.opts.passive) continue;
      }
      if (ui.role === 'infantry' && inf / total > 0.55) s *= 0.6;
      if (mix.aircraft > 0.05 && ui.antiAir) s *= 1.2;
      all.push({ id: d.id, s, tab: d.tab });
    }
    const opts = all.filter((o) => o.tab === tab);
    if (opts.length === 0) return null;
    // this production line only makes poor units right now: save the money for the others
    let bestAll = 0;
    for (const o of all) bestAll = Math.max(bestAll, o.s);
    const bestHere = Math.max(...opts.map((o) => o.s));
    if (bestHere < bestAll * 0.4 && this.player.credits < 2500 && this.difficulty !== 'easy') return null;
    if (this.rand() < this.P.mistakes) return opts[Math.floor(this.rand() * opts.length)].id;
    // weighted pick among the best few (keeps variety)
    opts.sort((a, b) => b.s - a.s);
    const top = opts.filter((o) => o.s >= opts[0].s * 0.8).slice(0, 3);
    let sum = 0;
    for (const o of top) sum += o.s;
    let r = this.rand() * sum;
    for (const o of top) {
      r -= o.s;
      if (r <= 0) return o.id;
    }
    return top[0].id;
  }

  // ================================================================== engineers / derricks
  private engineers() {
    const eng = this.kit.engineer;
    if (!eng) return;
    const engineers = this.my.filter((u) => u.def.engineer);
    const targeted = new Set<Building>();
    for (const [u, b] of this.engineerTargets) if (!u.dead) targeted.add(b);
    const options: Building[] = [];
    for (const b of this.world.buildings) {
      if (b.dead || b.def.id !== 'n_derrick') continue;
      if (b.owner === this.player) continue;
      if (!b.owner.isNeutral && !b.owner.isEnemyOf(this.player)) continue;
      const d = Math.hypot(b.x - this.cx, b.z - this.cz);
      if (d > 60) continue;
      if (this.dangerAt(b.x, b.z, 9) > 500) continue;
      options.push(b);
    }
    for (const u of engineers) {
      const s = this.st(u);
      s.job = 'engineer';
      let t = this.engineerTargets.get(u);
      if (t && (t.dead || t.owner === this.player)) {
        this.engineerTargets.delete(u);
        t = undefined;
      }
      if (!t) {
        // derrick first, else repair a badly damaged own building
        let best: Building | null = null;
        let bd = Infinity;
        for (const b of options) {
          if (targeted.has(b)) continue;
          const d = Math.hypot(b.x - u.x, b.z - u.z);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        if (!best) {
          const dmg = this.myBuildings.filter((b) => b.hp < b.maxHp * 0.45 && b.def.cost >= 800).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (dmg) best = dmg;
        }
        if (best) {
          this.engineerTargets.set(u, best);
          targeted.add(best);
          u.issue({ type: 'enter', target: best }, this.world);
          s.lastOrder = this.now;
        } else if (u.order.type === 'idle' && Math.hypot(u.x - this.cx, u.z - this.cz) > 6 && this.now - s.lastOrder > 10) {
          this.orderMove(u, this.cx + 2, this.cz + 3, false, 10);
        }
      } else {
        const d = t.distTo(u.x, u.z);
        if (u.order.type === 'enter' && d >= 0.75 && d < 1.6 && !u.moving && !u.needsPath) {
          // Work around Unit.updateEnter stalling next to a building corner
          // (arrives within 0.25 of a diagonal tile centre, i.e. ~0.9 from the
          // footprint, but only enters below 0.75): step right up to the wall.
          const px = Math.max(t.tx, Math.min(t.tx + t.w, u.x)), pz = Math.max(t.tz, Math.min(t.tz + t.h, u.z));
          const dx = u.x - px, dz = u.z - pz, dl = Math.hypot(dx, dz) || 1;
          s.lastOrder = this.now;
          u.issue({ type: 'move', x: px + (dx / dl) * 0.35, z: pz + (dz / dl) * 0.35 }, this.world);
          u.arriveTolerance = 0.1;
        } else if (u.order.type !== 'enter' && (u.order.type === 'idle' || this.now - s.lastOrder > 6)) {
          s.lastOrder = this.now;
          u.issue({ type: 'enter', target: t }, this.world);
        }
      }
    }
    // production of engineers
    const q = this.player.queues.infantry;
    const queued = q.items.some((i) => i.defId === eng.id);
    const untargeted = options.filter((b) => !targeted.has(b)).length;
    const minT = this.difficulty === 'easy' ? 240 : this.difficulty === 'normal' ? 100 : 70;
    if (!queued && untargeted > 0 && engineers.length < 2 && this.engineersBuilt < this.P.engineers + 1 && this.now > minT && this.player.credits > 700 && this.canBuild(eng.id)) {
      if (this.player.enqueue(eng.id, this.world)) {
        this.engineersBuilt++;
        this.say('training an engineer for a derrick');
      }
    }
  }

  // ================================================================== military
  private military() {
    const pool: Unit[] = [];
    for (const u of this.my) {
      const s = this.st(u);
      if (s.job === 'pool') pool.push(u);
    }
    this.defend(pool);
    this.microRetreat();
    if (this.difficulty !== 'easy') this.rangeMicro();
    this.updateSquads();
    this.scouting();
    this.aircraft();
    this.maybeHarass();
    this.maybeAttack();
    this.positionPool();
  }

  // ---------------------------------------------------------------- defence
  private defend(pool: Unit[]) {
    // enemies inside our base zone
    const threats: Unit[] = [];
    const zoneR = this.baseR + 9;
    const guardPts: { x: number; z: number; r: number }[] = [{ x: this.cx, z: this.cz, r: zoneR }];
    for (const b of this.myBuildings) if (b.def.refinery || b.def.produces === 'yard' || b.def.id === 'n_derrick') guardPts.push({ x: b.x, z: b.z, r: 10 });
    for (const t of this.threats) if (t.harvester && this.now - t.t < 6) guardPts.push({ x: t.x, z: t.z, r: 9 });
    for (const e of this.visibleEnemies) {
      if (e.isAir && !this.my.some((u) => u.weapons.some((w) => w.def.targetsAir))) continue;
      for (const g of guardPts) {
        if (Math.abs(e.x - g.x) < g.r && Math.abs(e.z - g.z) < g.r && Math.hypot(e.x - g.x, e.z - g.z) < g.r) {
          threats.push(e);
          break;
        }
      }
    }
    // attackers hitting our buildings from outside vision (artillery)
    for (const t of this.threats) {
      if (this.now - t.t > 3 || !t.attacker || t.attacker.dead || t.attacker.kind !== 'unit') continue;
      const a = t.attacker as Unit;
      if (!threats.includes(a) && Math.hypot(a.x - this.cx, a.z - this.cz) < zoneR + 10) threats.push(a);
    }
    const defenders = this.my.filter((u) => this.st(u).job === 'defend');
    if (threats.length === 0) {
      if (this.now - this.lastThreatT > 7) for (const u of defenders) this.setJob(u, 'pool');
      return;
    }
    this.lastThreatT = this.now;
    let threatVal = 0, tx = 0, tz = 0;
    for (const e of threats) {
      const v = Math.max(150, e.def.cost) * (e.hp / e.maxHp);
      threatVal += v;
      tx += e.x * v;
      tz += e.z * v;
    }
    tx /= threatVal;
    tz /= threatVal;
    let have = 0;
    for (const u of defenders) have += this.value(u);
    const need = threatVal * 1.5 + 200;
    if (have < need) {
      const avail = pool.filter((u) => u.weapons.length > 0).sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz));
      for (const u of avail) {
        if (have >= need) break;
        this.setJob(u, 'defend');
        defenders.push(u);
        have += this.value(u);
      }
    }
    // recall squads when the base is in real danger
    if (have < need && threatVal > 1200) {
      for (const sq of this.squads) {
        let cx = 0, cz = 0;
        for (const u of sq.units) {
          cx += u.x;
          cz += u.z;
        }
        if (sq.units.length === 0) continue;
        cx /= sq.units.length;
        cz /= sq.units.length;
        const far = Math.hypot(cx - this.cx, cz - this.cz);
        // nearby squads always help; distant ones only on hard+ when the threat is serious
        if (far < 28 || (this.P.micro && threatVal > 2500 && sq.kind === 'attack') || (this.difficulty === 'normal' && threatVal > 4000)) {
          this.say(`recalls squad ${sq.id} to defend base`);
          for (const u of [...sq.units]) {
            this.setJob(u, 'defend');
            defenders.push(u);
            have += this.value(u);
          }
        }
        if (have >= need) break;
      }
    }
    for (const u of defenders) {
      if (u.target && !u.target.dead && u.target.distTo(u.x, u.z) < 10) continue;
      // go for the closest threat to this defender
      let best: Unit | null = null;
      let bd = Infinity;
      for (const e of threats) {
        if (!u.weapons.some((w) => (e.isAir ? w.def.targetsAir : w.def.targetsGround))) continue;
        const d = Math.hypot(e.x - u.x, e.z - u.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) continue;
      if (bd < 9) this.orderAttack(u, best, 1.5);
      else this.orderMove(u, best.x, best.z, true, 2);
    }
  }

  /**
   * Units with several weapons of different reach (e.g. a tank with a long-range
   * missile pod) stop at the longest range, so the main gun never fires
   * (see Unit.engage). Step such units into range of their best weapon.
   */
  private rangeMicro() {
    for (const u of this.my) {
      if (u.weapons.length < 2 || u.def.flying) continue;
      const t = u.target;
      if (!t || t.dead || u.moving || u.needsPath) continue;
      let best = null as (typeof u.weapons)[number] | null;
      let bd = 0, maxR = 0;
      for (const w of u.weapons) {
        const hit = t.isAir ? w.def.targetsAir : w.def.targetsGround && w.def.vs[t.armor] > 0;
        if (!hit) continue;
        maxR = Math.max(maxR, w.def.range);
        const dps = (w.def.damage * (w.def.burst ?? 1) * w.def.vs[t.armor]) / w.def.cooldown;
        if (dps > bd) {
          bd = dps;
          best = w;
        }
      }
      if (!best || best.def.range >= maxR) continue;
      const d = t.distTo(u.x, u.z);
      if (d <= best.def.range || d > maxR + 0.3) continue;
      const dx = t.x - u.x, dz = t.z - u.z, dl = Math.hypot(dx, dz) || 1;
      const step = d - best.def.range + 0.7;
      this.orderMove(u, u.x + (dx / dl) * step, u.z + (dz / dl) * step, true, 1.5);
    }
  }

  // ---------------------------------------------------------------- individual retreat (hard+)
  private microRetreat() {
    if (!this.P.micro) return;
    const depot = this.myBuildings.find((b) => b.def.repairPad && b.operational);
    for (const u of this.my) {
      const s = this.st(u);
      if (s.job === 'repair') {
        const healed = u.hp >= u.maxHp * 0.95;
        if (healed || this.now - s.since > 90) {
          this.setJob(u, 'pool');
          continue;
        }
        if (depot && !depot.dead) {
          if (!depot.occupies(u.x, u.z)) {
            if (u.order.type !== 'enter' && this.now - s.lastOrder > 4) {
              s.lastOrder = this.now;
              u.issue({ type: 'enter', target: depot }, this.world);
            }
          }
        } else this.orderMove(u, this.rallyX, this.rallyZ, false, 5);
        continue;
      }
      if (s.job !== 'squad' && s.job !== 'defend' && s.job !== 'harass') continue;
      if (u.def.category !== 'vehicle' || u.isAir) continue;
      const canHeal = !!depot || (u.def.selfHeal ?? 0) > 0 || u.rank >= 2;
      if (!canHeal) continue;
      if (u.hp < u.maxHp * this.P.retreatHp) {
        this.setJob(u, 'repair');
        s.lastOrder = -999;
        if (depot) u.issue({ type: 'enter', target: depot }, this.world);
        else u.issue({ type: 'move', x: this.rallyX, z: this.rallyZ }, this.world);
        s.lastOrder = this.now;
      }
    }
  }

  // ---------------------------------------------------------------- attack waves
  private waveSize(): number {
    const n = this.P.waveMin + this.P.waveGrowth * this.waves;
    return Math.max(3, Math.round(Math.min(this.P.waveMax, n) / Math.sqrt(this.aggression)));
  }

  private firstAttackTime(): number {
    if (this.opts.attackDelay !== undefined) return this.opts.attackDelay;
    return this.P.firstAttack / this.aggression;
  }

  /** Value of the enemy army we know about (seen recently and not known dead). */
  private behindCache = { t: -999, v: false };
  /** Are we clearly out-numbered by the enemy army we know about? Then army first, economy later. */
  private isBehind(): boolean {
    if (this.now - this.behindCache.t < 3) return this.behindCache.v;
    let est = 0;
    for (const sv of this.seen.values()) {
      if (sv.unit.dead || this.now - sv.t > 180) continue;
      if (sv.def.harvester || sv.def.mcv || sv.def.weapons.length === 0) continue;
      est += sv.def.cost;
    }
    let own = 0;
    for (const u of this.my) if (this.isCombat(u) || u.def.flying) own += u.def.cost;
    for (const t of ['infantry', 'vehicles', 'aircraft'] as BuildTab[]) for (const it of this.player.queues[t].items) if (!UNITS[it.defId].harvester) own += UNITS[it.defId].cost * 0.5;
    const v = this.now > 150 && est > own * 1.15 + 500;
    this.behindCache = { t: this.now, v };
    return v;
  }

  private enemyArmyEstimate(): number {
    let v = 0;
    for (const s of this.seen.values()) {
      if (s.unit.dead || this.now - s.t > 180) continue;
      if (s.def.harvester || s.def.mcv || s.def.weapons.length === 0) continue;
      v += s.def.cost;
    }
    // no recent sighting: assume the enemy has built an army comparable to ours
    if (v === 0 && this.now > 150) {
      let own = 0;
      for (const u of this.my) if (this.isCombat(u)) own += u.def.cost;
      v = own * (this.difficulty === 'normal' ? 0.5 : 0.75);
    }
    // static defences we know about count too (they fight at full strength at home)
    for (const b of this.knownBuildings) if (b.weapons.length && !b.owner.isNeutral && !(b.def.needsPower && b.owner.lowPower)) v += b.def.cost * 0.8;
    return v;
  }

  private maybeAttack() {
    if (this.opts.passive) return;
    // only units that have gathered at the rally point are sent out
    const pool = this.my.filter((u) => this.st(u).job === 'pool' && this.isCombat(u) && Math.hypot(u.x - this.rallyX, u.z - this.rallyZ) < 14);
    if (this.now < this.firstAttackTime()) {
      // exception: a huge idle army (lots of starting money) attacks earlier
      if (this.difficulty === 'easy' || this.opts.attackDelay !== undefined || pool.length < Math.max(30, this.P.waveMax * 2)) return;
    }
    const active = this.squads.filter((s) => s.kind === 'attack' && s.units.length >= 3);
    const reinforceMin = this.P.micro ? 5 : 6;
    // reinforce the active wave: the reinforcements travel as their own group and merge on arrival
    const mainOk = (sq: Squad) => {
      const v = sq.units.reduce((a, u) => a + this.value(u), 0);
      return v > sq.startValue * 0.5 && !this.squads.some((o) => o.join === sq && o.units.length > 0);
    };
    if (this.P.reinforce && active.length > 0 && pool.length >= reinforceMin && this.now - this.lastThreatT > 10 && mainOk(active[0])) {
      const main = active[0];
      const keep = this.difficulty === 'easy' || this.difficulty === 'normal' ? 2 : 0;
      const send = [...pool].sort((a, b) => b.def.cost - a.def.cost).slice(0, pool.length - keep);
      const sq = this.createSquad('attack', send, main);
      if (sq) this.say(`sends ${send.length} reinforcements to squad ${main.id}`);
      return;
    }
    if (this.now - this.lastAttackT < this.P.minAttackGap / this.aggression) return;
    if (this.now - this.lastThreatT < 8) return;
    const want = this.waveSize();
    const cap = Math.min(this.P.armyCap - 4, this.P.waveMax * 1.6);
    if (pool.length < want && pool.length < cap) return;
    if (pool.length === 0) return;
    // don't suicide into a much bigger army we have seen (normal+)
    const ratio = this.difficulty === 'easy' ? 0 : this.difficulty === 'normal' ? 0.8 : this.difficulty === 'hard' ? 1.2 : 1.1;
    const poolV = pool.reduce((a, u) => a + this.value(u), 0);
    const est = this.enemyArmyEstimate();
    const waited = this.now - Math.max(this.lastAttackT, this.firstAttackTime());
    if (poolV < est * ratio && pool.length < cap && (waited < 360 || poolV < est * ratio * 0.5)) return;
    // keep a home guard (cheap units) and cap the wave size below hard difficulty
    const guardFrac = this.difficulty === 'easy' ? 0.3 : this.difficulty === 'normal' ? 0.25 : this.difficulty === 'hard' ? 0.12 : 0.08;
    const sorted = [...pool].sort((a, b) => b.def.cost - a.def.cost);
    let n = Math.max(1, sorted.length - Math.floor(sorted.length * guardFrac));
    if (this.difficulty === 'easy' || this.difficulty === 'normal') n = Math.min(n, Math.max(want, this.P.waveMax));
    const send = sorted.slice(0, n);
    const sq = this.createSquad('attack', send);
    if (!sq) return;
    this.waves++;
    this.lastAttackT = this.now;
    this.stats.attacks++;
    this.say(`launches attack wave #${this.waves} (${send.length}/${pool.length} units, value ${poolV.toFixed(0)} vs est. ${est.toFixed(0)}) toward ${sq.objective ? sq.objective.name : 'enemy territory'}`);
  }

  private createSquad(kind: 'attack' | 'harass', units: Unit[], join: Squad | null = null): Squad | null {
    const c = this.centroid(units);
    if (!c) return null;
    const sq: Squad = {
      id: squadIds++, kind, units: [...units], state: 'advance', objective: null, objX: c.x, objZ: c.z, path: [], wp: 0,
      startValue: units.reduce((a, u) => a + this.value(u), 0), created: this.now, regroupT: -999,
      lastCx: c.x, lastCz: c.z, progressT: this.now, fightX: 0, fightZ: 0, lastEngageT: -999, join,
      staged: kind === 'harass' || !!join || this.difficulty === 'easy' || units.length < 4, stageT: -1,
    };
    for (const u of units) {
      this.setJob(u, kind === 'harass' ? 'harass' : 'squad');
      this.st(u).squad = sq;
    }
    this.retarget(sq, c.x, c.z);
    this.squads.push(sq);
    return sq;
  }

  private centroid(units: Unit[]): { x: number; z: number } | null {
    let sx = 0, sz = 0, n = 0;
    for (const u of units) {
      if (u.dead) continue;
      if (unitInfo(u.def).role === 'artillery' && units.length > 2) continue;
      sx += u.x;
      sz += u.z;
      n++;
    }
    if (n === 0) {
      for (const u of units) {
        if (u.dead) continue;
        sx += u.x;
        sz += u.z;
        n++;
      }
    }
    if (n === 0) return null;
    // robust: average of the units within 12 tiles of the mean
    const mx = sx / n, mz = sz / n;
    let rx = 0, rz = 0, rn = 0;
    for (const u of units) {
      if (u.dead) continue;
      if (Math.hypot(u.x - mx, u.z - mz) < 12) {
        rx += u.x;
        rz += u.z;
        rn++;
      }
    }
    return rn > 0 ? { x: rx / rn, z: rz / rn } : { x: mx, z: mz };
  }

  /** Pick the squad's next objective and plan a route to it. */
  private retarget(sq: Squad, fx: number, fz: number) {
    let obj = sq.kind === 'harass' ? this.harassObjective(fx, fz) : this.chooseObjective(fx, fz);
    if (sq.join) {
      const jc = sq.join.units.length ? this.centroid(sq.join.units) : null;
      if (jc) obj = { entity: null, x: jc.x, z: jc.z };
      else sq.join = null;
    }
    sq.objective = obj.entity;
    sq.objX = obj.x;
    sq.objZ = obj.z;
    const m = this.world.map;
    const np = m.nearestPassable(obj.x, obj.z, 12);
    const gx = np ? np[0] + 0.5 : obj.x, gz = np ? np[1] + 0.5 : obj.z;
    const raw = this.world.pathfinder.find(fx, fz, gx, gz, 40000);
    // resample into waypoints ~9 tiles apart
    const pts: { x: number; z: number }[] = [];
    let px = fx, pz = fz;
    for (const q of raw) {
      const d = Math.hypot(q.x - px, q.z - pz);
      const n = Math.ceil(d / 9);
      for (let i = 1; i <= n; i++) pts.push({ x: px + ((q.x - px) * i) / n, z: pz + ((q.z - pz) * i) / n });
      px = q.x;
      pz = q.z;
    }
    if (pts.length === 0) pts.push({ x: gx, z: gz });
    sq.path = pts;
    sq.wp = 0;
    sq.progressT = this.now;
  }

  private roleWeight(b: Building): number {
    if (this.difficulty === 'easy' || this.difficulty === 'normal') {
      return b.def.wall ? 0.05 : b.def.id === 'n_derrick' ? 0.3 : 1;
    }
    const r = this.buildingRole(b.def);
    const kitRole = b.def.refinery ? 'refinery' : b.def.superweapon ? 'superweapon' : b.def.produces ? 'prod' : b.def.power > 0 && !b.def.produces ? 'power' : b.weapons.length ? 'defense' : r;
    switch (kitRole) {
      case 'superweapon':
        return 5;
      case 'refinery':
        return 4;
      case 'power':
        return 3.2;
      case 'prod':
        return b.def.produces === 'yard' ? 3 : 3;
      case 'defense':
        return 2;
      case 'wall':
        return 0.05;
      default:
        return b.def.id === 'n_derrick' ? 1.5 : 1.5;
    }
  }

  private chooseObjective(fx: number, fz: number): { entity: Entity | null; x: number; z: number } {
    let best: Entity | null = null;
    let bs = -Infinity;
    const smart = this.difficulty === 'hard' || this.difficulty === 'brutal';
    for (const b of this.knownBuildings) {
      if (b.owner.isNeutral) continue;
      const d = Math.hypot(b.x - fx, b.z - fz);
      let s = (this.roleWeight(b) * 30) / (30 + d);
      if (smart) {
        const danger = this.dangerAt(b.x, b.z, 8);
        s /= 1 + danger / 4000;
      }
      if (s > bs) {
        bs = s;
        best = b;
      }
    }
    if (smart) {
      for (const u of this.visibleEnemies) {
        if (!u.def.harvester) continue;
        const d = Math.hypot(u.x - fx, u.z - fz);
        const s = (5 * 30) / (30 + d);
        if (s > bs) {
          bs = s;
          best = u;
        }
      }
    }
    if (best) return { entity: best, x: best.x, z: best.z };
    if (this.P.cheatBase) {
      const u = this.nearestEnemyUnit(fx, fz);
      if (u) return { entity: u.isAir ? null : u, x: u.x, z: u.z };
    }
    // nothing known: explore likely start spots, then hunt the least recently seen areas
    if (this.candidates.length) return { entity: null, x: this.candidates[0].x, z: this.candidates[0].z };
    let seenUnit: SeenUnit | null = null;
    for (const s of this.seen.values()) if (!s.unit.dead && !s.def.flying && (!seenUnit || s.t > seenUnit.t)) seenUnit = s;
    if (seenUnit && this.now - seenUnit.t < 30) return { entity: null, x: seenUnit.x, z: seenUnit.z };
    // stalemate breaker: late in the game go straight for whatever the enemy has left
    if (this.now > 1500) {
      const u = this.nearestEnemyUnit(fx, fz);
      if (u) return { entity: u.isAir ? null : u, x: u.x, z: u.z };
    }
    return this.huntPoint(fx, fz);
  }

  private nearestEnemyUnit(fx: number, fz: number): Unit | null {
    let bu: Unit | null = null;
    let bd = Infinity;
    for (const u of this.world.units) {
      if (u.dead || !u.owner.isEnemyOf(this.player)) continue;
      const d = Math.hypot(u.x - fx, u.z - fz) + (u.isAir ? 30 : 0);
      if (d < bd) {
        bd = d;
        bu = u;
      }
    }
    return bu;
  }

  private huntPoint(fx: number, fz: number): { entity: Entity | null; x: number; z: number } {
    const m = this.world.map;
    let bi = -1;
    let bs = -Infinity;
    for (let j = 0; j < this.ch; j++)
      for (let i = 0; i < this.cw; i++) {
        const x = i * this.cellSize + this.cellSize / 2, z = j * this.cellSize + this.cellSize / 2;
        const np = m.nearestPassable(x, z, 3);
        if (!np) continue;
        const age = this.now - this.cellSeen[j * this.cw + i];
        const s = Math.min(age, 600) - Math.hypot(x - fx, z - fz) * 0.8 + this.rand() * 20;
        if (s > bs) {
          bs = s;
          bi = j * this.cw + i;
        }
      }
    if (bi < 0) return { entity: null, x: m.w / 2, z: m.h / 2 };
    const i = bi % this.cw, j = Math.floor(bi / this.cw);
    // mark as visited-in-intent to avoid ping-pong
    this.cellSeen[bi] = this.now - 60;
    return { entity: null, x: i * this.cellSize + this.cellSize / 2, z: j * this.cellSize + this.cellSize / 2 };
  }

  private updateSquads() {
    for (const sq of this.squads) {
      // units may have been reassigned (defence / repair)
      sq.units = sq.units.filter((u) => !u.dead && this.st(u).squad === sq);
      if (sq.units.length === 0) continue;
      if (sq.join) {
        const target = sq.join;
        target.units = target.units.filter((u) => !u.dead && this.st(u).squad === target);
        const a = this.centroid(sq.units), b = target.units.length ? this.centroid(target.units) : null;
        if (!b) {
          // the main group is gone: a big group carries on, a small one goes home
          sq.join = null;
          if (sq.units.length >= this.waveSize()) this.retarget(sq, a ? a.x : this.cx, a ? a.z : this.cz);
          else {
            for (const u of [...sq.units]) this.setJob(u, 'pool');
            sq.units = [];
            continue;
          }
        } else if (a && Math.hypot(a.x - b.x, a.z - b.z) < 10) {
          for (const u of sq.units) {
            this.st(u).squad = target;
            target.units.push(u);
          }
          target.startValue += sq.startValue;
          sq.units = [];
          continue;
        } else if (a && Math.hypot(sq.objX - b.x, sq.objZ - b.z) > 12) this.retarget(sq, a.x, a.z);
      }
      this.updateSquad(sq);
    }
    this.squads = this.squads.filter((s) => s.units.length > 0);
  }

  private updateSquad(sq: Squad) {
    // (staging: before the final approach the whole group gathers so it hits at once)
    const c = this.centroid(sq.units);
    if (!c) return;
    const now = this.now;
    // ---- losses: retreat?
    const cur = sq.units.reduce((a, u) => a + this.value(u), 0);
    let enemyNear = 0;
    let nearest: Entity | null = null;
    let nd = Infinity;
    for (const e of this.visibleEnemies) {
      const d = Math.hypot(e.x - c.x, e.z - c.z);
      if (d > 12) continue;
      if (e.weapons.length) enemyNear += e.def.cost * (e.hp / e.maxHp);
      if (d < nd && sq.units.some((u) => u.weapons.some((w) => (e.isAir ? w.def.targetsAir : w.def.targetsGround)))) {
        nd = d;
        nearest = e;
      }
    }
    for (const b of this.knownBuildings) {
      if (!b.weapons.length || b.owner.isNeutral) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d > 10) continue;
      if (!(b.def.needsPower && b.owner.lowPower)) enemyNear += b.def.cost * 1.3 * (b.hp / b.maxHp);
      if (d < nd) {
        nd = d;
        nearest = b;
      }
    }
    if (this.P.squadRetreat > 0 && cur < sq.startValue * this.P.squadRetreat && enemyNear > cur * 1.3) {
      this.say(`squad ${sq.id} retreats (${sq.units.length} left)`);
      this.lastSquadLost = this.now;
      for (const u of [...sq.units]) {
        this.setJob(u, 'pool');
        const s = this.st(u);
        s.lastOrder = -999;
        this.orderMove(u, this.rallyX, this.rallyZ, false, 0);
      }
      sq.units = [];
      return;
    }
    const engaged = sq.units.filter((u) => u.target && !u.target.dead && u.target.distTo(u.x, u.z) < 12);
    if (engaged.length > 0 || (nearest && nd < 10)) {
      sq.state = 'fight';
      sq.lastEngageT = now;
      const focus = nearest ?? engaged[0].target!;
      sq.fightX = focus.x;
      sq.fightZ = focus.z;
    } else if (sq.state === 'fight' && now - sq.lastEngageT > 3) {
      sq.state = 'advance';
      // re-plan from here (objective may be gone)
      this.retarget(sq, c.x, c.z);
    }
    // ---- objective still valid?
    if (sq.objective && (sq.objective.dead || (sq.objective.kind === 'unit' && !this.world.visibleTo(sq.objective, this.player) && Math.hypot(sq.objective.x - c.x, sq.objective.z - c.z) < 8))) {
      this.retarget(sq, c.x, c.z);
    }
    const back = { x: -this.ex, z: -this.ez };
    if (sq.state === 'fight') {
      // focus fire at hard+: pick the weakest dangerous enemy in reach
      let focusT: Entity | null = null;
      if (this.P.focusFire) focusT = this.pickFocus(c.x, c.z, sq.units);
      for (const u of sq.units) {
        const art = unitInfo(u.def).role === 'artillery';
        if (art) {
          const dx = c.x - sq.fightX, dz = c.z - sq.fightZ, dl = Math.hypot(dx, dz) || 1;
          this.orderMove(u, c.x + (dx / dl) * 3, c.z + (dz / dl) * 3, true, 3);
          continue;
        }
        if (focusT && u.weapons.some((w) => (focusT!.isAir ? w.def.targetsAir : w.def.targetsGround && w.def.vs[focusT!.armor] > 0.3))) {
          const dist = focusT.distTo(u.x, u.z);
          const r = Math.max(...u.weapons.map((w) => w.def.range));
          if (dist < r + 3 && (!u.target || u.target === focusT || u.target.kind === 'building' || (u.target as Entity).hp > focusT.hp)) {
            this.orderAttack(u, focusT, 1.5);
            continue;
          }
        }
        // Units on attack-move keep shooting a building even while enemy units
        // hit them (Unit.updateMove never re-evaluates its target): switch them.
        if (u.target && !u.target.dead && u.target.kind === 'building' && !(u.target as Building).weapons.length) {
          const threat = this.nearestThreat(u);
          if (threat) {
            this.orderAttack(u, threat, 1.5);
            continue;
          }
        }
        if (u.target && !u.target.dead) continue;
        this.orderMove(u, sq.fightX, sq.fightZ, true, 2);
      }
      return;
    }
    // ---- advance / regroup
    let spread = 0;
    for (const u of sq.units) if (Math.hypot(u.x - c.x, u.z - c.z) > 9) spread++;
    const spreadFrac = spread / sq.units.length;
    if (sq.state === 'advance' && spreadFrac > 0.35 && now - sq.regroupT > 25 && sq.units.length >= 3) {
      sq.state = 'regroup';
      sq.regroupT = now;
    }
    if (sq.state === 'regroup') {
      if (spreadFrac < 0.15 || now - sq.regroupT > 12) sq.state = 'advance';
      else {
        for (const u of sq.units) {
          if (Math.hypot(u.x - c.x, u.z - c.z) > 4) this.orderMove(u, c.x, c.z, true, 3);
        }
        return;
      }
    }
    // progress / stuck detection
    if (Math.hypot(c.x - sq.lastCx, c.z - sq.lastCz) > 3) {
      sq.lastCx = c.x;
      sq.lastCz = c.z;
      sq.progressT = now;
    } else if (now - sq.progressT > 25) {
      this.retarget(sq, c.x, c.z);
      sq.lastCx = c.x;
      sq.lastCz = c.z;
    }
    while (sq.wp < sq.path.length - 1 && Math.hypot(sq.path[sq.wp].x - c.x, sq.path[sq.wp].z - c.z) < 4.5) sq.wp++;
    const wp = sq.path[Math.min(sq.wp, sq.path.length - 1)];
    if (!sq.staged) {
      const end = sq.path[sq.path.length - 1];
      let enemyClose = false;
      for (const e of this.visibleEnemies) if (e.weapons.length && Math.abs(e.x - c.x) < 17 && Math.abs(e.z - c.z) < 17 && Math.hypot(e.x - c.x, e.z - c.z) < 17) enemyClose = true;
      const nearTarget = Math.hypot(end.x - c.x, end.z - c.z) < 22 || enemyClose || this.dangerAt(wp.x, wp.z, 10) > 0;
      if (nearTarget) {
        if (sq.stageT < 0) {
          sq.stageT = now;
          this.say(`squad ${sq.id} stages before the assault`);
        }
        let far = 0;
        for (const u of sq.units) if (Math.hypot(u.x - c.x, u.z - c.z) > 5) far++;
        if (far / sq.units.length > 0.15 && now - sq.stageT < 18) {
          for (const u of sq.units) if (Math.hypot(u.x - c.x, u.z - c.z) > 3) this.orderMove(u, c.x, c.z, true, 3);
          return;
        }
        sq.staged = true;
      }
    }
    const atEnd = sq.wp >= sq.path.length - 1 && Math.hypot(wp.x - c.x, wp.z - c.z) < 5;
    if (atEnd) {
      if (sq.objective && !sq.objective.dead) {
        for (const u of sq.units) {
          if (u.target && !u.target.dead) continue;
          if (u.weapons.some((w) => (sq.objective!.isAir ? w.def.targetsAir : w.def.targetsGround))) this.orderAttack(u, sq.objective, 2);
        }
      } else {
        this.retarget(sq, c.x, c.z);
      }
      if (sq.kind === 'harass' && !sq.objective) this.retarget(sq, c.x, c.z);
      return;
    }
    // lead units wait for the pack: fast units that get well ahead of the group hold position
    const cwp = Math.hypot(wp.x - c.x, wp.z - c.z);
    for (const u of sq.units) {
      const art = unitInfo(u.def).role === 'artillery';
      if (art) {
        this.orderMove(u, wp.x + back.x * 3, wp.z + back.z * 3, true, 3);
        continue;
      }
      const ahead = cwp - Math.hypot(wp.x - u.x, wp.z - u.z);
      if (ahead > 5 && sq.kind === 'attack' && this.difficulty !== 'easy') {
        if (u.order.type === 'move' && !u.target) {
          const st = this.st(u);
          if (this.now - st.lastOrder > 1) {
            st.lastOrder = this.now;
            u.issue({ type: 'idle' }, this.world);
          }
        }
        continue;
      }
      this.orderMove(u, wp.x, wp.z, true, 2.5);
    }
  }

  /** Closest armed enemy (unit or defence) within this unit's reach. */
  private nearestThreat(u: Unit): Entity | null {
    const r = Math.max(...u.weapons.map((w) => w.def.range)) + 2.5;
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.visibleEnemies) {
      if (!e.weapons.length) continue;
      if (!u.weapons.some((w) => (e.isAir ? w.def.targetsAir : w.def.targetsGround && w.def.vs[e.armor] > 0.2))) continue;
      const d = e.distTo(u.x, u.z);
      if (d < r && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private pickFocus(cx: number, cz: number, units: Unit[]): Entity | null {
    let best: Entity | null = null;
    let bs = -Infinity;
    const consider = (e: Entity, dps: number) => {
      if (e.dead) return;
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d > 10) return;
      // prefer targets we can kill fast that hurt us
      const s = (dps + 5) / Math.max(40, e.hp) - d * 0.002;
      if (s > bs) {
        bs = s;
        best = e;
      }
    };
    const antiAir = units.some((u) => u.weapons.some((w) => w.def.targetsAir));
    for (const e of this.visibleEnemies) {
      if (e.isAir && !antiAir) continue;
      if (e.weapons.length === 0 && !e.def.engineer) continue;
      let dps = 0;
      for (const w of e.weapons) dps += (w.def.damage * (w.def.burst ?? 1)) / w.def.cooldown;
      consider(e, dps);
    }
    for (const b of this.knownBuildings) {
      if (!b.weapons.length || b.owner.isNeutral) continue;
      if (b.def.needsPower && b.owner.lowPower) continue;
      let dps = 0;
      for (const w of b.weapons) dps += (w.def.damage * (w.def.burst ?? 1)) / w.def.cooldown;
      consider(b, dps * 0.8);
    }
    return best;
  }

  // ---------------------------------------------------------------- scouting
  private lastScoutT = -999;
  private scouting() {
    // look at the enemy army shortly before an attack when our information is stale (normal+)
    if (!this.opts.passive && this.difficulty !== 'easy' && this.now - this.lastScoutT > 90) {
      const soon = this.firstAttackTime() - this.now < 45 || (this.waves > 0 && this.now - this.lastAttackT > this.P.minAttackGap * 0.6);
      let fresh = false;
      for (const sv of this.seen.values()) if (!sv.unit.dead && sv.def.weapons.length && this.now - sv.t < 60) fresh = true;
      const eb = this.enemyBasePos(this.cx, this.cz);
      if (soon && !fresh && eb && !this.my.some((u) => this.st(u).job === 'scout')) {
        const cand = this.my
          .filter((u) => this.st(u).job === 'pool' && this.isCombat(u) && u.hp > u.maxHp * 0.7)
          .sort((a, b) => b.def.speed - a.def.speed)[0];
        if (cand) {
          this.setJob(cand, 'scout');
          this.st(cand).spot = { x: eb.x, z: eb.z };
          this.lastScoutT = this.now;
          this.say(`sends a ${cand.def.name} to scout the enemy`);
        }
      }
    }
    for (const u of this.my) {
      const s = this.st(u);
      if (s.job !== 'scout') continue;
      if (u.hp < u.maxHp * 0.5 || this.now - s.since > 240) {
        s.spot = null;
        this.setJob(u, 'pool');
        continue;
      }
      if (s.spot) {
        // pre-attack look: done once it sees enemy combat units or reaches the spot
        let sawArmy = false;
        for (const e of this.visibleEnemies) if (e.weapons.length && Math.hypot(e.x - u.x, e.z - u.z) < u.def.sight + 1) sawArmy = true;
        if (sawArmy || Math.hypot(u.x - s.spot.x, u.z - s.spot.z) < 6) {
          s.spot = null;
          this.setJob(u, 'pool');
          continue;
        }
        this.orderMove(u, s.spot.x, s.spot.z, false, 3);
        continue;
      }
      const target = this.candidates[0];
      if (!target) {
        this.setJob(u, 'pool');
        continue;
      }
      // don't run into known defences
      if (this.dangerAt(u.x, u.z, 7) > 800) {
        this.candidates.shift();
        this.orderMove(u, this.rallyX, this.rallyZ, false, 0);
        continue;
      }
      this.orderMove(u, target.x, target.z, false, 3);
    }
  }

  // ---------------------------------------------------------------- harassment
  private harassObjective(fx: number, fz: number): { entity: Entity | null; x: number; z: number } {
    let best: Unit | null = null;
    let bs = Infinity;
    for (const e of this.visibleEnemies) {
      if (!e.def.harvester) continue;
      const d = Math.hypot(e.x - fx, e.z - fz) + this.dangerAt(e.x, e.z, 8) / 100;
      if (d < bs) {
        bs = d;
        best = e;
      }
    }
    if (best) return { entity: best, x: best.x, z: best.z };
    // enemy ore fields near their refineries
    let bx = -1, bz = -1, bd = Infinity;
    for (const b of this.knownBuildings) {
      if (!b.def.refinery) continue;
      const oc = this.bestOreCell(b.x, b.z);
      const px = oc && Math.hypot(oc.x - b.x, oc.z - b.z) < 16 ? oc.x : b.x;
      const pz = oc && Math.hypot(oc.x - b.x, oc.z - b.z) < 16 ? oc.z : b.z + 4;
      const d = Math.hypot(px - fx, pz - fz) + this.dangerAt(px, pz, 8) / 60;
      if (d < bd) {
        bd = d;
        bx = px;
        bz = pz;
      }
    }
    if (bx >= 0) return { entity: null, x: bx, z: bz };
    return this.chooseObjective(fx, fz);
  }

  private lastHarass = -999;
  private maybeHarass() {
    if (this.opts.passive || !this.P.harass) return;
    // manage existing raids
    for (const sq of this.squads) {
      if (sq.kind !== 'harass') continue;
      const hurt = sq.units.filter((u) => u.hp < u.maxHp * 0.45);
      for (const u of hurt) this.setJob(u, 'pool');
      if (sq.objective === null && this.now - sq.created > 60) {
        const obj = this.harassObjective(sq.objX, sq.objZ);
        if (!obj.entity && this.now - sq.created > 120) for (const u of [...sq.units]) this.setJob(u, 'pool');
      }
    }
    const start = this.P.earlyHarass ? 150 : 300;
    if (this.now < start || this.now - this.lastHarass < 120) return;
    if (this.squads.some((s) => s.kind === 'harass' && s.units.length)) return;
    if (this.now - this.lastThreatT < 15) return;
    const fast = this.my.filter((u) => this.st(u).job === 'pool' && unitInfo(u.def).fast && u.hp > u.maxHp * 0.8);
    if (fast.length < 2) return;
    const raid = fast.slice(0, 4);
    const sq = this.createSquad('harass', raid);
    if (sq) {
      this.lastHarass = this.now;
      this.stats.harassRaids++;
      this.say(`sends ${raid.length} raiders to harass`);
    }
  }

  // ---------------------------------------------------------------- aircraft
  private aircraft() {
    for (const u of this.my) {
      if (!u.def.flying) continue;
      const s = this.st(u);
      s.job = 'air';
      if (u.order.type === 'returnToBase' || u.order.type === 'attack') continue;
      if (u.def.ammo && u.ammo < u.def.ammo) continue;
      if (this.now - s.lastOrder < 3) continue;
      if (this.opts.passive && this.now - this.lastThreatT > 5) continue;
      const t = this.airTarget(u);
      if (t) {
        s.lastOrder = this.now;
        u.issue({ type: 'attack', target: t }, this.world);
      }
    }
  }

  private airTarget(a: Unit): Entity | null {
    const canHit = (e: Entity) => a.weapons.some((w) => (e.isAir ? w.def.targetsAir : w.def.targetsGround && w.def.vs[e.armor] > 0.2));
    const aaNear = (x: number, z: number) => {
      let n = 0;
      for (const b of this.knownBuildings) if (b.weapons.some((w) => w.def.targetsAir) && Math.hypot(b.x - x, b.z - z) < 9) n++;
      for (const e of this.visibleEnemies) if (e.weapons.some((w) => w.def.targetsAir) && Math.hypot(e.x - x, e.z - z) < 7) n += 0.5;
      return n;
    };
    let best: Entity | null = null;
    let bs = -Infinity;
    // defend base first
    for (const e of this.visibleEnemies) {
      if (!canHit(e)) continue;
      const home = Math.hypot(e.x - this.cx, e.z - this.cz) < this.baseR + 10;
      let s = home ? 10 : 0;
      if (e.def.harvester) s += 6;
      if (unitInfo(e.def).role === 'artillery') s += 4;
      s -= aaNear(e.x, e.z) * (this.P.micro ? 4 : 1.5);
      s -= Math.hypot(e.x - a.x, e.z - a.z) * 0.05;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    for (const b of this.knownBuildings) {
      if (b.owner.isNeutral || b.def.wall || !canHit(b)) continue;
      let s = b.def.power > 0 ? 3 : b.def.refinery ? 2.5 : 1;
      s -= aaNear(b.x, b.z) * (this.P.micro ? 4 : 1.5);
      s -= Math.hypot(b.x - a.x, b.z - a.z) * 0.05;
      if (s > bs) {
        bs = s;
        best = b;
      }
    }
    return bs > -6 ? best : null;
  }

  // ---------------------------------------------------------------- rally pool
  private positionPool() {
    for (const u of this.my) {
      const s = this.st(u);
      if (s.job !== 'pool') continue;
      if (s.slot < 0 || this.slots[s.slot] !== u) {
        let i = this.slots.indexOf(null);
        if (i < 0 || i >= this.slotOffsets.length) {
          i = this.slots.length < this.slotOffsets.length ? this.slots.length : Math.floor(this.rand() * this.slotOffsets.length);
        }
        this.slots[i] = u;
        s.slot = i;
      }
      if (u.target && !u.target.dead) continue;
      const o = this.slotOffsets[s.slot % this.slotOffsets.length];
      let x = this.rallyX + o.x, z = this.rallyZ + o.z;
      const m = this.world.map;
      if (!m.passable(Math.floor(x), Math.floor(z))) {
        const np = m.nearestPassable(x, z, 4);
        if (np) {
          x = np[0] + 0.5;
          z = np[1] + 0.5;
        }
      }
      if (Math.hypot(u.x - x, u.z - z) > 2.5 && (u.order.type === 'idle' || u.order.type === 'attack')) {
        if (u.order.type === 'attack' && !(u.order.target.dead)) continue;
        this.orderMove(u, x, z, false, 4);
      }
    }
  }

  // ================================================================== upkeep
  private upkeep() {
    this.lastUpkeep = this.now;
    const p = this.player;
    // ---- repairs
    let repairing = 0;
    for (const b of this.myBuildings) if (b.repairing) repairing++;
    const sorted = this.myBuildings
      .filter((b) => b.operational && !b.repairing && b.hp < b.maxHp * this.P.repairBelow && !b.def.wall)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    for (const b of sorted) {
      const minCredits = this.difficulty === 'easy' ? 1000 : 150 + repairing * 150;
      if (p.credits < minCredits || repairing >= (this.difficulty === 'easy' ? 1 : 4)) break;
      // power plants / defences first when under attack
      this.world.toggleRepair(b);
      repairing++;
    }
    // ---- sell a dying building (hard+): get money back instead of nothing
    if (this.P.sellDying) {
      for (const b of this.myBuildings) {
        if (!b.operational || b.def.produces === 'yard' || b.def.wall) continue;
        if (b.hp < b.maxHp * 0.12 && this.now - b.lastHitTime < 1.5 && b.def.cost >= 500) {
          this.world.sell(b);
          this.say(`sells dying ${b.def.name}`);
        }
      }
    }
    // ---- power emergency
    if (p.lowPower) {
      if (this.lowPowerSince < 0) this.lowPowerSince = this.now;
      const power = this.kit.byRole.power;
      const building = p.queues.structures.items[0]?.defId === power?.id || p.queues.structures.ready === power?.id;
      if (this.now - this.lowPowerSince > 20 && p.powerRatio < 0.7 && p.credits < 300 && !building) {
        const order: BuildingRole[] = ['superweapon', 'tech', 'airfield', 'radar', 'repair'];
        for (const r of order) {
          const b = this.myBuildings.find((x) => this.buildingRole(x.def) === r && x.operational);
          if (b) {
            this.world.sell(b);
            this.say(`sells ${b.def.name} to restore power`);
            this.lowPowerSince = this.now;
            break;
          }
        }
      }
      // cancel structures that make power worse while broke
      const head = p.queues.structures.items[0];
      if (head && BUILDINGS[head.defId].power < 0 && head.progress === 0 && power && this.canBuild(power.id)) {
        p.dequeue(head.defId, this.world);
      }
    } else this.lowPowerSince = -1;
    // prune old threats
    this.threats = this.threats.filter((t) => this.now - t.t < 90);
  }

  private harvesterCare() {
    this.lastHarvCare = this.now;
    for (const u of this.my) {
      if (!u.def.harvester) continue;
      const s = this.st(u);
      s.job = 'harvester';
      const moved = Math.hypot(u.x - s.lastX, u.z - s.lastZ);
      if (moved < 0.3 && u.harvState !== 'harvesting' && u.harvState !== 'unloading' && u.harvState !== 'waitDock') s.stillT += this.now - (s.since || this.now);
      else s.stillT = 0;
      s.since = this.now;
      s.lastX = u.x;
      s.lastZ = u.z;
      const idle = u.order.type !== 'harvest';
      // under attack: move to a safer field (hard+)
      const hit = this.now - u.lastHitTime < 3 && u.lastAttacker && !u.lastAttacker.dead;
      if (hit && this.P.micro && u.cargo < (u.def.capacity ?? 700) * 0.7) {
        const a = u.lastAttacker!;
        const c = this.bestOreCell(this.cx, this.cz, a.x, a.z);
        if (c && Math.hypot(c.x - a.x, c.z - a.z) > 10) {
          u.issue({ type: 'harvest', x: c.x, z: c.z }, this.world);
          continue;
        }
      }
      if (idle || s.stillT > 20) {
        s.stillT = 0;
        const ref = this.myBuildings.find((b) => b.def.refinery) ?? null;
        const c = this.bestOreCell(ref ? ref.x : this.cx, ref ? ref.z : this.cz);
        if (c) u.issue({ type: 'harvest', x: c.x, z: c.z }, this.world);
        else u.issue({ type: 'harvest' }, this.world);
        continue;
      }
      // long hauls: send harvesters to a rich field close to one of our refineries instead
      if ((u.harvState === 'toOre' || u.harvState === 'seek') && u.harvTile >= 0 && this.difficulty !== 'easy') {
        const m = this.world.map;
        const tx = u.harvTile % m.w, tz = Math.floor(u.harvTile / m.w);
        const cur = this.refineryDist(tx + 0.5, tz + 0.5);
        if (cur > 24) {
          let best: OreCell | null = null;
          let bs = Infinity;
          for (const c of this.oreCells) {
            if (c.ore < 2500) continue;
            const d = this.refineryDist(c.x, c.z);
            if (d < bs && this.dangerAt(c.x, c.z, 9) < 500) {
              bs = d;
              best = c;
            }
          }
          if (best && bs + 8 < cur) {
            u.issue({ type: 'harvest', x: best.x, z: best.z }, this.world);
            continue;
          }
        }
      }
      // keep harvesters away from fields we know are dangerous
      if (u.harvState === 'toOre' && u.harvTile >= 0 && this.P.micro) {
        const m = this.world.map;
        const tx = u.harvTile % m.w, tz = Math.floor(u.harvTile / m.w);
        if (this.dangerAt(tx, tz, 8) > 700) {
          const c = this.bestOreCell(this.cx, this.cz, tx, tz);
          if (c) u.issue({ type: 'harvest', x: c.x, z: c.z }, this.world);
        }
      }
    }
  }

  // ================================================================== superweapons
  private superweapons() {
    this.lastSW = this.now;
    const p = this.player;
    for (const sw of p.superweapons.values()) {
      if (!sw.ready) continue;
      const t = this.bestStrike(SUPERWEAPONS[sw.id]?.radius ?? 4);
      if (!t) continue;
      this.swHold += 2;
      if (t.v >= 2500 || (this.swHold > 60 && t.v > 600)) {
        if (this.world.launchSuperweapon(p, sw.id, t.x, t.z)) {
          this.stats.superweapons++;
          this.swHold = 0;
          this.say(`fires ${sw.id} at (${t.x.toFixed(0)},${t.z.toFixed(0)}) value ${t.v.toFixed(0)}`);
        }
      }
    }
  }

  private bestStrike(radius: number): { x: number; z: number; v: number } | null {
    const pts: Entity[] = [];
    for (const b of this.knownBuildings) if (!b.owner.isNeutral && !b.def.wall) pts.push(b);
    for (const u of this.visibleEnemies) pts.push(u);
    let best: { x: number; z: number; v: number } | null = null;
    for (const c of pts) {
      // try centre on the entity and nudges toward neighbours
      let v = 0, sx = 0, sz = 0, n = 0;
      for (const e of pts) {
        const d = Math.hypot(e.x - c.x, e.z - c.z);
        if (d > radius) continue;
        const f = 1 - (d / radius) * 0.7;
        const w = e.kind === 'building' ? e.cost * 1.1 : e.cost;
        v += w * f;
        sx += e.x;
        sz += e.z;
        n++;
      }
      const x = n > 1 ? (sx / n + c.x) / 2 : c.x, z = n > 1 ? (sz / n + c.z) / 2 : c.z;
      // don't nuke ourselves
      let own = 0;
      for (const u of this.my) if (Math.hypot(u.x - x, u.z - z) < radius + 1) own += u.def.cost;
      for (const b of this.myBuildings) if (Math.hypot(b.x - x, b.z - z) < radius + 1.5) own += b.def.cost;
      v -= own * 1.5;
      if (!best || v > best.v) best = { x, z, v };
    }
    return best;
  }
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
