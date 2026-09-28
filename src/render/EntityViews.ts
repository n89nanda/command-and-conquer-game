import * as THREE from 'three';
import type { Building } from '../game/Building';
import type { Entity } from '../game/Entity';
import type { Player } from '../game/Player';
import type { Unit } from '../game/Unit';
import type { World } from '../game/World';
import type { Effects } from './Effects';
import { registerWorldMaterial } from './materials';
import { setOpacity } from '../bridge';
import type { ModelAnimState, ModelInstance, ModelLibrary } from './models/ModelTypes';

export interface View {
  e: Entity;
  model: ModelInstance;
  ring: THREE.Mesh | null;
  lastHp: number;
  flash: number;
  smokeT: number;
  anim: ModelAnimState;
  visible: boolean;
  stealthApplied: boolean;
  owner: Player;
}

interface Husk {
  model: ModelInstance;
  t: number;
  life: number;
  y0: number;
  fall?: boolean;
}

const tmpV = new THREE.Vector3();

export class EntityViews {
  group = new THREE.Group();
  views = new Map<number, View>();
  private husks: Husk[] = [];
  private models: ModelLibrary;
  private extra: { husk?: (id: string) => ModelInstance; rubble?: (fp: [number, number]) => ModelInstance };
  private world: World;
  private fx: Effects;
  private ringGeo: THREE.RingGeometry;
  private ringMats: Record<string, THREE.MeshBasicMaterial>;
  private teamColors = new Map<Player, THREE.Color>();
  localPlayer: Player | null = null;
  time = 0;

  constructor(world: World, models: ModelLibrary, fx: Effects, extra: EntityViews['extra'] = {}) {
    this.world = world;
    this.models = models;
    this.fx = fx;
    this.extra = extra;
    this.ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    const mk = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ringMats = { own: mk(0x4dff6a), enemy: mk(0xff4040), neutral: mk(0xffd040) };
  }

  teamColor(p: Player) {
    let c = this.teamColors.get(p);
    if (!c) {
      c = new THREE.Color(p.color);
      this.teamColors.set(p, c);
    }
    return c;
  }

