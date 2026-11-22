// A minimal MP4 (ISO BMFF) writer for the viewer's video export (21 Nov 2026): one H.264 video track from WebCodecs
// (avcC description, length-prefixed NAL units) and optionally one audio track (AAC or Opus). The whole file is
// assembled once every sample exists, with the movie box first ("fast start": players and chat embeds can begin before
// the download ends). Each sample is its own chunk, which keeps the sample tables trivial.
//
// Timing: samples arrive in decode order with presentation times. Decode times are the running sum of durations; a
// presentation that differs from its decode time (B-frames) goes in a composition offset table, shifted to be
// non-negative and undone by an edit list. An audio track's encoder delay (AAC priming, Opus pre-skip) is skipped
// by its own edit list, which every mainstream player honours.

export interface Mp4Sample {
  data: Uint8Array;
  /** Presentation time, in the track's timescale. */
  pts: number;
  /** In the track's timescale. */
  duration: number;
  /** A sync sample (keyframe). Audio samples are always sync. */
  key: boolean;
}

export interface Mp4ColorSpace { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }

export interface Mp4VideoTrack {
  width: number;
  height: number;
  timescale: number;
  /** The avcC record (VideoDecoderConfig.description). */
  description: Uint8Array;
  colorSpace?: Mp4ColorSpace | null;
  samples: Mp4Sample[];
}

export interface Mp4AudioTrack {
  codec: "aac" | "opus";
  sampleRate: number;
  channels: number;
  /** AAC: the AudioSpecificConfig. Opus: an OpusHead (its pre-skip is read from it when present). */
  description?: Uint8Array | null;
  /** Encoder delay to skip, in samples (AAC priming; Opus pre-skip when no OpusHead says it). */
  delay?: number;
  bitrate?: number;
  samples: Mp4Sample[];
}

const MOVIE_TIMESCALE = 1000;

export class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(part: Uint8Array) { this.parts.push(part); this.length += part.length; return this; }
  u8(v: number) { return this.push(Uint8Array.of(v & 0xff)); }
  u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.push(b); }
  i16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return this.push(b); }
  u24(v: number) { return this.push(Uint8Array.of((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)); }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.push(b); }
  i32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return this.push(b); }
  u64(v: number) { this.u32(Math.floor(v / 2 ** 32)); return this.u32(v % 2 ** 32); }
  ascii(s: string) { return this.push(Uint8Array.from(s, c => c.charCodeAt(0))); }
  zeros(n: number) { return this.push(new Uint8Array(n)); }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

export function box(type: string, ...children: (Uint8Array | Bytes)[]): Uint8Array {
  const body = new Bytes();
  for (const child of children) body.push(child instanceof Bytes ? child.bytes() : child);
  if (body.length + 8 > 0xffffffff) throw new Error("MP4 box too large");
  return new Bytes().u32(body.length + 8).ascii(type).push(body.bytes()).bytes();
}
export function fullBox(type: string, version: number, flags: number, ...children: (Uint8Array | Bytes)[]): Uint8Array {
  return box(type, new Bytes().u8(version).u24(flags), ...children);
}

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
export function matrix(b: Bytes) { for (const v of MATRIX) b.u32(v); return b; }

// Colour codes (ISO/IEC 23091-2) for the WebCodecs VideoColorSpace names.
const PRIMARIES: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, "iec61966-2-1": 13, linear: 8, pq: 16, hlg: 18 };
const MATRIX_COEFFICIENTS: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, "bt2020-ncl": 9 };
/** Colour codes for a VideoColorSpace (2 = unspecified). */
export function colorCodes(c: Mp4ColorSpace | null | undefined) {
  return { primaries: PRIMARIES[c?.primaries ?? ""] ?? 2, transfer: TRANSFER[c?.transfer ?? ""] ?? 2,
    matrix: MATRIX_COEFFICIENTS[c?.matrix ?? ""] ?? 2, fullRange: !!c?.fullRange };
}

/** Run-length time-to-sample entries. */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); }
  return out;
}

interface Laid { offsets: number[] }

