// A minimal WebM (Matroska) writer for the viewer's transparent video export (21 Nov 2026): one VP9 video track whose
// alpha plane travels beside each frame as a second VP9 stream (Matroska BlockAdditions, BlockAddID 1, with the track's
// AlphaMode set), which is what WebCodecs produces with `alpha: "keep"` (EncodedVideoChunkMetadata.alphaSideData) and
// what Chrome, Edge and Firefox play with transparency. Optionally one Opus audio track.
//
// Assembled once every frame exists: a cluster starts at each video keyframe (and at least every 30 s, the limit of a
// block's 16-bit relative timestamp), and Cues at the end point at the clusters, found through a SeekHead, so players
// can seek. Timestamps are milliseconds (TimestampScale 1,000,000 ns).

export interface WebmVideoFrame {
  data: Uint8Array;
  /** The frame's alpha plane, coded on its own (absent: opaque). */
  alpha?: Uint8Array | null;
  /** Milliseconds. */
  time: number;
  key: boolean;
}
export interface WebmAudioFrame { data: Uint8Array; time: number }

export interface WebmColour { matrix: number; range: 1 | 2; transfer: number; primaries: number }

export interface WebmInput {
  width: number;
  height: number;
  /** "V_VP9" (or "V_VP8"). */
  codec: string;
  /** Nanoseconds per frame. */
  frameDuration: number;
  /** Milliseconds. */
  duration: number;
  alpha: boolean;
  colour?: WebmColour | null;
  frames: WebmVideoFrame[];
  audio?: { sampleRate: number; channels: number; head: Uint8Array; preSkip: number; frames: WebmAudioFrame[] } | null;
}

// Element IDs (with their length marker bits, as written).
const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  CodecID: 0x86, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, DefaultDuration: 0x23e383,
  MaxBlockAdditionID: 0x55ee, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0,
  Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
  BlockAdditions: 0x75a1, BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
} as const;

function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return Uint8Array.from(out);
}

