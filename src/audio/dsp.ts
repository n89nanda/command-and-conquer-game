/**
 * Tiny offline DSP toolkit used to pre-render sound effects and drum samples
 * into plain Float32Arrays (no Web Audio needed, so it is deterministic and fast).
 * Everything here is pure and allocation-light; rendering a typical SFX takes ~1-5 ms.
 */

export type Param = number | ((t: number) => number);
export type Wave = 'sine' | 'tri' | 'saw' | 'square';
export type Stereo = [Float32Array, Float32Array];

const TAU = Math.PI * 2;

export const pv = (p: Param, t: number): number => (typeof p === 'number' ? p : p(t));

/** mulberry32 seeded PRNG. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  bi(): number {
    return this.next() * 2 - 1;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------- envelopes

/** Exponential decay with time constant tau (seconds). */
export const expEnv = (tau: number, delay = 0) => (t: number) => (t < delay ? 1 : Math.exp(-(t - delay) / tau));

/** Linear attack then exponential decay. */
export const adEnv = (attack: number, tau: number) => (t: number) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / tau);

/** Attack, hold, exponential release. */
export const ahrEnv = (attack: number, hold: number, tau: number) => (t: number) =>
  t < attack ? t / attack : t < attack + hold ? 1 : Math.exp(-(t - attack - hold) / tau);

/** Piecewise-linear envelope through [t, v] points. Holds last value. */
export const ptsEnv = (pts: [number, number][]) => (t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i];
    if (t <= t1) {
      const [t0, v0] = pts[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
};

/** Exponential glide from f0 to f1 over dur seconds (then holds f1). */
export const glide = (f0: number, f1: number, dur: number) => (t: number) =>
  t >= dur ? f1 : f0 * Math.pow(f1 / f0, t / dur);

/** Pitch drop "boom" curve: fast exponential approach from f0 towards f1. */
export const drop = (f0: number, f1: number, tau: number) => (t: number) => f1 + (f0 - f1) * Math.exp(-t / tau);

// ---------------------------------------------------------------- generators

export const alloc = (sr: number, dur: number) => new Float32Array(Math.max(1, Math.ceil(sr * dur)));

function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export interface ToneOpts {
  phase?: number;
  /** FM: modulator frequency ratio and index (radians) */
  fmRatio?: number;
  fmIndex?: Param;
}

/** Band-limited oscillator with time-varying frequency / amplitude. */
export function tone(sr: number, dur: number, type: Wave, freq: Param, amp: Param = 1, o: ToneOpts = {}): Float32Array {
  const n = Math.ceil(sr * dur);
  const out = new Float32Array(Math.max(1, n));
  let ph = o.phase ?? 0;
  let mph = 0;
  const fmR = o.fmRatio ?? 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = pv(freq, t);
    const dt = Math.min(0.5, Math.abs(f) / sr);
    let p = ph;
    if (fmR) {
      p = ph + (pv(o.fmIndex ?? 0, t) * Math.sin(TAU * mph)) / TAU;
      mph += (f * fmR) / sr;
      mph -= Math.floor(mph);
      p -= Math.floor(p);
    }
    let v: number;
    switch (type) {
      case 'sine':
        v = Math.sin(TAU * p);
        break;
      case 'tri':
        v = 1 - 4 * Math.abs(p - 0.5);
        break;
      case 'saw':
        v = 2 * p - 1 - polyblep(p, dt);
        break;
      default:
        v = (p < 0.5 ? 1 : -1) + polyblep(p, dt) - polyblep((p + 0.5) % 1, dt);
    }
    out[i] = v * pv(amp, t);
    ph += f / sr;
    ph -= Math.floor(ph);
  }
  return out;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

export function noise(sr: number, dur: number, rng: Rng, color: NoiseColor = 'white', amp: Param = 1): Float32Array {
  const n = Math.ceil(sr * dur);
  const out = new Float32Array(Math.max(1, n));
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.bi();
    let v: number;
    if (color === 'white') v = w;
    else if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) / 1.02;
      v = br * 3.5;
    }
    out[i] = v * pv(amp, i / sr);
  }
  return out;
}

