// Optional-module bridge: lets the game run even if a subsystem module is absent.
import type { AudioEngineApi } from './audio/AudioTypes';
import type { ModelInstance, ModelLibrary } from './render/models/ModelTypes';
import type { DoodadProvider } from './render/Doodads';
import { fallbackDoodads } from './render/Doodads';
import { placeholderModels } from './render/PlaceholderModels';

const nullAudio: AudioEngineApi = {
  unlock() {},
  play() {},
  setListener() {},
  playMusic() {},
  stopMusic() {},
  setIntensity() {},
  speak() {},
  setVolumes() {},
  getVolumes: () => ({ master: 0.8, sfx: 0.8, music: 0.5, voice: 0.9 }),
};

const audioMods = import.meta.glob('./audio/Audio.ts', { eager: true }) as Record<string, { audio?: AudioEngineApi }>;
export const audio: AudioEngineApi = Object.values(audioMods)[0]?.audio ?? nullAudio;

interface ModelsModule {
  models?: ModelLibrary;
  doodadParts?: DoodadProvider;
  husk?: (id: string) => ModelInstance;
  rubble?: (fp: [number, number]) => ModelInstance;
  tickShared?: (time: number) => void;
  setOpacity?: (root: import('three').Object3D, opacity: number) => void;
}
const modelMods = import.meta.glob('./render/models/index.ts', { eager: true }) as Record<string, ModelsModule>;
const mm: ModelsModule = Object.values(modelMods)[0] ?? {};
export const models: ModelLibrary = mm.models ?? placeholderModels;
export const doodadParts: DoodadProvider = (mm.doodadParts as DoodadProvider | undefined) ?? fallbackDoodads;
export const husk = mm.husk;
export const rubble = mm.rubble;
export const tickShared = mm.tickShared ?? (() => {});
export const setOpacity = mm.setOpacity;
