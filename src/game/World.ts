import { BUILDINGS, SUPERWEAPONS } from '../data/buildings';
import { FACTIONS } from '../data/factions';
import { UNITS } from '../data/units';
import type { BuildingDef, ProjectileKind, UnitDef, WeaponDef } from '../data/types';
import { Building } from './Building';
import { computeDamage, type WeaponState } from './Combat';
import type { Entity } from './Entity';
import { EventBus } from './Events';
import { Fog } from './Fog';
import { GameMap, ORE_MAX, RICH_MAX } from './GameMap';
import { Pathfinder } from './Pathfinding';
import type { Player } from './Player';
import { SpatialHash } from './Spatial';
import { Unit, FLY_ALT } from './Unit';
import { RNG, dist } from './util';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  weapon: WeaponDef;
  owner: Player;
  shooter: Entity | null;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  target: Entity | null;
  t: number; // 0..1 progress
  duration: number;
  arc: number;
  dead: boolean;
  view: unknown;
}

export interface WorldOptions {
  seed?: number;
  buildSpeed?: number;
}

let projId = 1;

export class World {
  map: GameMap;
  players: Player[];
  units: Unit[] = [];
  buildings: Building[] = [];
  projectiles: Projectile[] = [];
  events = new EventBus();
  spatial: SpatialHash;
  pathfinder: Pathfinder;
  fogs = new Map<Player, Fog>();
  rng: RNG;
  time = 0;
  tickCount = 0;
  buildSpeed = 1;
  buildingsDirty = true;
  private pathQueue: Unit[] = [];
  private oreTimer = 0;
  private fogTimer = 0;
  /** Units that entered buildings / removed silently */
  private removed = new Set<Entity>();
  pendingStrikes: { player: Player; id: string; x: number; z: number; t: number }[] = [];
  /** optional hook for mission scripts */
  onTick: ((dt: number) => void) | null = null;
  /** Called when entity is destroyed (for scripts). */
  gameOver = false;

  constructor(map: GameMap, players: Player[], opts: WorldOptions = {}) {
    this.map = map;
    this.players = players;
    this.rng = new RNG(opts.seed ?? 1);
    this.buildSpeed = opts.buildSpeed ?? 1;
    this.spatial = new SpatialHash(map.w, map.h, 4);
    this.pathfinder = new Pathfinder(map);
    for (const p of players) if (!p.isNeutral) this.fogs.set(p, new Fog(map.w, map.h));
  }

  get human(): Player | undefined {
    return this.players.find((p) => p.isHuman);
  }

  // ------------------------------------------------------------------ entities
  addUnit(owner: Player, defId: string, x: number, z: number, heading = Math.PI / 2): Unit {
    const def = UNITS[defId];
    if (!def) throw new Error('Unknown unit ' + defId);
    const u = new Unit(owner, def, x, z, heading);
    this.units.push(u);
    this.events.emit('unitCreated', { unit: u });
    return u;
  }

  addBuilding(owner: Player, defId: string, tx: number, tz: number, instant = true): Building {
    const def = BUILDINGS[defId];
    if (!def) throw new Error('Unknown building ' + defId);
    const b = new Building(owner, def, tx, tz);
    if (instant) b.constructing = 1;
    this.buildings.push(b);
    this.map.setBuilding(tx, tz, def.footprint[0], def.footprint[1], b.id);
    if (def.repairPad) {
      // pad tiles remain passable
      this.map.setBuilding(tx, tz, def.footprint[0], def.footprint[1], 0);
      this.padBuildings.push(b);
    }
    this.map.clearOre(tx, tz, def.footprint[0], def.footprint[1]);
    this.buildingsDirty = true;
    this.events.emit('buildingPlaced', { building: b });
    return b;
  }
  padBuildings: Building[] = [];

  entityById(id: number): Entity | undefined {
    return this.units.find((u) => u.id === id) ?? this.buildings.find((b) => b.id === id);
  }

  // ------------------------------------------------------------------ pathing
  requestPath(u: Unit) {
    if (!this.pathQueue.includes(u)) this.pathQueue.push(u);
  }

  private processPaths() {
    // time-budgeted so large group orders never cause a frame hitch
    const deadline = performance.now() + 2.5;
    let n = 0;
    while (this.pathQueue.length && (n++ < 2 || performance.now() < deadline)) {
      const u = this.pathQueue.shift()!;
      if (u.dead || !u.needsPath) continue;
      const path = this.pathfinder.find(u.x, u.z, u.goalX, u.goalZ, 9000, u.pathIgnoreBuilding);
      // keep exact goal point when final tile is the goal tile
      if (path.length) {
        const last = path[path.length - 1];
        if (Math.floor(last.x) === Math.floor(u.goalX) && Math.floor(last.z) === Math.floor(u.goalZ)) {
          last.x = u.goalX;
          last.z = u.goalZ;
        }
      }
      u.path = path;
      u.pathIdx = 0;
      u.needsPath = false;
    }
  }

