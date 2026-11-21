import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 as nodeCrc32 } from "node:zlib";
import * as THREE from "three";
import { tileGrid } from "../src/rig/ViewerScreenshot";
import { framePlan, videoSizes } from "../src/rig/VideoExport";
import { avcCodecs, muxMp4, type Mp4Sample } from "../src/lib/mp4-mux";
import { muxWebm, opusHead, vint, vp9Codec } from "../src/lib/webm-mux";
import { ZipStoreWriter, crc32 } from "../src/lib/zip-store";
import { encodeWav } from "../src/lib/wav-encode";
import { RigAnimator, type AnimationManifest } from "../src/rig/RigAnimator";
import { EmoteSounds, seededRandom, type SoundsManifest } from "../src/rig/EmoteSounds";

// The video export (21 Nov 2026): the frame plan, the sizes offered, the supersampling tiles, the three containers
// (read back with small parsers written from the specs, not from the writers), the WAV, the animator's recording
// clock and the offline sound schedule. The GPU render and WebCodecs encoding are checked in the browser.

test("frame plan: a one-shot records its first to last frame; a loop one pass without the repeat", () => {
  const once = framePlan({ duration: 2, loop: false });
  assert.equal(once.frames, 121);
  assert.equal(once.time(0), 0);
  assert.equal(once.time(120), 2);
  assert.equal(framePlan({ duration: 2, loop: true }).frames, 120);
  const odd = framePlan({ duration: 4.21, loop: false });
  assert.equal(odd.frames, 253, "252.6 frames: frames 0-252");
  assert.ok(Math.abs(odd.time(252) - 4.2) < 1e-9);
  assert.equal(odd.duration, 253 / 60);
  assert.equal(framePlan({ duration: 0, loop: false }).frames, 1, "never empty");
});

test("video sizes keep the stage's shape at even sizes within the budget", () => {
  const sizes = videoSizes(1500, 844, 3840 * 2176, 16384);
  assert.deepEqual(sizes.map(s => s.label), ["480p", "720p", "1080p", "1440p", "2160p"]);
  for (const s of sizes) {
    assert.equal(s.width % 2, 0); assert.equal(s.height % 2, 0);
    assert.ok(Math.abs(s.width / s.height - 1500 / 844) < 0.01, JSON.stringify(s));
  }
  assert.deepEqual(videoSizes(1500, 844, 1920 * 1088, 16384).map(s => s.label), ["480p", "720p", "1080p"], "a phone's cap");
  assert.deepEqual(videoSizes(1500, 844, 1e9, 2048).map(s => s.label), ["480p", "720p", "1080p"], "the GPU's side limit");
  assert.deepEqual(videoSizes(0, 0, 1e9, 4096), []);
});

test("tiles cover the supersampled image in equal tiles of whole output pixels, at most the tile limit", () => {
  for (const [w, h, max, k] of [[4800, 2800, 2048, 2], [1600, 900, 2048, 2], [9000, 5000, 1024, 3], [10, 10, 2048, 1], [7680, 4320, 2048, 4]]) {
    const g = tileGrid(w, h, max, k);
    assert.equal(g.tileWidth % k, 0); assert.equal(g.tileHeight % k, 0);
    assert.ok(g.tileWidth <= max && g.tileHeight <= max, JSON.stringify(g));
    assert.ok(g.columns * g.tileWidth >= w && g.rows * g.tileHeight >= h, "covers");
    assert.ok((g.columns - 1) * g.tileWidth < w && (g.rows - 1) * g.tileHeight < h, "no empty tile");
  }
  assert.deepEqual(tileGrid(4800, 2800, 2048, 2), { columns: 3, rows: 2, tileWidth: 1600, tileHeight: 1400 }, "balanced, not 2048 + slivers");
  assert.deepEqual(tileGrid(1600, 900, 2048, 2), { columns: 1, rows: 1, tileWidth: 1600, tileHeight: 900 }, "one tile when it fits");
});

