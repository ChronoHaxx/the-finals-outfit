import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { compositeOver, flipRows, isBlank, screenshotSizes } from "../src/rig/ViewerScreenshot";
import { encodePngAsync, paethRows } from "../src/lib/png-encode";
import { backdropChoices, backdropCss, backdropPaint, type SceneTheme } from "../src/lib/stage-lighting";

test("sizes: the stage times 1-4 within the pixel and side budget; never empty", () => {
  assert.deepEqual(screenshotSizes(800, 600, 6_300_000, 4096).map(s => s.scale), [1, 2, 3]);
  assert.deepEqual(screenshotSizes(800, 600, 6_300_000, 4096)[1], { scale: 2, width: 1600, height: 1200 });
  assert.deepEqual(screenshotSizes(1600, 1000, 6_300_000, 2048).map(s => s.scale), [1], "the GPU's side limit");
  const fit = screenshotSizes(5000, 3000, 6_300_000, 8192);
  assert.equal(fit.length, 1);
  assert.ok(fit[0].width * fit[0].height <= 6_300_000 && fit[0].scale < 1, JSON.stringify(fit));
  assert.deepEqual(screenshotSizes(0, 0, 6_300_000, 4096), []);
});

test("backdrop composite is the browser's: P + (1 - A) B, additive light adds", () => {
  const B = [200, 100, 50, 255];
  const px = (p: number[]) => [...compositeOver(Uint8Array.from(p), Uint8Array.from(B))];
  assert.deepEqual(px([0, 0, 0, 0]), [200, 100, 50, 255], "uncovered: the backdrop");
  assert.deepEqual(px([10, 20, 30, 255]), [10, 20, 30, 255], "covered: the render");
  assert.deepEqual(px([64, 32, 16, 128]), [64 + 100, 32 + 50, 16 + 25, 255], "half coverage, premultiplied colour");
  assert.deepEqual(px([90, 90, 90, 0]), [255, 190, 140, 255], "an uncovered additive glow adds to the backdrop, clamped");
});

test("rows flip bottom-up to top-down; a blank capture is detected", () => {
  const pixels = Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2, /* row 2 */ 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.deepEqual([...flipRows(pixels, 2, 2)], [3, 3, 3, 3, 4, 4, 4, 4, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(isBlank(new Uint8Array(16)), true);
  assert.equal(isBlank(Uint8Array.from([0, 0, 0, 1])), false);
});

// PNG Paeth reconstruction, written from the spec (independent of the encoder).
function unpaeth(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4, out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 4);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = i >= 4 && y ? out[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  return out;
}

test("the async PNG is exact straight RGBA (Paeth rows, zlib IDAT)", async () => {
  const width = 37, height = 23, rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7919 + (i >> 5) * 31) & 0xff; // noisy, with soft-alpha values
  rgba[3] = 0; rgba[7] = 1; rgba[11] = 254; rgba[0] = 255; // colour under zero alpha survives (no premultiply)
  const png = await encodePngAsync(width, height, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16), width);
  assert.equal(view.getUint32(20), height);
  assert.deepEqual([png[24], png[25]], [8, 6], "8-bit RGBA");
  let offset = 8, idat = Buffer.alloc(0);
  while (offset < png.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  assert.deepEqual([...unpaeth(inflateSync(idat), width, height)], [...rgba]);
  assert.equal(paethRows(width, height, rgba).length, (width * 4 + 1) * height);
});

// backdropCss is what the page paints; backdropPaint is what the screenshot paints. They must be the same gradient.
function parseCss(css: string) {
  const m = css.match(/^radial-gradient\(ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%, (#\w+) 0%, (#\w+) ([\d.]+)%, (#\w+) 100%\)$/);
  if (!m) return { solid: css };
  return { rx: +m[1] / 100, ry: +m[2] / 100, cx: +m[3] / 100, cy: +m[4] / 100, colors: [m[5], m[6], m[8]], middle: +m[7] / 100 };
}

test("the screenshot's backdrop paint is the CSS gradient in numbers, for every choice in both themes", () => {
  for (const theme of ["studio", "lobby"] as SceneTheme[]) for (const choice of backdropChoices(theme)) {
    const css = parseCss(backdropCss(theme, choice.id)), paint = backdropPaint(theme, choice.id);
    if ("solid" in css) {
      assert.deepEqual(paint.colors, [css.solid, css.solid, css.solid], `${theme}/${choice.id}`);
      continue;
    }
    assert.deepEqual({ rx: paint.rx, ry: paint.ry, cx: paint.cx, cy: paint.cy, colors: paint.colors, middle: paint.stops[1] },
      { rx: css.rx, ry: css.ry, cx: css.cx, cy: css.cy, colors: css.colors, middle: css.middle }, `${theme}/${choice.id}`);
    assert.deepEqual([paint.stops[0], paint.stops[2]], [0, 1]);
  }
});
