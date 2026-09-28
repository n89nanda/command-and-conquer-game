import type { ArmorType, UnitDef } from '../data/types';
import type { Building } from './Building';
import { acquireTarget, canAnyHit, canWeaponHit, isTargetable, makeWeapons, maxRange, rangeVs, type WeaponState } from './Combat';
import { Entity } from './Entity';
import { ORE_MAX } from './GameMap';
import type { Player } from './Player';
import { angleDiff, dist, rotateTowards } from './util';
import type { World } from './World';

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; z: number; attackMove?: boolean; queue?: { x: number; z: number }[] }
  | { type: 'attack'; target: Entity; force?: boolean }
  | { type: 'attackGround'; x: number; z: number }
  | { type: 'harvest'; x?: number; z?: number }
  | { type: 'enter'; target: Building }
  | { type: 'deploy' }
  | { type: 'guard'; target: Entity }
  | { type: 'returnToBase' };

type HarvState = 'seek' | 'toOre' | 'harvesting' | 'toRefinery' | 'waitDock' | 'docking' | 'unloading';

export const FLY_ALT = 2.6;

export class Unit extends Entity {
  readonly kind = 'unit' as const;
  def: UnitDef;
  heading: number;
  pheading: number;
  turret: number;
  pturret: number;
  weapons: WeaponState[];
  order: Order = { type: 'idle' };
  target: Entity | null = null;
  /** position guarding (for idle units chasing then returning) */
  guardX: number;
  guardZ: number;
  path: { x: number; z: number }[] | null = null;
  pathIdx = 0;
  goalX = 0;
  goalZ = 0;
  needsPath = false;
  pathIgnoreBuilding = 0;
  moving = false;
  speedFactor = 0;
  scanTimer = Math.random() * 0.4;
  repathTimer = 0;
  stuckTimer = 0;
  lastProgressDist = Infinity;
  arriveTolerance = 0.25;
  // aircraft
  alt = 0;
  ammo = 0;
  reloadTimer = 0;
  // harvester
  cargo = 0;
  harvState: HarvState = 'seek';
  harvTile = -1;
  lastOreX = -1;
  lastOreZ = -1;
  harvTimer = 0;
  harvStateTime = 0;
  lastHarvState = '';
  dockRef: Building | null = null;
  // stealth
  revealTimer = 0;
  // misc
  groupId = 0;
  moveVersion = 0;
  idleTime = 0;
  /** mission scripting tag */
  tag = '';
  /** Stance: aggressive units chase, holdPosition don't move to engage */
  holdFire = false;
  /** Hold ground: engage only what is in range, never chase. */
  holdGround = false;
  /** Group move speed cap (slowest unit in a formation). */
  speedCap = Infinity;
  /** aircraft attack-move continuation */
  resumeMove: { x: number; z: number } | null = null;
  /** push accumulation from separation */
  pushX = 0;
  pushZ = 0;

  constructor(owner: Player, def: UnitDef, x: number, z: number, heading = Math.PI / 2) {
    super(owner, x, z, def.hp);
    this.def = def;
    this.heading = this.pheading = heading;
    this.turret = this.pturret = heading;
    this.weapons = makeWeapons(def.weapons);
    this.guardX = x;
    this.guardZ = z;
    this.ammo = def.ammo ?? 0;
    if (def.flying) this.alt = FLY_ALT;
  }

  get armor(): ArmorType {
    return this.def.armor;
  }
  get radius() {
    return this.def.radius;
  }
  get sight() {
    return this.def.sight;
  }
  get name() {
    return this.def.name;
  }
  get typeId() {
    return this.def.id;
  }
  get cost() {
    return this.def.cost;
  }
  override get isAir() {
    return !!this.def.flying && this.alt > 0.5;
  }
  get isInfantry() {
    return this.def.category === 'infantry';
  }

  isCloaked(): boolean {
    return !!this.def.stealth && this.revealTimer <= 0 && this.firing <= 0 && this.hp > this.maxHp * 0.25;
  }

