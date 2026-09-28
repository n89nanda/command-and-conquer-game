// Shared helpers for RIFTFALL campaign missions: map editing, world/player creation,
// compact base layouts, and a CampaignScript base class with extra scripting helpers.

import { BUILDINGS } from '../../data/buildings';
import { UNITS } from '../../data/units';
import type { FactionId } from '../../data/types';
import type { Building } from '../Building';
import { resetEntityIds } from '../Entity';
import { GameMap, ORE_MAX, RICH_MAX, Terrain } from '../GameMap';
import { generateMap, type MapSpec } from '../MapGen';
import { Player } from '../Player';
import type { Unit } from '../Unit';
import { World } from '../World';
import { RNG, fbm, valueNoise } from '../util';
import { MissionScript, type MissionHost, type Speaker } from './MissionScript';

// ============================================================================ colours
export const COLOR = {
  aegis: 0x2f7fff,
  covenant: 0xe0282e,
  green: 0x2fd06a,
  gold: 0xf2b01e,
  purple: 0xb04cff,
  cyan: 0x1ed6d6,
  orange: 0xff7a1e,
  white: 0xdddddd,
  neutral: 0xbbbbbb,
};

export interface Pt {
  x: number;
  z: number;
}

// ============================================================================ map editing
/**
 * Stamps story features onto a generated map: clearings for bases, carved roads and
 * passes, ridges, lakes, Riftite fields and doodads. Call finalize() at the end to
 * rebuild the height field and the doodad blocking mask.
 */
export class MapEditor {
  readonly map: GameMap;
  readonly seed: number;
  readonly rng: RNG;
  /** areas flattened for bases */
  flats: { x: number; z: number; r: number }[] = [];
  private ground: Terrain;

  constructor(map: GameMap, seed: number) {
    this.map = map;
    this.seed = seed;
    this.rng = new RNG(seed ^ 0x5eed);
    this.ground = map.theater === 'desert' ? Terrain.Sand : Terrain.Grass;
  }

  private inner(x: number, z: number) {
    return x >= 1 && z >= 1 && x < this.map.w - 1 && z < this.map.h - 1;
  }

