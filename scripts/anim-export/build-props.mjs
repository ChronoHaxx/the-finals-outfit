#!/usr/bin/env node
// Emote prop builder (showcase animation, props phase, 6 Nov 2026): the prop actors that THE FINALS' emotes spawn
// (BP_Emote_*_Prop, see survey-props.mjs), rebuilt as one self-contained GLB each, plus props.json for the app.
//
//   node scripts/anim-export/build-props.mjs targets [--research <dir>]
//     -> research/targets-prop-material-parents.txt (parent material instances not exported yet) and
//        research/targets-prop-textures.txt; export those with AnimExport json/texture and run again until no parents
//        are missing.
//   node scripts/anim-export/build-props.mjs build --catalog <emote-catalog.json> --out <dir> [--research <dir>]
//        [--max-texture 1024] [--survey <prop-survey.json>] [--anims <exporter run>/anims] [--allow-missing-textures]
//     --anims: the emote sequences' AnimExport records, for windows moved by curves (CurveDrivenTransformPrefix).
//     A texture a material names but prop-textures/ lacks fails the build (it would bake flat grey).
//
// Inputs under --research (default scripts/generated/anim-export/research): prop-survey.json, prop-meshes-2/ (AnimExport
// mesh mode), json-prop-materials/ + json-prop-material-parents/ (AnimExport json mode), prop-textures/ (texture mode),
// json-vpj/.../_3P_MasterSkeleton.json (sockets).
//
// Space: UE stores centimetres in a left-handed Z-up frame; the app's body came through a per-bone mirror of Y
// (convert-clips.mjs). Props get the same mirror, applied to every transform AND every vertex: position (x,-y,z)/100,
// rotation (-x,y,-z,w), scale unchanged. A mirror reverses triangle orientation, so the winding is checked against
// the converted vertex normals per mesh (and flipped if most triangles disagree) instead of assumed.
//
// Materials (approximate, flagged per material): most props use M_EmoteProps / M_WeaponPreset, which pack
// CR = base colour RGB + roughness A, and NOH/NOM = tangent normal XY in RG, occlusion B, metallic A (when the
// ActivateAlphaMetallic switch is on). Those are repacked for glTF: baseColor; ORM (R occlusion, G roughness,
// B metallic); normal with Z rebuilt and green flipped (UE normal maps are DirectX/green-down, glTF is green-up).
// Other masters (layered weapon skins, feathers, LED screens, glass, VAT birds) fall back to whatever colour texture
// or colour parameter they have, and are listed as approximations in props.json.
//
// Skeletal props: each one's AnimBlueprint evaluates exactly one AnimSequence (checked for every ABP_EmoteProp_*). Most
// use a SequenceEvaluator at an explicit time, PropAnimTime, which the emote sets from its PropAnimSequenceTime curve
// (props.json clock "emote-curve"; convert-clips.mjs ships the curve); the rest play from spawn ("spawn"). Either way
// the time wraps past the end, as the nodes' default looping does. The sequence is exported on the prop's own
// skeleton (AnimExport export with "skeleton": "*", research/prop-anims) and embedded as a glTF animation. Two-person emotes spawn a hologram stand-in (SK_EmoteProxyCharacter) that copies the pose of an
// invisible master-skeleton mesh running the AnimBlueprint (leader pose): the stand-in gets that mesh's sequence and
// the invisible one is left out (only the bones something hangs from are kept, as plain nodes: the CoconutRider cans).
// The hologram material is a guess (unlit translucent cyan), flagged approximate.
//
// Root overrides (11 Nov 2026, prop-placement.mjs): 25 of the AnimBlueprints end in a ModifyBone node that replaces the
// skeleton root with a constant in component space, discarding the sequence's keyed root (which the animation packages
// key in character space). The GLB bakes that: the root node holds the constant and has no translation (or rotation)
// channel. It replaces a heuristic that sent props whose root sat > 30 cm out to the character's origin (props.json
// "space": "component", still honoured by the app for older sets).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import { notifyTransform } from "./notify-transform.mjs";
import { curveTransform, modifyBoneNodes, rootOverride } from "./prop-placement.mjs";

