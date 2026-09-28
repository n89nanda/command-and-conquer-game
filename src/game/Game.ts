import * as THREE from 'three';
import { BUILDINGS, SUPERWEAPONS } from '../data/buildings';
import { UNITS } from '../data/units';
import { FACTIONS } from '../data/factions';
import type { BuildTab, SoundId } from '../data/types';
import { audio, doodadParts, ghost, husk, models, rubble } from '../bridge';
import { GameRenderer } from '../render/Renderer';
import { registerWorldMaterial } from '../render/materials';
import type { Building } from './Building';
import type { Entity } from './Entity';
import type { Player } from './Player';
import type { Unit } from './Unit';
import type { World } from './World';
import type { VoiceKind } from '../audio/AudioTypes';

export type Mode = 'normal' | 'place' | 'sell' | 'repair' | 'attackMove' | 'superweapon' | 'forceFire';

export interface GameHooks {
  onEnd?: (victory: boolean, world: World) => void;
  onMessage?: (text: string, color?: string) => void;
  onPauseToggle?: (paused: boolean) => void;
  onHint?: (html: string | null) => void;
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
  failed?: boolean;
  optional?: boolean;
}

const ACK: Record<string, { select: string[]; move: string[]; attack: string[] }> = {
  infantry: {
    select: ['Reporting.', 'Awaiting orders.', 'Ready, sir.', 'Standing by.', 'Squad ready.'],
    move: ['Moving out.', 'Acknowledged.', 'On my way.', 'Affirmative.', 'Roger that.'],
    attack: ['Engaging.', 'Target sighted.', 'Open fire!', 'Weapons free.', 'Taking them down.'],
  },
  zealot: {
    select: ['The Rift awaits.', 'Speak, Prophet.', 'We are ready.', 'Command us.', 'Yes, master?'],
    move: ['As the Rift wills.', 'We obey.', 'Moving.', 'It shall be done.', 'Onward.'],
    attack: ['For the Rift!', 'Purge them!', 'Burn!', 'No mercy!', 'Death to the unbelievers!'],
  },
  vehicle: {
    select: ['Vehicle ready.', 'Armour standing by.', 'Systems online.', 'Crew ready.', 'Awaiting coordinates.'],
    move: ['Rolling out.', 'Moving to position.', 'Affirmative.', 'Copy that.', 'On the move.'],
    attack: ['Target locked.', 'Firing!', 'Engaging target.', 'Bringing the guns around.', 'Hostile in sight.'],
  },
  heavy: {
    select: ['Heavy armour online.', 'Titan ready.', 'Standing tall.', 'Power at maximum.'],
    move: ['Advancing.', 'Clear the way.', 'Moving out, slow and steady.', 'Affirmative.'],
    attack: ['Crushing resistance.', 'Main guns firing.', 'Nothing survives this.', 'Obliterate them.'],
  },
  pilot: {
    select: ['Pilot here.', 'Wings up.', 'Ready for sortie.', 'Airborne.'],
    move: ['Heading out.', 'Vector received.', 'On approach.', 'Copy, en route.'],
    attack: ['Attack run!', 'Weapons hot.', 'Going in!', 'Target painted.'],
  },
  engineer: {
    select: ['Engineer ready.', 'Tools at hand.', 'What needs fixing?', 'Ready to work.'],
    move: ['On it.', 'Heading there.', 'Moving.', 'Right away.'],
    attack: ['I am not a soldier!', 'Taking it over.', 'Let me at it.', 'Securing the structure.'],
  },
};

export class Game {
  world: World;
  renderer: GameRenderer;
  container: HTMLElement;
  viewport: HTMLElement;
  overlay: HTMLCanvasElement;
  octx: CanvasRenderingContext2D;
  me: Player;
  selection: Entity[] = [];
  groups = new Map<number, number[]>();
  mode: Mode = 'normal';
  placing: string | null = null;
  superweaponId: string | null = null;
  paused = false;
  speed = 1;
  hooks: GameHooks;
  objectives: Objective[] = [];
  missionTimer: { label: string; seconds: number } | null = null;
  ended = false;
  victory = false;
  lastTime = 0;
  acc = 0;
  running = false;
  tickRate = 30;
  private raf = 0;
  // input state
  mouseX = 0;
  mouseY = 0;
  mouseIn = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private midDrag: { x: number; y: number; tx: number; tz: number } | null = null;
  private keys = new Set<string>();
  private lastClick = { t: 0, id: -1 };
  private lastGroupTap = { n: -1, t: 0 };
  hoverEntity: Entity | null = null;
  hoverGround: THREE.Vector3 | null = null;
  private ghost: THREE.Group | null = null;
  private ghostTiles: THREE.Mesh[] = [];
  private ghostDef: string | null = null;
  private ghostOk: boolean | null = null;
  private markers: { x: number; z: number; t: number; color: string }[] = [];
  private lastAck = 0;
  private lastMoneySound = 0;
  private combatIntensity = 0;
  edgeScroll = true;
  scrollSpeed = 1;
  private unsub: (() => void)[] = [];
  private flashMsgs: { text: string; t: number; color: string }[] = [];
  /** Called every frame after rendering (UI refresh). */
  onFrame: ((dt: number) => void) | null = null;
  missionScript: { update(dt: number): void } | null = null;
  cinematic = false;
  alwaysRadar = false;
  private noBaseSince = new Map<Player, number>();
  private revealedStragglers = new Set<Player>();
  /** Two-finger scroll pans (trackpad) instead of zooming (mouse wheel). */
  trackpadMode = (() => {
    try {
      const v = localStorage.getItem('riftfall.trackpad');
      if (v !== null) return v === '1';
    } catch {
      /* ignore */
    }
    return navigator.platform.toUpperCase().includes('MAC');
  })();
  beacons: import('./mission/MissionScript').Beacon[] = [];
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(container: HTMLElement, world: World, hooks: GameHooks = {}) {
    this.container = container;
    this.world = world;
    this.hooks = hooks;
    this.me = world.human!;
    this.viewport = container.querySelector('#viewport') as HTMLElement;
    this.renderer = new GameRenderer(this.viewport, models, doodadParts, { husk, rubble });
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay-canvas';
    this.viewport.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    this.renderer.attachWorld(world);
    this.resize();
    this.focusStart();
    this.bindInput();
    this.hookAudio();
    try {
      const qp = new URLSearchParams(location.search).get('q');
      const q = Number(qp ?? localStorage.getItem('riftfall.quality') ?? '2');
      if (q !== 2) this.renderer.setQuality(q as 0 | 1 | 2);
      this.scrollSpeed = Number(localStorage.getItem('riftfall.scroll') ?? '1') || 1;
      this.edgeScroll = localStorage.getItem('riftfall.edge') !== '0';
    } catch {
      /* ignore */
    }
  }

  focusStart() {
    const yard = this.world.buildings.find((b) => b.owner === this.me && b.def.produces === 'yard');
    if (yard) return this.renderer.rig.lookAt(yard.x, yard.z + 1.5);
    const units = this.world.units.filter((u) => u.owner === this.me);
    if (units.length) {
      const c = centroid(units);
      this.renderer.rig.lookAt(c.x, c.z + 0.5);
    }
  }

  // =================================================================== loop
  start() {
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      let dt = (t - this.lastTime) / 1000;
      this.lastTime = t;
      if (dt > 0.25) dt = 0.25;
      if (dt < 0) dt = 0;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Debug/test helper: advance simulation without rendering. */
  simulate(seconds: number) {
    const step = 1 / this.tickRate;
    for (let t = 0; t < seconds; t += step) {
      this.world.tick(step);
      this.missionScript?.update(step);
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.unsub = [];
    for (const [t, n, f, o] of this.listeners) t.removeEventListener(n, f, o);
    this.listeners = [];
    this.renderer.detachWorld();
    this.renderer.renderer.dispose();
    this.renderer.canvas.remove();
    this.overlay.remove();
  }

  private frame(dt: number) {
    const step = 1 / this.tickRate;
    if (!this.paused && !this.ended) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= step && n < 8) {
        this.world.tick(step);
        this.missionScript?.update(step);
        this.acc -= step;
        n++;
      }
      if (n >= 8) this.acc = 0;
      if (this.missionTimer && this.missionTimer.seconds > 0) this.missionTimer.seconds = Math.max(0, this.missionTimer.seconds - dt * this.speed);
    }
    this.updateCamera(dt);
    // campaign operations that don't allow a radar structure give the player the minimap for free
    if (this.missionScript && !this.alwaysRadar && this.world.tickCount % 30 === 0) {
      const radarId = Object.values(BUILDINGS).find((b) => b.radar && b.faction === this.me.faction)?.id;
      if (radarId && !this.me.isVisibleItem(radarId)) this.alwaysRadar = true;
    }
    this.selection = this.selection.filter((e) => !e.dead && (e.owner === this.me || this.world.visibleTo(e, this.me)));
    this.updateHover();
    this.updateGhost();
    const alpha = this.paused ? 1 : Math.min(1, this.acc / step);
    this.renderer.render(this.paused ? 0 : dt * this.speed, alpha);
    const rig = this.renderer.rig;
    audio.setListener(rig.targetX, rig.targetZ, rig.viewRadius * 1.4);
    this.combatIntensity = Math.max(0, this.combatIntensity - dt * 0.08);
    audio.setIntensity(Math.min(1, this.combatIntensity));
    this.drawOverlay(dt);
    this.onFrame?.(dt);
    if (!this.ended) this.checkEnd();
  }

