// Takes (22 Nov 2026): "record, then render". While a take records, every frame the viewer shows is sampled: the camera,
// the orbit's target and the character's turn, and each clip the mixer blends (its time, weight and rate). Lighting
// changes are kept as events. A take is rendered later, frame by frame at exactly 60 fps (rig/VideoExport.ts
// renderTake), so a slow machine's dropped or late frames never reach the video. This file is the take's data model,
// with no three.js: sample encoding, and turning samples back into the state at any time (TakeTimeline).
//
// How a recorded clip is replayed. Between two samples where it plays on continuously (the same clip at the same rate,
// advancing no further than the time between them allows), its time is interpolated, so the video moves smoothly
// however few frames the machine drew. At ordinary frame rates that is exactly the clip's own clock (the mixer steps by
// the frame's time). Under 10 fps the mixer steps at most 0.1 s a frame, so playback ran slower than real time; the
// video then shows that pace, smoothly, rather than jump to catch up. A discontinuity (a seek, a restart, a speed
// change) shows at the sample that recorded it: until then the clip plays on at its rate. A held clip (paused, or a
// timeline drag) is interpolated between its samples, so a scrub plays back smoothly. Weights (crossfades) are
// interpolated. The camera is interpolated: position linearly, rotation along the arc.
//
// Sound: the emote in front, while it plays audibly, makes sound segments (rendered by EmoteSounds.renderSegments). A
// seek or a pause ends one with the cut playback makes; a one-shot's end lets it ring out; a segment drifting from its
// own clock by more than RESYNC (a long stall) starts again where the picture is, as playback's drift rule does.

export const TAKE_VERSION = 1;
/** Takes kept per browser. Past it, the oldest take already rendered makes room; one never rendered is never evicted. */
export const MAX_TAKES = 10;
/** A take stops recording by itself at this length (3 minutes: about 10,800 frames to render at 60 fps). */
export const MAX_TAKE_SECONDS = 180;
/** Samples are saved in chunks this often while recording, so a closed tab loses at most this much. */
export const CHUNK_SECONDS = 1;
/** Clip seconds a sound segment may drift from the picture before it starts again where the picture is (as playback's
 *  sounds do: EmoteSounds DRIFT). */
export const RESYNC = 0.25;

export interface TakeAction {
  clip: string;
  /** Clip seconds. */
  time: number;
  /** The mixer's effective weight (a crossfade's progress included). */
  weight: number;
  /** Clip seconds per second: the action's time scale times the mixer's; 0 while held (paused, a seek, a drag). */
  rate: number;
  loop: boolean;
  /** The emote in front (its timeline, props and sounds); false for the idle and for clips fading out. */
  front: boolean;
}

export interface TakeSample {
  /** Seconds since the take started. */
  t: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  /** The orbit's target (the sway turns with the camera's angle round it). */
  target: [number, number, number];
  /** The character's own turn (scene turntable mode), radians. */
  yaw: number;
  sway: boolean;
  /** Something plays (the springs swing only then). */
  moving: boolean;
  /** The front emote's sounds would play: it advances, not held or dragged. */
  audible: boolean;
  actions: TakeAction[];
}

/** A lighting change (the look the viewer drew from then on, as stored: lib/stage-lighting.ts sanitizes it). */
export interface TakeLookEvent { t: number; look: unknown }

/** One stored piece of a take: its samples (encoded) and look events, in order. */
export interface TakeChunk { take: string; index: number; samples: Float64Array; events: TakeLookEvent[] }

const HEAD = 15, PER_ACTION = 5;
const F_SWAY = 1, F_MOVING = 2, F_AUDIBLE = 4;
const A_LOOP = 1, A_FRONT = 2;

/** Pack samples into numbers. `clips` maps clip ids to indexes and is extended with new ones (stored with the take). */
export function encodeSamples(samples: readonly TakeSample[], clips: string[]): Float64Array {
  const out = new Float64Array(samples.reduce((n, s) => n + HEAD + PER_ACTION * s.actions.length, 0));
  let i = 0;
  for (const s of samples) {
    out.set([s.t, ...s.position, ...s.quaternion, s.fov, ...s.target, s.yaw,
      (s.sway ? F_SWAY : 0) | (s.moving ? F_MOVING : 0) | (s.audible ? F_AUDIBLE : 0), s.actions.length], i);
    i += HEAD;
    for (const a of s.actions) {
      let clip = clips.indexOf(a.clip);
      if (clip < 0) clip = clips.push(a.clip) - 1;
      out.set([clip, a.time, a.weight, a.rate, (a.loop ? A_LOOP : 0) | (a.front ? A_FRONT : 0)], i);
      i += PER_ACTION;
    }
  }
  return out;
}

