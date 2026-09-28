/**
 * Procedural music engine: a lookahead step sequencer (16ths) that interprets the
 * compositions in musicTracks.ts and plays them with Web Audio synth voices and
 * pre-rendered drum samples. Works with a realtime AudioContext or an OfflineAudioContext.
 */
import { Rng, midiToHz } from './dsp';
import { DrumName, TIMP_HZ } from './drumkit';
import { TRACKS, TrackDef, SectionDef, Layer, LAYERS, LeadInst, V } from './musicTracks';
import type { MusicTrack } from './AudioTypes';

export interface MusicEvent {
  t: number;
  layer: Layer;
  kind: string;
  midi?: number[];
  dur?: number;
  vel?: number;
  section: string;
  bar: number;
  step: number;
}

const DEFAULT_LEVEL: Record<Layer, number> = {
  drums: 0.8, perc: 0.55, bass: 0.32, gtr: 0.26, lead: 0.26, arp: 0.3, pad: 0.24, stab: 0.35, fx: 0.4,
};
const REVERB_SEND: Record<Layer, number> = {
  drums: 0.1, perc: 0.1, bass: 0, gtr: 0.1, lead: 0.3, arp: 0.3, pad: 0.45, stab: 0.3, fx: 0.4,
};
const DELAY_SEND: Partial<Record<Layer, number>> = { lead: 0.22, arp: 0.35, stab: 0.12 };

const DRUM_LAYER: Record<DrumName, Layer> = {
  kick: 'drums', kick2: 'drums', snare: 'drums', snare2: 'drums', clap: 'drums', crash: 'drums', tomH: 'drums',
  tomM: 'drums', tomL: 'drums', taiko: 'drums', timp: 'drums',
  hat: 'perc', ohat: 'perc', ride: 'perc', metal: 'perc', rim: 'perc', shaker: 'perc', tick: 'perc', heart: 'perc',
  boom: 'fx', rcrash: 'fx',
};
const DRUM_PAN: Partial<Record<DrumName, number>> = {
  hat: 0.25, ohat: 0.3, ride: -0.3, tomH: -0.35, tomL: 0.35, shaker: -0.4, metal: 0.25, rim: -0.15, tick: 0.2, crash: -0.2, rcrash: 0.2,
};
const DRUM_GAIN: Partial<Record<DrumName, number>> = {
  kick: 1, kick2: 1, snare: 0.75, snare2: 0.8, clap: 0.55, crash: 0.35, rcrash: 0.4, hat: 0.35, ohat: 0.3, ride: 0.3,
  tomH: 0.7, tomM: 0.7, tomL: 0.75, taiko: 0.8, metal: 0.35, rim: 0.4, shaker: 0.3, tick: 0.3, heart: 0.6, boom: 0.9, timp: 0.75,
};

const VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.5, g: 0.3 };

const clean = (s: string) => s.replace(/[\s|]/g, '');
const smooth = (lo: number, hi: number, x: number) => {
  if (hi <= lo) return x >= lo ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ parsing

interface Chord {
  deg: number;
  major: boolean;
  start: number; // beats
  len: number;
}
interface MelNote {
  step: number;
  len: number;
  deg: number | null;
  alt: number;
}
interface Parsed {
  chords: Chord[];
  chordBeats: number;
}

function parseChords(s: string): Parsed {
  const chords: Chord[] = [];
  let b = 0;
  for (const tok of s.trim().split(/\s+/)) {
    const [d, l] = tok.split(':');
    const len = l ? parseFloat(l) : 4;
    chords.push({ deg: parseInt(d, 10), major: d.includes('M'), start: b, len });
    b += len;
  }
  return { chords, chordBeats: b };
}

export function parseMelody(s: string): { notes: MelNote[]; len: number } {
  const notes: MelNote[] = [];
  let st = 0;
  for (const tok of s.replace(/\|/g, ' ').trim().split(/\s+/)) {
    const [d, l] = tok.split(':');
    const len = parseInt(l, 10);
    if (d === '_') notes.push({ step: st, len, deg: null, alt: 0 });
    else notes.push({ step: st, len, deg: parseInt(d, 10), alt: d.includes('#') ? 1 : d.includes('b') ? -1 : 0 });
    st += len;
  }
  return { notes, len: st };
}

/** Expand "a b*3 _" -> ['a','b','b','b',null] */
function seq(v: string | undefined): (string | null)[] {
  if (!v) return [];
  const out: (string | null)[] = [];
  for (const tok of v.trim().split(/\s+/)) {
    const [k, n] = tok.split('*');
    for (let i = 0; i < (n ? parseInt(n, 10) : 1); i++) out.push(k === '_' ? null : k);
  }
  return out;
}

const pickV = (v: V | undefined, pass: number): string | undefined => (Array.isArray(v) ? v[pass % v.length] : v);

// ------------------------------------------------------------------ theory helpers

function degMidi(def: TrackDef, d: number, tonic = def.tonic): number {
  const o = Math.floor(d / 7);
  const i = ((d % 7) + 7) % 7;
  return tonic + 12 * o + def.scale[i];
}
const pc = (m: number) => ((m % 12) + 12) % 12;
function place(pcv: number, low: number): number {
  return low + ((pcv - pc(low) + 12) % 12);
}
/** Semitone offset of diatonic step `k` above chord root. */
function chordInterval(def: TrackDef, ch: Chord, k: number): number {
  if (k === 2 && ch.major) return 4;
  return degMidi(def, ch.deg + k) - degMidi(def, ch.deg);
}
function chordPcs(def: TrackDef, ch: Chord): number[] {
  const r = degMidi(def, ch.deg);
  return [0, 2, 4].map((k) => pc(r + chordInterval(def, ch, k)));
}

function voicing(pcs: number[], low: number, prev: number[] | null): number[] {
  const cands: number[][] = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = pcs.slice(inv).concat(pcs.slice(0, inv));
    for (const base of [low - 12, low, low + 12]) {
      const notes: number[] = [];
      let cur = base - 1;
      for (const p of order) {
        let n = cur + 1;
        while (pc(n) !== p) n++;
        notes.push(n);
        cur = n;
      }
      if (notes[0] >= low - 4 && notes[notes.length - 1] <= low + 17) cands.push(notes);
    }
  }
  if (!cands.length) return pcs.map((p) => place(p, low));
  if (!prev) {
    cands.sort((a, b) => Math.abs(a[0] - low) - Math.abs(b[0] - low));
    return cands[0];
  }
  let best = cands[0];
  let bd = Infinity;
  for (const c of cands) {
    let d = 0;
    for (let i = 0; i < c.length; i++) d += Math.abs(c[i] - (prev[i] ?? prev[prev.length - 1]));
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function makeCurve(k: number, asym = 0, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(k * (1 + asym));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = (Math.tanh(k * (x + asym)) - Math.tanh(k * asym)) / norm;
  }
  return c;
}

/** Stereo reverb impulse response: decaying noise with progressive HF damping. */
export function makeImpulse(ctx: BaseAudioContext, dur = 2.8, rt60 = 2.3): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const rng = new Rng(777);
  const pre = Math.floor(0.018 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const fc = 800 + 9000 * Math.exp(-t / 0.7);
      const k = Math.exp((-2 * Math.PI * fc) / sr);
      y = (1 - k) * rng.bi() + k * y;
      const env = Math.exp((-6.9 * t) / rt60) * Math.min(1, t / 0.004);
      d[i] = y * env;
    }
    // a few early reflections
    for (let e = 0; e < 6; e++) {
      const at = pre + Math.floor(sr * (0.007 + rng.next() * 0.05));
      if (at < n) d[at] += (rng.bi() > 0 ? 1 : -1) * 0.5 * (1 - e / 8);
    }
  }
  return buf;
}

