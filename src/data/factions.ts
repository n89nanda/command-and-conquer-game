import type { FactionId } from './types';

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  motto: string;
  color: number; // default team color
  uiAccent: string;
  yard: string;
  mcv: string;
  harvester: string;
  engineer: string;
  /** name of the base AI / announcer voice */
  announcer: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  aegis: {
    id: 'aegis',
    name: 'Aegis Coalition',
    short: 'AEGIS',
    motto: 'Order through strength.',
    color: 0x2f7fff,
    uiAccent: '#e8b64c',
    yard: 'a_yard',
    mcv: 'a_mcv',
    harvester: 'a_harvester',
    engineer: 'a_engineer',
    announcer: 'ARIA',
  },
  covenant: {
    id: 'covenant',
    name: 'Rift Covenant',
    short: 'COVENANT',
    motto: 'The Rift reveals all.',
    color: 0xe0282e,
    uiAccent: '#ff4a3d',
    yard: 'c_yard',
    mcv: 'c_mcv',
    harvester: 'c_harvester',
    engineer: 'c_engineer',
    announcer: 'SERAPH',
  },
};

/** Team colours available for players (index = player colour slot). */
export const TEAM_COLORS = [0x2f7fff, 0xe0282e, 0x2fd06a, 0xf2b01e, 0xb04cff, 0x1ed6d6, 0xff7a1e, 0xdddddd];