/** The samples back. A malformed tail (a write cut short) is dropped, never the samples before it. */
export function decodeSamples(data: ArrayLike<number>, clips: readonly string[]): TakeSample[] {
  const samples: TakeSample[] = [];
  let i = 0;
  while (i + HEAD <= data.length) {
    const n = data[i + 14];
    if (!Number.isInteger(n) || n < 0 || i + HEAD + n * PER_ACTION > data.length) break;
    const flags = data[i + 13];
    const actions: TakeAction[] = [];
    let bad = false;
    for (let k = 0; k < n; k++) {
      const j = i + HEAD + k * PER_ACTION, clip = clips[data[j]];
      if (clip === undefined) { bad = true; break; }
      actions.push({ clip, time: data[j + 1], weight: data[j + 2], rate: data[j + 3], loop: (data[j + 4] & A_LOOP) !== 0, front: (data[j + 4] & A_FRONT) !== 0 });
    }
    if (bad) break;
    samples.push({ t: data[i], position: [data[i + 1], data[i + 2], data[i + 3]], quaternion: [data[i + 4], data[i + 5], data[i + 6], data[i + 7]],
      fov: data[i + 8], target: [data[i + 9], data[i + 10], data[i + 11]], yaw: data[i + 12],
      sway: (flags & F_SWAY) !== 0, moving: (flags & F_MOVING) !== 0, audible: (flags & F_AUDIBLE) !== 0, actions });
    i += HEAD + n * PER_ACTION;
  }
  return samples;
}

/** A frame to render: the camera, the character's turn, and the clips to blend. */
export interface TakeFrame {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  target: [number, number, number];
  yaw: number;
  sway: boolean;
  moving: boolean;
  actions: { clip: string; time: number; weight: number; front: boolean }[];
}

/** A stretch of the front emote's sound: from clip time `from`, at take time `at` until `end`, at `speed`. `natural`:
 *  it played to its end (its sounds end as in the game); otherwise whatever sounds at `end` is cut, as a seek or a pause
 *  cuts playback. The last segment of a take simply runs into the recording's end. */
export interface SoundSegment { clip: string; from: number; at: number; end: number; speed: number; loop: boolean; natural: boolean }

/** A recorded action, with how far its clip advanced since the previous sample when it played on continuously (null:
 *  it did not: it was held, started, sought or changed speed). */
interface Linked extends TakeAction { advance: number | null }
type LinkedSample = Omit<TakeSample, "actions"> & { actions: Linked[] };

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const angleLerp = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

