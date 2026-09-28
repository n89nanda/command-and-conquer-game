/**
 * RIFTFALL procedural model library.
 *
 *   models.unit(id, teamColor) / models.building(id, teamColor)  -> ModelInstance
 *   doodadParts(kind, variant)                                   -> shared (geometry, material) parts for instancing
 *   husk(typeId)                                                 -> burnt-out vehicle wreck
 *   rubble(footprint)                                            -> destroyed building debris
 *
 * Geometry and materials are cached per (type, team colour) and shared by all
 * instances; never dispose them from outside.
 */
import * as THREE from 'three';
import type { ModelInstance, ModelLibrary } from './ModelTypes';
import { B, P, Template, finalizeTemplate, instantiate, hashStr, markTeam } from './kit';
export { setOpacity, ghost } from './kit';
import { INFANTRY } from './infantry';
import { AEGIS_UNITS } from './aegis';
import { COVENANT_UNITS } from './covenant';
import { AIRCRAFT } from './aircraft';
import { AEGIS_STRUCTURES } from './structures_aegis';
import { COVENANT_STRUCTURES } from './structures_covenant';
import { NEUTRAL_STRUCTURES } from './neutral';
import { makeHusk, makeRubble } from './wrecks';

export type { DoodadKind, DoodadPart } from './doodads';
export { doodadParts, DOODAD_KINDS } from './doodads';
export { tickShared } from './kit';

type Factory = (team: THREE.Color) => Template;

const UNIT_FACTORIES: Record<string, Factory> = { ...INFANTRY, ...AEGIS_UNITS, ...COVENANT_UNITS, ...AIRCRAFT };
const BUILDING_FACTORIES: Record<string, Factory> = { ...AEGIS_STRUCTURES, ...COVENANT_STRUCTURES, ...NEUTRAL_STRUCTURES };

const templates = new Map<string, Template>();

function fallbackUnit(team: THREE.Color): Template {
  const b = new B();
  b.cboxB('paint', P.aSteel, 0.6, 0.25, 0.45, 0.04, 0, 0, 0);
  b.cboxB('paint', team, 0.3, 0.1, 0.3, 0.03, 0, 0.25, 0);
  b.box('e:amber:blink', 0, 0.04, 0.04, 0.04, 0.2, 0.36, 0);
  const root = new THREE.Group();
  root.add(b.meshes());
  return finalizeTemplate(root, [new THREE.Vector3(0.3, 0.3, 0)]);
}

function fallbackBuilding(team: THREE.Color, fp: [number, number] = [2, 2]): Template {
  const [w, d] = fp;
  const b = new B({ aoHeight: 0.4 });
  b.cboxB('paint', P.aConcrete, w * 0.92, 0.12, d * 0.92, 0.03);
  b.cboxB('paint', P.aSteel, w * 0.7, 0.6, d * 0.7, 0.05, 0, 0.12, 0);
  b.boxB('paint', team, w * 0.72, 0.08, d * 0.72, 0, 0.5, 0);
  b.box('e:amber:blink', 0, 0.05, 0.05, 0.05, 0, 0.75, 0);
  const root = new THREE.Group();
  root.add(b.meshes());
  return finalizeTemplate(root, []);
}

function getTemplate(kind: 'u' | 'b', id: string, team: THREE.Color): Template {
  const key = `${kind}|${id}|${team.getHexString()}`;
  let t = templates.get(key);
  if (t) return t;
  const f = kind === 'u' ? UNIT_FACTORIES[id] : BUILDING_FACTORIES[id];
  markTeam(team);
  try {
    t = f ? f(team) : kind === 'u' ? fallbackUnit(team) : fallbackBuilding(team);
  } catch (err) {
    console.error(`[models] failed to build ${kind}:${id}`, err);
    t = kind === 'u' ? fallbackUnit(team) : fallbackBuilding(team);
  }
  if (kind === 'b') t = wrapBuilding(t);
  templates.set(key, t);
  return t;
}

/** Wrap building content so construction progress (s.build) can raise it out of the ground. */
function wrapBuilding(t: Template): Template {
  const content = new THREE.Group();
  content.name = 'content';
  for (const c of [...t.root.children]) content.add(c);
  t.root.add(content);
  const inner = t.anim;
  return {
    ...t,
    anim: (root) => {
      const upd = inner?.(root);
      const ct = root.getObjectByName('content');
      let last = 1;
      return (dt, s) => {
        const b = s.build ?? 1;
        if (ct && b !== last) {
          const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, b)), 2);
          ct.scale.y = 0.04 + 0.96 * e;
          last = b;
        }
        upd?.(dt, s);
      };
    },
  };
}

export const models: ModelLibrary = {
  unit(typeId: string, teamColor: THREE.Color): ModelInstance {
    return instantiate(getTemplate('u', typeId, teamColor));
  },
  building(typeId: string, teamColor: THREE.Color): ModelInstance {
    return instantiate(getTemplate('b', typeId, teamColor));
  },
};

const huskCache = new Map<string, Template>();
/** Burnt-out wreck for a destroyed vehicle (shares geometry with the live model). */
export function husk(typeId: string): ModelInstance {
  let t = huskCache.get(typeId);
  if (!t) {
    const live = getTemplate('u', typeId, new THREE.Color(0x555555));
    t = makeHusk(live, hashStr(typeId));
    huskCache.set(typeId, t);
  }
  return instantiate(t);
}

const rubbleCache = new Map<string, Template>();
/** Debris pile for a destroyed building of the given footprint. */
export function rubble(footprint: [number, number]): ModelInstance {
  const key = `${footprint[0]}x${footprint[1]}`;
  let t = rubbleCache.get(key);
  if (!t) {
    t = makeRubble(footprint);
    rubbleCache.set(key, t);
  }
  return instantiate(t);
}

/** Pre-build templates (e.g. during a loading screen) to avoid first-spawn hitches. */
export function warmup(unitIds: string[], buildingIds: string[], teams: THREE.Color[]): void {
  for (const c of teams) {
    for (const id of unitIds) getTemplate('u', id, c);
    for (const id of buildingIds) getTemplate('b', id, c);
  }
}
