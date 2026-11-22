import { Bytes, box, fullBox, matrix } from "./mp4-mux";

// A QuickTime movie (.mov) writer for the video export's lossless transparent format (22 Nov 2026): one video track of
// QuickTime Animation keyframes (qtrle-encode.ts) and, optionally, 16-bit PCM sound.
//
// QuickTime is the format ISO BMFF (MP4) grew from, so the boxes are mp4-mux's. The layout copies what ffmpeg writes
// for `-c:v qtrle -pix_fmt argb -c:a pcm_s16le`, checked box by box against such a file, because that is the form
// editors are known to import:
// - the 'qt  ' brand;
// - handler boxes with a component type ('mhlr' for the media, 'dhlr' for the data) and a Pascal-string name;
// - language 0x7FFF (unspecified), an edit list per track from 0;
// - an 'rle ' sample entry of depth 32 (the alpha), with 'fiel' (progressive) and 'pasp' (square pixels);
// - 'sowt' sound (signed 16-bit little-endian), sound description version 0, a 'chan' layout for mono or stereo, and
//   one PCM frame per sample (sample size 4 for 16-bit stereo).
// Every frame is a sync sample, so there is no sync-sample table. Each video frame is its own chunk, preceded by its
// share of the sound as a chunk (interleaved: an editor reading a frame finds its sound beside it). The movie box comes
// first. Frame data is referenced, not copied, until the Blob is made: Blobs can live in the browser's blob storage,
// which spills to disk.

export type MovFrame = Blob | Uint8Array;

export interface MovVideo {
  width: number;
  height: number;
  /** Whole frames per second. */
  fps: number;
  /** QuickTime Animation frames, all keyframes. */
  frames: MovFrame[];
}

export interface MovSound {
  sampleRate: number;
  channels: number;
  /** Interleaved signed 16-bit little-endian PCM. */
  pcm: Uint8Array;
}

const MOVIE_TIMESCALE = 1000;
const LANGUAGE_UNSPECIFIED = 0x7fff;
/** Core Audio channel layout tags: kAudioChannelLayoutTag_Mono and _Stereo. */
const CHANNEL_LAYOUT: Record<number, number> = { 1: (100 << 16) | 1, 2: (101 << 16) | 2 };

const sizeOf = (frame: MovFrame) => frame instanceof Blob ? frame.size : frame.length;

/** A QuickTime handler box: component type, subtype, 12 reserved bytes and a Pascal-string name. */
function handler(component: "mhlr" | "dhlr", subtype: string, name: string): Uint8Array {
  return fullBox("hdlr", 0, 0, new Bytes().ascii(component).ascii(subtype).zeros(12).u8(name.length).ascii(name));
}

const dataHandler = () => handler("dhlr", "url ", "DataHandler");
const dataInfo = () => box("dinf", fullBox("dref", 0, 0, new Bytes().u32(1), fullBox("url ", 0, 1)));

function trackHeader(id: number, duration: number, sound: boolean, width = 0, height = 0): Uint8Array {
  const b = new Bytes().u32(0).u32(0).u32(id).u32(0).u32(duration).zeros(8)
    .u16(0).u16(sound ? 1 : 0).u16(sound ? 0x0100 : 0).u16(0); // layer, alternate group, volume
  matrix(b).u32(width * 65536).u32(height * 65536);
  return fullBox("tkhd", 0, 3, b); // enabled, in the movie
}

const editList = (movieDuration: number) =>
  box("edts", fullBox("elst", 0, 0, new Bytes().u32(1).u32(movieDuration).i32(0).u16(1).u16(0)));

const mediaHeader = (timescale: number, duration: number) =>
  fullBox("mdhd", 0, 0, new Bytes().u32(0).u32(0).u32(timescale).u32(duration).u16(LANGUAGE_UNSPECIFIED).u16(0));