const [mode = "build", ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((pairs, arg, i, all) => arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
const research = resolve(args.research ?? "scripts/generated/anim-export/research");
const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];
const pkg = gamePath => gamePath.replace(/\.[^./]+$/, "").replace(/^\/?Game\//, "Discovery/Content/").replace(/^\//, ""); // "/Game/A/B.B" -> "Discovery/Content/A/B"
const rel = (root, file) => file.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").length + 1);

// --- Materials: merged instance chain ------------------------------------------------------------------------------
const materialJson = new Map(); // package -> exports
for (const dir of readdirSync(research).filter(d => d.startsWith("json-prop-material"))) // materials, parents, parents-2, ...
  for (const file of walk(join(research, dir)).filter(f => f.endsWith(".json")))
    materialJson.set(rel(join(research, dir), file).replace(/\.json$/, ""), JSON.parse(readFileSync(file, "utf8")));
function resolveMaterial(gamePath) {
  const chain = [];
  const merged = { textures: {}, scalars: {}, vectors: {}, switches: {}, master: null, blendMode: null, twoSided: null, missing: null };
  let current = gamePath ? pkg(gamePath) : null;
  for (let depth = 0; current && depth < 8; depth++) {
    const exports = materialJson.get(current);
    if (!exports) { merged.missing = current; break; }
    const m = exports.find(e => /^Material(InstanceConstant)?$/.test(e.Type));
    if (!m) { merged.missing = current; break; }
    chain.push(current);
    const p = m.Properties ?? {};
    if (m.Type === "Material") {
      merged.master = basename(current);
      merged.blendMode ??= p.BlendMode ?? null;
      merged.twoSided ??= p.TwoSided ?? null;
      break;
    }
    // Child values win: only fill what a nearer instance has not set.
    for (const t of p.TextureParameterValues ?? []) merged.textures[t.ParameterInfo.Name] ??= t.ParameterValue?.ObjectPath ? pkg(t.ParameterValue.ObjectPath.replace(/\.\d+$/, "")) : null;
    for (const s of p.ScalarParameterValues ?? []) merged.scalars[s.ParameterInfo.Name] ??= s.ParameterValue;
    for (const v of p.VectorParameterValues ?? []) merged.vectors[v.ParameterInfo.Name] ??= v.ParameterValue;
    for (const s of (p.StaticParameters ?? p.StaticParametersRuntime)?.StaticSwitchParameters ?? []) merged.switches[s.ParameterInfo.Name] ??= s.Value;
    const o = p.BasePropertyOverrides ?? {};
    if (o.bOverride_BlendMode) merged.blendMode ??= o.BlendMode;
    if (o.bOverride_TwoSided) merged.twoSided ??= o.TwoSided;
    const parent = p.Parent?.ObjectPath;
    if (!parent) break;
    if (!/MaterialInstance/.test(p.Parent.ObjectName ?? "")) { merged.master = p.Parent.ObjectName?.match(/'([^']+)'/)?.[1] ?? null; break; }
    current = pkg(parent.replace(/\.\d+$/, ""));
  }
  return { path: gamePath, chain, ...merged };
}

// The packed layout this builder understands, or a fallback recipe.
function recipeOf(material) {
  if (/Hologram/i.test(material.master ?? "")) return { kind: "hologram", baseColor: null, packedNormal: null, approximate: true };
  const t = material.textures;
  const packed = t.NOH ?? t.NOM ?? null;
  if (t.CR && packed) {
    const metallicAlpha = material.switches.ActivateAlphaMetallic ?? /_NOM$/i.test(packed);
    return { kind: "CR+NOx", baseColor: t.CR, roughnessFromBaseAlpha: true, packedNormal: packed, metallicAlpha, approximate: false };
  }
  const colour = t.CR ?? t.Color ?? t.BaseColor ?? t.Diffuse ?? t.Albedo ?? t.Grayscale ?? t.Graphic ?? null;
  const tint = material.vectors.Color ?? material.vectors.BaseColor ?? material.vectors.Tint ?? null;
  return { kind: "fallback", baseColor: colour, roughnessFromBaseAlpha: !!t.CR, packedNormal: null, metallicAlpha: false,
    tint: tint ? [tint.R, tint.G, tint.B] : null, approximate: true };
}

// --- Survey + catalog -----------------------------------------------------------------------------------------------
const survey = JSON.parse(readFileSync(resolve(args.survey ?? join(research, "prop-survey.json")), "utf8"));
const meshHeaders = new Map();
for (const file of walk(join(research, "prop-meshes-2")).filter(f => f.endsWith(".mesh.json")))
  meshHeaders.set(rel(join(research, "prop-meshes-2"), file).replace(/\.mesh\.json$/, ""), file);
const componentMaterials = (actor, c) => {
  const header = meshHeaders.get(pkg(c.staticMesh ?? c.skeletalMesh));
  if (!header) return [];
  const slots = JSON.parse(readFileSync(header, "utf8")).materials;
  return slots.map((slot, i) => c.materials?.[i] ?? slot.material);
};

// --- Skeletal prop animation ----------------------------------------------------------------------------------------
const animRecords = new Map(walk(join(research, args["prop-anims"] ?? "prop-anims-2", "anims")).filter(f => f.endsWith(".json")).map(f => [basename(f, ".json"), f]));
const abpSequence = new Map(), abpClock = new Map(), abpModify = new Map(), abpControlRig = new Set();
for (const file of walk(join(research, "json-prop-abp")).filter(f => f.endsWith(".json"))) {
  const text = readFileSync(file, "utf8");
  const sequence = text.match(/"ObjectName": "AnimSequence'([^']+)'"/);
  if (sequence) abpSequence.set(basename(file, ".json"), sequence[1]);
  // A SequenceEvaluator fed PropAnimTime: the emote's PropAnimSequenceTime curve sets the time (else: from spawn).
  abpClock.set(basename(file, ".json"), /PropAnimTime/.test(text) ? "emote-curve" : "spawn");
  // Its ModifyBone nodes: a constant root that replaces the sequence's keyed one (prop-placement.mjs).
  abpModify.set(basename(file, ".json"), modifyBoneNodes(JSON.parse(text)));
  if (/"AnimGraphNode_ControlRig(_\d+)?"/.test(text)) abpControlRig.add(basename(file, ".json"));
}
const NULL_MESH = /_3P_MasterSkeletonNullMesh$/, PROXY_MESH = /SK_EmoteProxyCharacter$/;
function clockFor(actor, c) {
  if (c.animClass && !/SingleNode/.test(c.animationMode ?? "")) return abpClock.get(basename(c.animClass)) ?? "spawn";
  if (PROXY_MESH.test(c.skeletalMesh ?? "")) {
    const leader = actor.components.find(o => NULL_MESH.test(o.skeletalMesh ?? "") && o.animClass);
    if (leader) return clockFor(actor, leader);
  }
  return "spawn";
}
function sequenceFor(actor, c) {
  // UE plays AnimToPlay only in single-node mode; the default mode runs the AnimBlueprint (a leftover AnimToPlay is
  // ignored, as on the proxies' leader meshes).
  if (c.animToPlay && /SingleNode/.test(c.animationMode ?? "")) return basename(c.animToPlay);
  if (c.animClass) return abpSequence.get(basename(c.animClass)) ?? null;
  if (c.animToPlay) return basename(c.animToPlay);
  if (PROXY_MESH.test(c.skeletalMesh ?? "")) { // leader pose: the invisible master-skeleton mesh runs the AnimBlueprint
    const leader = actor.components.find(o => NULL_MESH.test(o.skeletalMesh ?? "") && (o.animClass || o.animToPlay));
    return leader ? sequenceFor(actor, leader) : null;
  }
  return null;
}

if (mode === "targets") {
  const want = new Set(), textures = new Set();
  for (const actor of survey) for (const c of actor.components) if (c.visible && (c.staticMesh || c.skeletalMesh))
    for (const m of componentMaterials(actor, c)) if (m) want.add(m);
  for (const m of want) {
    const r = resolveMaterial(m);
    if (r.missing) textures.add(`missing:${r.missing}`);
    for (const t of Object.values(r.textures)) if (t) textures.add(t);
  }
  const missing = [...textures].filter(t => t.startsWith("missing:")).map(t => t.slice(8));
  const texList = [...textures].filter(t => !t.startsWith("missing:")).sort();
  writeFileSync(join(research, "targets-prop-material-parents.txt"), missing.map(p => p + ".uasset").join("\n") + "\n");
  writeFileSync(join(research, "targets-prop-textures.txt"), texList.map(p => p + ".uasset").join("\n") + "\n");
  console.log(`${want.size} materials; ${missing.length} material packages still missing (export with json mode); ${texList.length} textures`);
  process.exit(0);
}

// --- Math -----------------------------------------------------------------------------------------------------------
const rotatorQuat = ({ Pitch = 0, Yaw = 0, Roll = 0 } = {}) => { // UE FRotator::Quaternion
  const h = Math.PI / 360;
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(Pitch * h), Math.cos(Pitch * h), Math.sin(Yaw * h), Math.cos(Yaw * h), Math.sin(Roll * h), Math.cos(Roll * h)];
  return [cr * sp * sy - sr * cp * cy, -cr * sp * cy - sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
};
const toThreeT = v => v ? [v.X / 100, -v.Y / 100, v.Z / 100] : [0, 0, 0];
const toThreeArrT = t => [t[0] / 100, -t[1] / 100, t[2] / 100];
const toThreeQ = q => { const n = Math.hypot(...q) || 1; return [-q[0] / n, q[1] / n, -q[2] / n, q[3] / n]; };
const toThreeS = s => s ? [s.X, s.Y, s.Z] : [1, 1, 1];
// Column-major 4x4 helpers for the skin's inverse bind matrices.
function compose(t, q, s) {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, t[0], t[1], t[2], 1];
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function invert(m) { // general 4x4 inverse
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det];
}

// --- GLB writer -----------------------------------------------------------------------------------------------------
class Glb {
  constructor() { this.json = { asset: { version: "2.0", generator: "scripts/anim-export/build-props.mjs" }, scenes: [{ nodes: [] }], scene: 0, nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] }; this.chunks = []; this.length = 0; this.used = new Set(); }
  view(bytes, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    const index = this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) }) - 1;
    this.chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); this.length += bytes.byteLength;
    return index;
  }
  accessor(array, type, componentType, target, minmax = false) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: this.view(array, target), componentType, count: array.length / size, type };
    if (minmax) {
      acc.min = Array(size).fill(Infinity); acc.max = Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const k = i % size; acc.min[k] = Math.min(acc.min[k], array[i]); acc.max[k] = Math.max(acc.max[k], array[i]); }
    }
    return this.json.accessors.push(acc) - 1;
  }
  image(bytes) {
    const source = this.json.images.push({ bufferView: this.view(bytes), mimeType: "image/webp" }) - 1;
    return this.json.textures.push({ sampler: 0, extensions: { EXT_texture_webp: { source } } }) - 1;
  }
  write(file) {
    const json = this.json;
    if (json.images.length) { this.used.add("EXT_texture_webp"); json.extensionsRequired = ["EXT_texture_webp"]; }
    if (this.used.size) json.extensionsUsed = [...this.used];
    for (const key of ["meshes", "materials", "textures", "images", "accessors", "bufferViews"]) if (!json[key].length) delete json[key];
    if (!json.images) delete json.samplers;
    json.buffers[0].byteLength = this.length;
    const bin = Buffer.concat([...this.chunks, Buffer.alloc((4 - (this.length % 4)) % 4)]);
    let text = Buffer.from(JSON.stringify(json));
    text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
    jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    const out = Buffer.concat([header, jh, text, bh, bin]);
    writeFileSync(file, out);
    return out.length;
  }
}

