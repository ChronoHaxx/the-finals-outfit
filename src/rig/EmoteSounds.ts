// Emote sounds (12 Nov 2026): the game's own sound effects and music for each emote, in time with the animation.
//
// The data (sounds.json, scripts/anim-export/build-emote-sounds.mjs) mirrors props.json: per AnimSequence, the cues its
// sound notifies give. A "window" cue starts its sound at the notify's begin and stops it at its end, fading over
// `fadeOut` (the game's AnimNotifyStatePlaySoundAttachedWithCleanup); a "once" cue starts its sound and lets it ring out.
// A cue's variants are the waves its SoundCue can pick (weighted), with gain and rate (pitch) fixed or a random range. A
// looping variant is a musical emote's MetaSound: the wave loops, positioned by a clock (SyncTime mod its length).
//
// The animation clock is the master; audio follows it. Two mechanisms, for two different jobs:
//   * Scheduling, for attacks. Polling once per frame would start a cue up to a frame late (17 ms at 60 fps, worse on a
//     slow phone) or, starting it "at the right offset", skip its first milliseconds, and a footstep or a clap IS its
//     first milliseconds. Instead, cues that begin within the next LOOKAHEAD seconds are handed to the audio thread now
//     with an exact AudioContext time (source.start(when)), which it honours to the sample. The same goes for the next
//     pass of a looping emote across the wrap.
//   * Reconciliation, for everything else. Each frame asks "what should be sounding at this clip time, and where in its
//     wave?" and makes the voices match: a missing voice starts at its offset (a resume or a shared link: mid-sound, as
//     a video player does) and a voice past its window stops. Because it is a function of the clip time, seeking,
//     pausing and looping cannot double-fire.
// The two clocks can still part: RigAnimator caps a frame's step at 0.1 s, so after a hitch the animation is behind the
// audio. Audio is allowed to lead (restarting would replay what was just heard); only a long or looping voice that is
// more than DRIFT out restarts, at most once a second.
//
// Rules: any user interruption (pause, seek, scrub, step, another emote, close) fades every voice out quickly. The
// animation's own flow follows the game: windows stop at their end, "once" sounds ring out across a loop and after the
// emote ends (also when an inspected emote stops on its last frame). Nothing plays before a user gesture (the browsers'
// autoplay policy): no AudioContext exists until one, and an emote already playing then joins mid-sound. Muted, nothing
// is downloaded and no AudioContext is made. Automated browsers get no sound at all (RigAnimator passes no URL).
//
// Musical emotes in Loop mode (a guess about Embark's code, documented as one): the game passes the MetaSound a SyncTime
// from its AudioSyncGroup so friends play in time. Taken here as "time since the group's current run began", where a run
// lasts while a window of the group is active. A window that covers the whole pass therefore never ends its run: its
// voice carries on across the wrap (the 16 s Disco/CPop tracks keep going over a 7 s dance). A window with a gap before
// the clip ends (the instrument emotes) starts a new run, from the top of the track, each pass, in step with the strumming.

export interface SoundVariant {
  wave: string;
  weight: number;
  gain: number | [number, number];
  rate: number | [number, number];
  loop?: boolean;
}
export interface SoundCue {
  start: number;
  kind: "window" | "once";
  /** Window cues: where the sound is stopped, seconds after `start`. */
  duration?: number;
  /** Window cues: the stop's fade, when the notify stores one (else DEFAULT_FADE_OUT). */
  fadeOut?: number;
  /** A fade-in at the start (the musical MetaSound's ADSR attack). */
  attack?: number;
  syncGroup?: string;
  sound: string;
  variants: SoundVariant[];
}
export interface SoundsManifest {
  formatVersion: 1;
  files: Record<string, { file: string; bytes: number; duration: number; channels: number }>;
  emotes: Record<string, SoundCue[]>;
}
/** The emote clip's clock, as RigAnimator sees it. */
export interface SoundClock { time: number; duration: number; looping: boolean }
export interface SoundSettings { volume: number; muted: boolean }

/** How far ahead cues are handed to the audio thread (covers a frame up to RigAnimator's 0.1 s step cap). */
export const LOOKAHEAD = 0.12;
/** A long or looping voice further than this from the clock's position restarts in place (shorter ones may lead). */
export const DRIFT = 0.25;
/** The notify class's FadeOutDuration default is not in the game files. Cooked assets store only non-default values,
 *  and the stored ones include 0, 0.05, 0.1, 0.3, 0.5, 1, 1.2, 1.5, 2 and 2.5, so it is none of those: a short fade. */
