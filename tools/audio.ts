/**
 * Audio audition + diagnostics page (dev only): http://localhost:5173/tools/audio.html
 * Also exposes window.__audioLab test hooks used for automated offline analysis.
 */
import { audio, audioDebug } from '../src/audio/Audio';
import type { MusicTrack, VoiceKind } from '../src/audio/AudioTypes';
import type { SoundId } from '../src/data/types';
import { renderSfx, ALL_SOUNDS, SFX_META } from '../src/audio/sfx';
import { MusicEngine, MusicEvent } from '../src/audio/music';
import { renderDrumKit, DrumName } from '../src/audio/drumkit';
import { TRACKS, LAYERS, Layer } from '../src/audio/musicTracks';

const TRACK_IDS: MusicTrack[] = ['menu', 'briefing', 'battle1', 'battle2', 'battle3', 'tension', 'victory', 'defeat'];

// ------------------------------------------------------------------ analysis helpers

export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j + len / 2;
        const vr = re[k] * cr - im[k] * ci;
        const vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr;
        im[k] = im[i + j] - vi;
        re[i + j] += vr;
        im[i + j] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export interface Stats {
  dur: number;
  peakDb: number;
  rmsDb: number;
  centroid: number;
  low: number;
  high: number;
  nan: number;
  silentHead: number;
}

export function stats(ch: Float32Array[], sr: number): Stats {
  let peak = 0, sum = 0, nan = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) {
    const v = c[i];
    if (!isFinite(v)) nan++;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const n = ch[0].length;
  const rms = Math.sqrt(sum / (n * ch.length));
  const c = ch[0];
  const N = 2048;
  let num = 0, den = 0, lo = 0, hi = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s0 = 0; s0 + N <= c.length; s0 += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = c[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const f = (k * sr) / N;
      num += f * p;
      den += p;
      if (f < 200) lo += p;
      if (f > 4000) hi += p;
    }
  }
  let head = 0;
  while (head < n && Math.abs(c[head]) < 0.01) head++;
  return {
    dur: +(n / sr).toFixed(3),
    peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1),
    rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1),
    centroid: Math.round(num / (den || 1)),
    low: +(lo / (den || 1)).toFixed(2),
    high: +(hi / (den || 1)).toFixed(2),
    nan,
    silentHead: +((head / sr) * 1000).toFixed(1),
  };
}

function sfxStats(variant = 0, sr = 48000) {
  const out: Record<string, Stats & { ms: number }> = {};
  for (const id of ALL_SOUNDS) {
    const t0 = performance.now();
    const st = renderSfx(id, sr, variant);
    out[id] = { ...stats(st, sr), ms: Math.round(performance.now() - t0) };
  }
  return out;
}

// ------------------------------------------------------------------ offline music rendering

const kitCache = new Map<number, ReturnType<typeof renderDrumKit>>();

