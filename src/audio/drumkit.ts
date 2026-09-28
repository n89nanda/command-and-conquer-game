/**
 * Offline-rendered drum / percussion samples for the music engine (pure DSP, see dsp.ts).
 */
import {
  Rng, Stereo, alloc, tone, noise, filter, drive, gain, mix, reverb, fade, dcBlock, normalize, trimTail,
  expEnv, adEnv, drop, partials,
} from './dsp';

export const DRUMS = [
  'kick', 'kick2', 'snare', 'snare2', 'clap', 'hat', 'ohat', 'ride', 'crash', 'rcrash', 'tomH', 'tomM', 'tomL',
  'metal', 'rim', 'shaker', 'taiko', 'boom', 'timp', 'tick', 'heart',
] as const;
export type DrumName = (typeof DRUMS)[number];

/** Reference pitch of the 'timp' sample (Hz); play with rate = f / TIMP_HZ. */
export const TIMP_HZ = 73.42; // D2

/** Classic 808-style metallic source: six detuned squares. */
function metallic(sr: number, dur: number, base = 1): Float32Array {
  const fr = [205.3, 304.4, 369.6, 522.7, 540, 800];
  const out = alloc(sr, dur);
  for (const f of fr) mix(out, tone(sr, dur, 'square', f * base * 1.7), 1 / 6);
  return out;
}

