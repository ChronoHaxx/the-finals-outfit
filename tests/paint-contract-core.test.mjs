import test from "node:test";
import assert from "node:assert/strict";
import { baseFaceRules, paintContract, readMaterialInstance, SLOTS } from "../scripts/shader-probe/paint-contract-core.mjs";

// The remaining paint contracts are derived from the compiled shader's uniform values, never from
// the MI's metadata alone. These fixtures mirror the FModel exports and the uniforms recorded by
// evaluate-remaining-paints.py, so each rejection below is one the real inputs could produce.

const GLOBAL = { Association: "EMaterialParameterAssociation::GlobalParameter", Index: -1 };
const param = (Name, ParameterValue, info = GLOBAL) => ({ ParameterInfo: { Name, ...info }, ParameterValue });
const texture = (name) => ({ ObjectName: `Texture2D'${name}'`,
  ObjectPath: `/Game/Discovery/Characters/BodyCosmetics/BodyPaint/Test_01/${name}.0` });
const placement = (R) => ({ R, G: 0, B: 1, A: 0 });

function mi({ parent = "Material'M_Skin'", scalars = {}, vectors = {}, textures = {}, streaming = [], properties = {} } = {}) {
  return readMaterialInstance([{ Name: "MI_Test", LoadedMaterialResources: [], Properties: {
    Parent: { ObjectName: parent },
    ScalarParameterValues: Object.entries(scalars).map(([k, v]) => param(k, v)),
    VectorParameterValues: Object.entries(vectors).map(([k, v]) => param(k, v)),
    TextureParameterValues: Object.entries(textures).map(([k, v]) => param(k, texture(v))),
    TextureStreamingData: streaming,
    ...properties,
  } }]);
}
const registers = (values) => ({ registers: Object.fromEntries(Object.entries(values).map(([r, value]) => [r, { value }])) });
// M_Skin uniforms, idle unless a branch overrides them.
function skin({ paint = {}, tattoo = {} } = {}) {
  const p = { uv: 0, uv2: 0, scale: 1, offset: 0, nonMasked: 0, override: 0, surface: 0, ...paint };
  const t = { uv: 0, uv2: 0, scale: 1, offset: 0, override: 0, ...tattoo };
  return registers({ "cb3[0].w": p.uv, "cb3[1].x": p.uv2, "cb3[1].y": p.scale, "cb3[1].z": p.offset,
    "cb3[2].x": p.nonMasked, "cb3[5].x": p.override, "cb3[8].w": p.surface,
    "cb3[3].w": t.uv, "cb3[4].x": t.uv2, "cb3[4].y": t.scale, "cb3[4].z": t.offset, "cb3[4].w": t.override });
}
function face({ paint = {}, tattoo = {} } = {}) {
  const p = { offset: 0, nonMasked: 0, override: 0, surface: 0, ...paint };
  const t = { offset: 0, override: 0, ...tattoo };
  return registers({ "cb3[2].x": p.offset, "cb3[2].z": p.nonMasked, "cb3[6].y": p.override, "cb3[11].w": p.surface,
    "cb3[5].w": t.offset, "cb3[6].x": t.override });
}
const PAINT_TEXTURES = { BodyPaintColor: "T_Test_C", BodyPaintData: "T_Test_M" };
const stream = (uv, scale, name = "T_Test_M") => [{ TextureName: name, UVChannelIndex: uv, SamplingScale: scale }];

// ArmsBlack_01: one tile on UV1, shifted onto its second tile.
const ARMS = () => mi({
  scalars: { BodyColorOverride: 1, BodyNormalOverride: 0.5, BodyPaintTiles: 1, BodyPaintUV: 1, BodySurfaceOverride: 1 },
  vectors: { BodyPaintPlacement: placement(-1) }, textures: PAINT_TEXTURES, streaming: stream(1, 1),
});
const ARMS_UNIFORMS = () => skin({ paint: { uv: 1, offset: -1, override: 1, surface: 1 } });

