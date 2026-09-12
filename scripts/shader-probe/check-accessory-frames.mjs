// Where the composed source rest actually puts each supported attachment, using the same
// resolver and the same rest/frame arithmetic the viewer runs, over the preview index on disk.
// This is a geometry placement check against the body's own rest skeleton, not visual acceptance.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import * as THREE from "three";
import { resolveSourceOutfit, resolveSourceRigParts } from "../../src/rig/SourceAssembly.ts";
import { sourceAttachmentRest, sourceAttachmentFrame } from "../../src/rig/SourceAttachment.ts";

const [previewDir, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: node --import tsx check-accessory-frames.mjs <preview-dir> <output.json>");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const assets = read(`${previewDir}/assets.json`);
const data = read("public/models/reconstructed-assembly-v2/customization.json");
const catalog = new Map(read("src/data/items.json").map(item => [item.id, item]));

// Rest world positions of the preserved body's own bones, in the converted GLB axes.
const bodyRest = new Map(Object.entries(assets.attachmentBody.restBones)
  .map(([name, matrix]) => [name, new THREE.Matrix4().fromArray(matrix)]));

function glbBounds(url) {
  const file = resolvePath(previewDir, url);
  const data = readFileSync(file);
  const size = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + size).toString("utf8"));
  const box = new THREE.Box3();
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    box.expandByPoint(new THREE.Vector3(...accessor.min));
    box.expandByPoint(new THREE.Vector3(...accessor.max));
  }
  return box;
}

const rows = [];
for (const [id, name] of Object.entries(data.catalog)) {
  const item = catalog.get(id);
  if (!item) continue;
  const definition = { ...data.definitions[name], id, formatVersion: 1 };
  const source = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]).items[id];
  let parts;
  try { parts = resolveSourceRigParts(source, assets, path => path); } catch { continue; }
  for (const part of parts) {
    const a = part.attachment;
    if (!a?.frame) continue;
    const component = a.frame.kind === "head-component" ? a.frame.components[0] : a.frame.component;
    const socket = { rest: component.rest, restScale: component.restScale };
    const rest = sourceAttachmentRest(a, socket), { frame, scale } = sourceAttachmentFrame(a, socket);
    const parentRest = new THREE.Matrix4().fromArray(component.parentRest);
    const anchor = new THREE.Vector3().setFromMatrixPosition(parentRest);
    const box = glbBounds(assets.meshes[part.sourceMesh].url).applyMatrix4(rest);
    const centre = box.getCenter(new THREE.Vector3());
    const head = bodyRest.get("head"), pelvis = bodyRest.get("pelvis");
    rows.push({
      id, slot: item.slot, sourceIndex: part.sourceIndex, mesh: part.sourceMesh.split(".").pop(),
      socket: a.socket, kind: a.frame.kind, component: component.source.split(".").pop(), bone: component.bone,
      restScale: component.restScale, totalScale: scale.toArray(),
      mirrored: scale.x * scale.y * scale.z < 0,
      frameDeterminant: frame.determinant(),
      // frame * scale must reproduce the composed rest exactly: the decomposition is not a fit.
      decompositionError: Math.max(...frame.clone().multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
        .elements.map((v, i) => Math.abs(v - rest.elements[i]))),
      socketAnchor: anchor.toArray().map(v => +v.toFixed(5)),
      boundsCentre: centre.toArray().map(v => +v.toFixed(5)),
      boundsSize: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(5)),
      distanceToSocketAnchor: +centre.distanceTo(anchor).toFixed(5),
      distanceToHeadBone: +centre.distanceTo(new THREE.Vector3().setFromMatrixPosition(head)).toFixed(5),
      distanceToPelvisBone: +centre.distanceTo(new THREE.Vector3().setFromMatrixPosition(pelvis)).toFixed(5),
    });
  }
}

// Mirrored pairs must land on opposite sides of the body's own sagittal plane, at the same height
// and depth: that is what the source socket's negative X scale means, and a dropped mirror shows here.
const pairs = [];
for (const row of rows) {
  const other = rows.find(r => r.id === row.id && r.sourceIndex !== row.sourceIndex);
  if (!other || row.sourceIndex > other.sourceIndex) continue;
  const [a, b] = [row, other];
  pairs.push({ id: a.id, sockets: [a.socket, b.socket],
    mirroredSides: Math.sign(a.boundsCentre[0]) === -Math.sign(b.boundsCentre[0]),
    reflectionError: +Math.max(Math.abs(a.boundsCentre[0] + b.boundsCentre[0]),
      Math.abs(a.boundsCentre[1] - b.boundsCentre[1]), Math.abs(a.boundsCentre[2] - b.boundsCentre[2])).toFixed(5),
    sizeError: +Math.max(...a.boundsSize.map((v, i) => Math.abs(v - b.boundsSize[i]))).toFixed(5) });
}

const failures = [
  ...rows.filter(r => !Number.isFinite(r.frameDeterminant) || Math.abs(r.frameDeterminant - 1) > 1e-4)
    .map(r => `${r.id} part ${r.sourceIndex}: socket frame is not rigid (${r.frameDeterminant})`),
  ...rows.filter(r => r.decompositionError > 1e-6)
    .map(r => `${r.id} part ${r.sourceIndex}: rest does not factor into frame * scale (${r.decompositionError})`),
  // An earring must sit within 6 cm of its own ear socket; a lower-back prop within 40 cm of the pelvis.
  ...rows.filter(r => r.kind === "head-component" && r.distanceToSocketAnchor > 0.06)
    .map(r => `${r.id} part ${r.sourceIndex}: ${r.distanceToSocketAnchor} m from socket bone ${r.bone}`),
  ...rows.filter(r => r.kind === "optional-mesh" && r.distanceToPelvisBone > 0.4)
    .map(r => `${r.id} part ${r.sourceIndex}: ${r.distanceToPelvisBone} m from the pelvis`),
  ...pairs.filter(p => !p.mirroredSides || p.reflectionError > 0.01 || p.sizeError > 0.01)
    .map(p => `${p.id}: ${p.sockets.join("/")} are not a reflected pair (${p.reflectionError}, ${p.sizeError})`),
];

const report = { formatVersion: 1, marker: "shader-probe/check-accessory-frames", preview: previewDir,
  meaning: "Composed source rest placement for every frame attachment the resolver accepts, measured against the "
    + "preserved body's own rest skeleton. Placement and decomposition only; not visual acceptance.",
  attachments: rows.length, pairs: pairs.length, failures, rows, pairs };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ attachments: rows.length, pairs: pairs.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
