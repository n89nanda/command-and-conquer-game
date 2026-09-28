/** Infantry for both factions. ~0.45 tall, chunky readable proportions, facing +X (right = +Z). */
import * as THREE from 'three';
import { B, P, Col, V3, Template, finalizeTemplate, strut, byName, spike } from './kit';

type Helmet = 'helmet' | 'boonie' | 'hardhat' | 'hood' | 'mask' | 'crest' | 'goggles';
type Weapon = 'rifle' | 'rocket' | 'sniper' | 'none' | 'flame' | 'riftRifle' | 'riftRocket';
type Pack = 'pack' | 'radio' | 'tanks' | 'tools' | 'cloak' | 'riftTank' | 'none';

interface SoldierSpec {
  armor: Col;
  armorDk: Col;
  cloth: Col;
  boots: Col;
  trim: Col;
  helmet: Helmet;
  helmetCol: Col;
  weapon: Weapon;
  pack: Pack;
  visor?: string; // glow key
  swingArms?: boolean;
  bulk?: number; // torso scale
}

const HIP = 0.19;

function leg(s: SoldierSpec, team: THREE.Color): THREE.Group {
  const b = new B({ aoBase: HIP, aoHeight: 0.12, aoMin: 0.6, jitter: 0 });
  // thigh + shin as one chunky piece
  b.cbox('paint', s.cloth, 0.07, 0.11, 0.066, 0.015, 0, -0.05, 0);
  b.cbox('paint', s.cloth, 0.062, 0.09, 0.06, 0.014, 0.004, -0.13, 0);
  b.cbox('paint', s.armorDk, 0.035, 0.04, 0.05, 0.01, 0.034, -0.095, 0); // knee pad
  b.cbox('paint', s.boots, 0.098, 0.04, 0.068, 0.012, 0.014, -0.17, 0); // boot
  b.box('paint', team, 0.004, 0.02, 0.03, 0.037, -0.095, 0); // tiny knee flash
  const g = b.meshes();
  return g;
}

