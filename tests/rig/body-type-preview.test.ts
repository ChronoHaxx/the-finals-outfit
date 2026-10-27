import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BODY_TYPE_PREVIEWS, bodyTypeOffsetMatrix, bodyTypePreview } from "../../src/rig/BodyTypePreview.ts";
import { multiplySourceMatrices, sourceLocalMatrix, type SourceMatrix } from "../../src/rig/SourceTransform.ts";
import { resolveSourceOutfit, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";
import { headWrapInputs, type HeadWrapData } from "../../src/rig/HeadWrap.ts";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

// The gated masculine body-type context (BodyTypePreview.ts, 21 Oct 2026). Everything here is
// checked against the recovered source asset DA_BodyType_Masculine
// (scripts/generated/shader-probe/definitions-v1/DA_BodyType_Masculine.properties.json) and the
// gate rule: off — no morph weight, no context tag, no socket offset — the preview is exactly
// what it was.

const MASCULINE = BODY_TYPE_PREVIEWS.masculine;

test("the context carries the source asset's own values", () => {
  assert.equal(MASCULINE.tag, "Customization.BodyType.Masculine");
  assert.equal(MASCULINE.mediumMorph, "medium_male");
  // SocketOffsetsMedium, translated verbatim from the asset.
  assert.deepEqual(MASCULINE.socketOffsets.clavicle_attachment, {
    translation: [0.31990716, 1.6830714, -0.035146035],
    rotation: [1.0549824e-06, 2.2451142e-07, 0.036611296, 0.99932957],
    scale: [1, 1, 1],
  });
  assert.deepEqual(MASCULINE.socketOffsets.pet_attachment, {
    translation: [-0.07107357, 1.8490414e-06, 0.70779574],
    rotation: [-1.1373996e-06, -0.031531353, -3.8316787e-07, 0.9995028],
    scale: [1, 1, 1],
  });
  assert.deepEqual(MASCULINE.socketOffsets.upperback_attachment, {
    translation: [5.4529394e-09, -1.2463351, 1.9533218e-07],
    rotation: [0, 2.0816682e-17, 0, 1],
    scale: [1, 1, 1],
  });
});

test("unknown body types are refused; absent stays off", () => {
  assert.equal(bodyTypePreview(undefined), undefined);
  assert.equal(bodyTypePreview("masculine"), MASCULINE);
  assert.throws(() => bodyTypePreview("feminine"), /Unknown body type preview/);
});

// The rotators that reproduce the authored quaternions under sourceRotationQuaternion (least
// squares over its own formula; residue below 3e-7 per component). The direct conversion in
// bodyTypeOffsetMatrix must agree with the established FRotator path element for element.
const ROTATORS = {
  clavicle_attachment: [-2.21345723e-05, 4.19625150, -1.21319311e-04],
  pet_attachment: [3.61381986, -3.98729056e-05, 1.29342923e-04],
} as const;

test("a socket offset converts exactly as an authored FRotator transform does", () => {
  for (const socket of ["clavicle_attachment", "pet_attachment"] as const) {
    const offset = MASCULINE.socketOffsets[socket]!;
    const throughRotator = sourceLocalMatrix(offset.translation, ROTATORS[socket], offset.scale);
    const direct = bodyTypeOffsetMatrix(offset);
    assert.ok(direct.every((v, i) => Math.abs(v - throughRotator[i]) < 1e-6),
      `${socket}: ${JSON.stringify(direct)} vs ${JSON.stringify(throughRotator)}`);
  }
});

test("the identity offset is the identity matrix in the converted frame", () => {
  const offset = bodyTypeOffsetMatrix(MASCULINE.socketOffsets.upperback_attachment!);
  // Translation (X, Z, Y) metres: the authored Y centimetres become the converted Z axis.
  const expected: SourceMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5.4529394e-11, 1.9533218e-09, -0.012463351, 1];
  assert.ok(offset.every((v, i) => Math.abs(v - expected[i]) < 1e-12), JSON.stringify(offset));
});

