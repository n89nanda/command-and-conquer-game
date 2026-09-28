import * as THREE from 'three';
import { GameMap, Terrain, type Theater } from '../game/GameMap';
import { clamp, fbm, valueNoise } from '../game/util';
import { registerWorldMaterial } from './materials';

const PX = 8; // texels per tile for the terrain colour / splat maps
/** World height of the water surface. MapGen keeps every non-water corner above it. */
export const WATER_LEVEL = -0.32;
/** Terrain skirt extends this many tiles past the map edge (under the shroud). */
const SKIRT = 12;

type RGB = [number, number, number];

interface Palette {
  grass: RGB[];
  dirt: RGB[];
  sand: RGB[];
  rock: RGB[];
  road: RGB;
  concrete: RGB;
  seabed: RGB;
  water: number;
  sky: number;
  fog: number;
  sun: number;
  ambient: number;
  /** grading: tone-mapping exposure, sun & hemisphere intensities */
  exposure: number;
  sunI: number;
  hemiI: number;
  /** cliff strata tint, and the colour of flat rock shelves (dust / lichen / snow) */
  cliff: number;
  rockTop: number;
  /** water: shallow / deep colour */
  shallow: number;
  deep: number;
  /** detail-splat multipliers [dark, light] for the grass(snow) / gravel / sand channels */
  det: [RGB, RGB][];
  /** strength of the broad warm/cool colour drift painted into the ground */
  hue: number;
}

const TEMPERATE_DET: [RGB, RGB][] = [
  [[0.56, 0.62, 0.66], [1.42, 1.38, 1.14]],
  [[0.6, 0.6, 0.62], [1.4, 1.36, 1.3]],
  [[0.87, 0.87, 0.87], [1.12, 1.11, 1.08]],
];

const PALETTES: Record<Theater, Palette> = {
  temperate: {
    grass: [[93, 122, 54], [84, 110, 50], [104, 118, 60], [78, 102, 46], [110, 116, 64]],
    dirt: [[122, 98, 71], [112, 90, 66], [132, 106, 76]],
    sand: [[176, 156, 114], [186, 166, 124]],
    rock: [[109, 101, 92], [118, 110, 100], [96, 90, 82]],
    road: [104, 94, 80], concrete: [140, 138, 132], seabed: [74, 80, 62], water: 0x103848, sky: 0x9fb8cc, fog: 0x8aa0b0, sun: 0xfff1dc, ambient: 0x8fa6c0, exposure: 1.0, sunI: 2.6, hemiI: 1.05,
    cliff: 0x6d655c, rockTop: 0x7c7866, shallow: 0x3f8f8a, deep: 0x0b2635,
    det: TEMPERATE_DET,
    hue: 1,
  },
  desert: {
    grass: [[176, 148, 98], [190, 160, 108], [164, 136, 90]],
    dirt: [[150, 114, 74], [138, 104, 68]],
    sand: [[206, 180, 128], [214, 190, 140]],
    rock: [[156, 109, 76], [170, 122, 86], [138, 98, 70]],
    road: [118, 100, 80], concrete: [160, 154, 140], seabed: [128, 116, 84], water: 0x1a4a58, sky: 0xe2c9a0, fog: 0xd4b88e, sun: 0xffe2b8, ambient: 0xc0a888, exposure: 0.88, sunI: 2.2, hemiI: 0.85,
    cliff: 0x9c6d4c, rockTop: 0xb48e66, shallow: 0x4a9a8c, deep: 0x0e3038,
    det: [
      [[0.74, 0.72, 0.7], [1.22, 1.2, 1.12]],
      [[0.7, 0.68, 0.68], [1.28, 1.26, 1.22]],
      [[0.86, 0.85, 0.84], [1.13, 1.12, 1.1]],
    ],
    hue: 0.5,
  },
  winter: {
    grass: [[200, 208, 218], [190, 199, 212], [210, 216, 224]],
    dirt: [[134, 132, 136], [118, 118, 126]],
    sand: [[176, 184, 194]],
    rock: [[104, 114, 128], [120, 128, 140], [90, 98, 112]],
    road: [86, 88, 96], concrete: [150, 152, 158], seabed: [74, 84, 100], water: 0x163448, sky: 0xc8d6e6, fog: 0xb8c8d8, sun: 0xdfe8ff, ambient: 0xa6b8d0, exposure: 0.74, sunI: 1.8, hemiI: 0.75,
    cliff: 0x687484, rockTop: 0xd8e0ea, shallow: 0x4a8a98, deep: 0x0c2438,
    det: [
      [[0.86, 0.88, 0.93], [1.1, 1.1, 1.08]],
      [[0.62, 0.62, 0.66], [1.36, 1.36, 1.36]],
      [[0.84, 0.85, 0.88], [1.14, 1.14, 1.12]],
    ],
    hue: 0,
  },
  wasteland: {
    grass: [[98, 92, 60], [108, 98, 64], [88, 84, 56]],
    dirt: [[104, 80, 60], [92, 70, 54], [116, 90, 66]],
    sand: [[140, 124, 96]],
    rock: [[95, 86, 80], [106, 96, 88], [82, 74, 70]],
    road: [80, 72, 64], concrete: [110, 106, 100], seabed: [58, 60, 46], water: 0x223a32, sky: 0xb09a80, fog: 0x9a8670, sun: 0xffd8a8, ambient: 0x9a8a7a, exposure: 0.98, sunI: 2.5, hemiI: 1.0,
    cliff: 0x5f5650, rockTop: 0x6c6252, shallow: 0x587a62, deep: 0x13271f,
    det: [
      [[0.6, 0.6, 0.62], [1.36, 1.3, 1.14]],
      [[0.6, 0.6, 0.62], [1.4, 1.34, 1.28]],
      [[0.87, 0.87, 0.87], [1.12, 1.11, 1.08]],
    ],
    hue: 0.8,
  },
};