// ------------------------------------------------------------------ player

interface Shared {
  ctx: BaseAudioContext;
  kit: () => Partial<Record<DrumName, AudioBuffer>> | null;
  noise: AudioBuffer;
  reverbIn: AudioNode;
  out: AudioNode;
  intensity: number;
  solo: Layer | null;
}

class Player {
  readonly ctx: BaseAudioContext;
  readonly def: TrackDef;
  readonly out: GainNode;
  readonly revOut: GainNode;
  private layerGain = {} as Record<Layer, GainNode>;
  private layerIn = {} as Record<Layer, AudioNode>;
  private duck: GainNode[] = [];
  private bassIn!: AudioNode;
  private subIn!: AudioNode;
  private choirIn!: AudioNode;
  private drumCh = new Map<DrumName, AudioNode>();
  private persistent: AudioScheduledSourceNode[] = [];
  private leadLfo!: AudioNode;
  private choirLfo!: AudioNode;
  private delayIn!: AudioNode;

  private parsed = new Map<string, Parsed>();
  private mel = new Map<string, { notes: MelNote[]; len: number }>();
  private rng = new Rng(4242);
  private prevPad: number[] | null = null;
  private lastTarget = {} as Record<Layer, number>;
  private zeroSince = {} as Record<Layer, number>;

  readonly stepDur: number;
  nextTime: number;
  secIdx = 0;
  bar = 0;
  step = 0;
  pass = 0;
  done = false;
  endTime = Infinity;
  disposeAt = Infinity;
  stopping = false;
  log: MusicEvent[] | null = null;

