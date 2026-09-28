import { audio } from '../bridge';
import { FACTIONS, TEAM_COLORS } from '../data/factions';
import type { FactionId } from '../data/types';
import { Game } from '../game/Game';
import { SKIRMISH_MAPS, generateMap } from '../game/MapGen';
import type { MissionDef, MissionHost, MissionScript } from '../game/mission/MissionScript';
import { createSkirmish, type Difficulty, type SkirmishSetup } from '../game/Scenario';
import type { Player } from '../game/Player';
import type { World } from '../game/World';
import { formatTime } from '../game/util';
import { renderCameos } from '../render/Cameos';
import { setFowEnabled } from '../render/FogOfWar';
import { paletteFor } from '../render/Terrain';
import { Terrain } from '../game/GameMap';
import { Attract } from './Attract';
import { Hud } from './Hud';
import { Briefing } from './Briefing';

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

type Ctx = { kind: 'skirmish'; setup: SkirmishSetup } | { kind: 'mission'; mission: MissionDef };

export class App {
  root: HTMLElement;
  private screen: HTMLElement | null = null;
  private attract: Attract | null = null;
  private bgHost: HTMLElement;
  game: Game | null = null;
  hud: Hud | null = null;
  private ctx: Ctx | null = null;
  private settings: Settings = load('riftfall.settings', { quality: 2, scroll: 1, edge: true } as Settings);
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

