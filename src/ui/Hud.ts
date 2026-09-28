import { BUILDINGS, SUPERWEAPONS } from '../data/buildings';
import { UNITS } from '../data/units';
import { WEAPONS } from '../data/weapons';
import type { BuildTab, BuildingDef, UnitDef } from '../data/types';
import type { Building } from '../game/Building';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { formatTime } from '../game/util';
import { cameo } from '../render/Cameos';
import { Minimap } from './Minimap';
import { ICONS, escapeHtml, hideTooltip } from './widgets';

const TAB_ICONS: Record<BuildTab, string> = {
  structures: '<svg viewBox="0 0 24 24"><path d="M3 21V10l5-3v4l5-3v4l5-3v12H3zm3-2h2v-3H6v3zm5 0h2v-3h-2v3zm5 0h2v-3h-2v3zM19 3h2v6h-2z"/></svg>',
  defense: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3zm0 3.2L7 7v4c0 3.4 2.2 6.6 5 7.9 2.8-1.3 5-4.5 5-7.9V7l-5-1.8z"/></svg>',
  infantry: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><path d="M8 9h8l1 6h-2l-1 7h-4l-1-7H7z"/></svg>',
  vehicles: '<svg viewBox="0 0 24 24"><path d="M3 15h18v3H3zM6 11h10l2 3H4zM10 8h6v2h-6zM16 8.5h6v1h-6z"/><circle cx="6" cy="18.5" r="1.5"/><circle cx="12" cy="18.5" r="1.5"/><circle cx="18" cy="18.5" r="1.5"/></svg>',
  aircraft: '<svg viewBox="0 0 24 24"><path d="M12 2c1 0 1.5 1.5 1.5 3v4l8 5v2l-8-2.5V19l2.5 2v1.5L12 21.5l-4 1V21l2.5-2v-5.5L2.5 16v-2l8-5V5c0-1.5.5-3 1.5-3z"/></svg>',
};
const ARMOR_NAMES: Record<string, string> = { infantry: 'Infantry', light: 'Light vehicles', heavy: 'Tanks', building: 'Structures', aircraft: 'Aircraft' };
function roleText(weaponIds: string[], armor: string): string {
  const ws = weaponIds.map((id) => WEAPONS[id]).filter(Boolean);
  if (!ws.length) return '';
  const best: Record<string, number> = {};
  for (const w of ws)
    for (const k of Object.keys(ARMOR_NAMES)) {
      if (k === 'aircraft' && !w.targetsAir) continue;
      if (k !== 'aircraft' && !w.targetsGround) continue;
      best[k] = Math.max(best[k] ?? 0, (w.damage * (w.burst ?? 1) * (w.vs as Record<string, number>)[k]) / w.cooldown);
    }
  const max = Math.max(...Object.values(best), 0.01);
  const strong = Object.keys(best).filter((k) => best[k] >= max * 0.7).map((k) => ARMOR_NAMES[k]);
  const weak = Object.keys(ARMOR_NAMES).filter((k) => (best[k] ?? 0) < max * 0.3).map((k) => ARMOR_NAMES[k]);
  const range = Math.max(...ws.map((w) => w.range));
  void armor;
  return `<div class="role"><span class="pos">Strong vs: ${strong.join(', ')}</span>${weak.length ? `<br><span class="neg">Weak vs: ${weak.join(', ')}</span>` : ''}<br><span>Range ${range}${ws.some((w) => w.targetsAir) ? ' · Anti-air' : ''}</span></div>`;
}

const TABS: BuildTab[] = ['structures', 'defense', 'infantry', 'vehicles', 'aircraft'];
const TAB_NAMES: Record<BuildTab, string> = { structures: 'Structures', defense: 'Defenses', infantry: 'Infantry', vehicles: 'Vehicles', aircraft: 'Aircraft' };

interface LogLine {
  t: number;
  html: string;
  color: string;
}

export class Hud {
  root: HTMLElement;
  game: Game;
  minimap: Minimap;
  private sidebar: HTMLElement;
  private vp: HTMLElement;
  private tab: BuildTab = 'structures';
  private grid: HTMLElement;
  private creditsEl: HTMLElement;
  private powerEl: HTMLElement;
  private powerVal: HTMLElement;
  private powerFill: HTMLElement;
  private powerUse: HTMLElement;
  private tabEls = new Map<BuildTab, HTMLElement>();
  private cameoEls = new Map<string, { el: HTMLElement; clock: HTMLCanvasElement; status: HTMLElement; count: HTMLElement }>();
  private gridKey = '';
  private gridCols = 3;
  private shownCredits = 0;
  private evaLog: HTMLElement;
  private tooltip: HTMLElement;
  private tipId: string | null = null;
  private sel: HTMLElement;
  private selKey = '';
  private swEl: HTMLElement;
  private queueEl: HTMLElement;
  private queueKey = '';
  private objPanel: HTMLElement;
  private sbObj: HTMLElement;
  private topClock: HTMLElement;
  private missionTimer: HTMLElement;
  private speedEl: HTMLElement;
  private sellBtn: HTMLElement;
  private repairBtn: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private objKey = '';
  private logLines: LogLine[] = [];
  private logEl: HTMLElement | null = null;
  private logBtn: HTMLElement;
  private unread = 0;
  private commando: boolean | null = null;
  private commandoT = 0;
  private readySince = new Map<BuildTab, { id: string; t: number; told: boolean }>();
  private ro: ResizeObserver;
  onMenu: (() => void) | null = null;

