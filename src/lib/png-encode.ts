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
  return assemble(width, height, depth, zlibSync(raw, { level: 6 }));
}

function assemble(width: number, height: number, depth: number, idat: Uint8Array): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, 6, 0, 0, 0], 8); // bit depth, colour type RGBA, deflate, adaptive filtering, no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** 8-bit RGBA rows, each behind filter byte 4 (Paeth): lossless, and a render's smooth shading and empty background
 *  compress several times smaller than unfiltered rows. */
export function paethRows(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error("PNG pixel data does not match its size");
  const stride = width * 4, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1), cur = y * stride, prev = cur - stride;
    raw[row] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[cur + i - 4] : 0, b = y > 0 ? rgba[prev + i] : 0, c = i >= 4 && y > 0 ? rgba[prev + i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[row + 1 + i] = (rgba[cur + i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  return raw;
}

/** zlib-wrapped deflate: the browser's own CompressionStream ("deflate" is the zlib format PNG wants), off the main
 *  thread; fflate where it is missing. */
async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return zlibSync(raw, { level: 6 });
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A large 8-bit RGBA image (the viewer's screenshot, 12 Nov 2026): Paeth rows, compressed asynchronously. Rows top to
 *  bottom, straight (not premultiplied) alpha, written exactly. */
export async function encodePngAsync(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  return assemble(width, height, 8, await deflate(paethRows(width, height, rgba)));
}
