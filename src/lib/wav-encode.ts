/** 16-bit PCM WAV from planar float channels in [-1, 1] (clamped), interleaved: the format every editor reads. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length, frames = channels[0]?.length ?? 0;
  if (!count || channels.some(c => c.length !== frames)) throw new Error("WAV channels must be the same length");
  const bytes = frames * count * 2, out = new Uint8Array(44 + bytes), view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    view.setInt16(offset, Math.round(v < 0 ? v * 32768 : v * 32767), true);
    offset += 2;
  }
  return out;
}