async function renderMusic(track: MusicTrack, seconds: number, intensity = 0.6, solo: Layer | null = null, sr = 44100, changes: [number, number][] = []) {
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  if (!kitCache.has(sr)) kitCache.set(sr, renderDrumKit(sr));
  const raw = kitCache.get(sr)!;
  const kit: Partial<Record<DrumName, AudioBuffer>> = {};
  for (const [k, st] of Object.entries(raw)) {
    const b = ctx.createBuffer(2, st[0].length, sr);
    b.getChannelData(0).set(st[0]);
    b.getChannelData(1).set(st[1]);
    kit[k as DrumName] = b;
  }
  const eng = new MusicEngine(ctx, ctx.destination, () => kit);
  eng.logEvents = true;
  eng.setIntensity(intensity);
  if (solo) eng.setSolo(solo);
  eng.play(track, 0);
  const player = eng.currentPlayer!;
  // emulate the realtime scheduler: suspend every 0.5 s, apply intensity changes, schedule 0.3 s ahead
  const pending = [...changes].sort((x, y) => x[0] - y[0]);
  eng.tick(0.5);
  for (let t = 0.25; t < seconds; t += 0.25) {
    const at = t;
    ctx.suspend(at).then(() => {
      while (pending.length && pending[0][0] <= at + 1e-6) eng.setIntensity(pending.shift()![1]);
      eng.tick(at + 0.5);
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return { buf, events: player.log ?? [], stepDur: player.stepDur };
}

function keyCheck(track: MusicTrack, events: MusicEvent[]) {
  const def = TRACKS[track];
  const allowed = new Set(def.scale.map((s) => s % 12));
  const usesMajorV = def.sections.some((s) => /(^|\s)4M/.test(s.chords)) || Object.values(def.mel ?? {}).some((m) => /6#/.test(m));
  if (usesMajorV) allowed.add(11);
  for (const p of def.extraPcs ?? []) allowed.add(p);
  const bad: string[] = [];
  let notes = 0;
  for (const e of events) {
    if (!e.midi || e.kind === 'drone') continue;
    for (const m of e.midi) {
      notes++;
      const pc = (((m - def.tonic) % 12) + 12) % 12;
      if (!allowed.has(pc)) bad.push(`${e.layer}@${e.section}:${e.bar}.${e.step} midi ${m} (pc ${pc})`);
    }
  }
  return { notes, violations: bad.length, examples: bad.slice(0, 12) };
}

function timingCheck(events: MusicEvent[], stepDur: number, start = 0.08) {
  let maxDev = 0;
  for (const e of events) {
    if (e.kind === 'rcrash') continue;
    const s = (e.t - start) / stepDur;
    const dev = Math.abs(s - Math.round(s)) * stepDur;
    if (dev > maxDev) maxDev = dev;
  }
  return +(maxDev * 1000).toFixed(2);
}

function windowStats(buf: AudioBuffer, win = 1) {
  const sr = buf.sampleRate;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = Math.floor(win * sr);
  const out: { t: number; rmsDb: number; peakDb: number }[] = [];
  for (let s = 0; s + n <= L.length; s += n) {
    let sum = 0, pk = 0;
    for (let i = s; i < s + n; i++) {
      sum += L[i] * L[i] + R[i] * R[i];
      pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    }
    out.push({ t: s / sr, rmsDb: +(10 * Math.log10(sum / (2 * n) + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(pk + 1e-12)).toFixed(1) });
  }
  return out;
}

async function musicReport(track: MusicTrack, seconds = 40, intensity = 0.6) {
  const t0 = performance.now();
  const { buf, events, stepDur } = await renderMusic(track, seconds, intensity);
  const ms = performance.now() - t0;
  const st = stats([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
  const byLayer: Record<string, number> = {};
  const sections: string[] = [];
  for (const e of events) {
    byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
    if (!sections.length || sections[sections.length - 1] !== e.section) sections.push(e.section);
  }
  return { track, renderMs: Math.round(ms), stats: st, key: keyCheck(track, events), timingMaxDevMs: timingCheck(events, stepDur), byLayer, sections, windows: windowStats(buf, 2).map((w) => w.rmsDb) };
}

async function layerLevels(track: MusicTrack, seconds = 30, intensity = 1) {
  const out: Record<string, { rmsDb: number; peakDb: number }> = {};
  for (const L of LAYERS) {
    const { buf } = await renderMusic(track, seconds, intensity, L);
    const s = stats([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
    out[L] = { rmsDb: s.rmsDb, peakDb: s.peakDb };
  }
  return out;
}

/** Encode an AudioBuffer to a 16-bit WAV (base64) so a human can download / listen. */
function wav(buf: AudioBuffer): Blob {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    dv.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
    o += 2;
  }
  return new Blob([dv], { type: 'audio/wav' });
}

(window as unknown as Record<string, unknown>).__audioLab = { sfxStats, renderMusic, musicReport, layerLevels, keyCheck, audio, audioDebug, TRACKS, SFX_META };

// ------------------------------------------------------------------ UI

const app = document.getElementById('app')!;
const statusEl = document.getElementById('status')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') e.style.cssText = String(v);
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) e.append(k);
  return e;
}
function panel(title: string, ...kids: (Node | string)[]) {
  const s = el('section', {}, el('h2', { textContent: title }), ...kids);
  app.append(s);
  return s;
}

document.getElementById('unlock')!.onclick = () => audio.unlock();

// SFX
let posX = 0;
const sfxGrid = el('div', { className: 'grid' });
for (const id of ALL_SOUNDS) {
  sfxGrid.append(el('button', { textContent: id, title: SFX_META[id].ui ? 'UI (non-positional)' : 'positional', onclick: () => { audio.unlock(); audio.play(id, SFX_META[id].ui ? {} : { x: posX, z: 0 }); } }));
}
const posSlider = el('input', { type: 'range', min: '-60', max: '60', value: '0', oninput: () => { posX = +posSlider.value; posLabel.textContent = `x = ${posX} tiles (view radius 20)`; } });
const posLabel = el('span', { className: 'hint', textContent: 'x = 0 tiles (view radius 20)' });
const barrage = el('button', {
  textContent: 'Barrage test (60 sounds / 2s)',
  onclick: () => {
    audio.unlock();
    const ids: SoundId[] = ['mg', 'rifle', 'cannon', 'rocket', 'explosionSmall', 'explosionMedium', 'missile', 'heavyCannon', 'infantryDie', 'laser'];
    for (let i = 0; i < 60; i++) setTimeout(() => audio.play(ids[i % ids.length], { x: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 20 }), i * 33);
  },
});
panel('Sound effects', el('p', { className: 'hint', textContent: 'Positional sounds play at the x offset below (listener at 0,0 with viewRadius 20).' }), sfxGrid, el('label', {}, el('span', { textContent: 'Position' }), posSlider), posLabel, el('div', { className: 'grid', style: 'margin-top:8px' }, barrage));
audio.setListener(0, 0, 20);

// Music
const musicGrid = el('div', { className: 'grid' });
const trackBtns = new Map<MusicTrack, HTMLButtonElement>();
for (const t of TRACK_IDS) {
  const b = el('button', { textContent: `${t} · ${TRACKS[t].title}`, onclick: () => { audio.unlock(); audio.playMusic(t); } });
  trackBtns.set(t, b);
  musicGrid.append(b);
}
musicGrid.append(el('button', { textContent: 'Stop', onclick: () => audio.stopMusic(2) }));
const intSlider = el('input', { type: 'range', min: '0', max: '100', value: '50', oninput: () => { audio.setIntensity(+intSlider.value / 100); intLabel.textContent = (+intSlider.value / 100).toFixed(2); } });
const intLabel = el('span', { className: 'hint', textContent: '0.50' });
const soloSel = el('select', { onchange: () => audioDebug.music?.setSolo((soloSel.value || null) as Layer | null) });
soloSel.append(el('option', { value: '', textContent: 'all layers' }));
for (const L of LAYERS) soloSel.append(el('option', { value: L, textContent: `solo ${L}` }));
const nowPlaying = el('pre', { textContent: '-' });
const wavBtn = el('button', {
  textContent: 'Download 30s WAV of selected track',
  onclick: async () => {
    const t = (audioDebug.music?.track ?? 'battle1') as MusicTrack;
    const { buf } = await renderMusic(t, 30, +intSlider.value / 100);
    const a = el('a', { href: URL.createObjectURL(wav(buf)), download: `riftfall-${t}.wav` });
    a.click();
  },
});
panel('Music', musicGrid, el('label', {}, el('span', { textContent: 'Intensity' }), intSlider, intLabel), el('label', {}, el('span', { textContent: 'Layers' }), soloSel), el('div', { className: 'grid' }, wavBtn), nowPlaying);

// Voice
const lines: [string, VoiceKind, ('aegis' | 'covenant')?, number?][] = [
  ['Construction complete.', 'announcer'],
  ['Unit ready.', 'announcer'],
  ['Our base is under attack.', 'announcer', 'aegis', 3],
  ['Insufficient funds.', 'announcer'],
  ['Low power.', 'announcer', 'aegis', 2],
  ['Reinforcements have arrived.', 'announcer'],
  ['Building.', 'announcer'],
  ['Unit lost.', 'announcer'],
  ['Ion cannon ready.', 'announcer', 'aegis', 2],
  ['Mission accomplished.', 'announcer', 'aegis', 5],
  ['Construction complete.', 'announcer', 'covenant'],
  ['The faithful are assembled.', 'announcer', 'covenant'],
  ['Our temple is under siege.', 'announcer', 'covenant', 3],
  ['Yes sir!', 'infantry'],
  ['Moving out.', 'vehicle'],
  ['Rolling thunder.', 'heavy'],
  ['Target acquired.', 'pilot'],
  ['On my way.', 'engineer'],
  ['For the Covenant!', 'zealot'],
];
const voiceGrid = el('div', { className: 'grid' });
for (const [text, kind, faction, prio] of lines) {
  voiceGrid.append(el('button', { textContent: `${kind === 'announcer' ? (faction === 'covenant' ? 'SERAPH' : 'ARIA') : kind}: ${text}`, onclick: () => { audio.unlock(); audio.speak(text, kind, { faction, priority: prio }); } }));
}
voiceGrid.append(el('button', {
  textContent: 'Spam test (queue/dedupe)',
  onclick: () => {
    audio.unlock();
    ['Unit ready.', 'Unit ready.', 'Construction complete.', 'Insufficient funds.', 'Unit ready.'].forEach((t) => audio.speak(t, 'announcer'));
    setTimeout(() => audio.speak('Our base is under attack.', 'announcer', { priority: 3 }), 400);
  },
}));
const voiceInfo = el('pre', { textContent: '-' });
panel('Voice', voiceGrid, voiceInfo);

// Volumes
const volPanel = panel('Volumes (persisted to localStorage "riftfall.volumes")');
for (const k of ['master', 'sfx', 'music', 'voice'] as const) {
  const s = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(audio.getVolumes()[k] * 100)), oninput: () => audio.setVolumes({ [k]: +s.value / 100 }) });
  volPanel.append(el('label', {}, el('span', { textContent: k }), s));
}

// Analysis
const anaOut = el('div');
panel('Diagnostics', el('div', { className: 'grid' },
  el('button', {
    textContent: 'Analyze all SFX',
    onclick: () => {
      const s = sfxStats();
      const rows = Object.entries(s).map(([k, v]) => `<tr><td>${k}</td><td>${v.dur}</td><td>${v.peakDb}</td><td>${v.rmsDb}</td><td>${v.centroid}</td><td>${v.ms}</td></tr>`).join('');
      anaOut.innerHTML = `<table><tr><th>id</th><th>dur s</th><th>peak dB</th><th>rms dB</th><th>centroid Hz</th><th>render ms</th></tr>${rows}</table>`;
    },
  }),
  el('button', {
    textContent: 'Key/timing check all tracks',
    onclick: async () => {
      anaOut.innerHTML = 'rendering…';
      const rows: string[] = [];
      for (const t of TRACK_IDS) {
        const r = await musicReport(t, 20);
        rows.push(`<tr><td>${t}</td><td>${r.key.notes}</td><td>${r.key.violations}</td><td>${r.timingMaxDevMs}</td><td>${r.stats.peakDb}</td><td>${r.stats.rmsDb}</td></tr>`);
      }
      anaOut.innerHTML = `<table><tr><th>track</th><th>notes</th><th>out of key</th><th>max timing dev ms</th><th>peak dB</th><th>rms dB</th></tr>${rows.join('')}</table>`;
    },
  }),
), anaOut);

setInterval(() => {
  const info = audioDebug.info();
  statusEl.textContent = info ? `${info.state} · ${info.sampleRate} Hz · voices ${info.activeVoices} · sfx buffers ${info.sfxBuffers} · drums ${info.drumBuffers} · worker ${info.worker}` : 'error';
  const p = audioDebug.music?.currentPlayer;
  for (const [t, b] of trackBtns) b.classList.toggle('on', info?.track === t);
  nowPlaying.textContent = p ? `${p.track}  section ${TRACKS[p.track].order[p.secIdx] ?? '-'}  bar ${p.bar + 1}  pass ${p.pass}  intensity ${audioDebug.music?.intensity.toFixed(2)}${p.done ? '  (ended)' : ''}` : '-';
  voiceInfo.textContent = info ? `voices: ${JSON.stringify(info.voices, null, 1)}\nspeaking: ${info.speaking}\nhistory:\n${audioDebug.voiceHistory.slice(-6).map((h) => `  [${h.kind}] "${h.text}" voice=${h.voice} pitch=${h.pitch.toFixed(2)} rate=${h.rate.toFixed(2)}`).join('\n')}` : '';
}, 250);