// --- MP4, read with a box parser written from ISO/IEC 14496-12 ------------------------------------------------------
interface Box { type: string; start: number; size: number; body: number }
function boxes(bytes: Uint8Array, from = 0, to = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset), out: Box[] = [];
  for (let at = from; at < to;) {
    let size = view.getUint32(at), body = at + 8;
    if (size === 1) { size = Number(view.getBigUint64(at + 8)); body += 8; }
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, size, body });
    assert.ok(size >= 8, "box size");
    at += size;
  }
  return out;
}
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
function find(bytes: Uint8Array, path: string[], within?: Box): Box[] {
  const list = boxes(bytes, within ? within.body : 0, within ? within.start + within.size : bytes.length);
  const [head, ...rest] = path;
  const hits = list.filter(b => b.type === head);
  if (!rest.length) return hits;
  return hits.flatMap(b => CONTAINERS.has(b.type) ? find(bytes, rest, b) : []);
}
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
const i32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getInt32(at);

const sample = (n: number, pts: number, key: boolean, duration = 1000): Mp4Sample =>
  ({ data: Uint8Array.from({ length: 10 + n }, (_, i) => (n * 31 + i) & 0xff), pts, duration, key });

test("MP4: fast start, sample tables point at each sample's bytes, keyframes and the audio delay's edit list", async () => {
  const video = [0, 1, 2, 3].map(i => sample(i, i * 1000, i % 2 === 0));
  const audio = [0, 1, 2].map(i => ({ ...sample(20 + i, i * 1024, true), duration: 1024 }));
  const avcC = Uint8Array.of(1, 0x64, 0, 0x2a, 0xff, 0xe1, 0, 0);
  const blob = muxMp4({ width: 1920, height: 1080, timescale: 60000, description: avcC,
    colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false }, samples: video },
  { codec: "aac", sampleRate: 48000, channels: 2, description: Uint8Array.of(0x11, 0x90), delay: 1024, samples: audio });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(boxes(bytes).map(b => b.type), ["ftyp", "moov", "mdat"], "movie box before the data");
  const traks = find(bytes, ["moov", "trak"]);
  assert.equal(traks.length, 2);
  const check = (trak: Box, list: Mp4Sample[]) => {
    const [stsz] = find(bytes, ["mdia", "minf", "stbl", "stsz"], trak), [stco] = find(bytes, ["mdia", "minf", "stbl", "stco"], trak);
    assert.equal(u32(bytes, stsz.body + 8), list.length);
    assert.equal(u32(bytes, stco.body + 4), list.length);
    list.forEach((s, i) => {
      assert.equal(u32(bytes, stsz.body + 12 + i * 4), s.data.length);
      const at = u32(bytes, stco.body + 8 + i * 4);
      assert.deepEqual([...bytes.subarray(at, at + s.data.length)], [...s.data], `sample ${i} at its offset`);
    });
  };
  check(traks[0], video);
  check(traks[1], audio);
  const [stss] = find(bytes, ["mdia", "minf", "stbl", "stss"], traks[0]);
  assert.deepEqual([u32(bytes, stss.body + 4), u32(bytes, stss.body + 8), u32(bytes, stss.body + 12)], [2, 1, 3], "sync samples 1 and 3");
  assert.equal(find(bytes, ["mdia", "minf", "stbl", "ctts"], traks[0]).length, 0, "no reordering, no ctts");
  assert.equal(find(bytes, ["edts"], traks[0]).length, 0, "video starts at 0");
  const [elst] = find(bytes, ["edts", "elst"], traks[1]);
  assert.equal(i32(bytes, elst.body + 12), 1024, "the AAC priming is skipped");
  const [stsd] = find(bytes, ["mdia", "minf", "stbl", "stsd"], traks[0]);
  const entry = stsd.body + 8;
  assert.equal(String.fromCharCode(...bytes.subarray(entry + 4, entry + 8)), "avc1");
  assert.deepEqual([new DataView(bytes.buffer).getUint16(entry + 32), new DataView(bytes.buffer).getUint16(entry + 34)], [1920, 1080]);
  const inner = boxes(bytes, entry + 8 + 78, entry + u32(bytes, entry)).map(b => b.type);
  assert.deepEqual(inner, ["avcC", "colr", "pasp"]);
  const [mdhd] = find(bytes, ["mdia", "mdhd"], traks[0]);
  assert.deepEqual([u32(bytes, mdhd.body + 12), u32(bytes, mdhd.body + 16)], [60000, 4000], "timescale and duration");
});

