import { BUILDINGS } from '../../data/buildings';
import { UNITS } from '../../data/units';
import type { FactionId } from '../../data/types';
import type { MusicTrack } from '../../audio/AudioTypes';
import type { Building } from '../Building';
import type { Entity } from '../Entity';
import type { Objective } from '../Game';
import type { Player } from '../Player';
import type { Unit } from '../Unit';
import type { World } from '../World';

/** What a mission script can ask of the game shell (implemented by Game, or a headless stub for tests). */
export interface MissionHost {
  world: World;
  me: Player;
  objectives: Objective[];
  missionTimer: { label: string; seconds: number } | null;
  alwaysRadar: boolean;
  cinematic: boolean;
  /** Show a line in the message log. */
  message(text: string, color?: string): void;
  /** Voice line. speaker: 'announcer' uses the base AI voice; others are radio characters. */
  speak(text: string, speaker: Speaker): void;
  /** Tutorial / context hint box (HTML allowed), null hides. */
  hint(html: string | null): void;
  jumpTo(x: number, z: number): void;
  end(victory: boolean): void;
  playMusic(track: MusicTrack): void;
  /** Objective map markers (drawn in the world and on the radar). */
  beacons?: Beacon[];
}

export interface Beacon {
  id: string;
  /** fixed position, or an entity to follow */
  x: number;
  z: number;
  entity?: Entity;
  label?: string;
  color?: string;
}

export type Speaker = 'announcer' | 'commander' | 'enemy' | 'ally' | 'intel';

export interface MissionDef {
  id: string;
  faction: FactionId;
  index: number; // 1-based order within the campaign
  name: string;
  codename: string;
  location: string;
  /** Multi-paragraph briefing text (typed out on the briefing screen). */
  briefing: string;
  /** Short objective bullet points shown on the briefing screen. */
  objectives: string[];
  music: MusicTrack;
  /** Build the world and return the running script. */
  create(): { world: World; script: (host: MissionHost) => MissionScript };
}

interface Trigger {
  cond: () => boolean;
  fn: () => void;
  once: boolean;
  done: boolean;
}
interface Timer {
  at: number;
  fn: () => void;
  every?: number;
}

const SPEAKER_COLORS: Record<Speaker, string> = {
  announcer: '#9fe8ff',
  commander: '#ffd76a',
  enemy: '#ff7a6a',
  ally: '#9dff9d',
  intel: '#c8b6ff',
};
const SPEAKER_NAMES: Record<Speaker, string> = {
  announcer: '',
  commander: 'COMMAND',
  enemy: 'ENEMY',
  ally: 'ALLY',
  intel: 'INTEL',
};

/**
 * Base class for scripted missions. Subclasses implement start() and use the helpers.
 * All timing is in game seconds (pauses with the game).
 */
export abstract class MissionScript {
  host: MissionHost;
  world: World;
  me: Player;
  t = 0;
  private triggers: Trigger[] = [];
  private timers: Timer[] = [];
  private started = false;
  finished = false;
  /** Names for radio speakers (override per mission) */
  speakerNames: Partial<Record<Speaker, string>> = {};

  constructor(host: MissionHost) {
    this.host = host;
    this.world = host.world;
    this.me = host.me;
  }

  abstract start(): void;

  update(dt: number) {
    if (this.finished) return;
    if (!this.started) {
      this.started = true;
      this.start();
    }
    this.t += dt;
    for (const tm of this.timers) {
      if (tm.at <= this.t) {
        tm.fn();
        if (tm.every) tm.at += tm.every;
        else tm.at = Infinity;
      }
    }
    this.timers = this.timers.filter((tm) => tm.at !== Infinity);
    for (const tr of this.triggers) {
      if (tr.done) continue;
      let ok = false;
      try {
        ok = tr.cond();
      } catch (e) {
        console.error('trigger error', e);
        tr.done = true;
      }
      if (ok) {
        if (tr.once) tr.done = true;
        tr.fn();
      }
    }
    this.triggers = this.triggers.filter((tr) => !tr.done);
  }

  // ------------------------------------------------------------------ timing
  after(sec: number, fn: () => void) {
    this.timers.push({ at: this.t + sec, fn });
  }
  every(sec: number, fn: () => void) {
    this.timers.push({ at: this.t + sec, fn, every: sec });
  }
  when(cond: () => boolean, fn: () => void, once = true) {
    this.triggers.push({ cond, fn, once, done: false });
  }

