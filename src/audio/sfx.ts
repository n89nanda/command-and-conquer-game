/**
 * Sound-effect recipes. Each SoundId is synthesised offline (pure JS DSP, see dsp.ts)
 * into a stereo Float32Array pair, normalised to -1 dBFS peak. The runtime engine
 * (Audio.ts) turns them into AudioBuffers once and plays them with small pitch jitter.
 */
import type { SoundId } from '../data/types';
import {
  Rng, Param, Wave, NoiseColor, FilterType, Stereo,
  alloc, tone, noise, crackle, partials, filter, drive, gain, mix, echo, reverb, fade, dcBlock,
  normalize, trimTail, expEnv, adEnv, ahrEnv, ptsEnv, glide, drop, pv, midiToHz, ToneOpts, ReverbOpts,
} from './dsp';

export interface SfxMeta {
  /** Relative loudness (0..1) applied at playback. */
  vol: number;
  /** Max concurrent instances of this id. */
  max: number;
  /** Number of pre-rendered random variants. */
  variants: number;
  /** Non-positional UI sound (ignores x/z). */
  ui?: boolean;
  /** Minimum seconds between two starts of this id (extra requests are merged). */
  minGap: number;
  /** Random playback-rate spread (+/-). */
  pitchVar: number;
  /** Voice-stealing priority (higher survives). */
  prio: number;
}

export const SFX_META: Record<SoundId, SfxMeta> = {
  mg: { vol: 0.5, max: 6, variants: 3, minGap: 0.04, pitchVar: 0.06, prio: 2 },
  rifle: { vol: 0.6, max: 6, variants: 3, minGap: 0.03, pitchVar: 0.07, prio: 2 },
  cannon: { vol: 0.72, max: 5, variants: 3, minGap: 0.05, pitchVar: 0.06, prio: 4 },
  heavyCannon: { vol: 0.85, max: 4, variants: 2, minGap: 0.06, pitchVar: 0.05, prio: 5 },
  rocket: { vol: 0.6, max: 5, variants: 3, minGap: 0.05, pitchVar: 0.07, prio: 3 },
  missile: { vol: 0.6, max: 5, variants: 3, minGap: 0.05, pitchVar: 0.07, prio: 3 },
  artillery: { vol: 0.6, max: 4, variants: 2, minGap: 0.06, pitchVar: 0.06, prio: 4 },
  laser: { vol: 0.62, max: 4, variants: 3, minGap: 0.05, pitchVar: 0.05, prio: 4 },
  obelisk: { vol: 0.9, max: 3, variants: 1, minGap: 0.1, pitchVar: 0.03, prio: 6 },
  flame: { vol: 0.55, max: 4, variants: 3, minGap: 0.08, pitchVar: 0.08, prio: 3 },
  railgun: { vol: 0.8, max: 4, variants: 2, minGap: 0.06, pitchVar: 0.04, prio: 5 },
  explosionSmall: { vol: 0.62, max: 5, variants: 3, minGap: 0.04, pitchVar: 0.1, prio: 5 },
  explosionMedium: { vol: 0.78, max: 5, variants: 3, minGap: 0.05, pitchVar: 0.08, prio: 6 },
  explosionLarge: { vol: 1.0, max: 4, variants: 2, minGap: 0.08, pitchVar: 0.07, prio: 7 },
  buildingCollapse: { vol: 1.0, max: 3, variants: 1, minGap: 0.2, pitchVar: 0.05, prio: 8 },
  infantryDie: { vol: 0.55, max: 4, variants: 4, minGap: 0.06, pitchVar: 0.08, prio: 3 },
  placeBuilding: { vol: 0.8, max: 2, variants: 2, ui: true, minGap: 0.1, pitchVar: 0.03, prio: 9 },
  sell: { vol: 0.7, max: 2, variants: 1, ui: true, minGap: 0.1, pitchVar: 0.01, prio: 9 },
  click: { vol: 0.6, max: 3, variants: 2, ui: true, minGap: 0.025, pitchVar: 0.02, prio: 9 },
  select: { vol: 0.45, max: 2, variants: 2, ui: true, minGap: 0.05, pitchVar: 0.015, prio: 9 },
  cancel: { vol: 0.5, max: 2, variants: 1, ui: true, minGap: 0.05, pitchVar: 0.01, prio: 9 },
  error: { vol: 0.5, max: 1, variants: 1, ui: true, minGap: 0.25, pitchVar: 0, prio: 9 },
  powerDown: { vol: 0.75, max: 1, variants: 1, ui: true, minGap: 1, pitchVar: 0, prio: 9 },
  buildComplete: { vol: 0.6, max: 2, variants: 1, ui: true, minGap: 0.15, pitchVar: 0, prio: 9 },
  unitReady: { vol: 0.6, max: 2, variants: 1, ui: true, minGap: 0.15, pitchVar: 0, prio: 9 },
  moneyTick: { vol: 0.22, max: 2, variants: 3, ui: true, minGap: 0.045, pitchVar: 0.03, prio: 1 },
  harvest: { vol: 0.45, max: 3, variants: 2, minGap: 0.15, pitchVar: 0.06, prio: 1 },
  ionCharge: { vol: 0.85, max: 1, variants: 1, minGap: 1, pitchVar: 0, prio: 9 },
  ionStrike: { vol: 1.0, max: 2, variants: 1, minGap: 0.5, pitchVar: 0.02, prio: 10 },
  nukeLaunch: { vol: 0.9, max: 1, variants: 1, minGap: 1, pitchVar: 0, prio: 9 },
  nukeImpact: { vol: 1.0, max: 2, variants: 1, minGap: 0.5, pitchVar: 0.02, prio: 10 },
  radarOn: { vol: 0.6, max: 1, variants: 1, ui: true, minGap: 1, pitchVar: 0, prio: 9 },
  repair: { vol: 0.45, max: 3, variants: 2, minGap: 0.2, pitchVar: 0.05, prio: 2 },
  crush: { vol: 0.6, max: 3, variants: 3, minGap: 0.05, pitchVar: 0.1, prio: 3 },
  rotor: { vol: 0.35, max: 3, variants: 2, minGap: 0.1, pitchVar: 0.05, prio: 1 },
  uiHover: { vol: 0.18, max: 2, variants: 1, ui: true, minGap: 0.04, pitchVar: 0.02, prio: 8 },
  briefingType: { vol: 0.3, max: 3, variants: 4, ui: true, minGap: 0.025, pitchVar: 0.08, prio: 8 },
  victory: { vol: 0.85, max: 1, variants: 1, ui: true, minGap: 2, pitchVar: 0, prio: 10 },
  defeat: { vol: 0.85, max: 1, variants: 1, ui: true, minGap: 2, pitchVar: 0, prio: 10 },
};

