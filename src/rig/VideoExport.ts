import type { BackdropPaint } from "../lib/stage-lighting";
import { encodePngAsync } from "../lib/png-encode";
import { avcCodecs, colorCodes, muxMp4, type Mp4AudioTrack, type Mp4Sample } from "../lib/mp4-mux";
import { muxWebm, opusHead, vp9Codec, type WebmAudioFrame, type WebmVideoFrame } from "../lib/webm-mux";
import { muxMov } from "../lib/mov-mux";
import { QtrleEncoder } from "../lib/qtrle-encode";
import { ZipStoreWriter } from "../lib/zip-store";
import { encodeWav, pcm16le } from "../lib/wav-encode";
import { ViewCapture, type ScreenshotContext } from "./ViewerScreenshot";
import type { RecordableClip, RigAnimator } from "./RigAnimator";

// Emote video export (21 Nov 2026, community request: an emote as a 60 fps video for an edit, rendered on the user's
// own machine). Everything happens in the browser:
//
// Frames are rendered deterministically, not recorded in real time. The animator hands its clock over
// (RigAnimator.beginRecording) and each frame is posed at exactly its clip time (framePlan: frame / 60 s, or within
// the timeline's range, its loops and the emote speed, 22 Nov 2026), the sway chains stepped 1/60 s per frame; then the frame is drawn through a capture of its own (ViewCapture: the screenshot's tiled, fully converged
// render, from a copy of the camera at the start), so every frame is as clean as a screenshot and a slow machine only
// takes longer. The work runs inside the viewer's frame loop (CaptureDriver in CharacterViewer): one frame per
// animation frame, after the contact shadow has been redrawn for the new pose and before the live view draws; the
// next pose is set after the live view has drawn. The live view shows the frames go by.
//
// Formats:
// - MP4: H.264 through WebCodecs' VideoEncoder, on the backdrop, with the emote's sound as AAC (Opus where the browser
//   cannot encode AAC). Plays everywhere.
// - WebM, transparent: VP9 with an alpha plane, Opus sound. Chrome, Edge, Firefox and OBS show the transparency; most
//   editors ignore it. WebCodecs' own alpha ("keep") is not implemented in Chrome (158 says unsupported for VP8, VP9
//   and AV1, 21 Nov 2026), so this does what libvpx does: two VP9 encoders, one for the colour and one whose luma plane
//   IS the alpha (I420 frames, U and V flat), muxed as Matroska BlockAdditions that decoders read as the alpha plane.
//   Keyframes are forced on both at the same frames; colour under fully transparent pixels is bled outward first
//   (bleedColour), so lossy 4:2:0 coding does not pull black into the soft edges.
// - MOV, transparent (22 Nov 2026): QuickTime Animation, 32-bit ARGB, every frame a keyframe, coded here in plain
//   JavaScript (qtrle-encode.ts) from the same straight-alpha pixels as the PNGs, so it is exact; the sound as 16-bit
//   PCM, interleaved frame by frame (mov-mux.ts). Adobe's native .mov list has keyframe-only Animation, and Resolve's
//   codec list has Animation; ffmpeg decodes it exactly (_docs/mov-export-2026-11-22). No browser encodes ProRes 4444,
//   the codec editors would name first, but MOV is only the container. Big files (run-length coding saves the empty
//   background, not the character), so the panel offers it on computers only.
// - PNG sequence, transparent: every frame as a PNG with straight alpha, the sound as a WAV, in one stored zip. Works
//   in every editor.
// The sound is rendered offline from the emote's cues (EmoteSounds.renderOffline), the same rules as playback.

export const FPS = 60;
const KEY_INTERVAL = FPS; // a keyframe every second: seekable, and a WebM cluster per second
const AUDIO_RATE = 48000;
const IN_FLIGHT = 3; // frames drawn but not yet encoded or stored: bounds memory, keeps the GPU and encoders busy

export type VideoFormat = "mp4" | "webm" | "mov" | "png";
export type VideoQuality = "draft" | "standard" | "best";

/** Fine pixels per output pixel (supersample) and jittered samples per fine pixel, per quality. */
export const QUALITY: Record<VideoQuality, { supersample: number; samples: number; label: string; detail: string }> = {
  draft: { supersample: 1, samples: 6, label: "Draft", detail: "fastest; a little grain on hair and lace" },
  standard: { supersample: 1, samples: 16, label: "Standard", detail: "clean, like the view on screen" },
  best: { supersample: 2, samples: 8, label: "Best", detail: "2× supersampled, as crisp as a screenshot; slowest" },
};