  set(x: number, z: number, t: Terrain) {
    x = Math.floor(x);
    z = Math.floor(z);
    if (!this.inner(x, z)) return;
    const i = z * this.map.w + x;
    this.map.terrain[i] = t;
    if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Road || t === Terrain.Concrete) {
      this.map.ore[i] = 0;
      this.map.oreType[i] = 0;
    }
  }

  /** Make an open, buildable, flat disc (bases, landing zones). */
  clear(cx: number, cz: number, r: number, terrain: Terrain = this.ground, flatten = true) {
    for (let z = Math.floor(cz - r - 1); z <= cz + r + 1; z++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (!this.inner(x, z)) continue;
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        const edge = r + (valueNoise(x * 0.35, z * 0.35, this.seed + 9) - 0.5) * 1.6;
        if (d > edge) continue;
        const i = z * this.map.w + x;
        const t = this.map.terrain[i];
        if (t === Terrain.Rock || t === Terrain.Water || d < r - 1.5 || t === Terrain.Sand) this.map.terrain[i] = terrain;
        this.map.ore[i] = 0;
        this.map.oreType[i] = 0;
      }
    this.removeDoodads(cx - r - 1, cz - r - 1, cx + r + 1, cz + r + 1, (d) => Math.hypot(d.x - cx, d.z - cz) <= r + 0.5);
    if (flatten) this.flats.push({ x: cx, z: cz, r });
  }

  /** Axis-aligned rectangle of terrain (inclusive). */
  rect(x0: number, z0: number, x1: number, z1: number, t: Terrain) {
    for (let z = Math.floor(z0); z <= z1; z++) for (let x = Math.floor(x0); x <= x1; x++) this.set(x, z, t);
    if (t !== Terrain.Rock && t !== Terrain.Water) this.removeDoodads(x0, z0, x1 + 1, z1 + 1);
  }

  /** Carve a passable path through the given points (turns rock/water into dirt/sand). */
  path(points: Pt[], width = 3, surface: Terrain | null = null) {
    const hw = width / 2;
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        for (let dz = -Math.ceil(hw); dz <= Math.ceil(hw); dz++)
          for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
            if (Math.hypot(dx, dz) > hw + 0.25) continue;
            const tx = Math.floor(x + dx), tz = Math.floor(z + dz);
            if (!this.inner(tx, tz)) continue;
            const i = tz * this.map.w + tx;
            const tt = this.map.terrain[i];
            if (surface !== null && Math.hypot(dx, dz) <= Math.max(0.8, hw - 1)) this.set(tx, tz, surface);
            else if (tt === Terrain.Rock) this.map.terrain[i] = this.map.theater === 'desert' ? Terrain.Sand : Terrain.Dirt;
            else if (tt === Terrain.Water) this.map.terrain[i] = Terrain.Sand;
          }
        this.removeDoodads(x - hw - 0.5, z - hw - 0.5, x + hw + 0.5, z + hw + 0.5, (d) => d.blocks);
      }
    }
  }

  /** Paved road (also a guaranteed ground route). Crossing water makes a causeway. */
  road(points: Pt[], width = 3) {
    this.path(points, width, Terrain.Road);
  }

  /** Impassable rock ridge along points. */
  ridge(points: Pt[], width = 2) {
    const hw = width / 2;
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const wob = hw + (valueNoise(x * 0.4, z * 0.4, this.seed + 3) - 0.5) * 1.2;
        for (let dz = -Math.ceil(wob); dz <= Math.ceil(wob); dz++)
          for (let dx = -Math.ceil(wob); dx <= Math.ceil(wob); dx++) if (Math.hypot(dx, dz) <= wob) this.set(x + dx, z + dz, Terrain.Rock);
      }
    }
  }

  /** Water course along points with sandy banks. */
  river(points: Pt[], width = 3) {
    const hw = width / 2;
    const touched: [number, number][] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const wob = hw + (valueNoise(x * 0.3, z * 0.3, this.seed + 5) - 0.5) * 1.0;
        const R = Math.ceil(wob + 1.5);
        for (let dz = -R; dz <= R; dz++)
          for (let dx = -R; dx <= R; dx++) {
            const d = Math.hypot(dx, dz);
            const tx = Math.floor(x + dx), tz = Math.floor(z + dz);
            if (d <= wob) this.set(tx, tz, Terrain.Water);
            else if (d <= wob + 1.5) touched.push([tx, tz]);
          }
      }
    }
    for (const [x, z] of touched) {
      const t = this.map.terrainAt(x, z);
      if (t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Road && this.inner(x, z)) {
        this.map.terrain[z * this.map.w + x] = Terrain.Sand;
      }
    }
  }

  /** Blob of terrain (lake / plateau). */
  blob(cx: number, cz: number, r: number, t: Terrain) {
    for (let z = Math.floor(cz - r - 2); z <= cz + r + 2; z++)
      for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) + (valueNoise(x * 0.3, z * 0.3, this.seed + 21) - 0.5) * 2;
        if (d <= r) this.set(x, z, t);
      }
    if (t === Terrain.Rock || t === Terrain.Water) this.removeDoodads(cx - r - 2, cz - r - 2, cx + r + 2, cz + r + 2, (d) => this.map.terrainAt(Math.floor(d.x), Math.floor(d.z)) === Terrain.Water);
  }

  /** Riftite field. */
  ore(cx: number, cz: number, r: number, rich = false) {
    for (let z = Math.floor(cz - r - 1); z <= cz + r + 1; z++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (!this.inner(x, z)) continue;
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / r + (valueNoise(x * 0.5, z * 0.5, this.seed + 77) - 0.5) * 0.6;
        if (d > 1) continue;
        const i = z * this.map.w + x;
        const t = this.map.terrain[i];
        if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Road || t === Terrain.Concrete) continue;
        const richTile = rich && d < 0.6;
        this.map.oreType[i] = richTile ? 2 : 1;
        this.map.ore[i] = (richTile ? RICH_MAX : ORE_MAX) * (1 - d * 0.5) * (0.75 + this.rng.next() * 0.25);
      }
    this.removeDoodads(cx - r - 1, cz - r - 1, cx + r + 1, cz + r + 1, (d) => d.blocks && Math.hypot(d.x - cx, d.z - cz) <= r + 1);
  }

  /** Remove ore in a rectangle. */
  noOre(x0: number, z0: number, x1: number, z1: number) {
    for (let z = Math.floor(z0); z <= z1; z++)
      for (let x = Math.floor(x0); x <= x1; x++) {
        if (!this.map.inBounds(x, z)) continue;
        this.map.ore[z * this.map.w + x] = 0;
        this.map.oreType[z * this.map.w + x] = 0;
      }
  }

  removeDoodads(x0: number, z0: number, x1: number, z1: number, filter?: (d: { x: number; z: number; blocks: boolean; kind: string }) => boolean) {
    this.map.doodads = this.map.doodads.filter((d) => !(d.x >= x0 && d.x <= x1 && d.z >= z0 && d.z <= z1 && (!filter || filter(d))));
  }

  doodad(kind: string, x: number, z: number, blocks = false, scale = 1) {
    if (!this.map.inBounds(Math.floor(x), Math.floor(z))) return;
    this.map.doodads.push({ kind, variant: this.rng.int(0, 3), x, z, rot: this.rng.next() * Math.PI * 2, scale: scale * (0.85 + this.rng.next() * 0.3), blocks });
  }

  /** Scatter doodads in a disc (skips water/rock/road/ore tiles). */
  scatter(kinds: string[], cx: number, cz: number, r: number, n: number, blocks = false) {
    for (let k = 0; k < n; k++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (!this.inner(tx, tz)) continue;
      const i = tz * this.map.w + tx;
      const t = this.map.terrain[i];
      if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Road || t === Terrain.Concrete || this.map.oreType[i]) continue;
      const kind = kinds[this.rng.int(0, kinds.length - 1)];
      this.doodad(kind, x, z, blocks && kind !== 'bush');
    }
  }

  /** Recompute heights and doodad blocking after editing. */
  finalize() {
    const map = this.map;
    const { w, h } = map;
    const seed = this.seed;
    // drop doodads that now sit on water / roads / concrete
    map.doodads = map.doodads.filter((d) => {
      const t = map.terrainAt(Math.floor(d.x), Math.floor(d.z));
      return t !== Terrain.Water && t !== Terrain.Road && t !== Terrain.Concrete;
    });
    map.doodadBlock.fill(0);
    for (const d of map.doodads) if (d.blocks) {
      const tx = Math.floor(d.x), tz = Math.floor(d.z);
      if (map.inBounds(tx, tz)) map.doodadBlock[tz * w + tx] = 1;
    }
    const target = new Float32Array(w * h);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        const t = map.terrain[i];
        let y = (fbm(x * 0.045, z * 0.045, 4, seed + 101) - 0.5) * 1.6;
        for (const f of this.flats) {
          const d = Math.hypot(x + 0.5 - f.x, z + 0.5 - f.z);
          if (d < f.r + 5) y *= Math.max(0, (d - f.r) / 5);
        }
        if (t === Terrain.Rock) y = 1.4 + fbm(x * 0.3, z * 0.3, 3, seed + 7) * 1.6;
        if (t === Terrain.Water) y = -0.9;
        if (t === Terrain.Sand) y = Math.min(y, 0) - 0.12;
        if (t === Terrain.Road) y *= 0.8;
        if (t === Terrain.Concrete) y *= 0.3;
        target[i] = y;
      }
    for (let z = 0; z <= h; z++)
      for (let x = 0; x <= w; x++) {
        let sum = 0, n = 0, rockN = 0, rockSum = 0, waterN = 0;
        for (let dz = -1; dz <= 0; dz++)
          for (let dx = -1; dx <= 0; dx++) {
            const tx = x + dx, tz = z + dz;
            if (tx < 0 || tz < 0 || tx >= w || tz >= h) continue;
            const i = tz * w + tx;
            sum += target[i];
            n++;
            if (map.terrain[i] === Terrain.Rock) {
              rockN++;
              rockSum += target[i];
            }
            if (map.terrain[i] === Terrain.Water) waterN++;
          }
        let y = n ? sum / n : 0;
        if (rockN === n && n > 0) y = rockSum / rockN;
        else if (rockN > 0) y = y * 0.6 + (rockSum / rockN) * 0.15;
        if (waterN > 0 && waterN < n) y = Math.min(y, -0.25);
        map.heights[z * (w + 1) + x] = y;
      }
    map.passVersion++;
    map.oreVersion++;
  }
}

