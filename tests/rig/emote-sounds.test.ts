import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FADE_OUT, EmoteSounds, type SoundsManifest } from "../../src/rig/EmoteSounds";

// Emote sounds (12 Nov 2026): what starts, when, and at which offset, as the emote clock plays, pauses, seeks and
// loops. No browser: a fake AudioContext records every start/stop, and its clock is moved by hand like the frame loop.

interface Started { wave: string; when: number; offset: number; loop: boolean; rate: number; stoppedAt?: number; ended?: boolean }

class FakeParam {
  value = 1;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) { this.events.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(["ramp", v, t]); return this; }
  cancelScheduledValues() { return this; }
  setTargetAtTime(v: number, t: number) { this.events.push(["target", v, t]); return this; }
}
class FakeContext {
  currentTime = 0;
  state = "running";
  destination = {};
  started: Started[] = [];
  private sources: { record: Started; source: { onended: (() => void) | null } }[] = [];
  onstatechange: (() => void) | null = null;
  constructor(private readonly durations: Record<number, number>, private readonly names: Record<number, string>) {}
  createGain() { return { gain: new FakeParam(), connect: (n: unknown) => n, disconnect() {} }; }
  createBufferSource() {
    const ctx = this;
    const source = {
      buffer: null as { duration: number; name: string } | null, loop: false, playbackRate: { value: 1 }, onended: null as (() => void) | null,
      connect: (n: unknown) => n,
      start(when: number, offset: number) {
        const record: Started = { wave: source.buffer!.name, when, offset, loop: source.loop, rate: source.playbackRate.value };
        ctx.started.push(record);
        ctx.sources.push({ record, source });
      },
      stop(when?: number) {
        const entry = ctx.sources.find(s => s.source === source);
        if (entry) entry.record.stoppedAt = when ?? ctx.currentTime;
      },
    };
    return source;
  }
  async decodeAudioData(data: ArrayBuffer) {
    return { duration: this.durations[data.byteLength], name: this.names[data.byteLength] };
  }
  async resume() {}
  async suspend() {}
  async close() {}
  /** Advance the audio clock; sources that reach their natural end (or their stop) fire onended. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const { record, source } of this.sources) {
      if (record.ended) continue;
      const natural = record.loop ? Infinity : record.when + (this.durations[Object.values(this.names).indexOf(record.wave) + 1] - record.offset) / record.rate;
      if (this.currentTime >= Math.min(natural, record.stoppedAt ?? Infinity)) { record.ended = true; source.onended?.(); }
    }
  }
}

const SEQ = "HM_Test_00", LOOPSEQ = "HM_Loop_00", BANDSEQ = "HM_Band_00";
const manifest: SoundsManifest = {
  formatVersion: 1,
  files: {
    Clap: { file: "Clap.m4a", bytes: 1, duration: 0.5, channels: 2 },
    Voice: { file: "Voice.m4a", bytes: 2, duration: 3, channels: 2 },
    Music: { file: "Music.m4a", bytes: 3, duration: 4, channels: 2 },
    Ring: { file: "Ring.m4a", bytes: 4, duration: 2, channels: 2 },
  },
  emotes: {
    // A clap at 1 s (window to 1.4 s, its own fade), a voice line from 2 s cut at 4 s (no stored fade: the default).
    [SEQ]: [
      { start: 1, kind: "window", duration: 0.4, fadeOut: 0.1, sound: "Clap_Cue", variants: [{ wave: "Clap", weight: 1, gain: 1, rate: 1 }] },
      { start: 2, kind: "window", duration: 2, sound: "Voice_Cue", variants: [{ wave: "Voice", weight: 1, gain: 0.75, rate: 1 }] },
    ],
    // A 6 s looping dance: a musical window over the whole pass (a 4 s track) and a bell at 5.5 s that rings out.
    [LOOPSEQ]: [
      { start: 0, kind: "window", duration: 6, fadeOut: 1, attack: 0.05, syncGroup: "AudioSyncGroup.MariachiBand", sound: "Music_MetaSound",
        variants: [{ wave: "Music", weight: 1, gain: 1, rate: 1, loop: true }] },
      { start: 5.5, kind: "once", sound: "Ring_Cue", variants: [{ wave: "Ring", weight: 1, gain: 1, rate: 1 }] },
    ],
    // An instrument emote: its track plays from 0.5 s to 4.5 s of a 6 s pass (a gap before the clip ends).
    [BANDSEQ]: [
      { start: 0.5, kind: "window", duration: 4, attack: 0.05, syncGroup: "AudioSyncGroup.MariachiBand", sound: "Lute_MetaSound",
        variants: [{ wave: "Music", weight: 1, gain: 1, rate: 1, loop: true }] },
    ],
  },
};
const sizes: Record<string, number> = { "Clap.m4a": 1, "Voice.m4a": 2, "Music.m4a": 3, "Ring.m4a": 4 };
const fakeFetch = (async (url: string) => {
  if (url.endsWith("sounds.json")) return { ok: true, json: async () => manifest };
  const name = url.split("/").at(-1)!;
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(sizes[name]) };
}) as unknown as typeof fetch;

async function setup(source: string) {
  const ctx = new FakeContext({ 1: 0.5, 2: 3, 3: 4, 4: 2 }, { 1: "Clap", 2: "Voice", 3: "Music", 4: "Ring" });
  const sounds = new EmoteSounds("http://test/sounds-1/sounds.json",
    { createContext: () => ctx as unknown as AudioContext, fetch: fakeFetch, random: () => 0, unlocked: true });
  await sounds.prepare(source);
  sounds.setEmote(source);
  await new Promise(r => setTimeout(r, 0)); // decodes settle
  return { ctx, sounds };
}
/** Play the clock from `from` to `to` at 60 fps, the audio clock advancing with it. */
function play(ctx: FakeContext, sounds: EmoteSounds, from: number, to: number, duration = 6, looping = false) {
  let t = from;
  const step = 1 / 60;
  sounds.update({ time: t, duration, looping }, true);
  while (t < to - 1e-9) {
    ctx.advance(step);
    t += step;
    const time = looping ? t % duration : Math.min(t, duration);
    sounds.update({ time, duration, looping }, true);
  }
}

test("a cue is handed to the audio thread ahead of its start, at its exact time and from its first sample", async () => {
  const { ctx, sounds } = await setup(SEQ);
  play(ctx, sounds, 0, 1.2);
  const clap = ctx.started.filter(s => s.wave === "Clap");
  assert.equal(clap.length, 1, "started once, not again when the clock passes 1 s");
  assert.equal(clap[0].offset, 0, "from its first sample");
  assert.ok(Math.abs(clap[0].when - 1) < 1e-6, `at clip time 1 s exactly (audio clock ${clap[0].when})`);
  assert.ok(clap[0].when > 1 - 0.12 && sounds.log.some(e => e.event === "schedule" && e.wave === "Clap"), "scheduled, not polled");
});

test("a window stops at its end with its fade; without a stored fade the default applies", async () => {
  const { ctx, sounds } = await setup(SEQ);
  play(ctx, sounds, 0, 4.2);
  const [clap] = ctx.started.filter(s => s.wave === "Clap"), [voice] = ctx.started.filter(s => s.wave === "Voice");
  assert.ok(clap.ended, "the 0.5 s clap ended");
  assert.ok(voice.stoppedAt !== undefined && Math.abs(voice.stoppedAt - (4 + DEFAULT_FADE_OUT + 0.01)) < 0.03,
    `the voice line is cut at its window end (4 s) over the default fade (stop at ${voice.stoppedAt})`);
});

test("pausing silences; resuming inside a sound starts it at the matching offset, once", async () => {
  const { ctx, sounds } = await setup(SEQ);
  play(ctx, sounds, 0, 2.5);
  sounds.update({ time: 2.5, duration: 6, looping: false }, false); // pause
  const [first] = ctx.started.filter(s => s.wave === "Voice");
  assert.ok(first.stoppedAt !== undefined, "the voice fades out on pause");
  ctx.advance(5); // a long pause: the audio clock runs on, the clip clock does not
  sounds.update({ time: 3.2, duration: 6, looping: false }, false); // a seek while paused (silent)
  play(ctx, sounds, 3.2, 3.4);
  const voices = ctx.started.filter(s => s.wave === "Voice");
  assert.equal(voices.length, 2, "one restart on resume, no more");
  assert.ok(Math.abs(voices[1].offset - 1.2) < 1e-6, `from 1.2 s into the line (offset ${voices[1].offset})`);
  assert.equal(ctx.started.filter(s => s.wave === "Clap").length, 1, "the clap before the seek point does not replay");
});

test("a musical window over the whole pass carries its voice across the wrap; the bell rings out", async () => {
  const { ctx, sounds } = await setup(LOOPSEQ);
  play(ctx, sounds, 0, 13, 6, true);
  const music = ctx.started.filter(s => s.wave === "Music");
  assert.equal(music.length, 1, "one voice for two wraps: the track goes on (no restart, no overlap with a fading copy)");
  assert.equal(music[0].stoppedAt, undefined);
  assert.equal(sounds.log.filter(e => e.event === "adopt").length, 2);
  const ring = ctx.started.filter(s => s.wave === "Ring");
  assert.equal(ring.length, 2, "the bell once per pass");
  assert.ok(Math.abs(ring[1].when - 11.5) < 1e-6, `the second bell is scheduled exactly (${ring[1].when})`);
  assert.equal(ring[0].stoppedAt, undefined, "the first bell (a once cue) rings out across the wrap");
});

test("an instrument window with a gap before the clip ends restarts its track each pass, scheduled exactly", async () => {
  const { ctx, sounds } = await setup(BANDSEQ);
  play(ctx, sounds, 0, 7, 6, true);
  const lute = ctx.started.filter(s => s.wave === "Music");
  assert.equal(lute.length, 2);
  assert.ok(Math.abs(lute[0].when - 0.5) < 1e-6 && Math.abs(lute[1].when - 6.5) < 1e-6, "at 0.5 s of each pass");
  assert.deepEqual(lute.map(l => l.offset), [0, 0], "from the top of the track, in step with the strumming");
  assert.ok(lute[0].stoppedAt !== undefined && Math.abs(lute[0].stoppedAt - (4.5 + DEFAULT_FADE_OUT + 0.01)) < 0.03, "stopped at its window end");
});

test("a musical loop joins at the clock's position, wrapped by its wave length", async () => {
  const { ctx, sounds } = await setup(LOOPSEQ);
  sounds.update({ time: 5, duration: 6, looping: true }, true); // e.g. a link opened at 5 s, sound unlocked now
  const [music] = ctx.started.filter(s => s.wave === "Music");
  assert.ok(Math.abs(music.offset - 1) < 1e-6, `5 s into a 4 s loop is 1 s into the wave (offset ${music.offset})`);
  assert.equal(music.loop, true);
});

test("a long voice the clocks have pulled far apart restarts in place; a small difference is left alone", async () => {
  const { ctx, sounds } = await setup(SEQ);
  play(ctx, sounds, 1.9, 2.3);
  ctx.advance(0.05); // a little audio lead: under the threshold
  sounds.update({ time: 2.32, duration: 6, looping: false }, true);
  assert.equal(ctx.started.filter(s => s.wave === "Voice").length, 1);
  ctx.advance(0.4); // a hitch: the frame step cap let the animation fall 0.4 s behind the audio
  sounds.update({ time: 2.34, duration: 6, looping: false }, true);
  const voices = ctx.started.filter(s => s.wave === "Voice");
  assert.equal(voices.length, 2, "restarted");
  assert.ok(Math.abs(voices[1].offset - 0.34) < 1e-6, "at the animation's position");
});

test("a voice the audio clock has started while the clip clock reads just before its cue is kept (no flam)", async () => {
  // Seen in Chrome: scheduled for audio time 8.188 (clip 4.0176); at audio 8.192 the clip clock read 4.017.
  const { ctx, sounds } = await setup(LOOPSEQ);
  sounds.update({ time: 5.45, duration: 6, looping: true }, true); // the bell (5.5 s) scheduled 50 ms ahead
  ctx.advance(0.054); // the audio clock passes its start...
  sounds.update({ time: 5.4995, duration: 6, looping: true }, true); // ...the animation is 0.5 ms short of it
  sounds.update({ time: 5.4998, duration: 6, looping: true }, true);
  const ring = ctx.started.filter(s => s.wave === "Ring");
  assert.equal(ring.length, 1, "started once");
  assert.equal(ring[0].stoppedAt, undefined, "and not stopped");
  assert.ok(!sounds.log.some(e => e.event === "stop"));
});

test("a once cue is never rewound: after a hitch its audio leads", async () => {
  const { ctx, sounds } = await setup(LOOPSEQ);
  play(ctx, sounds, 5.4, 5.6, 6, true);
  ctx.advance(0.9); // a long hitch while the bell rings
  sounds.update({ time: 5.7, duration: 6, looping: true }, true);
  assert.equal(ctx.started.filter(s => s.wave === "Ring").length, 1);
});

test("a sound that ended by itself is not started again; after a seek back it plays again", async () => {
  const { ctx, sounds } = await setup(SEQ);
  play(ctx, sounds, 0.9, 1.39); // the clap (0.5 s) ends at 1.5 s; the window lasts to 1.4 s
  assert.equal(ctx.started.filter(s => s.wave === "Clap").length, 1);
  sounds.cut(); // a seek (RigAnimator.hold) back to 0.5 s
  play(ctx, sounds, 0.5, 1.2);
  assert.equal(ctx.started.filter(s => s.wave === "Clap").length, 2);
});

test("muted: nothing is downloaded and nothing plays; unmuting joins the emote mid-sound", async () => {
  const store = new Map<string, string>([["finals-outfit.emote-sound", JSON.stringify({ volume: 0.7, muted: true })]]);
  const g = globalThis as unknown as { localStorage?: unknown };
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  try {
    const fetched: string[] = [];
    const ctx = new FakeContext({ 1: 0.5, 2: 3, 3: 4, 4: 2 }, { 1: "Clap", 2: "Voice", 3: "Music", 4: "Ring" });
    const sounds = new EmoteSounds("http://test/sounds-1/sounds.json", { createContext: () => ctx as unknown as AudioContext,
      fetch: ((url: string) => { fetched.push(url); return fakeFetch(url as never); }) as typeof fetch, random: () => 0, unlocked: true });
    await sounds.prepare(SEQ);
    sounds.setEmote(SEQ);
    sounds.update({ time: 2.5, duration: 6, looping: false }, true);
    assert.deepEqual(fetched.map(u => u.split("/").at(-1)), ["sounds.json"], "no wave downloaded while muted");
    assert.equal(ctx.started.length, 0);
    sounds.setMuted(false);
    sounds.update({ time: 2.55, duration: 6, looping: false }, true); // starts the download
    await new Promise(r => setTimeout(r, 0));
    sounds.update({ time: 2.6, duration: 6, looping: false }, true);
    assert.ok(Math.abs(ctx.started[0].offset - 0.6) < 1e-6, "joins 0.6 s into the voice line");
  } finally {
    delete g.localStorage;
  }
});

test("no audio before a gesture; afterwards the emote joins mid-sound", async () => {
  const ctx = new FakeContext({ 1: 0.5, 2: 3, 3: 4, 4: 2 }, { 1: "Clap", 2: "Voice", 3: "Music", 4: "Ring" });
  ctx.state = "suspended";
  const sounds = new EmoteSounds("http://test/sounds-1/sounds.json",
    { createContext: () => ctx as unknown as AudioContext, fetch: fakeFetch, random: () => 0, unlocked: true });
  await sounds.prepare(SEQ);
  sounds.setEmote(SEQ);
  await new Promise(r => setTimeout(r, 0));
  sounds.update({ time: 2.5, duration: 6, looping: false }, true);
  assert.equal(ctx.started.length, 0, "locked: silent");
  ctx.state = "running";
  sounds.update({ time: 2.6, duration: 6, looping: false }, true);
  assert.ok(Math.abs(ctx.started[0].offset - 0.6) < 1e-6, "joins 0.6 s into the voice line");
});

test("mute and volume are remembered and survive broken storage", () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  try {
    const a = new EmoteSounds("http://test/s.json");
    assert.deepEqual(a.settings, { volume: 0.7, muted: false }, "on by default");
    a.setMuted(true);
    a.setVolume(0.4);
    assert.deepEqual(new EmoteSounds("http://test/s.json").settings, { volume: 0.4, muted: false }, "dragging the volume unmutes");
    store.set("finals-outfit.emote-sound", "{not json");
    assert.deepEqual(new EmoteSounds("http://test/s.json").settings, { volume: 0.7, muted: false });
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const c = new EmoteSounds("http://test/s.json");
    c.setMuted(true); // does not throw
    assert.equal(c.settings.muted, true);
  } finally {
    delete g.localStorage;
  }
});