// --- Textures -------------------------------------------------------------------------------------------------------
const maxTexture = Number(args["max-texture"] ?? 1024);
const texFile = path => join(research, "prop-textures", path + ".png");
// sharp gets the file's bytes, not its path: libvips cannot open a Windows path of 260+ characters, which deep texture
// packages under a worktree reach (Node can; it reported such a texture as "missing").
const report = { built: 0, approximateMaterials: new Set(), missingTextures: new Set() };
async function rawImage(path, size) {
  const file = texFile(path);
  if (!existsSync(file)) { report.missingTextures.add(path); return null; }
  const bytes = readFileSync(file);
  const meta = await sharp(bytes).metadata();
  const scale = Math.min(1, (size ?? maxTexture) / Math.max(meta.width, meta.height));
  const width = size ?? Math.max(1, Math.round(meta.width * scale)), height = size ?? Math.max(1, Math.round(meta.height * scale));
  const { data, info } = await sharp(bytes).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
const webp = (data, width, height, channels = 3, quality = 88) => sharp(data, { raw: { width, height, channels } }).webp({ quality }).toBuffer();
async function bakeMaterial(glb, recipe, material, doubleSided) {
  const out = { name: basename(material.path ?? "default").split(".")[0], pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.6 }, ...(doubleSided ? { doubleSided: true } : {}) };
  if (recipe.kind === "hologram") {
    glb.used.add("KHR_materials_unlit");
    Object.assign(out, { pbrMetallicRoughness: { baseColorFactor: [0.3, 0.75, 1, 0.35], metallicFactor: 0, roughnessFactor: 1 },
      alphaMode: "BLEND", extensions: { KHR_materials_unlit: {} } });
    return glb.json.materials.push(out) - 1;
  }
  const base = recipe.baseColor ? await rawImage(recipe.baseColor) : null;
  if (base) {
    const { width, height, data } = base, rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; }
    out.pbrMetallicRoughness.baseColorTexture = { index: glb.image(await webp(rgb, width, height)) };
    if (recipe.tint) out.pbrMetallicRoughness.baseColorFactor = [...recipe.tint, 1];
    const packed = recipe.packedNormal ? await rawImage(recipe.packedNormal) : null;
    if (recipe.roughnessFromBaseAlpha || packed) {
      // ORM at the base colour's size: R occlusion (packed B), G roughness (base A), B metallic (packed A).
      const p = packed ? await sharp(readFileSync(texFile(recipe.packedNormal))).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer() : null;
      const orm = Buffer.alloc(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        orm[i * 3] = p ? p[i * 4 + 2] : 255;
        orm[i * 3 + 1] = recipe.roughnessFromBaseAlpha ? data[i * 4 + 3] : 153;
        orm[i * 3 + 2] = p && recipe.metallicAlpha ? p[i * 4 + 3] : 0;
      }
      const ormTex = glb.image(await webp(orm, width, height, 3, 92));
      out.pbrMetallicRoughness.metallicRoughnessTexture = { index: ormTex };
      out.pbrMetallicRoughness.metallicFactor = recipe.metallicAlpha ? 1 : 0;
      out.pbrMetallicRoughness.roughnessFactor = 1;
      if (p) out.occlusionTexture = { index: ormTex };
    }
    if (packed) {
      const { width: w, height: h, data: d } = packed, normal = Buffer.alloc(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const x = d[i * 4] / 127.5 - 1, y = d[i * 4 + 1] / 127.5 - 1;
        normal[i * 3] = d[i * 4];
        normal[i * 3 + 1] = 255 - d[i * 4 + 1]; // DirectX (green down) -> glTF (green up)
        normal[i * 3 + 2] = Math.round((Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.5 + 0.5) * 255);
      }
      out.normalTexture = { index: glb.image(await webp(normal, w, h, 3, 92)) };
    }
  } else if (recipe.tint) out.pbrMetallicRoughness.baseColorFactor = [...recipe.tint, 1];
  else out.pbrMetallicRoughness.baseColorFactor = [0.55, 0.55, 0.55, 1];
  return glb.json.materials.push(out) - 1;
}