/** An EBML variable-size integer: the fewest bytes, or exactly `width`. */
export function vint(value: number, width?: number): Uint8Array {
  let length = width ?? 1;
  if (!width) while (length < 8 && value >= 2 ** (7 * length) - 1) length++;
  if (value >= 2 ** (7 * length) - 1) throw new Error("EBML size too large");
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function element(id: number, body: Uint8Array): Uint8Array { return concat([idBytes(id), vint(body.length), body]); }
function master(id: number, ...children: Uint8Array[]): Uint8Array { return element(id, concat(children)); }
function uint(id: number, value: number, width?: number): Uint8Array {
  const bytes: number[] = [];
  for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  while (bytes.length < (width ?? 1)) bytes.unshift(0);
  return element(id, Uint8Array.from(bytes));
}
function float(id: number, value: number): Uint8Array {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setFloat64(0, value);
  return element(id, body);
}
function text(id: number, value: string): Uint8Array { return element(id, new TextEncoder().encode(value)); }

/** Block header: track number, timestamp relative to the cluster (signed 16-bit), flags. */
function blockHeader(track: number, relative: number, flags: number): Uint8Array {
  const header = new Uint8Array(4);
  header.set(vint(track), 0);
  new DataView(header.buffer).setInt16(1, relative);
  header[3] = flags;
  return header;
}

interface Item { time: number; track: 1 | 2; key: boolean; data: Uint8Array; alpha?: Uint8Array | null }

/** The whole WebM file. */
export function muxWebm(input: WebmInput): Blob {
  const header = master(ID.EBML, uint(ID.EBMLVersion, 1), uint(ID.EBMLReadVersion, 1), uint(ID.EBMLMaxIDLength, 4),
    uint(ID.EBMLMaxSizeLength, 8), text(ID.DocType, "webm"), uint(ID.DocTypeVersion, 4), uint(ID.DocTypeReadVersion, 2));
  const info = master(ID.Info, uint(ID.TimestampScale, 1_000_000), float(ID.Duration, input.duration),
    text(ID.MuxingApp, "the-finals-outfit"), text(ID.WritingApp, "the-finals-outfit"));
  const videoChildren = [uint(ID.PixelWidth, input.width), uint(ID.PixelHeight, input.height)];
  if (input.alpha) videoChildren.push(uint(ID.AlphaMode, 1));
  if (input.colour) videoChildren.push(master(ID.Colour, uint(ID.MatrixCoefficients, input.colour.matrix),
    uint(ID.Range, input.colour.range), uint(ID.TransferCharacteristics, input.colour.transfer), uint(ID.Primaries, input.colour.primaries)));
  const entries = [master(ID.TrackEntry, uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.TrackType, 1),
    uint(ID.FlagLacing, 0), text(ID.CodecID, input.codec), uint(ID.DefaultDuration, Math.round(input.frameDuration)),
    ...(input.alpha ? [uint(ID.MaxBlockAdditionID, 1)] : []), master(ID.Video, ...videoChildren))];
  const audio = input.audio;
  if (audio) entries.push(master(ID.TrackEntry, uint(ID.TrackNumber, 2), uint(ID.TrackUID, 2), uint(ID.TrackType, 2),
    uint(ID.FlagLacing, 0), text(ID.CodecID, "A_OPUS"), element(ID.CodecPrivate, audio.head),
    uint(ID.CodecDelay, Math.round(audio.preSkip / 48000 * 1e9)), uint(ID.SeekPreRoll, 80_000_000),
    master(ID.Audio, float(ID.SamplingFrequency, audio.sampleRate), uint(ID.Channels, audio.channels))));
  const tracks = master(ID.Tracks, ...entries);

  // Interleave by time (video before audio at the same millisecond), then cut clusters.
  const items: Item[] = [
    ...input.frames.map(f => ({ time: Math.round(f.time), track: 1 as const, key: f.key, data: f.data, alpha: f.alpha })),
    ...(audio?.frames ?? []).map(f => ({ time: Math.max(0, Math.round(f.time)), track: 2 as const, key: true, data: f.data })),
  ].sort((a, b) => a.time - b.time || a.track - b.track);
  const clusters: { time: number; parts: Uint8Array[]; key: boolean }[] = [];
  let cluster: (typeof clusters)[number] | null = null;
  let previousVideo: number | null = null;
  for (const item of items) {
    if (!cluster || (item.track === 1 && item.key) || item.time - cluster.time > 30_000) {
      cluster = { time: item.time, parts: [uint(ID.Timestamp, item.time)], key: item.track === 1 && item.key };
      clusters.push(cluster);
    }
    const relative = item.time - cluster.time;
    let block: Uint8Array;
    if (item.track === 1 && item.alpha) {
      const children = [element(ID.Block, concat([blockHeader(1, relative, 0), item.data])),
        master(ID.BlockAdditions, master(ID.BlockMore, uint(ID.BlockAddID, 1), element(ID.BlockAdditional, item.alpha)))];
      // A BlockGroup is a keyframe unless it references an earlier frame.
      if (!item.key && previousVideo !== null) children.push(element(ID.ReferenceBlock, signed(previousVideo - item.time)));
      block = master(ID.BlockGroup, ...children);
    } else {
      block = element(ID.SimpleBlock, concat([blockHeader(item.track, relative, item.key ? 0x80 : 0), item.data]));
    }
    if (item.track === 1) previousVideo = item.time;
    cluster.parts.push(block);
  }
  const clusterElements = clusters.map(c => master(ID.Cluster, ...c.parts));

  // Layout inside the segment: SeekHead (fixed size: 8-byte positions), Info, Tracks, the clusters, Cues.
  const seekHead = (positions: [number, number][]) => master(ID.SeekHead,
    ...positions.map(([id, position]) => master(ID.Seek, element(ID.SeekID, idBytes(id)), uint(ID.SeekPosition, position, 8))));
  const headSize = seekHead([[ID.Info, 0], [ID.Tracks, 0], [ID.Cues, 0]]).length;
  const infoAt = headSize, tracksAt = infoAt + info.length, clustersAt = tracksAt + tracks.length;
  const cuePoints: Uint8Array[] = [];
  let position = clustersAt;
  clusters.forEach((c, i) => {
    if (c.key) cuePoints.push(master(ID.CuePoint, uint(ID.CueTime, c.time),
      master(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, position))));
    position += clusterElements[i].length;
  });
  const cues = master(ID.Cues, ...cuePoints);
  const head = seekHead([[ID.Info, infoAt], [ID.Tracks, tracksAt], [ID.Cues, position]]);
  const body = [head, info, tracks, ...clusterElements, cues];
  const segmentSize = body.reduce((n, p) => n + p.length, 0);
  return new Blob([header, idBytes(ID.Segment), vint(segmentSize, 8), ...body] as BlobPart[], { type: "video/webm" });
}

function signed(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value);
  return bytes;
}

/** An OpusHead (RFC 7845) for when the encoder gives none. */
export function opusHead(channels: number, preSkip: number, sampleRate: number): Uint8Array {
  const head = new Uint8Array(19), view = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true);
  head[18] = 0;
  return head;
}

/** The VP9 codec string (profile 0, 8 bits) at the lowest level that fits the stream. */
export function vp9Codec(width: number, height: number, fps: number): string {
  const pictures = width * height, rate = pictures * fps;
  const levels: [string, number, number][] = [["31", 983040, 36864000], ["40", 2228224, 83558400], ["41", 2228224, 160432128],
    ["50", 8912896, 311951360], ["51", 8912896, 588251136], ["52", 8912896, 1176502272], ["60", 35651584, 1176502272], ["62", 35651584, 4706009088]];
  const level = levels.find(([, size, samples]) => pictures <= size && rate <= samples)?.[0] ?? "62";
  return `vp09.00.${level}.08`;
}
