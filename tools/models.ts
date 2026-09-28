/**
 * RIFTFALL model viewer: lays out every unit, building and doodad.
 *   ?only=units|buildings|doodads|husks   filter
 *   ?focus=<id>                            zoom on one id (unit, building or doodad kind)
 *   ?t=<seconds>                           freeze animation time
 *   ?env=0                                 disable environment lighting
 *   ?yaw=<deg>&pitch=<deg>&dist=<n>        camera overrides
 *   ?moving=0 / ?powered=0 / ?firing=1     animation state overrides
 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UNIT_LIST } from '../src/data/units';
import { BUILDING_LIST } from '../src/data/buildings';
import { models, doodadParts, husk, rubble, ghost, DOODAD_KINDS } from '../src/render/models';
import type { DoodadKind } from '../src/render/models';
import type { ModelInstance, ModelAnimState } from '../src/render/models/ModelTypes';

const q = new URLSearchParams(location.search);
const battle = q.get('scene') === 'battle';
const only = battle ? 'none' : q.get('only');
const focus = q.get('focus');
const freezeT = q.has('t') ? parseFloat(q.get('t')!) : null;

const TEAM_A = new THREE.Color(0x2f7fff);
const TEAM_B = new THREE.Color(0xe0282e);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(window.innerWidth, window.innerHeight);
labels.domElement.style.position = 'absolute';
labels.domElement.style.top = '0';
labels.domElement.style.pointerEvents = 'none';
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3036);
if (q.get('env') !== '0') {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
}

scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x4a4032, parseFloat(q.get('hemi') ?? '0.8')));
const sun = new THREE.DirectionalLight(0xfff0dc, parseFloat(q.get('sun') ?? '3.2'));
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------- layout
interface Item {
  id: string;
  label: string;
  sub: string;
  w: number;
  d: number;
  make: (team: THREE.Color) => THREE.Object3D;
  inst: ModelInstance[];
  kind: 'unit' | 'building' | 'doodad' | 'husk';
  fp?: [number, number];
}
const items: Item[] = [];
const instances: { inst: ModelInstance; kind: Item['kind']; id: string; phase: number }[] = [];

const ids = q.get('ids')?.split(',');
function addItem(it: Omit<Item, 'inst'>) {
  if (focus && it.id !== focus) return;
  if (ids && !ids.includes(it.id)) return;
  items.push({ ...it, inst: [] });
}

if (!only || only === 'units') {
  for (const u of UNIT_LIST) {
    addItem({
      id: u.id, label: u.name, sub: u.id, w: 3.4, d: 2.2, kind: 'unit',
      make: (team) => {
        const m = models.unit(u.id, team);
        instances.push({ inst: m, kind: 'unit', id: u.id, phase: Math.random() * 3 });
        return m.root;
      },
    });
  }
}
if (!only || only === 'buildings') {
  for (const b of BUILDING_LIST) {
    const [w, h] = b.footprint;
    addItem({
      id: b.id, label: b.name, sub: `${b.id} ${w}x${h}`, w: Math.max(3.6, w * 2 + 1.6), d: h + 1.4, kind: 'building', fp: [w, h],
      make: (team) => {
        const m = models.building(b.id, team);
        instances.push({ inst: m, kind: 'building', id: b.id, phase: Math.random() * 3 });
        return m.root;
      },
    });
  }
}
if (!only || only === 'doodads') {
  for (const k of DOODAD_KINDS) {
    addItem({
      id: k, label: k, sub: 'variants 0-3', w: 5.2, d: 1.8, kind: 'doodad',
      make: () => {
        const g = new THREE.Group();
        for (let v = 0; v < 4; v++) {
          const sub = new THREE.Group();
          for (const p of doodadParts(k as DoodadKind, v)) {
            const mesh = new THREE.Mesh(p.geometry, p.material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            sub.add(mesh);
          }
          sub.position.x = (v - 1.5) * 1.2;
          g.add(sub);
        }
        return g;
      },
    });
  }
}
if (only === 'husks') {
  for (const u of UNIT_LIST.filter((u) => u.category !== 'infantry')) {
    addItem({
      id: u.id, label: u.name + ' (husk)', sub: u.id, w: 1.8, d: 1.8, kind: 'husk',
      make: () => husk(u.id).root,
    });
  }
  for (const fp of [[1, 1], [2, 2], [3, 2], [3, 3]] as [number, number][]) {
    addItem({ id: `rubble${fp[0]}x${fp[1]}`, label: `rubble ${fp[0]}x${fp[1]}`, sub: '', w: fp[0] + 1, d: fp[1] + 1.2, kind: 'husk', make: () => rubble(fp).root });
  }
}


// ---------------------------------------------------------------- battle scene (hero shot)
function placeB(id: string, team: THREE.Color, tx: number, tz: number) {
  // tx,tz = top-left tile of footprint
  const def = BUILDING_LIST.find((b) => b.id === id)!;
  const [w, h] = def.footprint;
  const m = models.building(id, team);
  m.root.position.set(tx + w / 2, 0, tz + h / 2);
  scene.add(m.root);
  instances.push({ inst: m, kind: 'building', id, phase: Math.random() * 3 });
  return m;
}
function placeU(id: string, team: THREE.Color, x: number, z: number, heading: number, turret = 0) {
  const m = models.unit(id, team);
  m.root.position.set(x, 0, z);
  m.root.rotation.y = -heading;
  if (m.turret) m.turret.rotation.y = turret;
  scene.add(m.root);
  instances.push({ inst: m, kind: 'unit', id, phase: Math.random() * 3 });
  return m;
}
function placeD(kind: DoodadKind, v: number, x: number, z: number, rot = Math.random() * 6.28, s = 1) {
  const g = new THREE.Group();
  for (const p of doodadParts(kind, v)) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = !kind.startsWith('crystal');
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  g.scale.setScalar(s);
  scene.add(g);
}
function buildBattle() {
  const A = TEAM_A, C = TEAM_B;
  // Aegis base (west)
  placeB('a_yard', A, -14, -6);
  placeB('a_power', A, -10, -7);
  placeB('a_power', A, -10, -4);
  placeB('a_refinery', A, -14, -1);
  placeB('a_factory', A, -10, -1);
  placeB('a_barracks', A, -7, -7);
  placeB('a_radar', A, -7, -4);
  placeB('a_turret', A, -6, 0);
  placeB('a_tower', A, -6, 3);
  placeB('a_sam', A, -7, -1);
  for (let z = -8; z <= -3; z++) placeB('a_wall', A, -5, z);
  // Covenant base (east)
  placeB('c_yard', C, 11, -6);
  placeB('c_power', C, 9, -8);
  placeB('c_refinery', C, 11, -1);
  placeB('c_factory', C, 7, -3);
  placeB('c_barracks', C, 7, -8);
  placeB('c_obelisk', C, 5, -1);
  placeB('c_turret', C, 5, 2);
  placeB('c_temple', C, 11, 3);
  for (let z = -9; z <= -5; z++) placeB('c_wall', C, 5, z);
  placeB('n_derrick', C, -1, -9);
  placeB('n_bunker', C, 2, 5);
  // crystal field (centre-south)
  for (let i = 0; i < 26; i++) {
    const x = -3 + Math.random() * 6, z = 2 + Math.random() * 5;
    placeD(Math.random() < 0.15 ? 'crystalRich' : 'crystal', Math.floor(Math.random() * 4), Math.round(x) + 0.5, Math.round(z) + 0.5);
  }
  placeU('a_harvester', A, -2.5, 4.5, 0.4);
  placeU('c_harvester', C, 2.4, 3.2, Math.PI + 0.3);
  // clash in the middle
  const ag = ['guardian', 'guardian', 'titan', 'tempest', 'scout', 'guardian'];
  ag.forEach((id, i) => placeU(id, A, -3.2 - (i % 3) * 1.3, -4 + Math.floor(i / 3) * 1.6 + (i % 2) * 0.3, 0.1, 0.1));
  const cg = ['scorpion', 'scorpion', 'prism', 'inferno', 'shade', 'raider', 'raider'];
  cg.forEach((id, i) => placeU(id, C, 2.8 + (i % 3) * 1.2, -4.2 + Math.floor(i / 3) * 1.5 + (i % 2) * 0.3, Math.PI - 0.1, -0.1));
  const ai = ['rifleman', 'rifleman', 'rifleman', 'rocketeer', 'rocketeer', 'marksman', 'a_engineer'];
  ai.forEach((id, i) => placeU(id, A, -1.8 - (i % 4) * 0.35, -0.6 + Math.floor(i / 4) * 0.4, 0.15));
  const ci = ['acolyte', 'acolyte', 'acolyte', 'zealot', 'zealot', 'seeker', 'seeker', 'c_engineer'];
  ci.forEach((id, i) => placeU(id, C, 1.4 + (i % 4) * 0.35, -0.8 + Math.floor(i / 4) * 0.4, Math.PI));
  const hk = placeU('hawk', A, -1.5, -6.5, 0.3);
  hk.root.position.y = 1.6;
  const wr = placeU('wraith', C, 1.8, -7.2, Math.PI + 0.4);
  wr.root.position.y = 1.8;
  placeU('a_mcv', A, -8.2, 5.2, -0.3);
  placeU('c_mcv', C, 8, 7.5, Math.PI);
  const hu = husk('guardian'); hu.root.position.set(0.2, 0, -2.6); hu.root.rotation.y = 1.2; scene.add(hu.root);
  const hu2 = husk('scorpion'); hu2.root.position.set(-0.6, 0, -5.4); hu2.root.rotation.y = 2.2; scene.add(hu2.root);
  const rb = rubble([2, 2]); rb.root.position.set(4, 0, 8); scene.add(rb.root);
  // doodads around the edges
  for (let i = 0; i < 70; i++) {
    const x = -16 + Math.random() * 32, z = -12 + Math.random() * 24;
    if (z > -10 && z < 9 && x > -15 && x < 14) continue;
    const r = Math.random();
    placeD(r < 0.4 ? 'pine' : r < 0.6 ? 'tree' : r < 0.75 ? 'bush' : r < 0.88 ? 'rock' : 'boulder', Math.floor(Math.random() * 4), x, z);
  }
  for (let i = 0; i < 14; i++) placeD(Math.random() < 0.5 ? 'rock' : 'bush', Math.floor(Math.random() * 4), -4 + Math.random() * 8, -9 + Math.random() * 17);
  placeD('ruin', 1, 5.5, 6.2); placeD('barrel', 3, -4.2, 6.3); placeD('wreck', 1, 0.5, 8.4); placeD('deadTree', 1, -5.3, 7.4);
  for (let i = 0; i < 5; i++) placeD('fence', i % 2, 0.5 + i, 7.5, 0);
  placeD('lamp', 0, 4.5, 4.5);
}
if (battle) buildBattle();

// flow layout
const maxRowW = parseFloat(q.get('row') ?? '') || (focus ? 100 : only === 'buildings' ? 30 : only === 'doodads' ? 16 : 20);
let cx = 0, cz = 0, rowD = 0;
const placed: { it: Item; x: number; z: number }[] = [];
for (const it of items) {
  if (cx + it.w > maxRowW && cx > 0) {
    cx = 0;
    cz += rowD;
    rowD = 0;
  }
  placed.push({ it, x: cx + it.w / 2, z: cz + it.d / 2 });
  cx += it.w;
  rowD = Math.max(rowD, it.d);
}
const totalW = Math.max(...placed.map((p) => p.x + p.it.w / 2), 1);
const totalD = cz + rowD;

for (const p of placed) {
  const { it } = p;
  const ox = p.x - totalW / 2;
  const oz = p.z - totalD / 2;
  if (it.kind === 'building') {
    const [fw, fh] = it.fp!;
    for (const [i, team] of [TEAM_A, TEAM_B].entries()) {
      const o = it.make(team);
      const x = ox + (i === 0 ? -1 : 1) * (fw / 2 + 0.3);
      // snap to tile grid so footprint lines up with ground tiles
      o.position.set(snap(x, fw), 0, snap(oz - 0.2, fh));
      scene.add(o);
    }
  } else if (it.kind === 'unit') {
    for (const [i, team] of [TEAM_A, TEAM_B].entries()) {
      const o = it.make(team);
      o.position.set(ox + (i === 0 ? -0.85 : 0.85), 0, oz - 0.2);
      o.rotation.y = focus ? -0.5 : 0;
      scene.add(o);
    }
  } else {
    const o = it.make(TEAM_A);
    o.position.set(ox, 0, oz - 0.2);
    scene.add(o);
  }
  const div = document.createElement('div');
  div.className = 'lbl';
  div.innerHTML = `${it.label}<small>${it.sub}</small>`;
  const lbl = new CSS2DObject(div);
  lbl.position.set(ox, 0, oz + it.d / 2 - 0.35);
  scene.add(lbl);
}
function snap(v: number, size: number): number {
  const odd = Math.round(size) % 2 === 1;
  return odd ? Math.round(v - 0.5) + 0.5 : Math.round(v);
}

// ground with tile grid
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b6a4c';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${40 + Math.random() * 40},${40 + Math.random() * 30},${20},${0.08 + Math.random() * 0.1})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const size = 200;
  tex.repeat.set(size, size);
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ---------------------------------------------------------------- camera
const aspect = window.innerWidth / window.innerHeight;
const fov = parseFloat(q.get('fov') ?? (focus ? '30' : '22'));
const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 800);
const pitch = THREE.MathUtils.degToRad(parseFloat(q.get('pitch') ?? '55'));
const yaw = THREE.MathUtils.degToRad(parseFloat(q.get('yaw') ?? '0'));
const span = Math.max(totalW / aspect, totalD) ;
const dist = parseFloat(q.get('dist') ?? String((focus ? Math.max(3, (items[0]?.w ?? 3) * 1.25) : span * 1.55 + 2) * 34 / fov));
const target = new THREE.Vector3(0, focus ? 0.2 : 0, focus ? 0.1 : 0.4);
camera.position.set(
  target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
  target.y + Math.sin(pitch) * dist,
  target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
);
camera.lookAt(target);

if (battle) {
  const bd = parseFloat(q.get('dist') ?? '34');
  const bt = new THREE.Vector3(parseFloat(q.get('tx') ?? '0'), 0, parseFloat(q.get('tz') ?? '0'));
  camera.position.set(bt.x + Math.sin(yaw) * Math.cos(pitch) * bd, Math.sin(pitch) * bd, bt.z + Math.cos(yaw) * Math.cos(pitch) * bd);
  camera.lookAt(bt);
}
const shadowR = battle ? 22 : Math.max(totalW, totalD) * 0.62 + 2;
sun.position.set(-shadowR * 0.6, shadowR * 1.4, shadowR * 0.45);
sun.shadow.camera.left = -shadowR;
sun.shadow.camera.right = shadowR;
sun.shadow.camera.top = shadowR;
sun.shadow.camera.bottom = -shadowR;
sun.shadow.camera.far = shadowR * 5;
sun.shadow.camera.updateProjectionMatrix();

if (q.get('muzzles') === '1') {
  const g = new THREE.SphereGeometry(0.03, 8, 6);
  const m = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false });
  for (const e of instances) {
    const parent = e.inst.turret ?? e.inst.root;
    for (const v of e.inst.muzzles) {
      const s = new THREE.Mesh(g, m);
      s.position.copy(v);
      s.renderOrder = 10;
      parent.add(s);
    }
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false }));
    hb.position.y = e.inst.height;
    hb.renderOrder = 10;
    e.inst.root.add(hb);
  }
}
let tris = 0, meshes = 0;
scene.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh && m.geometry) {
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
});
document.getElementById('stats')!.textContent = `${items.length} items, ${meshes} meshes, ${Math.round(tris / 1000)}k tris`;

// ---------------------------------------------------------------- bloom (matches the game: threshold 1.35)
let composer: EffectComposer | null = null;
if (q.get('bloom') !== '0') {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.38, 0.38, 1.35));
  composer.addPass(new OutputPass());
}
// ?ghost=1 shows buildings as placement holograms (odd items invalid)
if (q.get('ghost') === '1') {
  let i = 0;
  for (const e of instances) if (e.kind === 'building') ghost(e.inst.root, i++ % 2 === 0);
}

// ---------------------------------------------------------------- animate
const t0 = performance.now();
let last = t0;
const s: ModelAnimState = { time: 0, moving: true, speed: 1, firing: 0, health: 1, powered: true, producing: false, harvesting: true, build: 1 };
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = freezeT ?? (now - t0) / 1000;
  for (const e of instances) {
    s.time = t;
    const lt = t + e.phase;
    s.moving = q.get('moving') !== '0';
    s.speed = 1;
    s.firing = q.get('firing') === '1' ? 1 : Math.max(0, 1 - (lt % 2.2) * 2.5);
    s.powered = q.get('powered') !== '0';
    s.producing = q.has('producing') ? q.get('producing') === '1' : (lt % 8) < 4;
    s.harvesting = true;
    if (freezeT !== null) {
      // advance animations to a deterministic pose
      e.inst.update?.(0.016, s);
    } else e.inst.update?.(dt, s);
    if (e.inst.turret && e.kind !== 'unit') e.inst.turret.rotation.y = Math.sin(t * 0.4 + e.phase) * 0.8;
  }
  if (composer) composer.render();
  else renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;

// ---------------------------------------------------------------- per-model stats (?stats=1 prints to console)
if (q.get('stats') === '1') {
  const count = (o: THREE.Object3D) => {
    let meshes = 0, tris = 0;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        meshes++;
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      }
    });
    return { meshes, tris: Math.round(tris) };
  };
  const rows: string[] = [];
  for (const u of UNIT_LIST) {
    const m = models.unit(u.id, TEAM_A);
    const c = count(m.root);
    rows.push(`unit ${u.id.padEnd(12)} meshes=${c.meshes} tris=${c.tris} h=${m.height.toFixed(2)} muzzles=${m.muzzles.length} turret=${!!m.turret}`);
  }
  for (const b of BUILDING_LIST) {
    const m = models.building(b.id, TEAM_A);
    const c = count(m.root);
    const box = new THREE.Box3().setFromObject(m.root);
    rows.push(`bld  ${b.id.padEnd(12)} meshes=${c.meshes} tris=${c.tris} h=${m.height.toFixed(2)} fp=${b.footprint.join('x')} ext=[${box.min.x.toFixed(2)},${box.max.x.toFixed(2)}]x[${box.min.z.toFixed(2)},${box.max.z.toFixed(2)}] turret=${!!m.turret}`);
  }
  for (const k of DOODAD_KINDS) for (let v = 0; v < 4; v++) {
    const parts = doodadParts(k as DoodadKind, v);
    const tris = parts.reduce((a, p) => a + p.geometry.attributes.position.count / 3, 0);
    rows.push(`dood ${k.padEnd(12)} v${v} parts=${parts.length} tris=${tris}`);
  }
  console.log(rows.join('\n'));
}
