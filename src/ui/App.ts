import { audio } from '../bridge';
import { BUILDINGS } from '../data/buildings';
import { FACTIONS, TEAM_COLORS } from '../data/factions';
import type { FactionId } from '../data/types';
import { Game } from '../game/Game';
import { SKIRMISH_MAPS, generateMap } from '../game/MapGen';
import type { MissionDef, MissionHost, MissionScript } from '../game/mission/MissionScript';
import { createSkirmish, type Difficulty, type SkirmishSetup } from '../game/Scenario';
import type { Player } from '../game/Player';
import type { World } from '../game/World';
import { formatTime } from '../game/util';
import { cameo, renderCameos } from '../render/Cameos';
import { setFowEnabled } from '../render/FogOfWar';
import { Attract } from './Attract';
import { Hud } from './Hud';
import { Briefing } from './Briefing';
import { emblemSvg, logoSvg } from './logo';
import { renderTerrain } from './mapimage';
import { ICONS, escapeHtml, fullscreenSupported, hex, installTooltips, isFullscreen, lsGet, lsSet, onFullscreenChange, scrollFades, spinner, toggle, toggleFullscreen, trackpadMode, uiFont } from './widgets';

// Optional modules (filled in by other subsystems)
type AICtor = new (world: World, player: Player, difficulty: Difficulty, opts?: Record<string, unknown>) => { update(dt: number): void };
const aiMods = import.meta.glob('../game/ai/SkirmishAI.ts', { eager: true }) as Record<string, { SkirmishAI?: AICtor }>;
const SkirmishAI: AICtor | undefined = Object.values(aiMods)[0]?.SkirmishAI;
const campMods = import.meta.glob('../game/mission/campaigns.ts', { eager: true }) as Record<string, { CAMPAIGNS?: Record<FactionId, MissionDef[]> }>;
const CAMPAIGNS: Record<FactionId, MissionDef[]> = Object.values(campMods)[0]?.CAMPAIGNS ?? { aegis: [], covenant: [] };

interface Settings {
  quality: 0 | 1 | 2;
  scroll: number;
  edge: boolean;
  /** quality was chosen automatically (no explicit user choice yet) */
  qualityAuto?: boolean;
  /** the frame-time probe already ran */
  probed?: boolean;
}

const VERSION = 'v1.0';

function load<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...def, ...JSON.parse(v) } : def;
  } catch {
    return def;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Load settings; pick a graphics quality automatically when the player never chose one. */
function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem('riftfall.settings') ?? '{}') ?? {};
  } catch {
    saved = {};
  }
  const s: Settings = { quality: 2, scroll: 1, edge: true, ...saved };
  if (saved.quality === undefined) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = window.innerWidth * window.innerHeight * dpr * dpr;
    const screenPx = (screen.width || 0) * (screen.height || 0) * dpr * dpr;
    s.quality = px > 6.2e6 || screenPx > 9e6 ? 1 : 2;
    s.qualityAuto = true;
  }
  return s;
}

const TIPS = [
  'Two-finger tap (or Ctrl+click) gives orders on a MacBook trackpad.',
  'Low power slows production and shuts down advanced defences. Build power first.',
  'Engineers capture neutral Oil Derricks for a steady income.',
  'Rifles beat infantry. Rockets, cannons and flame beat armour.',
  'Press Space to jump to the latest alert, H to jump home.',
  'Double-click a unit to select every unit of that type on screen.',
  'Harvesters are your economy. Protect them and you win the long game.',
  'Units earn veterancy chevrons from kills: veterans hit harder.',
  'Press A, then click, to attack-move: your units fight anything on the way.',
  'Build a radar structure to bring the minimap online.',
];

type Ctx = { kind: 'skirmish'; setup: SkirmishSetup } | { kind: 'mission'; mission: MissionDef };

const HERO: Record<FactionId, { hero: string; roster: string[]; desc: string }> = {
  aegis: {
    hero: 'titan',
    roster: ['guardian', 'hawk', 'marksman', 'tempest'],
    desc: 'A global military coalition fighting to contain the spread of Riftite and the fanatics who worship it. Heavy armour, precision weapons, orbital power.',
  },
  covenant: {
    hero: 'prism',
    roster: ['shade', 'wraith', 'inferno', 'raider'],
    desc: "A zealous brotherhood that believes the Rift is humanity's next evolution. Speed, stealth, fire, and the fury of the Rift itself.",
  },
};

function stripOperation(codename: string) {
  return codename.replace(/^operation\s+/i, '');
}

