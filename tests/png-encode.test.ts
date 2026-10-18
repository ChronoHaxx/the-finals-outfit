import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync, crc32 } from "node:zlib";
import { encodePng } from "../src/lib/png-encode";

// Independent decoder: walk the chunks, check every CRC with node's zlib.crc32, inflate IDAT and strip filter bytes.
function decode(png: Uint8Array) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), types: string[] = [];
  let offset = 8, width = 0, height = 0, depth = 0, idat = Buffer.alloc(0);
  while (offset < png.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(view.getUint32(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} CRC`);
    types.push(type);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); depth = data[8];
      assert.deepEqual([...data.subarray(9)], [6, 0, 0, 0]);
    }
    if (type === "IDAT") idat = Buffer.concat([idat, data]);
    offset += 12 + length;
  }
  const raw = inflateSync(idat), stride = width * 4 * depth / 8, pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0);
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < width * 4; i++) pixels.push(depth === 8 ? row[i] : (row[i * 2] << 8) | row[i * 2 + 1]);
  }
  return { types, width, height, depth, pixels };
}

test("8-bit RGBA round-trips exactly, including colour under zero alpha", () => {
  const rgba = new Uint8Array([255, 0, 0, 0, 12, 34, 56, 1, 0, 0, 0, 255, 200, 100, 50, 128, 1, 2, 3, 4, 250, 251, 252, 253]);
  const png = decode(encodePng(3, 2, rgba));
  assert.deepEqual(png.types, ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual([png.width, png.height, png.depth], [3, 2, 8]);
  assert.deepEqual(png.pixels, [...rgba]);
});

test("16-bit RGBA is written big-endian and round-trips exactly", () => {
  const rgba = new Uint16Array([0, 1, 256, 65535, 4660, 22136, 39612, 0]);
  const png = decode(encodePng(2, 1, rgba));
  assert.equal(png.depth, 16);
  assert.deepEqual(png.pixels, [...rgba]);
  assert.throws(() => encodePng(2, 2, rgba), /does not match/);
});