  // =================================================================== win / loss
  private checkEnd() {
    if (this.missionScript) return; // missions decide themselves
    if (this.world.tickCount % 30 !== 0) return;
    const alive = (p: Player) => this.world.buildings.some((b) => b.owner === p && !b.def.wall && b.def.faction !== 'both') || this.world.units.some((u) => u.owner === p && !u.def.harvester);
    for (const p of this.world.players) {
      if (p.isNeutral || p.defeated) continue;
      // a player without any base structure is finished after a short grace period;
      // their stragglers are revealed so the hunt doesn't drag on
      const hasBase = this.world.buildings.some((b) => b.owner === p && !b.def.wall && b.def.faction !== 'both');
      const hasMcv = this.world.units.some((u) => u.owner === p && u.def.mcv);
      if (!hasBase && !hasMcv) {
        this.noBaseSince.set(p, this.noBaseSince.get(p) ?? this.world.time);
        const since = this.world.time - this.noBaseSince.get(p)!;
        if (p !== this.me && p.isEnemyOf(this.me)) {
          const left = this.world.units.filter((u) => u.owner === p && !u.def.harvester);
          if (left.length && !this.revealedStragglers.has(p)) {
            this.revealedStragglers.add(p);
            this.announce(`${left.length} enemy unit${left.length > 1 ? 's' : ''} remaining.`, true, '#ffd76a');
          }
          this.beacons = this.beacons.filter((b) => !b.id.startsWith('straggler:' + p.index));
          left.slice(0, 6).forEach((u, i) => this.beacons.push({ id: `straggler:${p.index}:${i}`, x: u.x, z: u.z, entity: u, color: '#ff6a4a' }));
        }
        if (since > 60 && p !== this.me) {
          for (const u of this.world.units) if (u.owner === p) this.world.kill(u, null);
        }
      } else this.noBaseSince.delete(p);
      if (!alive(p)) {
        p.defeated = true;
        if (p !== this.me) this.announce(`${p.name} has been defeated.`, true);
      }
    }
    if (this.me.defeated) {
      this.world.endReason = 'Your forces were wiped out.';
      return this.end(false);
    }
    const enemiesLeft = this.world.players.some((p) => !p.isNeutral && !p.defeated && p.isEnemyOf(this.me));
    if (!enemiesLeft) this.end(true);
  }

  end(victory: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.victory = victory;
    this.world.gameOver = true;
    audio.speak(victory ? 'Mission accomplished.' : 'Mission failed.', 'announcer', { faction: this.me.faction, priority: 5 });
    audio.play(victory ? 'victory' : 'defeat');
    audio.playMusic(victory ? 'victory' : 'defeat');
    setTimeout(() => this.hooks.onEnd?.(victory, this.world), 3500);
  }

  announce(text: string, speak = true, color = '#9fe8ff') {
    this.hooks.onMessage?.(text, color);
    if (speak) audio.speak(text, 'announcer', { faction: this.me.faction, priority: 1 });
  }

  // ---- MissionHost implementation
  message(text: string, color?: string) {
    this.hooks.onMessage?.(text, color);
  }
  speak(text: string, speaker: 'announcer' | 'commander' | 'enemy' | 'ally' | 'intel') {
    const kind: VoiceKind = speaker === 'announcer' ? 'announcer' : speaker === 'enemy' ? (this.me.faction === 'aegis' ? 'zealot' : 'heavy') : speaker === 'commander' ? 'vehicle' : speaker === 'intel' ? 'pilot' : 'infantry';
    const faction = speaker === 'enemy' ? (this.me.faction === 'aegis' ? 'covenant' : 'aegis') : this.me.faction;
    audio.speak(text, kind, { faction, priority: speaker === 'announcer' ? 2 : 3 });
  }
  hint(html: string | null) {
    this.hooks.onHint?.(html ? platformText(html, this.trackpadMode) : html);
  }
  playMusic(track: import('../audio/AudioTypes').MusicTrack) {
    audio.playMusic(track);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.hooks.onPauseToggle?.(p);
  }

  // =================================================================== audio hooks
  private hookAudio() {
    const ev = this.world.events;
    const me = this.me;
    const vol = (x: number, z: number) => {
      const fog = this.world.fogs.get(me);
      if (fog && !fog.isVisible(x, z)) return 0.25;
      return 1;
    };
    this.unsub.push(
      ev.on('fire', (e) => {
        audio.play(e.weapon.sound, { x: e.fx, z: e.fz, volume: vol(e.fx, e.fz), rate: 0.95 + Math.random() * 0.1 });
        if (e.shooter.owner === me || e.shooter.owner.isEnemyOf(me)) {
          const r = this.renderer.rig;
          if (Math.abs(e.fx - r.targetX) < 25 && Math.abs(e.fz - r.targetZ) < 20) this.combatIntensity = Math.min(1.2, this.combatIntensity + 0.02);
        }
      }),
      ev.on('impact', (e) => {
        if (e.kind === 'shell' || e.kind === 'rocket' || e.kind === 'missile' || e.kind === 'artillery') audio.play('explosionSmall', { x: e.x, z: e.z, volume: vol(e.x, e.z) * 0.8 });
      }),
      ev.on('explosion', (e) => {
        const s: SoundId = e.sound ?? (e.size === 'infantry' ? 'infantryDie' : e.size === 'small' ? 'explosionSmall' : e.size === 'medium' ? 'explosionMedium' : 'explosionLarge');
        audio.play(s, { x: e.x, z: e.z, volume: vol(e.x, e.z) });
        if (e.size === 'huge') audio.play('explosionLarge', { x: e.x, z: e.z });
      }),
      ev.on('announce', (e) => {
        if (e.player && e.player !== me) return;
        const lvl = e.priority ?? 0;
        if (lvl >= 0 || e.text === 'Training.') {
          const quiet = e.text === 'Training.' || e.text === 'Building.';
          this.hooks.onMessage?.(e.text, lvl >= 2 ? '#ff8a6a' : '#9fe8ff');
          if (!quiet || Math.random() < 0.5) audio.speak(e.text, 'announcer', { faction: me.faction, priority: lvl });
        }
        if (e.x !== undefined && e.z !== undefined) me.lastAlertPos = { x: e.x, z: e.z };
      }),
      ev.on('buildingPlaced', (e) => {
        if (e.building.owner === me && e.building.constructing < 1) audio.play('placeBuilding', { x: e.building.x, z: e.building.z });
      }),
      ev.on('sold', (e) => {
        if (e.building.owner === me) audio.play('sell');
      }),
      ev.on('crushed', (e) => audio.play('crush', { x: e.unit.x, z: e.unit.z, volume: vol(e.unit.x, e.unit.z) })),
      ev.on('credits', (e) => {
        if (e.player !== me) return;
        const t = performance.now();
        if (t - this.lastMoneySound > 180) {
          this.lastMoneySound = t;
          audio.play('moneyTick', { volume: 0.5 });
        }
      }),
      ev.on('promoted', (e) => {
        if (e.unit.owner === me) {
          this.hooks.onMessage?.('Unit promoted.', '#ffd76a');
          audio.speak('Unit promoted.', 'announcer', { faction: me.faction, priority: 0 });
        }
      }),
      ev.on('superweaponLaunch', (e) => audio.play(e.id === 'ionStrike' ? 'ionCharge' : 'nukeLaunch', { x: e.x, z: e.z, volume: 1 })),
      ev.on('superweaponImpact', (e) => {
        audio.play(e.id === 'ionStrike' ? 'ionStrike' : 'nukeImpact', { x: e.x, z: e.z, volume: 1 });
        this.combatIntensity = 1.2;
      }),
      ev.on('harvest', (e) => {
        if (e.unit.owner === me && Math.random() < 0.15) audio.play('harvest', { x: e.unit.x, z: e.unit.z, volume: 0.5 });
      }),
      ev.on('unitReady', (e) => {
        if (e.player === me) audio.play('unitReady', { volume: 0.6 });
      }),
      ev.on('constructionReady', (e) => {
        if (e.player === me) audio.play('buildComplete', { volume: 0.7 });
      }),
      ev.on('captured', (e) => {
        if (e.to === me) audio.play('buildComplete');
      }),
      ev.on('unitAttacked', (e) => {
        // announce only when the fight is outside the current view
        const r = this.renderer.rig;
        if (Math.abs(e.x - r.targetX) > 14 || Math.abs(e.z - r.targetZ) > 10) {
          this.hooks.onMessage?.('Unit under attack.', '#ff8a6a');
          audio.speak('Unit under attack.', 'announcer', { faction: me.faction, priority: 1 });
        }
      }),
      ev.on('damaged', (e) => {
        if (e.entity.owner === me) this.combatIntensity = Math.min(1.2, this.combatIntensity + 0.01);
      }),
    );
  }