/** Spherical interpolation of unit quaternions [x, y, z, w], the short way round. */
export function slerp(a: readonly number[], b: readonly number[], f: number): [number, number, number, number] {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let wa = 1 - f, wb = f;
  if (cos < 0.9995) {
    const angle = Math.acos(cos), sin = Math.sin(angle);
    wa = Math.sin((1 - f) * angle) / sin;
    wb = Math.sin(f * angle) / sin;
  }
  const q: [number, number, number, number] = [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
  const length = Math.hypot(...q) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** A take's samples as a timeline: the state at any time, its frames and its sound. `length(clip)`: a clip's length
 *  in seconds (wraps a looping clip, holds a one-shot at its end). */
export class TakeTimeline {
  readonly samples: readonly LinkedSample[];
  /** Seconds: from the first sample (0) to the last. */
  readonly duration: number;

  constructor(samples: readonly TakeSample[], private readonly length: (clip: string) => number) {
    // Times as recorded (the recorder's first sample is at 0; look events share its clock).
    const sorted = [...samples].sort((a, b) => a.t - b.t);
    const linked: LinkedSample[] = [];
    for (const s of sorted) {
      const previous = linked[linked.length - 1];
      linked.push({ ...s, actions: s.actions.map(a => {
        const before = previous?.actions.find(p => p.clip === a.clip);
        let advance: number | null = null;
        if (previous && before && before.rate > 0 && a.rate > 0 && Math.abs(before.rate - a.rate) < 1e-6 && before.loop === a.loop) {
          const clipLength = this.length(a.clip);
          let d = a.time - before.time;
          if (a.loop && clipLength > 0 && d < -1e-6) d += clipLength * Math.ceil(-d / clipLength); // wrapped
          // No further than the time between the samples allows (a little slack for rounding); less is a slow frame.
          if (d >= -1e-6 && d <= (s.t - previous.t) * a.rate * 1.1 + 0.05) advance = Math.max(0, d);
        }
        return { ...a, advance };
      }) });
    }
    this.samples = linked;
    this.duration = linked.length ? linked[linked.length - 1].t : 0;
  }

  /** A clip time on the clip: wrapped for a loop, held at the ends for a one-shot. */
  private clock(clip: string, loop: boolean, time: number): number {
    const length = this.length(clip);
    if (!(length > 0)) return Math.max(0, time);
    return loop ? ((time % length) + length) % length : Math.min(Math.max(0, time), length);
  }

  /** How far two times on a clip are apart (round the wrap for a loop). */
  private gap(clip: string, loop: boolean, a: number, b: number): number {
    const d = Math.abs(a - b), length = this.length(clip);
    return loop && length > 0 ? Math.min(d % length, length - (d % length)) : d;
  }

  /** Frames at `fps`: frame i shows the take at i / fps seconds; the last shows its last sample. */
  frames(fps: number): number {
    return Math.max(1, Math.floor(this.duration * fps + 1e-6) + 1);
  }

  /** The index of the last sample at or before `t` (0 before the first). */
  private index(t: number): number {
    let lo = 0, hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** The state at `t` seconds into the take. */
  frameAt(t: number): TakeFrame {
    const i = this.index(t), s0 = this.samples[i], s1 = this.samples[i + 1];
    if (!s0) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 50, target: [0, 0, 0], yaw: 0, sway: false, moving: false, actions: [] };
    const f = s1 && s1.t > s0.t ? Math.min(1, Math.max(0, (t - s0.t) / (s1.t - s0.t))) : 0;
    const actions: TakeFrame["actions"] = [];
    for (const a of s0.actions) {
      const b = s1?.actions.find(x => x.clip === a.clip);
      const time = b && b.advance !== null ? this.clock(a.clip, a.loop, a.time + b.advance * f) // played on: smoothly
        : a.rate > 0 ? this.clock(a.clip, a.loop, a.time + (t - s0.t) * a.rate) // plays on until the next sample shows the change
        : b && b.rate === 0 ? lerp(a.time, b.time, f) // held, or dragged
        : a.time;
      actions.push({ clip: a.clip, time, weight: lerp(a.weight, b?.weight ?? 0, f), front: a.front });
    }
    for (const b of s1?.actions ?? []) { // coming in: where it would have been
      if (s0.actions.some(a => a.clip === b.clip)) continue;
      actions.push({ clip: b.clip, time: b.rate > 0 ? this.clock(b.clip, b.loop, b.time - (s1.t - t) * b.rate) : b.time,
        weight: lerp(0, b.weight, f), front: b.front });
    }
    const v = (a: readonly number[], b: readonly number[] | undefined) => a.map((x, k) => lerp(x, b?.[k] ?? x, f));
    return {
      position: v(s0.position, s1?.position) as TakeFrame["position"],
      quaternion: s1 ? slerp(s0.quaternion, s1.quaternion, f) : [...s0.quaternion],
      fov: lerp(s0.fov, s1?.fov ?? s0.fov, f),
      target: v(s0.target, s1?.target) as TakeFrame["target"],
      yaw: s1 ? angleLerp(s0.yaw, s1.yaw, f) : s0.yaw,
      sway: s0.sway, moving: s0.moving,
      actions: actions.filter(a => a.weight > 1e-4),
    };
  }

  /** The clips the take blends (to load before rendering). */
  clips(): string[] {
    return [...new Set(this.samples.flatMap(s => s.actions.map(a => a.clip)))];
  }

  /** The front emote's sound, as segments (see SoundSegment). */
  soundSegments(): SoundSegment[] {
    const segments: SoundSegment[] = [];
    let current: SoundSegment | null = null;
    const close = (end: number) => {
      if (!current) return;
      const length = this.length(current.clip);
      const reached = current.from + (end - current.at) * current.speed;
      segments.push({ ...current, end, natural: !current.loop && length > 0 && reached >= length - 0.05 });
      current = null;
    };
    for (const s of this.samples) {
      const a = s.actions.find(x => x.front);
      const playing = !!a && s.audible && a.rate > 0;
      if (playing && current && current.clip === a.clip && a.advance !== null && Math.abs(current.speed - a.rate) < 1e-6
        && this.gap(a.clip, a.loop, this.clock(a.clip, a.loop, current.from + (s.t - current.at) * current.speed), a.time) <= RESYNC) continue;
      close(s.t);
      if (playing) current = { clip: a.clip, from: a.time, at: s.t, end: s.t, speed: a.rate, loop: a.loop, natural: false };
    }
    if (current) {
      close(this.duration);
      segments[segments.length - 1].end = Infinity; // into the recording's end: nothing cuts it, the recording ends there
    }
    return segments;
  }
}

/** The look drawn at `t`: the last event at or before it (the take starts with one). */
export function lookAt(events: readonly TakeLookEvent[], t: number): unknown {
  let look: unknown = events[0]?.look;
  for (const event of events) { if (event.t <= t + 1e-9) look = event.look; else break; }
  return look;
}