export class App {
  root: HTMLElement;
  private screen: HTMLElement | null = null;
  private attract: Attract | null = null;
  private bgHost: HTMLElement;
  game: Game | null = null;
  hud: Hud | null = null;
  private ctx: Ctx | null = null;
  private settings: Settings = loadSettings();
  private qParam: 0 | 1 | 2 | null = (() => {
    const q = new URLSearchParams(location.search).get('q');
    return q === '0' || q === '1' || q === '2' ? (Number(q) as 0 | 1 | 2) : null;
  })();
  private progress = load('riftfall.campaign', { aegis: 1, covenant: 1 } as Record<FactionId, number>);
  private lastSkirmish: SkirmishSetup = load('riftfall.skirmish', {
    mapId: 'greenvalley',
    players: [
      { faction: 'aegis', colorIndex: 0, team: 1, human: true, difficulty: 'normal' },
      { faction: 'covenant', colorIndex: 1, team: 2, human: false, difficulty: 'normal' },
    ],
    credits: 5000,
    startUnits: 'mcv',
    shroud: true,
    gameSpeed: 1,
  } as SkirmishSetup);
  /** Esc handler for the current menu screen (menus only; the game handles its own keys). */
  private onEsc: (() => void) | null = null;
  private unsubFs: (() => void) | null = null;
  private audioReady = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.bgHost = document.createElement('div');
    this.bgHost.className = 'menu-bg';
    this.root.appendChild(this.bgHost);
    this.applySettings();
    installTooltips();
    window.addEventListener('keydown', this.onKeyCapture, true);
    // Audio must be unlocked inside a user gesture: do it on the very first click / key anywhere.
    const unlock = () => {
      audio.unlock();
      this.audioReady = true;
      document.querySelectorAll('.sound-hint').forEach((e) => e.remove());
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // Never lose a running battle to an accidental reload / tab close.
    window.addEventListener('beforeunload', (e) => {
      if (this.game && !this.game.ended) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // Stop page pinch-zoom (trackpad pinch arrives as ctrl+wheel) anywhere in the app.
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) e.preventDefault();
      },
      { passive: false },
    );
    for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
  }

  private get quality(): 0 | 1 | 2 {
    return this.qParam ?? this.settings.quality;
  }

  private applySettings() {
    try {
      localStorage.setItem('riftfall.quality', String(this.settings.quality));
      localStorage.setItem('riftfall.scroll', String(this.settings.scroll));
      localStorage.setItem('riftfall.edge', this.settings.edge ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.game) {
      this.game.renderer.setQuality(this.quality);
      this.game.scrollSpeed = this.settings.scroll;
      this.game.edgeScroll = this.settings.edge;
    }
    this.attract?.setQuality(this.quality);
  }

  private saveSettings() {
    save('riftfall.settings', this.settings);
    this.applySettings();
  }

  private onKeyCapture = (e: KeyboardEvent) => {
    const k = e.key;
    if (this.game) {
      if (this.pauseSub) {
        // a sub-screen (options / manual) is open over the pause menu
        if (k === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closePauseSub();
        } else if (k === 'p' || k === 'P' || k === 'F10') e.stopImmediatePropagation();
        return;
      }
      if (this.pauseEl && k === 'Escape' && this.pauseEl.dataset.confirm) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.renderPauseMain();
        return;
      }
      if (k === 'Escape' && this.hud?.closeOverlays()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (k === 'Escape' && this.onEsc) {
      e.preventDefault();
      const f = this.onEsc;
      f();
    }
  };

  // ================================================================= boot
  async boot() {
    // make sure the inlined UI font is decoded before any canvas text (map previews, briefing) is drawn
    try {
      void document.fonts?.load("700 16px 'Riftfall UI'");
      void document.fonts?.load("500 16px 'Riftfall UI'");
    } catch {
      /* ignore */
    }
    const loading = this.show(
      `<div class="loading">
        <div class="load-art">${logoSvg()}<div class="logo-sub">COMMAND THEATER</div></div>
        <div class="load-vs">${emblemSvg('aegis', 40)}<span>VS</span>${emblemSvg('covenant', 40)}</div>
        <div class="load-status">INITIALIZING COMMAND LINK</div>
        <div class="seg-bar">${'<i></i>'.repeat(24)}</div>
        <div class="load-tip"><b>FIELD TIP</b><span></span></div>
      </div>`,
    );
    const segs = Array.from(loading.querySelectorAll('.seg-bar i')) as HTMLElement[];
    const status = loading.querySelector('.load-status') as HTMLElement;
    const tip = loading.querySelector('.load-tip span') as HTMLElement;
    const setP = (p: number) => segs.forEach((s, i) => s.classList.toggle('on', i < Math.round(p * segs.length)));
    let ti = Math.floor(Math.random() * TIPS.length);
    tip.textContent = TIPS[ti];
    const tipTimer = window.setInterval(() => {
      ti = (ti + 1) % TIPS.length;
      tip.classList.remove('swap');
      void tip.offsetWidth;
      tip.classList.add('swap');
      tip.textContent = TIPS[ti];
    }, 3200);
    status.textContent = 'RENDERING UNIT DOSSIERS';
    await renderCameos((p) => setP(p * 0.7));
    status.textContent = 'DEPLOYING BATTLEFIELD';
    setP(0.85);
    await new Promise((r) => setTimeout(r, 30));
    try {
      setFowEnabled(false);
      this.createAttract();
    } catch (e) {
      console.error('attract failed', e);
    }
    setP(1);
    await new Promise((r) => setTimeout(r, 150));
    clearInterval(tipTimer);
    const params = new URLSearchParams(location.search);
    const mid = params.get('mission');
    if (mid) {
      const m = [...CAMPAIGNS.aegis, ...CAMPAIGNS.covenant].find((x) => x.id === mid);
      if (m) {
        this.startMission(m);
        return;
      }
    }
    if (params.get('quick')) {
      this.startSkirmish({ ...this.lastSkirmish, startUnits: params.get('base') ? 'base' : this.lastSkirmish.startUnits });
      return;
    }
    this.showMain();
  }

  private createAttract() {
    this.attract = new Attract(this.bgHost, this.quality);
    // Frame-time probe: if the machine struggles on auto "high", step down to medium once.
    if (this.settings.qualityAuto && !this.settings.probed && this.qParam === null && this.settings.quality === 2) {
      this.attract.onProbe = (ms) => {
        this.settings.probed = true;
        if (ms > 24) this.settings.quality = 1;
        this.saveSettings();
      };
    }
  }

  private show(html: string, cls = 'screen'): HTMLElement {
    this.screen?.remove();
    this.unsubFs?.();
    this.unsubFs = null;
    this.onEsc = null;
    const el = document.createElement('div');
    el.className = cls + ' fade-in';
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screen = el;
    el.querySelectorAll('.panel-body').forEach((b) => scrollFades(b as HTMLElement));
    return el;
  }

  private menuChrome(inner: string) {
    return `<div class="menu-vignette"></div><div class="menu-scan"></div>${inner}<div class="menu-footer"><span>RIFTFALL: COMMAND THEATER ${VERSION}</span><span>© 2026 RIFTFALL DIVISION</span></div>`;
  }

  private panel(o: { title: string; sub?: string; body: string; actions?: string; cls?: string; style?: string; head?: string }) {
    return `<div class="panel ${o.cls ?? ''}" style="${o.style ?? ''}"><div class="panel-head"><div><h2>${o.title}</h2>${o.sub ? `<div class="panel-sub">${o.sub}</div>` : ''}</div>${o.head ?? ''}</div><div class="panel-body">${o.body}</div>${o.actions ? `<div class="panel-actions">${o.actions}</div>` : ''}</div>`;
  }

  /** Wires a fullscreen toggle button (label/icon follow the real state). */
  private fsButton(btn: HTMLElement | null) {
    if (!btn) return;
    if (!fullscreenSupported()) {
      btn.remove();
      return;
    }
    const upd = (fs: boolean) => {
      btn.innerHTML = `${fs ? ICONS.exitFullscreen : ICONS.fullscreen}<span>${fs ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}</span>`;
    };
    btn.addEventListener('click', () => {
      audio.play('click');
      toggleFullscreen();
    });
    const un = onFullscreenChange(upd);
    const prev = this.unsubFs;
    this.unsubFs = () => {
      prev?.();
      un();
    };
  }

  // ================================================================= main menu
  private continueTarget(): MissionDef | null {
    const last = lsGet('riftfall.lastFaction') as FactionId | null;
    const order: FactionId[] = last === 'covenant' ? ['covenant', 'aegis'] : ['aegis', 'covenant'];
    for (const f of order) {
      const p = this.progress[f] ?? 1;
      if (p <= 1 && f !== last) continue;
      const m = CAMPAIGNS[f].find((x) => x.index === p);
      if (m) return m;
    }
    return null;
  }

  showTitle() {
    this.showMain();
  }

  showMain() {
    this.ensureAttract();
    document.body.classList.remove('covenant');
    const cont = this.continueTarget();
    const el = this.show(
      this.menuChrome(`<div class="menu-grade"></div><div class="main-menu"><div class="logo-wrap">${logoSvg()}<div class="logo-sub">COMMAND THEATER</div></div>
      <div class="menu-btns">
        ${cont ? `<button class="mbtn cont ${cont.faction}" data-a="continue"><span>CONTINUE</span><small>${FACTIONS[cont.faction].short} · OP ${String(cont.index).padStart(2, '0')}: ${escapeHtml(cont.name.toUpperCase())}</small></button>` : ''}
        <button class="mbtn" data-a="campaign"><span>CAMPAIGN</span><small>Aegis and Covenant story operations</small></button>
        <button class="mbtn" data-a="skirmish"><span>SKIRMISH</span><small>Battle the computer on your terms</small></button>
        <button class="mbtn" data-a="howto"><span>FIELD MANUAL</span><small>Controls and tactics</small></button>
        <button class="mbtn" data-a="options"><span>OPTIONS</span><small>Audio, graphics, controls</small></button>
        <button class="mbtn" data-a="credits"><span>CREDITS</span></button>
      </div></div>
      <div class="menu-corner"><button class="icon-btn fs"></button></div>
      ${this.audioReady ? '' : '<div class="sound-hint"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>Click anywhere to enable sound</div>'}`),
    );
    audio.playMusic('menu');
    this.fsButton(el.querySelector('.fs'));
    el.querySelectorAll('.mbtn').forEach((b) =>
      b.addEventListener('click', () => {
        audio.play('click');
        const a = (b as HTMLElement).dataset.a;
        if (a === 'continue' && cont) this.showBriefing(cont);
        if (a === 'campaign') this.showCampaign();
        if (a === 'skirmish') this.showSkirmish();
        if (a === 'howto') this.showHowTo(() => this.showMain());
        if (a === 'options') this.showOptions(() => this.showMain());
        if (a === 'credits') this.showCredits();
      }),
    );
    el.querySelectorAll('.mbtn').forEach((b) => b.addEventListener('mouseenter', () => audio.play('uiHover', { volume: 0.4 })));
  }

  private ensureAttract() {
    if (!this.attract) {
      try {
        setFowEnabled(false);
        this.createAttract();
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ================================================================= campaign
  showCampaign() {
    document.body.classList.remove('covenant');
    const card = (f: FactionId) => {
      const d = FACTIONS[f];
      const n = CAMPAIGNS[f].length;
      const done = Math.min(n, (this.progress[f] ?? 1) - 1);
      const h = HERO[f];
      const img = cameo(h.hero);
      return `<div class="faction-card ${f}" data-f="${f}" tabindex="0">
        <div class="fc-hero">${img ? `<div class="fc-hero-bg" style="background-image:url(${img})"></div><img src="${img}" alt="">` : ''}
          <div class="fc-emblem">${emblemSvg(f, 44)}</div>
          <div class="fc-roster">${h.roster.map((id) => (cameo(id) ? `<i style="background-image:url(${cameo(id)})"></i>` : '')).join('')}</div></div>
        <div class="fc-body"><h4>${d.name.toUpperCase()}</h4><div class="motto">“${d.motto}”</div>
        <p>${h.desc}</p>
        <div class="fc-prog"><div class="bar"><i style="width:${n ? (done / n) * 100 : 0}%"></i></div><span>${n ? `${done} / ${n} OPERATIONS` : 'CLASSIFIED'}</span></div></div>
        <div class="fc-cta">${done > 0 && done < n ? 'CONTINUE CAMPAIGN' : done >= n && n ? 'REPLAY CAMPAIGN' : 'BEGIN CAMPAIGN'}<svg viewBox="0 0 12 12"><path d="M4 1.5 9 6l-5 4.5z" fill="currentColor"/></svg></div>
      </div>`;
    };
    const el = this.show(this.menuChrome(this.panel({ title: 'CAMPAIGN', sub: 'CHOOSE YOUR ALLEGIANCE', cls: 'w-wide', body: `<div class="faction-pick">${card('aegis')}${card('covenant')}</div>`, actions: '<button class="btn" data-a="back">BACK</button>' })));
    el.querySelectorAll('.faction-card').forEach((c) => {
      const go = () => {
        audio.play('click');
        this.showMissions((c as HTMLElement).dataset.f as FactionId);
      };
      c.addEventListener('click', go);
      c.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') go();
      });
      c.addEventListener('mouseenter', () => audio.play('uiHover', { volume: 0.4 }));
    });
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
    this.onEsc = () => this.showMain();
  }

  showMissions(f: FactionId) {
    const list = CAMPAIGNS[f];
    const unlocked = this.progress[f] ?? 1;
    document.body.classList.toggle('covenant', f === 'covenant');
    const items = list
      .map((m) => {
        const locked = m.index > unlocked;
        const done = m.index < unlocked;
        const next = m.index === unlocked;
        const code = stripOperation(m.codename);
        const sub = code.toLowerCase() === m.name.toLowerCase() ? m.location : `${m.codename} · ${m.location}`;
        return `<div class="mission-item ${locked ? 'locked' : ''} ${done ? 'done' : ''} ${next ? 'next' : ''}" data-id="${m.id}">
          <div class="num">${String(m.index).padStart(2, '0')}</div>
          <div class="t"><b>${locked ? 'CLASSIFIED' : escapeHtml(m.name)}</b><span class="sub">${locked ? 'Operation details sealed by command' : escapeHtml(sub)}</span>${locked ? `<span class="lock-msg">Complete Op ${String(m.index - 1).padStart(2, '0')} to unlock</span>` : ''}</div>
          <div class="state">${done ? 'COMPLETE <b>✓</b>' : next ? 'NEXT' : locked ? ICONS.lock : ''}</div></div>`;
      })
      .join('');
    const el = this.show(this.menuChrome(this.panel({ title: FACTIONS[f].name.toUpperCase(), sub: 'OPERATIONS', cls: 'w-mid', head: `<div class="panel-emblem">${emblemSvg(f, 40)}</div>`, body: `<div class="mission-list">${items || '<p>No operations available yet.</p>'}</div>`, actions: '<button class="btn" data-a="back">BACK</button>' })));
    el.querySelectorAll('.mission-item').forEach((m) =>
      m.addEventListener('click', () => {
        if (m.classList.contains('locked')) {
          audio.play('error');
          m.classList.remove('shake');
          void (m as HTMLElement).offsetWidth;
          m.classList.add('shake');
          return;
        }
        audio.play('click');
        const def = list.find((x) => x.id === (m as HTMLElement).dataset.id)!;
        this.showBriefing(def);
      }),
    );
    const back = () => {
      document.body.classList.remove('covenant');
      this.showCampaign();
    };
    el.querySelector('[data-a=back]')!.addEventListener('click', back);
    this.onEsc = back;
  }

  showBriefing(m: MissionDef) {
    audio.playMusic('briefing');
    document.body.classList.toggle('covenant', m.faction === 'covenant');
    const el = this.show('<div class="menu-vignette strong"></div>');
    let created: ReturnType<MissionDef['create']> | null = null;
    try {
      created = m.create();
    } catch (e) {
      console.error('mission create failed', e);
    }
    const b = new Briefing(el, m, created?.world ?? null, () => this.startMission(m, created ?? undefined), () => this.showMissions(m.faction));
    void b;
  }

  // ================================================================= skirmish setup
  showSkirmish() {
    const s: SkirmishSetup = JSON.parse(JSON.stringify(this.lastSkirmish));
    const syncAccent = () => document.body.classList.toggle('covenant', s.players.find((p) => p.human)?.faction === 'covenant');
    syncAccent();
    const el = this.show(
      this.menuChrome(
        this.panel({
          title: 'SKIRMISH',
          sub: 'BATTLE SETUP',
          cls: 'skirmish w-xl',
          body: `<div class="sk-grid">
            <section class="sk-maps"><h3>BATTLEFIELD</h3><div class="map-list"></div><div class="map-info"></div></section>
            <section class="sk-side">
              <h3>COMMANDERS</h3>
              <div class="player-head"><span></span><span>NAME</span><span>FACTION</span><span>DIFFICULTY</span><span>TEAM</span><span></span></div>
              <div class="players"></div>
              <button class="btn ghost add">+ ADD COMPUTER OPPONENT</button>
              <h3>RULES</h3>
              <div class="rules">
                <label>Starting credits</label><div data-slot="credits"></div>
                <label>Start with</label><div data-slot="start"></div>
                <label>Fog of war</label><div data-slot="shroud"></div>
              </div>
            </section></div>`,
          actions: '<div class="validation" role="alert"></div><button class="btn" data-a="back">BACK</button><button class="btn primary" data-a="start">START BATTLE</button>',
        }),
      ),
    );
    const mapList = el.querySelector('.map-list') as HTMLElement;
    const info = el.querySelector('.map-info') as HTMLElement;
    const startBtn = el.querySelector('[data-a=start]') as HTMLButtonElement;
    const valEl = el.querySelector('.validation') as HTMLElement;
    const validate = () => {
      const teams = new Set(s.players.map((p) => p.team));
      let msg = '';
      if (s.players.length < 2) msg = 'Add at least one computer opponent.';
      else if (teams.size < 2) msg = 'Everyone is on the same team. Put an opponent on a different team.';
      valEl.textContent = msg;
      valEl.classList.toggle('show', !!msg);
      startBtn.disabled = !!msg;
      return !msg;
    };
    const mapCards = new Map<string, HTMLElement>();
    for (const spec of SKIRMISH_MAPS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-card';
      const cv = document.createElement('canvas');
      cv.width = 224;
      cv.height = 224;
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `<b>${spec.name}</b><span>${spec.players}P · ${spec.theater}</span>`);
      card.addEventListener('click', () => {
        s.mapId = spec.id;
        if (s.players.length > spec.players) s.players.length = spec.players;
        renderMaps();
        renderPlayers();
        audio.play('click');
      });
      mapList.appendChild(card);
      mapCards.set(spec.id, card);
    }
    // draw previews progressively so the screen appears instantly
    const queue = [...SKIRMISH_MAPS];
    const drawNext = () => {
      const spec = queue.shift();
      if (!spec || !el.isConnected) return;
      drawMapPreview(mapCards.get(spec.id)!.querySelector('canvas')!, spec.id);
      if (spec.id === s.mapId) renderInfo();
      setTimeout(drawNext, 0);
    };
    const selSpec = queue.findIndex((m) => m.id === s.mapId);
    if (selSpec > 0) queue.unshift(queue.splice(selSpec, 1)[0]);
    setTimeout(drawNext, 30);
    const renderInfo = () => {
      const spec = SKIRMISH_MAPS.find((m) => m.id === s.mapId) ?? SKIRMISH_MAPS[0];
      info.innerHTML = `<div class="mi-t"><b>${spec.name}</b><span>${spec.players} PLAYERS · ${spec.theater.toUpperCase()} · ${spec.w}×${spec.h}</span></div>
        <p>${spec.description}</p>
        <div class="mi-legend"><i class="dia"></i>Diamonds mark start positions (yours is random).</div>`;
    };
    const renderMaps = () => {
      for (const [id, c] of mapCards) c.classList.toggle('sel', id === s.mapId);
      renderInfo();
    };
    const playersEl = el.querySelector('.players') as HTMLElement;
    const renderPlayers = () => {
      playersEl.innerHTML = '';
      let ai = 0;
      s.players.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'player-row' + (p.human ? ' human' : '');
        const col = hex(TEAM_COLORS[p.colorIndex]);
        row.innerHTML = `<button type="button" class="swatch" style="--c:${col}" data-tip="Team colour<br><small>Click to cycle</small>"></button>
          <div class="pname">${p.human ? 'YOU' : 'COMPUTER ' + ++ai}</div>
          <div data-slot="fac"></div><div data-slot="dif">${p.human ? '<span class="muted">Human</span>' : ''}</div><div data-slot="team"></div>
          ${p.human ? '<span></span>' : `<button type="button" class="x-btn" data-tip="Remove">${ICONS.close}</button>`}`;
        row.querySelector('[data-slot=fac]')!.appendChild(
          spinner(
            [
              { value: 'aegis' as FactionId, label: 'Aegis Coalition' },
              { value: 'covenant' as FactionId, label: 'Rift Covenant' },
            ],
            p.faction,
            (v) => {
              p.faction = v;
              if (p.human) syncAccent();
              audio.play('click', { volume: 0.4 });
            },
          ),
        );
        if (!p.human)
          row.querySelector('[data-slot=dif]')!.appendChild(
            spinner(
              (['easy', 'normal', 'hard', 'brutal'] as Difficulty[]).map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) })),
              p.difficulty,
              (v) => {
                p.difficulty = v;
                audio.play('click', { volume: 0.4 });
              },
              'dif-' + p.difficulty,
            ),
          );
        row.querySelector('[data-slot=team]')!.appendChild(
          spinner(
            [1, 2, 3, 4].map((t) => ({ value: t, label: 'Team ' + t })),
            p.team,
            (v) => {
              p.team = v;
              audio.play('click', { volume: 0.4 });
              validate();
            },
          ),
        );
        row.querySelector('.swatch')!.addEventListener('click', () => {
          const used = new Set(s.players.map((x) => x.colorIndex));
          let c = p.colorIndex;
          for (let k = 0; k < TEAM_COLORS.length; k++) {
            c = (c + 1) % TEAM_COLORS.length;
            if (!used.has(c)) break;
          }
          p.colorIndex = c;
          audio.play('click', { volume: 0.4 });
          renderPlayers();
        });
        row.querySelector('.x-btn')?.addEventListener('click', () => {
          s.players.splice(i, 1);
          audio.play('cancel', { volume: 0.5 });
          renderPlayers();
        });
        playersEl.appendChild(row);
      });
      const max = SKIRMISH_MAPS.find((m) => m.id === s.mapId)?.players ?? 2;
      const add = el.querySelector('.add') as HTMLButtonElement;
      add.disabled = s.players.length >= max;
      add.textContent = s.players.length >= max ? `MAP SUPPORTS ${max} PLAYERS` : '+ ADD COMPUTER OPPONENT';
      validate();
    };
    el.querySelector('.add')!.addEventListener('click', () => {
      const used = new Set(s.players.map((x) => x.colorIndex));
      let c = 0;
      while (used.has(c)) c++;
      s.players.push({ faction: Math.random() < 0.5 ? 'aegis' : 'covenant', colorIndex: c, team: Math.min(4, s.players.length + 1), human: false, difficulty: 'normal' });
      audio.play('click');
      renderPlayers();
    });
    el.querySelector('[data-slot=credits]')!.appendChild(
      spinner(
        [2500, 5000, 10000, 20000].map((v) => ({ value: v, label: '$' + v.toLocaleString('en-US') })),
        s.credits,
        (v) => (s.credits = v),
      ),
    );
    el.querySelector('[data-slot=start]')!.appendChild(
      spinner(
        [
          { value: 'mcv' as const, label: 'MCV only' },
          { value: 'base' as const, label: 'Small base' },
        ],
        s.startUnits,
        (v) => (s.startUnits = v),
      ),
    );
    el.querySelector('[data-slot=shroud]')!.appendChild(toggle(s.shroud, (v) => (s.shroud = v)));
    renderMaps();
    renderPlayers();
    const back = () => {
      document.body.classList.remove('covenant');
      this.showMain();
    };
    el.querySelector('[data-a=back]')!.addEventListener('click', back);
    this.onEsc = back;
    startBtn.addEventListener('click', () => {
      if (!validate()) {
        audio.play('error');
        return;
      }
      audio.play('click');
      this.lastSkirmish = s;
      save('riftfall.skirmish', s);
      this.startSkirmish(s);
    });
  }

  // ================================================================= options
  private pauseSub: HTMLElement | null = null;

  /** Options screen. In game it opens over the pause menu (Esc returns to it). */
  showOptions(back: () => void, inGame = false) {
    const v = audio.getVolumes();
    const slider = (key: string, label: string, val: number, min = 0, max = 1, step = 0.05) =>
      `<label>${label}</label><div class="slider"><input type="range" min="${min}" max="${max}" step="${step}" data-v="${key}" value="${val}"><output></output></div>`;
    const html = this.panel({
      title: 'OPTIONS',
      cls: 'w-mid options',
      body: `<div class="opt-grid">
        <section><h3>AUDIO</h3><div class="form">
          ${slider('master', 'Master volume', v.master)}
          ${slider('music', 'Music', v.music)}
          ${slider('sfx', 'Sound effects', v.sfx)}
          ${slider('voice', 'Voices', v.voice)}
        </div>
        <h3>DISPLAY</h3><div class="form">
          <label>Graphics quality</label><div data-slot="q"></div>
          <div class="note span" data-slot="qnote"></div>
          <label>Fullscreen</label><div data-slot="fs"></div>
        </div></section>
        <section><h3>CONTROLS</h3><div class="form">
          <label>Trackpad mode</label><div data-slot="trackpad"></div>
          <div class="note span" data-slot="tpnote"></div>
          ${slider('scroll', 'Scroll speed', this.settings.scroll, 0.4, 2.5, 0.1)}
          <label>Edge scrolling</label><div data-slot="edge"></div>
          <label>Show tips</label><div data-slot="tips"></div>
          <div class="note span">Step-by-step hints for building your first base in skirmish.</div>
        </div></section></div>`,
      actions: '<button class="btn primary" data-a="back">DONE</button>',
    });
    let el: HTMLElement;
    if (inGame) {
      el = document.createElement('div');
      el.className = 'screen in-game fade-in';
      el.innerHTML = html;
      this.root.appendChild(el);
      el.querySelectorAll('.panel-body').forEach((b) => scrollFades(b as HTMLElement));
      this.pauseSub = el;
    } else {
      el = this.show(this.menuChrome(html));
      this.onEsc = back;
    }
    const pct = (i: HTMLInputElement) => {
      const out = i.parentElement!.querySelector('output') as HTMLElement;
      const val = Number(i.value);
      out.textContent = i.dataset.v === 'scroll' ? val.toFixed(1) + '×' : Math.round(val * 100) + '%';
      i.style.setProperty('--p', ((val - Number(i.min)) / (Number(i.max) - Number(i.min))) * 100 + '%');
    };
    el.querySelectorAll('input[data-v]').forEach((node) => {
      const inp = node as HTMLInputElement;
      pct(inp);
      inp.addEventListener('input', () => {
        pct(inp);
        if (inp.dataset.v === 'scroll') {
          this.settings.scroll = Number(inp.value);
          this.saveSettings();
        } else audio.setVolumes({ [inp.dataset.v!]: Number(inp.value) });
      });
    });
    const qnote = el.querySelector('[data-slot=qnote]') as HTMLElement;
    const qn = () => {
      const q = this.settings.quality;
      qnote.textContent = (q === 2 ? 'Shadows, bloom and full retina resolution.' : q === 1 ? 'Shadows and bloom at reduced resolution.' : 'No shadows or bloom. Fastest.') + (this.settings.qualityAuto ? ' Picked automatically for this display.' : '');
    };
    qn();
    el.querySelector('[data-slot=q]')!.appendChild(
      spinner(
        [
          { value: 0 as const, label: 'Low' },
          { value: 1 as const, label: 'Medium' },
          { value: 2 as const, label: 'High' },
        ],
        this.settings.quality,
        (q) => {
          this.settings.quality = q;
          this.settings.qualityAuto = false;
          this.qParam = null;
          this.saveSettings();
          qn();
        },
      ),
    );
    const fsSlot = el.querySelector('[data-slot=fs]') as HTMLElement;
    if (fullscreenSupported()) {
      const t = toggle(isFullscreen(), () => toggleFullscreen());
      fsSlot.appendChild(t);
      const un = onFullscreenChange((fs) => t.setValue(fs));
      const obs = new MutationObserver(() => {
        if (!el.isConnected) {
          un();
          obs.disconnect();
        }
      });
      obs.observe(this.root, { childList: true });
    } else fsSlot.innerHTML = '<span class="muted">Not supported</span>';
    const tpnote = el.querySelector('[data-slot=tpnote]') as HTMLElement;
    const tpn = (on: boolean) => {
      tpnote.innerHTML = on ? 'Two-finger swipe <b>pans</b> the map, pinch zooms. Best for MacBook trackpads.' : 'Scroll wheel <b>zooms</b>. Pan with arrow keys, screen edges or middle-drag.';
    };
    const tp = trackpadMode();
    tpn(tp);
    el.querySelector('[data-slot=trackpad]')!.appendChild(
      toggle(tp, (on) => {
        lsSet('riftfall.trackpad', on ? '1' : '0');
        if (this.game) this.game.trackpadMode = on;
        tpn(on);
      }),
    );
    el.querySelector('[data-slot=edge]')!.appendChild(
      toggle(this.settings.edge, (on) => {
        this.settings.edge = on;
        this.saveSettings();
      }),
    );
    el.querySelector('[data-slot=tips]')!.appendChild(toggle(lsGet('riftfall.skirmishTips') !== '0', (on) => lsSet('riftfall.skirmishTips', on ? '1' : '0')));
    el.querySelector('[data-a=back]')!.addEventListener('click', () => {
      audio.play('click');
      back();
    });
  }

  showHowTo(back: () => void, inGame = false) {
    const html = this.panel({
      title: 'FIELD MANUAL',
      cls: 'w-wide',
      body: `<div class="manual">
      <div><h3>COMMAND</h3><div class="keys-grid">
        <span><kbd>Click</kbd></span><span>Select unit / building</span>
        <span><kbd>Drag</kbd></span><span>Box-select units</span>
        <span><kbd>Double-click</kbd></span><span>Select all of that type on screen</span>
        <span><kbd>Right click</kbd></span><span>Move / attack / harvest / capture</span>
        <span><kbd>Two-finger tap</kbd></span><span>Right click on a MacBook trackpad</span>
        <span><kbd>Ctrl</kbd>+<kbd>click</kbd></span><span>Also a right click (Mac)</span>
        <span><kbd>Alt</kbd>+<kbd>right click</kbd></span><span>Force fire</span>
        <span><kbd>Shift</kbd>+<kbd>right click</kbd></span><span>Queue waypoints</span>
        <span><kbd>A</kbd></span><span>Attack-move (then click)</span>
        <span><kbd>S</kbd> / <kbd>X</kbd></span><span>Stop / scatter</span>
        <span><kbd>G</kbd> / <kbd>F</kbd></span><span>Hold ground / hold fire (toggle)</span>
        <span><kbd>D</kbd></span><span>Deploy MCV</span>
        <span><kbd>⌘</kbd>+<kbd>1-9</kbd></span><span>Assign group · <kbd>1-9</kbd> recall (tap twice to jump)</span>
        <span><kbd>Q</kbd> / <kbd>E</kbd></span><span>Select army on screen / everywhere</span>
      </div></div>
      <div><h3>CAMERA & BASE</h3><div class="keys-grid">
        <span><kbd>Two-finger swipe</kbd></span><span>Pan the map (trackpad mode) · zoom (mouse mode)</span>
        <span><kbd>Pinch</kbd></span><span>Zoom</span>
        <span><kbd>Arrows</kbd> / edges</span><span>Scroll the map</span>
        <span><kbd>Middle drag</kbd></span><span>Pan</span>
        <span><kbd>Space</kbd> / <kbd>H</kbd></span><span>Jump to last alert / base</span>
        <span><kbd>Tab</kbd></span><span>Cycle build tabs</span>
        <span><kbd>Z</kbd> / <kbd>R</kbd></span><span>Sell / repair mode</span>
        <span><kbd>O</kbd> / <kbd>L</kbd></span><span>Objectives / transmission log</span>
        <span><kbd>Esc</kbd> / <kbd>P</kbd></span><span>Pause menu</span>
        <span><kbd>+</kbd> / <kbd>-</kbd></span><span>Game speed</span>
      </div>
      <h3>TACTICS</h3><p class="manual-p">Deploy your MCV, build power, then a Refinery: Harvesters turn Riftite crystals into credits. Watch your power: low power slows production and shuts down advanced defences. Build a radar structure to enable the minimap. Mix your forces: rifles beat infantry, rockets and cannons beat armour. Engineers capture enemy buildings (damage them below half first) and neutral Oil Derricks for steady income. Units gain veterancy through kills.</p></div></div>`,
      actions: '<button class="btn primary" data-a="back">BACK</button>',
    });
    let el: HTMLElement;
    if (inGame) {
      el = document.createElement('div');
      el.className = 'screen in-game fade-in';
      el.innerHTML = html;
      this.root.appendChild(el);
      el.querySelectorAll('.panel-body').forEach((b) => scrollFades(b as HTMLElement));
      this.pauseSub = el;
    } else {
      el = this.show(this.menuChrome(html));
      this.onEsc = back;
    }
    el.querySelector('[data-a=back]')!.addEventListener('click', () => back());
  }

  showCredits() {
    const el = this.show(
      this.menuChrome(
        this.panel({
          title: 'CREDITS',
          cls: 'w-narrow credits',
          body: `<div class="credits-body">${logoSvg('logo-svg small')}<p>A modern tribute to the classic real-time strategy era.</p>
      <h3>DESIGN, ENGINEERING, ART & AUDIO</h3><p>Built with Claude Code and a team of AI specialists:<br>engine, 3D art, audio, AI opponent and campaign agents.</p>
      <h3>TECHNOLOGY</h3><p>TypeScript · Three.js · Web Audio · Web Speech<br>All models, textures, music and sound effects are generated procedurally.<br>UI typeface: Barlow Condensed (SIL Open Font License).</p>
      <p class="muted">Inspired by the Command & Conquer series. Not affiliated with Electronic Arts.</p></div>`,
          actions: '<button class="btn primary" data-a="back">BACK</button>',
        }),
      ),
    );
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
    this.onEsc = () => this.showMain();
  }

  // ================================================================= game start
  private gameShell(): HTMLElement {
    this.attract?.dispose();
    this.attract = null;
    this.screen?.remove();
    this.screen = null;
    this.onEsc = null;
    this.unsubFs?.();
    this.unsubFs = null;
    const shell = document.createElement('div');
    shell.id = 'game-root';
    shell.innerHTML = `<div id="viewport"></div><div id="sidebar"></div>`;
    this.root.appendChild(shell);
    return shell;
  }

  startSkirmish(setup: SkirmishSetup) {
    this.ctx = { kind: 'skirmish', setup };
    const human = setup.players.find((p) => p.human);
    document.body.classList.toggle('covenant', human?.faction === 'covenant');
    const shell = this.gameShell();
    const { world } = createSkirmish(setup);
    if (SkirmishAI) {
      world.players.forEach((p, i) => {
        if (p.isNeutral || p.isHuman) return;
        const s = setup.players[i - 1];
        p.ai = new SkirmishAI(world, p, s?.difficulty ?? 'normal');
      });
    }
    this.launch(shell, world, null);
    const g = this.game!;
    this.tipsOn = lsGet('riftfall.skirmishTips') !== '0';
    audio.playMusic((['battle1', 'battle2', 'battle3'] as const)[Math.floor(Math.random() * 3)]);
    audio.speak('Battle control online.', 'announcer', { faction: g.me.faction, priority: 2 });
  }

  startMission(m: MissionDef, created?: ReturnType<MissionDef['create']>) {
    this.ctx = { kind: 'mission', mission: m };
    lsSet('riftfall.lastFaction', m.faction);
    document.body.classList.toggle('covenant', m.faction === 'covenant');
    const shell = this.gameShell();
    const { world, script } = created ?? m.create();
    this.tipsOn = false;
    this.launch(shell, world, script);
    audio.playMusic(m.music);
  }

  private launch(shell: HTMLElement, world: World, script: ((host: MissionHost) => MissionScript) | null) {
    setFowEnabled(true);
    const g = new Game(shell, world, {});
    const hud = new Hud(g, shell);
    this.game = g;
    this.hud = hud;
    this.samples = [];
    this.lastSample = -999;
    this.tipStep = '';
    this.tipT = 1;
    g.hooks.onMessage = (t, c) => hud.message(t, c);
    g.hooks.onHint = (h) => hud.showHint(h);
    g.hooks.onEnd = (v, w) => this.showEnd(v, w);
    g.hooks.onPauseToggle = (p) => {
      if (p) this.showPause();
      else this.hidePause();
    };
    // Hud drives the UI refresh; App piggybacks for stats sampling and skirmish tips.
    g.onFrame = (dt) => {
      hud.update(dt);
      this.frameTick(dt);
    };
    hud.onMenu = () => g.setPaused(true);
    if (script) g.missionScript = script(g);
    hud.refreshLayout();
    g.scrollSpeed = this.settings.scroll;
    g.edgeScroll = this.settings.edge;
    g.trackpadMode = trackpadMode();
    g.start();
    (window as unknown as { game: Game }).game = g;
  }

  // ---- per-frame: army strength samples (end-screen chart) + skirmish onboarding
  private samples: { t: number; v: number[] }[] = [];
  private lastSample = -999;
  private tipsOn = false;
  private tipStep = '';
  private tipT = 0;

  private frameTick(dt: number) {
    const g = this.game;
    if (!g) return;
    const w = g.world;
    if (w.time - this.lastSample >= 5) {
      this.lastSample = w.time;
      const players = w.players.filter((p) => !p.isNeutral);
      const v = players.map((p) => {
        let sum = 0;
        for (const u of w.units) if (u.owner === p && !u.dead && !u.def.mcv && !u.def.harvester) sum += u.def.cost;
        return sum;
      });
      this.samples.push({ t: w.time, v });
    }
    if (this.tipsOn && this.ctx?.kind === 'skirmish' && !g.paused) {
      this.tipT -= dt;
      if (this.tipT <= 0) {
        this.tipT = 0.5;
        this.updateSkirmishTips();
      }
    }
  }

  /** State-driven onboarding for skirmish: one step at a time, each shown until it is done. */
  private updateSkirmishTips() {
    const g = this.game!;
    const hud = this.hud!;
    const me = g.me;
    const f = FACTIONS[me.faction];
    const pre = f.yard.split('_')[0];
    const name = (id: string) => BUILDINGS[`${pre}_${id}`]?.name ?? id;
    const q = me.queues.structures;
    const step = (key: string, id: string, what: string, why: string) => {
      const full = `${pre}_${id}`;
      const nm = `<b>${name(id)}</b>`;
      if (q.ready === full) return { key: key + ':ready', html: `${nm} is <b class="good">READY</b>. Click its flashing icon in the sidebar, then click open ground near your base to place it.` };
      if (q.items[0]?.defId === full) return { key: key + ':building', html: `Constructing ${nm}… ${why}` };
      return { key, html: `${what.replace('%', nm)} ${why}` };
    };
    let tip: { key: string; html: string } | null = null;
    // counts buildings still rising from the ground too (Player.has only counts completed ones)
    const own = (id: string) => g.world.buildings.some((b) => b.owner === me && !b.dead && b.def.id === `${pre}_${id}`);
    const hasYard = own('yard');
    if (!hasYard && g.world.units.some((u) => u.owner === me && u.def.mcv)) tip = { key: 'deploy', html: 'Select your <b>MCV</b> and press <kbd>D</kbd> (or double-click it) to deploy your <b>Construction Yard</b>.' };
    else if (!hasYard) tip = null;
    else if (me.lowPower && me.powerUsed > 0 && me.has(`${pre}_power`)) tip = step('lowpower', 'power', '<b class="bad">Low power!</b> Build another %.', 'Production is slowed until supply beats demand.');
    else if (!own('power')) tip = step('power', 'power', 'Open the <b>Structures</b> tab and click % to start building power.', 'Every structure needs it.');
    else if (!own('refinery')) tip = step('refinery', 'refinery', 'Now build a %.', 'It comes with a free <b>Harvester</b> that turns Riftite into credits.');
    else if (!own('barracks')) tip = step('barracks', 'barracks', 'Build a % to train infantry.', '');
    else if (!own('factory')) tip = step('factory', 'factory', 'Build a % to produce tanks and vehicles.', '');
    else if (!own('radar')) tip = step('radar', 'radar', 'Build a % to bring the radar minimap online.', '');
    else {
      tip = { key: 'done', html: 'Base established. Train an army, then press <kbd>A</kbd> and click to <b>attack-move</b> into the enemy.' };
      if (this.tipStep !== 'done') {
        lsSet('riftfall.skirmishTips', '0'); // tutorial chain completed once: stop showing it next time
        setTimeout(() => {
          if (this.tipStep === 'done') hud.showHint(null);
          this.tipsOn = false;
        }, 12000);
      }
    }
    const key = tip?.key ?? '';
    if (key === this.tipStep) return;
    this.tipStep = key;
    hud.showHint(tip ? tip.html : null);
  }

  // ================================================================= pause
  private pauseEl: HTMLElement | null = null;
  private showPause() {
    this.hidePause();
    const el = document.createElement('div');
    el.className = 'screen pause-screen';
    this.root.appendChild(el);
    this.pauseEl = el;
    this.renderPauseMain();
  }

  private renderPauseMain() {
    const el = this.pauseEl;
    if (!el) return;
    delete el.dataset.confirm;
    const isMission = this.ctx?.kind === 'mission';
    const title = this.ctx?.kind === 'mission' ? this.ctx.mission.name.toUpperCase() : 'SKIRMISH';
    el.innerHTML = `<div class="panel w-pause"><div class="panel-head"><div><h2>PAUSED</h2><div class="panel-sub">${escapeHtml(title)} · ${formatTime(this.game?.world.time ?? 0)}</div></div></div>
      <div class="panel-body"><div class="menu-btns pause-btns">
      <button class="btn primary" data-a="resume">RESUME</button>
      <button class="btn" data-a="options">OPTIONS</button>
      <button class="btn" data-a="howto">FIELD MANUAL</button>
      <button class="btn fs"></button>
      <div class="sep"></div>
      <button class="btn warn" data-a="restart">RESTART ${isMission ? 'MISSION' : 'BATTLE'}</button>
      <button class="btn warn" data-a="quit">QUIT TO MAIN MENU</button></div></div></div>`;
    const g = this.game!;
    const fsBtn = el.querySelector('.fs') as HTMLElement;
    if (fullscreenSupported()) {
      const un = onFullscreenChange((fs) => (fsBtn.textContent = fs ? 'EXIT FULLSCREEN' : 'FULLSCREEN'));
      fsBtn.addEventListener('click', () => toggleFullscreen());
      const obs = new MutationObserver(() => {
        if (!fsBtn.isConnected) {
          un();
          obs.disconnect();
        }
      });
      obs.observe(el, { childList: true, subtree: true });
      obs.observe(this.root, { childList: true });
    } else fsBtn.remove();
    el.querySelector('[data-a=resume]')!.addEventListener('click', () => g.setPaused(false));
    el.querySelector('[data-a=options]')!.addEventListener('click', () => {
      audio.play('click');
      el.style.display = 'none';
      this.showOptions(() => this.closePauseSub(), true);
    });
    el.querySelector('[data-a=howto]')!.addEventListener('click', () => {
      audio.play('click');
      el.style.display = 'none';
      this.showHowTo(() => this.closePauseSub(), true);
    });
    el.querySelector('[data-a=restart]')!.addEventListener('click', () =>
      this.confirmPause(`RESTART ${isMission ? 'MISSION' : 'BATTLE'}?`, 'All progress in this battle will be lost.', 'RESTART', () => {
        this.hidePause();
        const ctx = this.ctx!;
        this.teardownGame();
        if (ctx.kind === 'skirmish') this.startSkirmish(ctx.setup);
        else this.startMission(ctx.mission);
      }),
    );
    el.querySelector('[data-a=quit]')!.addEventListener('click', () =>
      this.confirmPause('QUIT TO MAIN MENU?', 'The current battle will be abandoned.', 'QUIT', () => {
        this.hidePause();
        this.teardownGame();
        audio.playMusic('menu');
        this.showMain();
      }),
    );
    (el.querySelector('[data-a=resume]') as HTMLElement).focus({ preventScroll: true });
  }

  private confirmPause(title: string, text: string, ok: string, fn: () => void) {
    const el = this.pauseEl;
    if (!el) return;
    audio.play('click');
    el.dataset.confirm = '1';
    el.innerHTML = `<div class="panel w-pause confirm"><div class="panel-head"><div><h2>${title}</h2></div></div>
      <div class="panel-body"><p class="confirm-text">${text}</p></div>
      <div class="panel-actions"><button class="btn" data-a="cancel">CANCEL</button><button class="btn danger" data-a="ok">${ok}</button></div></div>`;
    el.querySelector('[data-a=cancel]')!.addEventListener('click', () => {
      audio.play('click');
      this.renderPauseMain();
    });
    el.querySelector('[data-a=ok]')!.addEventListener('click', () => {
      audio.play('click');
      fn();
    });
    (el.querySelector('[data-a=cancel]') as HTMLElement).focus({ preventScroll: true });
  }

  private closePauseSub() {
    this.pauseSub?.remove();
    this.pauseSub = null;
    if (this.pauseEl) this.pauseEl.style.display = '';
  }

  private hidePause() {
    this.pauseSub?.remove();
    this.pauseSub = null;
    this.pauseEl?.remove();
    this.pauseEl = null;
  }

  private teardownGame() {
    this.game?.stop();
    this.hud?.destroy();
    this.game = null;
    this.hud = null;
    this.tipsOn = false;
    document.getElementById('game-root')?.remove();
    document.body.classList.remove('covenant');
  }

  // ================================================================= end screen
  private showEnd(victory: boolean, world: World) {
    const ctx = this.ctx!;
    const g = this.game;
    const me = g?.me;
    const faction: FactionId = me?.faction ?? 'aegis';
    if (ctx.kind === 'mission' && victory) {
      const m = ctx.mission;
      if ((this.progress[m.faction] ?? 1) <= m.index) {
        this.progress[m.faction] = m.index + 1;
        save('riftfall.campaign', this.progress);
      }
    }
    const players = world.players.filter((p) => !p.isNeutral);
    // final sample so the chart reaches the end of the battle
    if (g) {
      this.lastSample = -999;
      this.frameTick(0);
    }
    const samples = this.samples;
    const rows = players
      .map((p) => {
        const s = p.stats;
        const score = Math.round(s.unitsKilled * 50 + s.buildingsDestroyed * 150 + s.creditsHarvested / 20 + s.unitsBuilt * 10 - s.unitsLost * 15 - s.buildingsLost * 50);
        return `<tr class="${p === me ? 'me' : ''}"><td><i class="dot" style="background:${hex(p.color)}"></i><span style="color:${hex(p.color)}">${escapeHtml(p.name)}</span>${p === me ? ' <em>(You)</em>' : ''}</td><td>${s.unitsBuilt}</td><td>${s.unitsLost}</td><td>${s.unitsKilled}</td><td>${s.buildingsLost}</td><td>${s.buildingsDestroyed}</td><td>$${Math.round(s.creditsHarvested).toLocaleString('en-US')}</td><td class="score">${Math.max(0, score).toLocaleString('en-US')}</td></tr>`;
      })
      .join('');
    const next = ctx.kind === 'mission' && victory ? CAMPAIGNS[ctx.mission.faction].find((x) => x.index === ctx.mission.index + 1) : undefined;
    const reason = (world as unknown as { endReason?: string }).endReason;
    const chart = armyChart(samples, players.map((p) => ({ name: p.name, color: hex(p.color) })));
    this.teardownGame();
    document.body.classList.toggle('covenant', faction === 'covenant');
    this.ensureAttract();
    const letters = (victory ? 'VICTORY' : 'DEFEAT')
      .split('')
      .map((c, i) => `<span style="animation-delay:${0.08 * i}s">${c}</span>`)
      .join('');
    const el = this.show(
      this.menuChrome(`<div class="panel end-screen ${victory ? 'win' : 'lose'} w-wide"><div class="panel-body">
      <div class="end-head">
        <div class="stamp ${victory ? 'win' : 'lose'}">${emblemSvg(faction, 46, 'currentColor')}<span>${victory ? 'MISSION<br>ACCOMPLISHED' : 'MISSION<br>FAILED'}</span></div>
        <div class="end-title"><div class="result ${victory ? 'win' : 'lose'}">${letters}</div>
        <div class="end-sub">${ctx.kind === 'mission' ? escapeHtml(ctx.mission.name.toUpperCase()) : 'SKIRMISH'} · BATTLE TIME ${formatTime(world.time)}</div>
        ${!victory && reason ? `<div class="end-reason">${escapeHtml(reason)}</div>` : ''}</div>
      </div>
      <table class="stats-table"><tr><th>COMMANDER</th><th>BUILT</th><th>LOST</th><th>KILLS</th><th>STRUCT. LOST</th><th>STRUCT. KILLED</th><th>HARVESTED</th><th>SCORE</th></tr>${rows}</table>
      ${chart}</div>
      <div class="panel-actions center">
        <button class="btn" data-a="menu">MAIN MENU</button>
        ${ctx.kind === 'skirmish' ? '<button class="btn" data-a="settings">CHANGE SETTINGS</button>' : ''}
        <button class="btn ${next ? '' : 'primary'}" data-a="retry">${victory ? (ctx.kind === 'mission' ? 'REPLAY MISSION' : 'PLAY AGAIN') : ctx.kind === 'mission' ? 'RETRY MISSION' : 'REMATCH'}</button>
        ${next ? '<button class="btn primary" data-a="next">NEXT MISSION</button>' : ''}
      </div></div>`),
    );
    el.querySelectorAll('.panel-body').forEach((b) => scrollFades(b as HTMLElement));
    const toMenu = () => {
      audio.playMusic('menu');
      this.showMain();
    };
    el.querySelector('[data-a=menu]')!.addEventListener('click', toMenu);
    el.querySelector('[data-a=settings]')?.addEventListener('click', () => {
      audio.playMusic('menu');
      this.showSkirmish();
    });
    el.querySelector('[data-a=retry]')!.addEventListener('click', () => {
      if (ctx.kind === 'skirmish') this.startSkirmish(ctx.setup);
      else this.showBriefing(ctx.mission);
    });
    el.querySelector('[data-a=next]')?.addEventListener('click', () => this.showBriefing(next!));
    this.onEsc = toMenu;
  }
}