/**
 * Random impulse "crackle" (debris, fire, electricity). density = impulses/sec,
 * each impulse is a short decaying noise click of random amplitude.
 */
export function crackle(sr: number, dur: number, rng: Rng, density: Param, amp: Param = 1, clickMs = 3): Float32Array {
  const n = Math.ceil(sr * dur);
  const out = new Float32Array(Math.max(1, n));
  const clickLen = Math.max(4, Math.floor((clickMs / 1000) * sr));
  const step = Math.floor(sr / 1000); // evaluate every ms
  for (let i = 0; i < n; i += step) {
    const t = i / sr;
    const p = (pv(density, t) * step) / sr;
    if (rng.next() < p) {
      const a = pv(amp, t) * (0.3 + 0.7 * rng.next() ** 2) * (rng.next() < 0.5 ? -1 : 1);
      const len = Math.floor(clickLen * (0.5 + rng.next()));
      for (let k = 0; k < len && i + k < n; k++) out[i + k] += a * rng.bi() * Math.exp((-4 * k) / len);
    }
  }
  return out;
}

/** Sum of exponentially decaying sine partials (bells, metal clanks, rings). */
export function partials(sr: number, dur: number, freqs: number[], decays: number[], amps: number[], rng?: Rng): Float32Array {
  const out = alloc(sr, dur);
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f >= sr * 0.45) continue;
    const w = (TAU * f) / sr;
    const dec = Math.exp(-1 / (decays[k] * sr));
    let a = amps[k];
    let ph = rng ? rng.next() * TAU : 0;
    for (let i = 0; i < out.length; i++) {
      out[i] += a * Math.sin(ph);
      ph += w;
      a *= dec;
      if (a < 1e-5) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- processors

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'notch';

/** RBJ biquad, in place. Frequency / Q may vary over time (coefs updated every 16 samples). */
export function filter(buf: Float32Array, sr: number, type: FilterType, freq: Param, q: Param = 0.707, gainDb = 0): Float32Array {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const dyn = typeof freq !== 'number' || typeof q !== 'number';
  const calc = (t: number) => {
    const f = Math.min(sr * 0.45, Math.max(10, pv(freq, t)));
    const Q = Math.max(0.05, pv(q, t));
    const w0 = (TAU * f) / sr;
    const c = Math.cos(w0);
    const s = Math.sin(w0);
    const al = s / (2 * Q);
    let a0: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
        break;
      case 'highpass':
        b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
        break;
      case 'bandpass':
        b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
        break;
      default: {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
      }
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  };
  calc(0);
  for (let i = 0; i < buf.length; i++) {
    if (dyn && (i & 15) === 0) calc(i / sr);
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

/** Soft saturation, in place. drive >= 1. Output normalised so full-scale input stays ~full-scale. */
export function drive(buf: Float32Array, amount: number, asym = 0): Float32Array {
  const norm = 1 / Math.tanh(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] + asym) * amount) * norm - Math.tanh(asym * amount) * norm;
  return buf;
}

export function gain(buf: Float32Array, g: Param, sr = 48000): Float32Array {
  if (typeof g === 'number') for (let i = 0; i < buf.length; i++) buf[i] *= g;
  else for (let i = 0; i < buf.length; i++) buf[i] *= g(i / sr);
  return buf;
}

/** dst += src * g, starting at offset seconds. Returns dst. */
export function mix(dst: Float32Array, src: Float32Array, g = 1, offsetSec = 0, sr = 48000): Float32Array {
  const o = Math.round(offsetSec * sr);
  const n = Math.min(src.length, dst.length - o);
  for (let i = Math.max(0, -o); i < n; i++) dst[i + o] += src[i] * g;
  return dst;
}

/** Simple feedback echo (slapback) in place. */
export function echo(buf: Float32Array, sr: number, delaySec: number, fb: number, wet: number, lpHz = 3000): Float32Array {
  const d = Math.max(1, Math.round(delaySec * sr));
  const line = new Float32Array(d);
  let idx = 0;
  let lp = 0;
  const k = 1 - Math.exp((-TAU * lpHz) / sr);
  for (let i = 0; i < buf.length; i++) {
    const delayed = line[idx];
    lp += k * (delayed - lp);
    line[idx] = buf[i] + lp * fb;
    buf[i] += lp * wet;
    idx = (idx + 1) % d;
  }
  return buf;
}

export function fade(buf: Float32Array, sr: number, inMs = 1, outMs = 10): Float32Array {
  const ni = Math.min(buf.length, Math.floor((inMs / 1000) * sr));
  const no = Math.min(buf.length, Math.floor((outMs / 1000) * sr));
  for (let i = 0; i < ni; i++) buf[i] *= i / ni;
  for (let i = 0; i < no; i++) buf[buf.length - 1 - i] *= i / no;
  return buf;
}

/** Remove DC with a one-pole high-pass (~10 Hz), in place. */
export function dcBlock(buf: Float32Array, sr: number): Float32Array {
  const R = Math.exp((-TAU * 12) / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const y = buf[i] - x1 + R * y1;
    x1 = buf[i];
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

// ---------------------------------------------------------------- reverb

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(size: number, private fb: number, private damp: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const y = this.buf[this.i];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}
class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const APS = [556, 441, 341, 225];

export interface ReverbOpts {
  /** Approx RT60 in seconds. */
  decay: number;
  /** 0..1 wet level. */
  wet: number;
  /** High-frequency damping 0..1. */
  damp?: number;
  /** Room size scale (0.3 small .. 1.2 big) */
  size?: number;
  predelay?: number;
  /** Seconds of tail to append. Default = decay. */
  tail?: number;
}

/** Freeverb-style stereo reverb. Mono in, stereo out (dry centred). */
export function reverb(mono: Float32Array, sr: number, o: ReverbOpts): Stereo {
  const tail = o.tail ?? o.decay;
  const n = mono.length + Math.ceil(tail * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const scale = (sr / 44100) * (o.size ?? 1);
  const damp = o.damp ?? 0.35;
  const mk = (spread: number) => ({
    combs: COMBS.map((d) => {
      const len = Math.max(8, Math.round((d + spread) * scale));
      const fb = Math.pow(10, (-3 * len) / sr / Math.max(0.05, o.decay));
      return new Comb(len, fb, damp);
    }),
    aps: APS.map((d) => new Allpass(Math.max(4, Math.round((d + spread) * scale)))),
  });
  const cl = mk(0);
  const cr = mk(23);
  const pd = Math.round((o.predelay ?? 0.01) * sr);
  const wet = o.wet * 0.05;
  for (let i = 0; i < n; i++) {
    const dry = i < mono.length ? mono[i] : 0;
    const j = i - pd;
    const x = j >= 0 && j < mono.length ? mono[j] : 0;
    let l = 0, r = 0;
    for (let k = 0; k < 8; k++) {
      l += cl.combs[k].process(x);
      r += cr.combs[k].process(x);
    }
    for (let k = 0; k < 4; k++) {
      l = cl.aps[k].process(l);
      r = cr.aps[k].process(r);
    }
    L[i] = dry + l * wet;
    R[i] = dry + r * wet;
  }
  return [L, R];
}

// ---------------------------------------------------------------- analysis / utils

export function peakOf(...bufs: Float32Array[]): number {
  let p = 0;
  for (const b of bufs) for (let i = 0; i < b.length; i++) {
    const a = Math.abs(b[i]);
    if (a > p) p = a;
  }
  return p;
}

export function normalize(bufs: Float32Array[], target = 0.89): void {
  const p = peakOf(...bufs);
  if (p < 1e-9 || !isFinite(p)) return;
  const g = target / p;
  for (const b of bufs) for (let i = 0; i < b.length; i++) b[i] *= g;
}

/** Trim trailing near-silence (below -60 dB) keeping a short fade. */
export function trimTail(bufs: Stereo, sr: number): Stereo {
  const thr = 0.001;
  let end = bufs[0].length;
  while (end > 1 && Math.abs(bufs[0][end - 1]) < thr && Math.abs(bufs[1][end - 1]) < thr) end--;
  end = Math.min(bufs[0].length, end + Math.floor(sr * 0.01));
  const out: Stereo = [bufs[0].slice(0, end), bufs[1].slice(0, end)];
  fade(out[0], sr, 0, 8);
  fade(out[1], sr, 0, 8);
  return out;
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
