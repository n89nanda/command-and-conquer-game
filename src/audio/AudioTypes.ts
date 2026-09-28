import type { SoundId } from '../data/types';

export type MusicTrack = 'menu' | 'briefing' | 'battle1' | 'battle2' | 'battle3' | 'tension' | 'victory' | 'defeat';

export type VoiceKind =
  | 'announcer' // base AI (ARIA / SERAPH): "Construction complete", "Unit ready"...
  | 'infantry'
  | 'vehicle'
  | 'heavy'
  | 'pilot'
  | 'engineer'
  | 'zealot';

export interface PlayOpts {
  /** World position (tiles). If omitted the sound is non-positional (UI). */
  x?: number;
  z?: number;
  volume?: number; // 0..1 multiplier
  /** Pitch variation multiplier (1 = none). */
  rate?: number;
}

export interface AudioEngineApi {
  /** Must be called from a user gesture (click / keydown) to unlock the AudioContext. */
  unlock(): void;
  play(id: SoundId, opts?: PlayOpts): void;
  /** Camera focus point and zoom (height) — used for positional attenuation / panning. */
  setListener(x: number, z: number, viewRadius: number): void;
  playMusic(track: MusicTrack): void;
  stopMusic(fadeSeconds?: number): void;
  /** 0 = calm, 1 = heavy combat. Music adapts layers. */
  setIntensity(v: number): void;
  /** Announcer / unit speech. Lines are short English sentences. */
  speak(text: string, kind: VoiceKind, opts?: { faction?: 'aegis' | 'covenant'; priority?: number }): void;
  setVolumes(v: { master?: number; sfx?: number; music?: number; voice?: number }): void;
  getVolumes(): { master: number; sfx: number; music: number; voice: number };
}