/**
 * What part of the clip a video records (22 Nov 2026): clip seconds `from` to `to` (the timeline's range markers),
 * played `loops` times, at `speed` clip seconds per second of video (the emote speed: 0.5 is slow motion). Left out,
 * the whole clip once at normal speed.
 */
export interface ExportRange { from: number; to: number; loops: number; speed: number }

export interface FramePlan extends ExportRange {
  frames: number;
  /** Seconds of video. */
  duration: number;
  /** The clip time a frame shows. */
  time: (frame: number) => number;
}

/**
 * The frames a recording draws. A one-shot runs from the range's first frame to its last (the end pose included); a
 * looping clip (an idle, or an emote with Loop on) runs whole passes without the repeated first frame, so the video
 * itself loops seamlessly. Several loops repeat the range; between passes the motion jumps back to its start.
 */
export function framePlan(clip: Pick<RecordableClip, "duration" | "loop">, fps = FPS, range: Partial<ExportRange> = {}): FramePlan {
  const from = Math.min(Math.max(0, range.from ?? 0), clip.duration);
  const to = Math.min(Math.max(from, range.to ?? clip.duration), clip.duration);
  const loops = Math.max(1, Math.round(range.loops ?? 1));
  const speed = range.speed && range.speed > 0 ? range.speed : 1;
  const length = to - from, total = loops * length;
  const exact = total * fps / speed;
  // A clip's length comes from its float32 key times (three), so a whole number of frames can land a hair under: 340/60 s
  // reads 5.6666665 s, 339.99999 frames. The end pose is still a frame (22 Nov 2026: 1e-6 dropped it).
  const frames = Math.max(1, clip.loop ? Math.round(exact) : Math.floor(exact + 1e-3) + 1);
  const time = (frame: number) => {
    const played = frame * speed / fps; // clip seconds since the range's start
    if (!clip.loop && played >= total - 1e-3 * speed / fps) return to;
    if (length <= 0) return from;
    const pass = Math.floor(played / length + 1e-9);
    return from + Math.max(0, played - pass * length);
  };
  return { frames, duration: frames / fps, from, to, loops, speed, time };
}

/** Even sizes (4:2:0 video) of the stage's shape at common heights, within a pixel budget and the GPU's side limit. */
export function videoSizes(cssWidth: number, cssHeight: number, maxPixels: number, maxSide: number) {
  if (cssWidth <= 0 || cssHeight <= 0) return [];
  const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));
  return [480, 720, 1080, 1440, 2160].map(height => {
    const h = even(height), w = even(height * cssWidth / cssHeight);
    return { label: `${height}p`, width: w, height: h };
  }).filter(s => s.width * s.height <= maxPixels && Math.max(s.width, s.height) <= maxSide);
}

export interface VideoOptions {
  format: VideoFormat;
  width: number;
  height: number;
  quality: VideoQuality;
  keepFloor: boolean;
  sound: boolean;
  backdrop: BackdropPaint;
  maxTile: number;
  /** Memory guard: the finished file (held in memory or the browser's blob storage until saved) may not pass this. */
  maxBytes: number;
  /** The part of the clip, its loops and speed (framePlan); the whole clip once at normal speed when left out. */
  range?: Partial<ExportRange>;
}

export interface VideoProgress { phase: "preparing" | "rendering" | "finishing"; frame: number; frames: number; bytes: number }

export interface VideoResult {
  blob: Blob;
  extension: "mp4" | "webm" | "mov" | "zip";
  frames: number;
  width: number;
  height: number;
  sound: "aac" | "opus" | "pcm" | "wav" | null;
  /** Fewest samples any frame averaged (below the quality's: the scene changed while drawing, some grain). */
  samples: number;
  clip: RecordableClip;
  /** The part of the clip recorded, its loops and speed. */
  plan: FramePlan;
}

/** What the viewer's frame loop runs while an export is going (CaptureDriver). */
export interface CaptureJob {
  /** Before the live view draws: draw the posed frame, if the pipeline has room. */
  capture(): void;
  /** After the live view has drawn: pose the next frame, if this one was drawn. */
  advance(): void;
}
export const captureSlot: { current: CaptureJob | null } = { current: null };