// --- Meshes ---------------------------------------------------------------------------------------------------------
function readMesh(packagePath) {
  const headerFile = meshHeaders.get(packagePath);
  if (!headerFile) return null;
  const header = JSON.parse(readFileSync(headerFile, "utf8"));
  const bin = readFileSync(headerFile.replace(/\.mesh\.json$/, ".mesh.bin"));
  const arrays = {};
  for (const a of header.arrays) {
    const Type = { f32: Float32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array }[a.type];
    arrays[a.name] = new Type(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes));
  }
  return { header, arrays };
}
function convertGeometry({ header, arrays }) {
  const n = header.vertexCount, position = new Float32Array(n * 3), normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    position[i * 3] = arrays.position[i * 3] / 100; position[i * 3 + 1] = -arrays.position[i * 3 + 1] / 100; position[i * 3 + 2] = arrays.position[i * 3 + 2] / 100;
    const nx = arrays.normal[i * 3], ny = -arrays.normal[i * 3 + 1], nz = arrays.normal[i * 3 + 2], len = Math.hypot(nx, ny, nz) || 1;
    normal[i * 3] = nx / len; normal[i * 3 + 1] = ny / len; normal[i * 3 + 2] = nz / len;
  }
  // Winding vs normals in three's convention (counter-clockwise front, face normal = (b-a) x (c-a)).
  const index = arrays.index;
  let agree = 0, disagree = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    const e1 = [position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]];
    const e2 = [position[c] - position[a], position[c + 1] - position[a + 1], position[c + 2] - position[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const v = [normal[a] + normal[b] + normal[c], normal[a + 1] + normal[b + 1] + normal[c + 1], normal[a + 2] + normal[b + 2] + normal[c + 2]];
    const d = f[0] * v[0] + f[1] * v[1] + f[2] * v[2];
    if (d > 0) agree++; else if (d < 0) disagree++;
  }
  const flip = disagree > agree;
  const indices = new Uint32Array(index);
  if (flip) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  return { position, normal, uv0: arrays.uv0, indices, flip, windingAgreement: Math.max(agree, disagree) / Math.max(1, agree + disagree) };
}