  // ------------------------------------------------------------------ objectives
  objective(id: string, text: string, optional = false) {
    if (this.host.objectives.some((o) => o.id === id)) return;
    this.host.objectives.push({ id, text, done: false, optional });
    this.host.message((optional ? 'New optional objective: ' : 'New objective: ') + text, '#ffd76a');
  }
  /** Place (or move) a pulsing objective marker. Cleared automatically when the objective with the same id completes/fails. */
  beacon(id: string, at: { x: number; z: number } | Entity, label?: string, color = '#ffd24a') {
    const list = (this.host.beacons ??= []);
    this.clearBeacon(id);
    const ent = (at as Entity).kind ? (at as Entity) : undefined;
    list.push({ id, x: at.x, z: at.z, entity: ent, label, color });
  }
  clearBeacon(id: string) {
    const list = this.host.beacons;
    if (!list) return;
    const i = list.findIndex((b) => b.id === id);
    if (i >= 0) list.splice(i, 1);
  }

  complete(id: string) {
    this.clearBeacon(id);
    const o = this.host.objectives.find((x) => x.id === id);
    if (!o || o.done || o.failed) return;
    o.done = true;
    this.host.objectives = [...this.host.objectives];
    this.host.message('Objective complete: ' + o.text, '#4dff6a');
    this.host.speak('Objective complete.', 'announcer');
  }
  fail(id: string) {
    this.clearBeacon(id);
    const o = this.host.objectives.find((x) => x.id === id);
    if (!o || o.done || o.failed) return;
    o.failed = true;
    this.host.objectives = [...this.host.objectives];
    this.host.message('Objective failed: ' + o.text, '#ff4a3a');
  }
  isComplete(id: string) {
    return !!this.host.objectives.find((x) => x.id === id)?.done;
  }
  /** All non-optional objectives complete → victory */
  allPrimaryDone() {
    return this.host.objectives.filter((o) => !o.optional).every((o) => o.done);
  }
  victory(delay = 2) {
    if (this.finished) return;
    this.finished = true;
    setTimeoutGame(this, delay, () => this.host.end(true));
  }
  defeat(reason?: string, delay = 2) {
    if (this.finished) return;
    this.finished = true;
    if (reason) {
      this.host.message(reason, '#ff4a3a');
      this.world.endReason = reason;
    }
    setTimeoutGame(this, delay, () => this.host.end(false));
  }
  timer(label: string, seconds: number | null) {
    this.host.missionTimer = seconds === null ? null : { label, seconds };
  }

  // ------------------------------------------------------------------ comms
  say(text: string, speaker: Speaker = 'commander') {
    const name = this.speakerNames[speaker] ?? SPEAKER_NAMES[speaker];
    this.host.message(name ? `${name}: ${text}` : text, SPEAKER_COLORS[speaker]);
    this.host.speak(text, speaker);
  }
  /** Sequence of lines with delays between them. */
  dialogue(lines: [Speaker, string, number?][], startDelay = 0) {
    let t = startDelay;
    for (const [sp, text, gap] of lines) {
      this.after(t, () => this.say(text, sp));
      t += gap ?? Math.max(2.5, text.length * 0.065);
    }
    return t;
  }
  hint(html: string | null, seconds?: number) {
    this.host.hint(html);
    if (html && seconds) this.after(seconds, () => this.host.hint(null));
  }

  // ------------------------------------------------------------------ world helpers
  player(index: number): Player {
    return this.world.players[index];
  }
  enemyPlayers(): Player[] {
    return this.world.players.filter((p) => !p.isNeutral && p.isEnemyOf(this.me));
  }
  units(p: Player, filter?: (u: Unit) => boolean): Unit[] {
    return this.world.units.filter((u) => u.owner === p && !u.dead && (!filter || filter(u)));
  }
  buildings(p: Player, filter?: (b: Building) => boolean): Building[] {
    return this.world.buildings.filter((b) => b.owner === p && !b.dead && (!filter || filter(b)));
  }
  /** Player has no buildings (except walls) and no units (except harvesters). */
  eliminated(p: Player): boolean {
    return !this.world.buildings.some((b) => b.owner === p && !b.def.wall) && !this.world.units.some((u) => u.owner === p && !u.def.harvester);
  }
  /** No combat units and no production left. */
  defeatedMilitarily(p: Player): boolean {
    return !this.world.units.some((u) => u.owner === p && u.weapons.length > 0) && !this.world.buildings.some((b) => b.owner === p && (b.def.produces || b.weapons.length > 0));
  }
  unitsInArea(p: Player | null, x: number, z: number, r: number, filter?: (u: Unit) => boolean): Unit[] {
    return this.world.units.filter((u) => !u.dead && (!p || u.owner === p) && Math.hypot(u.x - x, u.z - z) <= r && (!filter || filter(u)));
  }
  dead(e: Entity | null | undefined) {
    return !e || e.dead;
  }

