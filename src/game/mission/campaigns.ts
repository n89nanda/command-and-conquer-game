// RIFTFALL campaigns: mission order for each faction (index 1..N).

import type { FactionId } from '../../data/types';
import type { MissionDef } from './MissionScript';
import { aegis01 } from './aegis/m01_first_light';
import { aegis02 } from './aegis/m02_foothold';
import { aegis03 } from './aegis/m03_hold_the_line';

export const CAMPAIGNS: Record<FactionId, MissionDef[]> = {
  aegis: [aegis01, aegis02, aegis03],
  covenant: [],
};