/** What this browser can encode (checked once per session, lazily). */
export interface VideoSupport { mp4: boolean; webm: boolean; aac: boolean; opus: boolean }
let supportCheck: Promise<VideoSupport> | null = null;
export function videoSupport(): Promise<VideoSupport> {
  supportCheck ??= (async () => {
    const video = typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
    const audio = typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined";
    const mp4 = video && !!await pickAvc(1280, 720, 8_000_000);
    const webm = video && await vp9Supported(vp9Codec(1280, 720, FPS), 1280, 720);
    const aac = audio && await audioSupported("mp4a.40.2");
    const opus = audio && await audioSupported("opus");
    return { mp4, webm, aac, opus };
  })().catch(() => ({ mp4: false, webm: false, aac: false, opus: false }));
  return supportCheck;
}

async function pickAvc(width: number, height: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  for (const codec of avcCodecs(width, height, FPS)) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: FPS, avc: { format: "avc" }, latencyMode: "quality" };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* next */ }
  }
  return null;
}

async function vp9Supported(codec: string, width: number, height: number): Promise<boolean> {
  try { return !!(await VideoEncoder.isConfigSupported({ codec, width, height, framerate: FPS, bitrate: 8_000_000 })).supported; }
  catch { return false; }
}

/**
 * Give fully transparent pixels the colour of a covered neighbour, `passes` pixels outward (straight RGBA, in place;
 * alpha untouched). Invisible in the image itself; it keeps lossy, chroma-subsampled video from averaging black into
 * the colour of soft edges, which would show as a dark fringe once composited.
 */
export function bleedColour(rgba: Uint8Array, width: number, height: number, passes = 2): void {
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  const next = new Uint8Array(filled.length);
  for (let pass = 0; pass < passes; pass++) {
    next.set(filled);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!filled[j]) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (!n) continue;
      rgba[i * 4] = Math.round(r / n); rgba[i * 4 + 1] = Math.round(g / n); rgba[i * 4 + 2] = Math.round(b / n);
      next[i] = 1;
    }
    filled.set(next);
  }
}
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** The alpha channel as an I420 frame's planes: luma = alpha (the plane a VP9 alpha decoder reads), chroma flat. */
export function alphaPlanes(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const luma = width * height, chroma = (width >> 1) * (height >> 1), out = new Uint8Array(luma + 2 * chroma);
  for (let i = 0; i < luma; i++) out[i] = rgba[i * 4 + 3];
  out.fill(128, luma);
  return out;
}

async function audioSupported(codec: string): Promise<boolean> {
  try { return !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 192_000 })).supported; }
  catch { return false; }
}

const bitrateFor = (width: number, height: number) => Math.round(Math.min(80e6, Math.max(6e6, width * height * FPS * 0.2)));

const cancelled = () => new DOMException("Cancelled", "AbortError");

/** A copy of a WebCodecs buffer (an ArrayBuffer or a view into one) as its own bytes. */
function bytesOf(source: AllowSharedBufferSource): Uint8Array {
  return source instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && source instanceof SharedArrayBuffer)
    ? new Uint8Array(source as ArrayBuffer).slice()
    : new Uint8Array((source as ArrayBufferView).buffer, (source as ArrayBufferView).byteOffset, (source as ArrayBufferView).byteLength).slice();
}