test("MP4: reordered frames get non-negative composition offsets and an edit list to the first shown frame", async () => {
  // Decode order I P B B with presentation 0 3 1 2 (frames of 1000 ticks).
  const video = [sample(0, 0, true), sample(1, 3000, false), sample(2, 1000, false), sample(3, 2000, false)];
  const bytes = new Uint8Array(await muxMp4({ width: 64, height: 64, timescale: 60000, description: Uint8Array.of(1), samples: video }).arrayBuffer());
  const [trak] = find(bytes, ["moov", "trak"]);
  const [ctts] = find(bytes, ["mdia", "minf", "stbl", "ctts"], trak);
  const entries = u32(bytes, ctts.body + 4), offsets: number[] = [];
  for (let i = 0; i < entries; i++) for (let n = 0; n < u32(bytes, ctts.body + 8 + i * 8); n++) offsets.push(u32(bytes, ctts.body + 12 + i * 8));
  // dts 0 1000 2000 3000; offsets pts - dts = 0 2000 -1000 -1000, shifted by 1000.
  assert.deepEqual(offsets, [1000, 3000, 0, 0]);
  const [elst] = find(bytes, ["edts", "elst"], trak);
  assert.equal(i32(bytes, elst.body + 12), 1000, "presentation starts at the first frame");
});

test("H.264 levels: the lowest that fits size and rate", () => {
  assert.equal(avcCodecs(1920, 1080, 60)[0], "avc1.64002a", "1080p60: 4.2");
  assert.equal(avcCodecs(1280, 720, 60)[0], "avc1.640020", "720p60: 3.2");
  assert.equal(avcCodecs(2560, 1440, 60)[0], "avc1.640033", "1440p60: 5.1");
  assert.equal(avcCodecs(3840, 2160, 60)[0], "avc1.640034", "2160p60: 5.2");
  assert.equal(vp9Codec(1920, 1080, 60), "vp09.00.41.08");
  assert.equal(vp9Codec(3840, 2160, 60), "vp09.00.51.08");
});

// --- WebM, read with an EBML parser written from RFC 8794 / the Matroska spec ----------------------------------------
interface El { id: number; start: number; body: number; size: number }
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } {
  const first = bytes[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length };
}
function elements(bytes: Uint8Array, from: number, to: number): El[] {
  const out: El[] = [];
  for (let at = from; at < to;) {
    const id = readVint(bytes, at, true), size = readVint(bytes, at + id.length, false);
    const body = at + id.length + size.length;
    out.push({ id: id.value, start: at, body, size: size.value });
    at = body + size.value;
  }
  return out;
}
const child = (bytes: Uint8Array, parent: El, id: number) => elements(bytes, parent.body, parent.body + parent.size).filter(e => e.id === id);
const uintOf = (bytes: Uint8Array, e: El) => { let v = 0; for (let i = 0; i < e.size; i++) v = v * 256 + bytes[e.body + i]; return v; };