function animationEntry(width: number, height: number): Uint8Array {
  const name = "Animation";
  const b = new Bytes().zeros(6).u16(1) // reserved, data reference 1
    .u16(0).u16(0).u32(0) // version, revision, vendor
    .u32(0).u32(0x400) // temporal quality (none: every frame stands alone), spatial quality: lossless
    .u16(width).u16(height).u32(0x00480000).u32(0x00480000).u32(0).u16(1) // 72 dpi, data size, one frame per sample
    .u8(name.length).ascii(name).zeros(31 - name.length) // compressor name: a 32-byte Pascal string
    .u16(32).i16(-1); // depth 32: ARGB, "Millions of Colors+"; no colour table
  return box("rle ", b, box("fiel", Uint8Array.of(1, 0)), box("pasp", new Bytes().u32(1).u32(1)));
}

function soundEntry(sound: MovSound): Uint8Array {
  const b = new Bytes().zeros(6).u16(1)
    .u16(0).u16(0).u32(0) // sound description version 0, revision, vendor
    .u16(sound.channels).u16(16).u16(0).u16(0) // channels, bits, compression id, packet size
    .u32(sound.sampleRate * 65536);
  const layout = CHANNEL_LAYOUT[sound.channels];
  const children = layout ? [fullBox("chan", 0, 0, new Bytes().u32(layout).u32(0).u32(0))] : [];
  return box("sowt", b, ...children);
}

/** Chunk offsets: 32-bit unless the file passes 4 GB. */
function chunkOffsets(offsets: number[], wide: boolean): Uint8Array {
  const b = new Bytes().u32(offsets.length);
  for (const offset of offsets) {
    if (!wide && offset > 0xffffffff) throw new Error("MOV chunk offset past 4 GB");
    if (wide) b.u64(offset); else b.u32(offset);
  }
  return fullBox(wide ? "co64" : "stco", 0, 0, b);
}

/** Sample-to-chunk runs: a new entry wherever the number of samples per chunk changes. */
function sampleToChunk(perChunk: number[]): Uint8Array {
  const runs: [number, number][] = [];
  perChunk.forEach((count, i) => { if (!runs.length || runs[runs.length - 1][1] !== count) runs.push([i + 1, count]); });
  const b = new Bytes().u32(runs.length);
  for (const [first, count] of runs) b.u32(first).u32(count).u32(1);
  return fullBox("stsc", 0, 0, b);
}

interface Layout { video: number[]; sound: number[]; soundChunks: number[] }

/** Where each chunk lands, from the first byte of the mdat's payload at `base`. */
function lay(video: MovVideo, soundChunks: number[], bytesPerFrame: number, base: number): Layout {
  const out: Layout = { video: [], sound: [], soundChunks: [] };
  let offset = base;
  video.frames.forEach((frame, i) => {
    if (soundChunks[i]) { out.sound.push(offset); out.soundChunks.push(soundChunks[i]); offset += soundChunks[i] * bytesPerFrame; }
    out.video.push(offset);
    offset += sizeOf(frame);
  });
  return out;
}

