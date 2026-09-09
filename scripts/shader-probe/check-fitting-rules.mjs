import assert from "node:assert/strict";
import * as THREE from "three";
import { fittingMorphNames, SourceFitting } from "../../src/rig/SourceFitting.ts";
import { resolveSourceOutfit } from "../../src/rig/SourceAssembly.ts";

const names = fittingMorphNames([
  "Customization.Shape.PushInsideClothes.push_full_pants",
  "Customization.Shape.PushInsideClothes.push_full_pants",
  "Customization.Shape.ShrinkWrap.shrink_pants_under_skirt",
  "Customization.Shape.PushLumbar.large_shirt",
  "Customization.Shape.PushInsideClothes.push_full_pants.child",
  "Customization.Shape.HeadNeckMatch.head_neck_match",
  "Customization.Shape.HeadNeckMatch.head_neck_match.child",
]);
assert.deepEqual([...names], ["push_full_pants", "shrink_pants_under_skirt", "head_neck_match"]);
const mesh = new THREE.Mesh();
mesh.morphTargetDictionary = { medium_male: 0, push_full_pants: 1, shrink_pants_under_skirt: 2, head_neck_match: 3 };
mesh.morphTargetInfluences = [.6, .25, 0, .15];
const fitting = new SourceFitting();
fitting.apply(mesh, names);
assert.deepEqual(mesh.morphTargetInfluences, [.6, 1, 1, 1]);
fitting.apply(mesh, new Set(["push_full_pants", "missing_target"]));
assert.deepEqual(mesh.morphTargetInfluences, [.6, 1, 0, .15]);
fitting.apply(mesh, new Set());
assert.deepEqual(mesh.morphTargetInfluences, [.6, .25, 0, .15]);
const path = value => ({ AssetPathName: value });
const item = { formatVersion: 1, id: "covered", source: "fixture", sourceSha256: "fixture",
  properties: { ActivatesTags: ["Customization.Shape.PushInsideClothes.push_gloves"],
    VisualParts: [{ StaticMesh: path(""), SkeletalMesh: path("gloves"), Effect: path(""),
      TagOverrides: [{ MatchingTags: ["covering"], bOverrideMesh: true,
        ReplacementStaticMesh: path(""), ReplacementSkeletalMesh: path(""),
        bOverrideEffect: false, ReplacementEffect: path(""), bOverrideMaterials: false, MaterialOverrides: [] }] }] } };
assert.equal(resolveSourceOutfit([item], ["covering"]).fittingTags.length, 0);
assert.deepEqual(resolveSourceOutfit([item]).fittingTags, item.properties.ActivatesTags);
console.log("Fitting activation, exact names, duplicate tags, unrelated weights, restoration and hidden contributors passed");