test("an offset composes on the right of the socket's own rest", () => {
  const rest: SourceMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1];
  const composed = multiplySourceMatrices(rest, bodyTypeOffsetMatrix(MASCULINE.socketOffsets.upperback_attachment!));
  // The offset's own translation, in converted axes and metres, adds to the rest's.
  const expected = rest.map((v, i) => v + ([5.4529394e-11, 1.9533218e-09, -0.012463351][i - 12] ?? 0));
  assert.ok(composed.every((v, i) => Math.abs(v - expected[i]) < 1e-12),
    JSON.stringify(composed) + " vs " + JSON.stringify(expected));
});

/** A skinned-style mesh with a morph dictionary the rig can apply fitting names to. */
function morphMesh(name: string, morphs: string[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.name = name;
  mesh.userData.sourceMesh = `/Game/Stub/${name}`;
  if (morphs.length) {
    mesh.morphTargetDictionary = Object.fromEntries(morphs.map((morph, index) => [morph, index]));
    mesh.morphTargetInfluences = morphs.map(() => 0);
  }
  return mesh;
}

test("the morph is applied only while the gate is on, and only to meshes that carry it", () => {
  const rig = new CharacterRig({} as never);
  const carrier = morphMesh("SK_Carrier_M", ["default_ears", "medium_female", "medium_male"]);
  const bare = morphMesh("SK_Nails_M", ["some_other_morph"]);
  rig.root.add(carrier, bare);
  rig.setSourceFittingTags([]);
  assert.deepEqual([...carrier.morphTargetInfluences!], [0, 0, 0], "gate off leaves the carrier at rest");
  assert.deepEqual([...bare.morphTargetInfluences!], [0]);

  rig.setBodyTypePreview(MASCULINE);
  assert.deepEqual([...carrier.morphTargetInfluences!], [0, 0, 1], "gate on sets medium_male to full weight");
  assert.deepEqual(carrier.userData.sourceFittingMorphs, ["medium_male"]);
  assert.deepEqual([...bare.morphTargetInfluences!], [0], "a mesh without the morph is left alone");
  assert.deepEqual(bare.userData.sourceFittingMorphs, []);

  // Fitting tags keep working with the gate on, and do not remove the body-type morph.
  rig.setSourceFittingTags(["Customization.Shape.DefaultFace.default_ears"]);
  assert.deepEqual(carrier.userData.sourceFittingMorphs, ["default_ears", "medium_male"]);
  assert.deepEqual([...carrier.morphTargetInfluences!], [1, 0, 1]);

  rig.setBodyTypePreview(undefined);
  // The body-type morph leaves with the gate; the tag-driven fitting morph is untouched by it.
  assert.deepEqual([...carrier.morphTargetInfluences!], [1, 0, 0], "gate off again restores the rest weights");
  assert.deepEqual(carrier.userData.sourceFittingMorphs, ["default_ears"]);
});

const CAGE = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.2];
const TRIS = [0, 1, 2, 1, 3, 2];

function wrapData(cageMorphs: Record<string, { vertices: number[]; deltas: number[] }>): HeadWrapData {
  return { formatVersion: 1, contract: "finals-head-component-wrap-v1",
    reference: { source: "ref", positions: CAGE, triangles: TRIS },
    cages: { cage: { positions: CAGE, morphs: cageMorphs } },
    heads: { head: "cage" }, meshes: { mesh: { triangles: TRIS } } };
}

