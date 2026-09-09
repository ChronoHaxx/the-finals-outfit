import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { sourceTexturePath } from "./material-textures.mjs";

const converted = new Map();

// Character attachments pack RGB color + A roughness in CR and XY normal + A
// metalness in NOM/NOH. Resolve those exact source parameters; directory order is
// not a material assignment when an accessory has more than one texture set.
export function buildAttachmentMaterialBinding(mi, { dumpRoot, modelsRoot }) {
  if (!mi || mi.family !== "attachment") return Promise.resolve(undefined);
  const cr = sourceTexturePath(mi, "CR", dumpRoot);
  const nom = sourceTexturePath(mi, "NOM", dumpRoot) ?? sourceTexturePath(mi, "NOH", dumpRoot);
  if (!cr || !nom) return Promise.resolve(undefined);
  const key = `${modelsRoot}|${cr}|${nom}`;
  if (!converted.has(key)) converted.set(key, (async () => {
    const crBytes = readFileSync(cr);
    const nomBytes = readFileSync(nom);
    const hash = createHash("sha256").update("attachment-pbr:v1:1024:").update(crBytes).update(nomBytes).digest("hex").slice(0, 16);
    const stem = basename(cr, ".png").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const rel = `materials/${stem}-${hash}`;
    const paths = Object.fromEntries(["albedo", "normal", "orm"].map((role) => [role, `${rel}.${role}.webp`]));
    if (!Object.values(paths).every((path) => existsSync(join(modelsRoot, path)))) {
      mkdirSync(join(modelsRoot, "materials"), { recursive: true });
      const base = await sharp(crBytes).resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const normals = await sharp(nomBytes).resize(base.info.width, base.info.height, { fit: "fill" })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixels = base.info.width * base.info.height;
      const color = Buffer.alloc(pixels * 3);
      const normal = Buffer.alloc(pixels * 3);
      const orm = Buffer.alloc(pixels * 3);
      for (let i = 0; i < pixels; i++) {
        const b = i * base.info.channels;
        const n = i * normals.info.channels;
        const out = i * 3;
        color[out] = base.data[b]; color[out + 1] = base.data[b + 1]; color[out + 2] = base.data[b + 2];
        const x = normals.data[n] / 127.5 - 1;
        const y = -(normals.data[n + 1] / 127.5 - 1);
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        normal[out] = Math.round((x + 1) * 127.5);
        normal[out + 1] = Math.round((y + 1) * 127.5);
        normal[out + 2] = Math.round((z + 1) * 127.5);
        orm[out] = 255;
        orm[out + 1] = base.data[b + 3];
        orm[out + 2] = normals.data[n + 3];
      }
      const raw = { width: base.info.width, height: base.info.height, channels: 3 };
      await Promise.all(Object.entries({ albedo: color, normal, orm }).map(([role, data]) =>
        sharp(data, { raw }).webp({ lossless: true }).toFile(join(modelsRoot, paths[role]))));
    }
    return { family: "attachment", ...(typeof mi.doubleSided === "boolean" ? { doubleSided: mi.doubleSided } : {}),
      bakedSet: Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, `models/${path}`])) };
  })());
  return converted.get(key);
}
