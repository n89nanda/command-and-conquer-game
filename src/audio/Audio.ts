/**
 * RIFTFALL audio engine (singleton `audio`).
 *
 *  - SFX: every SoundId is synthesised offline (sfx.ts) into AudioBuffers, rendered in a
 *    Web Worker right after unlock (main-thread fallback), then played with pitch jitter,
 *    distance attenuation / panning, per-id + global voice limits.
 *  - Music: procedural sequencer (music.ts / musicTracks.ts) with intensity layers + crossfades.
 *  - Voice: Web Speech API announcer / unit acknowledgements (voice.ts) with radio chirps.
 *
 * Every public method is safe to call at any time (before unlock they are no-ops or queued)
 * and never throws.
 */
import type { SoundId } from '../data/types';
import type { AudioEngineApi, MusicTrack, PlayOpts, VoiceKind } from './AudioTypes';
import { SFX_META, ALL_SOUNDS, renderSfx, sfxDuration, SfxMeta } from './sfx';
import { DRUMS, DrumName, renderDrum } from './drumkit';
import { MusicEngine } from './music';
import { VoiceManager, Faction } from './voice';
import { Rng, tone, noise, filter, mix, alloc, expEnv, adEnv, ahrEnv, glide, Stereo } from './dsp';
import SfxWorker from './sfx.worker?worker&inline';

type Volumes = { master: number; sfx: number; music: number; voice: number };
const DEFAULT_VOLUMES: Volumes = { master: 0.8, sfx: 0.8, music: 0.55, voice: 0.9 };
const LS_KEY = 'riftfall.volumes';

/** Global cap on simultaneous SFX voices. */
const MAX_VOICES = 32;
/** Sounds that carry further (distance scaled down). */
const BIG = new Set<SoundId>(['explosionLarge', 'buildingCollapse', 'nukeImpact', 'nukeLaunch', 'ionStrike', 'ionCharge', 'artillery', 'obelisk']);

/** Render priority right after unlock: UI + common combat first. */
const PRIORITY: SoundId[] = [
  'click', 'select', 'uiHover', 'error', 'cancel', 'placeBuilding', 'sell', 'moneyTick', 'buildComplete', 'unitReady', 'briefingType',
  'rifle', 'mg', 'cannon', 'rocket', 'explosionSmall', 'explosionMedium', 'infantryDie', 'missile', 'heavyCannon', 'laser', 'flame',
  'railgun', 'artillery', 'explosionLarge', 'crush', 'obelisk', 'harvest', 'repair', 'rotor', 'powerDown', 'radarOn', 'buildingCollapse',
];

interface ActiveVoice {
  id: SoundId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  out: AudioNode;
  start: number;
  end: number;
  vol: number;
  prio: number;
  dead: boolean;
}

interface Job {
  key: string;
  kind: 'sfx' | 'drum';
  id: string;
  variant: number;
  sr: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

class AudioEngine implements AudioEngineApi {
  private ctx: AudioContext | null = null;
  private vols: Volumes = { ...DEFAULT_VOLUMES };
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private music: MusicEngine | null = null;
  private timer = 0;
  private listener = { x: 0, z: 0, r: 20 };
  private buffers = new Map<string, AudioBuffer>();
  private kit: Partial<Record<DrumName, AudioBuffer>> = {};
  private requested = new Set<string>();
  private outstanding = new Map<string, Job>();
  private worker: Worker | null = null;
  private fallback: Job[] = [];
  private fallbackTimer = 0;
  private active: ActiveVoice[] = [];
  private lastStart = new Map<SoundId, number>();
  private wantMusic: MusicTrack | null = null;
  private intensity = 0.5;
  private chirps: Partial<Record<Faction, AudioBuffer>> = {};
  private failed = false;
  readonly voice: VoiceManager;