/** Encode an AudioBuffer with WebCodecs: the chunks and the decoder config the encoder reports. */
async function encodeAudio(buffer: AudioBuffer, codec: string) {
  const chunks: { data: Uint8Array; timestamp: number; duration: number }[] = [];
  let description: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = bytesOf(d);
    },
    error: error => { failure = error; },
  });
  try {
    encoder.configure({ codec, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, bitrate: 192_000 });
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const step = 4800;
    for (let offset = 0; offset < buffer.length; offset += step) {
      const frames = Math.min(step, buffer.length - offset), planar = new Float32Array(frames * channels.length);
      channels.forEach((data, c) => planar.set(data.subarray(offset, offset + frames), c * frames));
      const audio = new AudioData({ format: "f32-planar", sampleRate: buffer.sampleRate, numberOfFrames: frames,
        numberOfChannels: channels.length, timestamp: Math.round(offset * 1e6 / buffer.sampleRate), data: planar });
      encoder.encode(audio);
      audio.close();
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  return { chunks, description: description as Uint8Array | null };
}

/** The encoder delay of an AAC stream, measured: decode it and find where the first sound lands versus the source.
 *  (Platform AAC encoders prime differently and WebCodecs does not say; the MP4's edit list skips what this finds.) */
async function measureAacDelay(source: AudioBuffer, chunks: { data: Uint8Array; timestamp: number; duration: number }[],
  description: Uint8Array | null): Promise<number> {
  const first = (data: Float32Array) => { for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > 0.02) return i; return -1; };
  const onset = first(source.getChannelData(0));
  if (onset < 0 || typeof AudioDecoder === "undefined") return 0;
  const decoded: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: data => {
      const out = new Float32Array(data.numberOfFrames);
      data.copyTo(out, { planeIndex: 0, format: "f32-planar" });
      decoded.push(out);
      data.close();
    },
    error: () => {},
  });
  try {
    decoder.configure({ codec: "mp4a.40.2", sampleRate: source.sampleRate, numberOfChannels: source.numberOfChannels,
      ...(description ? { description } : {}) });
    for (const chunk of chunks) decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: chunk.timestamp, duration: chunk.duration, data: chunk.data }));
    await decoder.flush();
  } catch { return 0; } finally { if (decoder.state !== "closed") decoder.close(); }
  const all = new Float32Array(decoded.reduce((n, d) => n + d.length, 0));
  let offset = 0;
  for (const d of decoded) { all.set(d, offset); offset += d.length; }
  const landed = first(all);
  return landed < 0 ? 0 : Math.max(0, Math.min(4096, landed - onset));
}

const slug = (label: string) => label.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "emote";
export const exportName = (clip: RecordableClip, stamp: string) => `finals-outfit-${slug(clip.label)}-${stamp}`;

/**
 * Render and encode the clip in front as a video. Resolves with the file; rejects with an AbortError when `signal`
 * aborts. The viewer is left as it was (the clip at its time, playing or paused) whatever happens.
 */