test("WebM: alpha frames ride as BlockAdditions, clusters start on keyframes, SeekHead and Cues point at elements", async () => {
  const frames = [0, 1, 2, 3, 4].map(i => ({ data: Uint8Array.of(0xaa, i), alpha: Uint8Array.of(0xbb, i), time: i * 1000 / 60, key: i % 3 === 0 }));
  const head = opusHead(2, 312, 48000);
  const blob = muxWebm({ width: 640, height: 360, codec: "V_VP9", frameDuration: 1e9 / 60, duration: 5000 / 60, alpha: true,
    colour: { matrix: 1, range: 1, transfer: 1, primaries: 1 }, frames,
    audio: { sampleRate: 48000, channels: 2, head, preSkip: 312, frames: [{ data: Uint8Array.of(0xcc), time: 0 }, { data: Uint8Array.of(0xcd), time: 20 }] } });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const top = elements(bytes, 0, bytes.length);
  assert.deepEqual(top.map(e => e.id.toString(16)), ["1a45dfa3", "18538067"]);
  const segment = top[1];
  assert.equal(segment.body + segment.size, bytes.length, "segment size covers the file");
  const kids = elements(bytes, segment.body, segment.body + segment.size);
  const clusters = kids.filter(e => e.id === 0x1f43b675);
  assert.equal(clusters.length, 2, "keyframes 0 and 3");
  const groups = clusters.flatMap(c => child(bytes, c, 0xa0));
  assert.equal(groups.length, 5, "every video frame in a BlockGroup");
  groups.forEach((g, i) => {
    const [more] = child(bytes, child(bytes, g, 0x75a1)[0], 0xa6);
    assert.equal(uintOf(bytes, child(bytes, more, 0xee)[0]), 1, "BlockAddID 1: alpha");
    const additional = child(bytes, more, 0xa5)[0];
    assert.deepEqual([...bytes.subarray(additional.body, additional.body + additional.size)], [0xbb, i]);
    assert.equal(child(bytes, g, 0xfb).length, i % 3 === 0 ? 0 : 1, "delta frames reference the previous one");
  });
  const audioBlocks = clusters.flatMap(c => child(bytes, c, 0xa3));
  assert.equal(audioBlocks.length, 2);
  assert.equal(bytes[audioBlocks[0].body], 0x82, "track 2");
  // SeekHead positions are relative to the segment's body.
  const [seekHead] = kids.filter(e => e.id === 0x114d9b74);
  const seeks = child(bytes, seekHead, 0x4dbb).map(s => ({
    id: readVint(bytes, child(bytes, s, 0x53ab)[0].body, true).value, at: uintOf(bytes, child(bytes, s, 0x53ac)[0]) }));
  for (const { id, at } of seeks) assert.equal(readVint(bytes, segment.body + at, true).value, id, `seek to ${id.toString(16)}`);
  const [cues] = kids.filter(e => e.id === 0x1c53bb6b);
  const positions = child(bytes, cues, 0xbb).map(p => uintOf(bytes, child(bytes, child(bytes, p, 0xb7)[0], 0xf1)[0]));
  assert.deepEqual(positions.map(p => segment.body + p), clusters.map(c => c.start));
  const [tracks] = kids.filter(e => e.id === 0x1654ae6b);
  const [video] = child(bytes, tracks, 0xae);
  assert.equal(uintOf(bytes, child(bytes, child(bytes, video, 0xe0)[0], 0x53c0)[0]), 1, "AlphaMode 1");
  assert.deepEqual([...vint(127)], [0x40, 0x7f], "127 needs two bytes (all ones is reserved)");
});

// --- Zip, read from the PKWARE APPNOTE layout ------------------------------------------------------------------------
test("zip: stored entries with correct CRCs, a central directory and the end record", async () => {
  const zip = new ZipStoreWriter(new Date(2026, 10, 21, 12, 30, 10));
  const files = [["clip/frame_00000.png", Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)], ["clip/clip.wav", Uint8Array.of(1, 2, 3)],
    ["clip/README.txt", new TextEncoder().encode("ünïcode name ok")]] as const;
  for (const [name, data] of files) zip.add(name, data);
  const bytes = new Uint8Array(await zip.finish().arrayBuffer()), view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), files.length);
  let at = view.getUint32(end + 16, true);
  for (const [name, data] of files) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const crc = view.getUint32(at + 16, true), size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)), name);
    assert.equal(crc, nodeCrc32(data), "CRC-32 as zlib computes it");
    assert.equal(size, data.length);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    assert.deepEqual([...bytes.subarray(dataAt, dataAt + size)], [...data]);
    at += 46 + nameLength;
  }
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "the CRC-32 check value");
});