export const ALL_SOUNDS = Object.keys(SFX_META) as SoundId[];

// ------------------------------------------------------------------ builder

type Filt = [FilterType, Param, Param?, number?];

/** Smooth random modulation (1 + depth * noise), `rate` control points per second. */
function jitter(rng: Rng, rate: number, depth: number, dur: number): (t: number) => number {
  const n = Math.ceil(rate * dur) + 3;
  const pts = Array.from({ length: n }, () => rng.bi());
  return (t: number) => {
    const x = Math.max(0, t * rate);
    const i = Math.floor(x);
    const f = x - i;
    const a = pts[Math.min(i, n - 1)];
    const b = pts[Math.min(i + 1, n - 1)];
    const s = (1 - Math.cos(f * Math.PI)) / 2;
    return 1 + depth * (a + (b - a) * s);
  };
}

const mul = (a: Param, b: Param): Param => (t: number) => pv(a, t) * pv(b, t);

class Mix {
  buf: Float32Array;
  constructor(public sr: number, public dur: number, public rng: Rng) {
    this.buf = alloc(sr, dur);
  }
  put(src: Float32Array, amp = 1, at = 0): this {
    mix(this.buf, src, amp, at, this.sr);
    return this;
  }
  noise(at: number, dur: number, color: NoiseColor, filters: Filt[], env: Param, amp = 1): this {
    const b = noise(this.sr, dur, this.rng, color);
    for (const f of filters) filter(b, this.sr, f[0], f[1], f[2] ?? 0.707, f[3] ?? 0);
    gain(b, env, this.sr);
    return this.put(b, amp, at);
  }
  tone(at: number, dur: number, type: Wave, freq: Param, env: Param, amp = 1, o?: ToneOpts, filters: Filt[] = []): this {
    const b = tone(this.sr, dur, type, freq, env, o);
    for (const f of filters) filter(b, this.sr, f[0], f[1], f[2] ?? 0.707, f[3] ?? 0);
    return this.put(b, amp, at);
  }
  part(at: number, dur: number, freqs: number[], decays: number[], amps: number[], amp = 1): this {
    return this.put(partials(this.sr, dur, freqs, decays, amps, this.rng), amp, at);
  }
  crack(at: number, dur: number, density: Param, amp: Param, ms: number, filters: Filt[] = []): this {
    const b = crackle(this.sr, dur, this.rng, density, amp, ms);
    for (const f of filters) filter(b, this.sr, f[0], f[1], f[2] ?? 0.707, f[3] ?? 0);
    return this.put(b, 1, at);
  }
  sub(dur: number, fn: (m: Mix) => void, amp = 1, at = 0, driveAmt = 0): this {
    const m = new Mix(this.sr, dur, this.rng);
    fn(m);
    if (driveAmt > 0) drive(m.buf, driveAmt);
    return this.put(m.buf, amp, at);
  }
  filter(type: FilterType, f: Param, q: Param = 0.707, g = 0): this {
    filter(this.buf, this.sr, type, f, q, g);
    return this;
  }
  drive(a: number): this {
    drive(this.buf, a);
    return this;
  }
}

// ------------------------------------------------------------------ recipe helpers

/** Low pitch-dropping sine "thump". */
function thump(m: Mix, at: number, f0: number, f1: number, tau: number, decay: number, amp: number, dur = decay * 5) {
  m.tone(at, dur, 'sine', drop(f0, f1, tau), adEnv(0.0015, decay), amp);
}

function explosion(m: Mix, size: 0 | 1 | 2, at = 0, scale = 1) {
  const r = m.rng;
  const f0 = [100, 78, 62][size] * r.range(0.9, 1.1);
  const f1 = [42, 32, 25][size];
  const tau = [0.06, 0.1, 0.16][size];
  const dec = [0.16, 0.3, 0.55][size];
  const dur = [1.1, 1.9, 3.2][size];
  // initial crack
  m.noise(at, 0.06, 'white', [['highpass', 1200]], expEnv(0.005 + size * 0.003), 1.2 * scale);
  // sub thump (driven for harmonics so it reads on small speakers)
  m.sub(dur, (s) => thump(s, 0, f0, f1, tau, dec, 1, dur), 0.75 * scale, at, 3);
  // blast body (broadband, closing lowpass)
  m.noise(at, dur, 'white', [['lowpass', drop([6000, 4800, 3800][size], [500, 380, 260][size], [0.08, 0.16, 0.3][size]), 0.8]], adEnv(0.001, [0.14, 0.28, 0.55][size]), 2.2 * scale);
  // mid "crunch" — gives weight on laptop speakers
  m.sub(dur, (s) => {
    s.noise(0, dur, 'pink', [['bandpass', drop([900, 700, 550][size], [260, 200, 160][size], [0.1, 0.2, 0.4][size]), 0.9]], mul(adEnv(0.002, dec * 1.1), jitter(r, 14, 0.4, dur)), 1);
  }, 1.9 * scale, at, 2.5);
  // rumble
  m.noise(at, dur, 'brown', [['lowpass', [360, 300, 240][size]]], mul(adEnv([0.02, 0.04, 0.08][size], [0.3, 0.6, 1.1][size]), jitter(r, 6, 0.35, dur)), [0.5, 0.65, 0.85][size] * scale);
  // debris crackle
  m.crack(at + 0.02, dur, ptsEnv([[0, 0], [0.04, 120 + size * 140], [dur * 0.7, 0]]), expEnv(dur * 0.35), 4, [['bandpass', 2400, 0.5]]);
  m.crack(at + 0.05, dur, ptsEnv([[0, 0], [0.1, 40 + size * 40], [dur * 0.8, 0]]), mul(expEnv(dur * 0.4), () => 1.6), 6, [['bandpass', 900, 0.7]]);
  if (size === 2) {
    // secondary blast
    m.noise(at + 0.22, 1.5, 'white', [['lowpass', drop(2500, 250, 0.2), 0.8]], adEnv(0.004, 0.3), 1.2 * scale);
    m.sub(1.8, (s) => thump(s, 0, 70, 28, 0.12, 0.35, 1, 1.8), 0.6 * scale, at + 0.22, 2.5);
  }
}