test("a head-wrapped part's cage takes the body-type morph when the cage carries it", () => {
  const withMorph = wrapData({ medium_male: { vertices: [3], deltas: [0.004, 0, 0] } });
  const inputs = headWrapInputs(withMorph, "mesh", "head", ["medium_male"]);
  assert.deepEqual(inputs.morphs, ["medium_male"]);
  assert.ok(inputs.target.every((v, i) => Math.abs(v - (i === 9 ? CAGE[i] + 0.004 : CAGE[i])) < 1e-9),
    JSON.stringify(inputs.target));
  // A cage that does not carry it (every cage in the active index today) ignores the name,
  // exactly as a head mesh without a morph does.
  const withoutMorph = wrapData({ default_ears: { vertices: [3], deltas: [0.002, 0, 0] } });
  const rest = headWrapInputs(withoutMorph, "mesh", "head", ["medium_male"]);
  assert.deepEqual(rest.morphs, []);
  assert.equal(rest.target, CAGE, "the published cage stays at rest");
});

// The resolver context tag: DA_Pets_TacticalDog authors two single-tag Customization.BodyType.Masculine
// placement rules; the 16 watches author Heavy+Feminine multi-tag rules. Synthetic definitions in
// that exact shape.

const soft = (value: string) => ({ AssetPathName: value, SubPathString: "" });
const MEDIUM = "Customization.Archetype.Medium";
const MASCULINE_TAG = "Customization.BodyType.Masculine";
const HEAVY_FEMININE = ["Customization.Archetype.Heavy", "Customization.BodyType.Feminine"];
const PET = "/Game/Stub/SK_Pet_M.SK_Pet_M";
const WATCH = "/Game/Stub/SK_Watch_M.SK_Watch_M";

function attachmentItem(): SourceDefinition {
  const offsetRule = (tags: string[]) => ({ MatchingTags: tags, bOverrideMesh: false,
    ReplacementStaticMesh: soft(""), ReplacementSkeletalMesh: soft(""), bOverrideMaterials: false,
    MaterialOverrides: [], bOffsetTransform: true, OffsetPosition: { X: 1, Y: 0, Z: 0 },
    OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, OffsetScale: { X: 1, Y: 1, Z: 1 }, bAddLogicModules: false });
  return { id: "pet", formatVersion: 1, source: "/Game/Stub/DA_Pet.DA_Pet", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::UpperBack"], ActivatesTags: [], VisualParts: [
      { StaticMesh: soft(PET), SkeletalMesh: soft(""), Effect: soft(""),
        TagOverrides: [offsetRule([MASCULINE_TAG]), offsetRule(HEAVY_FEMININE)] }] }
  } as unknown as SourceDefinition;
}

test("the body-type tag joins the resolver context only when gated on", () => {
  const off = resolveSourceOutfit([attachmentItem()], [MEDIUM]).items.pet.parts[0];
  assert.deepEqual(off.unresolved, []);
  const on = resolveSourceOutfit([attachmentItem()], [MEDIUM, MASCULINE_TAG]).items.pet.parts[0];
  assert.deepEqual(on.unresolved, ["unsupported placement or logic override 0"],
    "the masculine rule now matches, and stays refused as an unsupported placement");
  assert.equal(on.staticMesh, PET, "the mesh is not replaced by the rule");
});

test("the watches' Heavy+Feminine rules stay inactive for the Medium masculine context", () => {
  const watch = { ...attachmentItem(), id: "watch" } as SourceDefinition;
  watch.properties = { ...watch.properties, VisualParts: [{
    StaticMesh: soft(WATCH), SkeletalMesh: soft(""), Effect: soft(""),
    TagOverrides: [{ MatchingTags: HEAVY_FEMININE, bOverrideMesh: false, ReplacementStaticMesh: soft(""),
      ReplacementSkeletalMesh: soft(""), bOverrideMaterials: false, MaterialOverrides: [],
      bOffsetTransform: true, OffsetPosition: { X: 1, Y: 0, Z: 0 },
      OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, OffsetScale: { X: 1, Y: 1, Z: 1 }, bAddLogicModules: false }] }] };
  const resolved = resolveSourceOutfit([watch], [MEDIUM, MASCULINE_TAG]).items.watch.parts[0];
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.staticMesh, WATCH);
});