test("base face rules: empty tags are unconditional, the generic head tag applies, anything else is refused", () => {
  const rule = (MatchingTags, SlotNames, Behavior = "ECustomizationMaterialBehavior::OverrideParameters") =>
    ({ MaterialInstance: { AssetPathName: `/Game/X/${SlotNames[0]}.${SlotNames[0]}` }, Behavior, MatchingTags, SlotNames });
  const definition = (...rules) => ({ properties: { ActivatesMaterialParameters: rules } });

  const rules = baseFaceRules(definition(rule(["Customization.Slot.Head"], ["shader_head_shader"]), rule([], ["BaseBody"])));
  assert.deepEqual(rules.map((r) => [r.slot, r.spec.target, r.matchingTags.length]), [["BaseBody", "body", 0], ["shader_head_shader", "head", 1]]);
  assert.throws(() => baseFaceRules(definition(rule(["Customization.Slot.Head.Anime"], ["BaseBody"]))), /outside the base face context/);
  assert.throws(() => baseFaceRules(definition(rule([], ["shader_eyes"]))), /no traced recipient/);
  assert.throws(() => baseFaceRules(definition(rule([], ["BaseBody"]), rule([], ["BaseBody"]))), /multiple active material rules/);
  assert.throws(() => baseFaceRules(definition(rule([], ["BaseBody"], "ECustomizationMaterialBehavior::ReplaceMaterial"))), /unsupported material behaviour/);
  assert.throws(() => baseFaceRules(definition()), /no material rule/);
});

test("a shifted one-tile UV1 paint carries its placement offset and masked multiply", () => {
  const contract = paintContract(ARMS(), SLOTS.BaseBody, ARMS_UNIFORMS());
  assert.deepEqual(contract.layer, { target: "body", uv: 1, uvScale: [1, 1], uvOffsetX: -1,
    uvLayout: "sourceBodyPaint", colorOverride: 1, colorMultiply: "masked" });
  assert.equal(contract.branch, "paint");
  assert.match(contract.dataTexture, /T_Test_M\.0$/);
  assert.deepEqual(contract.stream, { texture: "T_Test_M", uvChannel: 1, samplingScale: 1 });
  assert.deepEqual(contract.deferred, { BodyNormalOverride: 0.5, placementUnread: [0, 1, 0] });
  assert.match(contract.trace, /asm:138-146/);
});

test("absent Tiles and Placement come from the evaluated recipient values", () => {
  // RunnyFingers: UV0, Tiles left at the M_Skin default (1).
  const runny = paintContract(mi({
    scalars: { BodyColorOverride: 1, BodyNormalOverride: 0, BodyPaintUV: 0, BodySurfaceOverride: 1 },
    vectors: { BodyPaintPlacement: placement(-1) }, textures: PAINT_TEXTURES, streaming: stream(0, 1),
  }), SLOTS.BaseBody, skin({ paint: { uv: 0, offset: -1, override: 1, surface: 1 } }));
  assert.deepEqual(runny.layer, { target: "body", uv: 0, uvScale: [1, 1], uvOffsetX: -1,
    uvLayout: "sourceBodyPaint", colorOverride: 1, colorMultiply: "masked" });

  // Sweat body: two tiles, no placement vector, override 0 with the nonmasked multiply.
  const sweat = paintContract(mi({
    scalars: { BodyColorOverride: 0, BodyColorMultiplyNonMasked: 1, BodyNormalOverride: 0, BodyPaintUV: 1, BodySurfaceOverride: 1, BodyPaintTiles: 2 },
    textures: PAINT_TEXTURES, streaming: stream(1, 0.5),
  }), SLOTS.BaseBody, skin({ paint: { uv: 1, scale: 0.5, nonMasked: 1, surface: 1 } }));
  assert.deepEqual(sweat.layer, { target: "body", uv: 1, uvScale: [0.5, 1], uvLayout: "sourceBodyPaint",
    colorOverride: 0, colorMultiply: "nonMasked" });
  assert.equal("uvOffsetX" in sweat.layer, false);
});

test("a head paint uses the M_Face uniforms: UV0, no tiles, surface deferred", () => {
  const head = paintContract(mi({
    parent: "MaterialInstanceConstant'MI_Head_HeadMaster_Base_Head'",
    scalars: { BodyColorOverride: 0, BodyColorMultiplyNonMasked: 1, BodyNormalOverride: 1, BodySurfaceOverride: 1 },
    textures: PAINT_TEXTURES, streaming: stream(0, 1),
  }), SLOTS.shader_head_shader, face({ paint: { nonMasked: 1, surface: 1 } }));
  assert.deepEqual(head.layer, { target: "head", uv: 0, uvScale: [1, 1], uvLayout: "sourceBodyPaint",
    colorOverride: 0, colorMultiply: "nonMasked" });
  assert.equal(head.dataTexture, null);
  assert.deepEqual(head.deferred, { BodyNormalOverride: 1, BodySurfaceOverride: 1 });
  assert.match(head.trace, /^M_Face asm:143-150/);
});