function weaponParts(b: B, s: SoldierSpec): V3 | null {
  const gm = P.gunmetal;
  switch (s.weapon) {
    case 'rifle':
      b.box('paint', gm, 0.17, 0.035, 0.026, 0.11, 0.085, 0.045);
      b.box('paint', 0x3b3a33, 0.07, 0.04, 0.024, 0.0, 0.075, 0.045); // stock
      b.box('paint', gm, 0.03, 0.05, 0.02, 0.11, 0.05, 0.045); // magazine
      b.cylX('paint', 0x1c1c1c, 0.008, 0.008, 0.07, 5, 0.225, 0.09, 0.045);
      return [0.265, HIP + 0.09, 0.045];
    case 'sniper':
      b.box('paint', 0x2a2d30, 0.22, 0.03, 0.024, 0.12, 0.085, 0.045);
      b.box('paint', 0x3b3a33, 0.08, 0.042, 0.022, -0.01, 0.075, 0.045);
      b.cylX('paint', 0x1c1c1c, 0.008, 0.008, 0.14, 5, 0.29, 0.09, 0.045);
      b.cylX('paint', 0x111111, 0.014, 0.014, 0.08, 6, 0.1, 0.118, 0.045); // scope
      b.box('e:blue', 0, 0.006, 0.02, 0.02, 0.143, 0.118, 0.045); // scope lens glint
      b.box('paint', P.aGold, 0.012, 0.012, 0.03, 0.2, 0.09, 0.045); // rail coil
      b.box('paint', P.aGold, 0.012, 0.012, 0.03, 0.25, 0.09, 0.045);
      return [0.365, HIP + 0.09, 0.045];
    case 'rocket':
      b.cylX('paint', 0x55583f, 0.032, 0.032, 0.3, 10, 0.03, 0.165, 0.075);
      b.cylX('paint', 0x2b2b26, 0.038, 0.034, 0.03, 10, 0.18, 0.165, 0.075);
      b.cylX('paint', 0x2b2b26, 0.036, 0.036, 0.03, 10, -0.12, 0.165, 0.075);
      b.box('paint', gm, 0.05, 0.03, 0.03, 0.02, 0.2, 0.075); // sight
      b.box('e:red', 0, 0.006, 0.012, 0.012, 0.047, 0.21, 0.075);
      b.box('paint', gm, 0.03, 0.05, 0.02, 0.07, 0.12, 0.075); // grip
      return [0.2, HIP + 0.165, 0.075];
    case 'riftRocket':
      b.cylX('paint', P.cGun, 0.03, 0.034, 0.3, 8, 0.03, 0.165, 0.075);
      b.cylX('paint', P.cRed, 0.036, 0.036, 0.025, 8, 0.17, 0.165, 0.075);
      b.cylX('e:teal', 0, 0.022, 0.022, 0.02, 8, 0.19, 0.165, 0.075); // rift-tipped warhead
      b.box('paint', P.cBlack, 0.06, 0.02, 0.05, -0.02, 0.19, 0.075);
      spike(b, 'paint', P.cRed, -0.11, 0.165, 0.075, 0.05, 0.02, 0, Math.PI / 2);
      return [0.21, HIP + 0.165, 0.075];
    case 'riftRifle':
      b.box('paint', P.cBlack, 0.18, 0.034, 0.026, 0.11, 0.085, 0.045);
      b.box('paint', P.cRed, 0.08, 0.012, 0.028, 0.12, 0.105, 0.045);
      b.box('paint', P.cGun, 0.03, 0.05, 0.02, 0.09, 0.05, 0.045);
      b.box('e:orange', 0, 0.03, 0.01, 0.03, 0.15, 0.07, 0.045);
      b.cylX('paint', 0x151515, 0.009, 0.007, 0.07, 5, 0.23, 0.088, 0.045);
      return [0.27, HIP + 0.088, 0.045];
    case 'flame':
      b.box('paint', P.cGun, 0.16, 0.04, 0.03, 0.1, 0.08, 0.045);
      b.cylX('paint', P.cBlack, 0.018, 0.024, 0.08, 8, 0.22, 0.085, 0.045);
      b.box('e:orange:flicker', 0, 0.012, 0.012, 0.012, 0.262, 0.085, 0.045); // pilot light
      strut(b, 'paint', 0x222222, [-0.07, 0.08, 0.03], [0.04, 0.06, 0.045], 0.014); // hose
      return [0.27, HIP + 0.085, 0.045];
    default:
      return null;
  }
}

