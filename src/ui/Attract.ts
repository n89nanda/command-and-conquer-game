import { doodadParts, husk, models, rubble } from '../bridge';
import { resetEntityIds } from '../game/Entity';
import { generateMap, type MapSpec } from '../game/MapGen';
import { Player } from '../game/Player';
import type { Unit } from '../game/Unit';
import { World } from '../game/World';
import { GameRenderer } from '../render/Renderer';

const SPEC: MapSpec = {
  id: 'attract', name: 'Attract', description: '', w: 72, h: 56, seed: 2024, theater: 'temperate', players: 2,
  cliffs: 0.25, water: 0.12, trees: 0.8, ore: 1, roads: true, derricks: 0, civilians: 2, layout: 'horizontal',
};

/** Live background battle for the main menu. */
export class Attract {
  renderer: GameRenderer;
  world: World;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private t = 0;
  private spawnT = 3;
  private a: Player;
  private b: Player;
  private starts: { x: number; z: number }[];
  running = true;
  private beatT = 0;
  private beat = 0;
  private focus = { x: 0, z: 0, zoom: 13, yaw: 0, follow: false };

  private fightCentre(): { x: number; z: number } | null {
    const w = this.world;
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    const mid = { x: w.map.w / 2, z: w.map.h / 2 };
    for (const u of w.units) {
      if (u.owner !== this.a || !u.target || u.target.dead) continue;
      const d = Math.hypot(u.x - mid.x, u.z - mid.z);
      if (d < bd) {
        bd = d;
        best = { x: (u.x + u.target.x) / 2, z: (u.z + u.target.z) / 2 };
      }
    }
    return best;
  }

  private nextBeat() {
    const w = this.world;
    this.beatT = 13;
    this.beat++;
    const fight = this.fightCentre();
    const kind = this.beat % 4;
    const cut = (x: number, z: number, zoom: number, yaw: number, follow: boolean) => {
      this.focus = { x, z, zoom, yaw, follow };
      const rig = this.renderer.rig;
      rig.targetX = x;
      rig.targetZ = z;
      rig.zoom = zoom + 1.5;
      rig.yaw = yaw - 0.15;
    };
    if ((kind === 0 || kind === 2) && fight) cut(fight.x, fight.z, 11.5, (Math.random() - 0.5) * 0.8, true);
    else if (kind === 1) {
      const s = this.starts[this.beat % 2];
      cut(s.x + (this.beat % 2 ? -2 : 2), s.z + 2, 12.5, (Math.random() - 0.5) * 0.9, false);
    } else {
      const h = w.units.find((u) => u.def.harvester);
      if (h) cut(h.x, h.z, 10.5, (Math.random() - 0.5) * 0.8, false);
      else cut(w.map.w / 2, w.map.h / 2, 13, 0, true);
    }
  }

