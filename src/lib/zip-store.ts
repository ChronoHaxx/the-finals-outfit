// A stored (uncompressed) zip for the video export's PNG sequence (21 Nov 2026): PNGs are already compressed, so
// storing them costs nothing in size and keeps writing cheap. Each file becomes its own Blob as it is added, so a long
// sequence can live in the browser's blob storage (which spills to disk) instead of one growing array; the zip is a
// Blob of those parts plus the headers. Classic zip limits apply (4 GiB, 65,535 entries): the caller keeps under them.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The zip format's 4 GiB ceiling (offsets and sizes are 32-bit). */
export const ZIP_MAX_BYTES = 0xffffffff;

interface Entry { name: Uint8Array; crc: number; size: number; offset: number }

export class ZipStoreWriter {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private readonly time: number;
  private readonly date: number;

  constructor(now = new Date()) {
    this.time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    this.date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  }

  /** Bytes written so far (local headers and data). */
  get size(): number { return this.offset; }
  get count(): number { return this.entries.length; }

  add(path: string, data: Uint8Array): void {
    const name = new TextEncoder().encode(path);
    if (this.entries.length >= 0xffff) throw new Error("Too many files for a zip");
    if (this.offset + 30 + name.length + data.length > ZIP_MAX_BYTES) throw new Error("The zip would pass 4 GB");
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 10, true); // version needed: stored
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, this.time, true);
    view.setUint16(12, this.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    this.entries.push({ name, crc, size: data.length, offset: this.offset });
    this.parts.push(header, new Blob([data as BlobPart]));
    this.offset += header.length + data.length;
  }

  finish(): Blob {
    const central: Uint8Array[] = [];
    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.name.length), view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true); // made by: MS-DOS / zip 2.0
      view.setUint16(6, 10, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, this.time, true);
      view.setUint16(14, this.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      central.push(record);
    }
    const size = central.reduce((n, r) => n + r.length, 0);
    if (this.offset + size + 22 > ZIP_MAX_BYTES) throw new Error("The zip would pass 4 GB");
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end] as BlobPart[], { type: "application/zip" });
  }
}