  ack(units: Unit[], kind: 'select' | 'move' | 'attack') {
    const t = performance.now();
    if (t - this.lastAck < 900 || units.length === 0) return;
    this.lastAck = t;
    const u = units[Math.floor(Math.random() * units.length)];
    const voice = (u.def.voice ?? 'infantry') as VoiceKind;
    const set = ACK[voice] ?? ACK.infantry;
    const lines = set[kind];
    audio.speak(lines[Math.floor(Math.random() * lines.length)], voice, { faction: u.owner.faction });
  }

  // =================================================================== camera
  private updateCamera(dt: number) {
    const rig = this.renderer.rig;
    const sp = (12 + rig.zoom * 0.9) * dt * this.scrollSpeed;
    let dx = 0, dz = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('ArrowDown')) dz += 1;
    if (this.edgeScroll && this.mouseIn && !this.dragging && !this.midDrag && document.hasFocus()) {
      const e = 12;
      const W = window.innerWidth, H = window.innerHeight;
      if (this.mouseX <= e) dx -= 1;
      if (this.mouseX >= W - e - 1) dx += 1;
      if (this.mouseY <= e) dz -= 1;
      if (this.mouseY >= H - e - 1) dz += 1;
    }
    if (dx || dz) {
      rig.targetX += dx * sp;
      rig.targetZ += dz * sp;
      rig.clamp();
    }
  }

  jumpTo(x: number, z: number) {
    this.renderer.rig.lookAt(x, z + 1.5);
  }

  // =================================================================== input
  private on<K extends keyof WindowEventMap>(t: EventTarget, name: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(name, fn as EventListener, opts);
    this.listeners.push([t, name, fn as EventListener, opts]);
  }

  private bindInput() {
    const cv = this.overlay;
    this.on(window, 'resize', () => this.resize());
    this.on(window, 'mousemove', (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseIn = true;
      if (this.midDrag) {
        const rig = this.renderer.rig;
        const k = rig.zoom / 520;
        rig.targetX = this.midDrag.tx - (e.clientX - this.midDrag.x) * k;
        rig.targetZ = this.midDrag.tz - (e.clientY - this.midDrag.y) * k * 1.25;
        rig.clamp();
      }
      if (this.dragStart && !this.dragging) {
        if (Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 6) this.dragging = true;
      }
    });
    this.on(document, 'mouseleave', () => (this.mouseIn = false));
    this.on(document, 'mouseenter', () => (this.mouseIn = true));
    this.on(cv, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    this.on(cv, 'mousedown', (e: MouseEvent) => {
      audio.unlock();
      const r = cv.getBoundingClientRect();
      const lx = e.clientX - r.left, ly = e.clientY - r.top;
      if (e.button === 1) {
        e.preventDefault();
        this.midDrag = { x: e.clientX, y: e.clientY, tx: this.renderer.rig.targetX, tz: this.renderer.rig.targetZ };
        return;
      }
      if (this.cinematic) return;
      const rightLike = e.button === 2 || (e.button === 0 && e.ctrlKey && !e.metaKey && navigator.platform.toUpperCase().includes('MAC'));
      if (rightLike) {
        this.onRightClick(lx, ly, e);
        return;
      }
      if (e.button === 0) {
        this.dragStart = { x: lx, y: ly };
        this.dragging = false;
      }
    });
    this.on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 1) {
        this.midDrag = null;
        return;
      }
      if (e.button !== 0 || !this.dragStart) return;
      const r = cv.getBoundingClientRect();
      const lx = e.clientX - r.left, ly = e.clientY - r.top;
      if (this.dragging && this.mode === 'place' && this.placing && BUILDINGS[this.placing]?.wall) this.placeWallLine(this.dragStart.x, this.dragStart.y, lx, ly);
      else if (this.dragging && this.mode === 'normal') this.boxSelect(this.dragStart.x, this.dragStart.y, lx, ly, e.shiftKey);
      else this.onLeftClick(lx, ly, e);
      this.dragStart = null;
      this.dragging = false;
    });
    this.on(
      cv,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rig = this.renderer.rig;
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        if (e.ctrlKey) {
          // pinch-to-zoom (trackpad) / ctrl+wheel
          rig.zoom *= 1 + Math.max(-0.2, Math.min(0.2, d * 0.01));
        } else if (this.trackpadMode && e.deltaMode === 0) {
          // two-finger scroll pans the map in both axes
          const k = rig.zoom * 0.0022 * this.scrollSpeed;
          rig.targetX += e.deltaX * k;
          rig.targetZ += e.deltaY * k * 1.2;
        } else {
          rig.zoom *= 1 + Math.sign(d) * Math.min(0.12, Math.abs(d) * 0.0012);
        }
        rig.clamp();
      },
      { passive: false },
    );
    this.on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    this.on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    this.on(window, 'blur', () => this.keys.clear());
  }

  resize() {
    this.renderer.resize();
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.overlay.width = this.viewport.clientWidth * dpr;
    this.overlay.height = this.viewport.clientHeight * dpr;
    this.overlay.style.width = this.viewport.clientWidth + 'px';
    this.overlay.style.height = this.viewport.clientHeight + 'px';
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (down) this.keys.add(e.key);
    else {
      this.keys.delete(e.key);
      return;
    }
    audio.unlock();
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.mode !== 'normal') this.setMode('normal');
      else this.setPaused(!this.paused);
      return;
    }
    if (this.cinematic) return;
    if (e.key === 'F10' || k === 'p') {
      this.setPaused(!this.paused);
      e.preventDefault();
      return;
    }
    if (this.paused) return;
    if (/^[0-9]$/.test(e.key)) {
      const n = Number(e.key);
      e.preventDefault();
      if (mod) {
        this.groups.set(n, this.selection.filter((s) => s.owner === this.me && s.kind === 'unit').map((s) => s.id));
        this.hooks.onMessage?.(`Group ${n} assigned.`, '#cfe3ff');
      } else if (e.shiftKey) {
        const ids = this.groups.get(n) ?? [];
        const add = this.world.units.filter((u) => ids.includes(u.id));
        this.select([...new Set([...this.selection, ...add])]);
      } else {
        const ids = this.groups.get(n) ?? [];
        const units = this.world.units.filter((u) => ids.includes(u.id) && !u.dead);
        if (units.length) {
          const now = performance.now();
          if (this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400) {
            const c = centroid(units);
            this.jumpTo(c.x, c.z);
          }
          this.lastGroupTap = { n, t: now };
          this.select(units);
          this.ack(units, 'select');
        }
      }
      return;
    }
    const myUnits = this.selection.filter((s): s is Unit => s.kind === 'unit' && s.owner === this.me);
    switch (k) {
      case 'a':
        if (myUnits.some((u) => u.weapons.length)) this.setMode('attackMove');
        break;
      case 's':
        for (const u of myUnits) u.issue({ type: 'idle' }, this.world);
        break;
      case 'g': {
        // toggle hold-ground stance
        const on = !myUnits.every((u) => u.holdGround);
        for (const u of myUnits) {
          u.holdGround = on;
          u.holdFire = false;
          u.issue({ type: 'idle' }, this.world);
        }
        if (myUnits.length) this.hooks.onMessage?.(on ? 'Stance: hold ground.' : 'Stance: aggressive.', '#cfe3ff');
        break;
      }
      case 'f': {
        const on = !myUnits.every((u) => u.holdFire);
        for (const u of myUnits) {
          u.holdFire = on;
          if (on) u.target = null;
        }
        if (myUnits.length) this.hooks.onMessage?.(on ? 'Stance: hold fire.' : 'Weapons free.', '#cfe3ff');
        break;
      }
      case 'd': {
        const mcvs = myUnits.filter((u) => u.def.mcv);
        for (const u of mcvs) u.issue({ type: 'deploy' }, this.world);
        break;
      }
      case 'x': {
        // scatter
        for (const u of myUnits) {
          const a = Math.random() * Math.PI * 2;
          u.issue({ type: 'move', x: u.x + Math.cos(a) * 2.5, z: u.z + Math.sin(a) * 2.5 }, this.world);
        }
        break;
      }
      case 'h': {
        const yard = this.world.buildings.find((b) => b.owner === this.me && b.def.produces === 'yard') ?? this.world.buildings.find((b) => b.owner === this.me);
        if (yard) this.jumpTo(yard.x, yard.z);
        break;
      }
      case ' ': {
        e.preventDefault();
        const p = this.me.lastAlertPos;
        if (p) this.jumpTo(p.x, p.z);
        break;
      }
      case 'q': {
        // select all combat units on screen
        const units = this.world.units.filter((u) => u.owner === this.me && u.weapons.length > 0 && this.onScreen(u));
        this.select(units);
        this.ack(units, 'select');
        break;
      }
      case 'e': {
        const units = this.world.units.filter((u) => u.owner === this.me && u.weapons.length > 0);
        this.select(units);
        this.ack(units, 'select');
        break;
      }
      case 'z':
        this.setMode(this.mode === 'sell' ? 'normal' : 'sell');
        break;
      case 'r':
        this.setMode(this.mode === 'repair' ? 'normal' : 'repair');
        break;
      case '=':
      case '+':
        this.speed = Math.min(2, this.speed + 0.25);
        this.hooks.onMessage?.(`Game speed ${Math.round(this.speed * 100)}%`, '#cfe3ff');
        break;
      case '-':
        this.speed = Math.max(0.5, this.speed - 0.25);
        this.hooks.onMessage?.(`Game speed ${Math.round(this.speed * 100)}%`, '#cfe3ff');
        break;
    }
  }

  setMode(m: Mode) {
    this.mode = m;
    if (m !== 'place') this.placing = null;
    if (m !== 'superweapon') this.superweaponId = null;
    this.updateCursor();
  }

  beginPlacement(defId: string) {
    this.placing = defId;
    this.mode = 'place';
    this.updateCursor();
  }

  beginSuperweapon(id: string) {
    this.superweaponId = id;
    this.mode = 'superweapon';
    this.updateCursor();
  }

  // ---------------------------------------------------------------- picking
  private ndc(lx: number, ly: number) {
    return { x: (lx / this.overlay.clientWidth) * 2 - 1, y: -(ly / this.overlay.clientHeight) * 2 + 1 };
  }

  groundAt(lx: number, ly: number) {
    const n = this.ndc(lx, ly);
    return this.renderer.pickGround(n.x, n.y);
  }

  private scr = { x: 0, y: 0, vis: false };
  entityAt(lx: number, ly: number): Entity | null {
    const w = this.world;
    let best: Entity | null = null;
    let bd = Infinity;
    const rig = this.renderer.rig;
    const pxPerUnit = this.overlay.clientHeight / (rig.zoom * 0.62);
    for (const u of w.units) {
      if (!w.visibleTo(u, this.me)) continue;
      const hy = w.map.heightAt(u.x, u.z) + (u.def.flying ? u.alt : 0) + (u.isInfantry ? 0.22 : 0.3);
      this.renderer.project(u.x, hy, u.z, this.scr);
      if (!this.scr.vis) continue;
      const r = Math.max(10, (u.radius + 0.12) * pxPerUnit);
      const d = Math.hypot(this.scr.x - lx, this.scr.y - ly);
      if (d < r && d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best) return best;
    const g = this.groundAt(lx, ly);
    if (!g) return null;
    // buildings: check footprint (also slightly above for tall buildings: use screen-space check of centre)
    for (const b of w.buildings) {
      if (!w.visibleTo(b, this.me)) continue;
      if (g.x >= b.tx && g.x < b.tx + b.w && g.z >= b.tz - 0.6 && g.z < b.tz + b.h) return b;
    }
    return null;
  }

  onScreen(e: Entity) {
    this.renderer.project(e.x, 0.3, e.z, this.scr);
    return this.scr.vis && this.scr.x >= 0 && this.scr.y >= 0 && this.scr.x <= this.overlay.clientWidth && this.scr.y <= this.overlay.clientHeight;
  }

  private updateHover() {
    if (!this.mouseIn || this.dragging) {
      this.hoverEntity = null;
      return;
    }
    const r = this.overlay.getBoundingClientRect();
    const lx = this.mouseX - r.left, ly = this.mouseY - r.top;
    if (lx < 0 || ly < 0 || lx > r.width || ly > r.height) {
      this.hoverEntity = null;
      this.hoverGround = null;
      this.overlay.style.cursor = 'default';
      return;
    }
    this.hoverEntity = this.entityAt(lx, ly);
    this.hoverGround = this.groundAt(lx, ly);
    this.updateCursor();
  }

  private cursorName = '';
  updateCursor() {
    let c = 'default';
    const h = this.hoverEntity;
    const myUnits = this.selection.filter((s): s is Unit => s.kind === 'unit' && s.owner === this.me);
    switch (this.mode) {
      case 'place':
        c = 'place';
        break;
      case 'sell':
        c = h && h.kind === 'building' && h.owner === this.me ? 'sell' : 'nosell';
        break;
      case 'repair':
        c = h && h.kind === 'building' && h.owner === this.me && h.hp < h.maxHp ? 'repair' : 'norepair';
        break;
      case 'attackMove':
        c = 'attack';
        break;
      case 'superweapon':
        c = 'target';
        break;
      default:
        if (myUnits.length) {
          if (h && h.owner.isEnemyOf(this.me) && myUnits.some((u) => u.weapons.length)) c = 'attack';
          else if (h && h.kind === 'building' && myUnits.some((u) => u.def.engineer) && (h.owner !== this.me ? true : h.hp < h.maxHp)) c = 'enter';
          else if (h && h.kind === 'building' && h.owner === this.me && (h as Building).def.refinery && myUnits.some((u) => u.def.harvester)) c = 'enter';
          else if (h && h.owner === this.me) c = 'select';
          else if (this.hoverGround && myUnits.some((u) => u.def.harvester) && this.oreAt(this.hoverGround.x, this.hoverGround.z)) c = 'harvest';
          else if (this.hoverGround && !this.canWalk(this.hoverGround.x, this.hoverGround.z) && !myUnits.every((u) => u.def.flying)) c = 'nomove';
          else c = 'move';
        } else if (h) c = 'select';
    }
    if (c !== this.cursorName) {
      this.cursorName = c;
      this.overlay.style.cursor = CURSORS[c] ?? 'default';
    }
  }

  private oreAt(x: number, z: number) {
    const m = this.world.map;
    const tx = Math.floor(x), tz = Math.floor(z);
    return m.inBounds(tx, tz) && m.oreType[tz * m.w + tx] > 0;
  }
  private canWalk(x: number, z: number) {
    const m = this.world.map;
    const fog = this.world.fogs.get(this.me);
    if (fog && !fog.isExplored(x, z)) return true;
    return m.passable(Math.floor(x), Math.floor(z)) || !!this.world.padAt(Math.floor(x), Math.floor(z));
  }

  // ---------------------------------------------------------------- selection
  select(list: Entity[]) {
    for (const e of this.selection) e.selected = false;
    this.selection = list.filter((e) => !e.dead);
    for (const e of this.selection) e.selected = true;
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const res: Unit[] = [];
    for (const u of this.world.units) {
      if (u.owner !== this.me) continue;
      const hy = this.world.map.heightAt(u.x, u.z) + (u.def.flying ? u.alt : 0) + 0.2;
      this.renderer.project(u.x, hy, u.z, this.scr);
      if (!this.scr.vis) continue;
      if (this.scr.x >= minX && this.scr.x <= maxX && this.scr.y >= minY && this.scr.y <= maxY) res.push(u);
    }
    // prefer combat units over harvesters when mixed
    let list: Unit[] = res;
    const combat = res.filter((u) => !u.def.harvester && !u.def.mcv && !u.def.engineer);
    if (combat.length > 0) list = combat;
    if (add) this.select([...new Set([...this.selection, ...list])]);
    else this.select(list);
    if (list.length) {
      audio.play('select', { volume: 0.5 });
      this.ack(list, 'select');
    }
  }

  private onLeftClick(lx: number, ly: number, e: MouseEvent) {
    const g = this.groundAt(lx, ly);
    const h = this.entityAt(lx, ly);
    switch (this.mode) {
      case 'place': {
        if (!g || !this.placing) return;
        const def = BUILDINGS[this.placing];
        const tx = Math.floor(g.x - def.footprint[0] / 2 + 0.5), tz = Math.floor(g.z - def.footprint[1] / 2 + 0.5);
        const b = this.world.placeBuilding(this.me, this.placing, tx, tz);
        if (b) {
          // walls: keep placing if more ready? we just exit
          this.setMode('normal');
        } else {
          audio.play('error');
          this.hooks.onMessage?.('Cannot place building here.', '#ff8a6a');
        }
        return;
      }
      case 'sell':
        if (h && h.kind === 'building' && h.owner === this.me) this.world.sell(h as Building);
        else audio.play('error');
        if (!e.shiftKey) this.setMode('normal');
        return;
      case 'repair':
        if (h && h.kind === 'building' && h.owner === this.me) {
          this.world.toggleRepair(h as Building);
          audio.play('repair');
        } else audio.play('error');
        if (!e.shiftKey) this.setMode('normal');
        return;
      case 'attackMove':
        if (g) this.commandAttackMove(g.x, g.z, e.shiftKey);
        this.setMode('normal');
        return;
      case 'superweapon':
        if (g && this.superweaponId) {
          if (this.world.launchSuperweapon(this.me, this.superweaponId, g.x, g.z)) this.setMode('normal');
        }
        return;
    }
    // normal selection
    if (h) {
      const now = performance.now();
      const dbl = now - this.lastClick.t < 350 && this.lastClick.id === h.id;
      this.lastClick = { t: now, id: h.id };
      if (h.owner === this.me && h.kind === 'unit') {
        const u = h as Unit;
        if (dbl && u.def.mcv) {
          u.issue({ type: 'deploy' }, this.world);
          return;
        }
        if (dbl) {
          const same = this.world.units.filter((o) => o.owner === this.me && o.def.id === u.def.id && this.onScreen(o));
          this.select(same);
        } else if (e.shiftKey) {
          if (this.selection.includes(h)) this.select(this.selection.filter((s) => s !== h));
          else this.select([...this.selection, h]);
        } else this.select([h]);
        audio.play('select', { volume: 0.5 });
        this.ack(this.selection.filter((s): s is Unit => s.kind === 'unit'), 'select');
        return;
      }
      // buildings or enemies: single select
      this.select([h]);
      audio.play('click', { volume: 0.4 });
      if (h.kind === 'building' && h.owner === this.me) {
        const b = h as Building;
        if (b.def.produces && b.def.produces !== 'yard') {
          this.world.primary.set(this.me.index + ':' + b.def.produces, b.id);
        }
      }
      return;
    }
    if (!e.shiftKey) this.select([]);
  }

  private onRightClick(lx: number, ly: number, e: MouseEvent) {
    if (this.mode !== 'normal') {
      this.setMode('normal');
      audio.play('cancel', { volume: 0.5 });
      return;
    }
    const g = this.groundAt(lx, ly);
    const h = this.entityAt(lx, ly);
    const sel = this.selection.filter((s) => s.owner === this.me);
    const units = sel.filter((s): s is Unit => s.kind === 'unit');
    // producer building selected: set rally point
    if (units.length === 0) {
      const b = sel.find((s): s is Building => s.kind === 'building' && !!(s as Building).def.produces && (s as Building).def.produces !== 'yard');
      if (b && g) {
        b.rallyX = g.x;
        b.rallyZ = g.z;
        this.addMarker(g.x, g.z, '#6fd0ff');
        audio.play('click', { volume: 0.4 });
      }
      return;
    }
    const force = e.altKey;
    if (h && (h.owner.isEnemyOf(this.me) || (force && h !== units[0]))) {
      const attackers = units.filter((u) => u.weapons.length > 0);
      const engineers = units.filter((u) => u.def.engineer);
      if (h.kind === 'building') for (const u of engineers) u.issue({ type: 'enter', target: h as Building }, this.world);
      for (const u of attackers) u.issue({ type: 'attack', target: h, force }, this.world);
      const others = units.filter((u) => u.weapons.length === 0 && !u.def.engineer);
      if (others.length && g) this.formationMove(others, g.x, g.z, false, e.shiftKey);
      this.addMarker(h.x, h.z, '#ff4a3a');
      this.ack(attackers.length ? attackers : units, 'attack');
      return;
    }
    if (h && h.kind === 'building') {
      const b = h as Building;
      const engineers = units.filter((u) => u.def.engineer && (b.owner !== this.me || b.hp < b.maxHp));
      const harvs = units.filter((u) => u.def.harvester && b.def.refinery && b.owner === this.me);
      const toPad = b.def.repairPad && b.owner === this.me ? units.filter((u) => u.def.category === 'vehicle' && !u.def.flying) : [];
      if (engineers.length || harvs.length || toPad.length) {
        for (const u of engineers) u.issue({ type: 'enter', target: b }, this.world);
        for (const u of harvs) u.issue({ type: 'enter', target: b }, this.world);
        toPad.forEach((u, i) => u.issue({ type: 'move', x: b.x + ((i % 3) - 1) * 0.9, z: b.z + (Math.floor(i / 3) - 1) * 0.9 }, this.world));
        const rest = units.filter((u) => !engineers.includes(u) && !harvs.includes(u) && !toPad.includes(u));
        if (rest.length && g) this.formationMove(rest, g.x, g.z, false, e.shiftKey);
        this.addMarker(b.x, b.z, '#ffd24a');
        this.ack(units, 'move');
        return;
      }
      // airfield: aircraft return to rearm
      if (b.def.produces === 'airfield' && b.owner === this.me) {
        const air = units.filter((u) => u.def.flying);
        for (const u of air) u.issue({ type: 'returnToBase' }, this.world);
      }
    }
    if (!g) return;
    // harvesters on ore
    const harvs = units.filter((u) => u.def.harvester);
    if (harvs.length && this.oreAt(g.x, g.z)) {
      for (const u of harvs) u.issue({ type: 'harvest', x: g.x, z: g.z }, this.world);
      const rest = units.filter((u) => !u.def.harvester);
      if (rest.length) this.formationMove(rest, g.x, g.z, false, e.shiftKey);
      this.addMarker(g.x, g.z, '#4dff9a');
      this.ack(units, 'move');
      return;
    }
    if (force) {
      for (const u of units) {
        if (u.weapons.some((w) => w.def.targetsGround)) u.issue({ type: 'attackGround', x: g.x, z: g.z }, this.world);
      }
      this.addMarker(g.x, g.z, '#ff4a3a');
      return;
    }
    this.formationMove(units, g.x, g.z, false, e.shiftKey);
    this.addMarker(g.x, g.z, '#4dff6a');
    audio.play('click', { volume: 0.3 });
    this.ack(units, 'move');
  }

  /** Drag-place a line of wall segments; extra segments cost their price immediately. */
  private placeWallLine(x0: number, y0: number, x1: number, y1: number) {
    const a = this.groundAt(x0, y0), b = this.groundAt(x1, y1);
    if (!a || !b || !this.placing) return;
    const id = this.placing;
    const def = BUILDINGS[id];
    const tx0 = Math.floor(a.x), tz0 = Math.floor(a.z);
    const tx1 = Math.floor(b.x), tz1 = Math.floor(b.z);
    const tiles: [number, number][] = [];
    if (Math.abs(tx1 - tx0) >= Math.abs(tz1 - tz0)) {
      const st = Math.sign(tx1 - tx0) || 1;
      for (let x = tx0; x !== tx1 + st; x += st) tiles.push([x, tz0]);
    } else {
      const st = Math.sign(tz1 - tz0) || 1;
      for (let z = tz0; z !== tz1 + st; z += st) tiles.push([tx0, z]);
    }
    let placed = 0;
    for (const [x, z] of tiles.slice(0, 24)) {
      if (placed === 0) {
        if (this.world.placeBuilding(this.me, id, x, z)) placed++;
        continue;
      }
      if (this.me.credits < def.cost) break;
      if (!this.world.canPlace(this.me, id, x, z)) continue;
      this.me.credits -= def.cost;
      this.me.stats.creditsSpent += def.cost;
      this.world.addBuilding(this.me, id, x, z, false);
      placed++;
    }
    if (placed) this.setMode('normal');
    else audio.play('error');
  }

  commandAttackMove(x: number, z: number, queue: boolean) {
    const units = this.selection.filter((s): s is Unit => s.kind === 'unit' && s.owner === this.me);
    this.formationMove(units, x, z, true, queue);
    this.addMarker(x, z, '#ff8a3a');
    this.ack(units, 'attack');
  }

  /** Move a group keeping a compact formation around the target. */
  formationMove(units: Unit[], x: number, z: number, attackMove: boolean, queue = false) {
    if (units.length === 0) return;
    if (queue) {
      for (const u of units) {
        if (u.order.type === 'move') {
          (u.order.queue ??= []).push({ x, z });
        } else u.issue({ type: 'move', x, z, attackMove }, this.world);
      }
      return;
    }
    if (units.length === 1) {
      units[0].issue({ type: 'move', x, z, attackMove }, this.world);
      return;
    }
    const c = centroid(units);
    const ang = Math.atan2(z - c.z, x - c.x);
    // slots: rows perpendicular to movement direction
    const n = units.length;
    const avgR = units.reduce((s, u) => s + u.radius, 0) / n;
    const spacing = Math.max(0.55, avgR * 2.3);
    const cols = Math.ceil(Math.sqrt(n * 1.5));
    const slots: { x: number; z: number }[] = [];
    const fx = Math.cos(ang), fz = Math.sin(ang);
    const sx = -fz, sz = fx;
    const map = this.world.map;
    let i = 0;
    for (let row = 0; slots.length < n && row < 50; row++) {
      for (let col = 0; col < cols && slots.length < n; col++, i++) {
        const off = (col - (cols - 1) / 2) * spacing;
        const back = row * spacing;
        const px = x + sx * off - fx * back, pz = z + sz * off - fz * back;
        const ok = units.every((u) => u.def.flying) || map.passable(Math.floor(px), Math.floor(pz));
        if (ok) slots.push({ x: px, z: pz });
      }
    }
    while (slots.length < n) slots.push({ x, z });
    // assign: units sorted by lateral position → slots sorted similarly (keeps paths from crossing)
    const byLat = (p: { x: number; z: number }) => (p.x - c.x) * sx + (p.z - c.z) * sz;
    const us = [...units].sort((a, b) => byLat(a) - byLat(b));
    // group slots by row, but simple approach: sort slots by lateral, then per unit pick nearest free
    const free = slots.slice();
    for (const u of us) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < free.length; k++) {
        const d = (free[k].x - u.x - (x - c.x)) ** 2 + (free[k].z - u.z - (z - c.z)) ** 2;
        if (d < bd) {
          bd = d;
          bi = k;
        }
      }
      const s = free.splice(bi, 1)[0];
      u.issue({ type: 'move', x: s.x, z: s.z, attackMove }, this.world);
    }
    // a compact group travels together at the pace of its slowest member
    const compact = units.every((u) => Math.hypot(u.x - c.x, u.z - c.z) < 7);
    if (compact && units.length > 1 && !units.some((u) => u.def.flying)) {
      const slowest = Math.min(...units.map((u) => u.def.speed));
      for (const u of units) u.speedCap = slowest;
    }
  }

  private addMarker(x: number, z: number, color: string) {
    this.markers.push({ x, z, t: 0, color });
  }

  // ---------------------------------------------------------------- placement ghost
  private updateGhost() {
    const scene = this.renderer.scene;
    if (this.mode !== 'place' || !this.placing || !this.hoverGround) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const def = BUILDINGS[this.placing];
    if (this.ghostDef !== this.placing) {
      if (this.ghost) scene.remove(this.ghost);
      this.ghost = new THREE.Group();
      const m = models.building(def.id, new THREE.Color(this.me.color));
      m.update?.(0.016, { time: 0, moving: false, speed: 0, firing: 0, health: 1, powered: true, producing: false, harvesting: false, build: 1 });
      if (ghost) ghost(m.root, true);
      else
        m.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const conv = (mat: THREE.Material) => {
            const c = mat.clone();
            c.transparent = true;
            c.opacity = 0.6;
            c.depthWrite = false;
            return c;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
          mesh.castShadow = false;
        });
      this.ghost.add(m.root);
      this.ghostTiles = [];
      const tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
      for (let i = 0; i < def.footprint[0] * def.footprint[1]; i++) {
        const t = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.22, depthWrite: false }));
        t.renderOrder = 4;
        this.ghostTiles.push(t);
        this.ghost.add(t);
      }
      scene.add(this.ghost);
      this.ghostDef = this.placing;
      this.ghostOk = true;
    }
    const g = this.ghost!;
    g.visible = true;
    const [fw, fh] = def.footprint;
    const tx = Math.floor(this.hoverGround.x - fw / 2 + 0.5), tz = Math.floor(this.hoverGround.z - fh / 2 + 0.5);
    const map = this.world.map;
    const root = g.children[0];
    root.position.set(tx + fw / 2, map.heightAt(tx + fw / 2, tz + fh / 2), tz + fh / 2);
    const ok = this.world.canPlace(this.me, def.id, tx, tz);
    if (ghost && ok !== this.ghostOk) {
      this.ghostOk = ok;
      ghost(root, ok);
    }
    let k = 0;
    for (let z = 0; z < fh; z++)
      for (let x = 0; x < fw; x++) {
        const t = this.ghostTiles[k++];
        const cx = tx + x, cz = tz + z;
        t.position.set(cx + 0.5, map.heightAt(cx + 0.5, cz + 0.5) + 0.03, cz + 0.5);
        const tileOk = map.buildable(cx, cz) && !this.world.padAt(cx, cz) && !this.world.isReserved(cx, cz);
        (t.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x40ff60 : tileOk ? 0xffc040 : 0xff3030);
      }
    void registerWorldMaterial;
  }

  // ---------------------------------------------------------------- overlay (health bars, box)
  private drawOverlay(dt: number) {
    const ctx = this.octx;
    const W = this.overlay.clientWidth, H = this.overlay.clientHeight;
    ctx.clearRect(0, 0, W, H);
    const w = this.world;
    const tmp = new THREE.Vector3();
    const views = this.renderer.views;
    const draw = (e: Entity, selected: boolean) => {
      if (!views) return;
      views.topOf(e, tmp);
      if (e.kind === 'building') {
        const b = e as Building;
        // bracket box around footprint
        const pts = [
          [b.tx, tmp.y, b.tz], [b.tx + b.w, tmp.y, b.tz], [b.tx, tmp.y, b.tz + b.h], [b.tx + b.w, tmp.y, b.tz + b.h],
          [b.tx, tmp.y - (tmp.y - w.map.heightAt(b.x, b.z)), b.tz + b.h], [b.tx + b.w, w.map.heightAt(b.x, b.z), b.tz + b.h],
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.renderer.project(b.x, tmp.y, b.z, this.scr);
        if (!this.scr.vis) return;
        for (const p of pts) {
          this.renderer.project(p[0], p[1], p[2], this.scr);
          minX = Math.min(minX, this.scr.x);
          maxX = Math.max(maxX, this.scr.x);
          minY = Math.min(minY, this.scr.y);
          maxY = Math.max(maxY, this.scr.y);
        }
        if (selected) drawBrackets(ctx, minX, minY, maxX, maxY, e.owner === this.me ? '#ffffff' : '#ff8080');
        drawHealth(ctx, (minX + maxX) / 2, minY - 8, Math.max(40, (maxX - minX) * 0.8), e.hp / e.maxHp, true);
        if (b.repairing) drawIcon(ctx, (minX + maxX) / 2, minY - 22, 'wrench', w.time);
        if (b.owner === this.me && b.def.produces && b.def.produces !== 'yard' && selected) {
          // rally line
          this.renderer.project(b.x, w.map.heightAt(b.x, b.z) + 0.1, b.z, this.scr);
          const ax = this.scr.x, ay = this.scr.y;
          this.renderer.project(b.rallyX, w.map.heightAt(b.rallyX, b.rallyZ) + 0.05, b.rallyZ, this.scr);
          ctx.strokeStyle = 'rgba(110,208,255,0.7)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(this.scr.x, this.scr.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#6fd0ff';
          ctx.beginPath();
          ctx.moveTo(this.scr.x, this.scr.y);
          ctx.lineTo(this.scr.x, this.scr.y - 16);
          ctx.lineTo(this.scr.x + 10, this.scr.y - 12);
          ctx.lineTo(this.scr.x, this.scr.y - 8);
          ctx.fill();
        }
        if (b.def.id === 'n_derrick' && b.owner.isNeutral && selected) {
          ctx.fillStyle = '#ffd76a';
          ctx.font = '600 12px ' + uiFontFamily();
          ctx.textAlign = 'center';
          ctx.fillText('CAPTURE WITH ENGINEER', (minX + maxX) / 2, maxY + 14);
        }
        return;
      }
      const u = e as Unit;
      this.renderer.project(tmp.x, tmp.y, tmp.z, this.scr);
      if (!this.scr.vis) return;
      const pxPerUnit = H / (this.renderer.rig.zoom * 0.62);
      const bw = Math.max(18, u.radius * 2.2 * pxPerUnit);
      const x = this.scr.x, y = this.scr.y - 6;
      drawHealth(ctx, x, y, bw, u.hp / u.maxHp, selected);
      if (u.rank > 0) drawChevrons(ctx, x + bw / 2 + 5, y + 2, u.rank);
      if (u.def.harvester && (selected || this.hoverEntity === u)) {
        const r = u.cargoRatio();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - bw / 2, y + 5, bw, 3);
        ctx.fillStyle = '#35f0b8';
        ctx.fillRect(x - bw / 2, y + 5, bw * r, 3);
      }
      if (selected && u.owner === this.me) {
        for (const [n, ids] of this.groups) {
          if (ids.includes(u.id)) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 10px ' + uiFontFamily();
            ctx.textAlign = 'left';
            ctx.fillText(String(n), x - bw / 2 - 9, y + 4);
            break;
          }
        }
      }
      // target line for selected own units
      if (selected && u.owner === this.me && this.keys.has('Shift')) {
        let tx: number | null = null, tz = 0, col = '#4dff6a';
        if (u.order.type === 'move') {
          tx = u.order.x;
          tz = u.order.z;
          if (u.order.attackMove) col = '#ff8a3a';
        } else if (u.order.type === 'attack') {
          tx = u.order.target.x;
          tz = u.order.target.z;
          col = '#ff4a3a';
        }
        if (tx !== null) {
          const ax = x, ay = this.scr.y + 8;
          this.renderer.project(tx, w.map.heightAt(tx, tz), tz, this.scr);
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(this.scr.x, this.scr.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    };
    for (const e of this.selection) draw(e, true);
    const h = this.hoverEntity;
    if (h && !h.selected) draw(h, false);
    // recently damaged enemies / own units (brief bars)
    for (const u of w.units) {
      if (u.selected || u === h) continue;
      if (w.time - u.lastHitTime < 1.5 && w.visibleTo(u, this.me) && u.hp < u.maxHp) draw(u, false);
    }
    for (const b of w.buildings) {
      if (b.selected || b === h) continue;
      if (b.owner === this.me && (b.repairing || w.time - b.lastHitTime < 2)) draw(b, false);
    }
    // objective beacons
    for (const b of this.beacons) {
      if (b.entity) {
        if (b.entity.dead) continue;
        b.x = b.entity.x;
        b.z = b.entity.z;
      }
      const gy = w.map.heightAt(b.x, b.z);
      this.renderer.project(b.x, gy + 1.6, b.z, this.scr);
      const off = !this.scr.vis || this.scr.x < 20 || this.scr.y < 40 || this.scr.x > W - 20 || this.scr.y > H - 20;
      if (off) {
        // edge arrow pointing at the off-screen objective
        const rig = this.renderer.rig;
        const ang = Math.atan2(b.z - rig.targetZ, b.x - rig.targetX);
        const cx = W / 2, cy = H / 2;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const t = Math.min((W / 2 - 34) / Math.max(0.001, Math.abs(dx)), (H / 2 - 44) / Math.max(0.001, Math.abs(dy)));
        const ax = cx + dx * t, ay = cy + dy * t;
        const col = b.color ?? '#ffd24a';
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.75 + Math.sin(w.time * 5) * 0.25;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-6, -9);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-6, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (b.label) {
          const dist = Math.round(Math.hypot(b.x - rig.targetX, b.z - rig.targetZ));
          ctx.font = '700 12px ' + uiFontFamily();
          ctx.textAlign = 'center';
          ctx.fillStyle = '#000';
          ctx.fillText(`${b.label} ${dist}m`, ax - dx * 26 + 1, ay - dy * 22 + 5);
          ctx.fillStyle = col;
          ctx.fillText(`${b.label} ${dist}m`, ax - dx * 26, ay - dy * 22 + 4);
        }
        continue;
      }
      const pulse = (w.time * 1.2) % 1;
      const col = b.color ?? '#ffd24a';
      const bx = this.scr.x, by = this.scr.y + Math.sin(w.time * 3) * 3;
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(bx, by + 12);
      ctx.lineTo(bx - 8, by);
      ctx.lineTo(bx, by - 12);
      ctx.lineTo(bx + 8, by);
      ctx.closePath();
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.restore();
      this.renderer.project(b.x, gy + 0.05, b.z, this.scr);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 1 - pulse;
      ctx.lineWidth = 2;
      const r = 10 + pulse * 30;
      ctx.beginPath();
      ctx.ellipse(this.scr.x, this.scr.y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (b.label) {
        ctx.font = '700 12px ' + uiFontFamily();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText(b.label, bx + 1, by - 17);
        ctx.fillStyle = col;
        ctx.fillText(b.label, bx, by - 18);
      }
    }
    // markers
    for (const m of this.markers) {
      m.t += dt;
      const k = m.t / 0.6;
      if (k >= 1) continue;
      this.renderer.project(m.x, w.map.heightAt(m.x, m.z) + 0.05, m.z, this.scr);
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      const r = 14 * (1 - k) + 3;
      ctx.beginPath();
      ctx.ellipse(this.scr.x, this.scr.y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.markers = this.markers.filter((m) => m.t < 0.6);
    // selection box
    if (this.dragging && this.dragStart) {
      const r = this.overlay.getBoundingClientRect();
      const x1 = this.mouseX - r.left, y1 = this.mouseY - r.top;
      ctx.strokeStyle = 'rgba(120,255,140,0.95)';
      ctx.fillStyle = 'rgba(80,255,120,0.08)';
      ctx.lineWidth = 1;
      const x = Math.min(this.dragStart.x, x1), y = Math.min(this.dragStart.y, y1);
      ctx.fillRect(x, y, Math.abs(x1 - this.dragStart.x), Math.abs(y1 - this.dragStart.y));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(x1 - this.dragStart.x), Math.abs(y1 - this.dragStart.y));
    }
    // superweapon target preview
    if (this.mode === 'superweapon' && this.hoverGround) {
      this.renderer.project(this.hoverGround.x, this.hoverGround.y, this.hoverGround.z, this.scr);
      const pxPerUnit = H / (this.renderer.rig.zoom * 0.62);
      ctx.strokeStyle = 'rgba(255,80,60,0.9)';
      ctx.lineWidth = 2;
      const swDef = SUPERWEAPONS[this.superweaponId as keyof typeof SUPERWEAPONS];
      const r = (swDef?.radius ?? 4) * pxPerUnit;
      ctx.beginPath();
      ctx.ellipse(this.scr.x, this.scr.y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const f of this.flashMsgs) f.t -= dt;
    this.flashMsgs = this.flashMsgs.filter((f) => f.t > 0);
  }

  // ---------------------------------------------------------------- sidebar actions
  clickBuild(defId: string, shift: boolean) {
    const isB = !!BUILDINGS[defId];
    const def = isB ? BUILDINGS[defId] : UNITS[defId];
    const q = this.me.queues[def.tab];
    if (isB && q.ready === defId) {
      this.beginPlacement(defId);
      audio.play('click', { volume: 0.5 });
      return;
    }
    if (!this.me.canBuild(defId)) {
      audio.play('error');
      const missing = def.prereqs.filter((p) => !this.me.has(p)).map((p) => BUILDINGS[p]?.name ?? p);
      const building = def.prereqs.some((p) => this.world.buildings.some((b) => b.owner === this.me && b.def.id === p && b.constructing < 1));
      if (missing.length) this.hooks.onMessage?.(building ? `Waiting for ${missing.join(', ')} to finish construction.` : `Requires: ${missing.join(', ')}.`, '#ff8a6a');
      return;
    }
    if (isB && q.ready) {
      audio.play('error');
      const name = BUILDINGS[q.ready]?.name ?? 'structure';
      this.hooks.onMessage?.(`Place the ${name} first: click its READY icon, then click the ground.`, '#ff8a6a');
      return;
    }
    if (isB && q.items.length && !(q.items[0].defId === defId && q.items[0].onHold)) {
      audio.play('error');
      this.hooks.onMessage?.('Unable to comply. Building in progress.', '#ff8a6a');
      audio.speak('Unable to comply. Building in progress.', 'announcer', { faction: this.me.faction, priority: 0 });
      return;
    }
    if (this.me.enqueue(defId, this.world, shift ? 5 : 1)) audio.play('click', { volume: 0.5 });
    else audio.play('error');
  }

  rightClickBuild(defId: string) {
    this.me.dequeue(defId, this.world);
    audio.play('cancel', { volume: 0.5 });
  }

  tabItems(tab: BuildTab): string[] {
    const f = this.me.faction;
    const out: string[] = [];
    for (const b of Object.values(BUILDINGS)) if (b.tab === tab && b.faction === f && this.me.isVisibleItem(b.id)) out.push(b.id);
    for (const u of Object.values(UNITS)) if (u.tab === tab && u.faction === f && this.me.isVisibleItem(u.id)) out.push(u.id);
    return out;
  }

  get factionDef() {
    return FACTIONS[this.me.faction];
  }
}

// ======================================================================= helpers
export function centroid(list: { x: number; z: number }[]) {
  let x = 0, z = 0;
  for (const e of list) {
    x += e.x;
    z += e.z;
  }
  return { x: x / list.length, z: z / list.length };
}

function drawBrackets(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, len = 8) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  const l = Math.min(len, (x1 - x0) / 3, (y1 - y0) / 3);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + l);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + l, y0);
  ctx.moveTo(x1 - l, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + l);
  ctx.moveTo(x1, y1 - l);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - l, y1);
  ctx.moveTo(x0 + l, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - l);
  ctx.stroke();
}

