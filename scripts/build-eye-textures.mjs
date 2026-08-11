// build-eye-textures.mjs — composite the iris onto the sclera into one eyeball texture the
// head converter can use (the game composites these via an eye shader we can't reproduce).
// Writes T_EyeBall_Composited.png into the dump's shared Pioneer eye folder (idempotent).
// Runs automatically before head conversion; or `npm run build:eyes`.
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";

const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

// the shared eye textures live under the sibling Pioneer content root
const CONTENT = resolve(DUMP, "../../");
const EYES_DIR = join(CONTENT, "Pioneer/Characters/Heads/Shared/Eyes/Textures");
const SCLERA = join(EYES_DIR, "T_EyeScleraBaseColor_Example_2.png");
const IRIS = join(DUMP, "Heads/Shared/Eyes/Textures/T_EyeIrisBaseColor_Gray_01_CA.png");
const OUT = join(EYES_DIR, "T_EyeBall_Composited.png");

async function main() {
  if (!existsSync(SCLERA) || !existsSync(IRIS)) {
    console.warn("[build-eyes] sclera/iris textures not found — skipping eyeball composite.");
    return;
  }
  const S = 512;
  const D = 230; // iris diameter on the sclera
  const sclera = await sharp(SCLERA).resize(S, S).removeAlpha().raw().toBuffer();
  const iris = await sharp(IRIS).resize(D, D).removeAlpha().raw().toBuffer();
  const out = Buffer.from(sclera);
  const R = D / 2;
  // The example sclera is noticeably grey — lift it toward white (in-game scleras render
  // bright) so eyes read open/alive instead of glassy grey at a distance.
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(out[i] * 1.35));
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < D; x++) {
      const sx = Math.round(S / 2 - D / 2) + x;
      const sy = Math.round(S / 2 - D / 2) + y;
      if (sx < 0 || sy < 0 || sx >= S || sy >= S) continue;
      const dist = Math.hypot(x - D / 2, y - D / 2);
      if (dist > R) continue;
      const a = Math.min(1, Math.max(0, (R - dist) / 8)); // soft edge
      const si = (sy * S + sx) * 3;
      const ii = (y * D + x) * 3;
      for (let c = 0; c < 3; c++) out[si + c] = Math.round(out[si + c] * (1 - a) + iris[ii + c] * a);
    }
  }
  await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toFile(OUT);
  console.log(`[build-eyes] wrote ${OUT}`);

  // Iris-disc mask in the SAME eyeball UV layout — the eye-color decal tints through it
  // so only the iris recolors (the old luma gate failed: this sclera isn't bright enough
  // to escape the gate, so whole eyeballs tinted). Saved into the repo (scripts/generated)
  // and copied to public/models/decals/_shared/ by import-catalog.
  const mask = Buffer.alloc(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dist = Math.hypot(x - S / 2, y - S / 2);
      const a = Math.min(1, Math.max(0, (R - dist) / 8));
      mask[y * S + x] = Math.round(a * 255);
    }
  const maskOut = resolve(import.meta.dirname, "generated/irismask.png");
  await sharp(mask, { raw: { width: S, height: S, channels: 1 } }).png().toFile(maskOut);
  console.log(`[build-eyes] wrote ${maskOut}`);
}

main();