  // ---------------------------------------------------------------- orders
  issue(order: Order, world: World) {
    this.order = order;
    this.target = null;
    this.speedCap = Infinity;
    this.resumeMove = null;
    this.moveVersion++;
    this.idleTime = 0;
    switch (order.type) {
      case 'idle':
        this.stop();
        this.guardX = this.x;
        this.guardZ = this.z;
        break;
      case 'move':
        this.moveTo(order.x, order.z, world);
        break;
      case 'attack':
        this.target = order.target;
        break;
      case 'harvest':
        if (this.def.harvester) {
          this.harvState = 'seek';
          if (order.x !== undefined && order.z !== undefined) {
            this.lastOreX = Math.floor(order.x);
            this.lastOreZ = Math.floor(order.z);
          }
          this.dockRef = null;
        }
        break;
      case 'enter':
        this.moveToBuilding(order.target, world);
        break;
      case 'deploy':
        break;
      case 'guard':
        break;
      case 'returnToBase':
        break;
    }
  }

  stop() {
    this.path = null;
    this.needsPath = false;
    this.moving = false;
    this.speedFactor = 0;
  }

  moveTo(x: number, z: number, world: World, ignoreBuilding = 0) {
    this.goalX = x;
    this.goalZ = z;
    this.pathIgnoreBuilding = ignoreBuilding;
    this.stuckTimer = 0;
    this.lastProgressDist = Infinity;
    if (this.def.flying) {
      this.path = [{ x, z }];
      this.pathIdx = 0;
      this.needsPath = false;
      return;
    }
    this.path = null;
    this.needsPath = true;
    world.requestPath(this);
  }