function soldier(s: SoldierSpec, team: THREE.Color): Template {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const legGeo = leg(s, team);
  const legL = legGeo;
  legL.name = 'legL';
  legL.position.set(0, HIP, -0.042);
  const legR = legGeo.clone();
  legR.name = 'legR';
  legR.position.set(0, HIP, 0.042);
  body.add(legL, legR);

  const b = new B({ aoBase: HIP, aoHeight: 0.2, aoMin: 0.75, jitter: 0.02 });
  const k = s.bulk ?? 1;
  // pelvis + belt
  b.cbox('paint', s.cloth, 0.085, 0.05, 0.14, 0.015, 0, 0.005, 0);
  b.box('paint', 0x2e2a22, 0.09, 0.018, 0.145, 0, 0.03, 0);
  b.box('paint', 0x4a4536, 0.03, 0.03, 0.03, 0.04, 0.03, 0.05); // pouch
  b.box('paint', 0x4a4536, 0.03, 0.03, 0.03, 0.04, 0.03, -0.05);
  // torso (armour vest, wider at the shoulders)
  b.taper('paint', s.armor, 0.09 * k, 0.13 * k, 0.105 * k, 0.175 * k, 0.12, 0, 0.035, 0);
  b.box('paint', s.trim, 0.006, 0.018, 0.12 * k, 0.05 * k, 0.12, 0); // chest trim
  b.box('paint', s.armorDk, 0.03, 0.035, 0.035, 0.045 * k, 0.075, 0.04); // chest pouches
  b.box('paint', s.armorDk, 0.03, 0.035, 0.035, 0.045 * k, 0.075, -0.04);
  // team-colour shoulder pads (the most visible part from above)
  b.cbox('paint', team, 0.085, 0.045, 0.06, 0.016, 0, 0.145, 0.1 * k);
  b.cbox('paint', team, 0.085, 0.045, 0.06, 0.016, 0, 0.145, -0.1 * k);
  // neck + head
  b.cyl('paint', s.cloth, 0.02, 0.024, 0.03, 6, 0, 0.165, 0);
  const headY = 0.205;
  if (s.helmet !== 'mask' && s.helmet !== 'hood') b.sphere('paint', P.skin, 0.04, 0.008, headY, 0, 1, 1.05, 1, 10, 7);
  switch (s.helmet) {
    case 'helmet':
      b.dome('paint', s.helmetCol, 0.053, 0, headY + 0.004, 0, 0.9, 12, 4);
      b.cyl('paint', s.helmetCol, 0.056, 0.056, 0.012, 12, 0, headY, 0);
      b.box('paint', 0x222222, 0.02, 0.012, 0.05, 0.047, headY - 0.004, 0); // goggles strap / visor
      break;
    case 'boonie':
      b.dome('paint', s.helmetCol, 0.046, 0, headY + 0.01, 0, 0.8, 10, 4);
      b.cyl('paint', s.helmetCol, 0.07, 0.07, 0.008, 12, 0, headY + 0.008, 0);
      b.box('paint', 0x111111, 0.006, 0.012, 0.05, 0.046, headY - 0.006, 0);
      break;
    case 'hardhat':
      b.dome('paint', P.hazardY, 0.05, 0, headY + 0.008, 0, 0.9, 12, 4);
      b.cyl('paint', P.hazardY, 0.06, 0.06, 0.008, 12, 0.01, headY + 0.006, 0);
      b.box('e:amber', 0, 0.02, 0.014, 0.02, 0.012, headY + 0.05, 0); // lamp
      break;
    case 'goggles':
      b.dome('paint', s.helmetCol, 0.05, 0, headY + 0.004, 0, 0.95, 12, 4);
      b.box(s.visor ?? 'e:blue', 0, 0.012, 0.018, 0.07, 0.046, headY, 0);
      break;
    case 'hood': {
      b.sphere('paint', s.helmetCol, 0.05, -0.004, headY + 0.004, 0, 1, 1.1, 1, 10, 7);
      b.cone('paint', s.helmetCol, 0.04, 0.05, 6, -0.022, headY + 0.045, 0, 0, 0, 0.5);
      b.box('paint', 0x0b0b0c, 0.02, 0.04, 0.06, 0.035, headY - 0.005, 0);
      b.box(s.visor ?? 'e:orange', 0, 0.008, 0.012, 0.045, 0.046, headY, 0);
      break;
    }
    case 'mask': {
      b.sphere('paint', s.helmetCol, 0.048, 0, headY, 0, 1.05, 1.05, 1, 10, 7);
      b.hull('paint', s.armorDk, [
        [0.03, -0.03, -0.028], [0.03, -0.03, 0.028], [0.066, -0.01, 0], [0.04, 0.02, -0.03], [0.04, 0.02, 0.03],
      ], 0, headY, 0);
      b.box(s.visor ?? 'e:orange', 0, 0.01, 0.012, 0.06, 0.047, headY + 0.008, 0);
      spike(b, 'paint', s.trim, -0.01, headY + 0.03, 0, 0.05, 0.012, 0, 0.35);
      break;
    }
    case 'crest': {
      b.dome('paint', s.helmetCol, 0.052, 0, headY + 0.002, 0, 0.95, 12, 4);
      b.box(s.visor ?? 'e:orange', 0, 0.012, 0.012, 0.07, 0.046, headY - 0.002, 0);
      b.box('paint', s.trim, 0.09, 0.02, 0.012, -0.005, headY + 0.052, 0);
      break;
    }
  }
  // backpack
  switch (s.pack) {
    case 'pack':
      b.cbox('paint', 0x57553f, 0.055, 0.09, 0.11, 0.015, -0.08, 0.09, 0);
      b.cyl('paint', 0x4a4a36, 0.018, 0.018, 0.11, 6, -0.08, 0.145, 0, Math.PI / 2);
      break;
    case 'radio':
      b.cbox('paint', 0x4d5040, 0.06, 0.1, 0.1, 0.012, -0.08, 0.095, 0);
      b.cyl('paint', 0x111111, 0.003, 0.004, 0.2, 4, -0.09, 0.24, -0.035);
      b.box('paint', 0x3a8a3a, 0.01, 0.01, 0.01, -0.05, 0.12, 0.03);
      break;
    case 'tools':
      b.cbox('paint', 0x5a5a4e, 0.06, 0.085, 0.12, 0.012, -0.08, 0.09, 0);
      b.box('paint', P.hazardY, 0.062, 0.015, 0.122, -0.08, 0.12, 0);
      b.cyl('paint', P.steel, 0.006, 0.006, 0.12, 5, -0.1, 0.17, 0.04, 0.25);
      break;
    case 'tanks':
      b.cyl('paint', P.cGun, 0.03, 0.03, 0.13, 8, -0.085, 0.1, 0.035);
      b.cyl('paint', P.cGun, 0.03, 0.03, 0.13, 8, -0.085, 0.1, -0.035);
      b.cyl('e:orange:flicker', 0, 0.031, 0.031, 0.02, 8, -0.085, 0.1, 0.035);
      b.cyl('e:orange:flicker', 0, 0.031, 0.031, 0.02, 8, -0.085, 0.1, -0.035);
      b.dome('paint', P.cBlack, 0.03, -0.085, 0.165, 0.035, 0.6, 8, 3);
      b.dome('paint', P.cBlack, 0.03, -0.085, 0.165, -0.035, 0.6, 8, 3);
      break;
    case 'riftTank':
      b.cbox('paint', P.cBlack, 0.05, 0.1, 0.1, 0.02, -0.08, 0.1, 0);
      b.box('e:teal', 0, 0.02, 0.06, 0.06, -0.106, 0.1, 0);
      break;
    case 'cloak':
      b.taper('paint', s.helmetCol, 0.02, 0.16, 0.04, 0.2, 0.15, -0.065, 0.0, 0, 0.0);
      break;
  }
  // arms
  const armCol = s.armor;
  const shoulderY = 0.13;
  const muzzle = weaponParts(b, s);
  const armGroup = s.swingArms ? null : b;
  if (armGroup) {
    let rh: V3, lh: V3;
    if (s.weapon === 'rocket' || s.weapon === 'riftRocket') {
      rh = [0.07, 0.13, 0.08];
      lh = [0.1, 0.15, 0.03];
    } else if (s.weapon === 'none') {
      rh = [0.02, 0.0, 0.1];
      lh = [0.02, 0.0, -0.1];
    } else {
      rh = [0.07, 0.07, 0.05];
      lh = [0.15, 0.085, 0.025];
    }
    const re: V3 = [0.02, 0.06, 0.11];
    const le: V3 = [0.06, 0.07, -0.08];
    strut(b, 'paint', armCol, [0, shoulderY, 0.1], re, 0.042, 0.042, 0.01);
    strut(b, 'paint', s.cloth, re, rh, 0.036, 0.036, 0.01);
    strut(b, 'paint', armCol, [0, shoulderY, -0.1], le, 0.042, 0.042, 0.01);
    strut(b, 'paint', s.cloth, le, lh, 0.036, 0.036, 0.01);
    b.cbox('paint', 0x2a2620, 0.03, 0.03, 0.03, 0.008, rh[0], rh[1], rh[2]);
    b.cbox('paint', 0x2a2620, 0.03, 0.03, 0.03, 0.008, lh[0], lh[1], lh[2]);
  }
  const upper = b.meshes();
  upper.name = 'upper';
  upper.position.y = HIP;
  body.add(upper);

  if (s.swingArms) {
    for (const side of [1, -1]) {
      const ab = new B({ aoBase: HIP + shoulderY, aoHeight: 0.2, aoMin: 0.7, jitter: 0 });
      strut(ab, 'paint', armCol, [0, 0, 0], [0, -0.07, 0.01 * side], 0.042, 0.042, 0.01);
      strut(ab, 'paint', s.cloth, [0, -0.07, 0.01 * side], [0.02, -0.13, 0.01 * side], 0.036, 0.036, 0.01);
      ab.cbox('paint', 0x2a2620, 0.03, 0.03, 0.03, 0.008, 0.02, -0.14, 0.01 * side);
      if (side === 1) {
        // tool case / wrench in right hand
        ab.box('paint', P.hazardY, 0.07, 0.05, 0.025, 0.03, -0.18, 0.012);
        ab.box('paint', 0x222222, 0.03, 0.008, 0.026, 0.03, -0.15, 0.012);
      }
      const arm = ab.meshes();
      arm.name = side === 1 ? 'armR' : 'armL';
      arm.position.set(0, HIP + shoulderY, 0.105 * side);
      body.add(arm);
    }
  }

  const muzzles = muzzle ? [new THREE.Vector3(...muzzle)] : [];
  return finalizeTemplate(root, muzzles, infantryAnim);
}

