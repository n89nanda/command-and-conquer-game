// RIFTFALL campaigns: mission order for each faction (index 1..N).

import type { FactionId } from '../../data/types';
import type { MissionDef } from './MissionScript';
import { aegis01 } from './aegis/m01_first_light';
import { aegis02 } from './aegis/m02_foothold';
import { aegis03 } from './aegis/m03_hold_the_line';
import { aegis04 } from './aegis/m04_silent_knife';
import { aegis05 } from './aegis/m05_iron_tide';
import { aegis06 } from './aegis/m06_starfall';
import { covenant01 } from './covenant/m01_blood_harvest';
import { covenant02 } from './covenant/m02_forge_of_faith';
import { covenant03 } from './covenant/m03_stolen_fire';
import { covenant04 } from './covenant/m04_crucible';
import { covenant05 } from './covenant/m05_rift_ascendant';

export const CAMPAIGNS: Record<FactionId, MissionDef[]> = {
  aegis: [aegis01, aegis02, aegis03, aegis04, aegis05, aegis06],
  covenant: [covenant01, covenant02, covenant03, covenant04, covenant05],
};