/** Generate a map from a spec and let `edit` stamp the mission layout on it. */
export function buildMap(spec: MapSpec, edit: (e: MapEditor) => void): GameMap {
  const gen = generateMap({ ...spec, derricks: 0, civilians: 0 });
  const e = new MapEditor(gen.map, spec.seed);
  edit(e);
  e.finalize();
  return gen.map;
}

// ============================================================================ world / players
export interface SideSetup {
  name: string;
  faction: FactionId;
  color: number;
  team: number;
  human?: boolean;
  credits?: number;
  techLimit?: number;
}

/** Create a world with a neutral player at index 0 followed by the given sides (index 1..n). */
export function makeWorld(map: GameMap, sides: SideSetup[], seed: number): { world: World; players: Player[] } {
  resetEntityIds();
  const players: Player[] = [new Player(0, 'Civilians', 'aegis', COLOR.neutral, -1, false, 0, true)];
  sides.forEach((s, i) => {
    const p = new Player(i + 1, s.name, s.faction, s.color, s.team, !!s.human, s.credits ?? 0);
    if (s.techLimit !== undefined) p.techLimit = s.techLimit;
    players.push(p);
  });
  const world = new World(map, players, { seed, buildSpeed: 1 });
  return { world, players };
}

function footprintFree(world: World, id: string, x: number, z: number) {
  const [w, h] = BUILDINGS[id].footprint;
  for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) if (!world.map.buildable(x + dx, z + dz) || world.isReserved(x + dx, z + dz)) return false;
  return true;
}