function drawHealth(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, r: number, pips: boolean) {
  const h = 4;
  const x = cx - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  const col = r > 0.6 ? '#58e05a' : r > 0.3 ? '#f0c419' : '#e8452c';
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * Math.max(0, r), h);
  if (pips && w > 24) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const n = Math.floor(w / 6);
    for (let i = 1; i < n; i++) ctx.fillRect(x + (i * w) / n, y, 1, h);
  }
}

function drawChevrons(ctx: CanvasRenderingContext2D, x: number, y: number, rank: number) {
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < rank; i++) {
    const yy = y + i * 4;
    ctx.beginPath();
    ctx.moveTo(x - 3, yy);
    ctx.lineTo(x, yy + 3);
    ctx.lineTo(x + 3, yy);
    ctx.stroke();
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'wrench', t: number) {
  if (kind === 'wrench') {
    ctx.globalAlpha = 0.6 + Math.sin(t * 6) * 0.4;
    ctx.fillStyle = '#ffd24a';
    ctx.font = '700 13px ' + uiFontFamily();
    ctx.textAlign = 'center';
    ctx.fillText('🔧', x, y);
    ctx.globalAlpha = 1;
  }
}

// ---- custom SVG cursors
function svgCursor(svg: string, hx: number, hy: number, fallback: string) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}
const CURSORS: Record<string, string> = {
  default: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M2 2 L2 19 L7 14 L11 22 L14 20.5 L10 13 L17 13 Z' fill='#d8e6ff' stroke='#0a1220' stroke-width='1.5'/></svg>`, 2, 2, 'default'),
  select: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='none' stroke='#9dff9d' stroke-width='2.2'><path d='M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7'/></g><circle cx='16' cy='16' r='2' fill='#9dff9d'/></svg>`, 16, 16, 'pointer'),
  move: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g stroke='#0a1a0a' stroke-width='1'><path d='M16 3 L20 9 H12 Z M16 29 L12 23 H20 Z M3 16 L9 12 V20 Z M29 16 L23 20 V12 Z' fill='#5dff6a'/></g><circle cx='16' cy='16' r='2.5' fill='#5dff6a'/></svg>`, 16, 16, 'crosshair'),
  nomove: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='10' fill='none' stroke='#ff4a3a' stroke-width='3'/><path d='M9 9 L23 23' stroke='#ff4a3a' stroke-width='3'/></svg>`, 16, 16, 'not-allowed'),
  attack: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='none' stroke='#ff3a2a' stroke-width='2.2'><circle cx='16' cy='16' r='9'/><path d='M16 2v8M16 22v8M2 16h8M22 16h8'/></g><circle cx='16' cy='16' r='2' fill='#ff3a2a'/></svg>`, 16, 16, 'crosshair'),
  target: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='none' stroke='#ffb030' stroke-width='2'><circle cx='16' cy='16' r='12'/><circle cx='16' cy='16' r='6'/><path d='M16 0v10M16 22v10M0 16h10M22 16h10'/></g></svg>`, 16, 16, 'crosshair'),
  enter: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='#ffd24a' stroke='#201800' stroke-width='1'><path d='M16 28 L8 18 H13 V5 H19 V18 H24 Z'/></g></svg>`, 16, 28, 'pointer'),
  harvest: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='#35f0b8' stroke='#003020' stroke-width='1'><path d='M16 4 L20 14 L16 28 L12 14 Z'/><path d='M8 10 L11 16 L8 24 L5 16 Z' opacity='0.8'/><path d='M24 10 L27 16 L24 24 L21 16 Z' opacity='0.8'/></g></svg>`, 16, 16, 'pointer'),
  sell: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='12' fill='#1a3a1a' stroke='#6aff6a' stroke-width='2'/><text x='16' y='22' font-size='17' font-family='Arial' font-weight='bold' fill='#6aff6a' text-anchor='middle'>$</text></svg>`, 16, 16, 'pointer'),
  nosell: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='12' fill='#3a1a1a' stroke='#aa5555' stroke-width='2'/><text x='16' y='22' font-size='17' font-family='Arial' font-weight='bold' fill='#aa5555' text-anchor='middle'>$</text></svg>`, 16, 16, 'not-allowed'),
  repair: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='12' fill='#3a3010' stroke='#ffd24a' stroke-width='2'/><path d='M10 22 L18 14 M17 10 a4 4 0 1 0 5 5' stroke='#ffd24a' stroke-width='3' fill='none'/></svg>`, 16, 16, 'pointer'),
  norepair: svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='12' fill='#2a2a2a' stroke='#777' stroke-width='2'/><path d='M10 22 L18 14 M17 10 a4 4 0 1 0 5 5' stroke='#777' stroke-width='3' fill='none'/></svg>`, 16, 16, 'not-allowed'),
  place: 'crosshair',
};

/** Canvas can't use CSS variables: resolve the UI font family (lazily, after CSS has loaded). */
let uiFontCache = '';
function uiFontFamily() {
  if (!uiFontCache) {
    try {
      uiFontCache = getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim() || 'sans-serif';
    } catch {
      uiFontCache = 'sans-serif';
    }
  }
  return uiFontCache;
}
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
/** Rewrites mouse/PC wording in tips for Mac trackpad players. */
export function platformText(html: string, trackpad: boolean): string {
  let t = html;
  if (IS_MAC) {
    t = t.replace(/<kbd>Ctrl<\/kbd>/g, '<kbd>⌘</kbd>').replace(/\bCtrl\+/g, '⌘+').replace(/<kbd>Alt<\/kbd>/g, '<kbd>⌥ Option</kbd>');
  }
  if (trackpad) {
    t = t
      .replace(/<b>Right-click<\/b>/g, '<b>Right-click</b> (two-finger tap)')
      .replace(/screen edges or middle-mouse drag; zoom with the wheel/g, 'screen edges or a two-finger swipe; pinch to zoom')
      .replace(/middle-mouse drag/g, 'two-finger swipe')
      .replace(/zoom with the wheel/g, 'pinch to zoom');
  }
  return t;
}
