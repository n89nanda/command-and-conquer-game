// Headless campaign mission test harness.
//
//   npx tsx scripts/missiontest.ts [missionId|all] [--v] [--idle=MIN] [--cheat=MIN] [--only=idle|cheat]
//
// For every mission:
//   * static checks: MissionDef fields, world/players setup, unit/building ids, human units on
//     passable ground, a ground path from the human start to every script checkpoint
//   * idle pass: the human does nothing for several minutes (no exceptions, events fire,
//     never a victory; reports whether the idle player loses)
//   * cheat pass: the mission's cheatStep() plays "perfectly" (teleports, kills, captures)
//     until the script declares victory

import { BUILDINGS } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import type { Objective } from '../src/game/Game';
import type { World } from '../src/game/World';
import type { Player } from '../src/game/Player';
import { CAMPAIGNS } from '../src/game/mission/campaigns';
import { CampaignScript, type Pt } from '../src/game/mission/common';
import { MissionScript, type MissionDef, type MissionHost, type Speaker } from '../src/game/mission/MissionScript';

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith('--' + n + '='))?.split('=')[1];
const verbose = args.includes('--v');
const only = flag('only');
const idleMin = Number(flag('idle') ?? 20);
const cheatMin = Number(flag('cheat') ?? 45);
const auto = args.includes('--auto');
const autoMin = Number(flag('automin') ?? 30);
const target = args.find((a) => !a.startsWith('--')) ?? 'all';

// ---------------------------------------------------------------- id validation hooks
const badIds: string[] = [];
const proto = MissionScript.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const wrap = (name: string, check: (a: unknown[]) => void) => {
  const orig = proto[name];
  proto[name] = function (this: unknown, ...a: unknown[]) {
    check(a);
    return orig.apply(this, a);
  };
};
const checkUnitList = (ids: unknown) => {
  for (const id of ids as string[]) if (!UNITS[id]) badIds.push('unit:' + id);
};
wrap('spawn', (a) => checkUnitList(a[1]));
wrap('reinforce', (a) => checkUnitList(a[1]));
wrap('place', (a) => {
  if (!BUILDINGS[a[1] as string]) badIds.push('building:' + a[1]);
});
wrap('restrict', (a) => {
  for (const id of a[0] as string[]) if (!UNITS[id] && !BUILDINGS[id]) badIds.push('restrict:' + id);
});
wrap('unrestrict', (a) => {
  for (const id of a[0] as string[]) if (!UNITS[id] && !BUILDINGS[id]) badIds.push('unrestrict:' + id);
});

// ---------------------------------------------------------------- stub host
class StubHost implements MissionHost {
  world: World;
  me: Player;
  objectives: Objective[] = [];
  missionTimer: { label: string; seconds: number } | null = null;
  alwaysRadar = false;
  cinematic = false;
  log: string[] = [];
  ended: boolean | null = null;
  endT = 0;
  hints = 0;
  lines = 0;
  constructor(world: World) {
    this.world = world;
    this.me = world.human!;
  }
  private stamp() {
    const t = this.world.time;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  }
  message(text: string) {
    this.log.push(`[${this.stamp()}] ${text}`);
    if (verbose) console.log(`    [${this.stamp()}] ${text}`);
  }
  speak(_text: string, speaker: Speaker) {
    if (speaker !== 'announcer') this.lines++;
  }
  hint(html: string | null) {
    if (html) {
      this.hints++;
      if (verbose) console.log(`    [${this.stamp()}] HINT: ${html.replace(/<[^>]+>/g, '').slice(0, 100)}`);
    }
  }
  jumpTo() {}
  end(victory: boolean) {
    if (this.ended !== null) return;
    this.ended = victory;
    this.endT = this.world.time;
    if (verbose) console.log(`    [${this.stamp()}] END ${victory ? 'VICTORY' : 'DEFEAT'}`);
  }
  playMusic() {}
}

// ---------------------------------------------------------------- checks
interface Result {
  id: string;
  ok: boolean;
  notes: string[];
}

