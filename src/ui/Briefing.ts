import { audio } from '../bridge';
import { FACTIONS } from '../data/factions';
import type { MissionDef } from '../game/mission/MissionScript';
import type { World } from '../game/World';
import { renderTerrain } from './mapimage';
import { escapeHtml, scrollFades, uiFont } from './widgets';

const CHARS_PER_SEC = 45;

/** Mission briefing: holographic map + intel cards + time-based typewriter text. */
export class Briefing {
  private raf = 0;
  private done = false;
  private closed = false;

  constructor(host: HTMLElement, m: MissionDef, world: World | null, onStart: () => void, onBack: () => void) {
    const el = document.createElement('div');
    el.className = 'briefing fade-in';
    const code = m.codename.replace(/^operation\s+/i, '').trim();
    const opLine = `OPERATION ${String(m.index).padStart(2, '0')}${code && code.toLowerCase() !== m.name.toLowerCase() ? ` · ${escapeHtml(code.toUpperCase())}` : ''}`;
    const human = world?.human ?? world?.players.find((p) => p.isHuman) ?? null;
    const enemies = world && human ? world.players.filter((p) => !p.isNeutral && p.isEnemyOf(human)) : [];
    const enemyFactions = [...new Set(enemies.map((p) => FACTIONS[p.faction].name))];
    const friendlyUnits = world && human ? world.units.filter((u) => !u.owner.isNeutral && !u.owner.isEnemyOf(human)).length : 0;
    const friendlyBase = world && human ? world.buildings.filter((b) => !b.owner.isNeutral && !b.owner.isEnemyOf(human)).length : 0;
    const hostileSites = world && human ? world.buildings.filter((b) => b.owner.isEnemyOf(human)).length : 0;
    const map = world?.map;
    el.innerHTML = `<div class="brief-left">
        <div class="holo"><canvas></canvas>
          <div class="holo-title">TACTICAL OVERVIEW</div>
          <div class="holo-legend"><span><i class="f"></i>Friendly</span><span><i class="h"></i>Hostile</span><span><i class="o"></i>Riftite</span></div>
        </div>
        <div class="intel">
          <div class="intel-card"><small>HOSTILE FORCE</small><b>${enemyFactions.length ? escapeHtml(enemyFactions.join(' / ')) : 'Unknown'}</b></div>
          <div class="intel-card"><small>THEATER</small><b>${map ? `${map.theater[0].toUpperCase()}${map.theater.slice(1)} · ${map.w}×${map.h}` : '—'}</b></div>
          <div class="intel-card"><small>YOUR FORCES</small><b>${friendlyUnits} unit${friendlyUnits === 1 ? '' : 's'}${friendlyBase ? ` · ${friendlyBase} structure${friendlyBase === 1 ? '' : 's'}` : ''}</b></div>
          <div class="intel-card hostile"><small>HOSTILE SITES</small><b>${hostileSites ? `${hostileSites} detected` : 'None detected'}</b></div>
        </div>
      </div>
      <div class="text"><div class="op">${opLine}</div><h2>${escapeHtml(m.name.toUpperCase())}</h2>
      <div class="loc">${escapeHtml(m.location.toUpperCase())}</div>
      <div class="body"></div>
      <div class="objs"><div class="op">OBJECTIVES</div>${m.objectives.map((o) => `<div class="o">${escapeHtml(o)}</div>`).join('')}</div>
      <div class="actions"><button class="btn" data-a="back">BACK</button><button class="btn" data-a="skip">SKIP TEXT</button><button class="btn primary" data-a="start">BEGIN MISSION</button></div>
      <div class="keys-hint"><kbd>Enter</kbd> begin · <kbd>Esc</kbd> back</div></div>`;
    host.appendChild(el);
    const body = el.querySelector('.body') as HTMLElement;
    scrollFades(body);
    const text = m.briefing.trim();
    const cv = el.querySelector('canvas') as HTMLCanvasElement;
    const terrainImg = map ? renderTerrain(map, 4, 'holo', true, 1.6) : null;
    const font = uiFont();

    // --- typewriter state
    let shown = -1;
    let autoScroll = true;
    let lastAutoTop = 0;
    const stopAuto = () => (autoScroll = false);
    body.addEventListener('wheel', stopAuto, { passive: true });
    body.addEventListener('touchstart', stopAuto, { passive: true });
    body.addEventListener('pointerdown', stopAuto);
    body.addEventListener('scroll', () => {
      if (body.scrollTop < lastAutoTop - 4) autoScroll = false;
    });
    let skipAt = -1;

    const start = performance.now();
    let lastType = 0;
    let cw = 0, ch = 0;
    const loop = () => {
      if (!el.isConnected) {
        cleanup();
        return;
      }
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const t = (now - start) / 1000;
      // typewriter driven by time, not frame count
      if (!this.done) {
        const n = skipAt >= 0 ? text.length : Math.min(text.length, Math.floor(Math.max(0, t - 0.35) * CHARS_PER_SEC));
        if (n !== shown) {
          shown = n;
          body.innerHTML = escapeHtml(text.slice(0, n)) + (n < text.length ? '<span class="cursor"></span>' : '');
          if (n >= text.length) {
            this.done = true;
            el.classList.add('typed');
          }
          if (t - lastType > 0.07 && !this.done) {
            lastType = t;
            audio.play('briefingType', { volume: 0.25 });
          }
          if (autoScroll) {
            body.scrollTop = body.scrollHeight;
            lastAutoTop = body.scrollTop;
          }
        }
      }
      // holo map
      if (cv.clientWidth !== cw || cv.clientHeight !== ch) {
        cw = cv.clientWidth;
        ch = cv.clientHeight;
        cv.width = Math.max(1, Math.round(cw * 2));
        cv.height = Math.max(1, Math.round(ch * 2));
      }
      const W = cv.width, H = cv.height;
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      if (terrainImg && map && world) {
        const s = Math.min(W / map.w, H / map.h) * 0.9;
        const ox = (W - map.w * s) / 2, oy = (H - map.h * s) / 2;
        const reveal = Math.min(1, t / 1.8);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.beginPath();
        ctx.rect(ox, oy, map.w * s, map.h * s * reveal);
        ctx.clip();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(terrainImg, ox, oy, map.w * s, map.h * s);
        ctx.globalAlpha = 1;
        // grid
        ctx.strokeStyle = 'rgba(80,200,255,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= map.w; x += 8) {
          ctx.moveTo(ox + x * s, oy);
          ctx.lineTo(ox + x * s, oy + map.h * s);
        }
        for (let z = 0; z <= map.h; z += 8) {
          ctx.moveTo(ox, oy + z * s);
          ctx.lineTo(ox + map.w * s, oy + z * s);
        }
        ctx.stroke();
        // forces
        const pulse = 0.6 + Math.sin(t * 4) * 0.4;
        for (const b of world.buildings) {
          if (b.owner.isNeutral) continue;
          const friendly = !!human && !b.owner.isEnemyOf(human);
          if (!friendly && t < 1.4) continue;
          ctx.fillStyle = friendly ? 'rgba(90,255,140,0.85)' : `rgba(255,80,60,${0.5 + pulse * 0.5})`;
          ctx.fillRect(ox + b.tx * s, oy + b.tz * s, b.w * s, b.h * s);
          if (!friendly) {
            ctx.strokeStyle = `rgba(255,120,100,${0.35 * pulse})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(ox + b.tx * s - 4, oy + b.tz * s - 4, b.w * s + 8, b.h * s + 8);
          }
        }
        for (const u of world.units) {
          if (u.owner.isNeutral) continue;
          const friendly = !!human && !u.owner.isEnemyOf(human);
          if (!friendly && t < 3) continue;
          ctx.fillStyle = friendly ? '#5dff8a' : `rgba(255,90,70,${pulse})`;
          ctx.beginPath();
          ctx.arc(ox + u.x * s, oy + u.z * s, friendly ? 4 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        // scanning line
        const sy = oy + ((t * 0.22) % 1) * map.h * s;
        const grad = ctx.createLinearGradient(0, sy - 50, 0, sy);
        grad.addColorStop(0, 'rgba(80,220,255,0)');
        grad.addColorStop(1, 'rgba(80,220,255,0.22)');
        ctx.fillStyle = grad;
        ctx.fillRect(ox, sy - 50, map.w * s, 50);
        ctx.strokeStyle = 'rgba(80,220,255,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox, oy, map.w * s, map.h * s);
        // corner ticks + scale
        ctx.fillStyle = 'rgba(120,220,255,0.75)';
        ctx.font = `600 18px ${font}`;
        ctx.textBaseline = 'top';
        ctx.fillText(`GRID ${map.w}×${map.h}`, ox + 8, oy + map.h * s + 8);
        ctx.textAlign = 'right';
        ctx.fillText(t < 3 ? 'SCANNING…' : 'HOSTILES MARKED', ox + map.w * s - 8, oy + map.h * s + 8);
        ctx.textAlign = 'left';
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        // let focused buttons (BACK / SKIP) handle their own activation
        const f = document.activeElement as HTMLElement | null;
        if (f && f.tagName === 'BUTTON' && !f.classList.contains('primary')) return;
        e.preventDefault();
        begin();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        back();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') stopAuto();
    };
    const cleanup = () => {
      if (this.closed) return;
      this.closed = true;
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', onKey);
    };
    const begin = () => {
      if (this.closed) return;
      audio.play('click');
      cleanup();
      onStart();
    };
    const back = () => {
      if (this.closed) return;
      audio.play('click');
      cleanup();
      onBack();
    };
    window.addEventListener('keydown', onKey);
    loop();
    el.querySelector('[data-a=skip]')!.addEventListener('click', () => {
      skipAt = shown;
    });
    el.querySelector('[data-a=start]')!.addEventListener('click', begin);
    el.querySelector('[data-a=back]')!.addEventListener('click', back);
  }
}
