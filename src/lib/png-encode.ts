import { zlibSync } from "three/examples/jsm/libs/fflate.module.js";

// Exact RGBA PNG encoding for the source-file export. A canvas stores premultiplied alpha, so canvas.toBlob would
// zero the colour wherever alpha is 0 and round it wherever alpha is low: wrong for mask and packed-channel textures.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** RGBA, 8 bits per sample (Uint8Array) or 16 (Uint16Array, written big-endian as PNG requires). Rows top to bottom. */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint16Array): Uint8Array {
  const depth = rgba instanceof Uint16Array ? 16 : 8, bytesPerPixel = depth / 2;
  if (rgba.length !== width * height * 4) throw new Error("PNG pixel data does not match its size");
  const stride = width * bytesPerPixel, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1); // filter byte 0 (None) precedes each row
    if (depth === 8) raw.set((rgba as Uint8Array).subarray(y * width * 4, (y + 1) * width * 4), row + 1);
    else for (let i = 0; i < width * 4; i++) {
      const v = rgba[y * width * 4 + i];
      raw[row + 1 + i * 2] = v >>> 8;
      raw[row + 2 + i * 2] = v & 0xff;
    }
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, 6, 0, 0, 0], 8); // bit depth, colour type RGBA, deflate, adaptive filtering, no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