test("dispose() removes the gesture listeners: a later click makes no new AudioContext (Chinals mode swaps the set)", async () => {
  // A window that honours `signal` like a browser: aborting removes the listener.
  const listeners = new Set<{ type: string; fn: () => void }>();
  const target = {
    addEventListener(type: string, fn: () => void, options?: { signal?: AbortSignal }) {
      const entry = { type, fn };
      listeners.add(entry);
      options?.signal?.addEventListener("abort", () => listeners.delete(entry));
    },
  };
  const g = globalThis as unknown as { window?: unknown; document?: unknown };
  g.window = target;
  g.document = { ...target, hidden: false };
  try {
    let created = 0;
    const sounds = new EmoteSounds("http://test/sounds-1/sounds.json", { fetch: fakeFetch, random: () => 0,
      createContext: () => { created++; return new FakeContext({}, {}) as unknown as AudioContext; } });
    await sounds.load();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(listeners.size >= 6, "gesture and visibility listeners installed");
    const click = () => { for (const l of [...listeners]) if (l.type === "click") l.fn(); };
    click();
    assert.equal(created, 1, "a click unlocks audio");
    sounds.dispose();
    assert.equal(listeners.size, 0, "every listener removed");
    click();
    assert.equal(created, 1, "no context for a disposed object");
    await sounds.prepare(SEQ); // a play() still in flight: no downloads either
  } finally {
    delete g.window;
    delete g.document;
  }
});