  moveToBuilding(b: Building, world: World) {
    // path to the tile adjacent to the building, nearest to us
    let best = { x: b.x, z: b.z + b.h / 2 + 0.5 };
    let bd = Infinity;
    for (let z = b.tz - 1; z <= b.tz + b.h; z++)
      for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
        if (b.occupies(x, z)) continue;
        if (!world.map.passable(x, z)) continue;
        const d = (x + 0.5 - this.x) ** 2 + (z + 0.5 - this.z) ** 2;
        if (d < bd) {
          bd = d;
          best = { x: x + 0.5, z: z + 0.5 };
        }
      }
    this.moveTo(best.x, best.z, world);
  }

  // ---------------------------------------------------------------- update
  update(world: World, dt: number) {
    this.px = this.x;
    this.pz = this.z;
    this.pheading = this.heading;
    this.pturret = this.turret;
    this.firing = Math.max(0, this.firing - dt * 2.5);
    if (this.revealTimer > 0) this.revealTimer -= dt;
    for (const w of this.weapons) w.cooldown -= dt;

    // self heal (titan, elite)
    const heal = (this.def.selfHeal ?? 0) + (this.rank >= 2 ? this.maxHp * 0.004 : 0);
    if (heal > 0 && this.hp < this.maxHp && world.time - this.lastHitTime > 3) this.hp = Math.min(this.maxHp, this.hp + heal * dt);

    if (this.def.flying) {
      this.updateAircraft(world, dt);
      return;
    }

    switch (this.order.type) {
      case 'idle':
      case 'guard':
        this.updateIdle(world, dt);
        break;
      case 'move':
        this.updateMove(world, dt);
        break;
      case 'attack':
        this.updateAttack(world, dt, this.order.target, !!this.order.force);
        break;
      case 'attackGround':
        this.updateAttackGround(world, dt);
        break;
      case 'harvest':
        this.updateHarvest(world, dt);
        break;
      case 'enter':
        this.updateEnter(world, dt);
        break;
      case 'deploy':
        this.updateDeploy(world);
        break;
      case 'returnToBase':
        this.updateIdle(world, dt);
        break;
    }
    // turret idles back to hull direction
    if (this.def.hasTurret && !this.target) this.turret = rotateTowards(this.turret, this.heading, (this.def.turretTurnRate ?? 3) * dt * 0.5);
    if (!this.def.hasTurret) this.turret = this.heading;
  }

  // ---------------------------------------------------------------- movement
  /** Follow current path. Returns true when arrived (or no path). */
  followPath(world: World, dt: number, speedMult = 1): boolean {
    if (this.needsPath) {
      // waiting for path; face goal
      this.moving = false;
      return false;
    }
    if (!this.path || this.pathIdx >= this.path.length) {
      this.moving = false;
      this.speedFactor = 0;
      return true;
    }
    const wp = this.path[this.pathIdx];
    const last = this.pathIdx === this.path.length - 1;
    const d = dist(this.x, this.z, wp.x, wp.z);
    const tol = last ? this.arriveTolerance : 0.45;
    if (d < tol) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.moving = false;
        this.speedFactor = 0;
        return true;
      }
      return false;
    }
    const want = Math.atan2(wp.z - this.z, wp.x - this.x);
    const diff = angleDiff(this.heading, want);
    const turn = this.def.turnRate * dt;
    this.heading = rotateTowards(this.heading, want, turn);
    const ad = Math.abs(diff);
    let f: number;
    if (this.isInfantry) f = ad < 1.2 ? 1 : 0.3;
    else f = ad < 0.25 ? 1 : ad < 1.0 ? Math.cos(ad) * 0.8 : 0;
    // accelerate smoothly
    const accel = this.isInfantry ? 8 : 2.5;
    this.speedFactor += (f - this.speedFactor) * Math.min(1, accel * dt);
    let step = Math.min(this.def.speed, this.speedCap) * this.speedFactor * speedMult * dt;
    // slow down on final approach
    if (last && d < 0.6) step = Math.min(step, d);
    if (step > 0.0001) {
      const nx = this.x + Math.cos(this.heading) * step;
      const nz = this.z + Math.sin(this.heading) * step;
      this.tryMove(world, nx, nz);
      this.moving = true;
    } else this.moving = ad > 0.05;

    // stuck detection
    this.stuckTimer += dt;
    const remaining = dist(this.x, this.z, this.goalX, this.goalZ);
    if (remaining < this.lastProgressDist - 0.3) {
      this.lastProgressDist = remaining;
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > 2.5) {
      this.stuckTimer = 0;
      this.lastProgressDist = remaining;
      if (remaining < 1.6) {
        // close enough — give up (crowded destination)
        this.path = null;
        this.moving = false;
        return true;
      }
      this.needsPath = true;
      world.requestPath(this);
    }
    return false;
  }

  /** Move with tile collision (slide along blocked tiles). */
  tryMove(world: World, nx: number, nz: number) {
    const m = world.map;
    const ok = (x: number, z: number) => m.passable(Math.floor(x), Math.floor(z)) || (this.pathIgnoreBuilding && m.building[Math.floor(z) * m.w + Math.floor(x)] === this.pathIgnoreBuilding);
    if (ok(nx, nz)) {
      this.x = nx;
      this.z = nz;
    } else if (ok(nx, this.z)) this.x = nx;
    else if (ok(this.x, nz)) this.z = nz;
    else if (!ok(this.x, this.z)) {
      // we are inside something (building placed on us) — escape
      const np = m.nearestPassable(this.x, this.z, 6);
      if (np) {
        this.x = np[0] + 0.5;
        this.z = np[1] + 0.5;
      }
    }
  }

  private updateMove(world: World, dt: number) {
    const o = this.order as Extract<Order, { type: 'move' }>;
    if (o.attackMove && this.weapons.length) {
      // engage enemies encountered
      if (this.target && (this.target.dead || !isTargetable(world, this, this.target) || this.target.distTo(this.x, this.z) > this.sight + 2)) this.target = null;
      this.scanTimer -= dt;
      if (!this.target && this.scanTimer <= 0) {
        this.scanTimer = 0.4;
        this.target = acquireTarget(world, this, this.weapons, this.x, this.z, Math.max(maxRange(this.weapons) + 1, this.sight * 0.8));
      }
      if (this.target) {
        const done = this.engage(world, dt, this.target, true);
        if (done) {
          this.target = null;
          this.moveTo(o.x, o.z, world);
        }
        return;
      }
      if (!this.path && !this.needsPath) this.moveTo(o.x, o.z, world);
    } else if (this.weapons.length && !this.holdFire) {
      // fire on the move at targets in range (turreted units / infantry at close range)
      this.opportunityFire(world, dt);
    }
    if (this.followPath(world, dt)) {
      if (o.queue && o.queue.length) {
        const n = o.queue.shift()!;
        o.x = n.x;
        o.z = n.z;
        this.moveTo(n.x, n.z, world);
        return;
      }
      if (o.attackMove && this.weapons.length) {
        // sweep the destination area for anything left to destroy (incl. structures)
        const t = acquireTarget(world, this, this.weapons, this.x, this.z, this.sight + 2);
        if (t) {
          this.target = t;
          return;
        }
      }
      this.order = { type: 'idle' };
      this.speedCap = Infinity;
      this.guardX = this.x;
      this.guardZ = this.z;
      this.target = null;
    }
  }

  /** While moving, shoot at enemies in range without stopping (turreted vehicles). */
  private opportunityFire(world: World, dt: number) {
    if (!this.def.hasTurret && !this.isInfantry) return;
    if (this.isInfantry) return; // infantry must stop to shoot
    this.scanTimer -= dt;
    if (this.target && (this.target.dead || this.target.distTo(this.x, this.z) > maxRange(this.weapons) + 0.5)) this.target = null;
    if (!this.target && this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      this.target = acquireTarget(world, this, this.weapons, this.x, this.z, maxRange(this.weapons));
    }
    if (this.target) this.aimAndFire(world, dt, this.target);
  }

  private updateIdle(world: World, dt: number) {
    this.idleTime += dt;
    if (this.def.harvester && this.idleTime > 2 && this.owner.ai === null && !this.owner.isHuman) {
      // neutral harvesters: nothing
    }
    if (this.def.harvester && this.idleTime > 4 && (this.owner.ai || this.owner.isHuman)) {
      // idle harvesters automatically go back to work
      this.issue({ type: 'harvest' }, world);
      return;
    }
    if (this.path || this.needsPath) {
      // returning to guard position
      if (this.followPath(world, dt)) this.path = null;
    }
    if (this.weapons.length === 0 || this.holdFire) return;
    if (this.target && (this.target.dead || !isTargetable(world, this, this.target))) this.target = null;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.45;
      const leash = this.holdGround ? 0 : this.isInfantry ? 4 : 6;
      const r = this.holdGround ? maxRange(this.weapons) : Math.max(maxRange(this.weapons), this.sight * 0.85);
      const t = acquireTarget(world, this, this.weapons, this.x, this.z, r);
      if (t && (!this.target || t !== this.target)) {
        if (!this.target || this.target.kind === 'building' || t.distTo(this.x, this.z) < this.target.distTo(this.x, this.z) - 1) this.target = t;
      }
      // leash: don't chase too far from guard position
      if (this.target && dist(this.x, this.z, this.guardX, this.guardZ) > leash + maxRange(this.weapons)) {
        this.target = null;
        this.moveTo(this.guardX, this.guardZ, world);
      }
    }
    if (this.target) {
      if (this.holdGround) {
        // stand still; shoot only if in range
        if (this.target.distTo(this.x, this.z) <= rangeVs(this.weapons, this.target) + 0.1) this.aimAndFire(world, dt, this.target);
        else this.target = null;
        return;
      }
      const done = this.engage(world, dt, this.target, true);
      if (done) {
        this.target = null;
        if (dist(this.x, this.z, this.guardX, this.guardZ) > 1.5) this.moveTo(this.guardX, this.guardZ, world);
      }
    } else if (!this.holdGround && !this.path && !this.needsPath && this.lastAttacker && !this.lastAttacker.dead && world.time - this.lastHitTime < 2) {
      // retaliate against attackers out of scan range (e.g. artillery) — move toward
      const a = this.lastAttacker;
      if (canAnyHit(this.weapons, a) && a.distTo(this.x, this.z) < 14 && isTargetable(world, this, a)) {
        this.target = a;
        this.guardX = this.x;
        this.guardZ = this.z;
      }
    }
  }

  private updateAttack(world: World, dt: number, target: Entity, _force: boolean) {
    if (target.dead || (target.owner === this.owner && target.kind === 'unit' && !_force)) {
      this.order = { type: 'idle' };
      this.target = null;
      this.guardX = this.x;
      this.guardZ = this.z;
      this.stop();
      return;
    }
    if (!isTargetable(world, this, target)) {
      // lost it (cloaked) — go to its last position
      this.order = { type: 'idle' };
      this.target = null;
      this.stop();
      return;
    }
    this.target = target;
    this.engage(world, dt, target, false);
  }

  /**
   * Approach and attack a target. Returns true if the target is no longer valid.
   */
  engage(world: World, dt: number, target: Entity, _auto: boolean): boolean {
    if (target.dead) return true;
    // close to the range of the SHORTEST weapon that can hit, firing longer-ranged ones on the way in
    let range = Infinity, minR = Infinity;
    for (const w of this.weapons) {
      if (!canWeaponHit(w.def, target)) continue;
      range = Math.min(range, w.def.range);
      minR = Math.min(minR, w.def.minRange ?? 0);
    }
    if (range === Infinity) return true;
    const d = target.distTo(this.x, this.z);
    // crushers drive over nearby enemy infantry
    const crushIt = this.def.crusher && target.kind === 'unit' && (target as Unit).def.crushable && d < 3 && !this.holdGround;
    if (crushIt) {
      this.repathTimer -= dt;
      if ((!this.path && !this.needsPath) || this.repathTimer <= 0) {
        this.repathTimer = 0.5;
        this.moveTo(target.x, target.z, world);
      }
      this.followPath(world, dt);
      this.aimAndFire(world, dt, target, true);
      return false;
    }
    if (d > range - 0.05) {
      if (d <= rangeVs(this.weapons, target) + 0.05 && (this.def.hasTurret || this.def.flying)) this.aimAndFire(world, dt, target, true);
      // move closer
      this.repathTimer -= dt;
      const tgtMoved = dist(this.goalX, this.goalZ, target.x, target.z) > 1.5;
      if ((!this.path && !this.needsPath) || (this.repathTimer <= 0 && tgtMoved)) {
        this.repathTimer = 1;
        if (target.kind === 'building') this.moveToBuilding(target as Building, world);
        else this.moveTo(target.x, target.z, world);
      }
      this.followPath(world, dt);
      if (this.def.hasTurret && !(d <= rangeVs(this.weapons, target) + 0.05)) this.aimTurret(target, dt);
      return false;
    }
    if (d < minR && !this.isInfantry) {
      // too close for artillery: back off
      const ang = Math.atan2(this.z - target.z, this.x - target.x);
      if (!this.path && !this.needsPath) this.moveTo(this.x + Math.cos(ang) * 3, this.z + Math.sin(ang) * 3, world);
      this.followPath(world, dt);
      return false;
    }
    // in range: stop and fire
    if (this.path) this.stop();
    this.aimAndFire(world, dt, target);
    return false;
  }

  private aimTurret(target: Entity, dt: number) {
    const ang = Math.atan2(target.z - this.z, target.x - this.x);
    this.turret = rotateTowards(this.turret, ang, (this.def.turretTurnRate ?? 3) * dt);
    return Math.abs(angleDiff(this.turret, ang)) < 0.1;
  }

  aimAndFire(world: World, dt: number, target: Entity, moving = false) {
    const ang = Math.atan2(target.z - this.z, target.x - this.x);
    let aimed: boolean;
    if (this.def.hasTurret) {
      aimed = this.aimTurret(target, dt);
    } else if (moving) {
      aimed = Math.abs(angleDiff(this.heading, ang)) < 0.3;
    } else if (this.isInfantry) {
      this.heading = rotateTowards(this.heading, ang, this.def.turnRate * dt);
      aimed = Math.abs(angleDiff(this.heading, ang)) < 0.3;
    } else {
      this.heading = rotateTowards(this.heading, ang, this.def.turnRate * dt);
      aimed = Math.abs(angleDiff(this.heading, ang)) < 0.12;
    }
    if (!aimed) return;
    const d = target.distTo(this.x, this.z);
    for (const w of this.weapons) {
      if (!canWeaponHit(w.def, target)) continue;
      if (d > w.def.range + 0.1) continue;
      if (w.def.minRange && d < w.def.minRange) continue;
      world.tickWeapon(this, w, target, dt);
    }
  }

  private updateAttackGround(world: World, dt: number) {
    const o = this.order as Extract<Order, { type: 'attackGround' }>;
    const w = this.weapons.find((w) => w.def.targetsGround);
    if (!w) {
      this.order = { type: 'idle' };
      return;
    }
    const d = dist(this.x, this.z, o.x, o.z);
    if (d > w.def.range) {
      if (!this.path && !this.needsPath) this.moveTo(o.x, o.z, world);
      this.followPath(world, dt);
      return;
    }
    if (this.path) this.stop();
    const ang = Math.atan2(o.z - this.z, o.x - this.x);
    if (this.def.hasTurret) this.turret = rotateTowards(this.turret, ang, (this.def.turretTurnRate ?? 3) * dt);
    else this.heading = rotateTowards(this.heading, ang, this.def.turnRate * dt);
    const cur = this.def.hasTurret ? this.turret : this.heading;
    if (Math.abs(angleDiff(cur, ang)) < 0.12) world.tickWeaponAt(this, w, o.x, o.z, dt);
  }

  // ---------------------------------------------------------------- enter (engineers, harvesters, repair)
  private updateEnter(world: World, dt: number) {
    const o = this.order as Extract<Order, { type: 'enter' }>;
    const b = o.target;
    if (b.dead) {
      this.order = { type: 'idle' };
      this.stop();
      return;
    }
    const d = b.distTo(this.x, this.z);
    if (d < 0.75) {
      this.stop();
      world.unitEnters(this, b);
      return;
    }
    if (!this.path && !this.needsPath) this.moveToBuilding(b, world);
    if (this.followPath(world, dt)) {
      if (b.distTo(this.x, this.z) > 1.2) this.moveToBuilding(b, world);
    }
  }

  private updateDeploy(world: World) {
    if (!this.def.mcv) {
      this.order = { type: 'idle' };
      return;
    }
    const ok = world.deployMcv(this);
    if (!ok) {
      this.order = { type: 'idle' };
      if (this.owner.isHuman) world.events.emit('announce', { player: this.owner, text: 'Cannot deploy here.', priority: 1 });
    }
  }

  // ---------------------------------------------------------------- harvesting
  private updateHarvest(world: World, dt: number) {
    const map = world.map;
    const cap = this.def.capacity ?? 700;
    // watchdog: never let a harvester sit in one state forever
    if (this.harvState !== this.lastHarvState) {
      this.lastHarvState = this.harvState;
      this.harvStateTime = 0;
    }
    this.harvStateTime += dt;
    if ((this.harvState === 'toRefinery' && this.harvStateTime > 45) || (this.harvState === 'toOre' && this.harvStateTime > 45)) {
      this.dockRef = null;
      this.path = null;
      this.harvState = this.harvState === 'toOre' ? 'seek' : 'toRefinery';
      this.lastHarvState = '';
    } else if (this.harvState === 'waitDock' && this.harvStateTime > 20) {
      if (this.dockRef?.docked && this.dockRef.docked !== this) this.dockRef.docked = null;
      this.harvState = 'toRefinery';
    }
    switch (this.harvState) {
      case 'seek': {
        if (this.cargo >= cap) {
          this.harvState = 'toRefinery';
          return;
        }
        const tile = world.findOre(this.lastOreX >= 0 ? this.lastOreX : Math.floor(this.x), this.lastOreX >= 0 ? this.lastOreZ : Math.floor(this.z), this);
        if (tile < 0) {
          if (this.cargo > 0) this.harvState = 'toRefinery';
          else {
            this.order = { type: 'idle' };
            this.idleTime = -10; // don't immediately retry
          }
          return;
        }
        this.harvTile = tile;
        const tx = tile % map.w, tz = Math.floor(tile / map.w);
        this.moveTo(tx + 0.5, tz + 0.5, world);
        this.harvState = 'toOre';
        return;
      }
      case 'toOre': {
        if (this.harvTile < 0 || map.ore[this.harvTile] <= 0) {
          this.harvState = 'seek';
          return;
        }
        const arrived = this.followPath(world, dt);
        const tx = this.harvTile % map.w, tz = Math.floor(this.harvTile / map.w);
        if (arrived || dist(this.x, this.z, tx + 0.5, tz + 0.5) < 0.5) {
          if (dist(this.x, this.z, tx + 0.5, tz + 0.5) < 1.0) {
            this.stop();
            this.harvState = 'harvesting';
            this.harvTimer = 0;
          } else this.harvState = 'seek';
        }
        return;
      }
      case 'harvesting': {
        this.moving = false;
        const i = this.harvTile;
        if (i < 0 || map.ore[i] <= 0) {
          this.harvState = this.cargo >= cap ? 'toRefinery' : 'seek';
          this.lastOreX = i >= 0 ? i % map.w : -1;
          this.lastOreZ = i >= 0 ? Math.floor(i / map.w) : -1;
          return;
        }
        this.harvTimer += dt;
        if (this.harvTimer >= 0.55) {
          this.harvTimer = 0;
          const rich = map.oreType[i] === 2;
          const take = Math.min(map.ore[i], rich ? 50 : 30, cap - this.cargo);
          map.ore[i] -= take;
          this.cargo += take;
          if (map.ore[i] <= 0.5) {
            map.ore[i] = 0;
            map.oreType[i] = 0;
          }
          map.oreVersion++;
          world.events.emit('harvest', { unit: this });
          // face a slight wiggle
          this.heading += (Math.random() - 0.5) * 0.08;
        }
        this.lastOreX = i % map.w;
        this.lastOreZ = Math.floor(i / map.w);
        if (this.cargo >= cap - 0.5) this.harvState = 'toRefinery';
        return;
      }
      case 'toRefinery': {
        const r = this.dockRef && !this.dockRef.dead && this.dockRef.owner === this.owner ? this.dockRef : world.findRefinery(this);
        if (!r) {
          this.order = { type: 'idle' };
          this.idleTime = -10;
          return;
        }
        this.dockRef = r;
        const dp = r.dockPoint();
        if (!this.path && !this.needsPath) this.moveTo(dp.x, dp.z, world);
        const arrived = this.followPath(world, dt);
        const d = dist(this.x, this.z, dp.x, dp.z);
        if (d < 2.2 && r.docked && r.docked !== this && !r.docked.dead) {
          this.stop();
          this.harvState = 'waitDock';
          return;
        }
        if (arrived || d < 0.35) {
          if (d < 1.0) {
            this.harvState = 'docking';
            r.docked = this;
          } else {
            this.path = null;
          }
        }
        return;
      }
      case 'waitDock': {
        const r = this.dockRef;
        if (!r || r.dead) {
          this.harvState = 'toRefinery';
          this.dockRef = null;
          return;
        }
        if (!r.docked || r.docked.dead || r.docked === this || r.docked.order.type !== 'harvest') {
          r.docked = null;
          this.harvState = 'toRefinery';
        }
        return;
      }
      case 'docking': {
        const r = this.dockRef;
        if (!r || r.dead) {
          this.harvState = 'toRefinery';
          this.dockRef = null;
          return;
        }
        const dp = r.dockPoint();
        // slide onto dock and face north (backing into refinery)
        this.x += (dp.x - this.x) * Math.min(1, dt * 4);
        this.z += (dp.z - this.z) * Math.min(1, dt * 4);
        const want = -Math.PI / 2;
        this.heading = rotateTowards(this.heading, want, this.def.turnRate * dt);
        if (Math.abs(angleDiff(this.heading, want)) < 0.05 && dist(this.x, this.z, dp.x, dp.z) < 0.08) {
          this.harvState = 'unloading';
          this.harvTimer = 0;
        }
        return;
      }
      case 'unloading': {
        const r = this.dockRef;
        if (!r || r.dead) {
          this.harvState = 'toRefinery';
          this.dockRef = null;
          return;
        }
        r.docked = this;
        r.producing = 0.5;
        this.harvTimer += dt;
        if (this.harvTimer >= 0.45) {
          this.harvTimer = 0;
          const amt = Math.min(this.cargo, 50);
          this.cargo -= amt;
          this.owner.credits += amt;
          this.owner.stats.creditsHarvested += amt;
          world.events.emit('credits', { player: this.owner, amount: amt, x: r.x, z: r.z });
        }
        if (this.cargo <= 0) {
          this.cargo = 0;
          r.docked = null;
          this.harvState = 'seek';
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- aircraft
  private updateAircraft(world: World, dt: number) {
    // Aircraft: direct flight, hover attack, return to rearm.
    const o = this.order;
    const cruise = () => {
      this.alt += (FLY_ALT - this.alt) * Math.min(1, dt * 2);
    };
    const flyTo = (x: number, z: number, stopDist: number): boolean => {
      const d = dist(this.x, this.z, x, z);
      const want = Math.atan2(z - this.z, x - this.x);
      this.heading = rotateTowards(this.heading, want, this.def.turnRate * dt);
      if (d <= stopDist) {
        this.speedFactor += (0 - this.speedFactor) * Math.min(1, dt * 3);
        this.moving = this.speedFactor > 0.1;
        return true;
      }
      const ad = Math.abs(angleDiff(this.heading, want));
      const f = ad < 0.6 ? 1 : 0.35;
      this.speedFactor += (f - this.speedFactor) * Math.min(1, dt * 2);
      const step = Math.min(d, this.def.speed * this.speedFactor * dt);
      this.x += Math.cos(this.heading) * step;
      this.z += Math.sin(this.heading) * step;
      this.x = Math.max(0.5, Math.min(world.map.w - 0.5, this.x));
      this.z = Math.max(0.5, Math.min(world.map.h - 0.5, this.z));
      this.moving = true;
      return false;
    };

    if (this.ammo <= 0 && this.def.ammo && o.type !== 'returnToBase') {
      this.order = { type: 'returnToBase' };
    }

    switch (o.type) {
      case 'move': {
        cruise();
        if (o.attackMove && (this.ammo > 0 || !this.def.ammo)) {
          this.scanTimer -= dt;
          if (this.scanTimer <= 0) {
            this.scanTimer = 0.4;
            const t = acquireTarget(world, this, this.weapons, this.x, this.z, maxRange(this.weapons) + 2);
            if (t) {
              this.resumeMove = { x: o.x, z: o.z };
              this.order = { type: 'attack', target: t };
              break;
            }
          }
        }
        if (flyTo(o.x, o.z, 0.3)) {
          this.order = { type: 'idle' };
          this.guardX = this.x;
          this.guardZ = this.z;
        }
        break;
      }
      case 'attack': {
        cruise();
        const t = o.target;
        if (t.dead || !isTargetable(world, this, t)) {
          this.order = this.resumeMove ? { type: 'move', x: this.resumeMove.x, z: this.resumeMove.z, attackMove: true } : { type: 'idle' };
          this.resumeMove = null;
          this.target = null;
          break;
        }
        this.target = t;
        const r = rangeVs(this.weapons, t);
        if (r <= 0) {
          this.order = { type: 'idle' };
          break;
        }
        const d = t.distTo(this.x, this.z);
        if (d > r - 0.3) flyTo(t.x, t.z, r - 0.5);
        else {
          this.speedFactor *= 1 - Math.min(1, dt * 3);
          this.moving = false;
          this.aimAndFireAir(world, dt, t);
        }
        break;
      }
      case 'returnToBase': {
        const pad = world.findAirfield(this);
        if (!pad) {
          cruise();
          flyTo(this.guardX, this.guardZ, 0.5);
          if (this.ammo <= 0) this.ammo = this.def.ammo ?? 0; // no pad: slow reload in air
          break;
        }
        const px = pad.x + (this.id % 2 === 0 ? -0.6 : 0.6), pz = pad.z;
        if (flyTo(px, pz, 0.15)) {
          // land
          this.alt += (0.15 - this.alt) * Math.min(1, dt * 2.5);
          if (this.alt < 0.3) {
            this.reloadTimer += dt;
            if (this.reloadTimer > 0.5) {
              this.reloadTimer = 0;
              this.ammo = Math.min(this.def.ammo ?? 0, this.ammo + Math.max(1, Math.ceil((this.def.ammo ?? 1) / 6)));
              if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05);
            }
            if (this.ammo >= (this.def.ammo ?? 0) && this.hp >= this.maxHp * 0.99) {
              this.order = { type: 'idle' };
              this.guardX = this.x;
              this.guardZ = this.z;
            }
          }
        } else cruise();
        break;
      }
      default: {
        // idle: hover, auto-engage nearby targets
        const landed = this.alt < 0.5;
        if (!landed) cruise();
        this.speedFactor *= 1 - Math.min(1, dt * 2);
        this.moving = false;
        if (this.ammo > 0 || !this.def.ammo) {
          this.scanTimer -= dt;
          if (this.scanTimer <= 0) {
            this.scanTimer = 0.5;
            const t = acquireTarget(world, this, this.weapons, this.x, this.z, maxRange(this.weapons) + 1.5);
            if (t) {
              if (landed) this.alt = 0.6;
              this.order = { type: 'attack', target: t };
              this.guardX = this.x;
              this.guardZ = this.z;
            }
          }
        }
        // gentle drift back to guard position
        if (!landed && dist(this.x, this.z, this.guardX, this.guardZ) > 1) flyTo(this.guardX, this.guardZ, 0.8);
      }
    }
  }

  private aimAndFireAir(world: World, dt: number, target: Entity) {
    const ang = Math.atan2(target.z - this.z, target.x - this.x);
    this.heading = rotateTowards(this.heading, ang, this.def.turnRate * dt);
    this.turret = this.heading;
    if (Math.abs(angleDiff(this.heading, ang)) > 0.2) return;
    const d = target.distTo(this.x, this.z);
    for (const w of this.weapons) {
      if (!canWeaponHit(w.def, target)) continue;
      if (d > w.def.range + 0.2) continue;
      if (this.def.ammo && this.ammo <= 0) return;
      const before = w.cooldown;
      const fired = world.tickWeapon(this, w, target, dt);
      if (fired && this.def.ammo) this.ammo--;
      void before;
    }
  }

  // ---------------------------------------------------------------- misc
  /** Gain experience from a kill. */
  addXp(amount: number, world: World) {
    this.xp += amount;
    const need1 = this.def.cost * 2.2, need2 = this.def.cost * 5;
    const newRank = this.xp >= need2 ? 2 : this.xp >= need1 ? 1 : 0;
    if (newRank > this.rank) {
      this.rank = newRank;
      this.maxHp = Math.round(this.def.hp * (1 + this.rank * 0.15));
      this.hp = Math.min(this.maxHp, this.hp + this.def.hp * 0.25);
      world.events.emit('promoted', { unit: this });
    }
  }

  cargoRatio() {
    return this.cargo / (this.def.capacity ?? 700);
  }
}

export { ORE_MAX };