  private create(e: Entity): View {
    const team = this.teamColor(e.owner);
    let model: ModelInstance;
    try {
      model = e.kind === 'unit' ? this.models.unit(e.typeId, team) : this.models.building(e.typeId, team);
    } catch (err) {
      console.error('model error', e.typeId, err);
      model = { root: new THREE.Group(), muzzles: [new THREE.Vector3()], height: 0.5 };
    }
    model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        if (e.kind === 'building') o.receiveShadow = true;
      }
    });
    // infantry are drawn slightly larger than life for readability at RTS zoom
    if (e.kind === 'unit' && (e as Unit).def.category === 'infantry') model.root.scale.setScalar(1.2);
    this.group.add(model.root);
    const v: View = {
      e, model, ring: null, lastHp: e.hp, flash: 0, smokeT: Math.random(), visible: true, stealthApplied: false, owner: e.owner,
      anim: { time: 0, moving: false, speed: 0, firing: 0, health: 1, powered: true, producing: false, harvesting: false, build: 1 },
    };
    this.views.set(e.id, v);
    return v;
  }

  private destroy(v: View, died: boolean) {
    // fallen infantry: keep the model briefly and let it topple over
    if (died && v.e.kind === 'unit' && (v.e as Unit).def.category === 'infantry' && v.visible && v.model.root.visible) {
      if (v.ring) this.group.remove(v.ring);
      this.views.delete(v.e.id);
      const r = v.model.root;
      r.rotation.order = 'YXZ';
      this.husks.push({ model: v.model, t: 0, life: 5, y0: r.position.y, fall: true });
      return;
    }
    this.group.remove(v.model.root);
    v.model.dispose?.();
    if (v.ring) this.group.remove(v.ring);
    this.views.delete(v.e.id);
    if (!died) return;
    const e = v.e;
    // husk / rubble
    if (e.kind === 'unit') {
      const u = e as Unit;
      if (u.def.category === 'vehicle' && this.extra.husk && v.visible) {
        try {
          const h = this.extra.husk(u.typeId);
          h.root.position.copy(v.model.root.position);
          h.root.rotation.copy(v.model.root.rotation);
          this.group.add(h.root);
          this.husks.push({ model: h, t: 0, life: 25, y0: h.root.position.y });
        } catch {
          /* ignore */
        }
      }
    } else {
      const b = e as Building;
      if (this.extra.rubble && !b.def.wall && b.hp <= 0) {
        try {
          const r = this.extra.rubble([b.w, b.h]);
          r.root.position.copy(v.model.root.position);
          this.group.add(r.root);
          this.husks.push({ model: r, t: 0, life: 90, y0: r.root.position.y });
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Called when an entity dies (to spawn husks). */
  entityDied(e: Entity) {
    const v = this.views.get(e.id);
    if (v) this.destroy(v, true);
  }

  getView(e: Entity) {
    return this.views.get(e.id);
  }

  /** World-space muzzle position for an entity. */
  muzzleWorld(e: Entity, idx: number, out: THREE.Vector3): boolean {
    const v = this.views.get(e.id);
    if (!v || v.model.muzzles.length === 0) return false;
    const m = v.model.muzzles[idx % v.model.muzzles.length];
    const parent = v.model.turret ?? v.model.root;
    parent.updateWorldMatrix(true, false);
    out.copy(m).applyMatrix4(parent.matrixWorld);
    return true;
  }

  update(dt: number, alpha: number) {
    this.time += dt;
    const w = this.world;
    const me = this.localPlayer;
    const seen = new Set<number>();
    const map = w.map;

    const handle = (e: Entity) => {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) v = this.create(e);
      // owner change (capture) → rebuild model with new team colour
      if (v.owner !== e.owner) {
        this.destroy(v, false);
        v = this.create(e);
      }
      const visible = !me || w.visibleTo(e, me);
      v.visible = visible;
      v.model.root.visible = visible;
      if (!visible) {
        if (v.ring) v.ring.visible = false;
        return;
      }
      const root = v.model.root;
      const a = v.anim;
      a.time = this.time;
      a.health = e.hp / e.maxHp;
      a.firing = e.firing;
      if (e.kind === 'unit') {
        const u = e as Unit;
        const x = u.px + (u.x - u.px) * alpha;
        const z = u.pz + (u.z - u.pz) * alpha;
        let hd = u.pheading + angleLerp(u.pheading, u.heading) * alpha;
        const y = map.heightAt(x, z) + (u.def.flying ? u.alt : 0);
        root.position.set(x, y, z);
        // tilt to terrain for vehicles
        if (!u.def.flying && u.def.category === 'vehicle') {
          const dx = map.heightAt(x + Math.cos(hd) * 0.4, z + Math.sin(hd) * 0.4) - map.heightAt(x - Math.cos(hd) * 0.4, z - Math.sin(hd) * 0.4);
          const sx = -Math.sin(hd), sz = Math.cos(hd);
          const dz = map.heightAt(x + sx * 0.3, z + sz * 0.3) - map.heightAt(x - sx * 0.3, z - sz * 0.3);
          root.rotation.set(0, 0, 0);
          root.rotation.order = 'YXZ';
          root.rotation.y = -hd;
          root.rotation.z = Math.atan2(dx, 0.8);
          root.rotation.x = -Math.atan2(dz, 0.6);
        } else if (u.def.flying) {
          root.rotation.order = 'YXZ';
          root.rotation.y = -hd;
          root.rotation.z = -u.speedFactor * 0.18; // nose down when moving
          root.rotation.x = Math.sin(this.time * 1.3 + u.id) * 0.03;
          root.position.y += Math.sin(this.time * 2 + u.id) * 0.05;
        } else {
          root.rotation.set(0, -hd, 0);
        }
        if (v.model.turret) {
          const t = u.pturret + angleLerp(u.pturret, u.turret) * alpha;
          v.model.turret.rotation.y = -(t - hd);
        }
        a.moving = u.moving;
        a.speed = u.speedFactor;
        a.harvesting = u.harvState === 'harvesting' && u.order.type === 'harvest';
        a.producing = false;
        a.powered = true;
        a.build = 1;
        // stealth
        const cloaked = !!u.def.stealth && u.isCloaked();
        if (cloaked !== v.stealthApplied) {
          v.stealthApplied = cloaked;
          if (setOpacity) {
            setOpacity(root, cloaked ? 0.28 : 1);
            root.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = !cloaked) : 0));
          } else setStealth(root, cloaked);
        }
        // harvesting sparkle
        if (a.harvesting && Math.random() < dt * 6) this.fx.harvestSparkle(x + Math.cos(hd) * 0.5, y, z + Math.sin(hd) * 0.5, map.oreType[Math.floor(u.z) * map.w + Math.floor(u.x)] === 2);
        // damage smoke
        const hr = u.hp / u.maxHp;
        if (hr < 0.5 && u.def.category !== 'infantry') {
          v.smokeT -= dt;
          if (v.smokeT <= 0) {
            v.smokeT = hr < 0.25 ? 0.12 : 0.3;
            this.fx.damageSmoke(x, y + 0.4, z, hr < 0.25);
          }
        }
        // ring
        this.updateRing(v, u.selected, x, y - (u.def.flying ? u.alt : 0), z, u.radius * 1.35);
        if (v.ring && u.def.flying) v.ring.position.y = map.heightAt(x, z) + 0.05;
      } else {
        const b = e as Building;
        root.position.set(b.x, map.heightAt(b.x, b.z) - 0.02, b.z);
        root.rotation.set(0, 0, 0);
        if (v.model.turret) v.model.turret.rotation.y = -b.turret;
        a.moving = false;
        a.speed = 0;
        a.powered = b.powered && b.operational;
        a.producing = b.producing > 0;
        a.harvesting = false;
        const build = b.selling ? Math.max(0, b.sellTimer / 1.2) : b.constructing;
        a.build = build;
        // build-up animation is performed by the model itself (it rises out of the ground via anim.build)
        if (build < 1 && Math.random() < dt * 10) this.fx.construction(b.x, root.position.y, b.z, b.w, b.h);
        const hr = b.hp / b.maxHp;
        if (hr < 0.5 && build >= 1) {
          v.smokeT -= dt;
          if (v.smokeT <= 0) {
            v.smokeT = (hr < 0.25 ? 0.15 : 0.35) / Math.max(1, (b.w * b.h) / 4);
            this.fx.damageSmoke(b.x + (Math.random() - 0.5) * b.w * 0.7, root.position.y + v.model.height * 0.7, b.z + (Math.random() - 0.5) * b.h * 0.7, hr < 0.25);
          }
        }
        this.updateRing(v, false, 0, 0, 0, 0);
      }
      // hit flash
      if (e.hp < v.lastHp - 0.5) v.flash = 1;
      v.lastHp = e.hp;
      v.model.update?.(dt, a);
    };

    for (const u of w.units) handle(u);
    for (const b of w.buildings) handle(b);
    for (const [id, v] of this.views) if (!seen.has(id)) this.destroy(v, v.e.dead && v.e.hp <= 0);

    // husks fade and sink
    for (const h of this.husks) {
      h.t += dt;
      if (h.fall) {
        const k = Math.min(1, h.t / 0.45);
        h.model.root.rotation.z = (-Math.PI / 2) * k * k;
        h.model.root.position.y = h.y0 + 0.06 * k;
        if (h.t > h.life - 1.5) h.model.root.position.y = h.y0 - (h.t - (h.life - 1.5)) * 0.25;
        continue;
      }
      if (h.t > h.life - 4) h.model.root.position.y = h.y0 - (h.t - (h.life - 4)) * 0.15;
      if (h.t < 6 && Math.random() < dt * 4) {
        const p = h.model.root.position;
        this.fx.damageSmoke(p.x, p.y + 0.3, p.z, h.t < 2);
      }
    }
    const dead = this.husks.filter((h) => h.t >= h.life);
    for (const h of dead) {
      this.group.remove(h.model.root);
      h.model.dispose?.();
    }
    if (dead.length) this.husks = this.husks.filter((h) => h.t < h.life);
  }

  private updateRing(v: View, show: boolean, x: number, y: number, z: number, r: number) {
    if (!show) {
      if (v.ring) v.ring.visible = false;
      return;
    }
    if (!v.ring) {
      v.ring = new THREE.Mesh(this.ringGeo, this.ringMats.own);
      v.ring.renderOrder = 5;
      this.group.add(v.ring);
    }
    const me = this.localPlayer;
    v.ring.material = !me || v.e.owner === me ? this.ringMats.own : v.e.owner.isNeutral ? this.ringMats.neutral : this.ringMats.enemy;
    v.ring.visible = true;
    v.ring.position.set(x, y + 0.04, z);
    v.ring.scale.setScalar(r);
  }

  /** Screen-space bounds helper: world top position for health bars. */
  topOf(e: Entity, out: THREE.Vector3) {
    const v = this.views.get(e.id);
    if (!v) return out.set(e.x, 1, e.z);
    return out.copy(v.model.root.position).setY(v.model.root.position.y + v.model.height * v.model.root.scale.y);
  }

  clear() {
    for (const v of [...this.views.values()]) this.destroy(v, false);
    for (const h of this.husks) this.group.remove(h.model.root);
    this.husks = [];
  }
}

function angleLerp(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const stealthCache = new WeakMap<THREE.Material, THREE.Material>();
function setStealth(root: THREE.Object3D, on: boolean) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const ud = m.userData as { origMat?: THREE.Material | THREE.Material[] };
    if (on) {
      if (!ud.origMat) ud.origMat = m.material;
      const conv = (mat: THREE.Material) => {
        let s = stealthCache.get(mat);
        if (!s) {
          s = mat.clone();
          registerWorldMaterial(s);
          s.transparent = true;
          s.opacity = 0.28;
          s.depthWrite = false;
          stealthCache.set(mat, s);
        }
        return s;
      };
      m.material = Array.isArray(ud.origMat) ? ud.origMat.map(conv) : conv(ud.origMat);
      m.castShadow = false;
    } else if (ud.origMat) {
      m.material = ud.origMat;
      m.castShadow = true;
    }
  });
  void tmpV;
}