test("WAV: 16-bit PCM, interleaved, clamped", () => {
  const wav = encodeWav([Float32Array.of(0, 1, -1, 2), Float32Array.of(0.5, -0.5, 0, -2)], 48000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 16);
  const samples = Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true));
  assert.deepEqual(samples, [0, 16384, 32767, -16384, -32768, 0, 32767, -32768]);
});

// --- The animator's recording clock ----------------------------------------------------------------------------------
const Q = 32767, P = 1e5;
const qInts = (q: THREE.Quaternion) => q.toArray().map(v => Math.round(v * Q));
const turn = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));
function clipJson(id: string, degrees: number, frames = 31) {
  return { formatVersion: 1, id, frameTime: 1 / 30, qScale: Q, pScale: P,
    q: [["pelvis", [0, frames - 1], [...qInts(turn(degrees)), ...qInts(turn(degrees))]]],
    p: [["pelvis", [0, frames - 1], [0, 100000, 0, 0, 110000, 0]]] };
}
const animManifest: AnimationManifest = { formatVersion: 1, defaultIdle: "idle", clips: [
  { id: "idle", label: "Idle", kind: "idle", loop: true, duration: 1, file: "idle.json", bytes: 0 },
  { id: "wave", label: "Wave", kind: "emote", loop: false, duration: 1, file: "wave.json", bytes: 0 },
  { id: "bow", label: "Bow", kind: "emote", loop: false, duration: 1, file: "bow.json", bytes: 0 },
] };
const clipFiles: Record<string, unknown> = { "idle.json": clipJson("idle", 30), "wave.json": clipJson("wave", 90), "bow.json": clipJson("bow", -60) };
function stubClips() {
  globalThis.fetch = (async (url: string) => {
    const file = String(url).split("/").pop()!;
    return { ok: file in clipFiles, status: 200, json: async () => clipFiles[file] } as Response;
  }) as typeof fetch;
}
function body() {
  const group = new THREE.Group(), root = new THREE.Bone(), pelvis = new THREE.Bone();
  root.name = "root"; pelvis.name = "pelvis";
  pelvis.position.set(0, 1, 0);
  root.add(pelvis); group.add(root);
  return { group, pelvis };
}
const angle = (q: THREE.Quaternion) => THREE.MathUtils.radToDeg(2 * Math.atan2(q.z, q.w));

test("recording: the clip alone at the given times, the live clock ignored, the viewer put back after", async () => {
  stubClips();
  const { group, pelvis } = body();
  const animator = new RigAnimator(animManifest, "clips/");
  await animator.play(group, "idle");
  for (let i = 0; i < 6; i++) animator.update(0.05);
  await animator.play(group, "wave");
  for (let i = 0; i < 8; i++) animator.update(0.05); // mid-crossfade from the idle, 0.4 s in
  const before = animator.timeline()!.time;
  const clip = animator.beginRecording()!;
  assert.deepEqual({ clip: clip.clip, loop: clip.loop, duration: clip.duration }, { clip: "wave", loop: false, duration: 1 });
  assert.equal(animator.recording, true);
  assert.ok(Math.abs(pelvis.position.y - 1.0) < 1e-4, `frame 0 at the clip's start, got ${pelvis.position.y}`);
  assert.ok(Math.abs(angle(pelvis.quaternion) - 90) < 0.05, "the emote alone: the idle under it is stopped");
  animator.recordFrame(0.5, 1 / 60);
  assert.ok(Math.abs(pelvis.position.y - 1.05) < 1e-4, `at 0.5 s, got ${pelvis.position.y}`);
  animator.update(0.25); // the viewer's own clock does nothing while recording
  assert.ok(Math.abs(pelvis.position.y - 1.05) < 1e-4);
  animator.setPaused(true); animator.seek(0.9); // nor does the transport
  assert.ok(Math.abs(pelvis.position.y - 1.05) < 1e-4);
  animator.recordFrame(1, 1 / 60);
  assert.ok(Math.abs(pelvis.position.y - 1.1) < 1e-4, "the last frame, without ending the emote");
  assert.equal(animator.state.current, "wave");
  assert.equal(animator.recordingCurrent(), true);
  animator.endRecording();
  assert.equal(animator.recording, false);
  assert.ok(Math.abs(animator.timeline()!.time - before) < 1e-6, "back at the time it was at");
  assert.equal(animator.state.paused, false, "and playing on, as before");
  animator.update(0.05);
  assert.ok(animator.timeline()!.time > before);
});