  constructor() {
    this.vols = this.loadVolumes();
    this.voice = new VoiceManager({
      chirp: (f) => this.chirp(f),
      duck: (on) => this.duck(on),
      volume: () => this.vols.master * this.vols.voice,
      now: () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000),
    });
    // Auto-unlock on the first user gesture as a safety net (the game should still call unlock()).
    try {
      if (typeof window !== 'undefined') {
        const h = () => this.unlock();
        for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, h, { capture: true, passive: true });
      }
    } catch {
      /* ignore */
    }
  }

  // ================================================================== lifecycle

  unlock(): void {
    try {
      if (this.failed) return;
      if (!this.ctx) this.init();
      const c = this.ctx;
      if (!c) return;
      if (c.state !== 'running') c.resume().catch(() => undefined);
      this.voice.unlock();
    } catch {
      /* never throw */
    }
  }

  private init() {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) {
      this.failed = true;
      return;
    }
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      c = new AC();
    }
    this.ctx = c;
    const master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    const post = c.createGain();
    post.gain.value = 0.92;
    master.connect(comp);
    comp.connect(lim);
    lim.connect(post);
    post.connect(c.destination);
    this.master = master;
    this.sfxBus = c.createGain();
    this.sfxBus.connect(master);
    this.musicBus = c.createGain();
    this.musicDuck = c.createGain();
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(master);
    this.voiceBus = c.createGain();
    this.voiceBus.connect(master);
    this.applyVolumes(true);

    this.music = new MusicEngine(c, this.musicBus, () => this.kit);
    this.music.setIntensity(this.intensity);

    try {
      this.chirps.aegis = this.toBuffer(renderChirp(c.sampleRate, 'aegis')) ?? undefined;
      this.chirps.covenant = this.toBuffer(renderChirp(c.sampleRate, 'covenant')) ?? undefined;
    } catch {
      /* ignore */
    }

    this.startRendering();
    this.timer = setInterval(() => this.tick(), 50) as unknown as number;
    if (this.wantMusic) this.music.play(this.wantMusic, 1.5);
  }

  private tick() {
    try {
      const c = this.ctx;
      if (!c || !this.music) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      this.music.tick(c.currentTime + (hidden ? 1.5 : 0.3));
      if (this.active.length > 48) this.prune(c.currentTime);
    } catch {
      /* ignore */
    }
  }

  // ================================================================== rendering

  private startRendering() {
    const c = this.ctx!;
    const sr = c.sampleRate;
    const jobs: Job[] = [];
    for (const d of DRUMS) jobs.push({ key: `drum:${d}`, kind: 'drum', id: d, variant: 0, sr });
    const order = [...PRIORITY, ...ALL_SOUNDS.filter((s) => !PRIORITY.includes(s))];
    for (const id of order) jobs.push({ key: `sfx:${id}:0`, kind: 'sfx', id, variant: 0, sr });
    for (const id of order) for (let v = 1; v < SFX_META[id].variants; v++) jobs.push({ key: `sfx:${id}:${v}`, kind: 'sfx', id, variant: v, sr });
    for (const j of jobs) {
      this.requested.add(j.key);
      this.outstanding.set(j.key, j);
    }
    try {
      const wk = new SfxWorker();
      wk.onmessage = (e: MessageEvent<{ key: string; L?: Float32Array; R?: Float32Array; error?: string }>) => {
        const d = e.data;
        this.outstanding.delete(d.key);
        if (d.L) this.store(d.key, [d.L, d.R ?? d.L]);
        else if (d.error) this.fallbackRender(this.parseKey(d.key));
      };
      wk.onerror = () => this.workerFailed();
      wk.postMessage(jobs);
      this.worker = wk;
    } catch {
      this.workerFailed();
    }
  }

  private parseKey(key: string): Job {
    const [kind, id, v] = key.split(':');
    return { key, kind: kind as 'sfx' | 'drum', id, variant: +(v ?? 0), sr: this.ctx!.sampleRate };
  }

  private workerFailed() {
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    for (const j of this.outstanding.values()) this.fallbackRender(j);
    this.outstanding.clear();
  }

  private fallbackRender(j: Job) {
    this.fallback.push(j);
    if (this.fallbackTimer) return;
    const step = () => {
      const job = this.fallback.shift();
      if (!job) {
        this.fallbackTimer = 0;
        return;
      }
      if (!this.hasKey(job.key)) this.renderNow(job);
      this.fallbackTimer = setTimeout(step, 20) as unknown as number;
    };
    this.fallbackTimer = setTimeout(step, 20) as unknown as number;
  }

  private hasKey(key: string): boolean {
    if (key.startsWith('drum:')) return !!this.kit[key.slice(5) as DrumName];
    return this.buffers.has(key.slice(4));
  }

  private renderNow(j: Job) {
    try {
      const st = j.kind === 'sfx' ? renderSfx(j.id as SoundId, j.sr, j.variant) : renderDrum(j.id as DrumName, j.sr);
      this.store(j.key, st);
    } catch {
      /* ignore */
    }
  }

  private store(key: string, st: Stereo) {
    if (this.hasKey(key)) return;
    const buf = this.toBuffer(st);
    if (!buf) return;
    if (key.startsWith('drum:')) this.kit[key.slice(5) as DrumName] = buf;
    else this.buffers.set(key.slice(4), buf);
  }

  private toBuffer(st: Stereo): AudioBuffer | null {
    const c = this.ctx;
    if (!c || !st[0].length) return null;
    const mono = st[0] === st[1];
    const b = c.createBuffer(mono ? 1 : 2, st[0].length, c.sampleRate);
    b.getChannelData(0).set(st[0]);
    if (!mono) b.getChannelData(1).set(st[1]);
    return b;
  }

  private pickBuffer(id: SoundId, meta: SfxMeta): AudioBuffer | null {
    const ready: AudioBuffer[] = [];
    for (let v = 0; v < meta.variants; v++) {
      const b = this.buffers.get(`${id}:${v}`);
      if (b) ready.push(b);
    }
    if (ready.length) return ready[Math.floor(Math.random() * ready.length)];
    // not rendered yet: cheap sounds are rendered synchronously, expensive ones are skipped this time
    if (sfxDuration(id) <= 1.0 && this.ctx) {
      this.renderNow({ key: `sfx:${id}:0`, kind: 'sfx', id, variant: 0, sr: this.ctx.sampleRate });
      return this.buffers.get(`${id}:0`) ?? null;
    }
    if (!this.worker) this.fallbackRender({ key: `sfx:${id}:0`, kind: 'sfx', id, variant: 0, sr: this.ctx!.sampleRate });
    return null;
  }

  // ================================================================== SFX

  play(id: SoundId, opts?: PlayOpts): void {
    try {
      const c = this.ctx;
      if (!c || c.state !== 'running' || !this.sfxBus) return;
      const meta = SFX_META[id];
      if (!meta) return;
      const o = opts ?? {};
      const now = c.currentTime;
      let vol = meta.vol * clamp(num(o.volume, 1), 0, 2);
      let pan = 0;
      let lp = 0;
      if (!meta.ui && typeof o.x === 'number' && typeof o.z === 'number' && isFinite(o.x) && isFinite(o.z)) {
        const sp = this.spatial(id, o.x, o.z);
        if (!sp) return;
        vol *= sp.g;
        pan = sp.pan;
        lp = sp.lp;
      }
      if (vol < 0.005) return;
      const last = this.lastStart.get(id);
      if (last !== undefined && now - last < meta.minGap) return;
      const buf = this.pickBuffer(id, meta);
      if (!buf) return;
      if (!this.makeRoom(id, meta, vol, now)) return;
      this.lastStart.set(id, now);

      const src = c.createBufferSource();
      src.buffer = buf;
      const rate = clamp(num(o.rate, 1), 0.25, 4) * (1 + (Math.random() * 2 - 1) * meta.pitchVar);
      src.playbackRate.value = rate;
      const g = c.createGain();
      g.gain.value = vol;
      let node: AudioNode = src;
      if (lp > 0) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lp;
        node.connect(f);
        node = f;
      }
      node.connect(g);
      let out: AudioNode = g;
      if (pan !== 0 && typeof c.createStereoPanner === 'function') {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        out = p;
      }
      out.connect(this.sfxBus);
      src.start(now);
      const v: ActiveVoice = { id, src, gain: g, out, start: now, end: now + buf.duration / rate, vol, prio: meta.prio, dead: false };
      src.onended = () => {
        v.dead = true;
        try {
          out.disconnect();
        } catch {
          /* ignore */
        }
      };
      this.active.push(v);
    } catch {
      /* never throw */
    }
  }

  private spatial(id: SoundId, x: number, z: number): { g: number; pan: number; lp: number } | null {
    const { x: lx, z: lz, r } = this.listener;
    const R = Math.max(4, r);
    const dx = x - lx;
    const dz = z - lz;
    const n = (Math.hypot(dx, dz) / R) * (BIG.has(id) ? 0.55 : 1);
    if (n > 3.2) return null;
    const g = n <= 0.75 ? 1 : 1 / (1 + ((n - 0.75) * 2.2) ** 2);
    const pan = clamp(dx / (R * 1.1), -1, 1) * 0.8;
    const lp = n > 1 ? Math.max(1200, 20000 / (1 + (n - 1) * 3.5)) : 0;
    return { g, pan, lp };
  }

  /** Current loudness estimate of a playing voice (decays over its length). */
  private loud(v: ActiveVoice, now: number): number {
    const len = Math.max(0.05, v.end - v.start);
    return v.vol * Math.exp((-3 * (now - v.start)) / len);
  }

  private prune(now: number) {
    this.active = this.active.filter((v) => !v.dead && v.end > now);
  }

  private makeRoom(id: SoundId, meta: SfxMeta, vol: number, now: number): boolean {
    this.prune(now);
    const same = this.active.filter((v) => v.id === id);
    if (same.length >= meta.max) {
      let w = same[0];
      for (const v of same) if (this.loud(v, now) < this.loud(w, now)) w = v;
      if (this.loud(w, now) > vol * 1.15) return false;
      this.kill(w, now);
    }
    if (this.active.length >= MAX_VOICES) {
      const score = (v: ActiveVoice) => this.loud(v, now) * (1 + v.prio * 0.2);
      let w = this.active[0];
      for (const v of this.active) if (score(v) < score(w)) w = v;
      if (score(w) > vol * (1 + meta.prio * 0.2)) return false;
      this.kill(w, now);
    }
    return true;
  }

  private kill(v: ActiveVoice, now: number) {
    v.dead = true;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.setTargetAtTime(0, now, 0.012);
      v.src.stop(now + 0.07);
    } catch {
      /* ignore */
    }
    this.active = this.active.filter((a) => a !== v);
  }

  setListener(x: number, z: number, viewRadius: number): void {
    if (isFinite(x)) this.listener.x = x;
    if (isFinite(z)) this.listener.z = z;
    if (isFinite(viewRadius) && viewRadius > 0) this.listener.r = viewRadius;
  }

  // ================================================================== music

  playMusic(track: MusicTrack): void {
    try {
      this.wantMusic = track;
      this.music?.play(track, 1.5, 2.5);
    } catch {
      /* ignore */
    }
  }

  stopMusic(fadeSeconds = 2): void {
    try {
      this.wantMusic = null;
      this.music?.stop(Math.max(0.05, num(fadeSeconds, 2)));
    } catch {
      /* ignore */
    }
  }

  setIntensity(v: number): void {
    try {
      this.intensity = clamp(num(v, 0.5), 0, 1);
      this.music?.setIntensity(this.intensity);
    } catch {
      /* ignore */
    }
  }

  // ================================================================== voice

  speak(text: string, kind: VoiceKind, opts?: { faction?: 'aegis' | 'covenant'; priority?: number }): void {
    try {
      this.voice.speak(text, kind, opts?.faction ?? 'aegis', num(opts?.priority, kind === 'announcer' ? 1 : 0));
    } catch {
      /* ignore */
    }
  }

  private chirp(f: Faction) {
    try {
      const c = this.ctx;
      const b = this.chirps[f];
      if (!c || !b || !this.voiceBus || c.state !== 'running') return;
      const s = c.createBufferSource();
      s.buffer = b;
      const g = c.createGain();
      g.gain.value = 0.35;
      s.connect(g);
      g.connect(this.voiceBus);
      s.start();
    } catch {
      /* ignore */
    }
  }

  private duck(on: boolean) {
    try {
      const c = this.ctx;
      if (!c || !this.musicDuck) return;
      const g = this.musicDuck.gain;
      g.cancelScheduledValues(c.currentTime);
      g.setValueAtTime(g.value, c.currentTime);
      g.setTargetAtTime(on ? 0.55 : 1, c.currentTime, on ? 0.08 : 0.4);
    } catch {
      /* ignore */
    }
  }

  // ================================================================== volumes

  setVolumes(v: { master?: number; sfx?: number; music?: number; voice?: number }): void {
    try {
      for (const k of ['master', 'sfx', 'music', 'voice'] as const) {
        const x = v?.[k];
        if (typeof x === 'number' && isFinite(x)) this.vols[k] = clamp(x, 0, 1);
      }
      this.applyVolumes(false);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.vols));
      } catch {
        /* storage unavailable */
      }
    } catch {
      /* ignore */
    }
  }

  getVolumes(): { master: number; sfx: number; music: number; voice: number } {
    return { ...this.vols };
  }

  private loadVolumes(): Volumes {
    const v = { ...DEFAULT_VOLUMES };
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const o = JSON.parse(raw) as Partial<Volumes>;
        for (const k of ['master', 'sfx', 'music', 'voice'] as const) if (typeof o[k] === 'number' && isFinite(o[k]!)) v[k] = clamp(o[k]!, 0, 1);
      }
    } catch {
      /* ignore */
    }
    return v;
  }

  private applyVolumes(immediate: boolean) {
    const c = this.ctx;
    if (!c || !this.master) return;
    const set = (g: GainNode | null, val: number) => {
      if (!g) return;
      if (immediate) g.gain.setValueAtTime(val, c.currentTime);
      else {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(g.gain.value, c.currentTime);
        g.gain.setTargetAtTime(val, c.currentTime, 0.04);
      }
    };
    // perceptual (squared) taper for sliders
    const taper = (x: number) => x * x;
    set(this.master, taper(this.vols.master) * 1.2);
    set(this.sfxBus, taper(this.vols.sfx) * 1.25);
    set(this.musicBus, taper(this.vols.music) * 1.6);
    set(this.voiceBus, taper(this.vols.voice));
  }

  // ================================================================== debug (audition page)

  debugInfo() {
    const c = this.ctx;
    return {
      state: c?.state ?? 'locked',
      sampleRate: c?.sampleRate ?? 0,
      activeVoices: c ? this.active.filter((v) => !v.dead && v.end > c.currentTime).length : 0,
      sfxBuffers: this.buffers.size,
      drumBuffers: Object.keys(this.kit).length,
      worker: !!this.worker,
      track: this.music?.track ?? null,
      intensity: this.intensity,
      voices: this.voice.describe(),
      speaking: this.voice.speaking,
    };
  }

  get musicEngine(): MusicEngine | null {
    return this.music;
  }
  get context(): AudioContext | null {
    return this.ctx;
  }
}