  // ------------------------------------------------------------------ combat
  /** Advance a weapon; fires if ready. Returns true if a shot was fired this tick. */
  tickWeapon(shooter: Entity, w: WeaponState, target: Entity, dt: number): boolean {
    if (w.burstLeft > 0) {
      w.burstTimer -= dt;
      if (w.burstTimer <= 0) {
        w.burstLeft--;
        w.burstTimer = w.def.burstDelay ?? 0.15;
        this.fire(shooter, w, target.x, target.z, target);
        return true;
      }
      return false;
    }
    if (w.cooldown <= 0) {
      w.cooldown = w.def.cooldown * (0.95 + Math.random() * 0.1);
      w.burstLeft = (w.def.burst ?? 1) - 1;
      w.burstTimer = w.def.burstDelay ?? 0.15;
      this.fire(shooter, w, target.x, target.z, target);
      return true;
    }
    return false;
  }

  tickWeaponAt(shooter: Entity, w: WeaponState, x: number, z: number, dt: number) {
    if (w.burstLeft > 0) {
      w.burstTimer -= dt;
      if (w.burstTimer <= 0) {
        w.burstLeft--;
        w.burstTimer = w.def.burstDelay ?? 0.15;
        this.fire(shooter, w, x, z, null);
      }
      return;
    }
    if (w.cooldown <= 0) {
      w.cooldown = w.def.cooldown;
      w.burstLeft = (w.def.burst ?? 1) - 1;
      w.burstTimer = w.def.burstDelay ?? 0.15;
      this.fire(shooter, w, x, z, null);
    }
  }

  entityHeight(e: Entity): number {
    if (e.kind === 'unit') {
      const u = e as Unit;
      return this.map.heightAt(u.x, u.z) + (u.def.flying ? u.alt : u.isInfantry ? 0.3 : 0.4);
    }
    const b = e as Building;
    return this.map.heightAt(b.x, b.z) + (b.def.wall ? 0.4 : b.def.footprint[0] === 1 ? 0.9 : 0.8);
  }

