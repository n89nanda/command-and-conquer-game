import { Terrain, type GameMap } from '../game/GameMap';
import { paletteFor } from '../render/Terrain';

export type MapStyle = 'natural' | 'holo';

/**
 * Renders a smooth, hill-shaded image of the map at `px` pixels per tile.
 * Heights are sampled bilinearly per pixel, so relief reads smoothly even when scaled up.
 */
export function renderTerrain(map: GameMap, px: number, style: MapStyle = 'natural', ore = true, soften = 0): HTMLCanvasElement {
  const W = Math.max(1, Math.round(map.w * px)), H = Math.max(1, Math.round(map.h * px));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const pal = paletteFor(map.theater);
  const water = [(pal.water >> 16) & 255, (pal.water >> 8) & 255, pal.water & 255];
  const inv = 1 / px;
  // light from the north-west, like the in-game sun
  const lx = -0.62, lz = -0.62, ly = 0.48;
  const e = 0.5;
  for (let y = 0; y < H; y++) {
    const fz = (y + 0.5) * inv;
    const tz = Math.min(map.h - 1, Math.floor(fz));
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * inv;
      const tx = Math.min(map.w - 1, Math.floor(fx));
      const i = tz * map.w + tx;
      const t = map.terrain[i];
      const h = map.heightAt(fx, fz);
      const dx = (map.heightAt(fx + e, fz) - map.heightAt(fx - e, fz)) / (2 * e);
      const dz = (map.heightAt(fx, fz + e) - map.heightAt(fx, fz - e)) / (2 * e);
      // normal = (-dx, 1, -dz) normalised; lambert against light
      const nl = 1 / Math.hypot(dx, 1, dz);
      const lam = (-dx * lx + ly - dz * lz) * nl;
      let shade = 0.55 + lam * 0.75;
      shade = Math.max(0.45, Math.min(1.35, shade)) * (0.92 + Math.max(-0.12, Math.min(0.16, h * 0.05)));
      let r: number, g: number, b: number;
      if (style === 'holo') {
        const v = 38 + h * 14;
        r = 8;
        g = v * 0.95;
        b = v * 1.3 + 10;
        if (t === Terrain.Water) {
          r = 4;
          g = 22;
          b = 58;
          shade = 1;
        } else if (t === Terrain.Rock) {
          r = 22;
          g = 88;
          b = 118;
        } else if (t === Terrain.Road || t === Terrain.Concrete) {
          r = 40;
          g = 120;
          b = 140;
        }
        if (map.oreType[i]) {
          r = 50;
          g = 210;
          b = 160;
        }
      } else {
        let col: readonly number[];
        switch (t) {
          case Terrain.Rock: col = pal.rock[0]; break;
          case Terrain.Water: col = water; break;
          case Terrain.Sand: col = pal.sand[0]; break;
          case Terrain.Dirt: col = pal.dirt[0]; break;
          case Terrain.Road: col = pal.road; break;
          case Terrain.Concrete: col = pal.concrete; break;
          default: col = pal.grass[0];
        }
        r = col[0];
        g = col[1];
        b = col[2];
        if (t === Terrain.Water) shade = 0.9 + (shade - 0.9) * 0.2;
        if (map.doodadBlock[i]) {
          r *= 0.62;
          g *= 0.74;
          b *= 0.6;
        }
        if (ore && map.oreType[i]) {
          const rich = map.oreType[i] === 2;
          const k = 0.55;
          r = r * (1 - k) + (rich ? 160 : 60) * k;
          g = g * (1 - k) + (rich ? 110 : 225) * k;
          b = b * (1 - k) + (rich ? 255 : 170) * k;
        }
      }
      const o = (y * W + x) * 4;
      img.data[o] = r * shade;
      img.data[o + 1] = g * shade;
      img.data[o + 2] = b * shade;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (soften > 0) {
    // soften the per-tile terrain edges so previews read as smooth relief, not pixels
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const o = out.getContext('2d')!;
    o.drawImage(c, 0, 0);
    o.filter = `blur(${soften}px)`;
    o.drawImage(c, 0, 0);
    o.filter = 'none';
    return out;
  }
  return c;
}
