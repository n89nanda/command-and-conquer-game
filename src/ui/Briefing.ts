import { audio } from '../bridge';
import { Terrain } from '../game/GameMap';
import type { MissionDef } from '../game/mission/MissionScript';
import type { World } from '../game/World';

/** Mission briefing: holographic map + typewriter text. */
export class Briefing {
  private raf = 0;
  private typed = 0;
  private done = false;

  constructor(host: HTMLElement, m: MissionDef, world: World | null, onStart: () => void, onBack: () => void) {
    const el = document.createElement('div');
    el.className = 'briefing fade-in';
    el.innerHTML = `<div class="holo"><canvas></canvas></div>
      <div class="text"><div class="op">OPERATION ${String(m.index).padStart(2, '0')} · ${m.codename.toUpperCase()}</div><h2>${m.name.toUpperCase()}</h2>
      <div class="op" style="margin:-8px 0 14px">${m.location.toUpperCase()}</div>
      <div class="body"></div>
      <div class="objs"><div class="op" style="margin-bottom:4px">OBJECTIVES</div>${m.objectives.map((o) => `<div>▸ ${o}</div>`).join('')}</div>
      <div class="actions" style="margin-top:16px"><button class="btn" data-a="back">BACK</button><button class="btn" data-a="skip">SKIP TEXT</button><button class="btn primary" data-a="start">BEGIN MISSION</button></div></div>`;
    host.appendChild(el);
    const body = el.querySelector('.body') as HTMLElement;
    const text = m.briefing.trim();
    const cv = el.querySelector('canvas') as HTMLCanvasElement;
    const map = world?.map;
    // pre-render terrain in holo colours
    let terrainImg: HTMLCanvasElement | null = null;
    if (map) {
      terrainImg = document.createElement('canvas');
      terrainImg.width = map.w;
      terrainImg.height = map.h;
      const ctx = terrainImg.getContext('2d')!;
      const img = ctx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        const t = map.terrain[i];
        const h = map.heights[Math.floor(i / map.w) * (map.w + 1) + (i % map.w)];
        let v = 40 + h * 25;
        let r = 0, g = v * 0.8, b = v * 1.1;
        if (t === Terrain.Water) {
          r = 5;
          g = 30;
          b = 70;
        } else if (t === Terrain.Rock) {
          g = 90 + h * 20;
          b = 120 + h * 20;
          r = 20;
        } else if (t === Terrain.Road) {
          r = 40;
          g = 110;
          b = 130;
        }
        if (map.oreType[i]) {
          r = 40;
          g = 200;
          b = 150;
        }
        v = 1;
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    const start = performance.now();
    let lastType = 0;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const t = (performance.now() - start) / 1000;
      // typewriter
      if (!this.done) {
        this.typed = Math.min(text.length, this.typed + 1.6);
        if (this.typed >= text.length) this.done = true;
        body.innerHTML = escapeHtml(text.slice(0, Math.floor(this.typed))) + '<span class="cursor"></span>';
        if (t - lastType > 0.07) {
          lastType = t;
          audio.play('briefingType', { volume: 0.25 });
        }
        body.scrollTop = body.scrollHeight;
      }
      // holo map
      const W = (cv.width = cv.clientWidth * 2), H = (cv.height = cv.clientHeight * 2);
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      if (terrainImg && map && world) {
        const s = Math.min(W / map.w, H / map.h) * 0.86;
        const ox = (W - map.w * s) / 2, oy = (H - map.h * s) / 2;
        const reveal = Math.min(1, t / 2.2);
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.imageSmoothingEnabled = true;
        ctx.beginPath();
        ctx.rect(ox, oy, map.w * s, map.h * s * reveal);
        ctx.clip();
        ctx.drawImage(terrainImg, ox, oy, map.w * s, map.h * s);
        // grid
        ctx.strokeStyle = 'rgba(80,200,255,0.12)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= map.w; x += 8) {
          ctx.beginPath();
          ctx.moveTo(ox + x * s, oy);
          ctx.lineTo(ox + x * s, oy + map.h * s);
          ctx.stroke();
        }
        for (let z = 0; z <= map.h; z += 8) {
          ctx.beginPath();
          ctx.moveTo(ox, oy + z * s);
          ctx.lineTo(ox + map.w * s, oy + z * s);
          ctx.stroke();
        }
        // forces
        const pulse = 0.6 + Math.sin(t * 4) * 0.4;
        for (const b of world.buildings) {
          if (b.owner.isNeutral) continue;
          const friendly = b.owner.isHuman || (!!world.human && !b.owner.isEnemyOf(world.human));
          ctx.fillStyle = friendly ? `rgba(90,255,140,${0.8})` : `rgba(255,80,60,${0.5 + pulse * 0.5})`;
          ctx.fillRect(ox + b.tx * s, oy + b.tz * s, b.w * s, b.h * s);
        }
        for (const u of world.units) {
          if (u.owner.isNeutral) continue;
          const friendly = u.owner.isHuman || (!!world.human && !u.owner.isEnemyOf(world.human));
          if (!friendly && t < 3) continue;
          ctx.fillStyle = friendly ? '#5dff8a' : `rgba(255,90,70,${pulse})`;
          ctx.beginPath();
          ctx.arc(ox + u.x * s, oy + u.z * s, friendly ? 3 : 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        // scanning line
        const sy = oy + ((t * 0.25) % 1) * map.h * s;
        const grad = ctx.createLinearGradient(0, sy - 40, 0, sy);
        grad.addColorStop(0, 'rgba(80,220,255,0)');
        grad.addColorStop(1, 'rgba(80,220,255,0.25)');
        ctx.fillStyle = grad;
        ctx.fillRect(ox, sy - 40, map.w * s, 40);
        ctx.strokeStyle = 'rgba(80,220,255,0.6)';
        ctx.strokeRect(ox, oy, map.w * s, map.h * s);
        ctx.fillStyle = 'rgba(120,220,255,0.8)';
        ctx.font = '600 20px var(--ui-font)';
        ctx.fillText('TACTICAL OVERVIEW', ox, oy - 12);
      }
    };
    loop();
    const cleanup = () => {
      cancelAnimationFrame(this.raf);
    };
    el.querySelector('[data-a=skip]')!.addEventListener('click', () => {
      this.typed = text.length;
    });
    el.querySelector('[data-a=start]')!.addEventListener('click', () => {
      audio.play('click');
      cleanup();
      onStart();
    });
    el.querySelector('[data-a=back]')!.addEventListener('click', () => {
      cleanup();
      onBack();
    });
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