function infantryAnim(root: THREE.Object3D) {
  const legL = byName(root, 'legL')!;
  const legR = byName(root, 'legR')!;
  const upper = byName(root, 'upper')!;
  const armL = byName(root, 'armL');
  const armR = byName(root, 'armR');
  let phase = Math.random() * 6;
  let amp = 0;
  return (dt: number, s: { moving: boolean; speed: number; firing: number }) => {
    const target = s.moving ? 1 : 0;
    amp += (target - amp) * Math.min(1, dt * 10);
    if (s.moving) phase += dt * (9 + 4 * s.speed);
    const sw = Math.sin(phase) * 0.62 * amp;
    legL.rotation.z = sw;
    legR.rotation.z = -sw;
    const bob = Math.abs(Math.cos(phase)) * 0.014 * amp;
    const f = s.firing;
    upper.position.y = HIP + bob;
    upper.position.x = -0.022 * f * f + 0.012 * amp;
    upper.rotation.z = 0.12 * f * f - 0.08 * amp; // lean forward when running, kick back on shot
    upper.rotation.y = Math.sin(phase) * 0.08 * amp;
    if (armL && armR) {
      armL.rotation.z = -sw * 0.9;
      armR.rotation.z = sw * 0.9;
      armL.position.y = armR.position.y = HIP + 0.13 + bob;
    }
  };
}

