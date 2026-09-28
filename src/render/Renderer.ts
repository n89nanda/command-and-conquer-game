import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { World } from '../game/World';
import type { Unit } from '../game/Unit';
import { CrystalLayer, DoodadLayer, type DoodadProvider } from './Doodads';
import { Effects } from './Effects';
import { EntityViews } from './EntityViews';
import { FogOfWar } from './FogOfWar';
import type { ModelInstance, ModelLibrary } from './models/ModelTypes';
import { TerrainView, paletteFor } from './Terrain';
import { tickShared } from '../bridge';

export interface GraphicsSettings {
  quality: 0 | 1 | 2; // low / medium / high
}

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.35 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; uniform vec3 uTint; varying vec2 vUv;
  void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - dot(d,d) * uStrength * 2.2;
  c.rgb *= v * uTint; c.rgb = mix(vec3(dot(c.rgb, vec3(0.299,0.587,0.114))), c.rgb, 1.08); gl_FragColor = c; }`,
};

export class CameraRig {
  targetX = 20;
  targetZ = 20;
  zoom = 19; // distance
  minZoom = 9;
  maxZoom = 42;
  pitch = (54 * Math.PI) / 180;
  yaw = 0;
  camera: THREE.PerspectiveCamera;
  mapW = 64;
  mapH = 64;
  private smoothZoom = 19;
  shakeT = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 400);
  }
  setMap(w: number, h: number) {
    this.mapW = w;
    this.mapH = h;
  }
  clamp() {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    // keep the view mostly inside the map (margin grows with zoom)
    const mx = Math.min(this.mapW / 2, 2 + this.zoom * 0.55 * this.camera.aspect * 0.55);
    const mzTop = Math.min(this.mapH / 2, 2 + this.zoom * 0.45);
    const mzBot = Math.min(this.mapH / 2, this.zoom * 0.2);
    this.targetX = Math.max(mx, Math.min(this.mapW - mx, this.targetX));
    this.targetZ = Math.max(mzTop, Math.min(this.mapH - mzBot, this.targetZ));
  }
  lookAt(x: number, z: number) {
    this.targetX = x;
    this.targetZ = z;
    this.clamp();
  }
  update(dt: number, shake: number, groundY: number) {
    this.clamp();
    this.smoothZoom += (this.zoom - this.smoothZoom) * Math.min(1, dt * 10);
    const d = this.smoothZoom;
    const y = Math.sin(this.pitch) * d;
    const back = Math.cos(this.pitch) * d;
    this.shakeT += dt * 40;
    const sx = shake > 0 ? Math.sin(this.shakeT * 1.3) * shake * 0.25 : 0;
    const sz = shake > 0 ? Math.cos(this.shakeT * 1.7) * shake * 0.25 : 0;
    this.camera.position.set(this.targetX + sx + Math.sin(this.yaw) * back, groundY + y, this.targetZ + sz + Math.cos(this.yaw) * back);
    this.camera.lookAt(this.targetX + sx, groundY, this.targetZ + sz);
  }
  /** Approximate visible radius in world units (for audio attenuation). */
  get viewRadius() {
    return this.smoothZoom * 0.75;
  }
}

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fx = new Effects();
  terrain: TerrainView | null = null;
  crystals: CrystalLayer | null = null;
  doodads: DoodadLayer | null = null;
  views: EntityViews | null = null;
  fow: FogOfWar | null = null;
  world: World | null = null;
  quality: 0 | 1 | 2 = 2;
  private projViews = new Map<number, number>();
  private worldGroup = new THREE.Group();
  private unsub: (() => void)[] = [];
  private vignette: ShaderPass | null = null;
  canvas: HTMLCanvasElement;
  private models: ModelLibrary;
  private doodadProvider: DoodadProvider;
  private extra: { husk?: (id: string) => ModelInstance; rubble?: (fp: [number, number]) => ModelInstance };
  private sharedT = 0;
  private nukeMissiles: { x: number; z: number; sx: number; sz: number; t: number; dur: number }[] = [];

  constructor(container: HTMLElement, models: ModelLibrary, doodads: DoodadProvider, extra: GameRenderer['extra'] = {}) {
    this.models = models;
    this.doodadProvider = doodads;
    this.extra = extra;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);
    this.rig = new CameraRig(container.clientWidth / container.clientHeight);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 120;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.worldGroup);
    this.scene.add(this.fx.group);
    this.setupComposer();
    this.resize();
  }

  private setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality >= 1 ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.38, 1.35);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: 0 | 1 | 2) {
    this.quality = q;
    this.renderer.setPixelRatio(q === 2 ? Math.min(window.devicePixelRatio, 2) : q === 1 ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.renderer.shadowMap.enabled = q >= 1;
    this.sun.shadow.mapSize.set(q === 2 ? 2048 : 1024, q === 2 ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    if (this.bloom) this.bloom.enabled = q >= 1;
    this.fx.quality = q;
    this.composer?.dispose();
    this.setupComposer();
    this.resize();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  resize() {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(w, h);
    this.bloom?.setSize(size.x / 2, size.y / 2);
    this.fx.setViewport(size.y, this.rig.camera.fov);
  }

  attachWorld(world: World) {
    this.detachWorld();
    this.world = world;
    const map = world.map;
    const pal = paletteFor(map.theater);
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = null;
    this.hemi.color.setHex(pal.sky);
    this.hemi.groundColor.setHex(0x3a3228);
    this.sun.color.setHex(pal.sun);
    this.sun.intensity = pal.sunI;
    this.hemi.intensity = pal.hemiI;
    this.renderer.toneMappingExposure = pal.exposure;
    // outdoor sky environment for reflections (instead of the studio room)
    this.scene.environment = makeSkyEnvironment(this.renderer, pal.sky, pal.fog, pal.sun);
    this.fow = new FogOfWar(map.w, map.h);
    this.terrain = new TerrainView(map);
    this.worldGroup.add(this.terrain.group);
    this.crystals = new CrystalLayer(map, this.doodadProvider);
    this.worldGroup.add(this.crystals.group);
    this.doodads = new DoodadLayer(map, this.doodadProvider);
    this.worldGroup.add(this.doodads.group);
    this.views = new EntityViews(world, this.models, this.fx, this.extra);
    this.worldGroup.add(this.views.group);
    this.rig.setMap(map.w, map.h);
    this.fx.visibility = (x, z) => (this.fow ? this.fow.valueAt(x, z) : 1);
    this.fx.onScorch = (x, z, r) => this.terrain?.scorch(x, z, r);
    this.fx.groundAt = (x, z) => map.heightAt(x, z);
    const human = world.human ?? null;
    this.views.localPlayer = human;
    this.fow.update(human ? world.fogs.get(human) ?? null : null, 1, true);
    // paint foundations under pre-placed buildings
    for (const b of world.buildings) if (!b.def.wall && !b.owner.isNeutral) this.terrain.paintFoundation(b.tx, b.tz, b.w, b.h, map.theater);
    this.hookEvents(world);
  }

  detachWorld() {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.views?.clear();
    this.worldGroup.clear();
    this.world = null;
    this.nukeMissiles = [];
  }

  private hookEvents(world: World) {
    const ev = world.events;
    const fx = this.fx;
    const tmp = new THREE.Vector3();
    this.unsub.push(
      ev.on('fire', (e) => {
        let fx0 = e.fx, fy0 = e.fy, fz0 = e.fz;
        if (this.views && this.views.muzzleWorld(e.shooter, e.muzzle, tmp)) {
          fx0 = tmp.x;
          fy0 = tmp.y;
          fz0 = tmp.z;
        }
        const dx = e.tx - fx0, dz = e.tz - fz0;
        const l = Math.hypot(dx, dz) || 1;
        fx.muzzle(fx0, fy0, fz0, dx / l, dz / l, e.weapon.projectile);
        fx.shot(e.weapon.projectile, fx0, fy0, fz0, e.tx, e.ty, e.tz, e.weapon.id);
        // store muzzle origin for projectile visuals
        this.lastMuzzle.set(e.shooter.id, [fx0, fy0, fz0]);
      }),
      ev.on('impact', (e) => fx.impact(e.x, e.y, e.z, e.kind, (e.weapon.splash ?? 0) >= 1, e.hitEntity)),
      ev.on('explosion', (e) => {
        if (e.sound !== 'buildingCollapse') fx.explosion(e.x, e.y, e.z, e.size);
      }),
      ev.on('unitDied', (e) => this.views?.entityDied(e.unit)),
      ev.on('buildingDied', (e) => {
        const b = e.building;
        if (b.hp <= 0) {
          const y = world.map.heightAt(b.x, b.z) + 0.5;
          if (b.def.wall) fx.explosion(b.x, y, b.z, 'medium');
          else fx.buildingCollapse(b.x, y, b.z, b.w, b.h);
        }
        this.views?.entityDied(b);
      }),
      ev.on('crushed', (e) => fx.crush(e.unit.x, world.map.heightAt(e.unit.x, e.unit.z), e.unit.z)),
      ev.on('buildingPlaced', (e) => {
        const b = e.building;
        if (!b.def.wall && !b.owner.isNeutral) this.terrain?.paintFoundation(b.tx, b.tz, b.w, b.h, world.map.theater);
      }),
      ev.on('superweaponLaunch', (e) => {
        const y = world.map.heightAt(e.x, e.z);
        if (e.id === 'ionStrike') fx.ionStrike(e.x, y, e.z);
        else {
          const silo = world.buildings.find((b) => b.owner === e.player && b.def.superweapon === 'riftMissile');
          const sx = silo?.x ?? e.x, sz = silo?.z ?? e.z;
          // missile body, exhaust trail and target marker are handled by Effects
          fx.riftMissile(sx, world.map.heightAt(sx, sz), sz, e.x, y, e.z, 5.5);
        }
      }),
      ev.on('superweaponImpact', (e) => {
        const y = world.map.heightAt(e.x, e.z);
        if (e.id === 'ionStrike') fx.ionImpact(e.x, y, e.z);
        else fx.nukeImpact(e.x, y, e.z);
      }),
    );
  }
  private lastMuzzle = new Map<number, [number, number, number]>();

  /** Screen → ground raycast. */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.rig.camera);
    if (this.terrain) {
      const hit = ray.intersectObject(this.terrain.mesh, false)[0];
      if (hit) return hit.point;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Project world → screen pixels (CSS). */
  project(x: number, y: number, z: number, out: { x: number; y: number; vis: boolean }) {
    const v = new THREE.Vector3(x, y, z).project(this.rig.camera);
    const el = this.canvas;
    out.x = (v.x * 0.5 + 0.5) * el.clientWidth;
    out.y = (-v.y * 0.5 + 0.5) * el.clientHeight;
    out.vis = v.z < 1 && v.z > -1;
    return out;
  }

  render(dt: number, alpha: number) {
    const w = this.world;
    const rig = this.rig;
    let gy = 0;
    if (w) gy = Math.max(-0.3, w.map.heightAt(rig.targetX, rig.targetZ)) * 0.5;
    rig.update(dt, this.fx.shake, gy);
    // sun follows camera focus
    const tx = rig.targetX, tz = rig.targetZ;
    this.sun.position.set(tx - 24, 26, tz - 15);
    this.sun.target.position.set(tx, 0, tz);
    const shadowR = Math.max(22, rig.zoom * 1.25);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - shadowR) > 1) {
      sc.left = -shadowR;
      sc.right = shadowR;
      sc.top = shadowR;
      sc.bottom = -shadowR;
      sc.updateProjectionMatrix();
    }
    if (w && this.views && this.fow) {
      const human = w.human ?? null;
      this.fow.update(human ? w.fogs.get(human) ?? null : null, dt);
      this.views.update(dt, alpha);
      this.terrain?.update(dt);
      this.terrain?.flushScorch(dt);
      this.crystals?.update(dt);
      // projectile trails
      for (const p of w.projectiles) {
        if (p.kind === 'flame') continue;
        const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, z = p.pz + (p.z - p.pz) * alpha;
        const last = this.projViews.get(p.id);
        void last;
        this.fx.projectileTrail(p.kind, x, y, z, p.px, p.py, p.pz);
      }
      // nuke missile visuals
      for (const n of this.nukeMissiles) {
        n.t += dt;
        const t = n.t / n.dur;
        let x: number, y: number, z: number;
        if (t < 0.4) {
          const k = t / 0.4;
          x = n.sx;
          z = n.sz;
          y = k * k * 40;
        } else {
          const k = (t - 0.4) / 0.6;
          x = n.x + (n.sx - n.x) * (1 - k) * 0.1;
          z = n.z;
          y = 40 * (1 - k * k);
        }
        this.fx.missileTrail(x, y, z);
      }
      this.nukeMissiles = this.nukeMissiles.filter((n) => n.t < n.dur);
    }
    this.sharedT += dt;
    tickShared(this.sharedT);
    this.fx.update(dt, rig.camera);
    if (this.composer && this.quality >= 1) this.composer.render(dt);
    else this.renderer.render(this.scene, rig.camera);
  }

  /** Unit under cursor for hover highlighting — uses screen distance. */
  static unitRadius(u: Unit) {
    return u.radius;
  }
}

const skyEnvCache = new Map<string, THREE.Texture>();
/** Procedural sky-gradient environment map with a sun disc. */
function makeSkyEnvironment(renderer: THREE.WebGLRenderer, zenith: number, horizon: number, sun: number): THREE.Texture {
  const key = [zenith, horizon, sun].join(',');
  const cached = skyEnvCache.get(key);
  if (cached) return cached;
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uZen: { value: new THREE.Color(zenith).multiplyScalar(0.9) }, uHor: { value: new THREE.Color(horizon) }, uGround: { value: new THREE.Color(0x2a2620) }, uSun: { value: new THREE.Color(sun) }, uSunDir: { value: new THREE.Vector3(-0.6, 0.65, -0.4).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uZen, uHor, uGround, uSun, uSunDir; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHor, uZen, pow(h, 0.6)) : mix(uHor, uGround, pow(-h, 0.4));
      float s = max(dot(normalize(vDir), uSunDir), 0.0); c += uSun * (pow(s, 400.0) * 6.0 + pow(s, 12.0) * 0.25);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  skyEnvCache.set(key, tex);
  return tex;
}