test("recording: a paused emote stays paused after; a loop records one pass; picking another emote is noticed", async () => {
  stubClips();
  const { group } = body();
  const animator = new RigAnimator(animManifest, "clips/");
  await animator.play(group, "wave");
  animator.update(0.1);
  animator.setPaused(true);
  animator.beginRecording();
  animator.recordFrame(0.7, 1 / 60);
  animator.endRecording();
  assert.equal(animator.state.paused, true);
  assert.ok(Math.abs(animator.timeline()!.time - 0.1) < 1e-6);

  await animator.play(group, "idle");
  const loop = animator.beginRecording()!;
  assert.equal(loop.loop, true);
  assert.equal(framePlan(loop).frames, 60);
  animator.endRecording();

  await animator.play(group, "wave");
  animator.beginRecording();
  await animator.play(group, "bow");
  assert.equal(animator.recordingCurrent(), false, "the export sees the change and stops");
  animator.endRecording();
  assert.equal(animator.state.current, "bow", "and leaves the new emote alone");
});

// --- The offline sound schedule ----------------------------------------------------------------------------------------
class FakeParam {
  value = 1; events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) { this.events.push(["set", v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(["ramp", v, t]); return this; }
}
interface FakeSource { wave: string; rate: number; loop: boolean; when?: number; offset?: number; stop?: number; gain: FakeParam }
class FakeOffline {
  static last: FakeOffline;
  sources: FakeSource[] = [];
  destination = {};
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) { FakeOffline.last = this; }
  async decodeAudioData(data: ArrayBuffer) { return { duration: { 1: 0.5, 2: 3, 3: 4 }[data.byteLength]!, name: { 1: "Clap", 2: "Voice", 3: "Music" }[data.byteLength]! }; }
  createGain() { const gain = new FakeParam(); return { gain, connect: (n: unknown) => n }; }
  createBufferSource() {
    const ctx = this;
    const source = { buffer: null as { name: string } | null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: { value: 1 },
      record: null as FakeSource | null,
      connect(node: { gain: FakeParam }) { this.record = { wave: this.buffer!.name, rate: this.playbackRate.value, loop: this.loop, gain: node.gain }; ctx.sources.push(this.record); return node; },
      start(when: number, offset: number) { this.record!.when = when; this.record!.offset = offset; },
      stop(when: number) { this.record!.stop = when; } };
    return source;
  }
  async startRendering() {
    const data = [new Float32Array(4), new Float32Array(4)];
    data[0][1] = 1.6; // a loud peak: the track is scaled to fit
    return { numberOfChannels: 2, length: 4, sampleRate: this.sampleRate, getChannelData: (c: number) => data[c] };
  }
}