  constructor(game: Game, container: HTMLElement) {
    this.game = game;
    this.root = container;
    const sidebar = container.querySelector('#sidebar') as HTMLElement;
    const vp = container.querySelector('#viewport') as HTMLElement;
    this.sidebar = sidebar;
    this.vp = vp;
    const f = game.factionDef;
    sidebar.innerHTML = `
      <div class="sb-header"><span>${f.short}</span><button class="menu-btn" data-tip="Pause menu (Esc)" data-tip-pos="bottom">MENU</button></div>
      <div class="radar"></div>
      <div class="sb-objectives"></div>
      <div class="sb-eco">
        <div class="credits-row"><span class="label">CREDITS</span><span class="credits">$0</span></div>
        <div class="power"><div class="pw-row"><span class="label">POWER</span><span class="pv"></span></div><div class="pw-bar"><div class="fill"></div><div class="use"></div></div></div>
        <div class="tools-row">
          <button class="tool-btn repair" data-tip="Repair mode <kbd>R</kbd>">${ICONS.wrench}<span>REPAIR</span></button>
          <button class="tool-btn sell" data-tip="Sell mode <kbd>Z</kbd>">${ICONS.dollar}<span>SELL</span></button>
        </div>
      </div>
      <div class="tabs"></div>
      <div class="build-grid"></div>
      <div class="queue-strip"></div>
      <div class="superweapons"></div>`;
    this.minimap = new Minimap(sidebar.querySelector('.radar') as HTMLElement, game);
    this.creditsEl = sidebar.querySelector('.credits') as HTMLElement;
    this.powerEl = sidebar.querySelector('.power') as HTMLElement;
    this.powerVal = sidebar.querySelector('.pv') as HTMLElement;
    this.powerFill = sidebar.querySelector('.pw-bar .fill') as HTMLElement;
    this.powerUse = sidebar.querySelector('.pw-bar .use') as HTMLElement;
    this.grid = sidebar.querySelector('.build-grid') as HTMLElement;
    this.swEl = sidebar.querySelector('.superweapons') as HTMLElement;
    this.queueEl = sidebar.querySelector('.queue-strip') as HTMLElement;
    this.sbObj = sidebar.querySelector('.sb-objectives') as HTMLElement;
    this.sellBtn = sidebar.querySelector('.sell') as HTMLElement;
    this.repairBtn = sidebar.querySelector('.repair') as HTMLElement;
    this.sellBtn.addEventListener('click', () => game.setMode(game.mode === 'sell' ? 'normal' : 'sell'));
    this.repairBtn.addEventListener('click', () => game.setMode(game.mode === 'repair' ? 'normal' : 'repair'));
    (sidebar.querySelector('.menu-btn') as HTMLElement).addEventListener('click', () => this.onMenu?.());
    const tabs = sidebar.querySelector('.tabs') as HTMLElement;
    for (const t of TABS) {
      const el = document.createElement('div');
      el.className = 'tab';
      el.dataset.tip = `${TAB_NAMES[t]} <kbd>Tab</kbd>`;
      el.dataset.tipPos = 'top';
      el.innerHTML = TAB_ICONS[t] + '<span class="badge"></span>';
      el.addEventListener('click', () => {
        this.tab = t;
        this.gridKey = '';
      });
      tabs.appendChild(el);
      this.tabEls.set(t, el);
    }

    // viewport overlays
    const top = document.createElement('div');
    top.className = 'topbar';
    top.innerHTML = `<button class="top-btn obj-btn" data-tip="Objectives <kbd>O</kbd>" data-tip-pos="bottom">${ICONS.flag}<span>OBJECTIVES</span></button>
      <button class="top-btn log-btn" data-tip="Transmission log <kbd>L</kbd>" data-tip-pos="bottom">${ICONS.log}<span>LOG</span><i class="unread"></i></button>
      <span class="chip clock"></span><span class="chip speed"></span><span class="mission-timer"></span>`;
    vp.appendChild(top);
    this.topClock = top.querySelector('.clock') as HTMLElement;
    this.missionTimer = top.querySelector('.mission-timer') as HTMLElement;
    this.speedEl = top.querySelector('.speed') as HTMLElement;
    this.logBtn = top.querySelector('.log-btn') as HTMLElement;
    this.objPanel = document.createElement('div');
    this.objPanel.className = 'objectives-panel';
    vp.appendChild(this.objPanel);
    (top.querySelector('.obj-btn') as HTMLElement).addEventListener('click', () => this.toggleObjectives());
    this.logBtn.addEventListener('click', () => this.toggleLog());
    this.evaLog = document.createElement('div');
    this.evaLog.className = 'eva-log';
    vp.appendChild(this.evaLog);
    this.sel = document.createElement('div');
    this.sel.className = 'selpanel hidden';
    vp.appendChild(this.sel);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    document.body.appendChild(this.tooltip);
    const onObjClick = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('.op-x')) {
        this.objPanel.classList.remove('show');
        return;
      }
      const row = t.closest('.obj.has-beacon') as HTMLElement | null;
      if (row) this.jumpToBeacon(row.dataset.id!);
    };
    this.objPanel.addEventListener('click', onObjClick);
    this.sbObj.addEventListener('click', onObjClick);

    window.addEventListener('keydown', this.onKey);
    this.shownCredits = game.me.credits;
    this.ro = new ResizeObserver(() => {
      this.gridKey = '';
    });
    this.ro.observe(this.grid);
    this.updateCommando(true);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.ro.disconnect();
    this.minimap.destroy();
    this.tooltip.remove();
    hideTooltip();
  }

  /** Closes transient overlays (log). Returns true if something was closed. */
  closeOverlays(): boolean {
    if (this.logEl) {
      this.toggleLog(false);
      return true;
    }
    return false;
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.game.paused) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const avail = TABS.filter((t) => this.game.tabItems(t).length > 0);
      const i = avail.indexOf(this.tab);
      this.tab = avail[(i + (e.shiftKey ? avail.length - 1 : 1)) % avail.length] ?? 'structures';
      this.gridKey = '';
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'o' || e.key === 'O') this.toggleObjectives();
    if (e.key === 'l' || e.key === 'L') this.toggleLog();
  };

  private toggleObjectives() {
    this.objPanel.classList.toggle('show');
    clearTimeout(this.objHideT);
  }

  private jumpToBeacon(id: string) {
    const bc = this.game.beacons.find((b) => b.id === id);
    if (!bc) return;
    const x = bc.entity && !bc.entity.dead ? bc.entity.x : bc.x;
    const z = bc.entity && !bc.entity.dead ? bc.entity.z : bc.z;
    this.game.jumpTo(x, z);
  }

  // ---------------------------------------------------------------- radio / EVA
  message(text: string, color = '#9fe8ff') {
    const m = /^([A-Z][\w .'’-]{1,28}):\s+(.+)$/s.exec(text);
    const html = m ? `<b>${escapeHtml(m[1])}</b> ${escapeHtml(m[2])}` : escapeHtml(text);
    const el = document.createElement('div');
    el.className = 'eva-line';
    el.style.setProperty('--c', color);
    el.innerHTML = html;
    this.evaLog.appendChild(el);
    while (this.evaLog.children.length > 5) this.evaLog.firstChild?.remove();
    const ms = Math.max(6000, 2800 + text.length * 60);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 800);
    this.logLines.push({ t: this.game.world.time, html, color });
    if (this.logLines.length > 30) this.logLines.shift();
    if (this.logEl) this.renderLog();
    else {
      this.unread++;
      this.logBtn.classList.add('has-unread');
    }
  }

  private toggleLog(force?: boolean) {
    const open = force ?? !this.logEl;
    if (!open) {
      this.logEl?.remove();
      this.logEl = null;
      return;
    }
    if (this.logEl) return;
    this.unread = 0;
    this.logBtn.classList.remove('has-unread');
    const el = document.createElement('div');
    el.className = 'tx-log';
    el.innerHTML = `<div class="tx-head"><h4>TRANSMISSIONS</h4><span class="muted">last ${30} · <kbd>L</kbd></span><button class="x" aria-label="Close">${ICONS.close}</button></div><div class="tx-body"></div>`;
    el.querySelector('.x')!.addEventListener('click', () => this.toggleLog(false));
    // keep wheel scrolling inside the log from zooming the map
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.vp.appendChild(el);
    this.logEl = el;
    this.renderLog();
  }

  private renderLog() {
    if (!this.logEl) return;
    const body = this.logEl.querySelector('.tx-body') as HTMLElement;
    body.innerHTML = this.logLines.length
      ? this.logLines.map((l) => `<div class="tx-row" style="--c:${l.color}"><span class="t">${formatTime(l.t)}</span><span class="m">${l.html}</span></div>`).join('')
      : '<div class="muted" style="padding:8px 2px">No transmissions yet.</div>';
    body.scrollTop = body.scrollHeight;
  }

  // ---------------------------------------------------------------- hints
  showHint(html: string | null) {
    this.hintEl?.remove();
    this.hintEl = null;
    if (!html) return;
    const el = document.createElement('div');
    el.className = 'hint';
    el.innerHTML = `<div class="hint-body">${html}</div><button class="hint-x">GOT IT</button>`;
    el.querySelector('.hint-x')!.addEventListener('click', () => {
      el.remove();
      if (this.hintEl === el) this.hintEl = null;
    });
    this.vp.appendChild(el);
    this.hintEl = el;
  }

  setPaused(p: boolean) {
    void p; // the pause modal carries its own title
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.game;
    const me = g.me;
    this.minimap.update(dt);
    this.commandoT -= dt;
    if (this.commandoT <= 0) {
      this.commandoT = 0.25;
      this.updateCommando();
    }
    // credits count-up
    const diff = me.credits - this.shownCredits;
    this.shownCredits += Math.sign(diff) * Math.min(Math.abs(diff), Math.max(8, Math.abs(diff) * 8 * dt));
    this.creditsEl.textContent = '$' + Math.floor(this.shownCredits).toLocaleString('en-US');
    // power
    const maxP = Math.max(me.powerProduced, me.powerUsed, 100) * 1.1;
    this.powerFill.style.width = (me.powerProduced / maxP) * 100 + '%';
    this.powerUse.style.left = Math.min(99.5, (me.powerUsed / maxP) * 100) + '%';
    const surplus = me.powerProduced - me.powerUsed;
    const pv = me.powerProduced === 0 && me.powerUsed === 0 ? '0' : me.lowPower ? `${surplus} LOW` : `+${surplus}`;
    if (this.powerVal.textContent !== pv) this.powerVal.textContent = pv;
    this.powerEl.dataset.tip = `Produced <b>${me.powerProduced}</b> · Used <b>${me.powerUsed}</b>`;
    this.powerEl.classList.toggle('low', me.lowPower);
    this.powerEl.classList.toggle('idle', me.powerProduced === 0 && me.powerUsed === 0);
    this.sellBtn.classList.toggle('active', g.mode === 'sell');
    this.repairBtn.classList.toggle('active', g.mode === 'repair');
    // tabs
    for (const t of TABS) {
      const el = this.tabEls.get(t)!;
      const items = g.tabItems(t);
      const anyAvail = items.some((id) => me.canBuild(id));
      el.classList.toggle('active', t === this.tab);
      el.classList.toggle('disabled', !anyAvail);
      const q = me.queues[t];
      el.classList.toggle('ready', !!q.ready);
      el.classList.toggle('busy', !q.ready && q.items.length > 0);
    }
    this.updateReady();
    this.updateGrid();
    this.updateQueue();
    this.updateSuperweapons();
    this.updateSelection();
    this.updateTopbar();
    this.updateTooltip();
  }

  /** Re-evaluate the sidebar layout now (e.g. right after a mission script applied its restrictions). */
  refreshLayout() {
    this.updateCommando(true);
  }

  /** Commando missions (nothing buildable, no money): collapse the sidebar to radar + objectives. */
  private updateCommando(force = false) {
    const g = this.game;
    const me = g.me;
    const commando = me.credits <= 0 && TABS.every((t) => g.tabItems(t).length === 0 && me.queues[t].items.length === 0 && !me.queues[t].ready) && me.superweapons.size === 0;
    if (commando === this.commando && !force) return;
    this.commando = commando;
    this.root.classList.toggle('commando', commando);
    this.objKey = '';
    g.resize();
    this.minimap.resize();
  }

  private updateReady() {
    const g = this.game;
    const t = g.world.time;
    for (const tab of ['structures', 'defense'] as BuildTab[]) {
      const q = g.me.queues[tab];
      const cur = this.readySince.get(tab);
      if (!q.ready) {
        this.readySince.delete(tab);
        continue;
      }
      if (!cur || cur.id !== q.ready) {
        this.readySince.set(tab, { id: q.ready, t, told: false });
        continue;
      }
      if (!cur.told && t - cur.t > 25 && g.mode !== 'place') {
        cur.told = true;
        const name = BUILDINGS[q.ready]?.name ?? 'Structure';
        g.message(`${name} is ready. Click the READY icon, then click the ground to place it.`, '#ffd76a');
        if (this.tab !== tab) {
          this.tab = tab;
          this.gridKey = '';
        }
      }
    }
  }

  private fitColumns(n: number) {
    const W = this.grid.clientWidth - 12, H = this.grid.clientHeight - 12;
    if (W <= 0 || H <= 0 || n === 0) return 3;
    const gap = 5;
    const fits = (cols: number) => {
      const cw = (W - gap * (cols - 1)) / cols;
      const rows = Math.ceil(n / cols);
      return rows * cw * 0.75 + gap * (rows - 1) <= H;
    };
    return n <= 6 && fits(2) ? 2 : 3;
  }

  private updateGrid() {
    const g = this.game;
    const me = g.me;
    const items = g.tabItems(this.tab);
    const key = this.tab + '|' + items.join(',');
    if (key !== this.gridKey) {
      this.gridKey = key;
      this.grid.innerHTML = '';
      this.cameoEls.clear();
      this.gridCols = this.fitColumns(items.length);
      this.grid.style.setProperty('--cols', String(this.gridCols));
      this.grid.classList.toggle('big', this.gridCols === 2);
      for (const id of items) {
        const def: UnitDef | BuildingDef = UNITS[id] ?? BUILDINGS[id];
        const el = document.createElement('div');
        el.className = 'cameo';
        const img = cameo(id);
        if (img) el.style.backgroundImage = `url(${img})`;
        el.innerHTML = `<span class="cost">$${def.cost}</span><span class="name">${def.name}</span>`;
        const clock = document.createElement('canvas');
        clock.className = 'clock';
        clock.width = 88;
        clock.height = 66;
        el.appendChild(clock);
        const status = document.createElement('div');
        status.className = 'status';
        el.appendChild(status);
        const count = document.createElement('div');
        count.className = 'count';
        count.style.display = 'none';
        el.appendChild(count);
        el.addEventListener('click', (e) => g.clickBuild(id, e.shiftKey));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          g.rightClickBuild(id);
        });
        el.addEventListener('mouseenter', () => (this.tipId = id));
        el.addEventListener('mouseleave', () => {
          if (this.tipId === id) this.tipId = null;
        });
        this.grid.appendChild(el);
        this.cameoEls.set(id, { el, clock, status, count });
      }
      if (!items.length) this.grid.innerHTML = `<div class="grid-empty">Nothing to build here yet.</div>`;
    }
    const q = me.queues[this.tab];
    for (const [id, c] of this.cameoEls) {
      const def: UnitDef | BuildingDef = UNITS[id] ?? BUILDINGS[id];
      const can = me.canBuild(id);
      c.el.classList.toggle('locked', !can);
      c.el.classList.toggle('unaffordable', can && me.credits < def.cost * 0.2 && q.items[0]?.defId !== id);
      const ctx = c.clock.getContext('2d')!;
      ctx.clearRect(0, 0, 88, 66);
      let status = '',
        cls = '';
      const n = q.items.filter((i) => i.defId === id).length;
      const ready = q.ready === id;
      c.el.classList.toggle('is-ready', ready);
      if (ready) {
        status = 'READY';
        cls = 'ready';
      } else if (q.items[0]?.defId === id) {
        const it = q.items[0];
        // clock wipe darkening for remaining part
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.beginPath();
        ctx.moveTo(44, 33);
        ctx.arc(44, 33, 80, -Math.PI / 2 + it.progress * Math.PI * 2, Math.PI * 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,140,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(44, 33);
        const a = -Math.PI / 2 + it.progress * Math.PI * 2;
        ctx.lineTo(44 + Math.cos(a) * 80, 33 + Math.sin(a) * 80);
        ctx.stroke();
        if (it.onHold) {
          status = 'ON HOLD';
          cls = 'hold';
        }
      } else if (n > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, 88, 66);
      }
      if (c.status.textContent !== status) c.status.textContent = status;
      c.status.className = 'status ' + cls;
      const shown = UNITS[id] ? n : 0;
      c.count.style.display = shown > 1 || (shown === 1 && q.items[0]?.defId !== id) ? 'flex' : 'none';
      c.count.textContent = String(shown);
    }
  }

  /** Production strip: everything queued in every tab, with progress, so the lower sidebar is useful. */
  private updateQueue() {
    const me = this.game.me;
    const chips: { tab: BuildTab; id: string; n: number; progress: number; ready: boolean; hold: boolean }[] = [];
    for (const t of TABS) {
      const q = me.queues[t];
      if (q.ready) chips.push({ tab: t, id: q.ready, n: 1, progress: 1, ready: true, hold: false });
      q.items.forEach((it, i) => {
        const last = chips[chips.length - 1];
        if (i > 0 && last && last.tab === t && last.id === it.defId && !last.ready) last.n++;
        else chips.push({ tab: t, id: it.defId, n: 1, progress: i === 0 ? it.progress : 0, ready: false, hold: !!it.onHold });
      });
    }
    const key = chips.map((c) => `${c.tab}:${c.id}:${c.n}:${c.ready ? 1 : 0}:${c.hold ? 1 : 0}`).join('|');
    if (key !== this.queueKey) {
      this.queueKey = key;
      this.queueEl.classList.toggle('show', chips.length > 0);
      this.queueEl.innerHTML = chips.length
        ? `<div class="qs-label">PRODUCTION</div><div class="qs-row">${chips
            .map((c, i) => {
              const def = UNITS[c.id] ?? BUILDINGS[c.id];
              return `<div class="qchip ${c.ready ? 'ready' : ''} ${c.hold ? 'hold' : ''}" data-i="${i}" data-tab="${c.tab}" data-tip="${escapeHtml(def?.name ?? c.id)}${c.ready ? ' · READY' : c.hold ? ' · ON HOLD' : ''}" style="background-image:url(${cameo(c.id)})">${c.n > 1 ? `<span class="n">${c.n}</span>` : ''}<i style="width:${c.progress * 100}%"></i></div>`;
            })
            .join('')}</div>`
        : '';
      this.queueEl.querySelectorAll('.qchip').forEach((el) =>
        el.addEventListener('click', () => {
          this.tab = (el as HTMLElement).dataset.tab as BuildTab;
          this.gridKey = '';
        }),
      );
    }
    const els = this.queueEl.querySelectorAll('.qchip i');
    chips.forEach((c, i) => {
      const bar = els[i] as HTMLElement | undefined;
      if (bar && !c.ready) bar.style.width = c.progress * 100 + '%';
    });
  }

  private updateSuperweapons() {
    const me = this.game.me;
    const sws = [...me.superweapons.values()];
    this.updateEnemySuperweapons();
    const key = sws.map((s) => s.id).join(',');
    if (this.swEl.dataset.key !== key) {
      this.swEl.dataset.key = key;
      this.swEl.innerHTML = '';
      for (const s of sws) {
        const el = document.createElement('div');
        el.className = 'sw';
        el.dataset.id = s.id;
        el.innerHTML = `<div class="bar"></div><div class="txt"><span>${SUPERWEAPONS[s.id].name.toUpperCase()}</span><span class="t"></span></div>`;
        el.addEventListener('click', () => {
          const st = me.superweapons.get(s.id);
          if (st?.ready) this.game.beginSuperweapon(s.id);
        });
        this.swEl.appendChild(el);
      }
    }
    for (const el of Array.from(this.swEl.children) as HTMLElement[]) {
      const s = me.superweapons.get(el.dataset.id as never);
      if (!s) continue;
      const def = SUPERWEAPONS[s.id];
      (el.querySelector('.bar') as HTMLElement).style.width = (s.charge / def.chargeTime) * 100 + '%';
      (el.querySelector('.t') as HTMLElement).textContent = s.ready ? 'READY' : me.lowPower ? 'NO POWER' : formatTime(def.chargeTime - s.charge);
      el.classList.toggle('ready', s.ready);
    }
  }

  private enemySwEl: HTMLElement | null = null;
  private updateEnemySuperweapons() {
    const g = this.game;
    const w = g.world;
    const rows: string[] = [];
    for (const b of w.buildings) {
      if (!b.def.superweapon || !b.owner.isEnemyOf(g.me) || !w.visibleTo(b, g.me) || b.constructing < 1) continue;
      const st = b.owner.superweapons.get(b.def.superweapon);
      if (!st) continue;
      const def = SUPERWEAPONS[st.id];
      rows.push(`<div class="esw"><span>ENEMY ${def.name.toUpperCase()}</span><span>${st.ready ? 'READY' : formatTime(def.chargeTime - st.charge)}</span></div>`);
    }
    if (!this.enemySwEl) {
      this.enemySwEl = document.createElement('div');
      this.enemySwEl.className = 'enemy-sw';
      this.vp.appendChild(this.enemySwEl);
    }
    const html = rows.join('');
    if (this.enemySwEl.innerHTML !== html) this.enemySwEl.innerHTML = html;
  }

  private updateSelection() {
    const g = this.game;
    const sel = g.selection;
    const key = sel.map((e) => e.id + (e.kind === 'unit' ? ((e as Unit).holdGround ? 'g' : '') + ((e as Unit).holdFire ? 'f' : '') : '')).join(',') + '|' + sel.map((e) => Math.round((e.hp / e.maxHp) * 20)).join(',') + (sel[0] && sel[0].kind === 'building' ? (sel[0] as Building).repairing : '');
    if (key === this.selKey) return;
    this.selKey = key;
    if (sel.length === 0) {
      this.sel.classList.add('hidden');
      this.vp.style.setProperty('--sel-h', '0px');
      return;
    }
    this.sel.classList.remove('hidden');
    if (sel.length === 1) {
      const e = sel[0];
      const mine = e.owner === g.me;
      const hp = e.hp / e.maxHp;
      let sub = e.owner.isNeutral ? 'Neutral' : mine ? 'Friendly' : e.owner.name;
      let cmds = '';
      if (e.kind === 'unit') {
        const u = e as Unit;
        if (u.rank) sub += ` · ${u.rank === 2 ? 'Elite' : 'Veteran'}`;
        if (u.def.harvester) sub += ` · Cargo ${Math.round(u.cargoRatio() * 100)}%`;
        if (mine) {
          cmds += `<button class="cmd" data-c="stop"><kbd>S</kbd>Stop</button>`;
          if (u.weapons.length) cmds += `<button class="cmd" data-c="amove"><kbd>A</kbd>Attack-move</button>`;
          if (u.def.mcv) cmds += `<button class="cmd" data-c="deploy"><kbd>D</kbd>Deploy</button>`;
          cmds += `<button class="cmd" data-c="scatter"><kbd>X</kbd>Scatter</button>`;
          if (u.weapons.length) {
            cmds += `<button class="cmd${u.holdGround ? ' on' : ''}" data-c="hold"><kbd>G</kbd>Hold ground</button>`;
            cmds += `<button class="cmd${u.holdFire ? ' on' : ''}" data-c="holdfire"><kbd>F</kbd>Hold fire</button>`;
            sub += u.holdFire ? ' · Holding fire' : u.holdGround ? ' · Holding ground' : '';
          }
        }
      } else {
        const b = e as Building;
        if (b.def.power) sub += ` · Power ${b.def.power > 0 ? '+' : ''}${b.def.power}`;
        if (mine) {
          cmds += `<button class="cmd" data-c="repair">${b.repairing ? 'Stop repair' : 'Repair'}</button><button class="cmd" data-c="sell">Sell</button>`;
          if (b.def.produces && b.def.produces !== 'yard') cmds += `<span class="sub" style="align-self:center">Right-click map: set rally point</span>`;
        }
      }
      this.sel.innerHTML = `<div class="portrait" style="background-image:url(${cameo(e.typeId)})"></div>
        <div class="info"><div class="title">${e.name}</div><div class="sub">${sub}</div>
        <div class="hpbar"><div style="width:${hp * 100}%;background:${hp > 0.6 ? '#4dff5a' : hp > 0.3 ? '#ffd23a' : '#ff3b30'}"></div></div>
        <div class="sub">${Math.ceil(e.hp)} / ${e.maxHp}</div><div class="cmds">${cmds}</div></div>`;
    } else {
      // group by type
      const byType = new Map<string, Unit[]>();
      for (const e of sel) if (e.kind === 'unit') (byType.get(e.typeId) ?? byType.set(e.typeId, []).get(e.typeId)!).push(e as Unit);
      let html = '<div class="multi">';
      for (const [id, list] of byType) {
        const avg = list.reduce((s, u) => s + u.hp / u.maxHp, 0) / list.length;
        html += `<div class="mini" data-t="${id}" style="background-image:url(${cameo(id)})" data-tip="${escapeHtml(list[0].name)}<br><small>Click: select only · Shift: deselect</small>"><i style="width:${avg * 100}%"></i><span>${list.length}</span></div>`;
      }
      html += '</div>';
      html += `<div class="info"><div class="title">${sel.length} units</div><div class="cmds">
        <button class="cmd" data-c="stop"><kbd>S</kbd>Stop</button><button class="cmd" data-c="amove"><kbd>A</kbd>Attack-move</button><button class="cmd" data-c="scatter"><kbd>X</kbd>Scatter</button><button class="cmd" data-c="hold"><kbd>G</kbd>Hold ground</button><button class="cmd" data-c="holdfire"><kbd>F</kbd>Hold fire</button></div>
        <div class="sub">⌘/Ctrl+1-9: assign group</div></div>`;
      this.sel.innerHTML = html;
      this.sel.querySelectorAll('.mini').forEach((m) =>
        m.addEventListener('click', (ev) => {
          const t = (m as HTMLElement).dataset.t!;
          const keep = sel.filter((s) => s.typeId === t);
          if ((ev as MouseEvent).shiftKey) g.select(sel.filter((s) => s.typeId !== t));
          else g.select(keep);
        }),
      );
    }
    this.sel.querySelectorAll('.cmd').forEach((b) =>
      b.addEventListener('click', () => {
        const c = (b as HTMLElement).dataset.c;
        const units = g.selection.filter((s): s is Unit => s.kind === 'unit' && s.owner === g.me);
        if (c === 'stop') units.forEach((u) => u.issue({ type: 'idle' }, g.world));
        if (c === 'amove') g.setMode('attackMove');
        if (c === 'deploy') units.filter((u) => u.def.mcv).forEach((u) => u.issue({ type: 'deploy' }, g.world));
        if (c === 'scatter')
          units.forEach((u) => {
            const a = Math.random() * Math.PI * 2;
            u.issue({ type: 'move', x: u.x + Math.cos(a) * 2.5, z: u.z + Math.sin(a) * 2.5 }, g.world);
          });
        if (c === 'hold') {
          const on = !units.every((u) => u.holdGround);
          units.forEach((u) => {
            u.holdGround = on;
            u.issue({ type: 'idle' }, g.world);
          });
        }
        if (c === 'holdfire') {
          const on = !units.every((u) => u.holdFire);
          units.forEach((u) => {
            u.holdFire = on;
            if (on) u.target = null;
          });
        }
        const b0 = g.selection[0] as Building;
        if (c === 'repair' && b0) g.world.toggleRepair(b0);
        if (c === 'sell' && b0) g.world.sell(b0);
        this.selKey = '';
      }),
    );
    // keep the hint box clear of a tall selection panel
    this.vp.style.setProperty('--sel-h', this.sel.offsetHeight + 'px');
  }

  private updateTopbar() {
    const g = this.game;
    const clock = formatTime(g.world.time);
    if (this.topClock.textContent !== clock) this.topClock.textContent = clock;
    const sp = g.speed !== 1 ? `SPEED ${Math.round(g.speed * 100)}%` : '';
    if (this.speedEl.textContent !== sp) this.speedEl.textContent = sp;
    this.speedEl.style.display = sp ? '' : 'none';
    if (g.missionTimer) {
      this.missionTimer.textContent = `${g.missionTimer.label} ${formatTime(g.missionTimer.seconds)}`;
    } else this.missionTimer.textContent = '';
    const beaconIds = new Set(g.beacons.filter((b) => !b.entity?.dead).map((b) => b.id));
    const ok = JSON.stringify(g.objectives);
    const key = ok + '|' + [...beaconIds].join(',');
    if (key !== this.objKey) {
      const changed = ok !== this.objOnly;
      this.objOnly = ok;
      this.objKey = key;
      const rows = g.objectives.length
        ? g.objectives
            .map((o) => {
              const bc = beaconIds.has(o.id) && !o.done && !o.failed;
              return `<div class="obj ${o.done ? 'done' : ''} ${o.failed ? 'failed' : ''} ${o.optional ? 'optional' : ''} ${bc ? 'has-beacon' : ''}" data-id="${escapeHtml(o.id)}"${bc ? ' data-tip="Show on map"' : ''}><span class="box"></span><span class="txt">${o.optional ? '<em>Optional</em> ' : ''}${o.text}</span>${bc ? `<span class="go">${ICONS.target}</span>` : ''}</div>`;
            })
            .join('')
        : '<div class="obj"><span class="box"></span><span class="txt">Destroy all enemy forces.</span></div>';
      this.objPanel.innerHTML = `<div class="op-head"><h4>OBJECTIVES</h4><button class="op-x" aria-label="Close">${ICONS.close}</button></div>${rows}`;
      this.sbObj.innerHTML = `<h4>OBJECTIVES</h4>${rows}`;
      if (g.objectives.length && changed && !this.commando) {
        this.objPanel.classList.add('show');
        clearTimeout(this.objHideT);
        this.objHideT = window.setTimeout(() => this.objPanel.classList.remove('show'), 9000);
      }
    }
  }
  private objHideT = 0;
  private objOnly = '';

  private updateTooltip() {
    const id = this.tipId;
    if (!id || !this.cameoEls.get(id)?.el.isConnected) {
      this.tooltip.classList.remove('show');
      return;
    }
    const me = this.game.me;
    const def: UnitDef | BuildingDef = UNITS[id] ?? BUILDINGS[id];
    const isB = !!BUILDINGS[id];
    const missing = def.prereqs.filter((p) => !me.has(p)).map((p) => BUILDINGS[p]?.name ?? p);
    let stats = `<span>$${def.cost}</span><span>${Math.round(def.buildTime)}s</span>`;
    if (isB) {
      const b = def as unknown as BuildingDef;
      if (b.power) stats += `<span class="${b.power > 0 ? 'pos' : 'neg'}">PWR ${b.power > 0 ? '+' : ''}${b.power}</span>`;
    } else {
      const u = def as UnitDef;
      stats += `<span>HP ${u.hp}</span><span>SPD ${u.speed.toFixed(1)}</span>`;
    }
    const role = roleText((def as { weapons?: string[] }).weapons ?? [], isB ? 'building' : (def as UnitDef).armor);
    const ready = me.queues[def.tab].ready === id;
    const html = `<h5>${def.name}</h5><div class="stats">${stats}</div><p>${def.description}</p>${role}${missing.length ? `<div class="req">Requires: ${missing.join(', ')}</div>` : ''}<p class="how">${ready ? '<b class="good">READY:</b> click, then click the ground to place' : `Click: build${!isB ? ' (Shift: ×5)' : ''} · Right-click: hold / cancel`}</p>`;
    if (this.tooltip.innerHTML !== html) this.tooltip.innerHTML = html;
    const r = (this.cameoEls.get(id)?.el ?? this.grid).getBoundingClientRect();
    this.tooltip.style.left = Math.max(8, r.left - 282) + 'px';
    this.tooltip.style.top = Math.max(8, Math.min(window.innerHeight - this.tooltip.offsetHeight - 8, r.top)) + 'px';
    this.tooltip.classList.add('show');
  }
}
