/**
 * Speech (Web Speech API) for the base announcer and unit acknowledgements.
 * Handles async voice loading, per-role voice choice, announcer priority queue,
 * de-duplication and unit-ack throttling. Never throws.
 */
import type { VoiceKind } from './AudioTypes';

export type Faction = 'aegis' | 'covenant';

interface Line {
  text: string;
  kind: VoiceKind;
  faction: Faction;
  prio: number;
  at: number;
}

export interface VoiceHooks {
  /** Radio chirp before an announcer line. */
  chirp(faction: Faction): void;
  /** Called with true when an announcer line starts, false when speech ends. */
  duck(on: boolean): void;
  /** Effective voice volume 0..1 (master * voice). */
  volume(): number;
  now(): number;
}

const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|hysterical|deranged|junior|kathy|ralph|princess|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

const FEMALE = ['Samantha', 'Karen', 'Moira', 'Serena', 'Tessa', 'Victoria', 'Ava', 'Allison', 'Susan', 'Zoe', 'Fiona', 'Kate', 'Google UK English Female', 'Microsoft Libby', 'Microsoft Sonia', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Microsoft Hazel', 'Google US English'];
const COVENANT = ['Serena', 'Tessa', 'Moira', 'Karen', 'Fiona', 'Google UK English Female', 'Microsoft Sonia', 'Microsoft Hazel', 'Victoria', 'Samantha'];
const MALE = ['Daniel', 'Alex', 'Aaron', 'Arthur', 'Oliver', 'Tom', 'Evan', 'Nathan', 'Gordon', 'Lee', 'Rishi', 'Google UK English Male', 'Microsoft Guy', 'Microsoft Ryan', 'Microsoft David', 'Microsoft Mark', 'Microsoft George', 'Fred'];
const FEMALE_HINT = /female|samantha|karen|moira|serena|tessa|victoria|ava|allison|susan|zoe|fiona|kate|zira|hazel|libby|sonia|aria|jenny|nicky|veena/i;

/** pitch, rate per kind (units get extra random variation). */
const PARAMS: Record<VoiceKind, [number, number]> = {
  announcer: [0.92, 0.96],
  infantry: [1.0, 1.12],
  vehicle: [0.85, 1.05],
  heavy: [0.55, 0.86],
  pilot: [1.12, 1.22],
  engineer: [1.15, 1.08],
  zealot: [1.3, 1.32],
};
const UNIT_KINDS: VoiceKind[] = ['infantry', 'vehicle', 'heavy', 'pilot', 'engineer', 'zealot'];

export class VoiceManager {
  private voices: SpeechSynthesisVoice[] = [];
  private chosen = new Map<string, SpeechSynthesisVoice | null>();
  private queue: Line[] = [];
  private current: { line: Line; utter: SpeechSynthesisUtterance | null; watchdog: number } | null = null;
  private recent = new Map<string, number>();
  private lastUnit = -10;
  private unlocked = false;
  private pumpTimer = 0;
  /** For tests: log of what was started. */
  readonly history: { text: string; kind: VoiceKind; voice: string; pitch: number; rate: number; at: number }[] = [];

  constructor(private hooks: VoiceHooks) {
    try {
      const s = this.synth;
      if (!s) return;
      this.loadVoices();
      s.addEventListener?.('voiceschanged', () => this.loadVoices());
      // Safari / some Chrome builds do not fire voiceschanged reliably: poll a few times
      let tries = 0;
      const poll = () => {
        if (this.voices.length || tries++ > 20) return;
        this.loadVoices();
        setTimeout(poll, 250);
      };
      setTimeout(poll, 100);
    } catch {
      /* no speech */
    }
  }

  private get synth(): SpeechSynthesis | null {
    try {
      return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    } catch {
      return null;
    }
  }

  private loadVoices() {
    try {
      const all = this.synth?.getVoices() ?? [];
      const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
      if (en.length !== this.voices.length) this.chosen.clear();
      this.voices = en;
    } catch {
      /* ignore */
    }
  }

  private find(prefs: string[], exclude?: SpeechSynthesisVoice | null, offset = 0): SpeechSynthesisVoice | null {
    const matches: SpeechSynthesisVoice[] = [];
    for (const p of prefs) {
      const cands = this.voices.filter((v) => (v.name === p || v.name.startsWith(p + ' ') || v.name.startsWith(p + '(')) && v !== exclude);
      if (!cands.length) continue;
      // prefer enhanced / premium quality variants, then local voices
      cands.sort((a, b) => score(b) - score(a));
      matches.push(cands[0]);
    }
    if (!matches.length) return null;
    return matches[offset % matches.length];
  }

  private voiceFor(kind: VoiceKind, faction: Faction): SpeechSynthesisVoice | null {
    const key = kind === 'announcer' ? `ann-${faction}` : kind;
    if (this.chosen.has(key)) return this.chosen.get(key)!;
    let v: SpeechSynthesisVoice | null = null;
    if (kind === 'announcer') {
      const aegis = this.find(FEMALE);
      v = faction === 'covenant' ? this.find(COVENANT, aegis) ?? aegis : aegis;
      if (!v) v = this.voices.find((x) => FEMALE_HINT.test(x.name)) ?? null;
    } else {
      v = this.find(MALE, null, UNIT_KINDS.indexOf(kind));
      if (!v) v = this.voices.find((x) => !FEMALE_HINT.test(x.name)) ?? null;
    }
    if (!v) v = this.voices.find((x) => /en[-_]US/i.test(x.lang) && x.localService) ?? this.voices[0] ?? null;
    if (this.voices.length) this.chosen.set(key, v);
    return v;
  }

  get speaking(): boolean {
    return !!this.current;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    // drop stale lines queued before unlock
    const now = this.hooks.now();
    this.queue = this.queue.filter((l) => now - l.at < 6);
    this.pump();
  }

  speak(text: string, kind: VoiceKind, faction: Faction = 'aegis', priority = 1) {
    try {
      if (!text || typeof text !== 'string') return;
      const synth = this.synth;
      if (!synth) return;
      const now = this.hooks.now();
      const line: Line = { text: text.trim(), kind, faction, prio: priority, at: now };
      const radio = kind === 'announcer' || priority >= 3; // announcer + scripted mission dialogue are queued
      const key = `${radio ? 'A' : 'U'}:${line.text.toLowerCase()}`;
      if (radio) {
        const last = this.recent.get(key);
        if (last !== undefined && now - last < 3) return;
        if (this.current?.line.text === line.text || this.queue.some((q) => q.text === line.text)) return;
        this.recent.set(key, now);
        if (this.recent.size > 64) for (const [k, t] of this.recent) if (now - t > 10) this.recent.delete(k);
        if (!this.unlocked) {
          this.enqueue(line);
          return;
        }
        if (this.current) {
          const cur = this.current.line;
          const curIsChatter = cur.kind !== 'announcer' && cur.prio < 3;
          if (curIsChatter || line.prio > cur.prio) {
            // announcer beats unit chatter; higher priority interrupts lower
            this.queue = this.queue.filter((q) => q.prio >= line.prio);
            this.enqueue(line, true);
            this.cancelCurrent();
            return;
          }
        }
        this.enqueue(line);
        this.pump();
      } else {
        if (!this.unlocked) return;
        if (this.current || this.queue.length || this.pumpTimer) return;
        if (now - this.lastUnit < 0.8) return;
        this.lastUnit = now;
        this.start(line);
      }
    } catch {
      /* never throw */
    }
  }

  private enqueue(line: Line, front = false) {
    if (front) this.queue.unshift(line);
    else {
      // insert by priority (stable)
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].prio < line.prio) i--;
      this.queue.splice(i, 0, line);
    }
    while (this.queue.length > 3) {
      // drop the lowest priority, newest-first among equals keeps older context? drop the oldest lowest.
      let worst = 0;
      for (let k = 1; k < this.queue.length; k++) {
        const a = this.queue[k], w = this.queue[worst];
        if (a.prio < w.prio || (a.prio === w.prio && a.at < w.at)) worst = k;
      }
      this.queue.splice(worst, 1);
    }
  }

  private cancelCurrent() {
    const cur = this.current;
    if (!cur) return;
    clearTimeout(cur.watchdog);
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    this.schedulePump(60);
  }

  private schedulePump(ms: number) {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = 0;
      this.pump();
    }, ms) as unknown as number;
  }

  private pump() {
    if (!this.unlocked || this.current || this.pumpTimer) return;
    const next = this.queue.shift();
    if (!next) {
      this.hooks.duck(false);
      return;
    }
    // stale announcer lines are pointless
    if (this.hooks.now() - next.at > 8) {
      this.pump();
      return;
    }
    this.hooks.duck(true);
    this.hooks.chirp(next.faction);
    // reserve the channel while the chirp plays
    this.current = { line: next, utter: null, watchdog: 0 };
    setTimeout(() => {
      if (this.current?.line === next) {
        this.current = null;
        this.start(next);
      }
    }, 150);
  }

  private start(line: Line) {
    const synth = this.synth;
    if (!synth) return;
    try {
      const u = new SpeechSynthesisUtterance(line.text);
      const v = this.voiceFor(line.kind, line.faction);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = 'en-US';
      let [pitch, rate] = PARAMS[line.kind] ?? [1, 1];
      if (line.kind === 'announcer' && line.faction === 'covenant') {
        pitch = 0.72;
        rate = 0.88;
      }
      if (line.kind !== 'announcer') {
        pitch *= 1 + (Math.random() * 2 - 1) * 0.05;
        rate *= 1 + (Math.random() * 2 - 1) * 0.04;
      }
      u.pitch = Math.min(2, Math.max(0.1, pitch));
      u.rate = Math.min(2, Math.max(0.5, rate));
      u.volume = Math.min(1, Math.max(0, this.hooks.volume() * (line.kind === 'announcer' ? 1 : 0.85)));
      if (u.volume <= 0.001) return;
      const done = () => {
        if (this.current?.utter !== u) return;
        clearTimeout(this.current.watchdog);
        this.current = null;
        this.schedulePump(line.kind === 'announcer' ? 180 : 50);
      };
      u.onend = done;
      u.onerror = done;
      const est = (0.6 + line.text.length * 0.075) / u.rate;
      const watchdog = setTimeout(done, est * 2000 + 1500) as unknown as number;
      this.current = { line, utter: u, watchdog };
      if (line.kind !== 'announcer') this.lastUnit = this.hooks.now();
      this.history.push({ text: line.text, kind: line.kind, voice: v?.name ?? '(default)', pitch: u.pitch, rate: u.rate, at: this.hooks.now() });
      if (this.history.length > 50) this.history.shift();
      // Chrome can get stuck in paused state
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch {
      this.current = null;
    }
  }

  /** Voice names chosen per role (for the audition page). */
  describe(): Record<string, string> {
    const out: Record<string, string> = {};
    out['announcer/aegis'] = this.voiceFor('announcer', 'aegis')?.name ?? '(none)';
    out['announcer/covenant'] = this.voiceFor('announcer', 'covenant')?.name ?? '(none)';
    for (const k of UNIT_KINDS) out[k] = this.voiceFor(k, 'aegis')?.name ?? '(none)';
    return out;
  }
}

function score(v: SpeechSynthesisVoice): number {
  let s = 0;
  if (/premium/i.test(v.name)) s += 3;
  if (/enhanced/i.test(v.name)) s += 2;
  if (v.localService) s += 1;
  return s;
}