export const DEFAULT_FADE_OUT = 0.25;
const CUT_FADE = 0.05; // a user interruption
const MID_FADE_IN = 0.015; // starting inside a sound (no click)
const DECLICK = 0.01;
const RESTART_AFTER = 0.5, RESTART_EVERY = 1, RESTART_LEFT = 1; // drift restarts: voice age, rate limit, sound left
const AAC_PRIMING = 1024 / 48000; // ffmpeg's AAC encoder delay at the waves' 48 kHz, if a decoder leaves it in
const MAX_DECODED_SECONDS = 150; // decoded audio kept (~55 MB of float PCM at 48 kHz stereo), least recently used out

const SETTINGS_KEY = "finals-outfit.emote-sound";
export const DEFAULT_SETTINGS: SoundSettings = { volume: 0.7, muted: false };
function readSettings(): SoundSettings {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundSettings> | null;
    if (!saved || typeof saved !== "object") return { ...DEFAULT_SETTINGS };
    const volume = typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : DEFAULT_SETTINGS.volume;
    return { volume, muted: saved.muted === true };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(settings: SoundSettings): void {
  try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not remembered */ }
}

const pick = (value: number | [number, number], random: () => number) =>
  Array.isArray(value) ? value[0] + (value[1] - value[0]) * random() : value;

/** A decoded wave and where its real samples are (a decoder that keeps the AAC priming puts them `lead` in). */
interface Wave { buffer: AudioBuffer; lead: number; length: number }

interface Voice {
  key: string;
  index: number;
  cue: SoundCue;
  pass: number;
  wave: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** AudioContext time the voice starts (may be in the future: scheduled) and the wave position it starts at. */
  at: number;
  offset: number;
  rate: number;
  length: number;
  loop: boolean;
  /** A looping voice's run start, in session time (passes x clip length + clip time): its position is measured from it. */
  origin: number;
  /** The gain envelope's last linear segment, kept here: reading AudioParam.value after a cancel is not portable. */
  envelope: [number, number, number, number]; // t0, v0, t1, v1
  restartedAt: number;
}

/** One log line per voice event, for scripted checks (window.__rigAnim.animator.sounds.log). */
export interface SoundLogEntry { event: "start" | "schedule" | "stop" | "restart" | "adopt" | "end"; key: string; wave: string;
  clipTime: number | null; ctxTime: number; at?: number; offset?: number }

type UserActivation = { hasBeenActive: boolean; isActive: boolean };

export class EmoteSounds {
  private manifest: Promise<SoundsManifest | null> | null = null;
  private resolved: SoundsManifest | null = null;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bytes = new Map<string, Promise<ArrayBuffer | null>>(); // by wave: fetched, not yet decoded
  private decoding = new Map<string, Promise<Wave | null>>();
  private waves = new Map<string, Wave>(); // decoded, in least-recently-used order
  private cues: SoundCue[] = [];
  private voices = new Map<string, Voice>(); // live voices of the current emote, by `${cue}:${pass}`
  private released = new Set<Voice>(); // fading out or ringing out: no longer reconciled
  private finished = new Set<string>(); // ended by themselves since the last interruption: not started again
  private picks = new Map<string, { variant: SoundVariant; gain: number; rate: number }>();
  private pass = 0; // loop passes since the emote started (a pause or seek keeps it)
  private lastTime: number | null = null;
  private listeners = new Set<() => void>();
  private unlockInstalled = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsValue: SoundSettings;
  readonly log: SoundLogEntry[] = [];

  constructor(private readonly url: string | null, private readonly options: {
    createContext?: () => AudioContext; fetch?: typeof fetch; random?: () => number;
    /** Tests: no gesture to wait for (the context is created on first use). */ unlocked?: boolean;
  } = {}) {
    this.settingsValue = url ? readSettings() : { ...DEFAULT_SETTINGS };
  }

  /** sounds.json, fetched once (null: this deployment ships no sounds, or this browser plays none). */
  load(): Promise<SoundsManifest | null> {
    if (!this.manifest) {
      const url = this.url, get = this.options.fetch ?? globalThis.fetch?.bind(globalThis);
      this.manifest = url && get
        ? get(url).then(async r => r.ok ? await r.json() as SoundsManifest : null).catch(() => null)
        : Promise.resolve(null);
      void this.manifest.then(m => {
        this.resolved = m?.formatVersion === 1 ? m : null;
        if (this.resolved) this.installUnlock();
        this.emit();
      });
    }
    return this.manifest;
  }