  /** Spawn units near (x,z) on passable tiles. */
  spawn(p: Player, ids: string[], x: number, z: number, heading = Math.PI / 2, spread = 1.2): Unit[] {
    const out: Unit[] = [];
    ids.forEach((id, i) => {
      if (!UNITS[id]) {
        console.warn('spawn: unknown unit id', id);
        return;
      }
      const a = i * 2.39996;
      const r = spread * Math.sqrt(i) * 0.7;
      const np = this.world.map.nearestPassable(x + Math.cos(a) * r, z + Math.sin(a) * r, 8);
      if (!np) return;
      const u = this.world.addUnit(p, id, np[0] + 0.5 + (Math.random() - 0.5) * 0.3, np[1] + 0.5 + (Math.random() - 0.5) * 0.3, heading);
      if (UNITS[id].flying) u.alt = 2.6;
      out.push(u);
    });
    return out;
  }

  /** Place a building near (tx,tz), searching outward for a free spot. Returns null if impossible. */
  place(p: Player, id: string, tx: number, tz: number, instant = true): Building | null {
    const def = BUILDINGS[id];
    if (!def) return null;
    const [w, h] = def.footprint;
    const map = this.world.map;
    const free = (x: number, z: number) => {
      for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) if (!map.buildable(x + dx, z + dz)) return false;
      return true;
    };
    for (let r = 0; r < 10; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = Math.round(tx) + dx, z = Math.round(tz) + dz;
          if (free(x, z)) return this.world.addBuilding(p, id, x, z, instant);
        }
    return null;
  }

  /** Units drive in from (fx,fz) to (tx,tz) — e.g. reinforcements from the map edge. */
  reinforce(p: Player, ids: string[], fx: number, fz: number, tx: number, tz: number, announce = true): Unit[] {
    const heading = Math.atan2(tz - fz, tx - fx);
    const us = this.spawn(p, ids, fx, fz, heading, 1.0);
    us.forEach((u, i) => {
      const a = i * 2.39996, r = 0.9 * Math.sqrt(i);
      u.issue({ type: 'move', x: tx + Math.cos(a) * r, z: tz + Math.sin(a) * r }, this.world);
    });
    if (announce && p === this.me) {
      this.host.message('Reinforcements have arrived.', '#9fe8ff');
      this.host.speak('Reinforcements have arrived.', 'announcer');
    }
    return us;
  }

  /** Order units to attack-move to a point. */
  attackMove(units: Unit[], x: number, z: number) {
    units.forEach((u, i) => {
      const a = i * 2.39996, r = 0.8 * Math.sqrt(i);
      u.issue({ type: 'move', x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, attackMove: true }, this.world);
    });
  }

  reveal(x: number, z: number, r: number) {
    this.world.fogs.get(this.me)?.reveal(x, z, r);
  }

  /** Make entity immune to damage (e.g. story-critical until triggered). */
  setInvulnerable(e: Entity, on: boolean) {
    if (on) this.world.invulnerable.add(e);
    else this.world.invulnerable.delete(e);
  }

  /** Restrict what the human may build (ids) and tech level. */
  restrict(ids: string[], techLimit?: number) {
    for (const id of ids) this.me.restricted.add(id);
    if (techLimit !== undefined) this.me.techLimit = techLimit;
  }
  unrestrict(ids: string[]) {
    for (const id of ids) this.me.restricted.delete(id);
  }
}

function setTimeoutGame(s: MissionScript, delay: number, fn: () => void) {
  // run after `delay` game-seconds even though the script is finished
  const target = s.t + delay;
  const w = s.world;
  const prev = w.onTick;
  let t = s.t;
  w.onTick = (dt) => {
    prev?.(dt);
    t += dt;
    if (t >= target) {
      w.onTick = prev;
      fn();
    }
  };
}
