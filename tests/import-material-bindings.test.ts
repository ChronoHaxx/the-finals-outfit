import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMaterialBindings } from "../scripts/lib/import-material-bindings.ts";

const legacy = {
  bakedSet: { albedo: "models/shell.albedo.webp", normal: "models/shell.normal.webp", orm: "models/shell.orm.webp" },
  regionColors: ["#234567"],
  roughness: 0.9,
};

test("a mixed-material skin binds the old bake only to its actual source instance", () => {
  const { bindings } = composeMaterialBindings({
    materialNames: ["MI_Shell", "MI_Lining", "MI_Visor"],
    slots: [
      { materialName: "MI_Shell", sourceName: "MI_Shell_Black", family: "layered", doubleSided: true },
      { materialName: "MI_Lining", sourceName: "MI_Lining_Red", family: "layered", doubleSided: false },
      { materialName: "MI_Visor", sourceName: "MI_Visor_LED", family: "led", doubleSided: false },
    ],
    primarySourceName: "MI_Shell_Black",
    legacy,
  });
  assert.deepEqual(bindings.MI_Shell.bakedSet, legacy.bakedSet);
  assert.equal(bindings.MI_Shell.doubleSided, true);
  assert.deepEqual(bindings.MI_Lining, { family: "layered", doubleSided: false });
  assert.deepEqual(bindings.MI_Visor, { family: "led", doubleSided: false });
});

test("a missing source binding is explicit and never inherits a neighboring bake", () => {
  const { bindings, issues } = composeMaterialBindings({
    materialNames: ["MI_Shell", "MI_Unknown"],
    slots: [{ materialName: "MI_Shell", sourceName: "MI_Shell_Black", family: "layered" }],
    primarySourceName: "MI_Shell_Black",
    legacy,
  });
  assert.deepEqual(bindings.MI_Unknown, { family: "unknown" });
  assert.ok(issues.some((issue) => issue.materialName === "MI_Unknown"));
});

test("a slot-specific bake supersedes the old bake while fresh source sidedness stays authoritative", () => {
  const ownBake = { albedo: "models/lining.albedo.webp", normal: "models/lining.normal.webp", orm: "models/lining.orm.webp" };
  const { bindings } = composeMaterialBindings({
    materialNames: ["MI_Lining"],
    slots: [{ materialName: "MI_Lining", family: "layered", doubleSided: false }],
    sidecar: { MI_Lining: { family: "layered", doubleSided: true, bakedSet: ownBake } },
    legacy,
  });
  assert.deepEqual(bindings.MI_Lining.bakedSet, ownBake);
  assert.equal(bindings.MI_Lining.doubleSided, false);
});

test("an explicit failed layered bake suppresses stale catalog textures for single and primary materials", () => {
  for (const materialNames of [["MI_Shell"], ["MI_Shell", "MI_Lining"]]) {
    const { bindings } = composeMaterialBindings({
      materialNames,
      slots: [{ materialName: "MI_Shell", sourceName: "MI_Shell_Black", family: "layered" }],
      primarySourceName: "MI_Shell_Black",
      sidecar: { MI_Shell: { family: "layered" } },
      legacy,
    });
    assert.equal(bindings.MI_Shell.bakedSet, undefined);
    assert.deepEqual(bindings.MI_Shell.regionColors, legacy.regionColors, "valid tint fallback is retained");
    assert.ok(legacy.bakedSet, "composition must not mutate the original catalog material");
  }
});

test("an ambiguous single-material skin cannot reapply a first-MI bake or stale sidecar", () => {
  const { bindings } = composeMaterialBindings({
    materialNames: ["MI_Shell"],
    slots: [{ materialName: "MI_Shell", sourceName: "MI_Shell", family: "layered", doubleSided: true, resolution: "unresolved-skin" }],
    sidecar: { MI_Shell: { family: "layered", bakedSet: legacy.bakedSet } },
    legacy,
  });
  assert.deepEqual(bindings.MI_Shell, { family: "unknown", doubleSided: true });
});

test("a cached layered bake cannot replace a freshly resolved non-layered source material", () => {
  const { bindings, issues } = composeMaterialBindings({
    materialNames: ["MI_Shell", "MI_Preview"],
    slots: [{ materialName: "MI_Preview", family: "unknown", doubleSided: false }],
    sidecar: { MI_Preview: { family: "layered", doubleSided: true, bakedSet: legacy.bakedSet } },
    legacy,
  });
  assert.deepEqual(bindings.MI_Preview, { family: "unknown", doubleSided: false });
  assert.ok(issues.some((issue) => issue.reason.includes("family does not match")));
});

test("attachments with missing source maps cannot fall back to an arbitrary directory bake", () => {
  const { bindings } = composeMaterialBindings({
    materialNames: ["MI_Attachment"],
    slots: [{ materialName: "MI_Attachment", sourceName: "MI_Attachment", family: "attachment" }],
    primarySourceName: "MI_Attachment",
    legacy,
  });
  assert.deepEqual(bindings.MI_Attachment, { family: "attachment" });
});

test("an unambiguous single material retains its existing tint", () => {
  const { bindings } = composeMaterialBindings({ materialNames: ["Hair"], slots: [], legacy });
  assert.deepEqual(bindings.Hair.regionColors, legacy.regionColors);
});

test("a stale material sidecar cannot silently miss the GLB material name", () => {
  assert.throws(() => composeMaterialBindings({
    materialNames: ["MI_Shell"], slots: [],
    sidecar: { MI_WrongShell: { family: "layered", bakedSet: legacy.bakedSet } },
  }), /absent from the GLB/);
});