// ---------------------------------------------------------------------------
const aegisBase = { armor: P.aOlive, armorDk: 0x4d4f3a, cloth: 0x7a7458, boots: 0x2f2a22, trim: P.aGold, helmetCol: 0x5f6448 };
const covBase = { armor: P.cGun, armorDk: P.cBlack, cloth: 0x2a2626, boots: 0x141414, trim: P.cRed, helmetCol: P.cBlack };

export const INFANTRY: Record<string, (team: THREE.Color) => Template> = {
  rifleman: (t) => soldier({ ...aegisBase, helmet: 'helmet', weapon: 'rifle', pack: 'pack' }, t),
  rocketeer: (t) => soldier({ ...aegisBase, helmet: 'helmet', weapon: 'rocket', pack: 'radio', bulk: 1.05 }, t),
  a_engineer: (t) => soldier({ ...aegisBase, armor: 0x8a8d86, cloth: 0x6e7270, helmet: 'hardhat', weapon: 'none', pack: 'tools', swingArms: true }, t),
  marksman: (t) =>
    soldier({ ...aegisBase, armor: 0x3f4640, armorDk: 0x2b302b, cloth: 0x4a5048, helmetCol: 0x39403a, helmet: 'goggles', visor: 'e:blue', weapon: 'sniper', pack: 'cloak' }, t),
  acolyte: (t) => soldier({ ...covBase, helmet: 'hood', helmetCol: 0x2b1718, weapon: 'riftRifle', pack: 'none' }, t),
  zealot: (t) => soldier({ ...covBase, armor: 0x3a2d2a, helmet: 'mask', visor: 'e:orange:flicker', weapon: 'flame', pack: 'tanks', bulk: 1.08 }, t),
  seeker: (t) => soldier({ ...covBase, helmet: 'crest', weapon: 'riftRocket', pack: 'riftTank' }, t),
  c_engineer: (t) => soldier({ ...covBase, armor: 0x44464d, cloth: 0x2f3036, helmet: 'goggles', helmetCol: 0x2c2e33, visor: 'e:teal', weapon: 'none', pack: 'tools', swingArms: true }, t),
};