/** Place a finished building at (tx,tz) or the nearest free spot. Throws if impossible (caught by the test harness). */
export function put(world: World, owner: Player, id: string, tx: number, tz: number, search = 4): Building {
  if (!BUILDINGS[id]) throw new Error('unknown building ' + id);
  for (let r = 0; r <= search; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = Math.round(tx) + dx, z = Math.round(tz) + dz;
        if (footprintFree(world, id, x, z)) return world.addBuilding(owner, id, x, z, true);
      }
  throw new Error(`cannot place ${id} near ${tx},${tz}`);
}

/** Place a base from a compact list of [id, tx, tz] relative to (ox, oz). */
export function layout(world: World, owner: Player, ox: number, oz: number, items: [string, number, number][]): Building[] {
  return items.map(([id, dx, dz]) => put(world, owner, id, ox + dx, oz + dz));
}

/** Line of walls between two tiles (inclusive), skipping blocked tiles. */
export function wallLine(world: World, owner: Player, id: string, x0: number, z0: number, x1: number, z1: number): Building[] {
  const out: Building[] = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / (n || 1)), z = Math.round(z0 + ((z1 - z0) * i) / (n || 1));
    if (footprintFree(world, id, x, z)) out.push(world.addBuilding(owner, id, x, z, true));
  }
  return out;
}

/** Spawn units near a point on passable ground (outside of scripts, e.g. in create()). */
export function troops(world: World, owner: Player, ids: string[], x: number, z: number, heading = Math.PI / 2, spread = 1.1): Unit[] {
  const out: Unit[] = [];
  ids.forEach((id, i) => {
    if (!UNITS[id]) throw new Error('unknown unit ' + id);
    const a = i * 2.39996;
    const r = spread * Math.sqrt(i) * 0.75;
    const np = world.map.nearestPassable(x + Math.cos(a) * r, z + Math.sin(a) * r, 8);
    if (!np) return;
    const u = world.addUnit(owner, id, np[0] + 0.5, np[1] + 0.5, heading);
    out.push(u);
  });
  return out;
}

/** Make a player's buildings sturdier/weaker, e.g. for story targets. */
export function scaleHp(b: Building | Unit, f: number) {
  b.maxHp = Math.round(b.maxHp * f);
  b.hp = b.maxHp;
}

// ============================================================================ campaign script
export const AEGIS_CAST: Partial<Record<Speaker, string>> = {
  commander: 'Gen. Hale',
  intel: 'Dr. Voss',
  ally: 'Capt. Okafor',
  enemy: 'Prophet Azrael',
  announcer: '',
};
export const COVENANT_CAST: Partial<Record<Speaker, string>> = {
  commander: 'Prophet Azrael',
  intel: 'Sister Lysandra',
  ally: 'Brother Kade',
  enemy: 'Gen. Hale',
  announcer: '',
};