test("offline sound: windows stop at their end (or the clip's), loops cover the pass, picks are seeded, peaks fit", async () => {
  const manifest: SoundsManifest = { formatVersion: 1,
    files: { Clap: { file: "Clap.m4a", bytes: 1, duration: 0.5, channels: 2 }, Voice: { file: "Voice.m4a", bytes: 2, duration: 3, channels: 2 },
      Music: { file: "Music.m4a", bytes: 3, duration: 4, channels: 2 } },
    emotes: {
      Seq: [
        { start: 1, kind: "window", duration: 0.4, fadeOut: 0.1, sound: "Clap_Cue", variants: [{ wave: "Clap", weight: 1, gain: 1, rate: 1 }] },
        { start: 2, kind: "window", duration: 5, sound: "Voice_Cue", variants: [{ wave: "Voice", weight: 1, gain: [0.5, 0.7], rate: [0.95, 1.05] }] },
      ],
      Loop: [{ start: 0, kind: "window", duration: 6, fadeOut: 1, attack: 0.05, syncGroup: "AudioSyncGroup.MariachiBand", sound: "Music",
        variants: [{ wave: "Music", weight: 1, gain: 1, rate: 1, loop: true }] }],
    } };
  const sizes: Record<string, number> = { "Clap.m4a": 1, "Voice.m4a": 2, "Music.m4a": 3 };
  const fetchStub = (async (url: string) => url.endsWith("sounds.json") ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(sizes[url.split("/").at(-1)!]) }) as unknown as typeof fetch;
  (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOffline;
  try {
    const sounds = new EmoteSounds("http://test/sounds.json", { fetch: fetchStub });
    const once = await sounds.renderOffline("Seq", { duration: 3.5, clipLength: 3.5, looping: false });
    assert.ok(once);
    assert.equal(FakeOffline.last.length, Math.round(3.5 * 48000));
    const [clap, voice] = FakeOffline.last.sources;
    assert.deepEqual([clap.when, clap.offset], [1, 0]);
    assert.ok(Math.abs(clap.stop! - (1.4 + 0.1 + 0.01)) < 1e-9, "the clap's window ends at 1.4 s over its fade");
    assert.ok(voice.stop === undefined || voice.stop > 3.5, "the voice runs to the recording's end");
    const random = seededRandom("Seq");
    random(); // the clap's variant (its gain and rate are fixed: no draw)
    random(); // the voice's variant
    const gain = 0.5 + 0.2 * random(), rate = 0.95 + 0.1 * random();
    assert.ok(Math.abs(voice.gain.value - gain) < 1e-9 && Math.abs(voice.rate - rate) < 1e-9, "seeded picks, the same every export");
    assert.ok(once.peak === Math.fround(1.6) && Math.abs(once.scaled - 0.999 / Math.fround(1.6)) < 1e-9, "scaled to fit, not clipped");

    // A one-shot emote that ends at 2.5 s: the voice window stops there (a natural end), with the default fade.
    await sounds.renderOffline("Seq", { duration: 3.5, clipLength: 2.5, looping: false });
    assert.ok(Math.abs(FakeOffline.last.sources[1].stop! - (2.5 + 0.25 + 0.01)) < 1e-9);

    // A looping clip whose musical window covers the pass: the track carries on, looping from the top of its wave.
    await sounds.renderOffline("Loop", { duration: 6, clipLength: 6, looping: true });
    const [music] = FakeOffline.last.sources;
    assert.equal(music.loop, true);
    assert.equal(music.stop, undefined);
    assert.deepEqual(music.gain.events.slice(0, 2), [["set", 0, 0], ["ramp", 1, 0.05]], "the attack");
    assert.equal(await sounds.renderOffline("Nope", { duration: 1, clipLength: 1, looping: false }), null);
  } finally {
    delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
  }
});

test("transparent WebM helpers: colour bleeds into transparent pixels only; the alpha plane is the luma", async () => {
  const { bleedColour, alphaPlanes } = await import("../src/rig/VideoExport");
  // 4 x 2: one covered red pixel at (1, 0) with soft alpha, the rest transparent black.
  const rgba = new Uint8Array(4 * 2 * 4);
  rgba.set([200, 10, 20, 128], 1 * 4);
  bleedColour(rgba, 4, 2, 1);
  const px = (x: number, y: number) => [...rgba.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  assert.deepEqual(px(1, 0), [200, 10, 20, 128], "the covered pixel is untouched");
  assert.deepEqual(px(0, 0), [200, 10, 20, 0], "a neighbour takes its colour, still fully transparent");
  assert.deepEqual(px(1, 1), [200, 10, 20, 0]);
  assert.deepEqual(px(3, 0), [0, 0, 0, 0], "one pass reaches one pixel");
  const planes = alphaPlanes(Uint8Array.of(1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30, 0, 0, 0, 40), 2, 2);
  assert.deepEqual([...planes], [10, 20, 30, 40, 128, 128], "Y = alpha, then one U and one V sample, flat");
});
