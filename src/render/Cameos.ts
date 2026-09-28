import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BUILDINGS } from '../data/buildings';
import { TEAM_COLORS } from '../data/factions';
import { UNITS } from '../data/units';
import { models } from '../bridge';

// Renders build-menu portraits ("cameos") of every unit & building from the 3D models.
const cache = new Map<string, string>();

export function cameo(id: string): string {
  return cache.get(id) ?? '';
}

export async function renderCameos(onProgress?: (p: number) => void) {
  const W = 176, H = 132;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2018, 1.2));
  const key = new THREE.DirectionalLight(0xfff2e0, 3);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 2.2);
  rim.position.set(4, 3, -5);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 100);
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W;
  bgCanvas.height = H;

  const ids = [...Object.keys(UNITS), ...Object.keys(BUILDINGS)];
  let i = 0;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  for (const id of ids) {
    const isUnit = !!UNITS[id];
    const faction = isUnit ? UNITS[id].faction : BUILDINGS[id].faction;
    const team = new THREE.Color(faction === 'covenant' ? TEAM_COLORS[1] : TEAM_COLORS[0]);
    let inst;
    try {
      inst = isUnit ? models.unit(id, team) : models.building(id, team);
    } catch {
      continue;
    }
    const root = inst.root;
    // frame the model
    root.rotation.y = isUnit ? -Math.PI * 0.8 : 0;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z, size.y * 1.2) * 0.5 + 0.05;
    const dist = r / Math.tan((cam.fov * Math.PI) / 360) * (isUnit ? 1.05 : 1.12);
    const dir = new THREE.Vector3(0.85, 0.75, 1).normalize();
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center.x, center.y - size.y * 0.08, center.z);
    scene.add(root);
    // background gradient via clear colour + overlay pass in 2D
    renderer.setClearColor(faction === 'covenant' ? 0x1c0c0c : 0x0c141c, 1);
    inst.update?.(0.016, { time: 1, moving: false, speed: 0, firing: 0, health: 1, powered: true, producing: false, harvesting: false, build: 1 });
    renderer.render(scene, cam);
    scene.remove(root);
    octx.clearRect(0, 0, W, H);
    // backdrop
    const g = octx.createRadialGradient(W * 0.5, H * 0.45, 5, W * 0.5, H * 0.5, W * 0.7);
    if (faction === 'covenant') {
      g.addColorStop(0, '#3a1616');
      g.addColorStop(1, '#0a0404');
    } else {
      g.addColorStop(0, '#1c3246');
      g.addColorStop(1, '#04080c');
    }
    octx.fillStyle = g;
    octx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = 'lighten';
    octx.drawImage(renderer.domElement, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    // subtle scanlines + frame
    octx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) octx.fillRect(0, y, W, 1);
    const vg = octx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    octx.fillStyle = vg;
    octx.fillRect(0, 0, W, H);
    cache.set(id, out.toDataURL('image/jpeg', 0.88));
    inst.dispose?.();
    i++;
    if (i % 6 === 0) {
      onProgress?.(i / ids.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
}