export function paletteFor(theater: Theater) {
  return PALETTES[theater];
}

// ------------------------------------------------------------- rendered surface heights
/**
 * The render mesh adds jagged relief inside rock masses (render-only; nothing walks there).
 * Props that sit on the terrain (rocks, crystals) should use surfaceHeightAt so they stay grounded.
 */
const surfaces = new WeakMap<GameMap, { grid: Float32Array; n: number; s: number }>();
export function surfaceHeightAt(map: GameMap, x: number, z: number) {
  const g = surfaces.get(map);
  if (!g) return map.heightAt(x, z);
  const fx = clamp(x, 0, map.w - 0.0001) * g.s, fz = clamp(z, 0, map.h - 0.0001) * g.s;
  const xi = Math.floor(fx), zi = Math.floor(fz);
  const tx = fx - xi, tz = fz - zi;
  const k = zi * g.n + xi;
  const a = g.grid[k], b = g.grid[k + 1], c = g.grid[k + g.n], d = g.grid[k + g.n + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

const tmpCol = new THREE.Color();
function linear(hex: number) {
  tmpCol.setHex(hex); // sRGB hex -> linear working space
  return new THREE.Vector3(tmpCol.r, tmpCol.g, tmpCol.b);
}

export class TerrainView {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  water: THREE.Mesh | null = null;
  colorTex: THREE.CanvasTexture;
  splatTex: THREE.DataTexture;
  private splatData: Uint8Array;
  private map: GameMap;

  oreData: Uint8Array;
  oreTex: THREE.DataTexture;
  timeU = { value: 0 };
  private oreVersion = -1;
  private oreTimer = 0;

  constructor(map: GameMap) {
    this.map = map;
    const pal = PALETTES[map.theater];
    const painted = this.paintTexture(pal);
    this.colorTex = painted.color;
    this.splatTex = painted.splat;
    this.splatData = painted.splatData;
    const geo = this.buildGeometry();
    const detail = makeDetailTexture(map.theater);
    const baseMat = new THREE.MeshStandardMaterial({
      map: this.colorTex,
      bumpMap: detail,
      bumpScale: 1.6,
      roughness: 0.94,
      metalness: 0.0,
      vertexColors: true,
    });
    // Riftite "infection" map: R = amount, G = rich
    this.oreData = new Uint8Array(map.w * map.h * 4);
    this.oreTex = new THREE.DataTexture(this.oreData, map.w, map.h, THREE.RGBAFormat);
    this.oreTex.magFilter = THREE.LinearFilter;
    this.oreTex.minFilter = THREE.LinearFilter;
    this.updateOre();
    const U = {
      uOreTex: { value: this.oreTex },
      uSplat: { value: this.splatTex },
      uMapSize: { value: new THREE.Vector2(map.w, map.h) },
      uTime: this.timeU,
      uRockCol: { value: linear(pal.cliff) },
      uRockTop: { value: linear(pal.rockTop) },
      uDetLo: { value: pal.det.map((d) => new THREE.Vector3(...d[0])) },
      uDetHi: { value: pal.det.map((d) => new THREE.Vector3(...d[1])) },
    };
    const bumpPars = THREE.ShaderChunk.bumpmap_pars_fragment.replace(
      'uniform float bumpScale;',
      `uniform float bumpScale;
      // bump height follows the detail-splat weights (rgb = grass/gravel/sand, a = rock grain)
      vec4 gSplatW = vec4(0.0);
      float bumpH(vec2 uv) { return dot(texture2D(bumpMap, uv), gSplatW); }`,
    ).replace(/texture2D\( bumpMap, ([^)]*?) \)\.x/g, 'bumpH( $1 )');
    baseMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrPos;\nvarying vec3 vTerrN;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vTerrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrN = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrPos;
          varying vec3 vTerrN;
          uniform sampler2D uOreTex;
          uniform sampler2D uSplat;
          uniform vec2 uMapSize;
          uniform float uTime;
          uniform vec3 uRockCol;
          uniform vec3 uRockTop;
          uniform vec3 uDetLo[3];
          uniform vec3 uDetHi[3];
          vec4 gOre;`,
        )
        .replace('#include <bumpmap_pars_fragment>', bumpPars)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        {
          vec2 wxz = vTerrPos.xz;
          // two scales of the packed detail texture (r grass/snow, g gravel, b sand ripples, a rock grain)
          vec4 d1 = texture2D(bumpMap, vBumpMapUv);
          vec4 d2 = texture2D(bumpMap, mat2(0.8, -0.6, 0.6, 0.8) * vBumpMapUv * 0.27 + 0.41);
          vec4 det = clamp(d1 + (d2 - 0.5) * 0.55, 0.0, 1.0);
          vec4 sw = texture2D(uSplat, (wxz + (d2.xy - 0.5) * 0.3) / uMapSize);
          vec3 wn = normalize(vTerrN);
          float slope = 1.0 - wn.y;
          float rockW = max(sw.a, smoothstep(0.3, 0.58, slope + (det.a - 0.5) * 0.24));
          vec3 gw = sw.rgb * (1.0 - rockW);
          vec3 M = vec3(1.0 - (gw.r + gw.g + gw.b));
          M += gw.r * mix(uDetLo[0], uDetHi[0], det.r);
          M += gw.g * mix(uDetLo[1], uDetHi[1], det.g);
          M += gw.b * mix(uDetLo[2], uDetHi[2], det.b);
          diffuseColor.rgb *= M;
          // cliffs: triplanar grain + horizontal strata, flat shelves get the top colour
          vec3 bw = wn * wn; bw *= bw; bw /= (bw.x + bw.y + bw.z);
          vec3 rp = vTerrPos * 0.42;
          float grain = texture2D(bumpMap, rp.zy).a * bw.x + texture2D(bumpMap, rp.xz).a * bw.y + texture2D(bumpMap, rp.xy + 0.5).a * bw.z;
          float sy = vTerrPos.y * 2.3 + grain * 0.9 + d2.b * 1.3;
          float layer = floor(sy);
          float lf = fract(sy);
          float lh = fract(sin(layer * 78.233) * 43758.5453);
          float groove = mix(0.38, 1.0, smoothstep(0.0, 0.18, lf)) * mix(1.0, 0.78, smoothstep(0.74, 1.0, lf));
          float steep = smoothstep(0.14, 0.46, slope);
          vec3 face = uRockCol * (0.62 + lh * 0.6) * (0.45 + grain * 0.95) * groove;
          vec3 top = uRockTop * (0.52 + grain * 0.9) * (0.9 + d2.r * 0.2) * mix(0.72, 1.0, smoothstep(0.18, 0.3, det.a));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(top, face, steep), rockW);
          gSplatW = vec4(gw, rockW * (1.0 - steep) * 0.7);
          // Riftite-infected soil (subtle)
          gOre = texture2D(uOreTex, wxz / uMapSize);
          float amt = smoothstep(0.02, 0.6, gOre.r) * (0.7 + det.g * 0.6);
          vec3 tint = mix(vec3(0.10, 0.30, 0.22), vec3(0.22, 0.13, 0.36), gOre.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + tint * 0.26, clamp(amt, 0.0, 0.5));
        }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        {
          float veins = smoothstep(0.64, 0.82, texture2D(bumpMap, vBumpMapUv * 0.6 + 0.13).a);
          float glow = smoothstep(0.05, 0.7, gOre.r) * (0.006 + veins * 0.08) * (0.8 + 0.2 * sin(uTime * 1.5 + vTerrPos.x * 0.7));
          totalEmissiveRadiance += mix(vec3(0.1, 0.9, 0.6), vec3(0.5, 0.3, 1.0), gOre.g) * glow;
        }`,
        );
    };
    baseMat.customProgramCacheKey = () => 'rf-terrain-2';
    const mat = registerWorldMaterial(baseMat);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // water
    let hasWater = false;
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === Terrain.Water) hasWater = true;
    if (hasWater) this.water = this.buildWater(pal);
  }

  private buildWater(pal: Palette) {
    const map = this.map;
    const { w, h } = map;
    // baked at 4px/tile: R = depth below the surface ((d + 0.25) / 1.25), G = signed distance into
    // the water body in tiles ((sd + 1) / 3), blurred so the shoreline contour is organic, not tile-shaped
    const Q = 4, W4 = w * Q, H4 = h * Q, N4 = W4 * H4;
    const sd = new Float32Array(N4);
    const BIG = 1e5;
    for (let j = 0; j < H4; j++)
      for (let i = 0; i < W4; i++) sd[j * W4 + i] = map.terrain[((j / Q) | 0) * w + ((i / Q) | 0)] === Terrain.Water ? BIG : -BIG;
    // two-sided chamfer: positive distance to land inside water, negative distance to water on land
    const chamfer = (sign: number) => {
      const d = new Float32Array(N4);
      for (let k = 0; k < N4; k++) d[k] = sd[k] * sign > 0 ? BIG : 0;
      const pass = (j0: number, j1: number, dj: number, i0: number, i1: number, di: number) => {
        for (let j = j0; j !== j1; j += dj)
          for (let i = i0; i !== i1; i += di) {
            const k = j * W4 + i;
            if (!d[k]) continue;
            let v = d[k];
            const pi = i - di, pj = j - dj;
            if (pi >= 0 && pi < W4) v = Math.min(v, d[k - di] + 1);
            if (pj >= 0 && pj < H4) {
              v = Math.min(v, d[k - dj * W4] + 1);
              if (pi >= 0 && pi < W4) v = Math.min(v, d[k - dj * W4 - di] + 1.414);
              const qi = i + di;
              if (qi >= 0 && qi < W4) v = Math.min(v, d[k - dj * W4 + di] + 1.414);
            }
            d[k] = v;
          }
      };
      pass(0, H4, 1, 0, W4, 1);
      pass(H4 - 1, -1, -1, W4 - 1, -1, -1);
      return d;
    };
    const dIn = chamfer(1), dOut = chamfer(-1);
    for (let k = 0; k < N4; k++) sd[k] = Math.min(dIn[k], 4 * Q) - Math.min(dOut[k], 4 * Q);
    // separable box blur (radius 2px, twice) rounds the tile corners
    const tmp = new Float32Array(N4);
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < H4; j++)
        for (let i = 0; i < W4; i++) {
          let a = 0;
          for (let o = -2; o <= 2; o++) a += sd[j * W4 + Math.min(W4 - 1, Math.max(0, i + o))];
          tmp[j * W4 + i] = a / 5;
        }
      for (let j = 0; j < H4; j++)
        for (let i = 0; i < W4; i++) {
          let a = 0;
          for (let o = -2; o <= 2; o++) a += tmp[Math.min(H4 - 1, Math.max(0, j + o)) * W4 + i];
          sd[j * W4 + i] = a / 5;
        }
    }
    const dd = new Uint8Array(N4 * 2);
    for (let j = 0; j < H4; j++)
      for (let i = 0; i < W4; i++) {
        const k = j * W4 + i;
        const depth = WATER_LEVEL - map.heightAt((i + 0.5) / Q, (j + 0.5) / Q);
        dd[k * 2] = clamp(((depth + 0.25) / 1.25) * 255, 0, 255);
        dd[k * 2 + 1] = clamp(((sd[k] / Q + 1) / 3) * 255, 0, 255);
      }
    const depthTex = new THREE.DataTexture(dd, W4, H4, THREE.RGFormat, THREE.UnsignedByteType);
    depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;
    const nrm = makeWaterTexture();
    const skyC = new THREE.Color(pal.sky);
    const U = {
      uDepthTex: { value: depthTex },
      uWaterTex: { value: nrm },
      uMapSize: { value: new THREE.Vector2(w, h) },
      uTime: this.timeU,
      uShallow: { value: linear(pal.shallow) },
      uDeep: { value: linear(pal.deep) },
      uFoam: { value: linear(0xdfeee8) },
      uSky: { value: new THREE.Vector3(skyC.r, skyC.g, skyC.b).multiplyScalar(0.75) },
    };
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 0.6,
    });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          uniform sampler2D uDepthTex;
          uniform sampler2D uWaterTex;
          uniform vec2 uMapSize;
          uniform float uTime;
          uniform vec3 uShallow;
          uniform vec3 uDeep;
          uniform vec3 uFoam;
          uniform vec3 uSky;
          float wFoam = 0.0;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        {
          vec2 p = vWPos.xz;
          vec2 dt = texture2D(uDepthTex, p / uMapSize).rg;
          float depth = dt.r * 1.25 - 0.25;
          float n1 = texture2D(uWaterTex, p * 0.11 + uTime * vec2(0.012, 0.008)).a;
          float n2 = texture2D(uWaterTex, p * 0.53 - uTime * vec2(0.021, 0.034)).a;
          // organic shoreline: distance into the water body, pushed around by noise
          float e = dt.g * 3.0 - 1.0 - 0.44 + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.12;
          if (e < 0.0 || depth < -0.02) discard;
          float dj = max(depth, 0.0) + (n1 - 0.5) * 0.07;
          vec3 col = mix(uShallow, uDeep, smoothstep(0.03, 0.6, min(dj, e * 0.8)));
          float a = mix(0.55, 0.95, smoothstep(0.0, 0.5, min(dj, e)));
          // shore foam: a noisy band along the edge plus waves rolling in toward the beach
          float band = 1.0 - smoothstep(0.02, 0.3, e);
          float waves = sin(e * 20.0 - uTime * 1.7 + n1 * 7.0) * 0.5 + 0.5;
          wFoam = clamp(band * smoothstep(0.45, 0.85, waves * 0.55 + n2 * 0.65) + (1.0 - smoothstep(0.0, 0.07, e)) * (0.45 + 0.5 * n2), 0.0, 1.0);
          col = mix(col, uFoam, wFoam * 0.9);
          a = mix(a, 1.0, wFoam * 0.8) * smoothstep(0.0, 0.035, e);
          diffuseColor = vec4(col, a);
        }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoam);')
        .replace(
          '#include <normal_fragment_maps>',
          `{
          vec2 p = vWPos.xz;
          vec3 na = texture2D(uWaterTex, p * 0.16 + uTime * vec2(0.019, 0.011)).xyz * 2.0 - 1.0;
          vec3 nb = texture2D(uWaterTex, p * 0.29 + uTime * vec2(-0.015, 0.022)).xyz * 2.0 - 1.0;
          vec2 g = (na.xy + nb.xy) * 0.2;
          normal = normalize((viewMatrix * vec4(normalize(vec3(g.x, 1.0, g.y)), 0.0)).xyz);
        }`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
          // stylised fresnel toward the sky colour (the RTS camera never sees true grazing angles)
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fr = clamp(0.06 + 1.1 * pow(1.0 - nv, 2.5), 0.0, 0.75) * (1.0 - wFoam);
          outgoingLight = mix(outgoingLight, uSky, fr);
          diffuseColor.a = max(diffuseColor.a, fr * diffuseColor.a * 1.2);
        }
        #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'rf-water-2';
    const wm = registerWorldMaterial(m);
    const wg = new THREE.PlaneGeometry(w, h, 1, 1);
    wg.rotateX(-Math.PI / 2);
    wg.translate(w / 2, WATER_LEVEL, h / 2);
    const water = new THREE.Mesh(wg, wm);
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.group.add(water);
    return water;
  }

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
  }

  private buildGeometry() {
    const map = this.map;
    const { w, h } = map;
    const S = 2; // segments per tile inside the map
    const ring = [SKIRT, 8, 5, 3, 1.5, 0.5]; // skirt vertex distances outside the edge
    const axis = (n: number) => {
      const a: number[] = ring.map((d) => -d);
      for (let i = 0; i <= n * S; i++) a.push(i / S);
      for (let k = ring.length - 1; k >= 0; k--) a.push(n + ring[k]);
      return a;
    };
    const xs = axis(w), zs = axis(h);
    const nx = xs.length, nz = zs.length;
    const off = ring.length; // index of x=0
    const T = map.terrain;
    const isRock = (tx: number, tz: number) => tx < 0 || tz < 0 || tx >= w || tz >= h || T[tz * w + tx] === Terrain.Rock;
    // render relief inside rock: lift thin ridges and add jagged noise (never on walkable corners)
    const jag = (x: number, z: number) => (valueNoise(x * 1.9, z * 1.9, 5) - 0.5) * 0.4 + (valueNoise(x * 4.3, z * 4.3, 7) - 0.5) * 0.14;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const uv1 = new Float32Array(nx * nz * 2);
    const col = new Float32Array(nx * nz * 3);
    const out = new Float32Array(nx * nz);
    const n = w * S + 1;
    const grid = new Float32Array(n * (h * S + 1));
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = xs[i], z = zs[j];
        const k = j * nx + i;
        const cx = clamp(x, 0, w), cz = clamp(z, 0, h);
        const dOut = Math.hypot(x - cx, z - cz);
        let y = map.heightAt(cx, cz);
        if (dOut > 0) {
          // skirt: the border mountains keep rising and roughening, then fade into the shroud
          y += dOut * 0.16 + (fbm(x * 0.13, z * 0.13, 3, 31) - 0.35) * Math.min(dOut, 6) * 0.5 + jag(x, z);
        } else {
          const x0 = Math.floor(x - 0.001), x1 = Math.floor(x + 0.001), z0 = Math.floor(z - 0.001), z1 = Math.floor(z + 0.001);
          if (isRock(x0, z0) && isRock(x1, z0) && isRock(x0, z1) && isRock(x1, z1)) y = Math.max(y, 0.75 + valueNoise(x * 0.8, z * 0.8, 23) * 0.55) + jag(x, z);
        }
        if (dOut === 0 && i - off <= w * S && j - off <= h * S) grid[(j - off) * n + (i - off)] = y;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / w;
        uv[k * 2 + 1] = 1 - z / h;
        uv1[k * 2] = x * 0.5;
        uv1[k * 2 + 1] = z * 0.5;
        out[k] = dOut;
      }
    surfaces.set(map, { grid, n, s: S });
    // ambient occlusion: darken ground at the foot of cliffs and in crevices (sampled on the render grid)
    const nzg = h * S + 1;
    const gh = (gi: number, gj: number) => grid[(gj < 0 ? 0 : gj >= nzg ? nzg - 1 : gj) * n + (gi < 0 ? 0 : gi >= n ? n - 1 : gi)];
    const D8 = [[2, 0], [1, 1], [0, 2], [-1, 1], [-2, 0], [-1, -1], [0, -2], [1, -1]];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const d = out[k];
        let ao = 1;
        if (d === 0) {
          const gi = i - off, gj = j - off;
          const y = pos[k * 3 + 1];
          let occ = 0;
          for (const [dx, dz] of D8) {
            const r1 = dx && dz ? 1.414 : 1;
            occ += Math.max(0, gh(gi + dx, gj + dz) - y - 0.12) / r1;
            occ += Math.max(0, gh(gi + dx * 2, gj + dz * 2) - y - 0.12) / (r1 * 2);
          }
          ao = Math.max(0.5, 1 / (1 + occ * 0.07)) * clamp(1 + y * 0.04, 0.92, 1.06);
          if (y < WATER_LEVEL) ao = 0.4 + ao * 0.6; // the water shader already handles depth
        } else ao = 0.55 * Math.pow(Math.max(0, 1 - d / SKIRT), 1.5);
        col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
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
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
    const splat = new Uint8Array(W * H * 4);

    // per-tile base colours + splat weights (grass/snow, gravel/dirt, sand, rock)
    const tileCol = new Float32Array(w * h * 3);
    const tileW = new Float32Array(w * h * 4);
    const road = new Float32Array(w * h);
    const cliffRGB: RGB = [(pal.cliff >> 16) & 255, (pal.cliff >> 8) & 255, pal.cliff & 255];
    // under water tiles: darkened wet sand (the shoreline sits inside the water tiles, so this shows)
    const wetSand: RGB = [pal.sand[0][0] * 0.8 + pal.seabed[0] * 0.2, pal.sand[0][1] * 0.8 + pal.seabed[1] * 0.2, pal.sand[0][2] * 0.78 + pal.seabed[2] * 0.2];
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        const t = map.terrain[i];
        let c: RGB;
        let wi = 0;
        const pick = (arr: RGB[]) => arr[Math.floor(valueNoise(x * 0.35, z * 0.35, 9) * arr.length * 0.999)];
        switch (t) {
          case Terrain.Dirt: c = pick(pal.dirt); wi = 1; break;
          case Terrain.Sand: c = pick(pal.sand); wi = 2; break;
          case Terrain.Rock: c = cliffRGB; wi = 3; break;
          case Terrain.Water: c = wetSand; wi = 2; break;
          case Terrain.Road: c = pick(pal.dirt); wi = 1; road[i] = 1; break;
          case Terrain.Concrete: c = pal.concrete; wi = -1; break;
          default: c = pick(pal.grass);
        }
        tileCol[i * 3] = c[0];
        tileCol[i * 3 + 1] = c[1];
        tileCol[i * 3 + 2] = c[2];
        if (wi >= 0) tileW[i * 4 + wi] = 255;
        else tileW[i * 4 + 1] = 70;
      }
    const cl = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
    const rc = pal.road;
    const roadNear = new Uint8Array(w * h);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        if (!road[z * w + x]) continue;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) roadNear[cl(z + dz, h) * w + cl(x + dx, w)] = 1;
      }
    // blurred road field (1-2-1 kernel) so diagonal tile staircases become smooth bands
    const roadB = new Float32Array(w * h);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        if (!roadNear[z * w + x]) continue;
        let a = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) a += road[cl(z + dz, h) * w + cl(x + dx, w)] * (dx ? 1 : 2) * (dz ? 1 : 2);
        roadB[z * w + x] = a / 16;
      }
    // precomputed value-noise lattices (much cheaper per pixel than hashing)
    const LA = new Lattice(0.9, 3, w, h), LB = new Lattice(0.9, 4, w, h), LC = new Lattice(2.6, 5, w, h), LD = new Lattice(2.6, 6, w, h);
    const L1 = new Lattice(0.22, 21, w, h), L1b = new Lattice(0.44, 22, w, h), L2 = new Lattice(3.1, 33, w, h);
    for (let py = 0; py < H; py++) {
      const fz = (py + 0.5) / PX;
      for (let px = 0; px < W; px++) {
        const fx = (px + 0.5) / PX;
        // continuous tile coords, with noise warp for organic borders
        const nA = LA.at(fx, fz) - 0.5, nB = LB.at(fx, fz) - 0.5;
        const nC = LC.at(fx, fz) - 0.5, nD = LD.at(fx, fz) - 0.5;
        const ox = nA * 0.85 + nC * 0.35, oz = nB * 0.85 + nD * 0.35;
        const wx = fx - 0.5 + ox, wz = fz - 0.5 + oz;
        const x0 = Math.floor(wx), z0 = Math.floor(wz);
        const tx = wx - x0, tz = wz - z0;
        const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
        const ia = cl(z0, h) * w + cl(x0, w), ib = cl(z0, h) * w + cl(x0 + 1, w), ic = cl(z0 + 1, h) * w + cl(x0, w), id = cl(z0 + 1, h) * w + cl(x0 + 1, w);
        const wa = (1 - sx) * (1 - sz), wb = sx * (1 - sz), wc = (1 - sx) * sz, wd = sx * sz;
        let r = tileCol[ia * 3] * wa + tileCol[ib * 3] * wb + tileCol[ic * 3] * wc + tileCol[id * 3] * wd;
        let g = tileCol[ia * 3 + 1] * wa + tileCol[ib * 3 + 1] * wb + tileCol[ic * 3 + 1] * wc + tileCol[id * 3 + 1] * wd;
        let b = tileCol[ia * 3 + 2] * wa + tileCol[ib * 3 + 2] * wb + tileCol[ic * 3 + 2] * wc + tileCol[id * 3 + 2] * wd;
        const o = (py * W + px) * 4;
        for (let k = 0; k < 4; k++) splat[o + k] = tileW[ia * 4 + k] * wa + tileW[ib * 4 + k] * wb + tileW[ic * 4 + k] * wc + tileW[id * 4 + k] * wd;
        // multi-scale noise variation (patchy grass, damp soil)
        const n1 = L1.at(fx, fz) * 0.67 + L1b.at(fx, fz) * 0.33 - 0.5;
        const n2 = L2.at(fx, fz) - 0.5;
        const m = 1 + n1 * 0.24 + n2 * 0.1;
        const hue = nA * nB * 1.6 * pal.hue; // broad warm/cool drift so large fields aren't one flat colour
        r *= m * (1 + hue * 0.4 + nC * 0.05 * pal.hue);
        g *= m * (1 + n1 * 0.06);
        b *= m * (1 - hue * 0.3);
        // roads: crisp edges, darker shoulders, ruts and gravel speckle
        const rx = fx - 0.5 + ox * 0.2, rz = fz - 0.5 + oz * 0.2;
        const rx0 = Math.floor(rx), rz0 = Math.floor(rz);
        const rtx = rx - rx0, rtz = rz - rz0;
        const rk = !roadNear[(fz | 0) * w + (fx | 0)] ? 0 :
          (roadB[cl(rz0, h) * w + cl(rx0, w)] * (1 - rtx) + roadB[cl(rz0, h) * w + cl(rx0 + 1, w)] * rtx) * (1 - rtz) +
          (roadB[cl(rz0 + 1, h) * w + cl(rx0, w)] * (1 - rtx) + roadB[cl(rz0 + 1, h) * w + cl(rx0 + 1, w)] * rtx) * rtz;
        if (rk > 0.2) {
          const mask = clamp((rk - 0.335) / 0.05, 0, 1);
          const shoulder = clamp((rk - 0.22) / 0.115, 0, 1) * (1 - mask);
          const hsh = ((Math.imul(px, 73856093) ^ Math.imul(py, 19349663)) >>> 0) / 4294967296;
          const speck = 0.95 + hsh * 0.1; // fine gravel comes from the detail splat
          const rut = (rk > 0.43 && rk < 0.46) || (rk > 0.8 && rk < 0.84) ? 0.84 : 1;
          const k = speck * rut * (1 + n2 * 0.12);
          r = r * (1 - mask) + rc[0] * k * mask;
          g = g * (1 - mask) + rc[1] * k * mask;
          b = b * (1 - mask) + rc[2] * k * mask;
          const sh = 1 - shoulder * 0.22 - (mask > 0 && mask < 1 ? 0.12 : 0);
          r *= sh;
          g *= sh;
          b *= sh;
          const gm = Math.max(mask, shoulder * 0.6);
          splat[o] *= 1 - gm;
          splat[o + 2] *= 1 - gm;
          splat[o + 1] = Math.max(splat[o + 1], gm * 255);
        }
        d[o] = r; // Uint8ClampedArray clamps
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const st = new THREE.DataTexture(splat, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    st.magFilter = THREE.LinearFilter;
    st.minFilter = THREE.LinearMipmapLinearFilter;
    st.generateMipmaps = true;
    st.needsUpdate = true;
    return { color: tex, splat: st, splatData: splat };
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
  private splatDirty = false;
  private scorchTimer = 0;
  flushScorch(dt: number) {
    this.scorchTimer -= dt;
    if ((this.scorchDirty || this.splatDirty) && this.scorchTimer <= 0) {
      this.scorchTimer = 0.5;
      if (this.scorchDirty) this.colorTex.needsUpdate = true;
      if (this.splatDirty) this.splatTex.needsUpdate = true;
      this.scorchDirty = this.splatDirty = false;
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
    // flatten the detail splat to a faint gravel under the pad
    const W = this.map.w * PX, H = this.map.h * PX, sd = this.splatData;
    for (let y = Math.max(0, tz * PX - m); y < Math.min(H, (tz + h) * PX + m); y++)
      for (let x = Math.max(0, tx * PX - m); x < Math.min(W, (tx + w) * PX + m); x++) {
        const o = (y * W + x) * 4;
        sd[o] = sd[o + 2] = sd[o + 3] = 0;
        sd[o + 1] = 90;
      }
    this.splatDirty = true;
  }
}

// ------------------------------------------------------------- procedural textures
/** Smooth value noise over a precomputed random lattice covering [0,w]x[0,h] (with margin). */
class Lattice {
  private v: Float32Array;
  private nx: number;
  private nz: number;
  constructor(private f: number, seed: number, w: number, h: number) {
    this.nx = Math.ceil(w * f) + 6;
    this.nz = Math.ceil(h * f) + 6;
    this.v = new Float32Array(this.nx * this.nz);
    const r = rng(seed * 7919 + 17);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  at(x: number, z: number) {
    let gx = x * this.f + 2, gz = z * this.f + 2;
    gx = gx < 0 ? 0 : gx > this.nx - 1.001 ? this.nx - 1.001 : gx;
    gz = gz < 0 ? 0 : gz > this.nz - 1.001 ? this.nz - 1.001 : gz;
    const xi = gx | 0, zi = gz | 0;
    let tx = gx - xi, tz = gz - zi;
    tx = tx * tx * (3 - 2 * tx);
    tz = tz * tz * (3 - 2 * tz);
    const k = zi * this.nx + xi, v = this.v, n = this.nx;
    const a = v[k] + (v[k + 1] - v[k]) * tx;
    const b = v[k + n] + (v[k + n + 1] - v[k + n]) * tx;
    return a + (b - a) * tz;
  }
}

/** Tileable smooth value noise field (S x S) on a freq x freq lattice; cached. */
const fieldCache = new Map<string, Float32Array>();
function tileField(S: number, freq: number, seed: number) {
  const key = S + ':' + freq + ':' + seed;
  let f = fieldCache.get(key);
  if (f) return f;
  const r = rng(seed * 104729 + freq * 31);
  const lat = new Float32Array(freq * freq);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  f = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const fy = (y / S) * freq, yi = Math.floor(fy);
    let ty = fy - yi;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (yi % freq) * freq, y1 = ((yi + 1) % freq) * freq;
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * freq, xi = Math.floor(fx);
      let tx = fx - xi;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = xi % freq, x1 = (xi + 1) % freq;
      const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
      const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
      f[y * S + x] = a + (b - a) * ty;
    }
  }
  fieldCache.set(key, f);
  return f;
}
function tileNoise(x: number, y: number, S: number, freq: number, seed: number) {
  return tileField(S, freq, seed)[(Math.floor(y) % S) * S + (Math.floor(x) % S)];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalise a float channel to roughly [0,1] with mean ~0.5 (robust to outliers). */
function normalise(a: Float32Array) {
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - mean) * (a[i] - mean);
  const sd = Math.sqrt(v / a.length) || 1;
  for (let i = 0; i < a.length; i++) a[i] = clamp(0.5 + ((a[i] - mean) / sd) * 0.2, 0, 1);
}

/**
 * Packed 256px tiling detail: R = grass blades (snow crust in winter), G = gravel, B = sand ripples,
 * A = rock grain / cracks. Sampled at world XZ * 0.5 for albedo detail and as the bump source.
 */
const detailCache = new Map<Theater, THREE.DataTexture>();
function makeDetailTexture(theater: Theater) {
  const cached = detailCache.get(theater);
  if (cached) return cached;
  const S = 256, N = S * S;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), A = new Float32Array(N);
  const rnd = rng(1337);
  const wrap = (v: number) => ((v % S) + S) % S;
  // R: grass or snow
  if (theater === 'winter') {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const wind = Math.sin(((y + tileNoise(x, y, S, 4, 91) * 40) / S) * Math.PI * 2 * 9) * 0.08;
        R[i] = tileNoise(x, y, S, 8, 11) * 0.5 + tileNoise(x, y, S, 32, 12) * 0.3 + tileNoise(x, y, S, 64, 13) * 0.15 + wind;
      }
    normalise(R);
    for (let k = 0; k < N * 0.012; k++) R[Math.floor(rnd() * N)] = 1; // sparkle
  } else {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) R[y * S + x] = 0.22 + tileNoise(x, y, S, 8, 21) * 0.25 + tileNoise(x, y, S, 32, 22) * 0.12;
    const blades = theater === 'desert' ? 1400 : 3400;
    for (let k = 0; k < blades; k++) {
      const x0 = rnd() * S, y0 = rnd() * S;
      const clump = tileNoise(wrap(x0), wrap(y0), S, 8, 23);
      if (rnd() > 0.35 + clump * 0.9) continue;
      const ang = rnd() * Math.PI * 2, len = 3 + rnd() * 6;
      const br = 0.45 + rnd() * 0.55;
      const steps = Math.ceil(len * 1.5);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = Math.floor(wrap(x0 + Math.cos(ang) * len * t)), py = Math.floor(wrap(y0 + Math.sin(ang) * len * t));
        const i = py * S + px;
        R[i] = Math.max(R[i], br * (0.55 + t * 0.45));
      }
    }
    normalise(R);
  }
  // G: gravel / pebbles lit from the upper left
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) G[y * S + x] = 0.42 + tileNoise(x, y, S, 64, 31) * 0.14 + tileNoise(x, y, S, 16, 32) * 0.1;
  for (let k = 0; k < 900; k++) {
    const cx = rnd() * S, cy = rnd() * S, r = 0.9 + rnd() * rnd() * 3.4, br = 0.45 + rnd() * 0.55;
    const R0 = Math.ceil(r + 2);
    for (let dy = -R0; dy <= R0; dy++)
      for (let dx = -R0; dx <= R0; dx++) {
        const dd = Math.hypot(dx, dy * 1.2);
        const i = wrap(Math.floor(cy + dy)) * S + wrap(Math.floor(cx + dx));
        if (dd <= r) G[i] = br * (0.78 + 0.32 * (-(dx + dy) / (r * 1.5)));
        else if (dd <= r + 1.6 && dx + dy > 0) G[i] *= 0.62;
      }
  }
  normalise(G);
  // B: sand ripples (asymmetric, warped) with fine grain
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const warp = tileNoise(x, y, S, 4, 41) * 1.6 + tileNoise(x, y, S, 8, 42) * 0.5;
      const ph = (y / S) * 18 + (x / S) * 2 + warp;
      const f = ph - Math.floor(ph);
      const ripple = f < 0.7 ? f / 0.7 : (1 - f) / 0.3;
      B[y * S + x] = ripple * 0.3 * (0.4 + tileNoise(x, y, S, 4, 45)) + tileNoise(x, y, S, 128, 43) * 0.3 + tileNoise(x, y, S, 32, 44) * 0.22;
    }
  normalise(B);
  // A: rock grain + cracks
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = tileNoise(x, y, S, 8, 51) * 0.45 + tileNoise(x, y, S, 16, 52) * 0.25 + tileNoise(x, y, S, 32, 53) * 0.18 + tileNoise(x, y, S, 64, 54) * 0.12;
      const cr = Math.abs(tileNoise(x, y, S, 6, 55) - 0.5) + Math.abs(tileNoise(x, y, S, 12, 56) - 0.5) * 0.5;
      A[y * S + x] = n - (cr < 0.035 ? 0.25 : 0);
    }
  normalise(A);
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4] = R[i] * 255;
    data[i * 4 + 1] = G[i] * 255;
    data[i * 4 + 2] = B[i] * 255;
    data[i * 4 + 3] = A[i] * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.channel = 1;
  t.needsUpdate = true;
  detailCache.set(theater, t);
  return t;
}

/** Tiling water texture: RGB = normal (tangent space, y up in texture = +z world), A = height noise. */
let waterTex: THREE.DataTexture | null = null;
function makeWaterTexture() {
  if (waterTex) return waterTex;
  const S = 256;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      hgt[y * S + x] = tileNoise(x, y, S, 8, 7) * 0.5 + tileNoise(x, y, S, 16, 8) * 0.3 + tileNoise(x, y, S, 32, 9) * 0.2;
  const at = (x: number, y: number) => hgt[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const nx = -dx * 10, ny = -dy * 10, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (y * S + x) * 4;
      data[o] = ((nx / l) * 0.5 + 0.5) * 255;
      data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[o + 3] = clamp(hgt[y * S + x] * 255, 0, 255);
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  waterTex = t;
  return t;
}
