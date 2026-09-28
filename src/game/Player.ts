import { BUILDINGS, SUPERWEAPONS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { BuildTab, BuildingDef, FactionId, SuperweaponId, UnitDef } from '../data/types';
import type { Building } from './Building';
import type { Unit } from './Unit';
import type { World } from './World';

export interface QueueItem {
  defId: string;
  isBuilding: boolean;
  progress: number; // 0..1
  paid: number;
  onHold: boolean;
}

export class ProductionQueue {
  tab: BuildTab;
  items: QueueItem[] = [];
  /** A completed structure waiting for placement. */
  ready: string | null = null;
  constructor(tab: BuildTab) {
    this.tab = tab;
  }
  count(defId: string) {
    return this.items.filter((i) => i.defId === defId).length;
  }
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsBuilt: number;
  buildingsLost: number;
  buildingsDestroyed: number;
  creditsHarvested: number;
  creditsSpent: number;
}

export interface SuperweaponState {
  id: SuperweaponId;
  charge: number; // seconds charged
  ready: boolean;
  announcedReady: boolean;
}

export class Player {
  readonly index: number;
  name: string;
  faction: FactionId;
  color: number;
  team: number;
  isHuman: boolean;
  isNeutral: boolean;
  credits: number;
  /** storage capacity from refineries/silos; credits above cap still count (simplified) */
  powerProduced = 0;
  powerUsed = 0;
  queues: Record<BuildTab, ProductionQueue>;
  stats: PlayerStats = {
    unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, buildingsBuilt: 0, buildingsLost: 0,
    buildingsDestroyed: 0, creditsHarvested: 0, creditsSpent: 0,
  };
  superweapons = new Map<SuperweaponId, SuperweaponState>();
  defeated = false;
  /** counts of completed buildings by type */
  buildingCounts = new Map<string, number>();
  /** Items restricted by mission (cannot be built). */
  restricted = new Set<string>();
  /** Max tech level allowed (missions). */
  techLimit = 99;
  lastAttackAlert = -999;
  lastHarvAlert = -999;
  lastUnitAlert = -999;
  lastLowPowerAlert = -999;
  lastFundsAlert = -999;
  /** Where attention should jump (space bar) */
  lastAlertPos: { x: number; z: number } | null = null;
  ai: { update(dt: number): void } | null = null;
  radarWasActive = false;
  /** Pending build-placement choice for the human (UI) */

  constructor(index: number, name: string, faction: FactionId, color: number, team: number, isHuman: boolean, credits: number, isNeutral = false) {
    this.index = index;
    this.name = name;
    this.faction = faction;
    this.color = color;
    this.team = team;
    this.isHuman = isHuman;
    this.credits = credits;
    this.isNeutral = isNeutral;
    this.queues = {
      structures: new ProductionQueue('structures'),
      defense: new ProductionQueue('defense'),
      infantry: new ProductionQueue('infantry'),
      vehicles: new ProductionQueue('vehicles'),
      aircraft: new ProductionQueue('aircraft'),
    };
  }

  isEnemyOf(p: Player): boolean {
    if (p === this) return false;
    if (this.isNeutral || p.isNeutral) return false;
    return this.team !== p.team;
  }

  get lowPower(): boolean {
    return this.powerUsed > this.powerProduced;
  }
  get powerRatio(): number {
    if (this.powerUsed <= 0) return 1;
    return Math.min(1, this.powerProduced / this.powerUsed);
  }

  has(buildingId: string): boolean {
    return (this.buildingCounts.get(buildingId) ?? 0) > 0;
  }
  count(buildingId: string): number {
    return this.buildingCounts.get(buildingId) ?? 0;
  }

  hasRadar(): boolean {
    for (const [id, n] of this.buildingCounts) if (n > 0 && BUILDINGS[id]?.radar) return !this.lowPower;
    return false;
  }

  /** Can this player currently build the item (prereqs met, faction). */
  canBuild(defId: string): boolean {
    if (this.restricted.has(defId)) return false;
    const d: UnitDef | BuildingDef | undefined = UNITS[defId] ?? BUILDINGS[defId];
    if (!d) return false;
    if (d.faction !== this.faction) return false;
    if ((d.techLevel ?? 1) > this.techLimit) return false;
    for (const p of d.prereqs) if (!this.has(p)) return false;
    // Unit needs producer
    if (UNITS[defId]) {
      const u = UNITS[defId];
      if (!this.hasProducer(u.producer)) return false;
    }
    return true;
  }

  /** Items visible in the sidebar (faction, not restricted, not neutral). */
  isVisibleItem(defId: string): boolean {
    const d: UnitDef | BuildingDef | undefined = UNITS[defId] ?? BUILDINGS[defId];
    if (!d) return false;
    if (d.faction !== this.faction) return false;
    if (this.restricted.has(defId)) return false;
    if ((d.techLevel ?? 1) > this.techLimit) return false;
    return !d.prereqs.includes('__never');
  }

  hasProducer(kind: string): boolean {
    for (const [id, n] of this.buildingCounts) if (n > 0 && BUILDINGS[id]?.produces === kind) return true;
    return false;
  }

  producerCount(kind: string): number {
    let c = 0;
    for (const [id, n] of this.buildingCounts) if (BUILDINGS[id]?.produces === kind) c += n;
    return c;
  }

  /** Queue an item. Returns false if not allowed. */
  enqueue(defId: string, world: World, count = 1): boolean {
    if (!this.canBuild(defId)) return false;
    const isBuilding = !!BUILDINGS[defId];
    const def = isBuilding ? BUILDINGS[defId] : UNITS[defId];
    const q = this.queues[def.tab];
    if (isBuilding) {
      if (q.ready || q.items.length > 0) {
        // structures build one at a time; clicking again un-holds
        const it = q.items[0];
        if (it && it.defId === defId && it.onHold) {
          it.onHold = false;
          return true;
        }
        return false;
      }
      q.items.push({ defId, isBuilding, progress: 0, paid: 0, onHold: false });
      world.events.emit('announce', { player: this, text: 'Building.', priority: 0 });
      return true;
    }
    let added = 0;
    for (let i = 0; i < count; i++) {
      if (q.items.length >= 12) break;
      // un-hold if the head is on hold for this item
      const head = q.items[0];
      if (head && head.onHold && head.defId === defId && i === 0) {
        head.onHold = false;
        added++;
        continue;
      }
      q.items.push({ defId, isBuilding, progress: 0, paid: 0, onHold: false });
      added++;
    }
    if (added > 0) world.events.emit('announce', { player: this, text: 'Training.', priority: -1 });
    return added > 0;
  }

  /** Right-click on a sidebar item: hold first, then cancel. */
  dequeue(defId: string, world: World): void {
    const isBuilding = !!BUILDINGS[defId];
    const def = isBuilding ? BUILDINGS[defId] : UNITS[defId];
    if (!def) return;
    const q = this.queues[def.tab];
    if (isBuilding && q.ready === defId) {
      q.ready = null;
      this.credits += def.cost;
      this.stats.creditsSpent -= def.cost;
      world.events.emit('announce', { player: this, text: 'Cancelled.', priority: 0 });
      return;
    }
    // find last queued of this type (cancel from the back), but hold head first
    for (let i = q.items.length - 1; i >= 0; i--) {
      const it = q.items[i];
      if (it.defId !== defId) continue;
      if (i === 0 && !it.onHold && it.progress > 0 && q.items.filter((x) => x.defId === defId).length === 1) {
        it.onHold = true;
        world.events.emit('announce', { player: this, text: 'On hold.', priority: 0 });
        return;
      }
      this.credits += it.paid;
      this.stats.creditsSpent -= it.paid;
      q.items.splice(i, 1);
      world.events.emit('announce', { player: this, text: 'Cancelled.', priority: 0 });
      return;
    }
  }

  updateProduction(world: World, dt: number) {
    const lowPowerMult = this.lowPower ? Math.max(0.35, this.powerRatio * 0.75) : 1;
    for (const tab of Object.keys(this.queues) as BuildTab[]) {
      const q = this.queues[tab];
      const it = q.items[0];
      if (!it || it.onHold) continue;
      const def = it.isBuilding ? BUILDINGS[it.defId] : UNITS[it.defId];
      // If prerequisites lost, hold production.
      const producerKind = it.isBuilding ? 'yard' : (def as UnitDef).producer;
      const nProducers = this.producerCount(producerKind);
      if (nProducers === 0) continue;
      const speed = (1 + 0.5 * Math.min(3, nProducers - 1)) * lowPowerMult * world.buildSpeed;
      const dp = (dt * speed) / def.buildTime;
      const want = Math.min(dp, 1 - it.progress);
      const costStep = def.cost * want;
      if (costStep > 0) {
        if (this.credits <= 0) {
          if (this.isHuman && world.time - this.lastFundsAlert > 12) {
            this.lastFundsAlert = world.time;
            world.events.emit('announce', { player: this, text: 'Insufficient funds.', priority: 1 });
          }
          continue;
        }
        const pay = Math.min(costStep, this.credits);
        const frac = pay / costStep;
        this.credits -= pay;
        it.paid += pay;
        this.stats.creditsSpent += pay;
        it.progress += want * frac;
      }
      if (it.progress >= 0.9999) {
        q.items.shift();
        if (it.isBuilding) {
          q.ready = it.defId;
          world.events.emit('constructionReady', { player: this, defId: it.defId });
          world.events.emit('announce', { player: this, text: 'Construction complete.', priority: 1 });
        } else {
          const u = world.spawnFromProducer(this, UNITS[it.defId]);
          if (u) {
            this.stats.unitsBuilt++;
            world.events.emit('unitReady', { player: this, defId: it.defId });
            world.events.emit('announce', { player: this, text: 'Unit ready.', priority: 0 });
          } else {
            // no producer — refund
            this.credits += it.paid;
          }
        }
      }
    }
  }

  recomputeBuildings(buildings: Building[]) {
    this.buildingCounts.clear();
    let prod = 0, used = 0;
    for (const b of buildings) {
      if (b.owner !== this || b.dead) continue;
      if (b.constructing < 1 && b.def.power < 0) {
        used += -b.def.power; // under construction still draws
      }
      if (b.constructing >= 1) this.buildingCounts.set(b.def.id, (this.buildingCounts.get(b.def.id) ?? 0) + 1);
      if (b.def.power > 0 && b.constructing >= 1) prod += b.def.power * (0.5 + 0.5 * (b.hp / b.maxHp));
      else if (b.constructing >= 1) used += -b.def.power;
    }
    this.powerProduced = Math.round(prod);
    this.powerUsed = Math.round(used);
    // superweapons present?
    const present = new Set<SuperweaponId>();
    for (const b of buildings) {
      if (b.owner === this && !b.dead && b.def.superweapon && b.constructing >= 1) present.add(b.def.superweapon);
    }
    for (const id of present) {
      if (!this.superweapons.has(id)) this.superweapons.set(id, { id, charge: 0, ready: false, announcedReady: false });
    }
    for (const id of [...this.superweapons.keys()]) if (!present.has(id)) this.superweapons.delete(id);
  }

  updateSuperweapons(world: World, dt: number) {
    for (const sw of this.superweapons.values()) {
      if (sw.ready) continue;
      if (this.lowPower) continue;
      sw.charge += dt * world.buildSpeed;
      const def = SUPERWEAPONS[sw.id];
      if (sw.charge >= def.chargeTime) {
        sw.ready = true;
        sw.charge = def.chargeTime;
        world.events.emit('superweaponReady', { player: this, id: sw.id });
        world.events.emit('announce', { player: this, text: def.readyLine, priority: 2 });
      }
    }
  }

  units(world: World): Unit[] {
    return world.units.filter((u) => u.owner === this && !u.dead);
  }
  buildings(world: World): Building[] {
    return world.buildings.filter((b) => b.owner === this && !b.dead);
  }
}