export async function recordVideo(context: ScreenshotContext, animator: RigAnimator, options: VideoOptions,
  onProgress: (progress: VideoProgress) => void, signal: AbortSignal, stamp: string): Promise<VideoResult> {
  const front = animator.recordable();
  if (!front) throw new Error("Play an emote first");
  const clip: RecordableClip = front;
  const plan = framePlan(clip, FPS, options.range);
  const { width, height, format } = options;
  const transparent = format !== "mp4";
  const quality = QUALITY[options.quality];
  const support = await videoSupport();
  onProgress({ phase: "preparing", frame: 0, frames: plan.frames, bytes: 0 });

  // Video encoder (MP4 and WebM).
  let videoConfig: VideoEncoderConfig | null = null;
  let alphaConfig: VideoEncoderConfig | null = null;
  if (format === "mp4") {
    if (!support.mp4) throw new Error("This browser can’t encode MP4 video. Try Chrome, Edge or Safari, or save a PNG sequence.");
    videoConfig = await pickAvc(width, height, bitrateFor(width, height));
    if (!videoConfig) throw new Error(`This browser can’t encode H.264 at ${width} × ${height}. Pick a smaller size.`);
  } else if (format === "webm") {
    if (!support.webm) throw new Error("This browser can’t encode WebM video. Use Chrome, Edge or Firefox, or save a PNG sequence.");
    const codec = vp9Codec(width, height, FPS);
    if (!await vp9Supported(codec, width, height)) throw new Error(`This browser can’t encode VP9 at ${width} × ${height}. Pick a smaller size.`);
    videoConfig = { codec, width, height, bitrate: Math.round(bitrateFor(width, height) * 0.8), framerate: FPS, latencyMode: "quality" };
    // The alpha stream: mostly flat, so cheap; its edges get the bits.
    alphaConfig = { ...videoConfig, bitrate: Math.round(bitrateFor(width, height) * 0.3) };
  }
  if (signal.aborted) throw cancelled();

  // Sound, rendered offline before any frame (it is quick, and a failure here should not cost a long render).
  const wantSound = options.sound && animator.sounds.hasSound(clip.source);
  const rawSound = format === "png" || format === "mov"; // WAV or PCM: no encoder needed
  const audioCodec = rawSound ? null : format === "webm" ? (support.opus ? "opus" : null)
    : support.aac ? "mp4a.40.2" : support.opus ? "opus" : null;
  let sound: { buffer: AudioBuffer } | null = null;
  if (wantSound && (rawSound || audioCodec)) {
    sound = await animator.sounds.renderOffline(clip.source, { duration: plan.duration, clipLength: clip.duration,
      looping: clip.loop, sampleRate: AUDIO_RATE, signal, range: plan });
  }
  if (signal.aborted) throw cancelled();

  // Outputs.
  const videoSamples: { data: Uint8Array; timestamp: number; key: boolean }[] = [];
  const alphaSamples = new Map<number, { data: Uint8Array; key: boolean }>(); // by timestamp
  let videoDescription: Uint8Array | null = null;
  let videoColor: VideoColorSpaceInit | null = null;
  let stored = 0;
  let failure: unknown = null;
  const zip = format === "png" ? new ZipStoreWriter() : null;
  const qtrle = format === "mov" ? new QtrleEncoder(width, height) : null;
  const movFrames: Blob[] = []; // each frame its own Blob, so a long movie can sit in blob storage, not the JS heap
  const base = exportName(clip, stamp);
  let encoder: VideoEncoder | null = null;
  if (videoConfig) {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        videoSamples.push({ data, timestamp: chunk.timestamp, key: chunk.type === "key" });
        stored += data.length;
        const config = meta?.decoderConfig;
        if (config?.description && !videoDescription) videoDescription = bytesOf(config.description);
        if (config?.colorSpace && !videoColor) videoColor = config.colorSpace;
      },
      error: error => { failure = error; },
    });
    encoder.configure(videoConfig);
  }
  let alphaEncoder: VideoEncoder | null = null;
  if (alphaConfig) {
    alphaEncoder = new VideoEncoder({
      output: chunk => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        alphaSamples.set(chunk.timestamp, { data, key: chunk.type === "key" });
        stored += data.length;
      },
      error: error => { failure = error; },
    });
    alphaEncoder.configure(alphaConfig);
  }

  try {
    return await renderAndMux();
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    if (alphaEncoder && alphaEncoder.state !== "closed") alphaEncoder.close();
  }

  // Draw every frame, then finish the encoders and the container. (A function so the encoder is closed on any exit.)
  async function renderAndMux(): Promise<VideoResult> {
    const capture = new ViewCapture(context.gl, context.scene, context.camera, { width, height,
      supersample: quality.supersample, samples: quality.samples, transparent, keepFloor: options.keepFloor,
      backdrop: transparent ? null : options.backdrop, maxTile: options.maxTile });
    let fewestSamples = Infinity;
    const begun = animator.beginRecording(plan.time(0));
    try {
      if (!begun || begun.clip !== clip.clip) throw new Error("The emote changed; try again");
      onProgress({ phase: "rendering", frame: 0, frames: plan.frames, bytes: 0 });
      await new Promise<void>((resolve, reject) => {
        let next = 0, drawn = false, inFlight = 0, committed = 0, finished = false;
        let tail: Promise<void> = Promise.resolve();
        const fail = (error: unknown) => {
          if (finished) return;
          finished = true;
          captureSlot.current = null;
          reject(error);
        };
        signal.addEventListener("abort", () => fail(cancelled()), { once: true });
        const commit = async (index: number, pixels: Uint8Array, png: Promise<Uint8Array> | null) => {
          if (finished) return;
          if (failure) throw failure;
          if (encoder) {
            const timestamp = Math.round(index * 1e6 / FPS), duration = Math.round(1e6 / FPS), keyFrame = index % KEY_INTERVAL === 0;
            if (alphaEncoder) {
              const planes = alphaPlanes(pixels, width, height);
              const alpha = new VideoFrame(planes, { format: "I420", codedWidth: width, codedHeight: height, timestamp, duration });
              try { alphaEncoder.encode(alpha, { keyFrame }); } finally { alpha.close(); }
              bleedColour(pixels, width, height);
            }
            const frame = new VideoFrame(pixels, { format: "RGBA", codedWidth: width, codedHeight: height, timestamp, duration });
            try { encoder.encode(frame, { keyFrame }); } finally { frame.close(); }
          } else if (qtrle) {
            const frame = new Blob([qtrle.encode(pixels) as BlobPart]); // copies out of the encoder's buffer
            movFrames.push(frame);
            stored += frame.size;
          } else if (zip && png) {
            zip.add(`${base}/frame_${String(index).padStart(5, "0")}.png`, await png);
            stored = zip.size;
          }
          if (stored > options.maxBytes) throw new Error(`The file passed ${Math.round(options.maxBytes / 1e6)} MB, more than this device can safely hold. Pick a smaller size${format === "png" ? " or a video format" : format === "mov" ? ", or the PNG sequence (smaller)" : ""}.`);
          committed++;
          onProgress({ phase: "rendering", frame: committed, frames: plan.frames, bytes: stored });
        };
        captureSlot.current = {
          capture: () => {
            if (finished || drawn || next >= plan.frames) return;
            if (!animator.recordingCurrent()) { fail(new Error("The emote changed while recording; recording stopped.")); return; }
            if (inFlight >= IN_FLIGHT || (encoder && encoder.encodeQueueSize > IN_FLIGHT)
            || (alphaEncoder && alphaEncoder.encodeQueueSize > IN_FLIGHT)) return; // let the pipeline drain
            try { capture.draw(); } catch (error) { fail(error); return; }
            fewestSamples = Math.min(fewestSamples, capture.samples);
            const index = next++;
            drawn = true;
            inFlight++;
            const read = capture.read();
            // PNGs encode as soon as their pixels arrive (in parallel); frames are committed strictly in order.
            const png = zip ? read.then(pixels => encodePngAsync(width, height, pixels)) : null;
            png?.catch(() => { /* reported through the commit */ });
            tail = tail.then(async () => { await commit(index, await read, png); })
              .then(() => {
                inFlight--;
                if (committed === plan.frames && !finished) { finished = true; captureSlot.current = null; resolve(); }
              }, fail);
          },
          advance: () => {
            if (finished || !drawn) return;
            drawn = false;
            if (next < plan.frames) animator.recordFrame(plan.time(next), 1 / FPS);
          },
        };
      });
    } finally {
      captureSlot.current = null;
      animator.endRecording();
      capture.dispose();
    }

    onProgress({ phase: "finishing", frame: plan.frames, frames: plan.frames, bytes: stored });
    if (encoder) {
      await Promise.all([encoder.flush(), alphaEncoder?.flush()]);
      if (failure) throw failure;
      encoder.close();
      alphaEncoder?.close();
    }
    if (signal.aborted) throw cancelled();

    let blob: Blob;
    let soundKind: VideoResult["sound"] = null;
    if (format === "png") {
      if (sound) {
        zip!.add(`${base}/${base}.wav`, encodeWav(Array.from({ length: sound.buffer.numberOfChannels }, (_, c) => sound!.buffer.getChannelData(c)), AUDIO_RATE));
        soundKind = "wav";
      }
      zip!.add(`${base}/README.txt`, new TextEncoder().encode(readme(clip, plan, width, height, !!sound, base)));
      blob = zip!.finish();
    } else if (format === "mov") {
      if (movFrames.length !== plan.frames) throw new Error(`The movie has ${movFrames.length} of ${plan.frames} frames`);
      const pcm = sound ? pcm16le(Array.from({ length: sound.buffer.numberOfChannels }, (_, c) => sound!.buffer.getChannelData(c))) : null;
      blob = muxMov({ width, height, fps: FPS, frames: movFrames },
        pcm ? { sampleRate: AUDIO_RATE, channels: sound!.buffer.numberOfChannels, pcm } : null);
      if (pcm) soundKind = "pcm";
    } else {
      // Encoder output order is decode order, which both containers keep (each sample carries its presentation time).
      const frames = videoSamples;
      if (frames.length !== plan.frames) throw new Error(`The encoder returned ${frames.length} of ${plan.frames} frames`);
      let audio: Awaited<ReturnType<typeof encodeAudio>> | null = null;
      if (sound && audioCodec) audio = await encodeAudio(sound.buffer, audioCodec);
      if (signal.aborted) throw cancelled();
      if (format === "mp4") {
        if (!videoDescription) throw new Error("The H.264 encoder gave no stream description");
        const timescale = FPS * 1000, tick = timescale / FPS;
        // Encoder output is in decode order; each frame's presentation time is its index (timestamps are whole microseconds).
        const samples: Mp4Sample[] = frames.map(s => ({ data: s.data, pts: Math.round(s.timestamp * FPS / 1e6) * tick, duration: tick, key: s.key }));
        let audioTrack: Mp4AudioTrack | null = null;
        if (audio && audioCodec) {
          const aac = audioCodec === "mp4a.40.2";
          const delay = aac ? await measureAacDelay(sound!.buffer, audio.chunks, audio.description) : 0;
          audioTrack = { codec: aac ? "aac" : "opus", sampleRate: AUDIO_RATE, channels: sound!.buffer.numberOfChannels,
            description: audio.description, delay: aac ? delay : 312, bitrate: 192_000,
            samples: audio.chunks.map(c => ({ data: c.data, pts: Math.round(c.timestamp * AUDIO_RATE / 1e6),
              duration: Math.round(c.duration * AUDIO_RATE / 1e6) || (aac ? 1024 : 960), key: true })) };
          soundKind = aac ? "aac" : "opus";
        }
        blob = muxMp4({ width, height, timescale, description: videoDescription, colorSpace: videoColor, samples }, audioTrack);
      } else {
        const codes = colorCodes(videoColor);
        // Each colour frame with its alpha frame; a keyframe only where both streams start fresh (seeking lands there).
      const webmFrames: WebmVideoFrame[] = frames.map(f => {
        const alpha = alphaSamples.get(f.timestamp);
        if (!alpha) throw new Error("The alpha encoder skipped a frame");
        return { data: f.data, alpha: alpha.data, time: f.timestamp / 1000, key: f.key && alpha.key };
      });
        let webmAudio = null;
        if (audio) {
          const preSkip = audio.description && audio.description.length >= 19 ? audio.description[10] | (audio.description[11] << 8) : 312;
          const head = audio.description && audio.description.length >= 19 ? audio.description : opusHead(sound!.buffer.numberOfChannels, preSkip, AUDIO_RATE);
          webmAudio = { sampleRate: AUDIO_RATE, channels: sound!.buffer.numberOfChannels, head, preSkip,
            frames: audio.chunks.map(c => ({ data: c.data, time: c.timestamp / 1000 }) as WebmAudioFrame) };
          soundKind = "opus";
        }
        blob = muxWebm({ width, height, codec: "V_VP9", frameDuration: 1e9 / FPS, duration: plan.duration * 1000, alpha: true,
          colour: videoColor ? { matrix: codes.matrix, range: codes.fullRange ? 2 : 1, transfer: codes.transfer, primaries: codes.primaries } : null,
          frames: webmFrames, audio: webmAudio });
      }
    }
    return { blob, extension: format === "png" ? "zip" : format, frames: plan.frames, width, height, sound: soundKind,
      samples: Number.isFinite(fewestSamples) ? fewestSamples : quality.samples, clip, plan };
  }
}

function readme(clip: RecordableClip, plan: FramePlan, width: number, height: number, sound: boolean, base: string): string {
  const whole = plan.from <= 1e-6 && plan.to >= clip.duration - 1e-6 && plan.loops === 1 && plan.speed === 1;
  return [
    `${clip.label}: ${plan.frames} frames at ${FPS} fps (${plan.duration.toFixed(3)} s), ${width} x ${height}.`,
    ...(whole ? [] : [`Recorded: clip ${plan.from.toFixed(3)} s to ${plan.to.toFixed(3)} s${plan.loops > 1 ? `, ${plan.loops} times` : ""}` +
      `${plan.speed !== 1 ? ` at ${formatSpeed(plan.speed)} speed` : ""}.`]),
    "Each PNG has a transparent background (straight alpha). Import the folder as an image sequence at 60 fps;",
    `frame_00000.png is 0.000 s, and each next frame is 1/${FPS} s later.`,
    sound ? `${base}.wav is the emote's sound, starting at frame 0 and as long as the frames.` : "This emote has no sound (or sound was turned off).",
    "",
  ].join("\n");
}

/** 0.5 as "0.5x", 1/3 as "0.33x". */
export const formatSpeed = (speed: number) => `${Number(speed.toFixed(2))}x`;