  get settings(): SoundSettings { return this.settingsValue; }
  /** Sound can play now (a gesture has unlocked audio). False before the first click or tap, and while muted. */
  get unlocked(): boolean { return this.context?.state === "running"; }
  /** This deployment ships emote sounds and this browser plays them (false until sounds.json has loaded). */
  get available(): boolean { return !!this.resolved; }
  private get silent(): boolean { return this.settingsValue.muted || this.settingsValue.volume === 0; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void { this.listeners.forEach(listener => listener()); }

  /** The emote animation has sound cues (false until sounds.json has loaded). */
  hasSound(source: string | null | undefined): boolean {
    return !!source && !!this.resolved?.emotes[source]?.length;
  }

  /** The viewer's volume (dragging it also unmutes). Called from a click or drag: it may unlock audio. */
  setVolume(volume: number): void { this.applySettings({ volume: Math.min(1, Math.max(0, volume)), muted: false }); }
  setMuted(muted: boolean): void { this.applySettings({ ...this.settingsValue, muted }); }
  private applySettings(next: SoundSettings): void {
    this.settingsValue = next;
    writeSettings(next);
    // Unmuting is a click: audio may start now and join the emote mid-sound (only where this deployment ships sounds).
    if (!this.silent && this.resolved) this.unlock();
    if (this.master && this.context) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.level(), now, 0.015); // from wherever it is now; no value read needed
    }
    this.emit();
  }
  private level(): number { return this.silent ? 0 : this.settingsValue.volume; }

  // --- The AudioContext: created on a gesture (autoplay policy), resumed after interruptions ------------------------
  private installUnlock(): void {
    if (this.options.unlocked) { if (!this.silent) this.unlock(); return; }
    if (this.unlockInstalled || typeof window === "undefined") return;
    this.unlockInstalled = true;
    this.unlock(); // a click before sounds.json arrived (the one that picked the emote) already allows audio
    // Kept for good (a check per press): after an iOS call or Siri the context is "interrupted" and needs a gesture.
    const handler = () => { if (!this.silent && this.context?.state !== "running") this.unlock(); };
    for (const e of ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const)
      window.addEventListener(e, handler, { capture: true, passive: true });
    // A hidden tab stops the animation (no frames) but not the audio clock: fade out, then suspend the device.
    document.addEventListener("visibilitychange", () => {
      if (!this.context) return;
      if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      if (document.hidden) {
        this.cut();
        // After the fade has run (suspending at once would freeze it, to finish as a blip on return).
        this.suspendTimer = setTimeout(() => { this.suspendTimer = null; void this.context?.suspend().catch(() => {}); }, 100);
      } else if (!this.silent) void this.context.resume().catch(() => {});
    });
  }

  private unlock(): void {
    if (typeof document !== "undefined" && document.hidden) return;
    // Chrome logs a warning when a context is made before any activation (a touch's pointerdown is not one yet).
    const activation = typeof navigator !== "undefined" ? (navigator as Navigator & { userActivation?: UserActivation }).userActivation : undefined;
    if (!this.options.unlocked && activation && !activation.isActive && !activation.hasBeenActive) return;
    if (!this.context) {
      const create = this.options.createContext ?? (() => new AudioContext({ latencyHint: "interactive" }));
      try { this.context = create(); } catch (error) { console.warn("[sound] no Web Audio", error); return; }
      this.master = this.context.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.context.destination);
      this.context.onstatechange = () => this.emit();
      for (const wave of this.bytes.keys()) void this.decode(wave); // fetched before the gesture
      this.emit();
    }
    if (this.context.state !== "running") void this.context.resume().catch(() => {});
  }

  // --- Audio data --------------------------------------------------------------------------------------------------
  private fetchWave(wave: string): Promise<ArrayBuffer | null> {
    let pending = this.bytes.get(wave);
    if (!pending) {
      const info = this.resolved?.files[wave];
      const get = this.options.fetch ?? globalThis.fetch?.bind(globalThis);
      if (!info || !this.url || !get) return Promise.resolve(null);
      const base = new URL(this.url, globalThis.location?.href ?? "http://localhost/");
      pending = get(new URL(info.file, base).href).then(async r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return await r.arrayBuffer();
      }).catch(error => { console.warn(`[sound] ${wave} failed to load`, error); this.bytes.delete(wave); return null; });
      this.bytes.set(wave, pending);
    }
    return pending;
  }

  private decode(wave: string): Promise<Wave | null> {
    const ready = this.waves.get(wave);
    if (ready) return Promise.resolve(ready);
    let pending = this.decoding.get(wave);
    if (!pending && this.context) {
      const context = this.context, length = this.resolved?.files[wave]?.duration;
      pending = this.fetchWave(wave).then(async data => {
        if (!data) return null;
        const buffer = await context.decodeAudioData(data); // detaches the bytes: drop them, a later decode refetches
        this.bytes.delete(wave);
        // Decoders should trim the encoder's priming (the MP4 edit list); one that does not leaves the wave late by it.
        const extra = length ? buffer.duration - length : 0;
        const decoded: Wave = { buffer, lead: extra > 0.005 ? Math.min(AAC_PRIMING, extra) : 0, length: length ?? buffer.duration };
        this.remember(wave, decoded);
        return decoded;
      }).catch(error => { console.warn(`[sound] ${wave} did not decode`, error); this.bytes.delete(wave); return null; })
        .finally(() => this.decoding.delete(wave));
      this.decoding.set(wave, pending);
    }
    return pending ?? Promise.resolve(null);
  }

  private remember(wave: string, decoded: Wave): void {
    this.waves.delete(wave);
    this.waves.set(wave, decoded);
    const keep = new Set(this.cues.flatMap(c => c.variants.map(v => v.wave)));
    let total = [...this.waves.values()].reduce((s, w) => s + w.buffer.duration, 0);
    for (const [name, w] of this.waves) {
      if (total <= MAX_DECODED_SECONDS) break;
      if (keep.has(name)) continue;
      this.waves.delete(name);
      total -= w.buffer.duration;
    }
  }

  /** Fetch (and, once audio is unlocked, decode) an emote animation's waves. Nothing while muted. */
  async prepare(source: string | null | undefined): Promise<void> {
    await this.load();
    if (this.silent) return;
    const cues = (source && this.resolved?.emotes[source]) || [];
    const waves = [...new Set(cues.flatMap(c => c.variants.map(v => v.wave)))];
    await Promise.allSettled(waves.map(w => this.context ? this.decode(w) : this.fetchWave(w)));
  }

  // --- Playback ----------------------------------------------------------------------------------------------------
  /** The emote in front changed (null: none). `ringOut`: it ended by itself, so its sounds end as in the game (windows
   *  stop with their fade, "once" sounds ring out); otherwise (the viewer picked, closed, stopped) everything fades. */
  setEmote(source: string | null | undefined, options: { ringOut?: boolean } = {}): void {
    if (options.ringOut) this.release(); else this.cut();
    this.cues = (source && this.resolved?.emotes[source]) || [];
    this.picks.clear();
    this.pass = 0;
    for (const wave of new Set(this.cues.flatMap(c => c.variants.map(v => v.wave)))) {
      const decoded = this.waves.get(wave);
      if (decoded) this.remember(wave, decoded); // most recently used
    }
  }

  /** Each frame: the emote clip's clock (null: no emote) and whether it advances. Not advancing is silent. */
  update(clock: SoundClock | null, moving: boolean): void {
    if (!clock || !moving || !this.cues.length || this.silent) { // muting cuts too: unmuting joins mid-sound
      if (this.voices.size || this.lastTime !== null) this.cut();
      return;
    }
    if (!this.context || this.context.state !== "running") { this.lastTime = null; return; }
    const t = clock.time, now = this.context.currentTime;
    if (this.lastTime !== null && t < this.lastTime - 1e-6) this.wrapped(clock.duration); // seeks pause first: a loop
    this.lastTime = t;
    this.cues.forEach((cue, i) => this.reconcile(cue, i, clock, now));
    // Attacks: hand the cues that begin within the look-ahead to the audio thread with their exact time.
    this.cues.forEach((cue, i) => {
      const ahead = cue.start - t;
      if (ahead > 0 && ahead <= LOOKAHEAD) this.startVoice(cue, i, this.pass, now + ahead, clock, 0);
      // The next pass of a looping emote (a covering musical window carries its voice across instead: see wrapped()).
      const next = cue.start + clock.duration - t;
      if (clock.looping && next > 0 && next <= LOOKAHEAD && !this.covers(cue, clock.duration)) this.startVoice(cue, i, this.pass + 1, now + next, clock, 0);
    });
  }

  /** A musical window that lasts the whole pass: its sync run never ends, so its voice continues across the wrap. */
  private covers(cue: SoundCue, clipLength: number): boolean {
    return !!cue.syncGroup && cue.kind === "window" && cue.start <= 1e-3 && cue.start + (cue.duration ?? 0) >= clipLength - 1e-3
      && cue.variants.every(v => v.loop);
  }

  /** The loop wrapped: windows of the pass that ended stop with their fade, "once" sounds ring out, covering musical
   *  windows carry on into the new pass. */
  private wrapped(clipLength: number): void {
    this.pass++;
    for (const voice of [...this.voices.values()]) {
      if (voice.pass >= this.pass) continue; // scheduled for the new pass
      this.voices.delete(voice.key);
      if (this.covers(voice.cue, clipLength)) {
        voice.pass = this.pass;
        voice.key = `${voice.index}:${this.pass}`;
        this.voices.set(voice.key, voice);
        this.record("adopt", voice, 0);
      } else if (voice.cue.kind === "window") this.fade(voice, voice.cue.fadeOut ?? DEFAULT_FADE_OUT, "stop");
      else this.released.add(voice);
    }
    const older = (key: string) => Number(key.split(":")[1]) < this.pass;
    for (const key of [...this.finished]) if (older(key)) this.finished.delete(key);
    for (const key of [...this.picks.keys()]) if (older(key)) this.picks.delete(key);
  }

  private choice(cue: SoundCue, key: string) {
    let chosen = this.picks.get(key);
    if (!chosen) {
      const random = this.options.random ?? Math.random;
      const total = cue.variants.reduce((s, v) => s + v.weight, 0);
      let r = random() * total, variant = cue.variants[cue.variants.length - 1];
      for (const v of cue.variants) { if ((r -= v.weight) < 0) { variant = v; break; } }
      chosen = { variant, gain: pick(variant.gain, random), rate: pick(variant.rate, random) };
      this.picks.set(key, chosen);
    }
    return chosen;
  }

  /** Where a cue's sound should be at this clock: its wave position, or null when it should be silent. A looping wave is
   *  measured from `origin` (session time), so a voice carried across the wrap keeps its place. */
  private expected(cue: SoundCue, rate: number, length: number, loop: boolean, clock: SoundClock, origin: number): number | null {
    const elapsed = clock.time - cue.start;
    if (elapsed < 0) return null;
    if (cue.kind === "window" && elapsed >= (cue.duration ?? 0)) return null;
    if (loop) return (((this.pass * clock.duration + clock.time - origin) * rate) % length + length) % length;
    const position = elapsed * rate;
    return position < length ? position : null;
  }

  private reconcile(cue: SoundCue, index: number, clock: SoundClock, now: number): void {
    const key = `${index}:${this.pass}`;
    const voice = this.voices.get(key);
    const { variant, rate } = voice ? { variant: null, rate: voice.rate } : this.choice(cue, key);
    const wave = voice ? null : this.waves.get(variant!.wave);
    const length = voice?.length ?? wave?.length;
    if (length === undefined) { void this.decode(variant!.wave); return; } // not decoded yet: joins when it is
    const loop = voice ? voice.loop : !!variant!.loop;
    const origin = voice?.origin ?? this.pass * clock.duration + cue.start;
    const offset = this.expected(cue, rate, length, loop, clock, origin);
    if (voice) {
      if (voice.at > now) return; // scheduled, not started yet
      // Started on the audio clock while the animation clock still reads just before the cue (the two disagree by a few
      // milliseconds). "Not yet" is not "over": stopping it here, the look-ahead would schedule it again (a flam, or a
      // "once" sound twice; seen in Chrome, 12 Nov 2026).
      if (clock.time < cue.start) return;
      if (offset === null) {
        this.voices.delete(key);
        if (cue.kind === "window") this.fade(voice, cue.fadeOut ?? DEFAULT_FADE_OUT, "stop");
        else this.released.add(voice); // a "once" past its length: ending by itself
        return;
      }
      // Audio may lead (the frame cap only ever puts the animation behind). A long or looping voice far out restarts.
      const actual = voice.offset + (now - voice.at) * voice.rate;
      let diff = offset - actual;
      if (loop) diff = ((diff % length) + 1.5 * length) % length - 0.5 * length;
      const left = loop ? Infinity : (length - offset) / rate;
      if (Math.abs(diff) > DRIFT && cue.kind === "window" && left > RESTART_LEFT && now - voice.at > RESTART_AFTER
        && now - voice.restartedAt > RESTART_EVERY) {
        this.voices.delete(key);
        this.fade(voice, MID_FADE_IN, "restart");
        this.startVoice(cue, index, this.pass, now, clock, offset, origin);
        const restarted = this.voices.get(key);
        if (restarted) restarted.restartedAt = now;
      }
      return;
    }
    if (offset === null || this.finished.has(key)) return;
    this.startVoice(cue, index, this.pass, now, clock, offset, origin);
  }

  private startVoice(cue: SoundCue, index: number, pass: number, at: number, clock: SoundClock, offset: number, origin?: number): void {
    const key = `${index}:${pass}`;
    if (this.voices.has(key) || this.finished.has(key) || !this.context || !this.master) return;
    const { variant, gain, rate } = this.choice(cue, key);
    const wave = this.waves.get(variant.wave);
    if (!wave) { void this.decode(variant.wave); return; }
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = wave.buffer;
    source.playbackRate.value = rate;
    if (variant.loop) { source.loop = true; source.loopStart = wave.lead; source.loopEnd = wave.lead + wave.length; }
    const node = context.createGain();
    // The fade-in: the cue's own attack, a short one when starting inside the sound, else none (the wave starts clean).
    const fadeIn = cue.attack && offset < cue.attack * rate ? cue.attack : offset > 0 ? MID_FADE_IN : 0;
    let envelope: Voice["envelope"];
    if (fadeIn) {
      node.gain.setValueAtTime(0, at);
      node.gain.linearRampToValueAtTime(gain, at + fadeIn);
      envelope = [at, 0, at + fadeIn, gain];
    } else {
      node.gain.value = gain;
      envelope = [at, gain, at, gain];
    }
    source.connect(node).connect(this.master);
    const voice: Voice = { key, index, cue, pass, wave: variant.wave, source, gain: node, at, offset, rate, length: wave.length,
      loop: !!variant.loop, origin: origin ?? pass * clock.duration + cue.start, envelope, restartedAt: -Infinity };
    source.onended = () => {
      if (this.voices.get(voice.key) === voice) { this.voices.delete(voice.key); this.finished.add(voice.key); }
      this.released.delete(voice);
      node.disconnect();
      this.record("end", voice, null);
    };
    source.start(at, wave.lead + offset);
    this.voices.set(key, voice);
    this.record(at > context.currentTime + 1e-3 ? "schedule" : "start", voice, clock.time);
  }

  private fade(voice: Voice, seconds: number, event: "stop" | "restart"): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime, end = now + Math.max(DECLICK, seconds);
    this.released.add(voice);
    if (voice.at > now) { // never started: just cancel it
      try { voice.source.stop(); } catch { /* already stopped */ }
    } else {
      const [t0, v0, t1, v1] = voice.envelope;
      const level = now >= t1 ? v1 : now <= t0 ? v0 : v0 + (v1 - v0) * (now - t0) / (t1 - t0);
      if (end >= t1 && v1 === 0 && t1 > t0) return; // already fading out, sooner than this would
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(level, now);
      voice.gain.gain.linearRampToValueAtTime(0, end);
      voice.envelope = [now, level, end, 0];
      try { voice.source.stop(end + 0.01); } catch { /* already stopped */ }
    }
    this.record(event, voice, this.lastTime);
  }

  /** Fade every voice out now: a user interruption (pause, seek, scrub, step, another emote, close) or a hidden tab. */
  cut(): void {
    for (const voice of [...this.voices.values(), ...this.released]) this.fade(voice, CUT_FADE, "stop");
    this.voices.clear();
    this.finished.clear(); // the timeline may now be anywhere: what ended before may sound again
    this.lastTime = null;
  }

  /** The emote ended by itself (or stopped on its last frame, inspected): windows stop with their fade, "once" sounds
   *  ring out, as in the game. */
  release(): void {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices.values()) {
      if (voice.cue.kind === "window" || voice.at > now) this.fade(voice, voice.cue.fadeOut ?? DEFAULT_FADE_OUT, "stop");
      else this.released.add(voice);
    }
    this.voices.clear();
    this.finished.clear();
    this.lastTime = null;
  }

  private record(event: SoundLogEntry["event"], voice: Voice, clipTime: number | null): void {
    this.log.push({ event, key: voice.key, wave: voice.wave, clipTime, ctxTime: this.context?.currentTime ?? 0,
      ...(event === "start" || event === "schedule" ? { at: voice.at, offset: voice.offset } : {}) });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  /** Stop everything and release the audio device (the viewer unmounts). */
  dispose(): void {
    this.cut();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    void this.context?.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