  constructor(root: HTMLElement) {
    this.root = root;
    this.bgHost = document.createElement('div');
    this.bgHost.className = 'menu-bg';
    this.root.appendChild(this.bgHost);
    this.applySettings();
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
      this.game.renderer.setQuality(this.settings.quality);
      this.game.scrollSpeed = this.settings.scroll;
      this.game.edgeScroll = this.settings.edge;
    }
  }

  // ================================================================= boot
  async boot() {
    const loading = this.show(`<div class="loading"><div>INITIALIZING COMMAND LINK</div><div class="bar"><div style="width:0%"></div></div><div class="sub" style="font-size:11px;letter-spacing:3px"></div></div>`);
    const bar = loading.querySelector('.bar div') as HTMLElement;
    const sub = loading.querySelector('.sub') as HTMLElement;
    sub.textContent = 'RENDERING UNIT DOSSIERS';
    await renderCameos((p) => (bar.style.width = Math.round(p * 70) + '%'));
    sub.textContent = 'DEPLOYING BATTLEFIELD';
    bar.style.width = '85%';
    await new Promise((r) => setTimeout(r, 30));
    try {
      setFowEnabled(false);
      this.attract = new Attract(this.bgHost);
    } catch (e) {
      console.error('attract failed', e);
    }
    bar.style.width = '100%';
    await new Promise((r) => setTimeout(r, 150));
    const params = new URLSearchParams(location.search);
    if (params.get('quick')) {
      this.startSkirmish({ ...this.lastSkirmish, startUnits: params.get('base') ? 'base' : this.lastSkirmish.startUnits });
      return;
    }
    this.showTitle();
  }

  private show(html: string, cls = 'screen'): HTMLElement {
    this.screen?.remove();
    const el = document.createElement('div');
    el.className = cls + ' fade-in';
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screen = el;
    return el;
  }

  private menuChrome(inner: string) {
    return `<div class="menu-vignette"></div><div class="menu-scan"></div>${inner}<div class="menu-footer"><span>RIFTFALL: COMMAND THEATER ${VERSION}</span><span>© 2026 RIFTFALL DIVISION</span></div>`;
  }

  // ================================================================= title
  showTitle() {
    const el = this.show(
      this.menuChrome(`<div class="main-menu"><div class="logo">RIFTFALL</div><div class="logo-sub">COMMAND THEATER</div>
      <div style="font-size:16px;letter-spacing:6px;color:#d9e2ec;animation:blink 1.4s infinite">CLICK OR PRESS ANY KEY</div></div>`),
    );
    const go = () => {
      window.removeEventListener('keydown', go);
      audio.unlock();
      audio.playMusic('menu');
      this.showMain();
    };
    el.addEventListener('click', go);
    window.addEventListener('keydown', go);
  }

  // ================================================================= main menu
  showMain() {
    this.ensureAttract();
    const el = this.show(
      this.menuChrome(`<div class="main-menu"><div class="logo">RIFTFALL</div><div class="logo-sub">COMMAND THEATER</div>
      <div class="menu-btns">
        <button class="mbtn" data-a="campaign">CAMPAIGN<small>Aegis and Covenant story operations</small></button>
        <button class="mbtn" data-a="skirmish">SKIRMISH<small>Battle the computer on your terms</small></button>
        <button class="mbtn" data-a="howto">FIELD MANUAL<small>Controls and tactics</small></button>
        <button class="mbtn" data-a="options">OPTIONS<small>Audio, graphics, controls</small></button>
        <button class="mbtn" data-a="credits">CREDITS</button>
      </div></div>`),
    );
    el.querySelectorAll('.mbtn').forEach((b) =>
      b.addEventListener('click', () => {
        audio.play('click');
        const a = (b as HTMLElement).dataset.a;
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
        this.attract = new Attract(this.bgHost);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ================================================================= campaign
  showCampaign() {
    const card = (f: FactionId) => {
      const d = FACTIONS[f];
      const n = CAMPAIGNS[f].length;
      const color = f === 'aegis' ? '#e8b64c' : '#ff4a3d';
      return `<div class="faction-card ${f}" data-f="${f}">
        <svg width="54" height="54" viewBox="0 0 54 54">${f === 'aegis' ? `<path d="M27 3 L48 11 V27 C48 40 38 48 27 52 C16 48 6 40 6 27 V11 Z" fill="none" stroke="${color}" stroke-width="3"/><path d="M27 12 L38 17 V27 C38 34 33 39 27 42 C21 39 16 34 16 27 V17 Z" fill="${color}"/>` : `<path d="M27 3 L50 45 H4 Z" fill="none" stroke="${color}" stroke-width="3"/><circle cx="27" cy="32" r="8" fill="${color}"/><path d="M27 12 L27 24" stroke="${color}" stroke-width="3"/>`}</svg>
        <h4 style="color:${color}">${d.name.toUpperCase()}</h4><div style="font-size:13px;color:#b8c4d0;font-style:italic">"${d.motto}"</div>
        <p>${f === 'aegis' ? 'A global military coalition fighting to contain the spread of Riftite and the fanatics who worship it. Heavy armour, precision weapons, orbital power.' : 'A zealous brotherhood that believes the Rift is humanity\'s next evolution. Speed, stealth, fire — and the fury of the Rift itself.'}</p>
        <p style="margin-top:10px;color:#e8eef5">${n ? `${n} operations · ${Math.min(n, this.progress[f] - 1)} completed` : 'Operations classified'}</p></div>`;
    };
    const el = this.show(this.menuChrome(`<div class="panel"><h2>CAMPAIGN</h2><h3>CHOOSE YOUR ALLEGIANCE</h3><div class="faction-pick">${card('aegis')}${card('covenant')}</div><div class="actions"><button class="btn" data-a="back">BACK</button></div></div>`));
    el.querySelectorAll('.faction-card').forEach((c) =>
      c.addEventListener('click', () => {
        audio.play('click');
        this.showMissions((c as HTMLElement).dataset.f as FactionId);
      }),
    );
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
  }

  showMissions(f: FactionId) {
    const list = CAMPAIGNS[f];
    const unlocked = this.progress[f] ?? 1;
    const items = list
      .map((m) => {
        const locked = m.index > unlocked;
        const done = m.index < unlocked;
        return `<div class="mission-item ${locked ? 'locked' : ''}" data-id="${m.id}"><div class="num">${String(m.index).padStart(2, '0')}</div><div class="t"><b>${locked ? 'CLASSIFIED' : m.name}</b><span>${locked ? '—' : `${m.codename} · ${m.location}`}</span></div>${done ? '<div class="star">COMPLETE ✓</div>' : ''}</div>`;
      })
      .join('');
    const el = this.show(this.menuChrome(`<div class="panel" style="min-width:620px"><h2>${FACTIONS[f].name.toUpperCase()}</h2><h3>OPERATIONS</h3><div class="mission-list">${items || '<p>No operations available yet.</p>'}</div><div class="actions"><button class="btn" data-a="back">BACK</button></div></div>`));
    document.body.classList.toggle('covenant', f === 'covenant');
    el.querySelectorAll('.mission-item').forEach((m) =>
      m.addEventListener('click', () => {
        audio.play('click');
        const def = list.find((x) => x.id === (m as HTMLElement).dataset.id)!;
        this.showBriefing(def);
      }),
    );
    el.querySelector('[data-a=back]')!.addEventListener('click', () => {
      document.body.classList.remove('covenant');
      this.showCampaign();
    });
  }

  showBriefing(m: MissionDef) {
    audio.playMusic('briefing');
    const el = this.show('<div class="menu-vignette"></div>');
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
    const el = this.show(this.menuChrome(`<div class="panel" style="min-width:760px"><h2>SKIRMISH</h2>
      <h3>BATTLEFIELD</h3><div class="map-list"></div><div class="map-desc" style="color:#8595a6;font-size:13px;margin-bottom:10px"></div>
      <h3>COMMANDERS</h3><div class="players"></div><button class="btn add" style="height:30px;font-size:12px">+ ADD AI</button>
      <h3>RULES</h3>
      <div class="row"><label>Starting credits</label><select class="credits"><option value="2500">$2,500</option><option value="5000">$5,000</option><option value="10000">$10,000</option><option value="20000">$20,000</option></select>
      <label style="min-width:90px">Start with</label><select class="start"><option value="mcv">MCV only</option><option value="base">Small base</option></select></div>
      <div class="row"><label>Fog of war</label><select class="shroud"><option value="1">On</option><option value="0">Off</option></select></div>
      <div class="actions"><button class="btn" data-a="back">BACK</button><button class="btn primary" data-a="start">START BATTLE</button></div></div>`));
    const mapList = el.querySelector('.map-list') as HTMLElement;
    const desc = el.querySelector('.map-desc') as HTMLElement;
    const renderMaps = () => {
      mapList.innerHTML = '';
      for (const spec of SKIRMISH_MAPS) {
        const card = document.createElement('div');
        card.className = 'map-card' + (spec.id === s.mapId ? ' sel' : '');
        const cv = document.createElement('canvas');
        cv.width = 96;
        cv.height = 96;
        card.appendChild(cv);
        card.insertAdjacentHTML('beforeend', `<b>${spec.name}</b><span>${spec.players} players · ${spec.theater}</span>`);
        card.addEventListener('click', () => {
          s.mapId = spec.id;
          if (s.players.length > spec.players) s.players.length = spec.players;
          renderMaps();
          renderPlayers();
          audio.play('click');
        });
        mapList.appendChild(card);
        drawMapPreview(cv, spec.id);
      }
      desc.textContent = SKIRMISH_MAPS.find((m) => m.id === s.mapId)?.description ?? '';
    };
    const playersEl = el.querySelector('.players') as HTMLElement;
    const renderPlayers = () => {
      playersEl.innerHTML = '';
      s.players.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.innerHTML = `<div style="font-size:15px;letter-spacing:1px">${p.human ? 'YOU' : 'COMPUTER ' + i}</div>
          <select class="fac"><option value="aegis">Aegis Coalition</option><option value="covenant">Rift Covenant</option></select>
          <select class="dif" ${p.human ? 'disabled' : ''}><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option><option value="brutal">Brutal</option></select>
          <select class="team"><option value="1">Team 1</option><option value="2">Team 2</option><option value="3">Team 3</option><option value="4">Team 4</option></select>
          <div class="swatch" style="background:#${TEAM_COLORS[p.colorIndex].toString(16).padStart(6, '0')}"></div>
          ${p.human ? '<span></span>' : '<button class="x-btn">✕</button>'}`;
        (row.querySelector('.fac') as HTMLSelectElement).value = p.faction;
        (row.querySelector('.dif') as HTMLSelectElement).value = p.difficulty;
        (row.querySelector('.team') as HTMLSelectElement).value = String(p.team);
        row.querySelector('.fac')!.addEventListener('change', (e) => (p.faction = (e.target as HTMLSelectElement).value as FactionId));
        row.querySelector('.dif')!.addEventListener('change', (e) => (p.difficulty = (e.target as HTMLSelectElement).value as Difficulty));
        row.querySelector('.team')!.addEventListener('change', (e) => (p.team = Number((e.target as HTMLSelectElement).value)));
        row.querySelector('.swatch')!.addEventListener('click', () => {
          const used = new Set(s.players.map((x) => x.colorIndex));
          let c = p.colorIndex;
          for (let k = 0; k < TEAM_COLORS.length; k++) {
            c = (c + 1) % TEAM_COLORS.length;
            if (!used.has(c)) break;
          }
          p.colorIndex = c;
          renderPlayers();
        });
        row.querySelector('.x-btn')?.addEventListener('click', () => {
          s.players.splice(i, 1);
          renderPlayers();
        });
        playersEl.appendChild(row);
      });
      const max = SKIRMISH_MAPS.find((m) => m.id === s.mapId)?.players ?? 2;
      (el.querySelector('.add') as HTMLElement).style.display = s.players.length < max ? '' : 'none';
    };
    el.querySelector('.add')!.addEventListener('click', () => {
      const used = new Set(s.players.map((x) => x.colorIndex));
      let c = 0;
      while (used.has(c)) c++;
      s.players.push({ faction: Math.random() < 0.5 ? 'aegis' : 'covenant', colorIndex: c, team: s.players.length + 1, human: false, difficulty: 'normal' });
      renderPlayers();
    });
    const cr = el.querySelector('.credits') as HTMLSelectElement;
    cr.value = String(s.credits);
    cr.addEventListener('change', () => (s.credits = Number(cr.value)));
    const st = el.querySelector('.start') as HTMLSelectElement;
    st.value = s.startUnits;
    st.addEventListener('change', () => (s.startUnits = st.value as 'mcv' | 'base'));
    const sh = el.querySelector('.shroud') as HTMLSelectElement;
    sh.value = s.shroud ? '1' : '0';
    sh.addEventListener('change', () => (s.shroud = sh.value === '1'));
    renderMaps();
    renderPlayers();
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
    el.querySelector('[data-a=start]')!.addEventListener('click', () => {
      audio.play('click');
      const teams = new Set(s.players.map((p) => p.team));
      if (teams.size < 2) {
        alert('At least two teams are required.');
        return;
      }
      this.lastSkirmish = s;
      save('riftfall.skirmish', s);
      this.startSkirmish(s);
    });
  }

  // ================================================================= options
  showOptions(back: () => void, inGame = false) {
    const v = audio.getVolumes();
    const el = this.show(
      (inGame ? '' : this.menuChrome('')) +
        `<div class="panel"><h2>OPTIONS</h2>
      <h3>AUDIO</h3>
      <div class="row"><label>Master volume</label><input type="range" min="0" max="1" step="0.05" data-v="master" value="${v.master}"></div>
      <div class="row"><label>Music</label><input type="range" min="0" max="1" step="0.05" data-v="music" value="${v.music}"></div>
      <div class="row"><label>Sound effects</label><input type="range" min="0" max="1" step="0.05" data-v="sfx" value="${v.sfx}"></div>
      <div class="row"><label>Voices</label><input type="range" min="0" max="1" step="0.05" data-v="voice" value="${v.voice}"></div>
      <h3>GRAPHICS</h3>
      <div class="row"><label>Quality</label><select class="q"><option value="2">High (shadows, bloom, retina)</option><option value="1">Medium</option><option value="0">Low (fastest)</option></select></div>
      <h3>CONTROLS</h3>
      <div class="row"><label>Scroll speed</label><input type="range" min="0.4" max="2.5" step="0.1" class="scroll" value="${this.settings.scroll}"></div>
      <div class="row"><label>Edge scrolling</label><select class="edge"><option value="1">On</option><option value="0">Off</option></select></div>
      <div class="actions"><button class="btn primary" data-a="back">DONE</button></div></div>`,
      inGame ? 'screen' : 'screen',
    );
    if (inGame) el.style.background = 'rgba(0,0,0,0.6)';
    el.querySelectorAll('input[data-v]').forEach((i) =>
      i.addEventListener('input', () => {
        const inp = i as HTMLInputElement;
        audio.setVolumes({ [inp.dataset.v!]: Number(inp.value) });
      }),
    );
    const q = el.querySelector('.q') as HTMLSelectElement;
    q.value = String(this.settings.quality);
    q.addEventListener('change', () => {
      this.settings.quality = Number(q.value) as 0 | 1 | 2;
      save('riftfall.settings', this.settings);
      this.applySettings();
    });
    const sc = el.querySelector('.scroll') as HTMLInputElement;
    sc.addEventListener('input', () => {
      this.settings.scroll = Number(sc.value);
      save('riftfall.settings', this.settings);
      this.applySettings();
    });
    const ed = el.querySelector('.edge') as HTMLSelectElement;
    ed.value = this.settings.edge ? '1' : '0';
    ed.addEventListener('change', () => {
      this.settings.edge = ed.value === '1';
      save('riftfall.settings', this.settings);
      this.applySettings();
    });
    el.querySelector('[data-a=back]')!.addEventListener('click', () => {
      audio.play('click');
      back();
    });
  }

  showHowTo(back: () => void, inGame = false) {
    const el = this.show(
      (inGame ? '' : this.menuChrome('')) +
        `<div class="panel" style="max-width:900px"><h2>FIELD MANUAL</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px">
      <div><h3>COMMAND</h3><div class="keys-grid">
        <span><kbd>Left click</kbd></span><span>Select unit / building</span>
        <span><kbd>Drag</kbd></span><span>Box-select units</span>
        <span><kbd>Double-click</kbd></span><span>Select all of that type on screen</span>
        <span><kbd>Right click</kbd></span><span>Move / attack / harvest / capture (context)</span>
        <span><kbd>Ctrl</kbd>+<kbd>click</kbd></span><span>Same as right click (Mac trackpad)</span>
        <span><kbd>Two-finger tap</kbd></span><span>Right click on a MacBook trackpad</span>
        <span><kbd>Alt</kbd>+<kbd>right click</kbd></span><span>Force fire (attack ground / anything)</span>
        <span><kbd>Shift</kbd>+<kbd>right click</kbd></span><span>Queue waypoints</span>
        <span><kbd>A</kbd></span><span>Attack-move (then click)</span>
        <span><kbd>S</kbd> / <kbd>G</kbd></span><span>Stop / guard</span>
        <span><kbd>D</kbd></span><span>Deploy MCV</span>
        <span><kbd>X</kbd></span><span>Scatter</span>
        <span><kbd>⌘/Ctrl</kbd>+<kbd>1-9</kbd></span><span>Assign group · <kbd>1-9</kbd> recall (tap twice to jump)</span>
        <span><kbd>Q</kbd> / <kbd>E</kbd></span><span>Select army on screen / everywhere</span>
      </div></div>
      <div><h3>CAMERA & BASE</h3><div class="keys-grid">
        <span><kbd>Arrows</kbd> / screen edge</span><span>Scroll the map</span>
        <span><kbd>Scroll</kbd> / pinch</span><span>Zoom</span>
        <span><kbd>Middle drag</kbd></span><span>Pan</span>
        <span><kbd>Space</kbd></span><span>Jump to last alert</span>
        <span><kbd>H</kbd></span><span>Jump to base</span>
        <span><kbd>Tab</kbd></span><span>Cycle build tabs</span>
        <span><kbd>Z</kbd> / <kbd>R</kbd></span><span>Sell / repair mode</span>
        <span><kbd>O</kbd></span><span>Show objectives</span>
        <span><kbd>P</kbd> / <kbd>Esc</kbd></span><span>Pause / menu</span>
        <span><kbd>+</kbd> / <kbd>-</kbd></span><span>Game speed</span>
      </div>
      <h3>TACTICS</h3><p style="color:#b8c4d0;line-height:1.5;font-size:14px;margin:0">Deploy your MCV, build Power then a Refinery — Harvesters turn Riftite crystals into credits. Watch your power: low power slows production and shuts down advanced defences. Build a radar structure to enable the minimap. Mix your forces: rifles beat infantry, rockets and cannons beat armour. Engineers capture enemy buildings (damage them below half first) and neutral Oil Derricks for steady income. Units gain veterancy through kills.</p></div></div>
      <div class="actions"><button class="btn primary" data-a="back">BACK</button></div></div>`,
    );
    if (inGame) el.style.background = 'rgba(0,0,0,0.6)';
    el.querySelector('[data-a=back]')!.addEventListener('click', () => back());
  }

  showCredits() {
    const el = this.show(
      this.menuChrome(`<div class="panel" style="text-align:center;min-width:520px"><h2>CREDITS</h2>
      <p style="color:#b8c4d0;line-height:1.8;font-size:15px">RIFTFALL: COMMAND THEATER<br>A modern tribute to the classic real-time strategy era.<br><br>
      <b style="color:#e8b64c">Design, Engineering, Art & Audio</b><br>Built with Claude Code and a team of AI specialists:<br>engine, 3D art, audio, AI opponent and campaign agents.<br><br>
      <b style="color:#e8b64c">Technology</b><br>TypeScript · Three.js · Web Audio · Web Speech<br>All models, textures, music and sound effects are generated procedurally.<br><br>
      Inspired by the Command & Conquer series. Not affiliated with Electronic Arts.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" data-a="back">BACK</button></div></div>`),
    );
    el.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
  }

  // ================================================================= game start
  private gameShell(): HTMLElement {
    this.attract?.dispose();
    this.attract = null;
    this.screen?.remove();
    this.screen = null;
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
    if (setup.startUnits === 'mcv') {
      setTimeout(() => this.hud?.showHint('Select your <b>MCV</b> and press <kbd>D</kbd> (or double-click it) to deploy your Construction Yard.'), 1200);
      const off = world.events.on('deployed', (e) => {
        if (e.unit.owner === g.me) {
          this.hud?.showHint('Build a <b>Power Plant</b> first, then a <b>Refinery</b> to start harvesting Riftite.');
          setTimeout(() => this.hud?.showHint(null), 9000);
          off();
        }
      });
    }
    audio.playMusic((['battle1', 'battle2', 'battle3'] as const)[Math.floor(Math.random() * 3)]);
    audio.speak('Battle control online.', 'announcer', { faction: g.me.faction, priority: 2 });
  }

  startMission(m: MissionDef, created?: ReturnType<MissionDef['create']>) {
    this.ctx = { kind: 'mission', mission: m };
    document.body.classList.toggle('covenant', m.faction === 'covenant');
    const shell = this.gameShell();
    const { world, script } = created ?? m.create();
    this.launch(shell, world, script);
    audio.playMusic(m.music);
  }

  private launch(shell: HTMLElement, world: World, script: ((host: MissionHost) => MissionScript) | null) {
    setFowEnabled(true);
    const g = new Game(shell, world, {});
    const hud = new Hud(g, shell);
    this.game = g;
    this.hud = hud;
    g.hooks.onMessage = (t, c) => hud.message(t, c);
    g.hooks.onHint = (h) => hud.showHint(h);
    g.hooks.onEnd = (v, w) => this.showEnd(v, w);
    g.hooks.onPauseToggle = (p) => {
      if (p) this.showPause();
      else this.hidePause();
    };
    g.onFrame = (dt) => hud.update(dt);
    hud.onMenu = () => g.setPaused(true);
    if (script) g.missionScript = script(g);
    g.scrollSpeed = this.settings.scroll;
    g.edgeScroll = this.settings.edge;
    g.start();
    (window as unknown as { game: Game }).game = g;
  }

  private pauseEl: HTMLElement | null = null;
  private showPause() {
    this.hidePause();
    const el = document.createElement('div');
    el.className = 'screen';
    el.style.background = 'rgba(0,0,0,0.55)';
    el.style.zIndex = '30';
    const isMission = this.ctx?.kind === 'mission';
    el.innerHTML = `<div class="panel" style="min-width:360px;text-align:center"><h2>PAUSED</h2>
      <div class="menu-btns" style="gap:8px">
      <button class="btn primary" data-a="resume">RESUME</button>
      <button class="btn" data-a="options">OPTIONS</button>
      <button class="btn" data-a="howto">FIELD MANUAL</button>
      <button class="btn" data-a="restart">RESTART ${isMission ? 'MISSION' : 'BATTLE'}</button>
      <button class="btn" data-a="quit">QUIT TO MAIN MENU</button></div></div>`;
    this.root.appendChild(el);
    this.pauseEl = el;
    const g = this.game!;
    el.querySelector('[data-a=resume]')!.addEventListener('click', () => g.setPaused(false));
    el.querySelector('[data-a=options]')!.addEventListener('click', () => {
      el.style.display = 'none';
      this.showOptions(() => {
        this.screen?.remove();
        this.screen = null;
        el.style.display = '';
      }, true);
    });
    el.querySelector('[data-a=howto]')!.addEventListener('click', () => {
      el.style.display = 'none';
      this.showHowTo(() => {
        this.screen?.remove();
        this.screen = null;
        el.style.display = '';
      }, true);
    });
    el.querySelector('[data-a=restart]')!.addEventListener('click', () => {
      this.hidePause();
      const ctx = this.ctx!;
      this.teardownGame();
      if (ctx.kind === 'skirmish') this.startSkirmish(ctx.setup);
      else this.startMission(ctx.mission);
    });
    el.querySelector('[data-a=quit]')!.addEventListener('click', () => {
      this.hidePause();
      this.teardownGame();
      audio.playMusic('menu');
      this.showMain();
    });
  }
  private hidePause() {
    this.pauseEl?.remove();
    this.pauseEl = null;
  }

  private teardownGame() {
    this.game?.stop();
    this.hud?.destroy();
    this.game = null;
    this.hud = null;
    document.getElementById('game-root')?.remove();
    document.body.classList.remove('covenant');
  }

  // ================================================================= end screen
  private showEnd(victory: boolean, world: World) {
    const ctx = this.ctx!;
    const g = this.game;
    const me = g?.me;
    if (ctx.kind === 'mission' && victory) {
      const m = ctx.mission;
      if ((this.progress[m.faction] ?? 1) <= m.index) {
        this.progress[m.faction] = m.index + 1;
        save('riftfall.campaign', this.progress);
      }
    }
    const players = world.players.filter((p) => !p.isNeutral);
    const rows = players
      .map((p) => {
        const s = p.stats;
        const score = Math.round(s.unitsKilled * 50 + s.buildingsDestroyed * 150 + s.creditsHarvested / 20 + s.unitsBuilt * 10 - s.unitsLost * 15 - s.buildingsLost * 50);
        return `<tr><td style="color:#${p.color.toString(16).padStart(6, '0')};font-family:var(--ui-font);font-weight:700">${p.name}${p === me ? ' (You)' : ''}</td><td>${s.unitsBuilt}</td><td>${s.unitsLost}</td><td>${s.unitsKilled}</td><td>${s.buildingsLost}</td><td>${s.buildingsDestroyed}</td><td>$${Math.round(s.creditsHarvested).toLocaleString()}</td><td>${Math.max(0, score)}</td></tr>`;
      })
      .join('');
    const next = ctx.kind === 'mission' && victory ? CAMPAIGNS[ctx.mission.faction].find((x) => x.index === ctx.mission.index + 1) : undefined;
    this.teardownGame();
    this.ensureAttract();
    const el = this.show(
      this.menuChrome(`<div class="panel end-screen"><div class="result ${victory ? 'win' : 'lose'}">${victory ? 'VICTORY' : 'DEFEAT'}</div>
      <div style="color:#8595a6;letter-spacing:3px">${ctx.kind === 'mission' ? ctx.mission.name.toUpperCase() : 'SKIRMISH'} · BATTLE TIME ${formatTime(world.time)}</div>
      <table class="stats-table"><tr><th>COMMANDER</th><th>BUILT</th><th>LOST</th><th>KILLS</th><th>STRUCT. LOST</th><th>STRUCT. DESTROYED</th><th>HARVESTED</th><th>SCORE</th></tr>${rows}</table>
      <div class="actions" style="justify-content:center">
        <button class="btn" data-a="menu">MAIN MENU</button>
        <button class="btn" data-a="retry">${victory ? 'PLAY AGAIN' : 'RETRY'}</button>
        ${next ? '<button class="btn primary" data-a="next">NEXT MISSION</button>' : ''}
      </div></div>`),
    );
    el.querySelector('[data-a=menu]')!.addEventListener('click', () => {
      audio.playMusic('menu');
      this.showMain();
    });
    el.querySelector('[data-a=retry]')!.addEventListener('click', () => {
      if (ctx.kind === 'skirmish') this.startSkirmish(ctx.setup);
      else this.showBriefing(ctx.mission);
    });
    el.querySelector('[data-a=next]')?.addEventListener('click', () => this.showBriefing(next!));
  }
}

// ---- map previews for the skirmish screen
const previewCache = new Map<string, HTMLCanvasElement>();
function drawMapPreview(cv: HTMLCanvasElement, id: string) {
  let src = previewCache.get(id);
  if (!src) {
    const spec = SKIRMISH_MAPS.find((m) => m.id === id)!;
    const gen = generateMap(spec);
    const map = gen.map;
    const pal = paletteFor(map.theater);
    src = document.createElement('canvas');
    src.width = map.w;
    src.height = map.h;
    const ctx = src.getContext('2d')!;
    const img = ctx.createImageData(map.w, map.h);
    for (let i = 0; i < map.w * map.h; i++) {
      const t = map.terrain[i];
      let c: number[] = t === Terrain.Rock ? pal.rock[0] : t === Terrain.Water ? [30, 70, 90] : t === Terrain.Sand ? pal.sand[0] : t === Terrain.Dirt ? pal.dirt[0] : t === Terrain.Road ? pal.road : pal.grass[0];
      if (map.oreType[i]) c = map.oreType[i] === 2 ? [150, 110, 255] : [60, 230, 170];
      if (map.doodadBlock[i]) c = [c[0] * 0.6, c[1] * 0.7, c[2] * 0.6];
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    gen.starts.slice(0, spec.players).forEach((s, i) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(s.x - 3, s.z - 3, 7, 7);
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(s.x - 2, s.z - 2, 5, 5);
      void i;
    });
    previewCache.set(id, src);
  }
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
}