// ---- end-screen chart: army value (sum of unit costs) over time
function armyChart(samples: { t: number; v: number[] }[], players: { name: string; color: string }[]): string {
  if (samples.length < 3) return '';
  const W = 760, H = 110, P = 4;
  const maxT = Math.max(1, samples[samples.length - 1].t);
  const maxV = Math.max(1, ...samples.flatMap((s) => s.v));
  const lines = players
    .map((p, i) => {
      const pts = samples.map((s) => `${(P + (s.t / maxT) * (W - 2 * P)).toFixed(1)},${(H - P - ((s.v[i] ?? 0) / maxV) * (H - 2 * P)).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const grid = [0.25, 0.5, 0.75].map((k) => `<line x1="0" x2="${W}" y1="${(H * k).toFixed(1)}" y2="${(H * k).toFixed(1)}" />`).join('');
  return `<div class="army-chart"><div class="ac-head"><span>ARMY STRENGTH</span><span class="ac-legend">${players.map((p) => `<i style="background:${p.color}"></i>${escapeHtml(p.name)}`).join('')}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g class="grid">${grid}</g>${lines}</svg>
    <div class="ac-axis"><span>0:00</span><span>${formatTime(maxT)}</span></div></div>`;
}

// ---- map previews for the skirmish screen
const previewCache = new Map<string, { img: HTMLCanvasElement; starts: { x: number; z: number }[]; w: number; h: number }>();
function drawMapPreview(cv: HTMLCanvasElement, id: string) {
  let entry = previewCache.get(id);
  if (!entry) {
    const spec = SKIRMISH_MAPS.find((m) => m.id === id)!;
    const gen = generateMap(spec);
    entry = { img: renderTerrain(gen.map, 3, 'natural', true, 1.2), starts: gen.starts.slice(0, spec.players), w: gen.map.w, h: gen.map.h };
    previewCache.set(id, entry);
  }
  const ctx = cv.getContext('2d')!;
  const S = cv.width;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(entry.img, 0, 0, S, S);
  // inner vignette
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const font = uiFont();
  entry.starts.forEach((s, i) => {
    const x = (s.x / entry!.w) * S, y = (s.z / entry!.h) * S;
    const r = S * 0.062;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffd76a';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a1206';
    ctx.stroke();
    ctx.fillStyle = '#1a1206';
    ctx.font = `700 ${Math.round(r * 1.25)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 0, r * 0.08);
    ctx.restore();
  });
}
