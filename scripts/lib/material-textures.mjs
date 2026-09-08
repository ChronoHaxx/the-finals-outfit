// Shared by the catalog import and layered bake. LED/glass bindings retain the
// source's separate material and maps; only the stripped shader graph is approximated.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { linearToSrgb } from "./color-model.mjs";

const converted = new Map();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const hex = (vector) => "#" + [vector?.r ?? 1, vector?.g ?? 1, vector?.b ?? 1]
  .map((x) => linearToSrgb(x).toString(16).padStart(2, "0")).join("");

export function sourceTexturePath(mi, param, dumpRoot) {
  const objectPath = mi.textures[param];
  if (typeof objectPath !== "string" || !/^\/Game\//i.test(objectPath)) return null;
  const path = resolve(dumpRoot, "..", "..", objectPath.replace(/^\/Game\//i, "").replace(/\.[^./]+$/, "") + ".png");
  return existsSync(path) ? path : null;
}

export async function convertMaterialTexture(path, modelsRoot, role = "color") {
  if (!path || !existsSync(path)) return undefined;
  const data = readFileSync(path);
  const hash = createHash("sha256").update(role + ":v1:").update(data).digest("hex").slice(0, 16);
  const stem = basename(path, ".png").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const relative = `materials/${stem}-${hash}.webp`;
  const out = join(modelsRoot, relative);
  const key = out;
  if (!converted.has(key)) converted.set(key, (async () => {
    mkdirSync(dirname(out), { recursive: true });
    if (!existsSync(out)) {
      if (role === "normal") {
        // UE DirectX BC5 XY -> glTF OpenGL XYZ. Alpha/blue are packed data,
        // not normal-Z; reconstruct rather than passing them into three.js.
        const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
        const rgb = Buffer.alloc(info.width * info.height * 3);
        for (let i = 0; i < info.width * info.height; i++) {
          const x = pixels[i * info.channels] / 127.5 - 1;
          const y = -(pixels[i * info.channels + 1] / 127.5 - 1);
          const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
          rgb[i * 3] = Math.round((x + 1) * 127.5);
          rgb[i * 3 + 1] = Math.round((y + 1) * 127.5);
          rgb[i * 3 + 2] = Math.round((z + 1) * 127.5);
        }
        await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ lossless: true }).toFile(out);
      } else {
        // Small sprite sheets and gradients need exact pixels, not lossy edge ringing.
        await sharp(data).webp({ lossless: true }).toFile(out);
      }
    }
    return `models/${relative}`;
  })());
  return converted.get(key);
}

// A default capture at time zero can select an entirely blank opening frame.
// Choose a representative still only for that case, from this track's actual
// pixels. Authored positive capture times and already-visible opening frames
// remain intact; no colours or animation speed are changed.
export async function ledPreviewCaptureTime(path, screen) {
  if (screen.captureTime > 0 || screen.animationSpeed <= 0 || !path) return screen.captureTime;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const track = Math.min(screen.animationTrack, screen.trackCount - 1);
  const x0 = Math.floor(track * info.width / screen.trackCount);
  const x1 = Math.floor((track + 1) * info.width / screen.trackCount);
  const coverage = [];
  for (let frame = 0; frame < screen.frameCount; frame++) {
    const y0 = Math.floor(frame * info.height / screen.frameCount);
    const y1 = Math.floor((frame + 1) * info.height / screen.frameCount);
    let occupied = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] > 0 && Math.max(data[offset], data[offset + 1], data[offset + 2]) > 0) occupied++;
    }
    coverage.push(occupied / Math.max(1, (x1 - x0) * (y1 - y0)));
  }
  if (coverage[0] > 0) return 0;
  const frame = coverage.indexOf(Math.max(...coverage));
  return frame / screen.animationSpeed;
}

export async function buildSourceMaterialBinding(mi, { dumpRoot, modelsRoot }) {
  if (!mi) return { family: "unknown" };
  const binding = { family: mi.family };
  if (typeof mi.doubleSided === "boolean") binding.doubleSided = mi.doubleSided;
  const copy = (param, role) => convertMaterialTexture(sourceTexturePath(mi, param, dumpRoot), modelsRoot, role);
  const s = (name, fallback) => Number.isFinite(mi.scalars[name]) ? mi.scalars[name] : fallback;
  if (mi.family === "led") {
    const animation = await copy("Animation");
    if (animation) {
      const [colorRamp, normal] = await Promise.all([copy("ColorRamp"), copy("Normal", "normal")]);
      binding.ledScreen = {
        animation, ...(colorRamp ? { colorRamp } : {}), ...(normal ? { normal } : {}),
        ...(mi.vectors.TintColor ? { tint: hex(mi.vectors.TintColor) } : {}),
        brightness: clamp(s("Brightness", 1), 0, 10000),
        frameCount: clamp(Math.round(s("FrameCount", 1)), 1, 4096),
        trackCount: clamp(Math.round(s("TrackCount", 1)), 1, 4096),
        pixelWidth: clamp(s("PixelWidth", 32), 1, 4096),
        pixelHeight: clamp(s("PixelHeight", 16), 1, 4096),
        animationTrack: Math.max(0, Math.round(s("AnimationTrack", 0))),
        animationSpeed: Math.max(0, s("AnimationSpeed", 0)),
        uvScale: Math.max(0.0001, s("UVScale", 1)),
        uvOffsetU: s("UVOffsetU", 0), uvOffsetV: s("UVOffsetV", 0),
        // Official icons are static. Keep the source capture time deterministic;
        // this is a still reconstruction, not a claim of verified animation motion.
        captureTime: Math.max(0, s("IconCaptureTime", 0)),
      };
      binding.ledScreen.captureTime = await ledPreviewCaptureTime(
        sourceTexturePath(mi, "Animation", dumpRoot), binding.ledScreen,
      );
    }
  } else if (mi.family === "glass") {
    const normal = await copy(mi.textures.NormalMap ? "NormalMap" : "Normal", "normal");
    binding.glass = {
      color: hex(mi.vectors.ColorTint ?? mi.vectors.TintColor ?? mi.vectors.BaseColor),
      opacity: clamp(s("Opacity", 1), 0, 1), roughness: clamp(s("Roughness", 0.1), 0, 1),
      ...(normal ? { normal } : {}),
    };
  }
  return binding;
}
