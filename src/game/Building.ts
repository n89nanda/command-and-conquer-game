import { UNITS } from '../data/units';
import type { ArmorType, BuildingDef } from '../data/types';
import { acquireTarget, canWeaponHit, isTargetable, makeWeapons, maxRange, type WeaponState } from './Combat';
import { Entity } from './Entity';
import type { Player } from './Player';
import type { Unit } from './Unit';
import { rotateTowards, angleDiff } from './util';
import type { World } from './World';

export class Building extends Entity {
  readonly kind = 'building' as const;
  def: BuildingDef;
  tx: number;
  tz: number;
  w: number;
  h: number;
  /** 0..1 build-up animation after placement */
  constructing = 0;
  selling = false;
  sellTimer = 0;
  repairing = false;
  weapons: WeaponState[];
  target: Entity | null = null;
  turret = Math.PI / 2; // facing +Z (south) by default
  scanTimer = 0;
  rallyX: number;
  rallyZ: number;
  docked: Unit | null = null;
  producing = 0; // anim timer
  captureFlash = 0;
  incomeTimer = 0;
  /** engineers repairing etc */
  chargeTimer = 0;
  freeGiven = false;
  /** players who have spotted this structure (stays visible under fog afterwards) */
  seenBy = new Set<Player>();

  constructor(owner: Player, def: BuildingDef, tx: number, tz: number) {
    const [w, h] = def.footprint;
    super(owner, tx + w / 2, tz + h / 2, def.hp);
    this.def = def;
    this.tx = tx;
    this.tz = tz;
    this.w = w;
    this.h = h;
    this.weapons = makeWeapons(def.weapons);
    this.rallyX = this.x;
    this.rallyZ = tz + h + 1.5;
  }

  get armor(): ArmorType {
    return 'building';
  }
  get radius() {
    return Math.min(this.w, this.h) / 2;
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
  get powered(): boolean {
    return !this.owner.lowPower || this.def.power > 0;
  }
  get operational(): boolean {
    return this.constructing >= 1 && !this.selling;
  }

  /** Distance from point to building rectangle. */
  override distTo(x: number, z: number): number {
    const dx = Math.max(this.tx - x, 0, x - (this.tx + this.w));
    const dz = Math.max(this.tz - z, 0, z - (this.tz + this.h));
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Where units spawn / exit. */
  exitPoint(): { x: number; z: number } {
    return { x: this.tx + this.w / 2, z: this.tz + this.h + 0.5 };
  }

  /** Docking point for harvesters (in front of refinery). */
  dockPoint(): { x: number; z: number } {
    return { x: this.tx + this.w / 2, z: this.tz + this.h + 0.55 };
  }

  occupies(x: number, z: number) {
    return x >= this.tx && x < this.tx + this.w && z >= this.tz && z < this.tz + this.h;
  }

  update(world: World, dt: number) {
    this.firing = Math.max(0, this.firing - dt * 3);
    this.captureFlash = Math.max(0, this.captureFlash - dt);
    if (this.producing > 0) this.producing -= dt;
    if (this.constructing < 1) {
      const t = 1.2 + (this.w * this.h) * 0.25;
      this.constructing = Math.min(1, this.constructing + dt / t);
      if (this.constructing >= 1) world.buildingsDirty = true;
      return;
    }
    if (this.selling) {
      this.sellTimer -= dt;
      if (this.sellTimer <= 0) world.finishSell(this);
      return;
    }
    // repair
    if (this.repairing) {
      if (this.hp >= this.maxHp) {
        this.repairing = false;
      } else {
        const heal = this.maxHp * 0.04 * dt;
        const price = (heal / this.maxHp) * this.def.cost * 0.35;
        if (this.owner.credits >= price) {
          this.owner.credits -= price;
          this.hp = Math.min(this.maxHp, this.hp + heal);
        } else this.repairing = false;
      }
    }
    // Neutral oil derricks produce income when owned
    if (this.def.id === 'n_derrick' && !this.owner.isNeutral) {
      this.incomeTimer += dt;
      if (this.incomeTimer >= 3) {
        this.incomeTimer = 0;
        this.owner.credits += 30;
        this.owner.stats.creditsHarvested += 30;
        world.events.emit('credits', { player: this.owner, amount: 30, x: this.x, z: this.z });
      }
    }
    // Repair pad
    if (this.def.repairPad) this.updateRepairPad(world, dt);
    // Defenses
    if (this.weapons.length > 0) this.updateDefense(world, dt);
  }

  private updateRepairPad(world: World, dt: number) {
    for (const u of world.units) {
      if (u.dead || u.owner !== this.owner || u.def.category !== 'vehicle' || u.isAir) continue;
      if (!this.occupies(u.x, u.z)) continue;
      if (u.hp >= u.maxHp || u.moving) continue;
      const heal = u.maxHp * 0.08 * dt;
      const price = (heal / u.maxHp) * u.def.cost * 0.25;
      if (this.owner.credits < price) continue;
      this.owner.credits -= price;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      this.producing = 0.3;
    }
  }

  private updateDefense(world: World, dt: number) {
    for (const w of this.weapons) w.cooldown -= dt;
    const needPower = this.def.needsPower && this.owner.lowPower;
    if (needPower) {
      this.target = null;
      return;
    }
    const range = maxRange(this.weapons);
    if (this.target && (this.target.dead || this.target.distTo(this.x, this.z) > range + 0.5 || !isTargetable(world, this, this.target))) this.target = null;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.35;
      const t = acquireTarget(world, this, this.weapons, this.x, this.z, range);
      if (t && (!this.target || this.target.kind === 'building')) this.target = t;
    }
    if (!this.target) return;
    const t = this.target;
    const ang = Math.atan2(t.z - this.z, t.x - this.x);
    let aimed = true;
    if (this.def.hasTurret) {
      this.turret = rotateTowards(this.turret, ang, (this.def.turretTurnRate ?? 3) * dt);
      aimed = Math.abs(angleDiff(this.turret, ang)) < 0.12;
    } else this.turret = ang;
    if (!aimed) return;
    for (const w of this.weapons) {
      if (!canWeaponHit(w.def, t)) continue;
      if (t.distTo(this.x, this.z) > w.def.range + 0.3) continue;
      world.tickWeapon(this, w, t, dt);
    }
  }
}

export function freeUnitFor(def: BuildingDef) {
  return def.freeUnit ? UNITS[def.freeUnit] : undefined;
}