  fire(shooter: Entity, w: WeaponState, tx: number, tz: number, target: Entity | null) {
    const def = w.def;
    shooter.firing = 1;
    if (shooter.kind === 'unit') (shooter as Unit).revealTimer = 2.5;
    const muzzle = w.muzzleIdx++;
    const fy = this.entityHeight(shooter) + 0.15;
    // aim at a random point on buildings
    if (target && target.kind === 'building') {
      const b = target as Building;
      tx = b.tx + b.w * (0.25 + Math.random() * 0.5);
      tz = b.tz + b.h * (0.25 + Math.random() * 0.5);
    }
    let ty = target ? this.entityHeight(target) : this.map.heightAt(tx, tz);
    if (def.inaccuracy) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * def.inaccuracy;
      tx += Math.cos(a) * r;
      tz += Math.sin(a) * r;
      ty = this.map.heightAt(tx, tz);
      target = null;
    }
    this.events.emit('fire', { shooter, weapon: def, fx: shooter.x, fy, fz: shooter.z, tx, ty, tz, muzzle });
    const instant = def.projectile === 'bullet' || def.projectile === 'laser' || def.projectile === 'railgun' || def.projectile === 'flame';
    if (instant) {
      const delay = def.projectile === 'flame' ? 0.12 : 0;
      if (delay > 0) {
        this.projectiles.push(this.makeProjectile(def, shooter, shooter.x, fy, shooter.z, tx, ty, tz, target, delay, 0, true));
      } else this.impact(def, shooter.owner, shooter, tx, ty, tz, target);
      return;
    }
    const d = dist(shooter.x, shooter.z, tx, tz);
    const speed = def.projectileSpeed ?? 15;
    const duration = Math.max(0.08, d / speed);
    const arc = def.projectile === 'artillery' ? Math.max(1.5, d * 0.35) : def.projectile === 'rocket' || def.projectile === 'missile' ? Math.min(1, d * 0.08) : 0;
    this.projectiles.push(this.makeProjectile(def, shooter, shooter.x, fy, shooter.z, tx, ty, tz, target, duration, arc, false));
  }

  private makeProjectile(def: WeaponDef, shooter: Entity, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, target: Entity | null, duration: number, arc: number, hidden: boolean): Projectile {
    return {
      id: projId++, kind: hidden ? 'flame' : def.projectile, weapon: def, owner: shooter.owner, shooter,
      x: sx, y: sy, z: sz, px: sx, py: sy, pz: sz, sx, sy, sz, tx, ty, tz, target, t: 0, duration, arc, dead: false, view: null,
    };
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      // homing for rockets/missiles/shells against units
      if (p.target && !p.target.dead && (p.kind === 'missile' || p.kind === 'rocket' || p.kind === 'shell')) {
        p.tx = p.target.x;
        p.tz = p.target.z;
        p.ty = this.entityHeight(p.target);
      }
      p.t += dt / p.duration;
      const t = Math.min(1, p.t);
      p.x = p.sx + (p.tx - p.sx) * t;
      p.z = p.sz + (p.tz - p.sz) * t;
      p.y = p.sy + (p.ty - p.sy) * t + Math.sin(t * Math.PI) * p.arc;
      if (p.t >= 1) {
        p.dead = true;
        this.impact(p.weapon, p.owner, p.shooter, p.tx, p.ty, p.tz, p.target);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  impact(w: WeaponDef, owner: Player, shooter: Entity | null, x: number, y: number, z: number, target: Entity | null) {
    let hitEntity = false;
    if (target && !target.dead) {
      // direct hit (aircraft can dodge artillery etc — keep simple)
      this.damage(target, computeDamage(w, shooter, target), shooter, w);
      hitEntity = true;
    }
    if (w.splash && w.splash > 0) {
      const r = w.splash;
      const apply = (e: Entity) => {
        if (e === target || e.dead) return;
        if (e.isAir && !w.targetsAir) return;
        const d = e.distTo(x, z);
        if (d > r) return;
        // no friendly fire for small splash; artillery/flame hurts friends a bit
        if (!e.owner.isEnemyOf(owner) && !(w.projectile === 'artillery' && e.owner !== owner)) {
          if (e.owner === owner || w.splash! < 1) return;
        }
        const falloff = 1 - (d / r) * 0.6;
        this.damage(e, computeDamage(w, shooter, e) * falloff * 0.6, shooter, w);
      };
      this.spatial.query(x, z, r + 1, apply);
      for (const b of this.buildings) if (!b.dead && Math.abs(b.x - x) < r + 3 && Math.abs(b.z - z) < r + 3) apply(b);
    }
    this.events.emit('impact', { x, y, z, kind: w.projectile, weapon: w, hitEntity });
  }

  damage(e: Entity, amount: number, attacker: Entity | null, _w?: WeaponDef) {
    if (e.dead || amount <= 0) return;
    if (this.invulnerable.has(e)) return;
    e.hp -= amount;
    e.lastHitTime = this.time;
    if (attacker && attacker.owner !== e.owner) e.lastAttacker = attacker;
    this.events.emit('damaged', { entity: e, attacker: attacker ?? undefined, amount });
    // alerts
    const o = e.owner;
    if (attacker && attacker.owner.isEnemyOf(o)) {
      if (e.kind === 'building' && this.time - o.lastAttackAlert > 25) {
        o.lastAttackAlert = this.time;
        o.lastAlertPos = { x: e.x, z: e.z };
        this.events.emit('announce', { player: o, text: 'Our base is under attack.', priority: 2, x: e.x, z: e.z });
      } else if (e.kind === 'unit' && (e as Unit).def.harvester && this.time - o.lastHarvAlert > 25) {
        o.lastHarvAlert = this.time;
        o.lastAlertPos = { x: e.x, z: e.z };
        this.events.emit('announce', { player: o, text: 'Harvester under attack.', priority: 2, x: e.x, z: e.z });
      }
    }
    if (e.hp <= 0) this.kill(e, attacker);
  }
  invulnerable = new Set<Entity>();

  kill(e: Entity, killer: Entity | null) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    if (killer && killer.kind === 'unit' && killer.owner.isEnemyOf(e.owner)) (killer as Unit).addXp(e.cost, this);
    if (killer && killer.owner.isEnemyOf(e.owner)) {
      if (e.kind === 'unit') killer.owner.stats.unitsKilled++;
      else killer.owner.stats.buildingsDestroyed++;
    }
    if (e.kind === 'unit') {
      const u = e as Unit;
      u.owner.stats.unitsLost++;
      const y = this.entityHeight(u);
      this.events.emit('explosion', { x: u.x, y, z: u.z, size: u.def.deathExplosion ?? 'small' });
      this.events.emit('unitDied', { unit: u, killer: killer ?? undefined });
      if (u.owner.isHuman && !u.isInfantry && u.def.cost >= 500) this.events.emit('announce', { player: u.owner, text: 'Unit lost.', priority: 0 });
      // refinery dock release
      for (const b of this.buildings) if (b.docked === u) b.docked = null;
    } else {
      const b = e as Building;
      b.owner.stats.buildingsLost++;
      this.map.setBuilding(b.tx, b.tz, b.w, b.h, 0);
      const size = b.w * b.h >= 6 ? 'huge' : b.w * b.h >= 4 ? 'large' : 'medium';
      this.events.emit('explosion', { x: b.x, y: this.map.heightAt(b.x, b.z) + 0.5, z: b.z, size, sound: 'buildingCollapse' });
      this.events.emit('buildingDied', { building: b, killer: killer ?? undefined });
      if (b.owner.isHuman && !b.def.wall) this.events.emit('announce', { player: b.owner, text: 'Structure lost.', priority: 1 });
      this.buildingsDirty = true;
      // survivors
      if (!b.def.wall && b.def.cost > 0 && !b.owner.isNeutral) this.spawnSurvivors(b, 1 + Math.floor(Math.random() * 2));
    }
  }

  spawnSurvivors(b: Building, n: number) {
    const inf = b.owner.faction === 'aegis' ? 'rifleman' : 'acolyte';
    for (let i = 0; i < n; i++) {
      const p = this.map.nearestPassable(b.x + (Math.random() - 0.5) * b.w, b.z + (Math.random() - 0.5) * b.h, 4);
      if (!p) continue;
      const u = this.addUnit(b.owner, inf, p[0] + 0.5, p[1] + 0.5);
      u.hp = u.maxHp * 0.5;
    }
  }

  // ------------------------------------------------------------------ production / placement
  spawnFromProducer(p: Player, def: UnitDef): Unit | null {
    // find producer building of right kind, prefer primary (last placed)
    const producers = this.buildings.filter((b) => b.owner === p && !b.dead && b.operational && b.def.produces === def.producer);
    if (producers.length === 0) return null;
    const b = producers.find((x) => x.id === this.primary.get(p.index + ':' + def.producer)) ?? producers[producers.length - 1];
    b.producing = 2.5;
    if (def.flying) {
      const u = this.addUnit(p, def.id, b.x, b.z, Math.PI / 2);
      u.alt = 0.2;
      u.guardX = b.x + 1;
      u.guardZ = b.z + 1;
      u.issue({ type: 'move', x: b.rallyX, z: b.rallyZ }, this);
      return u;
    }
    const ex = b.exitPoint();
    let sx = ex.x, sz = ex.z;
    if (!this.map.passable(Math.floor(sx), Math.floor(sz))) {
      const np = this.map.nearestPassable(sx, sz, 6);
      if (!np) return null;
      sx = np[0] + 0.5;
      sz = np[1] + 0.5;
    }
    // spawn inside the door, drive out
    const u = this.addUnit(p, def.id, sx, def.category === 'infantry' ? sz : b.z + b.h / 2 - 0.3, Math.PI / 2);
    if (def.category !== 'infantry') {
      u.x = sx;
      u.z = b.tz + b.h - 0.6;
      u.px = u.x;
      u.pz = u.z;
      u.pathIgnoreBuilding = b.id;
    }
    if (def.harvester) {
      u.issue({ type: 'harvest' }, this);
    } else {
      const rx = b.rallyX + (Math.random() - 0.5) * 1.2, rz = b.rallyZ + (Math.random() - 0.5) * 1.2;
      u.issue({ type: 'move', x: rx, z: rz }, this);
      u.pathIgnoreBuilding = b.id;
    }
    return u;
  }
  primary = new Map<string, number>();

  /** Validate a building placement for player p. */
  canPlace(p: Player, defId: string, tx: number, tz: number): boolean {
    const def = BUILDINGS[defId];
    if (!def) return false;
    const [w, h] = def.footprint;
    for (let z = tz; z < tz + h; z++)
      for (let x = tx; x < tx + w; x++) {
        if (!this.map.buildable(x, z)) return false;
        if (this.padAt(x, z)) return false;
        if (this.isReserved(x, z)) return false;
      }
    // our own exit / dock tile must be free
    if (def.refinery || def.produces === 'factory' || def.produces === 'barracks') {
      const ex = tx + Math.floor(w / 2), ez = tz + h;
      if (!this.map.passable(ex, ez)) return false;
    }
    // units blocking (enemy units anywhere or own vehicles) — own units get pushed aside
    for (const u of this.units) {
      if (u.dead || u.isAir) continue;
      if (u.x > tx - 0.2 && u.x < tx + w + 0.2 && u.z > tz - 0.2 && u.z < tz + h + 0.2) {
        if (u.owner !== p) return false;
      }
    }
    // must be near own buildings
    return this.nearOwnBase(p, tx, tz, w, h);
  }

  /** Tiles in front of refineries / factories that must stay clear. */
  isReserved(x: number, z: number): boolean {
    for (const b of this.buildings) {
      if (b.dead) continue;
      if (!(b.def.refinery || b.def.produces === 'factory' || b.def.produces === 'barracks')) continue;
      const ex = b.tx + Math.floor(b.w / 2), ez = b.tz + b.h;
      if (Math.abs(x - ex) <= (b.def.refinery ? 1 : 0) && (z === ez || (b.def.refinery && z === ez + 1 && x === ex))) return true;
    }
    return false;
  }

  padAt(x: number, z: number): Building | null {
    for (const b of this.padBuildings) if (!b.dead && b.occupies(x, z)) return b;
    return null;
  }

  nearOwnBase(p: Player, tx: number, tz: number, w: number, h: number): boolean {
    for (const b of this.buildings) {
      if (b.dead || b.owner !== p || b.def.wall) continue;
      const r = b.def.buildRadius ?? 3;
      const gx = Math.max(b.tx - (tx + w), 0, tx - (b.tx + b.w));
      const gz = Math.max(b.tz - (tz + h), 0, tz - (b.tz + b.h));
      if (Math.max(gx, gz) <= Math.min(r, 3)) return true;
    }
    return false;
  }

  placeBuilding(p: Player, defId: string, tx: number, tz: number): Building | null {
    const q = p.queues[BUILDINGS[defId].tab];
    if (q.ready !== defId) return null;
    if (!this.canPlace(p, defId, tx, tz)) return null;
    q.ready = null;
    const b = this.addBuilding(p, defId, tx, tz, false);
    p.stats.buildingsBuilt++;
    // push own units out of footprint
    for (const u of this.units) {
      if (u.dead || u.isAir || u.owner !== p) continue;
      if (b.occupies(Math.floor(u.x), Math.floor(u.z))) {
        const np = this.map.nearestPassable(u.x, u.z, 6);
        if (np) u.issue({ type: 'move', x: np[0] + 0.5, z: np[1] + 0.5 }, this);
      }
    }
    return b;
  }

  onBuildingCompleted(b: Building) {
    // free unit (harvester for refinery)
    if (b.def.freeUnit && !b.freeGiven) {
      b.freeGiven = true;
      const def = UNITS[b.def.freeUnit];
      const dp = b.dockPoint();
      const np = this.map.nearestPassable(dp.x, dp.z, 5);
      if (np && def) {
        const u = this.addUnit(b.owner, def.id, np[0] + 0.5, np[1] + 0.5, Math.PI / 2);
        u.issue({ type: 'harvest' }, this);
      }
    }
  }

  sell(b: Building) {
    if (b.selling || b.dead || b.constructing < 1) return;
    b.selling = true;
    b.sellTimer = 1.2;
    this.events.emit('sold', { building: b });
  }

  finishSell(b: Building) {
    if (b.dead) return;
    const refund = Math.floor(b.def.cost * 0.5 * (b.hp / b.maxHp));
    b.owner.credits += refund;
    b.dead = true;
    this.map.setBuilding(b.tx, b.tz, b.w, b.h, 0);
    this.removed.add(b);
    this.buildingsDirty = true;
    if (!b.def.wall && b.def.cost >= 300) this.spawnSurvivors(b, 1 + (b.def.cost >= 1500 ? 1 : 0));
    this.events.emit('buildingDied', { building: b });
  }

  deployMcv(u: Unit): boolean {
    const p = u.owner;
    const yard = FACTIONS[p.faction].yard;
    const def = BUILDINGS[yard];
    const tx = Math.floor(u.x - def.footprint[0] / 2 + 0.5);
    const tz = Math.floor(u.z - def.footprint[1] / 2 + 0.5);
    for (let z = tz; z < tz + def.footprint[1]; z++)
      for (let x = tx; x < tx + def.footprint[0]; x++) if (!this.map.buildable(x, z)) return false;
    for (const o of this.units) {
      if (o === u || o.dead || o.isAir) continue;
      if (o.x > tx - 0.1 && o.x < tx + 3.1 && o.z > tz - 0.1 && o.z < tz + 3.1) {
        // move own units away, block on enemy
        if (o.owner !== p) return false;
        const np = this.map.nearestPassable(tx - 1, tz + 4, 6);
        if (np) o.issue({ type: 'move', x: np[0] + 0.5, z: np[1] + 0.5 }, this);
      }
    }
    u.dead = true;
    this.removed.add(u);
    const b = this.addBuilding(p, yard, tx, tz, false);
    b.hp = b.maxHp * (u.hp / u.maxHp);
    this.events.emit('deployed', { unit: u, building: b });
    return true;
  }

  toggleRepair(b: Building) {
    if (b.dead || b.hp >= b.maxHp) return;
    b.repairing = !b.repairing;
  }

  /** Engineer / harvester entering a building. */
  unitEnters(u: Unit, b: Building) {
    if (u.def.engineer) {
      if (b.owner === u.owner) {
        b.hp = b.maxHp;
        this.events.emit('announce', { player: u.owner, text: 'Structure repaired.', priority: 0 });
      } else {
        const from = b.owner;
        // Enemy structures must be damaged below 50% to capture, neutrals always.
        if (!from.isNeutral && b.hp > b.maxHp * 0.5 && b.def.id !== 'n_derrick') {
          this.damage(b, b.maxHp * 0.2, u);
          if (!b.dead) this.events.emit('announce', { player: u.owner, text: 'Structure damaged.', priority: 0 });
        } else {
          b.owner = u.owner;
          b.captureFlash = 1;
          b.repairing = false;
          b.target = null;
          b.selling = false;
          if (b.docked) b.docked = null;
          this.buildingsDirty = true;
          if (b.def.id === 'n_derrick') {
            u.owner.credits += 500;
            u.owner.stats.creditsHarvested += 500;
          }
          this.events.emit('captured', { building: b, from, to: u.owner });
          this.events.emit('announce', { player: u.owner, text: 'Building captured.', priority: 1 });
          if (!from.isNeutral) this.events.emit('announce', { player: from, text: 'Building lost.', priority: 1 });
        }
      }
      u.dead = true;
      this.removed.add(u);
      return;
    }
    if (u.def.harvester && b.def.refinery && b.owner === u.owner) {
      u.dockRef = b;
      u.issue({ type: 'harvest' }, this);
      u.harvState = 'toRefinery';
      u.dockRef = b;
      return;
    }
    if (b.def.repairPad && b.owner === u.owner) {
      u.moveTo(b.x, b.z, this);
      u.order = { type: 'move', x: b.x, z: b.z };
      return;
    }
    u.order = { type: 'idle' };
  }

  // ------------------------------------------------------------------ resources
  /** Find the best ore tile near (x,z), preferring tiles no other harvester targets. */
  findOre(x: number, z: number, h: Unit): number {
    const map = this.map;
    const taken = new Set<number>();
    for (const u of this.units) if (u !== h && !u.dead && u.def.harvester && (u.harvState === 'toOre' || u.harvState === 'harvesting')) taken.add(u.harvTile);
    let best = -1;
    let bestScore = Infinity;
    const search = (R: number) => {
      const x0 = Math.max(0, x - R), x1 = Math.min(map.w - 1, x + R);
      const z0 = Math.max(0, z - R), z1 = Math.min(map.h - 1, z + R);
      for (let tz = z0; tz <= z1; tz++)
        for (let tx = x0; tx <= x1; tx++) {
          const i = tz * map.w + tx;
          if (map.ore[i] < 20) continue;
          if (!map.passable(tx, tz)) continue;
          let s = Math.hypot(tx - x, tz - z) + (taken.has(i) ? 6 : 0) - (map.oreType[i] === 2 ? 2 : 0);
          // distance from harvester matters too
          s += Math.hypot(tx + 0.5 - h.x, tz + 0.5 - h.z) * 0.3;
          if (s < bestScore) {
            bestScore = s;
            best = i;
          }
        }
    };
    search(6);
    if (best < 0) search(18);
    if (best < 0) {
      // search around the harvester itself, wide
      x = Math.floor(h.x);
      z = Math.floor(h.z);
      search(40);
    }
    return best;
  }

  findRefinery(h: Unit): Building | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== h.owner || !b.def.refinery || !b.operational) continue;
      let d = dist(h.x, h.z, b.x, b.z);
      if (b.docked && b.docked !== h && !b.docked.dead) d += 8;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  findAirfield(a: Unit): Building | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== a.owner || b.def.produces !== 'airfield' || !b.operational) continue;
      const d = dist(a.x, a.z, b.x, b.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private growOre() {
    const map = this.map;
    const W = map.w, H = map.h;
    let changed = false;
    // Regrow existing crystals and occasionally spread
    for (let i = 0; i < map.ore.length; i++) {
      const t = map.oreType[i];
      if (!t) continue;
      const max = t === 2 ? RICH_MAX : ORE_MAX;
      if (map.ore[i] < max) {
        map.ore[i] = Math.min(max, map.ore[i] + (t === 2 ? 6 : 10));
        changed = true;
      }
      if (map.ore[i] > max * 0.7 && this.rng.chance(0.006)) {
        const x = i % W, z = Math.floor(i / W);
        const nx = x + this.rng.int(-1, 1), nz = z + this.rng.int(-1, 1);
        if (nx >= 0 && nz >= 0 && nx < W && nz < H) {
          const j = nz * W + nx;
          if (!map.oreType[j] && map.buildable(nx, nz) && !this.padAt(nx, nz) && !map.doodadBlock[j] && map.terrain[j] !== 5 && map.terrain[j] !== 6) {
            map.oreType[j] = t;
            map.ore[j] = 40;
            changed = true;
          }
        }
      }
    }
    if (changed) map.oreVersion++;
  }

  // ------------------------------------------------------------------ superweapons
  launchSuperweapon(p: Player, id: string, x: number, z: number): boolean {
    const sw = p.superweapons.get(id as never);
    if (!sw || !sw.ready) return false;
    sw.ready = false;
    sw.charge = 0;
    sw.announcedReady = false;
    const def = SUPERWEAPONS[id as keyof typeof SUPERWEAPONS];
    this.events.emit('superweaponLaunch', { player: p, id, x, z });
    this.events.emit('announce', { player: p, text: def.launchLine, priority: 3 });
    for (const o of this.players) if (o !== p && !o.isNeutral) this.events.emit('announce', { player: o, text: def.detectedLine, priority: 3, x, z });
    this.pendingStrikes.push({ player: p, id, x, z, t: id === 'ionStrike' ? 2.2 : 5.5 });
    return true;
  }

  private updateStrikes(dt: number) {
    for (const s of this.pendingStrikes) {
      s.t -= dt;
      if (s.t <= 0) {
        const def = SUPERWEAPONS[s.id as keyof typeof SUPERWEAPONS];
        this.events.emit('superweaponImpact', { player: s.player, id: s.id, x: s.x, z: s.z });
        const apply = (e: Entity) => {
          if (e.dead) return;
          const d = e.distTo(s.x, s.z);
          if (d > def.radius) return;
          const f = 1 - (d / def.radius) * 0.7;
          const mult = e.kind === 'building' ? 0.9 : 1;
          this.damage(e, def.damage * f * mult, null);
        };
        this.spatial.query(s.x, s.z, def.radius + 1, apply);
        for (const b of [...this.buildings]) apply(b);
        // scorch ore
      }
    }
    this.pendingStrikes = this.pendingStrikes.filter((s) => s.t > 0);
  }

  // ------------------------------------------------------------------ separation
  private separate(dt: number) {
    const push = (a: Unit, b: Unit) => {
      if (a.isAir !== b.isAir) return;
      const dx = b.x - a.x, dz = b.z - a.z;
      const r = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      // crushing
      if (a.def.crusher && b.def.crushable && a.owner.isEnemyOf(b.owner) && a.moving) {
        this.crush(b, a);
        return;
      }
      if (b.def.crusher && a.def.crushable && b.owner.isEnemyOf(a.owner) && b.moving) {
        this.crush(a, b);
        return;
      }
      if (a.isAir) {
        // aircraft spread gently
      }
      const d = Math.sqrt(d2) || 0.01;
      const overlap = (r - d) / d;
      // moving units shove idle ones; heavier units shove lighter
      const am = a.moving ? 0.3 : 1, bm = b.moving ? 0.3 : 1;
      const aw = am * (b.radius / r), bw = bm * (a.radius / r);
      const s = Math.min(1, dt * 8) * 0.5;
      let ox = dx * overlap * s, oz = dz * overlap * s;
      if (d < 0.02) {
        ox = (Math.random() - 0.5) * 0.05;
        oz = (Math.random() - 0.5) * 0.05;
      }
      a.pushX -= ox * aw * 2;
      a.pushZ -= oz * aw * 2;
      b.pushX += ox * bw * 2;
      b.pushZ += oz * bw * 2;
    };
    this.spatial.forEachPairCandidate((list, nbs) => {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.dead) continue;
        for (let j = i + 1; j < list.length; j++) if (!list[j].dead) push(a, list[j]);
        for (const nb of nbs) for (const b of nb) if (!b.dead) push(a, b);
      }
    });
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.pushX !== 0 || u.pushZ !== 0) {
        if (u.harvState === 'docking' || u.harvState === 'unloading') {
          u.pushX = u.pushZ = 0;
          continue;
        }
        const max = 0.08;
        const px = Math.max(-max, Math.min(max, u.pushX)), pz = Math.max(-max, Math.min(max, u.pushZ));
        if (u.def.flying) {
          u.x += px;
          u.z += pz;
        } else u.tryMove(this, u.x + px, u.z + pz);
        u.pushX = u.pushZ = 0;
      }
    }
  }

  private crush(victim: Unit, by: Unit) {
    if (victim.dead) return;
    this.events.emit('crushed', { unit: victim, by });
    this.kill(victim, by);
  }

  // ------------------------------------------------------------------ tick
  tick(dt: number) {
    this.time += dt;
    this.tickCount++;
    this.spatial.rebuild(this.units);
    this.processPaths();
    if (this.buildingsDirty) {
      this.buildingsDirty = false;
      for (const p of this.players) p.recomputeBuildings(this.buildings);
    }
    for (const p of this.players) {
      if (p.isNeutral) continue;
      const wasLow = p.lowPower;
      p.updateProduction(this, dt);
      p.updateSuperweapons(this, dt);
      if (p.ai) p.ai.update(dt);
      if (p.isHuman && wasLow && this.time - p.lastLowPowerAlert > 30) {
        p.lastLowPowerAlert = this.time;
        this.events.emit('announce', { player: p, text: 'Low power.', priority: 1 });
      }
      const radar = p.hasRadar();
      if (p.isHuman && radar !== p.radarWasActive) {
        p.radarWasActive = radar;
        this.events.emit('announce', { player: p, text: radar ? 'Radar online.' : 'Radar offline.', priority: 0 });
      }
    }
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.dead) u.update(this, dt);
    }
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (b.dead) continue;
      const wasConstructing = b.constructing < 1;
      b.update(this, dt);
      if (wasConstructing && b.constructing >= 1) this.onBuildingCompleted(b);
    }
    this.updateProjectiles(dt);
    this.updateStrikes(dt);
    this.separate(dt);

    // cleanup
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.buildings.some((b) => b.dead)) {
      this.buildings = this.buildings.filter((b) => !b.dead);
      this.padBuildings = this.padBuildings.filter((b) => !b.dead);
      this.buildingsDirty = true;
    }
    this.removed.clear();

    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.2;
      this.updateFog();
    }
    this.oreTimer -= dt;
    if (this.oreTimer <= 0) {
      this.oreTimer = 2;
      this.growOre();
    }
    this.onTick?.(dt);
  }

  updateFog() {
    for (const [p, fog] of this.fogs) {
      const list: Entity[] = [];
      for (const u of this.units) if (u.owner === p || (!u.owner.isEnemyOf(p) && !u.owner.isNeutral && u.owner.team === p.team)) list.push(u);
      for (const b of this.buildings) if (b.owner === p || (!b.owner.isNeutral && b.owner.team === p.team)) list.push(b);
      fog.recompute(list);
    }
  }

  /** Is entity visible to player (fog + stealth)? */
  visibleTo(e: Entity, p: Player): boolean {
    if (e.owner === p || (!e.owner.isNeutral && e.owner.team === p.team)) return true;
    const fog = this.fogs.get(p);
    if (!fog) return true;
    if (e.kind === 'building') {
      const b = e as Building;
      if (b.seenBy.has(p)) return true;
      // spotted if any footprint corner/centre is currently visible
      if (fog.isVisible(b.x, b.z) || fog.isVisible(b.tx + 0.5, b.tz + 0.5) || fog.isVisible(b.tx + b.w - 0.5, b.tz + b.h - 0.5) || fog.isVisible(b.tx + 0.5, b.tz + b.h - 0.5) || fog.isVisible(b.tx + b.w - 0.5, b.tz + 0.5)) {
        b.seenBy.add(p);
        return true;
      }
      return false;
    }
    if (!fog.isVisible(e.x, e.z)) return false;
    const u = e as Unit;
    if (u.isCloaked()) {
      // visible only if one of p's units is adjacent
      let seen = false;
      this.spatial.query(u.x, u.z, 2, (o) => {
        if (!seen && o.owner === p && Math.hypot(o.x - u.x, o.z - u.z) < 1.8) seen = true;
      });
      return seen;
    }
    return true;
  }

  /** Aircraft altitude helper for renderer. */
  static readonly FLY_ALT = FLY_ALT;
  static unitDefs = UNITS;
  static buildingDefs: Record<string, BuildingDef> = BUILDINGS;
}