// --- Build ----------------------------------------------------------------------------------------------------------
const catalog = JSON.parse(readFileSync(resolve(args.catalog ?? "scripts/generated/anim-export/emotes-3/emote-catalog.json"), "utf8"));
const out = resolve(args.out ?? "public/animations/props-1");
mkdirSync(out, { recursive: true });
const wanted = new Set(catalog.flatMap(e => e.notifies.filter(n => n.kind === "prop").map(n => n.asset)));
const actors = {};
report.skipped = []; report.flipped = 0; report.meshes = 0; report.weakWinding = []; report.overrides = [];
for (const actor of survey) {
  if (!wanted.has(actor.actor)) continue;
  const parts = actor.components.filter(c => c.visible && (c.staticMesh || c.skeletalMesh) && !NULL_MESH.test(c.skeletalMesh ?? ""));
  if (!parts.length) { report.skipped.push({ actor: actor.actor, reason: actor.kind === "effects" ? "effects only" : "no visible mesh" }); continue; }
  const glb = new Glb();
  const nodeOf = new Map(); // component name -> node index
  const byName = new Map(actor.components.map(c => [c.name, c]));
  const find = name => byName.get(name) ?? byName.get(`${name}_GEN_VARIABLE`) ?? null;
  const notes = [];
  const materialsOut = [];
  const rootOverrides = [];
  let animated = false, unanimated = false, clock = null;
  const ensureNode = c => {
    if (nodeOf.has(c.name)) return nodeOf.get(c.name);
    const node = { name: c.name.replace(/_GEN_VARIABLE$/, "") };
    if (c.location) node.translation = toThreeT(c.location);
    if (c.rotation) node.rotation = toThreeQ(rotatorQuat(c.rotation));
    if (c.scale) node.scale = toThreeS(c.scale);
    const index = glb.json.nodes.push(node) - 1;
    nodeOf.set(c.name, index);
    const parent = c.name === "Mesh" ? null : find(c.parent ?? "Mesh");
    // A child attached to a bone of a skeletal parent hangs from that bone (the CoconutRider cans on the leader
    // skeleton's prop_01 / weapon_root, which its sequence animates).
    const bone = parent && parent !== c && c.attachSocket && parent.skeletalMesh ? boneNode(parent, c.attachSocket) : null;
    if (bone !== null) (glb.json.nodes[bone].children ??= []).push(index);
    else if (parent && parent !== c) { const p = ensureNode(parent); (glb.json.nodes[p].children ??= []).push(index); }
    else glb.json.scenes[0].nodes.push(index);
    if (c.attachSocket && bone === null) notes.push(`${node.name} attaches to socket ${c.attachSocket} on its parent (not a bone of a skeletal parent: ignored)`);
    if (bone !== null) notes.push(`${node.name} hangs from bone ${c.attachSocket} of ${parent.name.replace(/_GEN_VARIABLE$/, "")}`);
    return index;
  };

  // --- Skeletons: bone nodes made on demand. A skinned mesh asks for every bone; a hidden skeleton (a two-person
  // emote's leader mesh) only for the chain down to a bone something hangs from. Each bone gets its reference pose,
  // the sequence's tracks, and the AnimBlueprint's root override (prop-placement.mjs).
  const skeletons = new Map(); // component name -> state
  function skeletonOf(c) {
    if (skeletons.has(c.name)) return skeletons.get(c.name);
    const meshPath = pkg(c.skeletalMesh);
    const mesh = readMesh(meshPath);
    if (!mesh || mesh.header.kind !== "skeletal") { skeletons.set(c.name, null); return null; }
    const geo = convertGeometry(mesh);
    const bones = mesh.header.bones;
    // A uniform scale on the root (the wings: 100, left by a metres-to-centimetres import) may not be part of the
    // skinning frame: with it, the wing bones sit ~136 m up while the vertices hang at 1.1-1.6 m. Bind pose hides
    // that (skinning is the identity there), but any rotation then swings vertices around pivots metres away. The
    // frame is chosen from the data: whichever reading (root scale kept or dropped) puts more bones inside the mesh's
    // own bounds. A dropped root scale is dropped from the animation too.
    const rootBone = bones.find(b => b.parent < 0), rootScale = rootBone?.s?.[0] ?? 1;
    const worldsOf = dropRoot => {
      const w = [];
      bones.forEach((b, i) => {
        const local = compose(toThreeArrT(b.t), toThreeQ(b.r), dropRoot && b === rootBone ? [1, 1, 1] : b.s);
        w[i] = b.parent >= 0 ? multiply(w[b.parent], local) : local;
      });
      return w;
    };
    const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (let v = 0; v < geo.position.length; v += 3) for (let k = 0; k < 3; k++) {
      bounds[0][k] = Math.min(bounds[0][k], geo.position[v + k]); bounds[1][k] = Math.max(bounds[1][k], geo.position[v + k]);
    }
    const margin = Math.max(...[0, 1, 2].map(k => bounds[1][k] - bounds[0][k])) * 0.5;
    const insideCount = w => w.filter(m => [12, 13, 14].every((e, k) => m[e] >= bounds[0][k] - margin && m[e] <= bounds[1][k] + margin)).length;
    const dropRootScale = Math.abs(rootScale - 1) > 0.01 && insideCount(worldsOf(true)) > insideCount(worldsOf(false));
    if (dropRootScale) notes.push(`${basename(meshPath)}: root scale ${rootScale} left out of the skinning frame (bones then lie inside the mesh)`);
    // The AnimBlueprint driving this pose (a follower proxy copies its leader's: leader pose takes the leader's
    // component-space bones as they are, after the leader's ModifyBone).
    const leader = PROXY_MESH.test(c.skeletalMesh ?? "") ? actor.components.find(o => NULL_MESH.test(o.skeletalMesh ?? "") && o.animClass) : null;
    const abpComponent = c.animClass && !/SingleNode/.test(c.animationMode ?? "") ? c : leader;
    const abp = abpComponent ? basename(abpComponent.animClass) : null;
    const override = abp ? rootOverride(abpModify.get(abp) ?? [], rootBone?.name) : null;
    for (const note of override?.notes ?? []) notes.push(`${basename(meshPath)}: ${note}`);
    if (abp && abpControlRig.has(abp)) notes.push(`${basename(meshPath)}: ${abp} ends in a ControlRig, not reproduced${override?.rotation || override?.translation ? " (it runs after the root override, so the pose shown is a best guess)" : ""}`);
    if (override?.translation || override?.rotation) {
      rootOverrides.push({ component: c.name.replace(/_GEN_VARIABLE$/, ""), bone: override.bone, ...(override.translation ? { translation: override.translation } : {}),
        ...(override.rotation ? { rotation: override.rotation } : {}), from: abp });
      notes.push(`${basename(meshPath)}: ${abp} replaces the root ${override.bone}'s ${[override.translation && "translation", override.rotation && "rotation"].filter(Boolean).join(" and ")} with a constant (ModifyBone); the sequence's root ${override.rotation ? "track is" : "translation is"} not used`);
    }
    const state = { c, meshPath, mesh, geo, bones, rootBone, rootScale, dropRootScale, override, nodes: new Map(), anim: null, matched: 0, unscaled: 0 };
    // The sequence, read once; bones get their channels as they are made.
    const sequence = sequenceFor(actor, c), recordFile = sequence ? animRecords.get(sequence) : null;
    state.sequence = sequence;
    if (recordFile) {
      const anim = JSON.parse(readFileSync(recordFile, "utf8"));
      const frames = anim.frames, frameTime = anim.length / Math.max(1, frames - 1) / (anim.rateScale || 1);
      const boneIndex = new Map(bones.map((b, i) => [b.name.toLowerCase(), i]));
      const tracks = new Map();
      // On such a skeleton the sequences are keyed in the scaled units too: every translation = root scale x the rest
      // translation at frame 0, and the root's scale track repeats the 100. A track with exactly that ratio is divided
      // by the root scale (frame 0 then equals the rest pose); others are left as keyed.
      for (const track of anim.bones) {
        const i = boneIndex.get(track.name.toLowerCase());
        if (i === undefined) continue;
        state.matched++;
        if (track.t && bones[i] !== rootBone && Math.abs(rootScale - 1) > 0.01) {
          const rest = Math.hypot(...bones[i].t), keyed = Math.hypot(...track.t.slice(0, 3));
          if (rest > 1e-3 && Math.abs(keyed / rest - rootScale) < 0.01 * rootScale) {
            track.t = track.t.map(v => v / rootScale);
            state.unscaled++;
          }
        }
        tracks.set(i, track);
      }
      state.anim = { anim, frames, frameTime, tracks, input: null, record: null };
    }
    skeletons.set(c.name, state);
    return state;
  }
  function ensureBone(state, i) {
    if (state.nodes.has(i)) return state.nodes.get(i);
    const { bones, rootBone, override } = state, b = bones[i];
    const isRoot = b === rootBone;
    // A hidden skeleton's bones are named after their component: plain nodes called prop_01 / weapon_root inside a prop
    // could otherwise catch the body clip's tracks of the same name (three binds a track to the first node so named).
    const name = state.c.visible && !NULL_MESH.test(state.c.skeletalMesh ?? "") ? b.name : `${state.c.name.replace(/_GEN_VARIABLE$/, "")}_${b.name}`;
    const node = { name, translation: toThreeArrT(b.t), rotation: toThreeQ(b.r), scale: state.dropRootScale && isRoot ? [1, 1, 1] : b.s };
    if (isRoot && override?.translation) node.translation = override.translation;
    if (isRoot && override?.rotation) node.rotation = override.rotation;
    const index = glb.json.nodes.push(node) - 1;
    state.nodes.set(i, index);
    const parent = b.parent >= 0 ? ensureBone(state, b.parent) : ensureNode(state.c);
    (glb.json.nodes[parent].children ??= []).push(index);
    const a = state.anim, track = a?.tracks.get(i);
    if (track) {
      // The animation is made with its first channel: a root override can leave a bone (or a whole one-bone prop) with
      // nothing keyed, and glTF forbids an animation without channels.
      const add = (path, values, type) => {
        if (!a.record) {
          a.input = glb.accessor(Float32Array.from({ length: a.frames }, (_, f) => f * a.frameTime), "SCALAR", 5126, undefined, true);
          a.record = { name: state.sequence, channels: [], samplers: [] };
          (glb.json.animations ??= []).push(a.record);
        }
        a.record.samplers.push({ input: a.input, output: glb.accessor(values, type, 5126), interpolation: "LINEAR" });
        a.record.channels.push({ sampler: a.record.samplers.length - 1, target: { node: index, path } });
      };
      if (track.r && !(isRoot && override?.rotation)) {
        const q = new Float32Array(a.frames * 4);
        let prev = null;
        for (let f = 0; f < a.frames; f++) {
          let v = toThreeQ(track.r.slice(f * 4, f * 4 + 4));
          if (prev && v[0] * prev[0] + v[1] * prev[1] + v[2] * prev[2] + v[3] * prev[3] < 0) v = v.map(x => -x); // one hemisphere
          q.set(v, f * 4); prev = v;
        }
        add("rotation", q, "VEC4");
      }
      if (track.t && !(isRoot && override?.translation)) {
        const t = new Float32Array(a.frames * 3);
        for (let f = 0; f < a.frames; f++) t.set(toThreeArrT(track.t.slice(f * 3, f * 3 + 3)), f * 3);
        add("translation", t, "VEC3");
      }
      if (track.s) add("scale", Float32Array.from(track.s, v => state.dropRootScale && isRoot ? v / state.rootScale : v), "VEC3");
    }
    return index;
  }
  // The node of a named bone of a skeletal component (built on demand), or null when it has no such bone.
  function boneNode(c, name) {
    const state = skeletonOf(c);
    const i = state?.bones.findIndex(b => b.name.toLowerCase() === name.toLowerCase()) ?? -1;
    if (i < 0) return null;
    const index = ensureBone(state, i);
    describeAnimation(state);
    return index;
  }
  const described = new Set();
  function describeAnimation(state) {
    if (described.has(state)) return;
    described.add(state);
    const name = basename(state.meshPath);
    if (!state.anim) {
      unanimated = true;
      notes.push(`${name}: skeletal, shown in its reference pose (${state.sequence ? `sequence ${state.sequence} not exported` : state.c.animClass ? `AnimBlueprint ${basename(state.c.animClass)} has no sequence` : "no animation"})`);
      return;
    }
    if (!state.anim.tracks.size) { unanimated = true; notes.push(`${name}: ${state.sequence} matched no bones; reference pose`); return; }
    if (!state.anim.record) { notes.push(`${name}: ${state.sequence} keys only what the root override replaces; posed, not animated`); return; }
    animated = true;
    clock = clockFor(actor, state.c);
    notes.push(`${name}: plays ${state.sequence} (${state.matched} bones, ${(state.anim.frameTime * (state.anim.frames - 1)).toFixed(2)} s, looping)${clock === "emote-curve" ? " at the emote's PropAnimSequenceTime" : " from the moment it spawns"}`
      + (state.unscaled ? `; ${state.unscaled} translation tracks keyed in unscaled units divided by the root scale ${state.rootScale}` : ""));
  }

  for (const c of parts) {
    const meshPath = pkg(c.staticMesh ?? c.skeletalMesh);
    const mesh = readMesh(meshPath);
    if (!mesh) { notes.push(`${c.name}: mesh ${meshPath} not exported`); continue; }
    const geo = convertGeometry(mesh);
    report.meshes++; if (geo.flip) report.flipped++;
    if (geo.windingAgreement < 0.9) report.weakWinding.push(`${actor.actor}/${basename(meshPath)} ${(geo.windingAgreement * 100).toFixed(1)}%`);
    const attributes = {
      POSITION: glb.accessor(geo.position, "VEC3", 5126, 34962, true),
      NORMAL: glb.accessor(geo.normal, "VEC3", 5126, 34962),
      TEXCOORD_0: glb.accessor(geo.uv0, "VEC2", 5126, 34962),
    };
    const slots = componentMaterials(actor, c);
    const primitives = [];
    for (const section of mesh.header.sections) {
      if (!section.faces) continue;
      const materialPath = slots[section.material] ?? null;
      const material = resolveMaterial(materialPath);
      // M_Invisible is the game's blockout "hide this section" material (the sensu fan's spare blades): not drawn.
      if (material.master === "M_Invisible") { notes.push(`${basename(meshPath)}: section ${section.material} uses M_Invisible; left out`); continue; }
      const recipe = recipeOf(material);
      if (recipe.approximate) report.approximateMaterials.add(`${material.master ?? "?"}: ${basename(materialPath ?? "none")}`);
      const doubleSided = mesh.header.twoSided || material.twoSided === true;
      const matIndex = await bakeMaterial(glb, recipe, material, doubleSided);
      materialsOut.push({ path: materialPath, master: material.master, recipe: recipe.kind, approximate: recipe.approximate, blendMode: material.blendMode });
      const indices = geo.indices.slice(section.firstIndex, section.firstIndex + section.faces * 3);
      primitives.push({ attributes: { ...attributes }, indices: glb.accessor(indices, "SCALAR", 5125, 34963), material: matIndex });
    }
    const meshIndex = glb.json.meshes.push({ name: basename(meshPath), primitives }) - 1;
    const node = ensureNode(c);
    if (mesh.header.kind === "skeletal") {
      // Skin in the reference pose, bones converted like every transform. The inverse bind matrices come from the
      // reference pose whatever the root override does: skinning needs the bind pose, the override is a pose.
      const state = skeletonOf(c);
      const boneNodes = state.bones.map((_, i) => ensureBone(state, i));
      const world = [];
      state.bones.forEach((b, i) => {
        const local = compose(toThreeArrT(b.t), toThreeQ(b.r), state.dropRootScale && b === state.rootBone ? [1, 1, 1] : b.s);
        world[i] = b.parent >= 0 ? multiply(world[b.parent], local) : local;
      });
      const ibm = new Float32Array(state.bones.length * 16);
      world.forEach((m, i) => ibm.set(invert(m), i * 16));
      const skin = { joints: boneNodes, inverseBindMatrices: glb.accessor(ibm, "MAT4", 5126), skeleton: boneNodes[state.bones.indexOf(state.rootBone)] };
      glb.json.skins = [...(glb.json.skins ?? []), skin];
      const joints = glb.accessor(mesh.arrays.joints, "VEC4", 5123, 34962), weights = glb.accessor(mesh.arrays.weights, "VEC4", 5126, 34962);
      for (const p of glb.json.meshes[meshIndex].primitives) Object.assign(p.attributes, { JOINTS_0: joints, WEIGHTS_0: weights });
      // A skinned mesh node sits next to (not under) its bones in glTF; its own transform is ignored by skinning.
      const skinnedNode = glb.json.nodes.push({ name: `${basename(meshPath)}_skinned`, mesh: meshIndex, skin: glb.json.skins.length - 1 }) - 1;
      (glb.json.nodes[node].children ??= []).push(skinnedNode);
      describeAnimation(state);
    } else glb.json.nodes[node].mesh = meshIndex;
  }
  if (!glb.json.meshes.length) { report.skipped.push({ actor: actor.actor, reason: notes.join("; ") }); continue; }
  const file = `${actor.actor}.glb`;
  const bytes = glb.write(join(out, file));
  if (rootOverrides.length) report.overrides.push(`${actor.actor} (${rootOverrides.map(o => o.from).join(", ")})`);
  actors[actor.actor] = { file, bytes, kind: actor.kind, ...(animated ? { animated, clock } : {}), ...(unanimated ? { unanimated } : {}),
    ...(rootOverrides.length ? { rootOverrides } : {}), materials: materialsOut, ...(notes.length ? { notes } : {}) };
  report.built++;
}

