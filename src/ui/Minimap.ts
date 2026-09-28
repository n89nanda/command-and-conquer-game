import * as THREE from 'three';
import { Terrain } from '../game/GameMap';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { paletteFor } from '../render/Terrain';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private game: Game;
  private base: HTMLCanvasElement;
  private offline: HTMLElement;
  private timer = 0;
  private revealT = 0;
  private wasOnline = false;
  private noise: HTMLCanvasElement;
  private scale: number;
  private dragging = false;

  constructor(host: HTMLElement, game: Game) {
    this.game = game;
    const map = game.world.map;
    this.canvas = document.createElement('canvas');
    const S = 280 * 2;
    this.canvas.width = S;
    this.canvas.height = S;
    this.scale = S / Math.max(map.w, map.h);
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.offline = document.createElement('div');
    this.offline.className = 'radar-offline';
    this.offline.innerHTML = '<b>RADAR OFFLINE</b><span>Build a radar structure</span>';
    host.appendChild(this.offline);
    this.base = this.renderBase();
    this.noise = document.createElement('canvas');
    this.noise.width = 140;
    this.noise.height = 140;
    const nav = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * (this.canvas.width / this.scale);
      const z = ((e.clientY - r.top) / r.height) * (this.canvas.height / this.scale);
      return { x, z };
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.online) return;
      const p = nav(e);
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
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        const p = nav(e);
        game.jumpTo(p.x, p.z);
      }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
  }

  get online() {
    return this.game.me.hasRadar() || this.game.world.fogs.get(this.game.me)?.revealAll === true || this.game.alwaysRadar;
  }

  private renderBase() {
    const map = this.game.world.map;
    const pal = paletteFor(map.theater);
    const c = document.createElement('canvas');
    c.width = map.w;
    c.height = map.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(map.w, map.h);
    for (let z = 0; z < map.h; z++)
      for (let x = 0; x < map.w; x++) {
        const i = z * map.w + x;
        const t = map.terrain[i];
        let col: [number, number, number];
        switch (t) {
          case Terrain.Rock: col = pal.rock[0]; break;
          case Terrain.Water: { const w = new THREE.Color(pal.water); col = [w.r * 255, w.g * 255, w.b * 255]; break; }
          case Terrain.Sand: col = pal.sand[0]; break;
          case Terrain.Dirt: col = pal.dirt[0]; break;
          case Terrain.Road: col = pal.road; break;
          default: col = pal.grass[0];
        }
        const h = map.heightAt(x + 0.5, z + 0.5);
        const shade = 0.85 + Math.max(-0.2, Math.min(0.3, h * 0.12));
        if (map.doodadBlock[i]) {
          col = [col[0] * 0.6, col[1] * 0.75, col[2] * 0.6];
        }
        img.data[i * 4] = col[0] * shade;
        img.data[i * 4 + 1] = col[1] * shade;
        img.data[i * 4 + 2] = col[2] * shade;
        img.data[i * 4 + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  update(dt: number) {
    this.timer -= dt;
    const online = this.online;
    this.offline.style.display = online ? 'none' : 'flex';
    if (online && !this.wasOnline) this.revealT = 0;
    this.wasOnline = online;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const ctx = this.ctx;
    const S = this.canvas.width;
    if (!online) {
      // static noise
      const nctx = this.noise.getContext('2d')!;
      const img = nctx.createImageData(140, 140);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 40;
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
    this.revealT += 0.1;
    const g = this.game;
    const w = g.world;
    const map = w.map;
    const sc = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(this.base, 0, 0, map.w * sc, map.h * sc);
    // ore
    for (let i = 0; i < map.ore.length; i++) {
      if (!map.oreType[i]) continue;
      ctx.fillStyle = map.oreType[i] === 2 ? '#9a70ff' : '#3fe0a8';
      ctx.fillRect((i % map.w) * sc, Math.floor(i / map.w) * sc, sc, sc);
    }
    const fog = w.fogs.get(g.me);
    // buildings
    for (const b of w.buildings) {
      if (!w.visibleTo(b, g.me)) continue;
      ctx.fillStyle = b.owner.isNeutral ? '#9a9a9a' : '#' + new THREE.Color(b.owner.color).getHexString();
      ctx.fillRect(b.tx * sc, b.tz * sc, b.w * sc, b.h * sc);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
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
      const k = (w.time * 1.2) % 1;
      ctx.strokeStyle = bc.color ?? '#ffd24a';
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bc.x * sc, bc.z * sc, 5 + k * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = bc.color ?? '#ffd24a';
      ctx.fillRect(bc.x * sc - 3, bc.z * sc - 3, 6, 6);
    }
    // camera frustum
    const r = g.renderer;
    const corners = [
      [-1, 1], [1, 1], [1, -1], [-1, -1],
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
    // radar coming online sweep
    if (this.revealT < 1.5) {
      const k = this.revealT / 1.5;
      ctx.fillStyle = `rgba(0,0,0,${1 - k})`;
      ctx.fillRect(0, S * k, S, S * (1 - k));
      ctx.fillStyle = 'rgba(120,255,160,0.6)';
      ctx.fillRect(0, S * k - 2, S, 3);
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