  constructor(host: HTMLElement) {
    resetEntityIds();
    const gen = generateMap(SPEC);
    const neutral = new Player(0, 'Civ', 'aegis', 0xaaaaaa, -1, false, 0, true);
    this.a = new Player(1, 'Aegis', 'aegis', 0x2f7fff, 1, false, 99999);
    this.b = new Player(2, 'Covenant', 'covenant', 0xe0282e, 2, false, 99999);
    this.world = new World(gen.map, [neutral, this.a, this.b], { seed: 5 });
    this.starts = gen.starts;
    const w = this.world;
    const [sa, sb] = gen.starts;
    const base = (p: Player, s: { x: number; z: number }, ids: string[]) => {
      const spots = [[-1, -1], [3, -2], [-4, -1], [3, 2], [-4, 3], [0, 4], [-7, -3]];
      ids.forEach((id, i) => {
        const [dx, dz] = spots[i % spots.length];
        const tx = Math.floor(s.x + dx * (p === this.b ? -1 : 1)), tz = Math.floor(s.z + dz);
        if (w.canPlace(p, id, tx, tz) || i === 0) {
          try {
            const bld = w.addBuilding(p, id, tx, tz);
            w.invulnerable.add(bld);
          } catch {
            /* ignore */
          }
        }
      });
    };
    base(this.a, sa, ['a_yard', 'a_power', 'a_barracks', 'a_refinery', 'a_factory', 'a_radar', 'a_power']);
    base(this.b, sb, ['c_yard', 'c_power', 'c_barracks', 'c_refinery', 'c_factory', 'c_radar', 'c_power']);
    for (const c of gen.civilians) w.addBuilding(neutral, 'n_bunker', c.x, c.z);
    // harvesters for ambience
    for (const [p, s, id] of [[this.a, sa, 'a_harvester'], [this.b, sb, 'c_harvester']] as const) {
      const np = w.map.nearestPassable(s.x, s.z + 5, 6);
      if (np) w.addUnit(p, id, np[0] + 0.5, np[1] + 0.5).issue({ type: 'harvest' }, w);
    }
    this.renderer = new GameRenderer(host, models, doodadParts, { husk, rubble });
    this.renderer.attachWorld(w);
    this.renderer.rig.zoom = 15;
    this.renderer.rig.lookAt(w.map.w / 2, w.map.h / 2);
    // pre-simulate a little so there's action immediately
    for (let i = 0; i < 3; i++) this.wave();
    for (let i = 0; i < 30 * 6; i++) w.tick(1 / 30);
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.renderer.resize();

  private wave() {
    const w = this.world;
    const [sa, sb] = this.starts;
    const mk = (p: Player, s: { x: number; z: number }, ids: string[], tgt: { x: number; z: number }) => {
      const units: Unit[] = [];
      ids.forEach((id, i) => {
        const np = w.map.nearestPassable(s.x + (p === this.a ? 5 : -5) + (i % 3), s.z + 3 + Math.floor(i / 3), 6);
        if (np) units.push(w.addUnit(p, id, np[0] + 0.5, np[1] + 0.5));
      });
      units.forEach((u, i) => u.issue({ type: 'move', x: tgt.x + (i % 3) - 1, z: tgt.z + Math.floor(i / 3) - 1, attackMove: true }, w));
    };
    const r = Math.random();
    const aeg = r < 0.33 ? ['guardian', 'guardian', 'rifleman', 'rifleman', 'rocketeer', 'titan'] : r < 0.66 ? ['scout', 'guardian', 'rifleman', 'rocketeer', 'rifleman', 'tempest'] : ['guardian', 'titan', 'rocketeer', 'rocketeer', 'marksman', 'hawk'];
    const cov = r < 0.33 ? ['scorpion', 'scorpion', 'acolyte', 'zealot', 'seeker', 'prism'] : r < 0.66 ? ['raider', 'raider', 'inferno', 'acolyte', 'acolyte', 'seeker'] : ['scorpion', 'shade', 'zealot', 'zealot', 'prism', 'wraith'];
    mk(this.a, sa, aeg, sb);
    mk(this.b, sb, cov, sa);
  }

  private frame(dt: number) {
    const w = this.world;
    this.t += dt;
    this.acc += dt;
    while (this.acc >= 1 / 30) {
      w.tick(1 / 30);
      this.acc -= 1 / 30;
    }
    this.spawnT -= dt;
    // keep the population bounded
    if (this.spawnT <= 0) {
      this.spawnT = 14;
      if (w.units.length < 70) this.wave();
    }
    // camera director: cut between cinematic "beats" every ~13s
    const rig = this.renderer.rig;
    this.beatT -= dt;
    if (this.beatT <= 0) this.nextBeat();
    const f = this.focus;
    if (f.follow) {
      // follow the centre of the current fight
      const fight = this.fightCentre();
      if (fight) {
        f.x += (fight.x - f.x) * Math.min(1, dt * 0.4);
        f.z += (fight.z - f.z) * Math.min(1, dt * 0.4);
      }
    }
    rig.targetX += (f.x - rig.targetX) * Math.min(1, dt * 1.2);
    rig.targetZ += (f.z - rig.targetZ) * Math.min(1, dt * 1.2);
    rig.yaw += (f.yaw - rig.yaw) * Math.min(1, dt * 0.3) + dt * 0.012;
    rig.zoom += (f.zoom - rig.zoom) * Math.min(1, dt * 0.8);
    rig.pitch = (47 * Math.PI) / 180;
    this.renderer.render(dt, Math.min(1, this.acc * 30));
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.detachWorld();
    this.renderer.renderer.dispose();
    this.renderer.canvas.remove();
  }
}
