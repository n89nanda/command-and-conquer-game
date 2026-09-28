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
import { UNIT_LIST } from '../src/data/units';
import { BUILDING_LIST } from '../src/data/buildings';
import { models, doodadParts, husk, rubble, DOODAD_KINDS } from '../src/render/models';
import type { DoodadKind } from '../src/render/models';
import type { ModelInstance, ModelAnimState } from '../src/render/models/ModelTypes';

const q = new URLSearchParams(location.search);
const only = q.get('only');
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

const shadowR = Math.max(totalW, totalD) * 0.62 + 2;
sun.position.set(-shadowR * 0.6, shadowR * 1.4, shadowR * 0.45);
sun.shadow.camera.left = -shadowR;
sun.shadow.camera.right = shadowR;
sun.shadow.camera.top = shadowR;
sun.shadow.camera.bottom = -shadowR;
sun.shadow.camera.far = shadowR * 5;
sun.shadow.camera.updateProjectionMatrix();

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
  renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;
