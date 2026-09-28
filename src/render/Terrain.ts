import * as THREE from 'three';
import { GameMap, Terrain, type Theater } from '../game/GameMap';
import { clamp, fbm, valueNoise } from '../game/util';
import { registerWorldMaterial } from './materials';

const PX = 8; // texels per tile for the terrain colour map

interface Palette {
  grass: [number, number, number][];
  dirt: [number, number, number][];
  sand: [number, number, number][];
  rock: [number, number, number][];
  road: [number, number, number];
  concrete: [number, number, number];
  seabed: [number, number, number];
  water: number;
  sky: number;
  fog: number;
  sun: number;
  ambient: number;
  /** grading: tone-mapping exposure, sun & hemisphere intensities */
  exposure: number;
  sunI: number;
  hemiI: number;
}

const PALETTES: Record<Theater, Palette> = {
  temperate: {
    grass: [[84, 96, 50], [96, 106, 58], [74, 86, 44], [104, 108, 66]],
    dirt: [[112, 92, 64], [128, 106, 74], [96, 80, 58]],
    sand: [[170, 150, 110], [184, 164, 122]],
    rock: [[104, 98, 90], [128, 120, 108], [84, 80, 76]],
    road: [92, 84, 72], concrete: [140, 138, 132], seabed: [60, 70, 58], water: 0x103848, sky: 0x9fb8cc, fog: 0x8aa0b0, sun: 0xfff1dc, ambient: 0x8fa6c0, exposure: 1.0, sunI: 2.6, hemiI: 1.05,
  },
  desert: {
    grass: [[176, 148, 98], [190, 160, 108], [164, 136, 90]],
    dirt: [[150, 116, 76], [138, 106, 70]],
    sand: [[206, 180, 128], [214, 190, 140]],
    rock: [[150, 112, 80], [170, 130, 92], [124, 92, 68]],
    road: [110, 94, 76], concrete: [160, 154, 140], seabed: [120, 110, 80], water: 0x1a4a58, sky: 0xe2c9a0, fog: 0xd4b88e, sun: 0xffe2b8, ambient: 0xc0a888, exposure: 0.88, sunI: 2.2, hemiI: 0.85,
  },
  winter: {
    grass: [[196, 204, 214], [184, 193, 206], [208, 214, 222]],
    dirt: [[150, 150, 156], [128, 130, 138]],
    sand: [[190, 196, 204]],
    rock: [[96, 102, 112], [120, 126, 136], [80, 86, 96]],
    road: [110, 110, 116], concrete: [150, 152, 158], seabed: [70, 80, 96], water: 0x163448, sky: 0xc8d6e6, fog: 0xb8c8d8, sun: 0xdfe8ff, ambient: 0xa6b8d0, exposure: 0.74, sunI: 1.8, hemiI: 0.75,
  },
  wasteland: {
    grass: [[92, 88, 62], [104, 96, 66], [80, 78, 56]],
    dirt: [[96, 76, 60], [84, 66, 54], [110, 88, 66]],
    sand: [[140, 124, 96]],
    rock: [[78, 70, 66], [96, 86, 80], [64, 58, 56]],
    road: [72, 66, 60], concrete: [110, 106, 100], seabed: [50, 56, 44], water: 0x223a32, sky: 0xb09a80, fog: 0x9a8670, sun: 0xffd8a8, ambient: 0x9a8a7a, exposure: 0.98, sunI: 2.5, hemiI: 1.0,
  },
};

export function paletteFor(theater: Theater) {
  return PALETTES[theater];
}

export class TerrainView {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  water: THREE.Mesh | null = null;
  colorTex: THREE.CanvasTexture;
  private waterNormal: THREE.Texture | null = null;
  private map: GameMap;

