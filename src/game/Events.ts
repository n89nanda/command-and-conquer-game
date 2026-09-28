import type { SoundId, WeaponDef, ProjectileKind } from '../data/types';
import type { Entity } from './Entity';
import type { Unit } from './Unit';
import type { Building } from './Building';
import type { Player } from './Player';

export interface GameEvents {
  fire: { shooter: Entity; weapon: WeaponDef; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; muzzle: number };
  impact: { x: number; y: number; z: number; kind: ProjectileKind; weapon: WeaponDef; hitEntity: boolean };
  explosion: { x: number; y: number; z: number; size: 'small' | 'medium' | 'large' | 'huge' | 'infantry'; sound?: SoundId };
  unitDied: { unit: Unit; killer?: Entity };
  buildingDied: { building: Building; killer?: Entity };
  unitCreated: { unit: Unit };
  buildingPlaced: { building: Building };
  constructionReady: { player: Player; defId: string };
  unitReady: { player: Player; defId: string };
  damaged: { entity: Entity; attacker?: Entity; amount: number };
  captured: { building: Building; from: Player; to: Player };
  sold: { building: Building };
  crushed: { unit: Unit; by: Unit };
  promoted: { unit: Unit };
  superweaponReady: { player: Player; id: string };
  superweaponLaunch: { player: Player; id: string; x: number; z: number };
  superweaponImpact: { player: Player; id: string; x: number; z: number };
  announce: { player: Player | null; text: string; priority?: number; x?: number; z?: number };
  message: { text: string; color?: string };
  harvest: { unit: Unit };
  credits: { player: Player; amount: number; x: number; z: number };
  deployed: { unit: Unit; building: Building };
  ack: { unit: Unit; kind: 'select' | 'move' | 'attack' };
  unitAttacked: { unit: Unit; x: number; z: number };
  gameOver: { winner: Player | null; victory: boolean };
}

type Handler<T> = (e: T) => void;

export class EventBus {
  private handlers: Record<string, Handler<any>[]> = {};
  on<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>) {
    (this.handlers[k] ??= []).push(h);
    return () => this.off(k, h);
  }
  off<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>) {
    const arr = this.handlers[k];
    if (!arr) return;
    const i = arr.indexOf(h);
    if (i >= 0) arr.splice(i, 1);
  }
  emit<K extends keyof GameEvents>(k: K, e: GameEvents[K]) {
    const arr = this.handlers[k];
    if (!arr) return;
    for (const h of arr) h(e);
  }
  clear() {
    this.handlers = {};
  }
}