function floodFrom(world: World, sx: number, sz: number): Uint8Array {
  const m = world.map;
  const seen = new Uint8Array(m.w * m.h);
  const start = m.nearestPassable(sx, sz, 6);
  if (!start) return seen;
  const q: number[] = [start[1] * m.w + start[0]];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % m.w, z = (i / m.w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!m.inBounds(nx, nz)) continue;
      const j = nz * m.w + nx;
      if (seen[j] || !m.passable(nx, nz)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

function reachable(world: World, seen: Uint8Array, p: Pt, r = 3): boolean {
  const m = world.map;
  for (let z = Math.floor(p.z - r); z <= p.z + r; z++)
    for (let x = Math.floor(p.x - r); x <= p.x + r; x++) if (m.inBounds(x, z) && seen[z * m.w + x]) return true;
  return false;
}

function staticChecks(def: MissionDef, notes: string[]): boolean {
  let ok = true;
  const fail = (s: string) => {
    ok = false;
    notes.push('FAIL ' + s);
  };
  if (!def.id || !def.name || !def.codename || !def.location) fail('missing def fields');
  const paras = def.briefing.trim().split(/\n\s*\n/).length;
  if (paras < 3 || paras > 6) fail(`briefing has ${paras} paragraphs`);
  if (def.objectives.length < 2 || def.objectives.length > 4) fail(`${def.objectives.length} objective bullets`);
  return ok;
}

/**
 * A lazy but sensible player: idle combat units engage nearby enemies (or push to the next
 * checkpoint once the army is big enough), damaged structures get repaired, and production
 * buildings keep training basic units. No construction. Gives a rough difficulty signal.
 */
function autopilot(world: World, me: Player, cs: CampaignScript | null, state: { cp: number }) {
  const mine = world.units.filter((u) => u.owner === me && !u.dead && u.weapons.length > 0);
  const enemies = world.units.filter((u) => !u.dead && u.owner.isEnemyOf(me) && !u.isCloaked());
  const enemyB = world.buildings.filter((b) => !b.dead && b.owner.isEnemyOf(me) && !b.def.wall);
  const cps = cs?.checkpoints ?? [];
  // advance checkpoint when reached
  while (state.cp < cps.length && mine.some((u) => Math.hypot(u.x - cps[state.cp].x, u.z - cps[state.cp].z) < 5)) state.cp++;
  const push = mine.length >= 6 && state.cp < cps.length ? cps[state.cp] : null;
  for (const u of mine) {
    if (u.order.type !== 'idle' || u.target) continue;
    let best: { x: number; z: number } | null = null;
    let bd = 16;
    for (const e of enemies) {
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best && push) best = push;
    if (!best && mine.length >= 10) {
      let bb = Infinity;
      for (const b of enemyB) {
        const d = Math.hypot(b.x - u.x, b.z - u.z);
        if (d < bb) {
          bb = d;
          best = b;
        }
      }
    }
    if (best) u.issue({ type: 'move', x: best.x, z: best.z, attackMove: true }, world);
  }
  for (const b of world.buildings) if (b.owner === me && !b.dead && b.hp < b.maxHp * 0.7 && me.credits > 300) b.repairing = true;
  const inf = me.faction === 'aegis' ? ['rifleman', 'rocketeer'] : ['acolyte', 'seeker'];
  const veh = me.faction === 'aegis' ? ['guardian', 'guardian', 'scout'] : ['scorpion', 'scorpion', 'raider'];
  if (me.credits > 600 && me.queues.infantry.items.length < 2) me.enqueue(inf[Math.floor(Math.random() * inf.length)], world);
  if (me.credits > 900 && me.queues.vehicles.items.length < 2) me.enqueue(veh[Math.floor(Math.random() * veh.length)], world);
}

function simulate(def: MissionDef, mode: 'idle' | 'cheat' | 'auto', minutes: number, notes: string[]): boolean {
  badIds.length = 0;
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
  };
  let ok = true;
  try {
    const t0 = performance.now();
    const { world, script } = def.create();
    const host = new StubHost(world);
    const humans = world.players.filter((p) => p.isHuman);
    if (!world.players[0]?.isNeutral) throw new Error('players[0] is not neutral');
    if (humans.length !== 1) throw new Error(`${humans.length} human players`);
    const me = humans[0];
    if (me.faction !== def.faction) throw new Error('human faction mismatch');
    const s = script(host);
    const cs = s instanceof CampaignScript ? s : null;
    const dt = 1 / 30;
    // first tick runs start()
    world.tick(dt);
    s.update(dt);
    if (mode === 'idle') {
      // ---- static world checks (once)
      for (const u of world.units) {
        if (u.owner !== me || u.def.flying) continue;
        if (!world.map.passable(Math.floor(u.x), Math.floor(u.z))) notes.push(`FAIL human ${u.def.id} on impassable tile ${u.x.toFixed(1)},${u.z.toFixed(1)}`), (ok = false);
      }
      const anchor = world.buildings.find((b) => b.owner === me && b.def.produces === 'yard') ?? world.units.find((u) => u.owner === me && !u.def.flying) ?? world.buildings.find((b) => b.owner === me);
      if (!anchor) throw new Error('human has nothing');
      const seen = floodFrom(world, anchor.x, anchor.z + (anchor.kind === 'building' ? 2.5 : 0));
      for (const cp of cs?.checkpoints ?? []) if (!reachable(world, seen, cp)) notes.push(`FAIL no ground path to checkpoint ${cp.x},${cp.z}`), (ok = false);
      // enemy buildings reachable (adjacent tile)
      let unreachable = 0;
      for (const b of world.buildings) {
        if (!b.owner.isEnemyOf(me) || b.def.wall) continue;
        if (!reachable(world, seen, { x: b.x, z: b.z }, Math.max(b.w, b.h) / 2 + 2)) unreachable++;
      }
      if (unreachable) notes.push(`WARN ${unreachable} enemy structures not adjacent to reachable ground`);
      notes.push(`world ${world.map.w}x${world.map.h}, ${world.units.length} units, ${world.buildings.length} buildings, ${cs?.checkpoints.length ?? 0} checkpoints`);
    }
    const maxT = minutes * 60;
    let cheatT = 0;
    let objectivesSeen = 0;
    const autoState = { cp: 0 };
    let autoT = 0;
    while (world.time < maxT && host.ended === null) {
      world.tick(dt);
      s.update(dt);
      if (mode === 'cheat' && cs && !s.finished) {
        cheatT += dt;
        if (cheatT >= 1) {
          cheatT = 0;
          cs.cheatStep();
        }
      }
      if (mode === 'auto' && !s.finished) {
        autoT += dt;
        if (autoT >= 2) {
          autoT = 0;
          autopilot(world, me, cs, autoState);
        }
      }
      objectivesSeen = Math.max(objectivesSeen, host.objectives.length);
      if (errors.length > 0) break;
    }
    const ms = performance.now() - t0;
    const objs = host.objectives.map((o) => `${o.done ? '+' : o.failed ? 'x' : '-'}${o.id}`).join(' ');
    const end = host.ended === null ? 'running' : host.ended ? 'VICTORY' : 'DEFEAT';
    notes.push(`${mode}: ${end} @ ${(host.ended === null ? world.time : host.endT).toFixed(0)}s  objectives[${objs}] lines ${host.lines} hints ${host.hints} msgs ${host.log.length} (${(ms / 1000).toFixed(1)}s)`);
    if (errors.length) notes.push('FAIL errors: ' + errors.slice(0, 3).join(' | ')), (ok = false);
    if (badIds.length) notes.push('FAIL unknown ids: ' + [...new Set(badIds)].join(',')), (ok = false);
    if (mode === 'idle' && host.ended === true) notes.push('FAIL idle player won'), (ok = false);
    if (mode === 'cheat' && host.ended !== true) {
      notes.push('FAIL cheat pass did not win');
      notes.push('   last log: ' + host.log.slice(-6).join(' / '));
      ok = false;
    }
    if (host.lines === 0) notes.push('FAIL no radio dialogue'), (ok = false);
  } catch (e) {
    notes.push(`FAIL exception (${mode}): ${(e as Error).stack?.split('\n').slice(0, 4).join(' ')}`);
    ok = false;
  } finally {
    console.error = origErr;
  }
  return ok;
}

// ---------------------------------------------------------------- main
const all: MissionDef[] = [...CAMPAIGNS.aegis, ...CAMPAIGNS.covenant];
const list = target === 'all' ? all : all.filter((m) => m.id === target || m.id.startsWith(target));
if (list.length === 0) {
  console.log('no mission matches', target, '— available:', all.map((m) => m.id).join(', '));
  process.exit(1);
}
for (const f of ['aegis', 'covenant'] as const) {
  CAMPAIGNS[f].forEach((m, i) => {
    if (m.index !== i + 1) console.log(`WARN ${m.id} index ${m.index} at position ${i + 1}`);
    if (m.faction !== f) console.log(`WARN ${m.id} faction mismatch`);
  });
}
const results: Result[] = [];
for (const def of list) {
  console.log(`\n=== ${def.id} — ${def.name} (${def.faction} ${def.index})`);
  const notes: string[] = [];
  let ok = staticChecks(def, notes);
  if (only !== 'cheat') ok = simulate(def, 'idle', idleMin, notes) && ok;
  if (only !== 'idle') ok = simulate(def, 'cheat', cheatMin, notes) && ok;
  if (auto) simulate(def, 'auto', autoMin, notes);
  for (const n of notes) console.log('  ' + n);
  results.push({ id: def.id, ok, notes });
}
console.log('\n=== SUMMARY');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