// Sockets the notifies name: a bone, a bone added by the clips (prop_01/weapon_root sit under spine_03 via
// weapon_buffer and are animated by every emote), or a skeleton socket (offset from a bone). Matching is
// case-insensitive, as UE FNames are.
const skeletonFile = walk(join(research, "json-vpj")).find(f => basename(f) === "_3P_MasterSkeleton.json");
const sockets = {};
for (const e of skeletonFile ? JSON.parse(readFileSync(skeletonFile, "utf8")).filter(e => e.Type === "SkeletalMeshSocket") : []) {
  const p = e.Properties ?? {};
  sockets[p.SocketName.toLowerCase()] = { bone: p.BoneName, translation: toThreeT(p.RelativeLocation), rotation: toThreeQ(rotatorQuat(p.RelativeRotation)), scale: toThreeS(p.RelativeScale) };
}
// A texture a material names but the research folder lacks would bake as flat grey: refuse instead.
if (report.missingTextures.size && !("allow-missing-textures" in args))
  throw new Error(`Textures missing from ${join(research, "prop-textures")} (export them, or pass --allow-missing-textures):\n  ${[...report.missingTextures].sort().join("\n  ")}`);

// Each window carries its notify's RelativeTransform (notify-transform.mjs: it places the actor relative to its socket;
// dropped until 10 Nov 2026, so the football showed 6x too big and chairs lay on their side). It composes with the
// actor's own components baked into the GLB, the RainCoat soil's root scale 0.35 included (x notify 0.4).
// A window whose notify names a CurveDrivenTransformPrefix also carries `curve`: the emote's own float curves move it
// every frame, under the notify transform (prop-placement.mjs). They come from the emote sequences' AnimExport records
// (--anims, the run convert-clips.mjs converted).
const animsDir = args.anims ? resolve(args.anims) : null;
const animCache = new Map();
function curveFor(sequence, prefix) {
  if (!animCache.has(sequence)) {
    const file = animsDir && join(animsDir, `${sequence}.json`);
    animCache.set(sequence, file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
  }
  const anim = animCache.get(sequence);
  if (!anim) return null;
  const frameTime = anim.length / Math.max(1, anim.frames - 1) / (anim.rateScale || 1); // as convert-clips.mjs
  const curve = curveTransform(anim.curveValues, prefix, frameTime);
  return curve ? { prefix, ...curve } : null;
}
const emotes = {}, curves = { carried: 0, missing: [] };
for (const e of catalog) {
  const props = e.notifies.filter(n => n.kind === "prop").map(n => {
    const transform = notifyTransform(n.relativeTransform);
    const shown = !!actors[n.asset];
    let curve = null;
    if (n.curvePrefix && shown) {
      if (!animsDir) throw new Error(`${e.sequence}: ${n.asset} is moved by the curves ${n.curvePrefix}_*; pass --anims <exporter run>/anims`);
      curve = curveFor(e.sequence, n.curvePrefix);
      if (curve) curves.carried++; else curves.missing.push(`${e.sequence} ${n.curvePrefix}`);
    }
    return {
      actor: n.asset, socket: n.socket ? n.socket.toLowerCase() : null, start: n.start, duration: n.duration,
      shown, ...(transform ? { transform } : {}), ...(curve ? { curve } : {}),
    };
  });
  if (props.length) emotes[e.sequence] = props;
}
if (curves.missing.length) throw new Error(`Curve-driven windows with no curves in --anims: ${curves.missing.join(", ")}`);
const manifest = { formatVersion: 1, generatedAt: new Date().toISOString(), tool: "scripts/anim-export/build-props.mjs", maxTexture,
  sockets, actors, emotes, skipped: report.skipped, approximateMaterials: [...report.approximateMaterials].sort() };
writeFileSync(join(out, "props.json"), JSON.stringify(manifest, null, 1));
const total = Object.values(actors).reduce((s, a) => s + a.bytes, 0);
console.log(`built ${report.built} prop GLBs (${(total / 1048576).toFixed(1)} MB) from ${report.meshes} meshes; winding flipped on ${report.flipped}; weak winding: ${report.weakWinding.length ? report.weakWinding.join(", ") : "none"}`);
console.log(`root overrides (ModifyBone) on ${report.overrides.length}: ${report.overrides.join("; ") || "none"}`);
console.log(`curve-driven windows: ${curves.carried}; missing textures: ${report.missingTextures.size}`);
console.log(`skipped ${report.skipped.length}: ${Object.entries(report.skipped.reduce((m, s) => (m[s.reason] = (m[s.reason] ?? 0) + 1, m), {})).map(([k, v]) => `${v} ${k}`).join(", ")}`);
console.log(`approximate materials: ${report.approximateMaterials.size}`);