  constructor(private sh: Shared, readonly track: MusicTrack, start: number, fadeIn: number) {
    this.ctx = sh.ctx;
    this.def = TRACKS[track];
    this.stepDur = 60 / this.def.bpm / 4;
    this.nextTime = start;
    const c = this.ctx;
    this.out = c.createGain();
    this.revOut = c.createGain();
    for (const g of [this.out, this.revOut]) {
      g.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : 1, c.currentTime);
      if (fadeIn > 0) g.gain.setTargetAtTime(1, start, fadeIn / 3);
    }
    this.out.connect(sh.out);
    this.revOut.connect(sh.reverbIn);
    for (const s of this.def.sections) this.parsed.set(s.name, parseChords(s.chords));
    for (const [k, v] of Object.entries(this.def.mel ?? {})) this.mel.set(k, parseMelody(v));
    this.build();
    this.applyIntensity(true);
  }

  // ---------------------------------------------------------------- graph
  private build() {
    const c = this.ctx;
    const def = this.def;
    const beat = 60 / def.bpm;

    // tempo-synced ping-pong delay
    const dIn = c.createGain();
    const dl = c.createDelay(2);
    const dr = c.createDelay(2);
    dl.delayTime.value = beat * 0.75;
    dr.delayTime.value = beat * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 3200;
    const merge = c.createChannelMerger(2);
    dIn.connect(dl);
    dl.connect(dr);
    dr.connect(dlp);
    dlp.connect(fb);
    fb.connect(dl);
    dl.connect(merge, 0, 0);
    dr.connect(merge, 0, 1);
    const dWet = c.createGain();
    dWet.gain.value = 0.45;
    merge.connect(dWet);
    dWet.connect(this.out);
    this.delayIn = dIn;

    for (const L of LAYERS) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      const rs = c.createGain();
      rs.gain.value = REVERB_SEND[L];
      g.connect(rs);
      rs.connect(this.revOut);
      const ds = DELAY_SEND[L];
      if (ds) {
        const dg = c.createGain();
        dg.gain.value = ds;
        g.connect(dg);
        dg.connect(dIn);
      }
      this.layerGain[L] = g;
      let input: AudioNode = g;
      // sidechain-style duck for pads/arps on battle tracks
      if (def.intensity && (L === 'pad' || L === 'arp' || L === 'bass')) {
        const dk = c.createGain();
        dk.connect(g);
        this.duck.push(dk);
        input = dk;
      }
      this.layerIn[L] = input;
    }

    // bass: osc -> shaper -> lowpass ; sub: clean sine
    const bShape = c.createWaveShaper();
    bShape.curve = makeCurve(def.bassDrive ?? (def.bassStyle === 'soft' || def.bassStyle === 'sub' ? 1.2 : 2.5));
    bShape.oversample = '2x';
    const bLp = c.createBiquadFilter();
    bLp.type = 'lowpass';
    bLp.frequency.value = 5000;
    bShape.connect(bLp);
    bLp.connect(this.layerIn.bass);
    this.bassIn = bShape;
    const sLp = c.createBiquadFilter();
    sLp.type = 'lowpass';
    sLp.frequency.value = 160;
    sLp.connect(this.layerIn.bass);
    this.subIn = sLp;

    // guitar: HP -> drive -> shaper -> cab EQ -> double-tracked stereo
    const gHp = c.createBiquadFilter();
    gHp.type = 'highpass';
    gHp.frequency.value = 110;
    const gPre = c.createGain();
    gPre.gain.value = 1;
    const gSh = c.createWaveShaper();
    gSh.curve = makeCurve(def.gtrDrive ?? 8, 0.08);
    gSh.oversample = '4x';
    const scoop = c.createBiquadFilter();
    scoop.type = 'peaking';
    scoop.frequency.value = 500;
    scoop.Q.value = 0.8;
    scoop.gain.value = -5;
    const pres = c.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 1700;
    pres.Q.value = 1;
    pres.gain.value = 3;
    const cab = c.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 4800;
    cab.Q.value = 0.9;
    const cab2 = c.createBiquadFilter();
    cab2.type = 'lowpass';
    cab2.frequency.value = 7000;
    gHp.connect(gPre);
    gPre.connect(gSh);
    gSh.connect(scoop);
    scoop.connect(pres);
    pres.connect(cab);
    cab.connect(cab2);
    const pL = c.createStereoPanner();
    pL.pan.value = -0.55;
    const pR = c.createStereoPanner();
    pR.pan.value = 0.55;
    const dbl = c.createDelay(0.1);
    dbl.delayTime.value = 0.016;
    cab2.connect(pL);
    cab2.connect(dbl);
    dbl.connect(pR);
    pL.connect(this.layerIn.gtr);
    pR.connect(this.layerIn.gtr);
    this.layerIn.gtr = gHp;

    // pad filter with slow LFO
    const padLp = c.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 1500;
    padLp.Q.value = 0.7;
    padLp.connect(this.layerIn.pad);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = c.createGain();
    lfoG.gain.value = 500;
    lfo.connect(lfoG);
    lfoG.connect(padLp.frequency);
    lfo.start();
    this.persistent.push(lfo);
    const padOut = this.layerIn.pad;
    this.layerIn.pad = padLp;

    // choir formant bank (also pad layer)
    const cIn = c.createGain();
    for (const [f, q, g] of [[700, 5, 1], [1150, 6, 0.6], [2600, 8, 0.3]] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const bg = c.createGain();
      bg.gain.value = g * 2.2;
      cIn.connect(bp);
      bp.connect(bg);
      bg.connect(padOut);
    }
    const body = c.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 600;
    const bodyG = c.createGain();
    bodyG.gain.value = 0.35;
    cIn.connect(body);
    body.connect(bodyG);
    bodyG.connect(padOut);
    this.choirIn = cIn;

    // vibrato LFOs
    const mkLfo = (hz: number, cents: number) => {
      const o = c.createOscillator();
      o.frequency.value = hz;
      const g = c.createGain();
      g.gain.value = cents;
      o.connect(g);
      o.start();
      this.persistent.push(o);
      return g;
    };
    this.leadLfo = mkLfo(5.6, 1);
    this.choirLfo = mkLfo(4.8, 9);

    // drum channels
    const DRUMS_USED = new Set<DrumName>();
    for (const p of [...Object.values(def.drums), ...Object.values(def.fills)]) for (const k of Object.keys(p)) DRUMS_USED.add(k as DrumName);
    for (const d of ['crash', 'rcrash', 'boom'] as DrumName[]) DRUMS_USED.add(d);
    for (const d of DRUMS_USED) {
      const g = c.createGain();
      g.gain.value = DRUM_GAIN[d] ?? 0.6;
      const p = DRUM_PAN[d];
      if (p) {
        const pn = c.createStereoPanner();
        pn.pan.value = p;
        g.connect(pn);
        pn.connect(this.layerIn[DRUM_LAYER[d]]);
      } else g.connect(this.layerIn[DRUM_LAYER[d]]);
      this.drumCh.set(d, g);
    }
  }

  // ---------------------------------------------------------------- intensity
  private curve(L: Layer, x: number): number {
    const c = this.def.intensity?.[L];
    if (!c) return 1;
    const [lo, hi, floor = 0] = c;
    return floor + (1 - floor) * smooth(lo, hi, x);
  }

  applyIntensity(immediate = false) {
    const x = this.sh.intensity;
    const now = this.ctx.currentTime;
    for (const L of LAYERS) {
      let v = DEFAULT_LEVEL[L] * (this.def.levels?.[L] ?? 1) * this.curve(L, x);
      if (this.sh.solo && this.sh.solo !== L) v = 0;
      const g = this.layerGain[L].gain;
      if (immediate) g.setValueAtTime(v, now);
      else {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setTargetAtTime(v, now, 0.7);
      }
      if (v < 0.001 && (this.lastTarget[L] ?? 1) >= 0.001) this.zeroSince[L] = now;
      this.lastTarget[L] = v;
    }
  }

  /** Whether notes for this layer are worth scheduling (skip long-muted layers to save CPU). */
  private on(L: Layer, t: number): boolean {
    if ((this.lastTarget[L] ?? 1) >= 0.001) return true;
    return t - (this.zeroSince[L] ?? 0) < 3;
  }

  private brightness(): number {
    return this.def.intensity ? 0.65 + 0.7 * this.sh.intensity : 1;
  }

  // ---------------------------------------------------------------- scheduling
  schedule(until: number) {
    while (!this.done && this.nextTime < until) {
      this.doStep(this.nextTime);
      this.advance();
    }
  }

  private sec(): SectionDef {
    const name = this.def.order[this.secIdx];
    return this.def.sections.find((s) => s.name === name)!;
  }

  advance() {
    this.nextTime += this.stepDur;
    if (++this.step < 16) return;
    this.step = 0;
    if (++this.bar < this.sec().bars) return;
    this.bar = 0;
    if (++this.secIdx < this.def.order.length) return;
    if (this.def.loopFrom < 0) {
      this.done = true;
      this.endTime = this.nextTime;
      const tail = 60 / this.def.bpm * 2;
      for (const g of [this.out, this.revOut]) g.gain.setTargetAtTime(0.0001, this.endTime + tail, 1.0);
      this.disposeAt = this.endTime + tail + 6;
      return;
    }
    this.secIdx = this.def.loopFrom;
    this.pass++;
  }

  private chordAt(sec: SectionDef, bar: number, step: number): { ch: Chord; next: Chord; startsHere: boolean; beatsLeft: number } {
    const p = this.parsed.get(sec.name)!;
    const beat = (bar * 4 + step / 4) % p.chordBeats;
    let i = p.chords.findIndex((c) => beat >= c.start && beat < c.start + c.len);
    if (i < 0) i = 0;
    const ch = p.chords[i];
    return { ch, next: p.chords[(i + 1) % p.chords.length], startsHere: Math.abs(beat - ch.start) < 1e-6, beatsLeft: ch.start + ch.len - beat };
  }

  private pat(dict: Record<string, string> | undefined, v: V | undefined, bar: number): string | null {
    const s = seq(pickV(v, this.pass));
    if (!s.length || !dict) return null;
    const key = s[bar % s.length];
    if (!key) return null;
    const p = dict[key];
    return p ? clean(p) : null;
  }

  private emit(t: number, layer: Layer, kind: string, midi?: number[], dur?: number, vel?: number) {
    if (this.log) this.log.push({ t, layer, kind, midi, dur, vel, section: this.sec().name, bar: this.bar, step: this.step });
  }

  private doStep(t: number) {
    const def = this.def;
    const sec = this.sec();
    const { bar, step } = this;
    const abs = bar * 16 + step;
    const sd = this.stepDur;
    const barDur = sd * 16;
    const { ch, next, startsHere, beatsLeft } = this.chordAt(sec, bar, step);
    const swingT = step % 2 === 1 && def.swing ? def.swing * sd : 0;
    const tt = t + swingT;

    const drumKey = seq(pickV(sec.drums, this.pass));
    const hasDrums = drumKey.some((k) => k);

    // ---- section-level events
    if (bar === 0 && step === 0) {
      if (sec.crash ?? hasDrums) this.drum('crash', t, 1);
      if (sec.boom) this.drum('boom', t, 1);
    } else if (step === 0 && bar % 8 === 0 && hasDrums && !sec.noFill && sec.crash !== false) {
      this.drum('crash', t, 0.75);
    }
    if (sec.riser && step === 0 && bar === sec.bars - sec.riser) this.riser(t, sec.riser * barDur);
    if (sec.revCrash && step === 0 && bar === sec.bars - 1) {
      const buf = this.sh.kit()?.rcrash;
      if (buf) this.drum('rcrash', t + barDur - buf.duration, 0.9);
    }
    if (sec.drone && step === 0 && bar % 4 === 0) {
      const bars = Math.min(4, sec.bars - bar);
      this.drone(t, bars * barDur);
    }

    // ---- drums
    if (hasDrums) {
      const key = drumKey[bar % drumKey.length];
      const base = key ? def.drums[key] : null;
      const fillBar = !sec.noFill && sec.bars >= 4 && ((bar + 1) % 8 === 0 || bar === sec.bars - 1);
      let fill: Record<string, string> | null = null;
      if (fillBar && base) {
        const keys = Object.keys(def.fills).filter((k) => Object.keys(def.fills[k]).length);
        if (keys.length) {
          const r = new Rng(this.pass * 131 + this.secIdx * 17 + bar * 7 + 1);
          fill = def.fills[r.pick(keys)];
        }
      }
      if (base) {
        const insts = new Set([...Object.keys(base), ...(fill ? Object.keys(fill) : [])]);
        for (const inst of insts) {
          let chr = '.';
          const f = fill?.[inst] ? clean(fill[inst]) : null;
          const fc = f ? f[step % f.length] : '_';
          if (fc !== '_' && fc !== undefined) chr = fc;
          else if (base[inst]) {
            const p = clean(base[inst]);
            chr = p[abs % p.length];
          }
          const v = VEL[chr];
          if (!v) continue;
          const name = inst as DrumName;
          const hv = v * (1 + this.rng.bi() * 0.06);
          const jt = name === 'kick' || name === 'kick2' ? 0 : this.rng.bi() * 0.002;
          let rate = 1;
          if (name === 'timp') rate = midiToHz(place(pc(degMidi(def, ch.deg)), 36)) / TIMP_HZ;
          this.drum(name, tt + jt, hv, rate);
          if ((name === 'kick' || name === 'kick2') && this.duck.length) this.pump(tt, v);
        }
      }
    }

    // ---- bass
    const bp = this.pat(def.bass, sec.bass, bar);
    if (bp && this.on('bass', t)) {
      const c = bp[abs % bp.length];
      const n = this.noteFor(c, ch, next, def.bassLow);
      if (n !== null) {
        const len = this.tie(bp, abs % bp.length);
        const muted = c === 'm';
        const dur = muted ? sd * 0.55 : len * sd * (len > 1 ? 0.98 : 0.85);
        const vel = c === 'R' || c === 'O' || c === 'X' ? 1 : muted ? 0.6 : 0.82;
        this.bass(tt, n, dur, vel);
        this.emit(tt, 'bass', 'note', [n], dur, vel);
      }
    }

    // ---- guitar
    const gp = this.pat(def.gtr, sec.gtr, bar);
    if (gp && this.on('gtr', t)) {
      const c = gp[abs % gp.length];
      const n = this.noteFor(c, ch, next, def.gtrLow);
      if (n !== null) {
        const len = this.tie(gp, abs % gp.length);
        const muted = c === 'm';
        const dur = muted ? sd * 0.6 : len * sd * 0.95;
        const off = this.stepOf(c);
        const fifth = this.powerFifth(ch, off);
        this.gtr(tt, n, fifth, dur, c === 'X' || c === 'R' ? 1 : muted ? 0.75 : 0.85, muted);
        this.emit(tt, 'gtr', 'power', [n, n + fifth, n + 12], dur);
      }
    }

    // ---- arp
    const ap = this.pat(def.arp, sec.arp, bar);
    if (ap && this.on('arp', t)) {
      const c = ap[abs % ap.length];
      if (c >= '0' && c <= '9') {
        const idx = +c;
        const root = place(pc(degMidi(def, ch.deg)), def.arpLow);
        const iv = [0, chordInterval(def, ch, 2), chordInterval(def, ch, 4)];
        const table = [0, iv[1], iv[2], 12, iv[1] + 12, iv[2] + 12, 24, iv[1] + 24, chordInterval(def, ch, 6), chordInterval(def, ch, 8)];
        const n = root + table[idx];
        const len = this.tie(ap, abs % ap.length);
        this.arp(tt, n, len * sd * 0.9, 0.8 + (step % 4 === 0 ? 0.2 : 0));
        this.emit(tt, 'arp', 'note', [n], len * sd);
      }
    }

    // ---- stabs
    const sp = this.pat(def.stab, sec.stab, bar);
    if (sp && this.on('stab', t)) {
      const c = sp[abs % sp.length];
      if (c === 'X' || c === 'x') {
        const len = this.tie(sp, abs % sp.length);
        const notes = voicing(chordPcs(def, ch), def.stabLow, null);
        const dur = len > 1 ? len * sd : sd * 1.2;
        this.stab(tt, notes, dur, c === 'X' ? 1 : 0.8);
        this.emit(tt, 'stab', 'chord', notes, dur);
      }
    }

    // ---- lead melody
    const mk = pickV(sec.lead, this.pass);
    const mel = mk ? this.mel.get(mk) : undefined;
    if (mel && this.on('lead', t)) {
      const m = abs % mel.len;
      const ev = mel.notes.find((e) => e.step === m);
      if (ev && ev.deg !== null) {
        const n = degMidi(def, ev.deg, def.leadTonic) + ev.alt + 12 * (sec.leadOct ?? 0);
        const dur = ev.len * sd * 0.95;
        this.lead(tt, n, dur, sec.leadInst ?? def.leadInst);
        this.emit(tt, 'lead', 'note', [n], dur);
      }
    }

    // ---- pad
    if (sec.pad && this.on('pad', t)) {
      if (sec.pad === 'pulse') {
        if (step % 2 === 0) {
          const notes = voicing(chordPcs(def, ch), def.padLow, this.prevPad);
          this.prevPad = notes;
          this.pad(t, notes, sd * 1.6, 0.8, 'pulse');
          if (startsHere) this.emit(t, 'pad', 'chord', notes, sd * 1.6);
        }
      } else if (startsHere || (bar === 0 && step === 0)) {
        const notes = voicing(chordPcs(def, ch), def.padLow, this.prevPad);
        this.prevPad = notes;
        const dur = beatsLeft * sd * 4;
        this.pad(t, notes, dur, 1, sec.pad);
        this.emit(t, 'pad', 'chord', notes, dur);
      }
    }
  }

  private tie(p: string, i: number): number {
    let n = 1;
    while (n < 64 && p[(i + n) % p.length] === '-') n++;
    return n;
  }

  private stepOf(c: string): number {
    if (c >= '2' && c <= '7') return +c - 1;
    if (c === 'b') return -1;
    if (c === 'a') return -2;
    if (c === 'f') return 4;
    if (c === '3') return 2;
    return 0;
  }

  private powerFifth(ch: Chord, off: number): number {
    // diatonic fifth above the (possibly shifted) root
    const d = ch.deg + off;
    const f = degMidi(this.def, d + 4) - degMidi(this.def, d);
    return f;
  }

  /** Resolve a bass/guitar pattern char to a MIDI note (null = no onset). */
  private noteFor(c: string, ch: Chord, next: Chord, low: number): number | null {
    if (c === '.' || c === '-' || c === undefined) return null;
    const def = this.def;
    const root = place(pc(degMidi(def, ch.deg)), low);
    switch (c) {
      case 'R': case 'r': case 'X': case 'x': case 'm':
        return root;
      case 'o': case 'O':
        return root + 12;
      case 'n':
        return place(pc(degMidi(def, next.deg)), low);
      default: {
        const k = this.stepOf(c);
        if (k === 2) return root + chordInterval(def, ch, 2);
        return root + (degMidi(def, ch.deg + k) - degMidi(def, ch.deg));
      }
    }
  }

  // ---------------------------------------------------------------- instruments
  private env(g: AudioParam, t: number, a: number, peak: number, end: number, rel: number) {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    if (end > t + a) g.setValueAtTime(peak, end);
    g.setTargetAtTime(0, Math.max(end, t + a), rel / 3);
  }

  private osc(type: OscillatorType, f: number, t: number, stop: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.start(t);
    o.stop(stop);
    return o;
  }

  drum(name: DrumName, t: number, vel: number, rate = 1) {
    const kit = this.sh.kit();
    const buf = kit?.[name];
    const ch = this.drumCh.get(name);
    if (!buf || !ch || !this.on(DRUM_LAYER[name], t)) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vel;
    s.connect(g);
    g.connect(ch);
    let off = 0;
    if (t < c.currentTime) {
      off = c.currentTime - t;
      t = c.currentTime;
    }
    if (off < buf.duration) s.start(t, off);
    this.emit(t, DRUM_LAYER[name], name, undefined, undefined, vel);
  }

  private pump(t: number, v: number) {
    for (const d of this.duck) {
      d.gain.setTargetAtTime(1 - 0.35 * v, t, 0.004);
      d.gain.setTargetAtTime(1, t + 0.04, 0.09);
    }
  }

  private bass(t: number, midi: number, dur: number, vel: number) {
    const c = this.ctx;
    const st = this.def.bassStyle;
    const f = midiToHz(midi);
    const end = t + dur;
    const rel = st === 'soft' || st === 'sub' ? 0.12 : 0.04;
    const stop = end + rel * 2 + 0.05;
    const br = this.brightness();
    if (st !== 'sub') {
      const flt = c.createBiquadFilter();
      flt.type = 'lowpass';
      const base = (st === 'acid' ? 320 : st === 'soft' ? 450 : 650) * br;
      const peak = base * (st === 'acid' ? (vel > 0.9 ? 11 : 5) : st === 'soft' ? 2 : 4);
      flt.Q.value = st === 'acid' ? 12 : st === 'soft' ? 0.8 : 3;
      flt.frequency.setValueAtTime(peak, t);
      flt.frequency.setTargetAtTime(base, t + 0.003, st === 'acid' ? 0.07 : 0.05);
      const g = c.createGain();
      this.env(g.gain, t, 0.004, vel * (st === 'acid' ? 0.36 : st === 'soft' ? 0.2 : 0.4), end, rel);
      if (st === 'acid') this.osc('sawtooth', f, t, stop).connect(flt);
      else if (st === 'soft') {
        this.osc('triangle', f, t, stop).connect(flt);
        this.osc('sawtooth', f, t, stop, 5).connect(flt);
      } else {
        this.osc('sawtooth', f, t, stop, -7).connect(flt);
        this.osc('sawtooth', f, t, stop, 7).connect(flt);
      }
      flt.connect(g);
      g.connect(this.bassIn);
    }
    const sg = c.createGain();
    this.env(sg.gain, t, 0.005, vel * (st === 'sub' ? 0.32 : st === 'soft' ? 0.22 : 0.45), end, rel + 0.02);
    this.osc('sine', f < 70 ? f : f / 2, t, stop).connect(sg);
    sg.connect(this.subIn);
  }

  private gtr(t: number, root: number, fifth: number, dur: number, vel: number, muted: boolean) {
    const c = this.ctx;
    const end = t + dur;
    const rel = muted ? 0.03 : 0.09;
    const stop = end + rel * 3 + 0.02;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = (muted ? 1100 : 4500) * (0.8 + 0.2 * this.brightness());
    flt.Q.value = 0.8;
    const g = c.createGain();
    this.env(g.gain, t, 0.003, vel * 0.33, end, rel);
    for (const m of [root, root + fifth, root + 12]) {
      const f = midiToHz(m);
      for (const d of [-9, 9]) this.osc('sawtooth', f, t, stop, d + this.rng.bi() * 3).connect(flt);
    }
    flt.connect(g);
    g.connect(this.layerIn.gtr);
  }

  private lead(t: number, midi: number, dur: number, inst: LeadInst) {
    const c = this.ctx;
    const f = midiToHz(midi);
    const end = t + dur;
    const out = this.layerIn.lead;
    if (inst === 'bell') {
      const stop = t + Math.max(dur, 0.2) + 2.5;
      const car = this.osc('sine', f, t, stop);
      const mod = this.osc('sine', f * 3.5, t, stop);
      const mg = c.createGain();
      mg.gain.setValueAtTime(f * 3.5 * 2.2, t);
      mg.gain.setTargetAtTime(f * 3.5 * 0.15, t, 0.25);
      mod.connect(mg);
      mg.connect(car.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.003, 0.7);
      car.connect(g);
      const o2 = this.osc('sine', f * 2, t, stop);
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.2, t + 0.003);
      g2.gain.setTargetAtTime(0, t + 0.003, 0.35);
      o2.connect(g2);
      g2.connect(out);
      g.connect(out);
      return;
    }
    const rel = inst === 'brass' ? 0.2 : 0.14;
    const stop = end + rel * 3 + 0.05;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    const g = c.createGain();
    const vib = c.createGain();
    vib.gain.setValueAtTime(0, t);
    if (dur > 0.25) {
      vib.gain.setValueAtTime(0, t + 0.18);
      vib.gain.linearRampToValueAtTime(14, t + 0.45);
    }
    this.leadLfo.connect(vib);
    const oscs: OscillatorNode[] = [];
    if (inst === 'saw') {
      flt.Q.value = 2;
      flt.frequency.setValueAtTime(1400, t);
      flt.frequency.linearRampToValueAtTime(4200, t + 0.02);
      flt.frequency.setTargetAtTime(2400, t + 0.02, 0.15);
      oscs.push(this.osc('sawtooth', f, t, stop, -8), this.osc('sawtooth', f, t, stop, 8));
      const sq = this.osc('square', f / 2, t, stop);
      const sg = c.createGain();
      sg.gain.value = 0.25;
      sq.connect(sg);
      sg.connect(flt);
      oscs.push(sq);
      this.env(g.gain, t, 0.008, 0.3, end, rel);
    } else if (inst === 'square') {
      flt.Q.value = 3;
      flt.frequency.setValueAtTime(900, t);
      flt.frequency.linearRampToValueAtTime(3800, t + 0.015);
      flt.frequency.setTargetAtTime(1800, t + 0.015, 0.1);
      oscs.push(this.osc('square', f, t, stop, -5), this.osc('square', f, t, stop, 5));
      this.env(g.gain, t, 0.005, 0.26, end, rel);
    } else {
      // brass
      flt.Q.value = 1.2;
      flt.frequency.setValueAtTime(350, t);
      flt.frequency.linearRampToValueAtTime(2800, t + 0.07);
      flt.frequency.setTargetAtTime(1700, t + 0.07, 0.25);
      oscs.push(this.osc('sawtooth', f, t, stop, -9), this.osc('sawtooth', f, t, stop, 0), this.osc('sawtooth', f, t, stop, 9));
      this.env(g.gain, t, 0.035, 0.26, end, rel);
    }
    for (const o of oscs) {
      if (o.type !== 'square' || inst === 'square') o.connect(flt);
      vib.connect(o.detune);
    }
    flt.connect(g);
    g.connect(out);
  }

  private arp(t: number, midi: number, dur: number, vel: number) {
    const c = this.ctx;
    const f = midiToHz(midi);
    const stop = t + dur + 0.4;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 4;
    const br = this.brightness();
    flt.frequency.setValueAtTime(4200 * br, t);
    flt.frequency.setTargetAtTime(700 * br, t, 0.06);
    const g = c.createGain();
    const w = this.def.arpWave === 'triangle' ? 1.8 : this.def.arpWave === 'sine' ? 2 : 1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3 * vel * w, t + 0.002);
    g.gain.setTargetAtTime(0.12 * vel * w, t + 0.002, 0.08);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    this.osc(this.def.arpWave, f, t, stop).connect(flt);
    flt.connect(g);
    g.connect(this.layerIn.arp);
  }

  private stab(t: number, notes: number[], dur: number, vel: number) {
    const c = this.ctx;
    const stop = t + dur + 0.4;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 2;
    flt.frequency.setValueAtTime(5500, t);
    flt.frequency.setTargetAtTime(900, t + 0.01, 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.1 * vel, t + 0.004, 0.1);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    for (const m of notes) for (const d of [-8, 8]) this.osc('sawtooth', midiToHz(m), t, stop, d).connect(flt);
    flt.connect(g);
    g.connect(this.layerIn.stab);
  }

  private pad(t: number, notes: number[], dur: number, vel: number, mode: 'sus' | 'choir' | 'pulse') {
    const c = this.ctx;
    const pulse = mode === 'pulse';
    const choir = mode === 'choir';
    const a = pulse ? 0.006 : choir ? 0.35 : 0.5;
    const rel = pulse ? 0.12 : 1.4;
    const end = t + dur;
    const stop = end + rel * 2.5;
    const g = c.createGain();
    if (pulse) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * vel, t + a);
      g.gain.setTargetAtTime(0.05 * vel, t + a, 0.08);
      g.gain.setTargetAtTime(0, end, rel / 3);
    } else this.env(g.gain, t, a, (choir ? 0.18 : 0.12) * vel, end, rel);
    g.connect(choir ? this.choirIn : this.layerIn.pad);
    for (const m of notes) {
      const f = midiToHz(m);
      const dets = choir ? [-12, 0, 12] : [-10, 10];
      for (const d of dets) {
        const o = this.osc('sawtooth', f, t, stop, d);
        if (choir) this.choirLfo.connect(o.detune);
        o.connect(g);
      }
    }
    if (!choir && !pulse) {
      // soft octave shimmer
      const o = this.osc('triangle', midiToHz(notes[notes.length - 1] + 12), t, stop);
      const sg = c.createGain();
      sg.gain.value = 0.25;
      o.connect(sg);
      sg.connect(g);
    }
  }

  private drone(t: number, dur: number) {
    const c = this.ctx;
    const f = midiToHz(place(pc(this.def.tonic), 33));
    const end = t + dur;
    const stop = end + 3;
    const g = c.createGain();
    this.env(g.gain, t, 1.5, 0.09, end, 2);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 380;
    this.osc('sawtooth', f, t, stop, -4).connect(flt);
    this.osc('sawtooth', f * 2, t, stop, 5).connect(flt);
    const s = this.osc('sine', f, t, stop);
    s.connect(g);
    flt.connect(g);
    g.connect(this.layerIn.fx);
    this.emit(t, 'fx', 'drone', [place(pc(this.def.tonic), 33)], dur);
  }

  private riser(t: number, dur: number) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.sh.noise;
    s.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.98);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    s.connect(bp);
    bp.connect(g);
    g.connect(this.layerIn.fx);
    s.start(t);
    s.stop(t + dur + 0.05);
    this.emit(t, 'fx', 'riser', undefined, dur);
  }

  fadeOut(sec: number) {
    if (this.stopping) return;
    this.stopping = true;
    const now = this.ctx.currentTime;
    for (const g of [this.out, this.revOut]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.setTargetAtTime(0.0001, now, Math.max(0.05, sec / 4));
    }
    this.done = true;
    this.disposeAt = Math.min(this.disposeAt, now + sec + 3);
  }

  dispose() {
    for (const p of this.persistent) {
      try {
        p.stop();
      } catch {
        /* already stopped */
      }
    }
    try {
      this.out.disconnect();
      this.revOut.disconnect();
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ engine

export class MusicEngine {
  private players: Player[] = [];
  private sh: Shared;
  private current: Player | null = null;
  readonly output: GainNode;
  logEvents = false;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, kit: () => Partial<Record<DrumName, AudioBuffer>> | null) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.6;
    this.output.connect(dest);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    conv.connect(revGain);
    revGain.connect(this.output);
    // gentle glue compression for the music bus
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.2;
    glue.knee.value = 8;
    const pre = ctx.createGain();
    pre.connect(glue);
    glue.connect(this.output);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    const r = new Rng(99);
    for (let i = 0; i < d.length; i++) d[i] = r.bi();
    this.sh = { ctx, kit, noise: nb, reverbIn: conv, out: pre, intensity: 0.5, solo: null };
  }

  get track(): MusicTrack | null {
    return this.current && !this.current.stopping ? this.current.track : null;
  }

  get currentPlayer(): Player | null {
    return this.current;
  }

  play(track: MusicTrack, fadeIn = 1.5, crossfade = 2.5) {
    if (!TRACKS[track]) return;
    if (this.current && this.current.track === track && !this.current.stopping && !(this.current.done && this.current.endTime < Infinity)) return;
    const hadPrev = !!this.current && !this.current.stopping;
    if (this.current) this.current.fadeOut(crossfade);
    const start = this.ctx.currentTime + 0.08;
    const p = new Player(this.sh, track, start, hadPrev ? fadeIn : Math.min(fadeIn, 0.3));
    if (this.logEvents) p.log = [];
    this.players.push(p);
    this.current = p;
  }

  stop(fade = 2) {
    if (this.current) this.current.fadeOut(fade);
    this.current = null;
  }

  setIntensity(v: number) {
    const x = Math.min(1, Math.max(0, isFinite(v) ? v : 0.5));
    if (Math.abs(x - this.sh.intensity) < 0.01) return;
    this.sh.intensity = x;
    for (const p of this.players) if (!p.stopping) p.applyIntensity();
  }

  get intensity() {
    return this.sh.intensity;
  }

  /** Test helper: hear only one layer. */
  setSolo(l: Layer | null) {
    this.sh.solo = l;
    for (const p of this.players) p.applyIntensity(true);
  }

  /** Schedule notes up to `until` (context time). Call periodically (realtime) or once (offline). */
  tick(until: number) {
    const now = this.ctx.currentTime;
    for (const p of this.players) {
      if (!p.done && p.nextTime < now - 0.2) {
        // fell far behind (tab was throttled): resync grid to now
        const lag = Math.ceil((now - p.nextTime) / p.stepDur);
        for (let i = 0; i < lag && !p.done; i++) p.advance();
      }
      p.schedule(until);
    }
    const alive: Player[] = [];
    for (const p of this.players) {
      if (now > p.disposeAt) {
        p.dispose();
        if (this.current === p) this.current = null;
      } else alive.push(p);
    }
    this.players = alive;
  }
}
