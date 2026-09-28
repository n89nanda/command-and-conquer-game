import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { renderTerrain } from './mapimage';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private game: Game;
  private base: HTMLCanvasElement;
  private offline: HTMLElement;
  private offlineKey = '';
  private offlineT = 0;
  private timer = 0;
  private revealT = 0;
  private wasOnline = false;
  private noise: HTMLCanvasElement;
  private scale: number;
  private dragging = false;
  private S: number;

  constructor(host: HTMLElement, game: Game) {
    this.game = game;
    const map = game.world.map;
    this.canvas = document.createElement('canvas');
    const S = 280 * 2;
    this.S = S;
    this.canvas.width = S;
    this.canvas.height = S;
    this.scale = S / Math.max(map.w, map.h);
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.offline = document.createElement('div');
    this.offline.className = 'radar-offline';
    host.appendChild(this.offline);
    // smooth, hill-shaded terrain (2 px per tile, drawn with smoothing)
    this.base = renderTerrain(map, Math.max(2, Math.min(4, Math.round(512 / Math.max(map.w, map.h)))), 'natural', false, 1);
    this.noise = document.createElement('canvas');
    this.noise.width = 140;
    this.noise.height = 140;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.online) return;
      const p = this.nav(e);
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        const units = game.selection.filter((s): s is Unit => s.kind === 'unit' && s.owner === game.me);
        if (units.length) game.formationMove(units, p.x, p.z, game.mode === 'attackMove');
        game.setMode('normal');
        return;
      }
      if (game.mode === 'attackMove') {
        game.commandAttackMove(p.x, p.z, e.shiftKey);
        game.setMode('normal');
        return;
      }
      this.dragging = true;
      game.jumpTo(p.x, p.z);
    });
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
  }

  private nav(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * (this.canvas.width / this.scale);
    const z = ((e.clientY - r.top) / r.height) * (this.canvas.height / this.scale);
    return { x, z };
  }
  private onMove = (e: MouseEvent) => {
    if (this.dragging) {
      const p = this.nav(e);
      this.game.jumpTo(p.x, p.z);
    }
  };
  private onUp = () => (this.dragging = false);

  /** Removes the window listeners (called from Hud.destroy on game end). */
  destroy() {
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.dragging = false;
  }

  /** Layout changed (e.g. sidebar collapsed); force a redraw next frame. */
  resize() {
    this.timer = 0;
  }

  get online() {
    return this.game.me.hasRadar() || this.game.world.fogs.get(this.game.me)?.revealAll === true || this.game.alwaysRadar;
  }

  /** Context-aware offline caption: unavailable / low power / build <real radar name>. */
  private updateOfflineText() {
    const g = this.game;
    const me = g.me;
    const radarId = g.tabItems('structures').find((id) => BUILDINGS[id]?.radar);
    const hasRadarBuilding = [...me.buildingCounts].some(([id, n]) => n > 0 && BUILDINGS[id]?.radar);
    let title = 'RADAR OFFLINE', sub = '';
    if (hasRadarBuilding && me.lowPower) sub = 'Low power: build more power';
    else if (!radarId) {
      title = 'RADAR UNAVAILABLE';
      sub = 'No radar support for this operation';
    } else sub = `Build ${/^[AEIOU]/i.test(BUILDINGS[radarId].name) ? 'an' : 'a'} ${BUILDINGS[radarId].name}`;
    const key = title + sub;
    if (key === this.offlineKey) return;
    this.offlineKey = key;
    this.offline.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  }

  update(dt: number) {
    this.timer -= dt;
    const online = this.online;
    this.offline.style.display = online ? 'none' : 'flex';
    if (online && !this.wasOnline) this.revealT = 0;
    else if (online) this.revealT += dt; // time-based, independent of redraw rate
    this.wasOnline = online;
    if (!online) {
      this.offlineT -= dt;
      if (this.offlineT <= 0) {
        this.offlineT = 1;
        this.updateOfflineText();
      }
    } else this.offlineKey = '';
    if (this.timer > 0) return;
    this.timer = online && this.revealT < 1.6 ? 1 / 30 : 0.1;
    const ctx = this.ctx;
    const S = this.S;
    if (!online) {
      // static noise
      const nctx = this.noise.getContext('2d')!;
      const img = nctx.createImageData(140, 140);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 34;
        img.data[i] = v;
        img.data[i + 1] = v * 1.1;
        img.data[i + 2] = v * 1.2;
        img.data[i + 3] = 255;
      }
      nctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.noise, 0, 0, S, S);
      return;
    }
    const g = this.game;
    const w = g.world;
    const map = w.map;
    const sc = this.scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, 0, 0, map.w * sc, map.h * sc);
    // ore (live: fields deplete and regrow)
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < map.ore.length; i++) {
      if (!map.oreType[i] || map.ore[i] <= 0) continue;
      ctx.fillStyle = map.oreType[i] === 2 ? '#a07cff' : '#3fe0a8';
      ctx.fillRect((i % map.w) * sc + sc * 0.1, Math.floor(i / map.w) * sc + sc * 0.1, sc * 0.8, sc * 0.8);
    }
    ctx.globalAlpha = 1;
    const fog = w.fogs.get(g.me);
    // buildings
    ctx.lineWidth = 1;
    for (const b of w.buildings) {
      if (!w.visibleTo(b, g.me)) continue;
      ctx.fillStyle = b.owner.isNeutral ? '#9a9a9a' : '#' + new THREE.Color(b.owner.color).getHexString();
      ctx.fillRect(b.tx * sc, b.tz * sc, b.w * sc, b.h * sc);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeRect(b.tx * sc + 0.5, b.tz * sc + 0.5, b.w * sc - 1, b.h * sc - 1);
    }
    // units
    for (const u of w.units) {
      if (!w.visibleTo(u, g.me)) continue;
      const c = new THREE.Color(u.owner.color);
      ctx.fillStyle = u.selected ? '#ffffff' : '#' + c.offsetHSL(0, 0, 0.15).getHexString();
      const s = u.isInfantry ? sc * 0.9 : sc * 1.5;
      ctx.fillRect(u.x * sc - s / 2, u.z * sc - s / 2, s, s);
    }
    // fog / shroud
    if (fog && !fog.revealAll) {
      const fimg = this.fogImage(fog.visible, fog.explored, map.w, map.h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fimg, 0, 0, map.w * sc, map.h * sc);
    }
    // alert ping
    const ap = g.me.lastAlertPos;
    if (ap && w.time - g.me.lastAttackAlert < 6) {
      const k = (w.time * 2) % 1;
      ctx.strokeStyle = `rgba(255,70,50,${1 - k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ap.x * sc, ap.z * sc, 6 + k * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    // objective beacons
    for (const bc of g.beacons) {
      if (bc.entity?.dead) continue;
      const bx = bc.entity ? bc.entity.x : bc.x, bz = bc.entity ? bc.entity.z : bc.z;
      const k = (w.time * 1.2) % 1;
      ctx.strokeStyle = bc.color ?? '#ffd24a';
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx * sc, bz * sc, 5 + k * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = bc.color ?? '#ffd24a';
      ctx.fillRect(bx * sc - 3, bz * sc - 3, 6, 6);
    }
    // camera frustum
    const r = g.renderer;
    const corners = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].map(([x, y]) => r.pickGround(x, y));
    if (corners.every((c) => c)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      corners.forEach((c, i) => {
        const px = c!.x * sc, pz = c!.z * sc;
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.closePath();
      ctx.stroke();
    }
    // radar coming online: a soft sweep band that fades out completely
    if (this.revealT < 1.6) {
      const k = Math.min(1, this.revealT / 1.4);
      const y = S * k;
      ctx.fillStyle = `rgba(0,0,0,${0.85 * (1 - k)})`;
      ctx.fillRect(0, y, S, S - y);
      const fade = 1 - Math.max(0, (this.revealT - 1.1) / 0.5);
      if (fade > 0) {
        const grad = ctx.createLinearGradient(0, y - 60, 0, y);
        grad.addColorStop(0, 'rgba(120,255,170,0)');
        grad.addColorStop(1, `rgba(120,255,170,${0.35 * fade})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 60, S, 60);
        ctx.fillStyle = `rgba(180,255,200,${0.7 * fade})`;
        ctx.fillRect(0, y - 1, S, 2);
      }
    }
  }

  private fogCanvas: HTMLCanvasElement | null = null;
  private fogImage(vis: Uint8Array, exp: Uint8Array, w: number, h: number) {
    if (!this.fogCanvas) {
      this.fogCanvas = document.createElement('canvas');
      this.fogCanvas.width = w;
      this.fogCanvas.height = h;
    }
    const ctx = this.fogCanvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = vis[i] ? 0 : exp[i] ? 110 : 255;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    return this.fogCanvas;
  }
}