function sampleTables(samples: Mp4Sample[], laid: Laid, sync: boolean): { boxes: Uint8Array[]; shift: number; start: number } {
  const durations = samples.map(s => s.duration);
  const decode: number[] = [];
  let t = 0;
  for (const d of durations) { decode.push(t); t += d; }
  const offsets = samples.map((s, i) => s.pts - decode[i]);
  const shift = Math.max(0, -Math.min(0, ...offsets));
  const boxes: Uint8Array[] = [];
  const stts = new Bytes(), timeRuns = runs(durations);
  stts.u32(timeRuns.length);
  for (const [count, delta] of timeRuns) stts.u32(count).u32(delta);
  boxes.push(fullBox("stts", 0, 0, stts));
  if (offsets.some(o => o + shift !== 0)) {
    const ctts = new Bytes(), offsetRuns = runs(offsets.map(o => o + shift));
    ctts.u32(offsetRuns.length);
    for (const [count, offset] of offsetRuns) ctts.u32(count).u32(offset);
    boxes.push(fullBox("ctts", 0, 0, ctts));
  }
  if (sync && samples.some(s => !s.key)) {
    const keys = samples.flatMap((s, i) => s.key ? [i + 1] : []);
    const stss = new Bytes().u32(keys.length);
    for (const k of keys) stss.u32(k);
    boxes.push(fullBox("stss", 0, 0, stss));
  }
  boxes.push(fullBox("stsc", 0, 0, new Bytes().u32(1).u32(1).u32(1).u32(1)));
  const stsz = new Bytes().u32(0).u32(samples.length);
  for (const s of samples) stsz.u32(s.data.length);
  boxes.push(fullBox("stsz", 0, 0, stsz));
  const stco = new Bytes().u32(samples.length);
  for (const offset of laid.offsets) {
    if (offset > 0xffffffff) throw new Error("MP4 over 4 GB");
    stco.u32(offset);
  }
  boxes.push(fullBox("stco", 0, 0, stco));
  const start = samples.length ? Math.min(...samples.map((_, i) => decode[i] + offsets[i])) + shift : 0;
  return { boxes, shift, start };
}

function editList(mediaTime: number, movieDuration: number): Uint8Array {
  return box("edts", fullBox("elst", 0, 0, new Bytes().u32(1).u32(movieDuration).i32(mediaTime).u16(1).u16(0)));
}

function trackHeader(id: number, duration: number, audio: boolean, width = 0, height = 0): Uint8Array {
  const b = new Bytes().u32(0).u32(0).u32(id).u32(0).u32(duration).zeros(8)
    .u16(0).u16(audio ? 1 : 0).u16(audio ? 0x0100 : 0).u16(0);
  matrix(b).u32(width * 65536).u32(height * 65536);
  return fullBox("tkhd", 0, 3, b);
}

function mediaHeader(timescale: number, duration: number): Uint8Array {
  return fullBox("mdhd", 0, 0, new Bytes().u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0)); // "und"
}

function handler(type: string, name: string): Uint8Array {
  return fullBox("hdlr", 0, 0, new Bytes().u32(0).ascii(type).zeros(12).ascii(name).u8(0));
}

const dataInfo = () => box("dinf", fullBox("dref", 0, 0, new Bytes().u32(1), fullBox("url ", 0, 1)));

function videoEntry(track: Mp4VideoTrack): Uint8Array {
  const b = new Bytes().zeros(6).u16(1).zeros(16).u16(track.width).u16(track.height)
    .u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x18).i16(-1);
  const children = [box("avcC", track.description)];
  if (track.colorSpace) {
    const c = colorCodes(track.colorSpace);
    children.push(box("colr", new Bytes().ascii("nclx").u16(c.primaries).u16(c.transfer).u16(c.matrix).u8(c.fullRange ? 0x80 : 0)));
  }
  children.push(box("pasp", new Bytes().u32(1).u32(1)));
  return box("avc1", b, ...children);
}

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  if (body.length > 0x0fffffff) throw new Error("Descriptor too large");
  const size = [(body.length >>> 21) & 0x7f | 0x80, (body.length >>> 14) & 0x7f | 0x80, (body.length >>> 7) & 0x7f | 0x80, body.length & 0x7f];
  return new Bytes().u8(tag).push(Uint8Array.from(size)).push(body).bytes();
}

/** AudioSpecificConfig for AAC-LC when the encoder gave none. */
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const index = rates.indexOf(sampleRate);
  if (index < 0) throw new Error(`No AAC rate index for ${sampleRate} Hz`);
  return Uint8Array.of((2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3));
}

/** An OpusHead's pre-skip (little-endian, bytes 10-11), or null if `head` is not one. */
export function opusPreSkip(head: Uint8Array | null | undefined): number | null {
  if (!head || head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== "OpusHead") return null;
  return head[10] | (head[11] << 8);
}

function audioEntry(track: Mp4AudioTrack, preSkip: number): Uint8Array {
  const b = new Bytes().zeros(6).u16(1).zeros(8).u16(track.channels).u16(16).u16(0).u16(0).u32(track.sampleRate * 65536);
  if (track.codec === "opus") {
    const dOps = new Bytes().u8(0).u8(track.channels).u16(preSkip).u32(track.sampleRate).i16(0).u8(0);
    return box("Opus", b, box("dOps", dOps));
  }
  const config = track.description?.length ? track.description : aacConfig(track.sampleRate, track.channels);
  const bitrate = track.bitrate ?? 0;
  const decoderConfig = descriptor(0x04, new Bytes().u8(0x40).u8((0x05 << 2) | 1).u24(0).u32(bitrate).u32(bitrate)
    .push(descriptor(0x05, config)).bytes());
  const es = descriptor(0x03, new Bytes().u16(1).u8(0).push(decoderConfig).push(descriptor(0x06, Uint8Array.of(2))).bytes());
  return box("mp4a", b, fullBox("esds", 0, 0, es));
}

