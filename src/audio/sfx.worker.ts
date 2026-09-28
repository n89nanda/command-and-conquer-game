/** Renders SFX / drum samples off the main thread. */
import { renderSfx } from './sfx';
import { renderDrum, DrumName } from './drumkit';
import type { SoundId } from '../data/types';

interface Job {
  key: string;
  kind: 'sfx' | 'drum';
  id: string;
  variant: number;
  sr: number;
}

self.onmessage = (e: MessageEvent<Job[]>) => {
  for (const j of e.data) {
    try {
      const st = j.kind === 'sfx' ? renderSfx(j.id as SoundId, j.sr, j.variant) : renderDrum(j.id as DrumName, j.sr);
      const mono = st[0] === st[1];
      (self as unknown as Worker).postMessage({ key: j.key, L: st[0], R: mono ? undefined : st[1] }, mono ? [st[0].buffer] : [st[0].buffer, st[1].buffer]);
    } catch (err) {
      (self as unknown as Worker).postMessage({ key: j.key, error: String(err) });
    }
  }
};