function bell(m: Mix, at: number, f: number, amp: number, dec = 0.4) {
  m.part(at, dec * 5, [f, f * 2.0, f * 2.76, f * 5.4, f * 8.93], [dec, dec * 0.7, dec * 0.5, dec * 0.25, dec * 0.12], [1, 0.45, 0.4, 0.18, 0.08], amp);
}

// ------------------------------------------------------------------ recipes

type Recipe = (m: Mix, v: number) => ReverbOpts | null;

const R: Record<SoundId, [number, Recipe]> = {
  mg: [0.42, (m) => {
    const r = m.rng;
    const rounds = 3;
    for (let k = 0; k < rounds; k++) {
      const t = k * 0.064 + r.range(-0.004, 0.004);
      const a = 1 - k * 0.06;
      m.sub(0.12, (s) => {
        s.noise(0, 0.012, 'white', [['highpass', 1800]], expEnv(0.0025), 1.1);
        s.noise(0, 0.1, 'white', [['bandpass', r.range(1100, 1500), 1.0]], adEnv(0.0005, 0.02), 2.0);
        s.noise(0, 0.06, 'white', [['bandpass', 3200, 1.2]], adEnv(0.0003, 0.008), 0.8);
        thump(s, 0, 260, 90, 0.015, 0.018, 0.35, 0.1);
      }, a, t, 3);
    }
    echo(m.buf, m.sr, 0.085, 0.2, 0.18, 2500);
    return { decay: 0.6, wet: 0.35, size: 0.6, damp: 0.5, tail: 0.45 };
  }],
  rifle: [0.3, (m) => {
    const r = m.rng;
    m.sub(0.3, (s) => {
      s.noise(0, 0.015, 'white', [['highpass', 2500]], expEnv(0.003), 1.3);
      s.noise(0, 0.12, 'white', [['bandpass', r.range(1500, 2000), 0.9]], adEnv(0.0005, 0.03), 1.6);
      thump(s, 0, 280, 100, 0.015, 0.025, 0.3, 0.12);
    }, 1, 0, 2.5);
    echo(m.buf, m.sr, 0.11 + r.range(0, 0.03), 0.25, 0.28, 2500);
    return { decay: 0.9, wet: 0.3, size: 0.7, damp: 0.5, tail: 0.6 };
  }],
  cannon: [1.1, (m) => {
    const r = m.rng;
    m.noise(0, 0.03, 'white', [['highpass', 1500]], expEnv(0.005), 1.4);
    m.noise(0, 0.6, 'white', [['lowpass', drop(5000, 400, 0.08), 0.8]], adEnv(0.001, 0.1), 2.4);
    m.sub(0.6, (s) => s.noise(0, 0.6, 'pink', [['bandpass', drop(1100, 300, 0.08), 0.9]], adEnv(0.001, 0.12), 1), 2.0, 0, 2.5);
    m.sub(1.0, (s) => {
      thump(s, 0, 135 * r.range(0.93, 1.07), 38, 0.07, 0.18, 1, 1.0);
      s.tone(0, 0.3, 'tri', drop(270, 90, 0.05), adEnv(0.001, 0.05), 0.4);
    }, 1.0, 0, 3);
    m.noise(0.01, 1.0, 'brown', [['lowpass', 300]], adEnv(0.02, 0.35), 0.8);
    return { decay: 1.4, wet: 0.45, size: 1, damp: 0.45, tail: 1.2 };
  }],
  heavyCannon: [1.5, (m) => {
    const r = m.rng;
    m.noise(0, 0.04, 'white', [['highpass', 1200]], expEnv(0.007), 1.4);
    m.noise(0, 0.9, 'white', [['lowpass', drop(4200, 300, 0.12), 0.8]], adEnv(0.001, 0.16), 2.4);
    m.sub(0.9, (s) => s.noise(0, 0.9, 'pink', [['bandpass', drop(900, 250, 0.12), 0.9]], adEnv(0.001, 0.2), 1), 2.2, 0, 2.5);
    m.sub(1.4, (s) => {
      thump(s, 0, 112 * r.range(0.94, 1.06), 30, 0.1, 0.3, 1, 1.4);
      s.tone(0, 0.4, 'tri', drop(220, 70, 0.07), adEnv(0.001, 0.07), 0.45);
    }, 1.1, 0, 3.5);
    const f = r.range(360, 420);
    m.part(0.005, 0.8, [f, f * 1.61, f * 2.41, f * 3.39], [0.25, 0.18, 0.12, 0.08], [0.25, 0.18, 0.12, 0.08]);
    m.noise(0.01, 1.4, 'brown', [['lowpass', 260]], mul(adEnv(0.03, 0.5), jitter(r, 8, 0.3, 1.4)), 1.0);
    return { decay: 2.0, wet: 0.5, size: 1.1, damp: 0.45, tail: 1.6 };
  }],
  rocket: [1.0, (m) => {
    const r = m.rng;
    m.noise(0, 0.1, 'white', [['lowpass', 1400]], expEnv(0.015), 0.9);
    thump(m, 0, 170, 70, 0.03, 0.05, 0.9, 0.2);
    const peak = r.range(2300, 3000);
    m.noise(0, 1.0, 'pink', [['bandpass', ptsEnv([[0, 500], [0.12, peak], [0.95, 800]]), 1.3]], mul(ptsEnv([[0, 0], [0.04, 1], [0.25, 0.7], [1.0, 0]]), jitter(r, 25, 0.25, 1)), 2.2);
    m.noise(0, 0.6, 'white', [['highpass', 4000]], ahrEnv(0.01, 0.12, 0.15), 0.3);
    m.noise(0, 0.8, 'brown', [['lowpass', 220]], adEnv(0.01, 0.25), 0.7);
    return { decay: 1.0, wet: 0.3, size: 0.9, tail: 0.8 };
  }],
  missile: [0.9, (m) => {
    const r = m.rng;
    m.noise(0, 0.06, 'white', [['bandpass', 1800, 0.8]], expEnv(0.01), 0.8);
    thump(m, 0, 200, 90, 0.02, 0.04, 0.7, 0.15);
    m.noise(0, 0.9, 'pink', [['bandpass', ptsEnv([[0, 900], [0.08, r.range(3500, 4300)], [0.85, 1500]]), 1.8]], mul(ptsEnv([[0, 0], [0.03, 1], [0.2, 0.75], [0.9, 0]]), jitter(r, 30, 0.3, 0.9)), 2.4);
    m.tone(0.02, 0.8, 'sine', glide(r.range(1300, 1500), 750, 0.7), ptsEnv([[0, 0], [0.05, 0.15], [0.7, 0]]), 1);
    m.crack(0.02, 0.7, 320, expEnv(0.25), 1.5, [['highpass', 3000]]);
    return { decay: 0.9, wet: 0.3, size: 0.8, tail: 0.7 };
  }],
  artillery: [1.5, (m) => {
    const r = m.rng;
    m.noise(0, 0.02, 'white', [['highpass', 1500]], expEnv(0.004), 0.7);
    m.sub(1.3, (s) => {
      thump(s, 0, 96 * r.range(0.94, 1.06), 32, 0.09, 0.25, 1, 1.3);
    }, 1.0, 0, 3);
    m.noise(0, 0.9, 'white', [['lowpass', drop(2600, 250, 0.1), 0.8]], adEnv(0.001, 0.13), 2.0);
    m.sub(0.9, (s) => s.noise(0, 0.9, 'pink', [['bandpass', drop(700, 220, 0.12), 0.9]], adEnv(0.002, 0.2), 1), 1.8, 0, 2.5);
    m.noise(0.02, 1.4, 'brown', [['lowpass', 160]], adEnv(0.05, 0.5), 1.0);
    return { decay: 2.2, wet: 0.5, size: 1.15, damp: 0.55, tail: 1.6 };
  }],
  laser: [0.62, (m) => {
    const r = m.rng;
    const f = r.range(0.92, 1.08);
    m.tone(0, 0.3, 'saw', drop(2600 * f, 260 * f, 0.06), adEnv(0.001, 0.1), 0.8, {}, [['lowpass', drop(9000, 1300, 0.1), 3]]);
    m.tone(0, 0.4, 'sine', drop(950 * f, 180 * f, 0.1), adEnv(0.001, 0.16), 0.8, { fmRatio: 1.5, fmIndex: (t) => 6 * Math.exp(-t / 0.1) });
    m.noise(0, 0.1, 'white', [['highpass', 5000]], expEnv(0.03), 0.3);
    // short sustained beam buzz
    m.sub(0.5, (s) => {
      s.tone(0, 0.5, 'saw', 150 * f, 1, 0.5);
      s.tone(0, 0.5, 'saw', 151.7 * f, 1, 0.5);
      s.filter('bandpass', 1300, 3);
      gain(s.buf, mul(ahrEnv(0.02, 0.28, 0.06), jitter(r, 40, 0.35, 0.5)), s.sr);
    }, 0.9, 0.02, 2);
    echo(m.buf, m.sr, 0.07, 0.3, 0.2, 4000);
    return { decay: 0.8, wet: 0.3, size: 0.7, tail: 0.6 };
  }],
  obelisk: [2.0, (m) => {
    const r = m.rng;
    const z = 0.55;
    // charge whine with accelerating tremolo
    const chargeEnv = ptsEnv([[0, 0], [0.5, 0.6], [z + 0.02, 0]]);
    m.tone(0, z + 0.05, 'sine', glide(220, 1800, z), mul(chargeEnv, (t) => 0.65 + 0.35 * Math.sin(2 * Math.PI * (12 * t + 25 * t * t))), 2.0);
    m.tone(0, z + 0.05, 'saw', glide(330, 2700, z), chargeEnv, 0.4, {}, [['lowpass', 3000]]);
    // discharge
    m.sub(1.2, (s) => {
      s.tone(0, 0.7, 'saw', drop(3200, 120, 0.08), adEnv(0.001, 0.2), 1, {}, [['lowpass', drop(9000, 800, 0.15), 2]]);
      s.noise(0, 0.6, 'white', [['highpass', 1500]], adEnv(0.001, 0.15), 0.8);
      thump(s, 0, 125, 40, 0.08, 0.25, 1.1, 1.2);
    }, 1.2, z, 2);
    m.crack(z, 1.3, ptsEnv([[0, 2200], [1.1, 0]]), expEnv(0.45), 1, [['highpass', 2000]]);
    m.noise(z, 1.0, 'white', [['bandpass', 3000, 1.5]], mul(adEnv(0.005, 0.25), jitter(r, 60, 0.6, 1)), 0.4);
    return { decay: 1.6, wet: 0.4, size: 1, tail: 1.2 };
  }],
  flame: [0.9, (m) => {
    const r = m.rng;
    const fl = jitter(r, 18, 0.35, 0.9);
    const env = mul(ptsEnv([[0, 0], [0.06, 1], [0.5, 0.8], [0.9, 0]]), fl);
    m.noise(0, 0.9, 'brown', [['lowpass', (t) => 1100 * fl(t), 1.2]], env, 1.4);
    m.noise(0, 0.9, 'pink', [['lowpass', 2200], ['highpass', 300]], env, 0.8);
    m.noise(0, 0.9, 'white', [['highpass', 3000]], env, 0.18);
    m.crack(0.03, 0.8, 70, 0.6, 3, [['lowpass', 3500]]);
    m.tone(0, 0.35, 'sine', drop(85, 50, 0.1), adEnv(0.02, 0.1), 0.6);
    return { decay: 0.7, wet: 0.25, size: 0.7, tail: 0.5 };
  }],
  railgun: [1.3, (m) => {
    const r = m.rng;
    m.tone(0, 0.07, 'sine', glide(800, 4200, 0.06), ptsEnv([[0, 0], [0.05, 0.3], [0.065, 0]]), 1);
    const t0 = 0.055;
    // N-wave supersonic crack
    const nw = alloc(m.sr, 0.01);
    const h = Math.floor(0.0012 * m.sr);
    for (let i = 0; i < 2 * h; i++) nw[i] = i < h ? 1 - i / h : -(1 - (i - h) / h);
    m.put(nw, 1.0, t0);
    m.noise(t0, 0.03, 'white', [['highpass', 3000]], expEnv(0.002), 1.2);
    m.noise(t0, 0.15, 'white', [['bandpass', 1000, 0.7]], adEnv(0.0005, 0.05), 0.9);
    m.sub(0.3, (s) => thump(s, 0, 170, 50, 0.03, 0.08, 1, 0.3), 1.1, t0, 2);
    const f = r.range(2300, 2500);
    m.part(t0, 1.1, [f, f * 1.546, f * 2.158, f * 2.75], [0.5, 0.35, 0.25, 0.15], [0.3, 0.2, 0.15, 0.1]);
    echo(m.buf, m.sr, 0.15, 0.3, 0.25, 5000);
    return { decay: 1.8, wet: 0.4, size: 0.9, tail: 1.2 };
  }],
  explosionSmall: [1.1, (m) => {
    explosion(m, 0);
    return { decay: 1.0, wet: 0.35, size: 0.8, tail: 0.8 };
  }],
  explosionMedium: [1.9, (m) => {
    explosion(m, 1);
    m.drive(1.4);
    return { decay: 1.6, wet: 0.45, size: 1.0, tail: 1.3 };
  }],
  explosionLarge: [3.2, (m) => {
    explosion(m, 2);
    m.drive(2);
    return { decay: 2.6, wet: 0.55, size: 1.2, tail: 2.2 };
  }],
  buildingCollapse: [4.2, (m) => {
    const r = m.rng;
    explosion(m, 1, 0, 0.8);
    const d = 4.2;
    m.noise(0, d, 'brown', [['lowpass', 260]], mul(ptsEnv([[0, 0], [0.1, 1], [2.6, 0.7], [d, 0]]), jitter(r, 9, 0.5, d)), 1.5);
    m.noise(0, d, 'pink', [['bandpass', 800, 0.8]], mul(ptsEnv([[0, 0], [0.2, 0.6], [2.8, 0.4], [d, 0]]), jitter(r, 22, 0.8, d)), 0.7);
    for (let k = 0; k < 14; k++) {
      const t = r.range(0.3, 3.4);
      const a = r.range(0.25, 0.8) * (1 - t / 4.5);
      thump(m, t, r.range(100, 150), 45, 0.03, 0.06, a, 0.35);
      m.noise(t, 0.12, 'white', [['lowpass', 2200]], expEnv(0.02), a * 0.6);
    }
    m.noise(0.5, 2.4, 'white', [['bandpass', glide(900, 380, 2.2), 25]], ptsEnv([[0, 0], [0.3, 1], [1.6, 0.6], [2.4, 0]]), 0.7);
    m.drive(1.6);
    return { decay: 2.2, wet: 0.45, size: 1.2, tail: 1.8 };
  }],
  infantryDie: [0.6, (m, v) => {
    const r = m.rng;
    const f0 = [175, 150, 205, 130][v % 4] * r.range(0.95, 1.05);
    const vib = jitter(r, 30, 0.03, 0.6);
    const pitch = (t: number) => ptsEnv([[0, f0 * 1.2], [0.07, f0], [0.38, f0 * 0.68]])(t) * vib(t);
    const env = ptsEnv([[0, 0], [0.015, 1], [0.18, 0.8], [0.38, 0]]);
    const src = tone(m.sr, 0.45, 'saw', pitch, env);
    const n = noise(m.sr, 0.45, r, 'white', env);
    filter(n, m.sr, 'bandpass', 1600, 1);
    mix(src, n, 0.12);
    const fm: [Param, number, number][] = [
      [glide(780, 520, 0.35), 8, 1],
      [glide(1250, 980, 0.35), 9, 0.55],
      [2600, 10, 0.25],
    ];
    for (const [fr, q, g] of fm) {
      const b = src.slice();
      filter(b, m.sr, 'bandpass', fr, q);
      m.put(b, g * 2.2);
    }
    m.drive(1.4);
    thump(m, 0.3, 110, 50, 0.03, 0.07, 0.8, 0.3);
    m.noise(0.3, 0.15, 'pink', [['lowpass', 600]], expEnv(0.03), 0.6);
    return { decay: 0.6, wet: 0.2, size: 0.6, tail: 0.4 };
  }],
  placeBuilding: [0.9, (m) => {
    const r = m.rng;
    m.sub(0.8, (s) => thump(s, 0, 140, 45, 0.05, 0.15, 1, 0.8), 1.5, 0, 1.8);
    const f = r.range(300, 320);
    m.part(0.002, 0.8, [f, f * 1.69, f * 2.54, f * 3.64, f * 5.39], [0.25, 0.2, 0.15, 0.1, 0.07], [0.4, 0.3, 0.25, 0.15, 0.1]);
    m.noise(0, 0.02, 'white', [['highpass', 2500]], expEnv(0.003), 0.6);
    m.noise(0.12, 0.02, 'white', [['highpass', 2500]], expEnv(0.003), 0.35);
    m.noise(0, 0.6, 'pink', [['lowpass', 1500]], adEnv(0.005, 0.2), 0.45);
    m.noise(0.1, 0.4, 'white', [['bandpass', 4000, 0.8]], ahrEnv(0.02, 0.1, 0.1), 0.15);
    return { decay: 1.0, wet: 0.3, size: 0.8, tail: 0.7 };
  }],
  sell: [1.0, (m) => {
    const r = m.rng;
    m.noise(0, 0.05, 'white', [['highpass', 5000]], expEnv(0.012), 0.5);
    m.part(0, 0.1, [1800, 2900], [0.015, 0.01], [0.3, 0.2]);
    bell(m, 0.02, 1568, 0.55, 0.3);
    bell(m, 0.11, 2093, 0.6, 0.45);
    for (let k = 0; k < 9; k++) m.tone(r.range(0.12, 0.5), 0.1, 'sine', r.range(2600, 6200), expEnv(0.03), r.range(0.05, 0.12));
    return { decay: 0.9, wet: 0.3, size: 0.7, tail: 0.7 };
  }],
  click: [0.06, (m, v) => {
    const f = v ? 2050 : 2250;
    m.tone(0, 0.05, 'sine', f, expEnv(0.006), 0.8);
    m.tone(0, 0.05, 'tri', f / 2, expEnv(0.012), 0.4);
    m.noise(0, 0.01, 'white', [['highpass', 4000]], expEnv(0.0015), 0.5);
    return { decay: 0.15, wet: 0.1, size: 0.3, tail: 0.08 };
  }],
  select: [0.25, (m, v) => {
    const a = v ? 830 : 880;
    m.tone(0, 0.1, 'tri', a, adEnv(0.002, 0.03), 0.8, {}, [['lowpass', 6000]]);
    m.tone(0, 0.1, 'sine', a * 2, adEnv(0.002, 0.02), 0.2);
    m.tone(0.045, 0.2, 'tri', a * 1.5, adEnv(0.002, 0.05), 0.8, {}, [['lowpass', 6000]]);
    m.tone(0.045, 0.2, 'sine', a * 3, adEnv(0.002, 0.03), 0.2);
    return { decay: 0.3, wet: 0.15, size: 0.4, tail: 0.15 };
  }],
  cancel: [0.28, (m) => {
    m.tone(0, 0.1, 'tri', 988, adEnv(0.002, 0.035), 0.8, {}, [['lowpass', 5000]]);
    m.tone(0.055, 0.2, 'tri', 659, adEnv(0.002, 0.06), 0.8, {}, [['lowpass', 5000]]);
    return { decay: 0.3, wet: 0.15, size: 0.4, tail: 0.15 };
  }],
  error: [0.4, (m) => {
    for (const t of [0, 0.16]) {
      m.sub(0.13, (s) => {
        s.tone(0, 0.13, 'square', 98, ahrEnv(0.003, 0.08, 0.02), 0.5);
        s.tone(0, 0.13, 'square', 104, ahrEnv(0.003, 0.08, 0.02), 0.5);
        s.tone(0, 0.13, 'saw', 196, ahrEnv(0.003, 0.08, 0.02), 0.4);
        s.filter('lowpass', 1800);
      }, 1, t, 1.5);
    }
    return { decay: 0.2, wet: 0.1, size: 0.3, tail: 0.1 };
  }],
  powerDown: [1.8, (m) => {
    m.tone(0, 1.7, 'saw', glide(700, 45, 1.4), ptsEnv([[0, 0.9], [1.2, 0.6], [1.6, 0]]), 0.9, {}, [['lowpass', glide(5000, 200, 1.4), 4]]);
    m.tone(0, 1.6, 'sine', 60, ptsEnv([[0, 0.5], [1.5, 0]]), 0.6);
    m.tone(0, 1.6, 'sine', 120, ptsEnv([[0, 0.3], [1.3, 0]]), 0.5);
    m.noise(0, 0.1, 'white', [['lowpass', 2000]], expEnv(0.02), 0.6);
    thump(m, 0, 150, 60, 0.03, 0.05, 0.6, 0.3);
    m.crack(0, 0.6, ptsEnv([[0, 300], [0.4, 0]]), 0.35, 1.5, [['highpass', 3000]]);
    return { decay: 1.2, wet: 0.35, size: 0.9, tail: 0.9 };
  }],
  buildComplete: [1.0, (m) => {
    const notes = [783.99, 1046.5, 1567.98];
    notes.forEach((f, i) => {
      m.tone(i * 0.085, 0.8, 'sine', f, adEnv(0.003, 0.25), 0.55, { fmRatio: 2, fmIndex: (t) => 2.5 * Math.exp(-t / 0.1) });
      m.tone(i * 0.085, 0.3, 'square', f / 2, adEnv(0.003, 0.06), 0.08, {}, [['lowpass', 2500]]);
    });
    return { decay: 1.0, wet: 0.35, size: 0.8, tail: 0.8 };
  }],
  unitReady: [0.7, (m) => {
    m.noise(0, 0.05, 'white', [['bandpass', 2000, 1]], expEnv(0.01), 0.5);
    thump(m, 0, 200, 90, 0.02, 0.05, 0.6, 0.2);
    m.tone(0.05, 0.12, 'square', 659.25, ahrEnv(0.003, 0.05, 0.03), 0.3, {}, [['lowpass', 3000]]);
    m.tone(0.13, 0.25, 'square', 987.77, ahrEnv(0.003, 0.07, 0.05), 0.3, {}, [['lowpass', 3000]]);
    return { decay: 0.7, wet: 0.25, size: 0.6, tail: 0.5 };
  }],
  moneyTick: [0.05, (m, v) => {
    const f = [2637, 2794, 2489][v % 3];
    m.tone(0, 0.05, 'sine', f, expEnv(0.008), 0.7);
    m.tone(0, 0.03, 'sine', f * 2, expEnv(0.004), 0.2);
    m.noise(0, 0.005, 'white', [['highpass', 6000]], expEnv(0.001), 0.3);
    return null;
  }],
  harvest: [0.9, (m) => {
    const r = m.rng;
    const env = ahrEnv(0.05, 0.5, 0.15);
    m.noise(0, 0.9, 'white', [['bandpass', 900, 1.5]], mul(env, (t) => 0.4 + 0.6 * Math.sin(2 * Math.PI * 9 * t) ** 2), 0.9);
    m.noise(0, 0.9, 'pink', [['bandpass', glide(2500, 1800, 0.8), 4]], mul(env, jitter(r, 20, 0.6, 0.9)), 0.5);
    m.tone(0, 0.9, 'saw', 55, env, 0.3, {}, [['lowpass', 300]]);
    m.tone(0, 0.9, 'saw', 55.6, env, 0.3, {}, [['lowpass', 300]]);
    for (const t of [0.1, 0.35, 0.6]) m.part(t + r.range(0, 0.05), 0.2, [800, 1350, 2100], [0.05, 0.04, 0.03], [0.3, 0.2, 0.15]);
    return { decay: 0.5, wet: 0.2, size: 0.6, tail: 0.4 };
  }],
  ionCharge: [3.0, (m) => {
    const d = 2.6;
    const env = ptsEnv([[0, 0], [2.4, 0.7], [2.7, 1], [2.9, 0]]);
    const trem = (t: number) => 0.6 + 0.4 * Math.sin(2 * Math.PI * (4 * t + (24 / (2 * d)) * t * t));
    for (const [ratio, a] of [[1, 0.5], [1.5, 0.3], [2.01, 0.2]] as const) {
      m.tone(0, 3, 'sine', (t) => glide(180, 1400, d)(t) * ratio, mul(env, trem), a);
    }
    m.tone(0, 3, 'saw', glide(60, 120, d), ptsEnv([[0, 0], [2.5, 0.3], [2.9, 0]]), 1, {}, [['lowpass', 800]]);
    m.crack(0, 3, ptsEnv([[0, 0], [2.6, 900], [2.9, 0]]), 0.3, 1.2, [['highpass', 3000]]);
    m.noise(0, 3, 'white', [['bandpass', glide(1000, 8000, d), 6]], ptsEnv([[0, 0], [2.6, 0.5], [2.9, 0]]), 0.6);
    return { decay: 1.5, wet: 0.4, size: 1, tail: 1 };
  }],
  ionStrike: [4.0, (m) => {
    const r = m.rng;
    m.tone(0, 2, 'saw', drop(4200, 200, 0.3), adEnv(0.002, 0.6), 0.5, {}, [['lowpass', drop(12000, 600, 0.5), 3]]);
    m.tone(0, 2, 'saw', drop(4242, 202, 0.3), adEnv(0.002, 0.6), 0.5, {}, [['lowpass', drop(12000, 600, 0.5), 3]]);
    m.noise(0, 2.5, 'white', [['bandpass', 2500, 0.6]], mul(adEnv(0.005, 0.8), jitter(r, 50, 0.6, 2.5)), 0.8);
    m.sub(3.5, (s) => thump(s, 0, 92, 22, 0.25, 0.9, 1, 3.5), 1.4, 0, 3);
    m.sub(3, (s) => s.noise(0, 3, 'pink', [['bandpass', drop(900, 200, 0.4), 0.9]], mul(adEnv(0.003, 0.7), jitter(r, 12, 0.4, 3)), 1), 2.0, 0, 2.5);
    m.noise(0, 3, 'white', [['lowpass', drop(6000, 200, 0.4), 0.8]], adEnv(0.002, 0.6), 1.3);
    m.crack(0, 2.5, ptsEnv([[0, 1500], [2, 0]]), 0.5, 1.5, [['highpass', 1500]]);
    m.noise(0.05, 3.8, 'brown', [['lowpass', 200]], mul(adEnv(0.1, 1.3), jitter(r, 5, 0.3, 3.8)), 1.3);
    m.drive(2);
    return { decay: 3.0, wet: 0.55, size: 1.3, tail: 2.5 };
  }],
  nukeLaunch: [4.0, (m) => {
    const r = m.rng;
    thump(m, 0, 80, 35, 0.1, 0.3, 1.0, 1.5);
    const fl = jitter(r, 15, 0.3, 4);
    m.noise(0, 4, 'brown', [['lowpass', ptsEnv([[0, 300], [2.5, 1800], [4, 900]])]], mul(ptsEnv([[0, 0], [0.3, 1], [2.5, 0.9], [3.9, 0]]), fl), 1.6);
    m.noise(0, 4, 'pink', [['lowpass', 2500]], mul(ptsEnv([[0, 0], [0.4, 0.5], [2.5, 0.5], [3.9, 0]]), fl), 0.6);
    m.noise(0, 4, 'pink', [['bandpass', glide(300, 3200, 3), 2]], ptsEnv([[0, 0], [2.6, 1], [3.9, 0]]), 1.0);
    m.crack(0.1, 3.5, 150, ptsEnv([[0, 0.3], [3.5, 0]]), 3, [['lowpass', 4000]]);
    return { decay: 2.5, wet: 0.45, size: 1.2, tail: 2 };
  }],
  nukeImpact: [5.5, (m) => {
    const r = m.rng;
    m.noise(0, 0.1, 'white', [['highpass', 800]], expEnv(0.012), 1.0);
    m.sub(5.5, (s) => thump(s, 0, 62, 18, 0.4, 1.6, 1, 5.5), 1.4, 0, 3);
    m.noise(0, 4, 'white', [['lowpass', drop(8000, 150, 0.6), 0.8]], adEnv(0.002, 1.0), 1.4);
    m.noise(0, 5.5, 'brown', [['lowpass', 180]], mul(ptsEnv([[0, 0], [0.3, 1], [3, 0.6], [5.4, 0]]), jitter(r, 3, 0.4, 5.5)), 1.5);
    m.noise(0.4, 3, 'pink', [['bandpass', glide(3000, 400, 2), 0.8]], adEnv(0.2, 0.8), 1.0);
    m.sub(4, (s) => s.noise(0, 4, 'pink', [['bandpass', drop(700, 180, 0.6), 0.8]], mul(adEnv(0.003, 1.0), jitter(r, 8, 0.4, 4)), 1), 2.2, 0, 2.5);
    m.crack(0, 5, ptsEnv([[0, 0], [0.3, 300], [4, 0]]), 0.35, 4, [['bandpass', 2000, 0.5]]);
    m.drive(2.2);
    return { decay: 3.5, wet: 0.6, size: 1.4, tail: 3 };
  }],
  radarOn: [1.6, (m) => {
    const env = ptsEnv([[0, 0], [0.1, 0.5], [0.6, 0.5], [0.7, 0]]);
    m.tone(0, 0.75, 'sine', glide(150, 1200, 0.6), env, 0.8);
    m.tone(0, 0.75, 'square', glide(150, 1200, 0.6), env, 0.15, {}, [['lowpass', 2500]]);
    m.tone(0.7, 0.2, 'sine', 1568, adEnv(0.002, 0.04), 0.4);
    m.tone(0.8, 0.2, 'sine', 1568, adEnv(0.002, 0.04), 0.4);
    m.tone(0.9, 0.2, 'sine', 2093, adEnv(0.002, 0.04), 0.4);
    const ping = tone(m.sr, 0.9, 'sine', 1318.5, adEnv(0.002, 0.3), { fmRatio: 1.41, fmIndex: 0.5 });
    const p2 = new Float32Array(ping.length + Math.floor(m.sr * 0.5));
    p2.set(ping);
    echo(p2, m.sr, 0.18, 0.45, 0.6, 3000);
    m.put(p2, 0.6, 1.0);
    return { decay: 1.2, wet: 0.3, size: 0.8, tail: 0.8 };
  }],
  repair: [0.7, (m) => {
    const r = m.rng;
    for (let k = 0; k < 5; k++) {
      const t = k * 0.07;
      m.part(t, 0.1, [2100, 3300, 4700].map((f) => f * r.range(0.97, 1.03)), [0.02, 0.015, 0.01], [0.4, 0.3, 0.2]);
      m.noise(t, 0.01, 'white', [['highpass', 3000]], expEnv(0.002), 0.4);
    }
    m.part(0.4, 0.8, [620, 1100, 1780, 2600], [0.2, 0.15, 0.1, 0.07], [0.5, 0.35, 0.25, 0.15]);
    m.tone(0, 0.35, 'saw', 120, ahrEnv(0.01, 0.25, 0.05), 0.15, {}, [['bandpass', 2000, 2]]);
    m.crack(0, 0.3, 400, 0.2, 1, [['highpass', 2500]]);
    return { decay: 0.6, wet: 0.25, size: 0.6, tail: 0.5 };
  }],
  crush: [0.45, (m) => {
    m.sub(0.45, (s) => {
      s.crack(0, 0.25, 1400, adEnv(0.002, 0.09), 2, [['lowpass', 4500]]);
      s.crack(0, 0.25, 1400, adEnv(0.002, 0.09), 2, [['lowpass', 4500]]);
      s.noise(0, 0.3, 'pink', [['bandpass', drop(900, 300, 0.05), 2]], adEnv(0.003, 0.08), 1.2);
      thump(s, 0, 120, 50, 0.03, 0.06, 0.45, 0.4);
    }, 1, 0, 2);
    return { decay: 0.5, wet: 0.2, size: 0.6, tail: 0.3 };
  }],
  rotor: [0.5, (m) => {
    for (let k = 0; k < 5; k++) {
      const t = k * 0.09;
      const a = 1 - k * 0.04;
      m.noise(t, 0.1, 'pink', [['lowpass', 700]], adEnv(0.004, 0.03), a);
      thump(m, t, 90, 60, 0.02, 0.03, 0.6 * a, 0.12);
    }
    m.tone(0, 0.5, 'sine', 1200, ahrEnv(0.02, 0.4, 0.05), 0.04);
    m.tone(0, 0.5, 'sine', 1810, ahrEnv(0.02, 0.4, 0.05), 0.025);
    return { decay: 0.4, wet: 0.15, size: 0.6, tail: 0.2 };
  }],
  uiHover: [0.04, (m) => {
    m.tone(0, 0.04, 'sine', 3000, expEnv(0.004), 0.5);
    m.tone(0, 0.04, 'tri', 1500, expEnv(0.006), 0.25);
    return null;
  }],
  briefingType: [0.05, (m) => {
    const r = m.rng;
    m.noise(0, 0.02, 'white', [['bandpass', r.range(2600, 3400), 1]], expEnv(0.002), 0.9);
    m.tone(0, 0.03, 'sine', drop(600, 300, 0.005), expEnv(0.01), 0.3);
    m.part(0, 0.04, [4200 * r.range(0.95, 1.05), 5600], [0.01, 0.008], [0.15, 0.1]);
    return null;
  }],
  victory: [2.4, (m) => {
    const brass = (at: number, midi: number[], dur: number, amp: number) => {
      m.sub(dur + 0.6, (s) => {
        for (const n of midi) {
          const f = midiToHz(n);
          for (const dt of [-0.006, 0.006]) s.tone(0, dur + 0.6, 'saw', f * (1 + dt), ahrEnv(0.03, dur, 0.25), 0.25);
        }
        s.filter('lowpass', ptsEnv([[0, 500], [0.08, 3200], [0.5, 1800], [dur + 0.5, 900]]), 1.2);
      }, amp, at, 1.3);
    };
    brass(0, [67, 55], 0.12, 0.9);
    brass(0.15, [60, 64, 67, 72, 48], 1.4, 1.2);
    thump(m, 0.15, 110, 98, 0.05, 0.35, 0.9, 1.5);
    m.noise(0.15, 2, 'white', [['highpass', 5000]], adEnv(0.01, 0.9), 0.3);
    return { decay: 2.0, wet: 0.45, size: 1.1, tail: 1.5 };
  }],
  defeat: [3.0, (m) => {
    thump(m, 0, 70, 30, 0.1, 0.8, 1.2, 3);
    m.sub(3, (s) => {
      for (const n of [48, 51, 55, 36]) {
        const f = midiToHz(n);
        for (const dt of [-0.005, 0.005]) s.tone(0, 3, 'saw', glide(f * (1 + dt), f * 0.94, 2.5), ahrEnv(0.06, 1.2, 0.6), 0.25);
      }
      s.filter('lowpass', glide(1400, 400, 2.5), 1);
    }, 1, 0.02, 1.2);
    m.noise(0, 2.5, 'brown', [['lowpass', 200]], adEnv(0.05, 0.8), 0.6);
    return { decay: 2.2, wet: 0.5, size: 1.1, tail: 1.5 };
  }],
};