function moov(video: MovVideo, sound: MovSound | null, layout: Layout, wide: boolean): Uint8Array {
  const frames = video.frames.length, timescale = video.fps * 1000, tick = 1000;
  const videoMovie = Math.round(frames * MOVIE_TIMESCALE / video.fps);
  const stsz = new Bytes().u32(0).u32(frames);
  for (const frame of video.frames) stsz.u32(sizeOf(frame));
  const tracks = [box("trak", trackHeader(1, videoMovie, false, video.width, video.height), editList(videoMovie),
    box("mdia", mediaHeader(timescale, frames * tick), handler("mhlr", "vide", "VideoHandler"),
      box("minf", fullBox("vmhd", 0, 1, new Bytes().zeros(8)), dataHandler(), dataInfo(),
        box("stbl",
          fullBox("stsd", 0, 0, new Bytes().u32(1), animationEntry(video.width, video.height)),
          fullBox("stts", 0, 0, new Bytes().u32(1).u32(frames).u32(tick)),
          sampleToChunk(video.frames.map(() => 1)),
          fullBox("stsz", 0, 0, stsz),
          chunkOffsets(layout.video, wide)))))];
  let movie = videoMovie;
  if (sound && layout.sound.length) {
    const total = layout.soundChunks.reduce((n, c) => n + c, 0);
    const soundMovie = Math.round(total * MOVIE_TIMESCALE / sound.sampleRate);
    movie = Math.max(movie, soundMovie);
    tracks.push(box("trak", trackHeader(2, soundMovie, true), editList(soundMovie),
      box("mdia", mediaHeader(sound.sampleRate, total), handler("mhlr", "soun", "SoundHandler"),
        box("minf", fullBox("smhd", 0, 0, new Bytes().u32(0)), dataHandler(), dataInfo(),
          box("stbl",
            fullBox("stsd", 0, 0, new Bytes().u32(1), soundEntry(sound)),
            fullBox("stts", 0, 0, new Bytes().u32(1).u32(total).u32(1)), // one PCM frame per sample
            sampleToChunk(layout.soundChunks),
            fullBox("stsz", 0, 0, new Bytes().u32(2 * sound.channels).u32(total)),
            chunkOffsets(layout.sound, wide))))));
  }
  const header = new Bytes().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movie).u32(0x00010000).u16(0x0100).zeros(10);
  matrix(header).zeros(24).u32(tracks.length + 1);
  return box("moov", fullBox("mvhd", 0, 0, header), ...tracks);
}

/**
 * The whole .mov. Each video frame's chunk is preceded by the sound of its own 1/fps s (the last frame takes whatever
 * sound remains), so sound and picture start together at 0 with no offset to undo.
 */
export function muxMov(video: MovVideo, sound: MovSound | null = null): Blob {
  if (!video.frames.length) throw new Error("A movie needs at least one frame");
  if (!Number.isInteger(video.fps) || video.fps < 1) throw new Error("Frames per second must be a whole number");
  let soundChunks: number[] = [];
  const bytesPerFrame = sound ? 2 * sound.channels : 0;
  if (sound) {
    if (sound.sampleRate > 0xffff || !Number.isInteger(sound.sampleRate)) throw new Error(`No version 0 sound description for ${sound.sampleRate} Hz`);
    if (sound.channels < 1 || sound.pcm.length % bytesPerFrame) throw new Error("PCM data does not match its channels");
    const total = sound.pcm.length / bytesPerFrame, last = video.frames.length - 1;
    const at = (frame: number) => Math.min(total, Math.round(frame * sound.sampleRate / video.fps));
    soundChunks = video.frames.map((_, i) => (i === last ? total : at(i + 1)) - at(i));
  }
  const payload = video.frames.reduce((n, f) => n + sizeOf(f), 0) + (sound?.pcm.length ?? 0);
  const ftyp = box("ftyp", new Bytes().ascii("qt  ").u32(0x200).ascii("qt  "));
  // The movie box's size does not depend on the offsets it holds: measure it, then write it for real.
  const build = (wide: boolean) => {
    const mdatHeader = wide ? new Bytes().u32(1).ascii("mdat").u64(payload + 16).bytes() : new Bytes().u32(payload + 8).ascii("mdat").bytes();
    const size = moov(video, sound, lay(video, soundChunks, bytesPerFrame, 0), wide).length;
    const layout = lay(video, soundChunks, bytesPerFrame, ftyp.length + size + mdatHeader.length);
    const movie = moov(video, sound, layout, wide);
    if (movie.length !== size) throw new Error("MOV movie box size changed");
    return { mdatHeader, movie, layout, end: ftyp.length + size + mdatHeader.length + payload };
  };
  let built = build(false);
  if (built.end > 0xffffffff) built = build(true);
  const parts = [ftyp, built.movie, built.mdatHeader] as BlobPart[];
  let soundAt = 0;
  video.frames.forEach((frame, i) => {
    const bytes = (soundChunks[i] ?? 0) * bytesPerFrame;
    if (bytes) { parts.push(sound!.pcm.subarray(soundAt, soundAt + bytes) as BlobPart); soundAt += bytes; }
    parts.push(frame as BlobPart);
  });
  return new Blob(parts, { type: "video/quicktime" });
}