export function renderDrum(name: DrumName, sr: number): Stereo {
  const r = new Rng(1234 + name.length * 77 + name.charCodeAt(0));
  let dry: Float32Array;
  let rv: { decay: number; wet: number; size?: number; damp?: number; tail?: number } | null = null;
  switch (name) {
    case 'kick': {
      dry = tone(sr, 0.5, 'sine', drop(165, 48, 0.035), adEnv(0.001, 0.2));
      const click = noise(sr, 0.01, r, 'white', expEnv(0.0015));
      filter(click, sr, 'highpass', 2500);
      mix(dry, click, 0.35, 0, sr);
      drive(dry, 1.8);
      break;
    }
    case 'kick2': {
      dry = tone(sr, 0.45, 'sine', drop(210, 44, 0.03), adEnv(0.001, 0.17));
      const body = noise(sr, 0.08, r, 'white', expEnv(0.012));
      filter(body, sr, 'lowpass', 1800);
      mix(dry, body, 0.4, 0, sr);
      drive(dry, 4);
      filter(dry, sr, 'lowpass', 7000);
      break;
    }
    case 'snare':
    case 'snare2': {
      const hard = name === 'snare2';
      dry = tone(sr, 0.4, 'tri', drop(hard ? 240 : 200, hard ? 190 : 170, 0.02), (t) => 0.8 * Math.exp(-t / (hard ? 0.05 : 0.07)));
      mix(dry, tone(sr, 0.4, 'sine', 330, expEnv(0.04)), 0.3, 0, sr);
      const n = noise(sr, 0.4, r, 'white', expEnv(hard ? 0.09 : 0.12));
      filter(n, sr, 'highpass', 1200);
      filter(n, sr, 'peaking', 4500, 0.8, 4);
      mix(dry, n, 0.9, 0, sr);
      drive(dry, hard ? 2.4 : 1.5);
      rv = { decay: 0.5, wet: 0.25, size: 0.5, tail: 0.3 };
      break;
    }
    case 'clap': {
      dry = alloc(sr, 0.35);
      for (const t of [0, 0.011, 0.023]) {
        const n = noise(sr, 0.02, r, 'white', expEnv(0.004));
        mix(dry, n, 0.8, t, sr);
      }
      mix(dry, noise(sr, 0.3, r, 'white', expEnv(0.07)), 0.6, 0.03, sr);
      filter(dry, sr, 'bandpass', 1200, 1.4);
      gain(dry, 2.5);
      rv = { decay: 0.6, wet: 0.35, size: 0.5, tail: 0.3 };
      break;
    }
    case 'hat':
    case 'ohat': {
      const len = name === 'hat' ? 0.07 : 0.45;
      dry = metallic(sr, len);
      mix(dry, noise(sr, len, r, 'white'), 0.5, 0, sr);
      filter(dry, sr, 'highpass', 7000);
      filter(dry, sr, 'peaking', 10000, 1, 3);
      gain(dry, name === 'hat' ? expEnv(0.018) : adEnv(0.002, 0.14), sr);
      break;
    }
    case 'ride': {
      dry = metallic(sr, 1.2, 1.3);
      mix(dry, partials(sr, 1.2, [3200, 4700, 6100], [0.5, 0.4, 0.3], [0.2, 0.15, 0.1]), 1, 0, sr);
      filter(dry, sr, 'highpass', 3000);
      gain(dry, adEnv(0.001, 0.35), sr);
      break;
    }
    case 'crash':
    case 'rcrash': {
      dry = metallic(sr, 2.6, 1.1);
      mix(dry, noise(sr, 2.6, r, 'white'), 0.9, 0, sr);
      filter(dry, sr, 'highpass', 3500);
      filter(dry, sr, 'lowpass', 13000);
      gain(dry, adEnv(0.002, 0.7), sr);
      rv = { decay: 1.5, wet: 0.3, size: 1, tail: 0.5 };
      break;
    }
    case 'tomH':
    case 'tomM':
    case 'tomL': {
      const f = name === 'tomH' ? 165 : name === 'tomM' ? 120 : 88;
      dry = tone(sr, 0.7, 'sine', drop(f * 1.6, f, 0.04), adEnv(0.001, 0.22));
      mix(dry, tone(sr, 0.7, 'tri', drop(f * 2.4, f * 1.5, 0.04), adEnv(0.001, 0.08)), 0.25, 0, sr);
      const n = noise(sr, 0.05, r, 'white', expEnv(0.01));
      filter(n, sr, 'lowpass', 3000);
      mix(dry, n, 0.3, 0, sr);
      drive(dry, 1.4);
      rv = { decay: 0.9, wet: 0.3, size: 0.8, tail: 0.5 };
      break;
    }
    case 'metal': {
      dry = partials(sr, 1.2, [523, 841, 1234, 1789, 2511, 3320], [0.4, 0.3, 0.25, 0.18, 0.12, 0.08], [0.5, 0.4, 0.35, 0.25, 0.2, 0.12], r);
      const n = noise(sr, 0.02, r, 'white', expEnv(0.003));
      filter(n, sr, 'highpass', 2000);
      mix(dry, n, 0.6, 0, sr);
      drive(dry, 1.6);
      rv = { decay: 1.2, wet: 0.4, size: 0.9, tail: 0.6 };
      break;
    }
    case 'rim': {
      dry = tone(sr, 0.05, 'tri', 1700, expEnv(0.008));
      const n = noise(sr, 0.03, r, 'white', expEnv(0.004));
      filter(n, sr, 'bandpass', 3000, 1.5);
      mix(dry, n, 0.7, 0, sr);
      break;
    }
    case 'shaker': {
      dry = noise(sr, 0.08, r, 'white', adEnv(0.012, 0.025));
      filter(dry, sr, 'bandpass', 6500, 1.2);
      gain(dry, 1.8);
      break;
    }
    case 'taiko': {
      dry = tone(sr, 1.0, 'sine', drop(130, 68, 0.03), adEnv(0.001, 0.33));
      mix(dry, tone(sr, 1.0, 'sine', drop(260, 150, 0.03), adEnv(0.001, 0.1)), 0.3, 0, sr);
      const n = noise(sr, 0.2, r, 'white', expEnv(0.025));
      filter(n, sr, 'lowpass', 900);
      mix(dry, n, 0.7, 0, sr);
      drive(dry, 1.6);
      rv = { decay: 1.8, wet: 0.45, size: 1.1, tail: 0.9 };
      break;
    }
    case 'boom': {
      dry = tone(sr, 3, 'sine', drop(85, 30, 0.12), adEnv(0.002, 0.9));
      drive(dry, 2);
      const n = noise(sr, 2, r, 'white', adEnv(0.002, 0.35));
      filter(n, sr, 'lowpass', drop(3000, 150, 0.2), 0.8);
      mix(dry, n, 0.8, 0, sr);
      const rb = noise(sr, 3, r, 'brown', adEnv(0.05, 0.9));
      filter(rb, sr, 'lowpass', 200);
      mix(dry, rb, 0.8, 0, sr);
      rv = { decay: 2.5, wet: 0.5, size: 1.3, tail: 1.2 };
      break;
    }
    case 'timp': {
      const f = TIMP_HZ;
      dry = partials(sr, 2.5, [f, f * 1.5, f * 1.99, f * 2.44, f * 2.98], [0.9, 0.5, 0.4, 0.25, 0.15], [1, 0.5, 0.35, 0.2, 0.1]);
      mix(dry, tone(sr, 0.3, 'sine', drop(f * 1.3, f, 0.02), adEnv(0.001, 0.08)), 0.6, 0, sr);
      const n = noise(sr, 0.05, r, 'white', expEnv(0.01));
      filter(n, sr, 'lowpass', 1500);
      mix(dry, n, 0.4, 0, sr);
      rv = { decay: 1.8, wet: 0.35, size: 1.1, tail: 0.8 };
      break;
    }
    case 'tick': {
      dry = tone(sr, 0.03, 'sine', 3800, expEnv(0.003));
      const n = noise(sr, 0.01, r, 'white', expEnv(0.001));
      filter(n, sr, 'highpass', 5000);
      mix(dry, n, 0.5, 0, sr);
      break;
    }
    case 'heart': {
      dry = tone(sr, 0.5, 'sine', drop(70, 45, 0.04), adEnv(0.004, 0.08));
      mix(dry, tone(sr, 0.3, 'sine', drop(62, 42, 0.04), adEnv(0.004, 0.06)), 0.65, 0.16, sr);
      filter(dry, sr, 'lowpass', 300);
      break;
    }
  }
  dcBlock(dry, sr);
  fade(dry, sr, 0.2, 5);
  const st: Stereo = rv ? reverb(dry, sr, rv) : [dry, dry.slice()];
  normalize(st, 0.89);
  const out = trimTail(st, sr);
  if (name === 'rcrash') {
    out[0].reverse();
    out[1].reverse();
    fade(out[0], sr, 30, 2);
    fade(out[1], sr, 30, 2);
  }
  return out;
}

export function renderDrumKit(sr: number): Record<DrumName, Stereo> {
  const kit = {} as Record<DrumName, Stereo>;
  for (const d of DRUMS) kit[d] = renderDrum(d, sr);
  return kit;
}
