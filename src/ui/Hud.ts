import { BUILDINGS, SUPERWEAPONS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { BuildTab, BuildingDef, UnitDef } from '../data/types';
import type { Building } from '../game/Building';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { formatTime } from '../game/util';
import { cameo } from '../render/Cameos';
import { Minimap } from './Minimap';

const TAB_ICONS: Record<BuildTab, string> = {
  structures: '<svg viewBox="0 0 24 24"><path d="M3 21V10l5-3v4l5-3v4l5-3v12H3zm3-2h2v-3H6v3zm5 0h2v-3h-2v3zm5 0h2v-3h-2v3zM19 3h2v6h-2z"/></svg>',
  defense: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3zm0 3.2L7 7v4c0 3.4 2.2 6.6 5 7.9 2.8-1.3 5-4.5 5-7.9V7l-5-1.8z"/></svg>',
  infantry: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><path d="M8 9h8l1 6h-2l-1 7h-4l-1-7H7z"/></svg>',
  vehicles: '<svg viewBox="0 0 24 24"><path d="M3 15h18v3H3zM6 11h10l2 3H4zM10 8h6v2h-6zM16 8.5h6v1h-6z"/><circle cx="6" cy="18.5" r="1.5"/><circle cx="12" cy="18.5" r="1.5"/><circle cx="18" cy="18.5" r="1.5"/></svg>',
  aircraft: '<svg viewBox="0 0 24 24"><path d="M12 2c1 0 1.5 1.5 1.5 3v4l8 5v2l-8-2.5V19l2.5 2v1.5L12 21.5l-4 1V21l2.5-2v-5.5L2.5 16v-2l8-5V5c0-1.5.5-3 1.5-3z"/></svg>',
};
const TABS: BuildTab[] = ['structures', 'defense', 'infantry', 'vehicles', 'aircraft'];
const TAB_NAMES: Record<BuildTab, string> = { structures: 'Structures', defense: 'Defenses', infantry: 'Infantry', vehicles: 'Vehicles', aircraft: 'Aircraft' };

export class Hud {
  root: HTMLElement;
  game: Game;
  minimap: Minimap;
  private tab: BuildTab = 'structures';
  private grid: HTMLElement;
  private creditsEl: HTMLElement;
  private powerEl: HTMLElement;
  private tabEls = new Map<BuildTab, HTMLElement>();
  private cameoEls = new Map<string, { el: HTMLElement; clock: HTMLCanvasElement; status: HTMLElement; count: HTMLElement }>();
  private gridKey = '';
  private shownCredits = 0;
  private evaLog: HTMLElement;
  private tooltip: HTMLElement;
  private tipId: string | null = null;
  private sel: HTMLElement;
  private selKey = '';
  private swEl: HTMLElement;
  private objPanel: HTMLElement;
  private topClock: HTMLElement;
  private missionTimer: HTMLElement;
  private speedEl: HTMLElement;
  private pauseEl: HTMLElement;
  private sellBtn: HTMLElement;
  private repairBtn: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private objKey = '';
  onMenu: (() => void) | null = null;

  constructor(game: Game, container: HTMLElement) {
    this.game = game;
    this.root = container;
    const sidebar = container.querySelector('#sidebar') as HTMLElement;
    const vp = container.querySelector('#viewport') as HTMLElement;
    const f = game.factionDef;
    sidebar.innerHTML = `
      <div class="sb-header"><span>${f.short}</span><button class="menu-btn">MENU</button></div>
      <div class="radar"></div>
      <div class="credits-row"><span class="label">CREDITS</span><span class="credits">$0</span></div>
      <div class="power"><div class="fill"></div><div class="use"></div><div class="txt"><span>POWER</span><span class="pv"></span></div></div>
      <div class="tools-row">
        <button class="tool-btn repair" title="Repair (R)">🔧 REPAIR</button>
        <button class="tool-btn sell" title="Sell (Z)">$ SELL</button>
      </div>
      <div class="tabs"></div>
      <div class="build-grid"></div>
      <div class="superweapons"></div>`;
    this.minimap = new Minimap(sidebar.querySelector('.radar') as HTMLElement, game);
    this.creditsEl = sidebar.querySelector('.credits') as HTMLElement;
    this.powerEl = sidebar.querySelector('.power') as HTMLElement;
    this.grid = sidebar.querySelector('.build-grid') as HTMLElement;
    this.swEl = sidebar.querySelector('.superweapons') as HTMLElement;
    this.sellBtn = sidebar.querySelector('.sell') as HTMLElement;
    this.repairBtn = sidebar.querySelector('.repair') as HTMLElement;
    this.sellBtn.addEventListener('click', () => game.setMode(game.mode === 'sell' ? 'normal' : 'sell'));
    this.repairBtn.addEventListener('click', () => game.setMode(game.mode === 'repair' ? 'normal' : 'repair'));
    (sidebar.querySelector('.menu-btn') as HTMLElement).addEventListener('click', () => this.onMenu?.());
    const tabs = sidebar.querySelector('.tabs') as HTMLElement;
    for (const t of TABS) {
      const el = document.createElement('div');
      el.className = 'tab';
      el.title = TAB_NAMES[t];
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
    top.innerHTML = `<button class="obj-btn">OBJECTIVES</button><span class="clock"></span><span class="speed"></span><span class="mission-timer"></span>`;
    vp.appendChild(top);
    this.topClock = top.querySelector('.clock') as HTMLElement;
    this.missionTimer = top.querySelector('.mission-timer') as HTMLElement;
    this.speedEl = top.querySelector('.speed') as HTMLElement;
    this.objPanel = document.createElement('div');
    this.objPanel.className = 'objectives-panel';
    vp.appendChild(this.objPanel);
    (top.querySelector('.obj-btn') as HTMLElement).addEventListener('click', () => this.objPanel.classList.toggle('show'));
    this.evaLog = document.createElement('div');
    this.evaLog.className = 'eva-log';
    vp.appendChild(this.evaLog);
    this.sel = document.createElement('div');
    this.sel.className = 'selpanel hidden';
    vp.appendChild(this.sel);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    document.body.appendChild(this.tooltip);
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause-banner';
    this.pauseEl.textContent = 'PAUSED';
    this.pauseEl.style.display = 'none';
    vp.appendChild(this.pauseEl);

    // keyboard: tab cycling
    window.addEventListener('keydown', this.onKey);
    this.shownCredits = game.me.credits;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.tooltip.remove();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const avail = TABS.filter((t) => this.game.tabItems(t).length > 0);
      const i = avail.indexOf(this.tab);
      this.tab = avail[(i + (e.shiftKey ? avail.length - 1 : 1)) % avail.length] ?? 'structures';
      this.gridKey = '';
    }
    if (e.key === 'o' || e.key === 'O') this.objPanel.classList.toggle('show');
  };

  message(text: string, color = '#9fe8ff') {
    const el = document.createElement('div');
    el.className = 'eva-line';
    el.style.color = color;
    el.textContent = text;
    this.evaLog.appendChild(el);
    while (this.evaLog.children.length > 6) this.evaLog.firstChild?.remove();
    setTimeout(() => (el.style.opacity = '0'), 5500);
    setTimeout(() => el.remove(), 6400);
  }

  showHint(html: string | null) {
    this.hintEl?.remove();
    this.hintEl = null;
    if (!html) return;
    const el = document.createElement('div');
    el.className = 'hint';
    el.innerHTML = html;
    this.root.querySelector('#viewport')!.appendChild(el);
    this.hintEl = el;
  }

  setPaused(p: boolean) {
    this.pauseEl.style.display = p ? 'block' : 'none';
  }

  update(dt: number) {
    const g = this.game;
    const me = g.me;
    this.minimap.update(dt);
    // credits count-up
    const diff = me.credits - this.shownCredits;
    this.shownCredits += Math.sign(diff) * Math.min(Math.abs(diff), Math.max(8, Math.abs(diff) * 8 * dt));
    this.creditsEl.textContent = '$' + Math.floor(this.shownCredits).toLocaleString('en-US');
    // power
    const maxP = Math.max(me.powerProduced, me.powerUsed, 100) * 1.15;
    (this.powerEl.querySelector('.fill') as HTMLElement).style.width = (me.powerProduced / maxP) * 100 + '%';
    (this.powerEl.querySelector('.use') as HTMLElement).style.left = (me.powerUsed / maxP) * 100 + '%';
    (this.powerEl.querySelector('.pv') as HTMLElement).textContent = `${me.powerUsed} / ${me.powerProduced}`;
    this.powerEl.classList.toggle('low', me.lowPower);
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
    this.updateGrid();
    this.updateSuperweapons();
    this.updateSelection();
    this.updateTopbar();
    this.updateTooltip();
    this.setPaused(g.paused);
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
    }
    const q = me.queues[this.tab];
    for (const [id, c] of this.cameoEls) {
      const def: UnitDef | BuildingDef = UNITS[id] ?? BUILDINGS[id];
      const can = me.canBuild(id);
      c.el.classList.toggle('locked', !can);
      c.el.classList.toggle('unaffordable', can && me.credits < def.cost * 0.2 && q.items[0]?.defId !== id);
      const ctx = c.clock.getContext('2d')!;
      ctx.clearRect(0, 0, 88, 66);
      let status = '', cls = '';
      const n = q.items.filter((i) => i.defId === id).length;
      if (q.ready === id) {
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
      c.status.textContent = status;
      c.status.className = 'status ' + cls;
      const shown = UNITS[id] ? n : 0;
      c.count.style.display = shown > 1 || (shown === 1 && q.items[0]?.defId !== id) ? 'flex' : 'none';
      c.count.textContent = String(shown);
    }
  }

  private updateSuperweapons() {
    const me = this.game.me;
    const sws = [...me.superweapons.values()];
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

  private updateSelection() {
    const g = this.game;
    const sel = g.selection;
    const key = sel.map((e) => e.id).join(',') + '|' + sel.map((e) => Math.round((e.hp / e.maxHp) * 20)).join(',') + (sel[0] && sel[0].kind === 'building' ? (sel[0] as Building).repairing : '');
    if (key === this.selKey) return;
    this.selKey = key;
    if (sel.length === 0) {
      this.sel.classList.add('hidden');
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
        html += `<div class="mini" data-t="${id}" style="background-image:url(${cameo(id)})" title="${list[0].name}"><i style="width:${avg * 100}%"></i><span>${list.length}</span></div>`;
      }
      html += '</div>';
      html += `<div class="info"><div class="title">${sel.length} units</div><div class="cmds">
        <button class="cmd" data-c="stop"><kbd>S</kbd>Stop</button><button class="cmd" data-c="amove"><kbd>A</kbd>Attack-move</button><button class="cmd" data-c="scatter"><kbd>X</kbd>Scatter</button></div>
        <div class="sub">Ctrl/⌘+1-9: assign group</div></div>`;
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
        const b0 = g.selection[0] as Building;
        if (c === 'repair' && b0) g.world.toggleRepair(b0);
        if (c === 'sell' && b0) g.world.sell(b0);
        this.selKey = '';
      }),
    );
  }

  private updateTopbar() {
    const g = this.game;
    this.topClock.textContent = formatTime(g.world.time);
    this.speedEl.textContent = g.speed !== 1 ? `SPEED ${Math.round(g.speed * 100)}%` : '';
    if (g.missionTimer) {
      this.missionTimer.textContent = `${g.missionTimer.label} ${formatTime(g.missionTimer.seconds)}`;
    } else this.missionTimer.textContent = '';
    const key = JSON.stringify(g.objectives);
    if (key !== this.objKey) {
      this.objKey = key;
      if (g.objectives.length === 0) {
        this.objPanel.innerHTML = '<h4>OBJECTIVES</h4><div class="obj"><span class="box"></span><span>Destroy all enemy forces.</span></div>';
      } else {
        this.objPanel.innerHTML =
          '<h4>OBJECTIVES</h4>' +
          g.objectives.map((o) => `<div class="obj ${o.done ? 'done' : ''} ${o.failed ? 'failed' : ''} ${o.optional ? 'optional' : ''}"><span class="box"></span><span>${o.optional ? '(Optional) ' : ''}${o.text}</span></div>`).join('');
        this.objPanel.classList.add('show');
        clearTimeout(this.objHideT);
        this.objHideT = window.setTimeout(() => this.objPanel.classList.remove('show'), 9000);
      }
    }
  }
  private objHideT = 0;

  private updateTooltip() {
    const id = this.tipId;
    if (!id) {
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
      if (b.power) stats += `<span class="${b.power > 0 ? 'pos' : 'neg'}">⚡${b.power > 0 ? '+' : ''}${b.power}</span>`;
    } else {
      const u = def as UnitDef;
      stats += `<span>HP ${u.hp}</span><span>SPD ${u.speed.toFixed(1)}</span>`;
    }
    this.tooltip.innerHTML = `<h5>${def.name}</h5><div class="stats">${stats}</div><p>${def.description}</p>${missing.length ? `<div class="req">Requires: ${missing.join(', ')}</div>` : ''}<p style="margin-top:6px;font-size:11px">Left-click: build${!isB ? ' (Shift: ×5)' : ''} · Right-click: hold / cancel</p>`;
    const r = (this.cameoEls.get(id)?.el ?? this.grid).getBoundingClientRect();
    this.tooltip.style.left = Math.max(8, r.left - 282) + 'px';
    this.tooltip.style.top = Math.min(window.innerHeight - 200, r.top) + 'px';
    this.tooltip.classList.add('show');
  }
}
