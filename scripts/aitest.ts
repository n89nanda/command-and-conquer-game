// Headless AI-vs-AI test harness.
//
//   npx tsx scripts/aitest.ts [mapId|all] [minutes] [options]
//
// options:
//   --diff=normal,hard      difficulties per player (cycled)
//   --fac=aegis,covenant    factions per player (cycled)
//   --batch                 run every map x faction pairing x difficulty pairing
//   --n=2                   repeats per configuration (batch mode)
//   --credits=5000
//   --quiet                 no timeline, only results
//   --log                   print AI decision log
//
// A player is defeated when they own no buildings (walls and captured neutral
// structures excluded) and no units except harvesters.

import { SKIRMISH_MAPS } from '../src/game/MapGen';
import { createSkirmish, type Difficulty } from '../src/game/Scenario';
import { SkirmishAI } from '../src/game/ai/SkirmishAI';
import type { FactionId } from '../src/data/types';
import type { Player } from '../src/game/Player';
import type { World } from '../src/game/World';

interface MatchSetup {
  mapId: string;
  factions: FactionId[];
  diffs: Difficulty[];
  minutes: number;
  credits: number;
  quiet: boolean;
  log: boolean;
}

interface MatchResult {
  mapId: string;
  winner: Player | null;
  winnerIdx: number;
  duration: number;
  players: { name: string; faction: FactionId; diff: Difficulty; defeatedAt: number; stats: Player['stats']; ai: SkirmishAI; aiMs: number; aiMaxMs: number }[];
  simMs: number;
  ticks: number;
  error?: string;
  stuck: string[];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=')[1];
const has = (name: string) => args.includes('--' + name);
const pos = args.filter((a) => !a.startsWith('--'));

function isDefeated(world: World, p: Player): boolean {
  for (const b of world.buildings) if (b.owner === p && !b.dead && !b.def.wall && b.def.faction !== 'both') return false;
  for (const u of world.units) if (u.owner === p && !u.dead && !u.def.harvester) return false;
  return true;
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function runMatch(setup: MatchSetup): MatchResult {
  const spec = SKIRMISH_MAPS.find((m) => m.id === setup.mapId)!;
  const n = spec.players === 2 ? 2 : spec.players;
  const players = Array.from({ length: n }, (_, i) => ({
    faction: setup.factions[i % setup.factions.length],
    colorIndex: i,
    team: i + 1,
    human: false,
    difficulty: setup.diffs[i % setup.diffs.length],
  }));
  const { world } = createSkirmish({ mapId: setup.mapId, players, credits: setup.credits, startUnits: 'mcv', shroud: true, gameSpeed: 1 });
  const active = world.players.filter((p) => !p.isNeutral);
  const ais: SkirmishAI[] = [];
  const aiMs: number[] = active.map(() => 0);
  const aiMax: number[] = active.map(() => 0);
  active.forEach((p, i) => {
    const ai = new SkirmishAI(world, p, players[i].difficulty);
    if (setup.log) ai.log = (m) => console.log('   ' + m);
    ais.push(ai);
    p.ai = {
      update(dt: number) {
        const t = performance.now();
        ai.update(dt);
        const e = performance.now() - t;
        aiMs[i] += e;
        if (e > aiMax[i]) aiMax[i] = e;
      },
    };
  });
  const defeatedAt = active.map(() => -1);
  const kills = { units: new Map<Player, number>() };
  void kills;
  const dt = 1 / 30;
  const maxTicks = Math.round(setup.minutes * 60 * 30);
  const t0 = performance.now();
  let winner: Player | null = null;
  let error: string | undefined;
  let lastReport = 0;
  const stuck: string[] = [];
  const lastSpent = active.map(() => 0);
  const lastHarvested = active.map(() => 0);
  const header = () => {
    if (setup.quiet) return;
    console.log(`\n=== ${spec.name} (${spec.id}) : ` + active.map((p, i) => `${p.name} [${p.faction}/${players[i].difficulty}]`).join(' vs ') + ' ===');
  };
  header();
  let tick = 0;
  try {
    for (tick = 0; tick < maxTicks; tick++) {
      world.tick(dt);
      if (tick % 30 === 0) {
        for (let i = 0; i < active.length; i++) {
          const p = active[i];
          if (defeatedAt[i] >= 0) continue;
          if (isDefeated(world, p)) {
            defeatedAt[i] = world.time;
            p.defeated = true;
            p.ai = null;
            ais[i].dispose();
            if (!setup.quiet) console.log(`  [${fmt(world.time)}] ${p.name} DEFEATED`);
          }
        }
        const alive = active.filter((_, i) => defeatedAt[i] < 0);
        const teams = new Set(alive.map((p) => p.team));
        if (teams.size <= 1) {
          winner = alive[0] ?? null;
          break;
        }
      }
      if (world.time - lastReport >= 60) {
        lastReport = world.time;
        for (let i = 0; i < active.length; i++) {
          const p = active[i];
          if (defeatedAt[i] >= 0) continue;
          const units = world.units.filter((u) => u.owner === p && !u.dead);
          const army = units.filter((u) => u.weapons.length > 0).length;
          const harv = units.filter((u) => u.def.harvester).length;
          const blds = world.buildings.filter((b) => b.owner === p && !b.dead);
          if (!setup.quiet) {
            if (setup.log) console.log('     ' + ais[i].debugState());
            console.log(
              `  [${fmt(world.time)}] ${p.name.padEnd(16)} bld ${String(blds.length).padStart(2)} army ${String(army).padStart(3)} harv ${harv} cr ${String(Math.round(p.credits)).padStart(6)} ` +
                `harvested ${String(p.stats.creditsHarvested).padStart(6)} spent ${String(Math.round(p.stats.creditsSpent)).padStart(6)} ` +
                `kills ${p.stats.unitsKilled}/${p.stats.buildingsDestroyed} lost ${p.stats.unitsLost}/${p.stats.buildingsLost} ` +
                `pow ${p.powerProduced}/${p.powerUsed} atk ${ais[i].stats.attacks} har ${ais[i].stats.harassRaids}`,
            );
          }
          // stuck-state heuristics
          if (world.time > 240) {
            if (p.stats.creditsSpent - lastSpent[i] < 50 && p.credits > 2000) stuck.push(`${fmt(world.time)} ${p.name} not spending (cr ${Math.round(p.credits)}) ${ais[i].debugState()}`);
            if (harv > 0 && p.stats.creditsHarvested - lastHarvested[i] < 50 && world.map.totalOre() > 20000) {
              const hs = units.filter((u) => u.def.harvester).map((h) => `${h.order.type}/${h.harvState}@${h.x.toFixed(0)},${h.z.toFixed(0)} c${Math.round(h.cargo)}`);
              const refs = blds.filter((b) => b.def.refinery).length;
              stuck.push(`${fmt(world.time)} ${p.name} harvesters not delivering (refineries ${refs}): ${hs.join(' | ')}`);
            }
          }
          lastSpent[i] = p.stats.creditsSpent;
          lastHarvested[i] = p.stats.creditsHarvested;
        }
      }
    }
  } catch (e) {
    error = (e as Error).stack ?? String(e);
    console.log('EXCEPTION', error);
  }
  const simMs = performance.now() - t0;
  const res: MatchResult = {
    mapId: setup.mapId,
    winner,
    winnerIdx: winner ? active.indexOf(winner) : -1,
    duration: world.time,
    players: active.map((p, i) => ({
      name: p.name, faction: p.faction, diff: players[i].difficulty, defeatedAt: defeatedAt[i], stats: p.stats, ai: ais[i], aiMs: aiMs[i], aiMaxMs: aiMax[i],
    })),
    simMs,
    ticks: tick,
    error,
    stuck,
  };
  if (!setup.quiet) {
    console.log(`  RESULT: ${winner ? `${winner.name} [${winner.faction}/${players[active.indexOf(winner)].difficulty}] wins` : 'no winner'} after ${fmt(world.time)} (sim ${(simMs / 1000).toFixed(1)}s)`);
    for (const pl of res.players)
      console.log(
        `    ${pl.name.padEnd(16)} ${pl.faction}/${pl.diff} ai avg ${(pl.aiMs / Math.max(1, tick)).toFixed(3)}ms/tick max ${pl.aiMaxMs.toFixed(1)}ms ` +
          `think avg ${(pl.ai.stats.thinkMs / Math.max(1, pl.ai.stats.thinks)).toFixed(2)}ms attacks ${pl.ai.stats.attacks} raids ${pl.ai.stats.harassRaids} sw ${pl.ai.stats.superweapons} derricks ${pl.ai.stats.derricksCaptured} exp ${pl.ai.stats.expansions} placeFail ${pl.ai.stats.placementsFailed}`,
      );
    if (stuck.length) console.log('    STUCK WARNINGS:\n      ' + stuck.join('\n      '));
  }
  return res;
}

// ------------------------------------------------------------------ main
const minutes = Number(pos[1] ?? 40);
const credits = Number(flag('credits') ?? 5000);
const quiet = has('quiet');
const log = has('log');
const maps = !pos[0] || pos[0] === 'all' ? SKIRMISH_MAPS.map((m) => m.id) : pos[0].split(',');

const results: MatchResult[] = [];
if (has('batch')) {
  const reps = Number(flag('n') ?? 1);
  const diffPairs: Difficulty[][] = (flag('pairs') ?? 'normal:normal,easy:hard,hard:hard').split(',').map((s) => s.split(':') as Difficulty[]);
  const facPairs: FactionId[][] = [['aegis', 'covenant'], ['covenant', 'aegis'], ['aegis', 'aegis'], ['covenant', 'covenant']];
  for (const mapId of maps)
    for (const dp of diffPairs)
      for (const fp of facPairs.slice(0, dp[0] === dp[1] ? 2 : 2))
        for (let r = 0; r < reps; r++) {
          const res = runMatch({ mapId, factions: fp, diffs: dp, minutes, credits, quiet: true, log: false });
          results.push(res);
          const w = res.winner ? `${res.players[res.winnerIdx].faction}/${res.players[res.winnerIdx].diff}` : 'none';
          const perf = res.players.map((p) => (p.aiMs / Math.max(1, res.ticks)).toFixed(3)).join('/');
          console.log(
            `${mapId.padEnd(12)} ${res.players.map((p) => `${p.faction}/${p.diff}`).join(' vs ').padEnd(40)} -> ${w.padEnd(16)} ${fmt(res.duration)} sim ${(res.simMs / 1000).toFixed(1)}s ai ${perf}ms/tick` +
              (res.error ? ' ERROR' : '') + (res.stuck.length ? ` stuck:${res.stuck.length}` : ''),
          );
        }
} else {
  const factions = (flag('fac') ?? 'aegis,covenant').split(',') as FactionId[];
  const diffs = (flag('diff') ?? 'normal').split(',') as Difficulty[];
  for (const mapId of maps) results.push(runMatch({ mapId, factions, diffs, minutes, credits, quiet, log }));
}

// ------------------------------------------------------------------ summary
if (results.length > 1) {
  console.log('\n=== SUMMARY ===');
  const decided = results.filter((r) => r.winner);
  console.log(`matches ${results.length}, decided ${decided.length}, errors ${results.filter((r) => r.error).length}, with stuck warnings ${results.filter((r) => r.stuck.length).length}`);
  const durs = decided.map((r) => r.duration / 60).sort((a, b) => a - b);
  if (durs.length) console.log(`duration min ${durs[0].toFixed(1)} median ${durs[Math.floor(durs.length / 2)].toFixed(1)} max ${durs[durs.length - 1].toFixed(1)} minutes`);
  // faction win rate in mixed-faction games
  const mixed = decided.filter((r) => r.players[0].faction !== r.players[1].faction && r.players[0].diff === r.players[1].diff);
  const facWins: Record<string, number> = {};
  for (const r of mixed) facWins[r.players[r.winnerIdx].faction] = (facWins[r.players[r.winnerIdx].faction] ?? 0) + 1;
  console.log(`faction wins (same difficulty, mixed factions, ${mixed.length} games):`, facWins);
  const dmix = decided.filter((r) => r.players[0].diff !== r.players[1].diff);
  const dWins: Record<string, number> = {};
  for (const r of dmix) dWins[r.players[r.winnerIdx].diff] = (dWins[r.players[r.winnerIdx].diff] ?? 0) + 1;
  console.log(`difficulty wins (mixed difficulty, ${dmix.length} games):`, dWins);
  let ms = 0, ticks = 0, maxMs = 0, thinkMs = 0, thinks = 0;
  for (const r of results)
    for (const p of r.players) {
      ms += p.aiMs;
      ticks += r.ticks;
      maxMs = Math.max(maxMs, p.aiMaxMs);
      thinkMs += p.ai.stats.thinkMs;
      thinks += p.ai.stats.thinks;
    }
  console.log(`AI cost per player: avg ${(ms / Math.max(1, ticks)).toFixed(4)} ms/tick, avg ${(thinkMs / Math.max(1, thinks)).toFixed(3)} ms/think, worst single tick ${maxMs.toFixed(1)} ms`);
}