test("a colour-only M_Skin tattoo becomes a nonmasked layer on the tattoo coordinates", () => {
  const tattoo = paintContract(mi({
    scalars: { TattooColorOverride: 1, TattooUV: 1, TattooTiles: 1 },
    vectors: { TattooPlacement: placement(-1) }, textures: { TattooColor: "T_Test_Arms_C" },
    streaming: stream(0, 1, "T_Tattoo_Default_M"),
  }), SLOTS.BaseBody, skin({ tattoo: { uv: 1, offset: -1, override: 1 } }));
  assert.equal(tattoo.branch, "tattoo");
  assert.deepEqual(tattoo.layer, { target: "body", uv: 1, uvScale: [1, 1], uvOffsetX: -1,
    uvLayout: "sourceBodyPaint", colorOverride: 1, colorMultiply: "nonMasked" });
  assert.equal(tattoo.dataTexture, null);
  assert.equal(tattoo.stream, "texture not listed in TextureStreamingData");
  assert.match(tattoo.trace, /asm:209-221/);
});

test("contracts outside the traced combinations are refused", () => {
  const cases = [
    ["another parent", () => paintContract(mi({ ...ARMS_SPEC(), parent: "Material'M_Other'" }), SLOTS.BaseBody, ARMS_UNIFORMS()), /not the traced/],
    ["a static permutation", () => paintContract(mi({ ...ARMS_SPEC(), properties: { StaticParametersRuntime: {
      StaticSwitchParameters: [{ bOverride: true }] } } }), SLOTS.BaseBody, ARMS_UNIFORMS()), /static material permutation/],
    ["both branches bound", () => paintContract(mi({ ...ARMS_SPEC(), textures: { ...PAINT_TEXTURES, TattooColor: "T_X" } }), SLOTS.BaseBody, ARMS_UNIFORMS()), /both/],
    ["no colour texture", () => paintContract(mi({ ...ARMS_SPEC(), textures: {} }), SLOTS.BaseBody, ARMS_UNIFORMS()), /neither/],
    ["a head tattoo", () => paintContract(mi({ parent: SLOTS.shader_head_shader.parent, textures: { TattooColor: "T_X" } }),
      SLOTS.shader_head_shader, face({ tattoo: { override: 1 } })), /M_Skin tattoo branch/],
    ["a partial override", () => paintContract(ARMS(), SLOTS.BaseBody, skin({ paint: { uv: 1, offset: -1, override: 0.5, surface: 1 } })), /colour override 0.5/],
    ["a third UV set", () => paintContract(ARMS(), SLOTS.BaseBody, skin({ paint: { uv: 1, uv2: 1, offset: -1, override: 1, surface: 1 } })), /third UV set/],
    ["an MI value the evaluation did not see", () => paintContract(ARMS(), SLOTS.BaseBody, skin({ paint: { uv: 1, offset: 0, override: 1, surface: 1 } })), /BodyPaintPlacement\.R -1 disagrees/],
    ["disagreeing streaming data", () => paintContract(mi({ ...ARMS_SPEC(), streaming: stream(1, 0.5) }), SLOTS.BaseBody, ARMS_UNIFORMS()), /streaming UV 1 x0\.5/],
    ["an active tattoo under a paint", () => paintContract(ARMS(), SLOTS.BaseBody, skin({ paint: { uv: 1, offset: -1, override: 1, surface: 1 }, tattoo: { override: 1 } })), /tattoo branch override/],
    ["a missing uniform", () => paintContract(ARMS(), SLOTS.BaseBody, registers({})), /no evaluated/],
  ];
  for (const [name, run, pattern] of cases) assert.throws(run, pattern, name);
  assert.throws(() => readMaterialInstance([{ Name: "MI", Properties: { ScalarParameterValues: [
    param("BodyPaintUV", 1, { Association: "EMaterialParameterAssociation::LayerParameter", Index: 0 })] } }]), /non-global/);
});

function ARMS_SPEC() {
  return {
    scalars: { BodyColorOverride: 1, BodyNormalOverride: 0.5, BodyPaintTiles: 1, BodyPaintUV: 1, BodySurfaceOverride: 1 },
    vectors: { BodyPaintPlacement: placement(-1) }, textures: PAINT_TEXTURES, streaming: stream(1, 1),
  };
}