function moov(video: Mp4VideoTrack, audio: Mp4AudioTrack | null, videoLaid: Laid, audioLaid: Laid | null): Uint8Array {
  const videoTables = sampleTables(video.samples, videoLaid, true);
  const videoMedia = video.samples.reduce((n, s) => n + s.duration, 0);
  const videoMovie = Math.round(videoMedia * MOVIE_TIMESCALE / video.timescale);
  const tracks: Uint8Array[] = [];
  const videoEdit = videoTables.start ? [editList(videoTables.start, videoMovie)] : [];
  tracks.push(box("trak", trackHeader(1, videoMovie, false, video.width, video.height), ...videoEdit,
    box("mdia", mediaHeader(video.timescale, videoMedia), handler("vide", "VideoHandler"),
      box("minf", fullBox("vmhd", 0, 1, new Bytes().zeros(8)), dataInfo(),
        box("stbl", fullBox("stsd", 0, 0, new Bytes().u32(1), videoEntry(video)), ...videoTables.boxes)))));
  let movie = videoMovie;
  if (audio && audioLaid) {
    const preSkip = audio.codec === "opus" ? opusPreSkip(audio.description) ?? audio.delay ?? 0 : 0;
    const delay = audio.codec === "opus" ? preSkip : audio.delay ?? 0;
    const tables = sampleTables(audio.samples, audioLaid, false);
    const media = audio.samples.reduce((n, s) => n + s.duration, 0);
    const audioMovie = Math.max(0, Math.round((media - delay) * MOVIE_TIMESCALE / audio.sampleRate));
    movie = Math.max(movie, audioMovie);
    const edit = delay + tables.start ? [editList(delay + tables.start, audioMovie)] : [];
    tracks.push(box("trak", trackHeader(2, audioMovie, true), ...edit,
      box("mdia", mediaHeader(audio.sampleRate, media), handler("soun", "SoundHandler"),
        box("minf", fullBox("smhd", 0, 0, new Bytes().u32(0)), dataInfo(),
          box("stbl", fullBox("stsd", 0, 0, new Bytes().u32(1), audioEntry(audio, preSkip)), ...tables.boxes)))));
  }
  const header = new Bytes().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movie).u32(0x00010000).u16(0x0100).zeros(10);
  matrix(header).zeros(24).u32(tracks.length + 1);
  return box("moov", fullBox("mvhd", 0, 0, header), ...tracks);
}

/** The whole MP4 file. Sample data is referenced, not copied, until the Blob is made. */
export function muxMp4(video: Mp4VideoTrack, audio: Mp4AudioTrack | null = null): Blob {
  const ftyp = box("ftyp", new Bytes().ascii("isom").u32(0x200).ascii("isomiso2avc1mp41"));
  const samples = [...video.samples, ...(audio?.samples ?? [])];
  const payload = samples.reduce((n, s) => n + s.data.length, 0);
  const large = payload + 8 > 0xffffffff;
  const mdatHeader = large ? new Bytes().u32(1).ascii("mdat").u64(payload + 16).bytes() : new Bytes().u32(payload + 8).ascii("mdat").bytes();
  const lay = (base: number) => {
    let offset = base;
    const place = (list: Mp4Sample[]) => list.map(s => { const at = offset; offset += s.data.length; return at; });
    return { video: { offsets: place(video.samples) }, audio: audio ? { offsets: place(audio.samples) } : null };
  };
  // The movie box's size does not depend on the offsets it holds (32-bit entries): measure it, then write it for real.
  const size = moov(video, audio, lay(0).video, lay(0).audio).length;
  const laid = lay(ftyp.length + size + mdatHeader.length);
  const movie = moov(video, audio, laid.video, laid.audio);
  if (movie.length !== size) throw new Error("MP4 movie box size changed");
  return new Blob([ftyp, movie, mdatHeader, ...samples.map(s => s.data)] as BlobPart[], { type: "video/mp4" });
}

/** The H.264 codec string (High, then Main, then Constrained Baseline) at the lowest level that fits the stream. */
export function avcCodecs(width: number, height: number, fps: number): string[] {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16), rate = blocks * fps;
  // [level_idc, MaxFS (macroblocks per frame), MaxMBPS]
  const levels: [number, number, number][] = [[0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760],
    [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600],
    [0x3c, 139264, 4177920], [0x3d, 139264, 8355840], [0x3e, 139264, 16711680]];
  const level = levels.find(([, fs, mbps]) => blocks <= fs && rate <= mbps && Math.max(width, height) <= Math.sqrt(8 * fs) * 16);
  if (!level) return [];
  const hex = level[0].toString(16).padStart(2, "0");
  return [`avc1.6400${hex}`, `avc1.4d00${hex}`, `avc1.42e0${hex}`];
}
