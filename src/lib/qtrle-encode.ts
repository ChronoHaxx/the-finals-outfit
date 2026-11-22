// QuickTime Animation ("rle ", ffmpeg's qtrle) at 32 bits per pixel: ARGB, "Millions of Colors+". It is the lossless
// intra codec with alpha that video editors import from a .mov (22 Nov 2026: a transparent MOV for editing was asked
// for). No browser encodes it, but run-length coding is simple enough to write here, straight from the frames the
// video export already renders.
//
// Every frame is a keyframe. Adobe's own .mov reader takes Animation only "without delta frames", and a keyframe-only
// file can be cut and scrubbed anywhere. The cost is size: a frame codes every pixel. A transparent background is long
// runs of one pixel and costs almost nothing; the character's shading rarely repeats, so it is mostly literal pixels.
//
// One frame (the layout of Apple's QuickTime File Format "Animation" and of ffmpeg's qtrleenc.c / qtrle.c):
//   u32  the frame's size in bytes, these 4 included
//   u16  header 0: every line follows, from the top (8 would add a start line and a line count)
//   per line, top to bottom:
//     u8   skip + 1 (1: the line starts at its first pixel; a keyframe never skips)
//     codes until 0xFF (-1 ends the line):
//       1..127     that many literal pixels follow, 4 bytes each: A, R, G, B
//       -2..-127   one pixel follows, repeated that many times
//       0          another skip byte follows (not written: a keyframe codes every pixel)
//   u8   0 after the last line
// -1 ends a line, so a repeat covers at least 2 pixels and a lone pixel is a 1-pixel literal. ffmpeg allows repeats of
// 128 (code -128); 127 is used here for both kinds so no decoder can read a code differently.

const MAX_RUN = 127;

export class QtrleEncoder {
  private scratch = new Uint8Array(0);

  constructor(readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0xffff || height > 0xffff)
      throw new Error(`QuickTime Animation can't code a ${width} × ${height} frame`);
  }

  /** The largest a frame can be: every pixel a literal, a code byte per 127 of them, a skip and an end byte a line. */
  static maxBytes(width: number, height: number): number {
    return 6 + height * (2 + width * 4 + Math.ceil(width / MAX_RUN)) + 1;
  }

  /**
   * One keyframe from straight-alpha RGBA rows, top to bottom. The result is a view of this encoder's own buffer, valid
   * until the next call: copy it (or put it in a Blob) before encoding the next frame.
   */
  encode(rgba: Uint8Array): Uint8Array {
    const { width, height } = this;
    if (rgba.length !== width * height * 4) throw new Error("Frame pixels do not match the frame size");
    const need = QtrleEncoder.maxBytes(width, height);
    if (this.scratch.length < need) this.scratch = new Uint8Array(need);
    const out = this.scratch;
    // Pixels compared whole as 32-bit words (equality does not care about byte order); a view needs 4-byte alignment.
    const aligned = rgba.byteOffset % 4 === 0 ? rgba : rgba.slice();
    const words = new Uint32Array(aligned.buffer, aligned.byteOffset, width * height);
    let o = 6; // after the size and the header
    const pixel = (i: number) => {
      const p = i * 4;
      out[o] = aligned[p + 3]; out[o + 1] = aligned[p]; out[o + 2] = aligned[p + 1]; out[o + 3] = aligned[p + 2];
      o += 4;
    };
    for (let y = 0; y < height; y++) {
      const row = y * width;
      out[o++] = 1; // no skip
      let x = 0;
      while (x < width) {
        const first = words[row + x];
        let run = 1;
        while (x + run < width && run < MAX_RUN && words[row + x + run] === first) run++;
        if (run >= 2) {
          out[o++] = 256 - run; // -run as a byte
          pixel(row + x);
          x += run;
          continue;
        }
        // Literals up to the next pixel that starts a repeat (or the line's end, or 127 of them).
        let end = x + 1;
        while (end < width && end - x < MAX_RUN && !(end + 1 < width && words[row + end] === words[row + end + 1])) end++;
        out[o++] = end - x;
        for (let i = x; i < end; i++) pixel(row + i);
        x = end;
      }
      out[o++] = 0xff; // end of line
    }
    out[o++] = 0; // end of frame
    new DataView(out.buffer, out.byteOffset).setUint32(0, o);
    out[4] = 0; out[5] = 0; // header: every line
    return out.subarray(0, o);
  }
}