  constructor(map: GameMap) {
    this.map = map;
    const pal = PALETTES[map.theater];
    this.colorTex = this.paintTexture(pal);
    const geo = this.buildGeometry();
    const detail = makeDetailTexture();
    detail.channel = 1;
    const baseMat = new THREE.MeshStandardMaterial({
      map: this.colorTex,
      bumpMap: detail,
      bumpScale: 2.6,
      roughness: 0.95,
      metalness: 0.0,
    });
    // Riftite "infection" map: R = amount, G = rich
    this.oreData = new Uint8Array(map.w * map.h * 4);
    this.oreTex = new THREE.DataTexture(this.oreData, map.w, map.h, THREE.RGBAFormat);
    this.oreTex.magFilter = THREE.LinearFilter;
    this.oreTex.minFilter = THREE.LinearFilter;
    this.updateOre();
    const oreU = { value: this.oreTex };
    const sizeU = { value: new THREE.Vector2(map.w, map.h) };
    const timeU = this.timeU;
    baseMat.onBeforeCompile = (sh) => {
      sh.uniforms.uOreTex = oreU;
      sh.uniforms.uMapSize = sizeU;
      sh.uniforms.uTime = timeU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrXZ;\nuniform sampler2D uOreTex;\nuniform vec2 uMapSize;\nuniform float uTime;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        {
          // high-frequency albedo detail so the ground stays crisp when zoomed in
          float d1 = texture2D(bumpMap, vBumpMapUv * 3.1).r;
          float d2 = texture2D(bumpMap, vBumpMapUv * 0.37 + 0.31).r;
          float d3 = texture2D(bumpMap, vBumpMapUv * 9.7).r;
          diffuseColor.rgb *= (0.78 + d1 * 0.32) * (0.86 + d2 * 0.28) * (0.9 + d3 * 0.2);
          // Riftite-infected soil
          vec4 ore = texture2D(uOreTex, vTerrXZ / uMapSize);
          float amt = smoothstep(0.02, 0.6, ore.r) * (0.75 + d1 * 0.5);
          vec3 tint = mix(vec3(0.10, 0.32, 0.24), vec3(0.24, 0.14, 0.40), ore.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5 + tint * 0.4, clamp(amt, 0.0, 0.7));
        }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        {
          vec4 ore2 = texture2D(uOreTex, vTerrXZ / uMapSize);
          float veins = smoothstep(0.62, 0.8, texture2D(bumpMap, vBumpMapUv * 1.7).r);
          float glow = smoothstep(0.05, 0.7, ore2.r) * (0.012 + veins * 0.16) * (0.8 + 0.2 * sin(uTime * 1.5 + vTerrXZ.x * 0.7));
          totalEmissiveRadiance += mix(vec3(0.1, 0.9, 0.6), vec3(0.5, 0.3, 1.0), ore2.g) * glow;
        }`,
        );
    };
    const mat = registerWorldMaterial(baseMat);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // water plane
    let hasWater = false;
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === Terrain.Water) hasWater = true;
    if (hasWater) {
      this.waterNormal = makeWaterNormal();
      const wm = registerWorldMaterial(
        new THREE.MeshStandardMaterial({
          color: pal.water,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: 0.9,
          envMapIntensity: 0.25,
          normalMap: this.waterNormal,
          normalScale: new THREE.Vector2(0.35, 0.35),
        }),
      );
      const wg = new THREE.PlaneGeometry(map.w, map.h, 1, 1);
      wg.rotateX(-Math.PI / 2);
      wg.translate(map.w / 2, -0.32, map.h / 2);
      const uv = wg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * map.w * 0.12, uv.getY(i) * map.h * 0.12);
      this.water = new THREE.Mesh(wg, wm);
      this.water.receiveShadow = true;
      this.water.renderOrder = 1;
      this.group.add(this.water);
    }
  }

  oreData: Uint8Array;
  oreTex: THREE.DataTexture;
  timeU = { value: 0 };
  private oreVersion = -1;
  private oreTimer = 0;

  updateOre() {
    const map = this.map;
    this.oreVersion = map.oreVersion;
    const d = this.oreData;
    for (let i = 0; i < map.w * map.h; i++) {
      const t = map.oreType[i];
      const max = t === 2 ? 1000 : 600;
      d[i * 4] = t ? Math.min(255, 60 + (map.ore[i] / max) * 195) : 0;
      d[i * 4 + 1] = t === 2 ? 255 : 0;
      d[i * 4 + 3] = 255;
    }
    this.oreTex.needsUpdate = true;
  }

  update(dt: number) {
    this.timeU.value += dt;
    this.oreTimer -= dt;
    if (this.map.oreVersion !== this.oreVersion && this.oreTimer <= 0) {
      this.oreTimer = 1;
      this.updateOre();
    }
    if (this.waterNormal) {
      this.waterNormal.offset.x += dt * 0.02;
      this.waterNormal.offset.y += dt * 0.013;
    }
  }

  private buildGeometry() {
    const map = this.map;
    const { w, h } = map;
    // 2 segments per tile for smoother hills
    const S = 2;
    const nx = w * S + 1, nz = h * S + 1;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const uv1 = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = i / S, z = j / S;
        const k = j * nx + i;
        let y = map.heightAt(x, z);
        // roughen rock surfaces
        const tx = Math.min(w - 1, Math.floor(x)), tz = Math.min(h - 1, Math.floor(z));
        if (map.terrain[tz * w + tx] === Terrain.Rock) y += (valueNoise(x * 1.7, z * 1.7, 5) - 0.5) * 0.5;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / w;
        uv[k * 2 + 1] = 1 - z / h;
        uv1[k * 2] = x * 0.35;
        uv1[k * 2 + 1] = z * 0.35;
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  private paintTexture(pal: Palette) {
    const map = this.map;
    const { w, h } = map;
    const W = w * PX, H = h * PX;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const d = img.data;

    // per-tile base colours
    const tileCol = new Float32Array(w * h * 3);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        const t = map.terrain[i];
        let c: [number, number, number];
        const pick = (arr: [number, number, number][]) => arr[Math.floor(valueNoise(x * 0.35, z * 0.35, 9) * arr.length * 0.999)];
        switch (t) {
          case Terrain.Dirt: c = pick(pal.dirt); break;
          case Terrain.Sand: c = pick(pal.sand); break;
          case Terrain.Rock: c = pick(pal.rock); break;
          case Terrain.Water: c = pal.seabed; break;
          case Terrain.Road: c = pal.road; break;
          case Terrain.Concrete: c = pal.concrete; break;
          default: c = pick(pal.grass);
        }
        tileCol[i * 3] = c[0];
        tileCol[i * 3 + 1] = c[1];
        tileCol[i * 3 + 2] = c[2];
      }
    const tc = (x: number, z: number, k: number) => {
      x = clamp(x, 0, w - 1);
      z = clamp(z, 0, h - 1);
      return tileCol[(z * w + x) * 3 + k];
    };
    const rockCol = pal.rock[0];
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        // continuous tile coords, with noise warp for organic borders
        const fx = px / PX, fz = py / PX;
        const wx = fx - 0.5 + (fbm(fx * 0.9, fz * 0.9, 2, 3) - 0.5) * 0.9;
        const wz = fz - 0.5 + (fbm(fx * 0.9 + 7, fz * 0.9, 2, 4) - 0.5) * 0.9;
        const x0 = Math.floor(wx), z0 = Math.floor(wz);
        const tx = wx - x0, tz = wz - z0;
        const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < 3; k++) {
          const a = tc(x0, z0, k), bb = tc(x0 + 1, z0, k), c = tc(x0, z0 + 1, k), dd = tc(x0 + 1, z0 + 1, k);
          const v = (a * (1 - sx) + bb * sx) * (1 - sz) + (c * (1 - sx) + dd * sx) * sz;
          if (k === 0) r = v;
          else if (k === 1) g = v;
          else b = v;
        }
        // slope-based rock blend
        const hx = map.heightAt(fx + 0.25, fz) - map.heightAt(fx - 0.25, fz);
        const hz = map.heightAt(fx, fz + 0.25) - map.heightAt(fx, fz - 0.25);
        const slope = Math.sqrt(hx * hx + hz * hz) * 2;
        const rb = clamp((slope - 0.35) * 1.6, 0, 0.85);
        const hgt = map.heightAt(fx, fz);
        if (rb > 0) {
          r = r * (1 - rb) + rockCol[0] * rb;
          g = g * (1 - rb) + rockCol[1] * rb;
          b = b * (1 - rb) + rockCol[2] * rb;
        }
        // multi-scale noise variation
        const n1 = fbm(fx * 0.25, fz * 0.25, 3, 21) - 0.5;
        const n2 = valueNoise(fx * 3.1, fz * 3.1, 33) - 0.5;
        const n3 = valueNoise(fx * 9.7, fz * 9.7, 45) - 0.5;
        const m = 1 + n1 * 0.2 + n2 * 0.14 + n3 * 0.12;
        // ambient-occlusion-ish darkening in valleys
        const ao = clamp(1 + hgt * 0.06, 0.85, 1.12);
        const tt = map.terrainAt(Math.floor(fx), Math.floor(fz));
        if (tt === Terrain.Rock || rb > 0.3) {
          // strata + cracks for rocky surfaces
          const strata = Math.sin(hgt * 9 + fbm(fx * 0.8, fz * 0.8, 2, 71) * 6) * 0.5 + 0.5;
          const crack = valueNoise(fx * 5.3, fz * 5.3, 81);
          const k = (tt === Terrain.Rock ? 1 : rb) * (0.75 + strata * 0.35) * (crack < 0.22 ? 0.6 : 1);
          r = r * (1 - 0.35) + r * k * 0.35;
          g = g * (1 - 0.35) + g * k * 0.35;
          b = b * (1 - 0.35) + b * k * 0.35;
        }
        let rr = r * m * ao, gg = g * m * ao, bbb = b * m * ao;
        if (tt === Terrain.Road) {
          // tire tracks
          const lane = Math.abs(((fx + fz) * 2.2) % 1 - 0.5);
          if (lane < 0.08) {
            rr *= 0.85;
            gg *= 0.85;
            bbb *= 0.85;
          }
        }
        const o = (py * W + px) * 4;
        d[o] = clamp(rr, 0, 255);
        d[o + 1] = clamp(gg, 0, 255);
        d[o + 2] = clamp(bbb, 0, 255);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  /** Paint a scorch mark permanently into the terrain texture. */
  scorch(x: number, z: number, r: number) {
    const canvas = this.colorTex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const cx = x * PX, cy = z * PX, rr = r * PX;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, 'rgba(20,16,12,0.55)');
    g.addColorStop(0.6, 'rgba(30,24,18,0.3)');
    g.addColorStop(1, 'rgba(30,24,18,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
    this.scorchDirty = true;
  }
  scorchDirty = false;
  private scorchTimer = 0;
  flushScorch(dt: number) {
    this.scorchTimer -= dt;
    if (this.scorchDirty && this.scorchTimer <= 0) {
      this.scorchDirty = false;
      this.scorchTimer = 0.5;
      this.colorTex.needsUpdate = true;
    }
  }

  /** Paint concrete under a building footprint. */
  paintFoundation(tx: number, tz: number, w: number, h: number, theater: Theater) {
    const canvas = this.colorTex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const pal = PALETTES[theater];
    const c = pal.concrete;
    ctx.fillStyle = `rgba(${c[0] * 0.75},${c[1] * 0.75},${c[2] * 0.75},0.55)`;
    const m = 2;
    ctx.fillRect(tx * PX - m, tz * PX - m, w * PX + m * 2, h * PX + m * 2);
    this.scorchDirty = true;
  }
}

function makeDetailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // tileable noise by wrapping coordinates
      const n = tileNoise(x, y, S, 8, 1) * 0.5 + tileNoise(x, y, S, 32, 2) * 0.35 + tileNoise(x, y, S, 64, 3) * 0.15;
      const v = clamp(n * 255, 0, 255);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function tileNoise(x: number, y: number, S: number, freq: number, seed: number) {
  const fx = (x / S) * freq, fy = (y / S) * freq;
  const xi = Math.floor(fx), yi = Math.floor(fy);
  const tx = fx - xi, ty = fy - yi;
  const hsh = (a: number, b: number) => {
    a = ((a % freq) + freq) % freq;
    b = ((b % freq) + freq) % freq;
    let h = a * 374761393 + b * 668265263 + seed * 1442695;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
  return (a * (1 - s(tx)) + b * s(tx)) * (1 - s(ty)) + (c * (1 - s(tx)) + d * s(tx)) * s(ty);
}

function makeWaterNormal() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const hgt = (x: number, y: number) => tileNoise(x, y, S, 8, 7) * 0.6 + tileNoise(x, y, S, 16, 8) * 0.4;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y);
      const dy = hgt(x, y + 1) - hgt(x, y - 1);
      const nx = -dx * 6, ny = -dy * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (y * S + x) * 4;
      img.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