/**
 * Campaign mission base: adds countdowns, "hunter" groups that seek out the player,
 * attack waves, event subscriptions and a cheat hook for the headless test harness.
 */
export abstract class CampaignScript extends MissionScript {
  private cd: { label: string; end: number; fn: () => void; fired: boolean } | null = null;
  private hunters: { p: Player; targets: Player[]; timer: number; every: number }[] = [];
  private unsubs: (() => void)[] = [];
  /** test-harness info: ground locations the player must reach (checked for pathing) */
  checkpoints: Pt[] = [];

  constructor(host: MissionHost, cast: Partial<Record<Speaker, string>>) {
    super(host);
    this.speakerNames = { ...cast };
  }

  override update(dt: number) {
    super.update(dt);
    if (this.finished) {
      this.dispose();
      return;
    }
    if (this.cd && !this.cd.fired) {
      const left = Math.max(0, this.cd.end - this.t);
      this.host.missionTimer = { label: this.cd.label, seconds: left };
      if (left <= 0) {
        this.cd.fired = true;
        this.cd.fn();
      }
    }
    for (const h of this.hunters) {
      h.timer -= dt;
      if (h.timer > 0) continue;
      h.timer = h.every;
      this.huntTick(h.p, h.targets);
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Mission countdown shown in the HUD; fn fires when it reaches zero. */
  countdown(label: string, seconds: number, fn: () => void) {
    this.cd = { label, end: this.t + seconds, fn, fired: false };
    this.host.missionTimer = { label, seconds };
  }
  stopCountdown() {
    this.cd = null;
    this.host.missionTimer = null;
  }
  countdownLeft(): number {
    return this.cd && !this.cd.fired ? Math.max(0, this.cd.end - this.t) : 0;
  }
  /** Test hook: shorten the running countdown. */
  skipCountdown(to = 1) {
    if (this.cd && !this.cd.fired) this.cd.end = Math.min(this.cd.end, this.t + to);
  }

  /** Subscribe to a world event for the lifetime of the mission. */
  on<K extends Parameters<World['events']['on']>[0]>(k: K, fn: Parameters<World['events']['on']>[1] & ((e: never) => void)) {
    this.unsubs.push(this.world.events.on(k, fn as never));
  }

  /** Idle units of `p` tagged 'hunter' (wave() does this) seek out `targets` every few seconds. */
  hunt(p: Player, targets: Player[] = [this.me], every = 4) {
    const ex = this.hunters.find((h) => h.p === p);
    if (ex) {
      ex.targets = targets;
      ex.every = every;
      return;
    }
    this.hunters.push({ p, targets, timer: every * 0.5, every });
  }

  stopHunt(p: Player) {
    this.hunters = this.hunters.filter((h) => h.p !== p);
  }

  private huntTick(p: Player, targets: Player[]) {
    const tset = new Set(targets);
    for (const u of this.world.units) {
      if (u.dead || u.owner !== p || u.weapons.length === 0 || u.def.harvester) continue;
      if (u.order.type !== 'idle' || u.target) continue;
      if (u.tag !== 'hunter') continue;
      // nearest target entity (units first, buildings as fallback)
      let best: { x: number; z: number } | null = null;
      let bd = Infinity;
      for (const o of this.world.units) {
        if (o.dead || !tset.has(o.owner) || (o.isAir && !u.weapons.some((w) => w.def.targetsAir))) continue;
        const d = Math.hypot(o.x - u.x, o.z - u.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      for (const b of this.world.buildings) {
        if (b.dead || !tset.has(b.owner) || b.def.wall) continue;
        const d = Math.hypot(b.x - u.x, b.z - u.z) - 4;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) u.issue({ type: 'move', x: best.x + (Math.random() - 0.5) * 2, z: best.z + (Math.random() - 0.5) * 2, attackMove: true }, this.world);
    }
  }

  /** Spawn an attack group at `from` that attack-moves to `to` (then hunts if the owner hunts). */
  wave(p: Player, ids: string[], from: Pt, to: Pt, tag = 'hunter'): Unit[] {
    const us = this.spawn(p, ids, from.x, from.z, Math.atan2(to.z - from.z, to.x - from.x), 1.2);
    for (const u of us) u.tag = tag;
    this.attackMove(us, to.x, to.z);
    return us;
  }

  /** Units walk a loop of waypoints (attack-moving), pausing briefly at each. */
  patrol(units: Unit[], points: Pt[], pause = 4) {
    let i = 0;
    let wait = 0;
    for (const u of units) u.tag = 'patrol';
    this.every(1, () => {
      const alive = units.filter((u) => !u.dead && u.tag === 'patrol');
      if (!alive.length) return;
      if (alive.some((u) => u.target || u.order.type !== 'idle')) return;
      if (wait-- > 0) return;
      wait = pause;
      i = (i + 1) % points.length;
      this.attackMove(alive, points[i].x, points[i].z);
    });
  }

  /** Units standing guard: they engage what comes near but are never sent hunting. */
  guards(p: Player, ids: string[], x: number, z: number): Unit[] {
    const us = this.spawn(p, ids, x, z);
    for (const u of us) u.tag = 'guard';
    return us;
  }

  /** Restrict the human's build options to exactly these ids (plus tech limit). Empty list = no sidebar. */
  allowOnly(ids: string[], techLimit = 99) {
    const allowed = new Set(ids);
    const all = [...Object.values(UNITS), ...Object.values(BUILDINGS)];
    for (const d of all) if (d.faction === this.me.faction && !allowed.has(d.id)) this.me.restricted.add(d.id);
    for (const id of ids) {
      if (!UNITS[id] && !BUILDINGS[id]) throw new Error('allowOnly: unknown id ' + id);
      this.me.restricted.delete(id);
    }
    this.me.techLimit = techLimit;
  }

  /** Kill enemy units (not buildings) within r of a point — cheat helper. */
  cheatClear(x: number, z: number, r: number) {
    for (const p of this.enemyPlayers()) for (const u of this.unitsInArea(p, x, z, r)) this.world.kill(u, null);
  }

  /** Human's combat-capable forces (for defeat checks). */
  myForces(): Unit[] {
    return this.units(this.me, (u) => !u.def.harvester);
  }
  myStructures(): Building[] {
    return this.buildings(this.me, (b) => !b.def.wall && b.def.faction !== 'both');
  }
  /** Standard loss: the player has no units (excluding harvesters) and no structures. */
  loseWhenWiped(reason = 'All forces have been lost.') {
    this.when(
      () => this.myForces().length === 0 && this.myStructures().length === 0,
      () => this.defeat(reason),
    );
  }
  anyNear(p: Player, x: number, z: number, r: number, filter?: (u: Unit) => boolean) {
    return this.unitsInArea(p, x, z, r, filter).length > 0;
  }
  alive(list: (Building | Unit)[]) {
    return list.filter((e) => !e.dead);
  }
  /** Give a building to another player (used by scripted defections and the cheat pass). */
  transfer(b: Building, to: Player) {
    const from = b.owner;
    b.owner = to;
    b.captureFlash = 1;
    b.target = null;
    this.world.buildingsDirty = true;
    this.world.events.emit('captured', { building: b, from, to });
  }
  teleport(units: Unit[], x: number, z: number) {
    units.forEach((u, i) => {
      const a = i * 2.39996, r = 0.8 * Math.sqrt(i);
      const np = this.world.map.nearestPassable(x + Math.cos(a) * r, z + Math.sin(a) * r, 8);
      if (!np) return;
      u.x = u.px = np[0] + 0.5;
      u.z = u.pz = np[1] + 0.5;
      u.issue({ type: 'idle' }, this.world);
    });
  }
  /** Kill every entity of the players (cheat / scripted events). */
  wipe(players: Player[], filter?: (e: Building | Unit) => boolean) {
    const set = new Set(players);
    for (const u of [...this.world.units]) if (set.has(u.owner) && (!filter || filter(u))) this.world.kill(u, null);
    for (const b of [...this.world.buildings]) if (set.has(b.owner) && (!filter || filter(b))) this.world.kill(b, null);
  }

  /**
   * Test hook: one step of "playing perfectly" toward the objectives (teleporting,
   * capturing, killing). Called repeatedly by scripts/missiontest.ts.
   */
  cheatStep(): void {
    /* overridden per mission */
  }
}