/** Render one variant of a sound effect. Returns normalised stereo channels. */
export function renderSfx(id: SoundId, sr: number, variant = 0): Stereo {
  const entry = R[id];
  const seed = (hash(id) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
  const m = new Mix(sr, entry[0], new Rng(seed));
  const rv = entry[1](m, variant);
  dcBlock(m.buf, sr);
  filter(m.buf, sr, 'highpass', 32, 0.6); // sub-32 Hz is inaudible on most systems: don't waste headroom on it
  fade(m.buf, sr, 0.3, 5);
  let st: Stereo;
  if (rv) st = reverb(m.buf, sr, rv);
  else st = [m.buf, m.buf.slice()];
  for (const ch of st) for (let i = 0; i < ch.length; i++) if (!isFinite(ch[i])) ch[i] = 0;
  normalize(st, 0.89);
  const out = trimTail(st, sr);
  // Positional sounds are stored mono (half the memory, and StereoPanner pans mono sources properly).
  if (!SFX_META[id].ui && !WIDE.has(id)) {
    const [L, Rc] = out;
    for (let i = 0; i < L.length; i++) L[i] = (L[i] + Rc[i]) * 0.5;
    normalize([L], 0.89);
    return [L, L];
  }
  return out;
}

/** Positional sounds that keep their stereo reverb (rare, huge events). */
const WIDE = new Set<SoundId>(['nukeImpact', 'nukeLaunch', 'ionStrike', 'ionCharge']);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Nominal (dry) duration of a recipe in seconds — a proxy for its render cost. */
export function sfxDuration(id: SoundId): number {
  return R[id]?.[0] ?? 1;
}
