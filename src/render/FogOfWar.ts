import * as THREE from 'three';
import type { Fog } from '../game/Fog';
import { addWorldMaterialHook } from './materials';

/**
 * Shared fog-of-war texture + shader injection into every world material.
 * R channel: 0 = shroud (never seen), ~0.5 = fogged (explored), 1 = visible.
 */
const sharedUniforms = {
  uFowTex: { value: null as THREE.Texture | null },
  uFowSize: { value: new THREE.Vector2(1, 1) },
  uFowEnabled: { value: 0 },
  uTime: { value: 0 },
  /** shroud tint (linear working space; hex is sRGB) */
  uShroudCol: { value: new THREE.Color(0x05080c) },
};
let hookInstalled = false;
export function setFowEnabled(on: boolean) {
  sharedUniforms.uFowEnabled.value = on ? 1 : 0;
}

export class FogOfWar {
  tex: THREE.DataTexture;
  data: Uint8Array;
  w: number;
  h: number;
  private cur: Float32Array;
  private lastVersion = -1;
  enabled = true;
  uniforms = sharedUniforms;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    // pad by 1 texel border so edges fade out
    this.data = new Uint8Array(w * h * 4);
    this.cur = new Float32Array(w * h);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    this.uniforms.uFowTex.value = this.tex;
    this.uniforms.uFowSize.value.set(w, h);
    this.uniforms.uFowEnabled.value = 1;
    if (!hookInstalled) {
      hookInstalled = true;
      addWorldMaterialHook((m) => injectFow(m, sharedUniforms));
    }
  }

  /** Smoothly animate toward the fog state. */
  update(fog: Fog | null, dt: number, force = false) {
    const { w, h } = this;
    const n = w * h;
    const k = force ? 1 : Math.min(1, dt * 6);
    this.uniforms.uTime.value += dt;
    let changed = false;
    for (let i = 0; i < n; i++) {
      let target = 1;
      if (fog && this.enabled) target = fog.visible[i] ? 1 : fog.explored[i] ? 0.5 : 0;
      // permanent black border so the map edge reads as shroud
      const x = i % w, z = (i - x) / w;
      const edge = Math.min(x, z, w - 1 - x, h - 1 - z);
      if (edge < 1) target = 0;
      else if (edge < 2) target = Math.min(target, 0.35);
      const c = this.cur[i];
      if (c !== target) {
        let v = c + (target - c) * k;
        if (Math.abs(v - target) < 0.01) v = target;
        this.cur[i] = v;
        const b = Math.round(v * 255);
        const j = i * 4;
        this.data[j] = b;
        this.data[j + 1] = b;
        this.data[j + 2] = b;
        this.data[j + 3] = 255;
        changed = true;
      }
    }
    if (changed || force) this.tex.needsUpdate = true;
    void this.lastVersion;
  }

  valueAt(x: number, z: number) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) return 0;
    return this.cur[tz * this.w + tx];
  }
}

function injectFow(m: THREE.Material, u: FogOfWar['uniforms']) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uFowTex = u.uFowTex;
    shader.uniforms.uFowSize = u.uFowSize;
    shader.uniforms.uFowEnabled = u.uFowEnabled;
    shader.uniforms.uFowTime = u.uTime;
    shader.uniforms.uShroudCol = u.uShroudCol;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFowWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 fw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fw = instanceMatrix * fw;
          #endif
          vFowWorld = (modelMatrix * fw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFowWorld;
        uniform sampler2D uFowTex;
        uniform vec2 uFowSize;
        uniform float uFowEnabled;
        uniform float uFowTime;
        uniform vec3 uShroudCol;
        float fowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fowNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fowHash(i), fowHash(i + vec2(1.0, 0.0)), f.x), mix(fowHash(i + vec2(0.0, 1.0)), fowHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uFowEnabled > 0.5) {
          vec2 fuv = vFowWorld.xz / uFowSize;
          float fv = texture2D(uFowTex, fuv).r;
          if (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) fv = 0.0;
          // slowly drifting, noisy edges on the shroud->fog and fog->visible transitions only
          // (solid shroud, the black map border and fully visible ground are untouched)
          float fn = fowNoise(vFowWorld.xz * 0.9 + vec2(uFowTime * 0.11, uFowTime * 0.07)) * 0.65
                   + fowNoise(vFowWorld.xz * 2.3 - vec2(uFowTime * 0.05, uFowTime * 0.13)) * 0.35;
          fv = clamp(fv + (fn - 0.5) * 0.34 * abs(sin(fv * 6.2831853)), 0.0, 1.0);
          float lit = smoothstep(0.0, 0.5, fv) * 0.42 + smoothstep(0.5, 1.0, fv) * 0.58;
          vec3 fogged = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(0.8, 0.85, 1.0), 0.5 * (1.0 - smoothstep(0.5, 1.0, fv)));
          vec3 shroud = uShroudCol * (0.8 + 0.4 * fn);
          #ifdef TONE_MAPPING
            shroud = pow(shroud, vec3(0.4545)); // rendering straight to screen: output is display-referred
          #endif
          gl_FragColor.rgb = fogged * lit + shroud * (1.0 - smoothstep(0.0, 0.5, fv));
        }`,
      );
  };
  m.needsUpdate = true;
}