/** Short radio squelch + two-tone chirp for announcer lines. */
function renderChirp(sr: number, f: Faction): Stereo {
  const r = new Rng(f === 'aegis' ? 5 : 9);
  const out = alloc(sr, 0.2);
  const sq = noise(sr, 0.05, r, 'white', expEnv(0.012));
  filter(sq, sr, 'bandpass', 2200, 0.9);
  mix(out, sq, 0.9, 0, sr);
  if (f === 'aegis') {
    const a = tone(sr, 0.05, 'square', 1760, ahrEnv(0.002, 0.03, 0.006));
    const b = tone(sr, 0.06, 'square', 2349, ahrEnv(0.002, 0.035, 0.008));
    filter(a, sr, 'lowpass', 4000);
    filter(b, sr, 'lowpass', 4000);
    mix(out, a, 0.35, 0.03, sr);
    mix(out, b, 0.35, 0.085, sr);
  } else {
    const a = tone(sr, 0.14, 'sine', glide(1100, 520, 0.12), adEnv(0.003, 0.05), { fmRatio: 1.5, fmIndex: 2 });
    mix(out, a, 0.6, 0.03, sr);
  }
  const tail = noise(sr, 0.03, r, 'white', expEnv(0.006));
  filter(tail, sr, 'bandpass', 3000, 1.2);
  mix(out, tail, 0.5, 0.16, sr);
  filter(out, sr, 'highpass', 300);
  return [out, out.slice()];
}

let instance: AudioEngine;
try {
  instance = new AudioEngine();
} catch {
  instance = Object.create(AudioEngine.prototype) as AudioEngine;
}

export const audio: AudioEngineApi = instance;

/** Extra hooks for tools / debugging (not part of the game contract). */
export const audioDebug = {
  info: () => {
    try {
      return instance.debugInfo();
    } catch {
      return null;
    }
  },
  get music(): MusicEngine | null {
    return instance.musicEngine;
  },
  get ctx(): AudioContext | null {
    return instance.context;
  },
  get voiceHistory() {
    return instance.voice?.history ?? [];
  },
};
