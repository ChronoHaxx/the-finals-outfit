// Contract derivation for the remaining source body paints, free of I/O so it can be tested.
// prepare-paint-contracts.mjs supplies the decoded item definition, the paint MI and the uniform
// values that evaluate-remaining-paints.py evaluated through the compiled base passes.
//
// Nothing here is fitted or inferred from a picture. Every number a layer carries is the value of a
// uniform the compiled shader reads, cross-checked against the MI's own explicit parameters.

// Recipient slots on the Medium Face 01 base, the parent each paint MI must name, and the compiled
// shader whose uniforms the paint overrides.
export const SLOTS = {
  BaseBody: { part: "bodyhands", target: "body", parent: "Material'M_Skin'", shader: "M_Skin" },
  shader_head_shader: { part: "head", target: "head",
    parent: "MaterialInstanceConstant'MI_Head_HeadMaster_Base_Head'", shader: "M_Face" },
};

// The base face context satisfies only the generic head tag. SourceAssembly.resolveSourceOutfit
// (src/rig/SourceAssembly.ts:157) treats an empty MatchingTags list as unconditional.
export const BASE_TAGS = new Set(["Customization.Slot.Head"]);

// The registers each compiled base pass reads for its paint and tattoo branches, from the
// bindings' uniformFields. M_Face has no UV selection or tile uniform: it always samples uv0.
export const REGISTERS = {
  M_Skin: {
    paint: { uv: "cb3[0].w", uv2: "cb3[1].x", scale: "cb3[1].y", offset: "cb3[1].z",
      nonMasked: "cb3[2].x", override: "cb3[5].x", surface: "cb3[8].w" },
    tattoo: { uv: "cb3[3].w", uv2: "cb3[4].x", scale: "cb3[4].y", offset: "cb3[4].z", override: "cb3[4].w" },
  },
  M_Face: {
    paint: { offset: "cb3[2].x", nonMasked: "cb3[2].z", override: "cb3[6].y", surface: "cb3[11].w" },
    tattoo: { offset: "cb3[5].w", override: "cb3[6].x" },
  },
};

// Where each branch is read in scripts/generated/shader-probe/reference-skin-01/exports/shaders/
// <shader>.SP_PCD3D_SM5.basepass-pixel.dxbc.asm; recorded with every prepared layer.
export const TRACE = {
  M_Skin: {
    paint: "M_Skin asm:138-146 U = sel(uv).x * (1/BodyPaintTiles) + BodyPaintPlacement.x, V = fract(sel(uv).y); " +
      "asm:148-152 G = ceil(sat(U(1-U)) * sat(V(1-V))), a = G*C.a; " +
      "asm:195-198,226 base *= sat(C.rgb + 1 - sat(a + G*BodyColorMultiplyNonMasked)); " +
      "asm:232-235 rgb = mix(base, C.rgb, a*BodyColorOverride); asm:401-423 B/A surface weight a*BodySurfaceOverride",
    tattoo: "M_Skin asm:209-221 U = sel(uv).x * (1/TattooTiles) + TattooPlacement.x, V = fract(sel(uv).y), G; " +
      "asm:222-226 base *= mix(1, C.rgb, G); asm:227-231 rgb = mix(base, mix(1, C.rgb, G), G*C.a*TattooColorOverride)",
  },
  M_Face: {
    paint: "M_Face asm:143-150 U = uv0.x + BodyPaintPlacement.x, V = fract(uv0.y), G, a = G*C.a; " +
      "asm:193-196,226 base *= sat(C.rgb + 1 - sat(a + G*BodyColorMultiplyNonMasked)); " +
      "asm:232-235 rgb = mix(base, C.rgb, a*BodyColorOverride)",
  },
};

/** The rules that apply on the base face, each resolved to the recipient slot it overrides. */
export function baseFaceRules(definition) {
  const out = [];
  for (const rule of definition.properties?.ActivatesMaterialParameters ?? []) {
    const tags = rule.MatchingTags ?? [];
    if (rule.Behavior !== "ECustomizationMaterialBehavior::OverrideParameters")
      throw new Error(`unsupported material behaviour ${rule.Behavior}`);
    if (!tags.every((tag) => BASE_TAGS.has(tag)))
      throw new Error(`conditional material rule ${JSON.stringify(tags)} is outside the base face context`);
    for (const slot of rule.SlotNames ?? []) {
      const spec = SLOTS[slot];
      if (!spec) throw new Error(`material slot ${slot} has no traced recipient`);
      if (out.some((r) => r.slot === slot)) throw new Error(`multiple active material rules for ${slot}`);
      out.push({ slot, spec, materialPath: rule.MaterialInstance?.AssetPathName, matchingTags: tags });
    }
  }
  if (!out.length) throw new Error("no material rule applies on the base face");
  // Body before head, the order the earlier source paints use.
  return out.sort((a, b) => Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot));
}

/** An FModel material instance export reduced to what the contract reads. */
export function readMaterialInstance(json) {
  const record = json[0];
  const props = record.Properties;
  const values = (list) => Object.fromEntries((list ?? []).map((p) => {
    if (p.ParameterInfo.Index !== -1 || !String(p.ParameterInfo.Association).includes("GlobalParameter"))
      throw new Error(`non-global parameter ${p.ParameterInfo.Name}`);
    return [p.ParameterInfo.Name, p.ParameterValue];
  }));
  const permutation = Object.values(props.StaticParametersRuntime ?? {})
    .some((list) => Array.isArray(list) && list.some((entry) => entry.bOverride));
  return {
    name: record.Name,
    parent: props.Parent?.ObjectName,
    scalars: values(props.ScalarParameterValues),
    vectors: values(props.VectorParameterValues),
    textures: Object.fromEntries(Object.entries(values(props.TextureParameterValues))
      .map(([name, value]) => [name, value?.ObjectPath ?? null])),
    streaming: props.TextureStreamingData ?? [],
    staticPermutation: permutation || !!record.LoadedMaterialResources?.length,
  };
}

const traced = (value, name) => {
  if (value !== 0 && value !== 1) throw new Error(`${name} ${value} is not a traced 0/1 value`);
  return value;
};
const textureName = (objectPath) => objectPath.split("/").pop().split(".")[0];

/**
 * The layer contract one paint MI defines on one recipient. `evaluated` is that MI's entry in
 * evaluate-remaining-paints.py's constants.json: `registers[register].value` is the uniform value.
 */
export function paintContract(mi, spec, evaluated) {
  if (mi.parent !== spec.parent) throw new Error(`parent ${mi.parent} is not the traced ${spec.parent}`);
  if (mi.staticPermutation) throw new Error("a static material permutation needs its own compiled shader");
  const paint = !!mi.textures.BodyPaintColor;
  const tattoo = !!mi.textures.TattooColor;
  if (paint === tattoo) throw new Error(`binds ${paint ? "both" : "neither"} BodyPaintColor and TattooColor`);
  if (paint && !mi.textures.BodyPaintData) throw new Error("binds BodyPaintColor without BodyPaintData");
  if (tattoo && (spec.shader !== "M_Skin" || mi.textures.BodyPaintData))
    throw new Error("only a colour-only tattoo on the M_Skin tattoo branch is traced");
  const branch = paint ? "paint" : "tattoo";
  const registers = REGISTERS[spec.shader];
  const read = (which, key) => {
    const register = registers[which][key];
    const value = evaluated?.registers?.[register]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`no evaluated ${register} (${which} ${key})`);
    return value;
  };

  // The other branch must stay at its recipient values, or this layer would describe half the MI.
  const idle = paint
    ? { override: 0, offset: 0, ...(spec.shader === "M_Skin" ? { uv: 0, scale: 1 } : {}) }
    : { override: 0, nonMasked: 0, surface: 0 };
  for (const [key, want] of Object.entries(idle))
    if (read(paint ? "tattoo" : "paint", key) !== want)
      throw new Error(`${paint ? "tattoo" : "paint"} branch ${key} is ${read(paint ? "tattoo" : "paint", key)}, not idle`);

  let uv = 0;
  let scale = 1;
  if (spec.shader === "M_Skin") {
    uv = traced(read(branch, "uv"), "UV selection");
    if (read(branch, "uv2") !== 0) throw new Error("a third UV set is not traced");
    scale = read(branch, "scale");
    if (!(scale > 0)) throw new Error(`unsupported tile scale ${scale}`);
  }
  const offset = read(branch, "offset");
  const override = traced(read(branch, "override"), "colour override");
  // The tattoo branch multiplies by mix(1, C.rgb, G), which is the nonmasked multiply (G is binary).
  const nonMasked = paint ? traced(read(branch, "nonMasked"), "BodyColorMultiplyNonMasked") : 1;
  const surface = paint ? traced(read(branch, "surface"), "BodySurfaceOverride") : 0;

  // The MI's explicit values must be the ones the evaluation saw, which ties the uniforms to this file.
  const prefix = paint ? "BodyPaint" : "Tattoo";
  const explicit = [
    [`${prefix}Placement.R`, mi.vectors[`${prefix}Placement`]?.R, offset],
    [paint ? "BodyColorOverride" : "TattooColorOverride", mi.scalars[paint ? "BodyColorOverride" : "TattooColorOverride"], override],
    ...(spec.shader === "M_Skin" ? [[`${prefix}UV`, mi.scalars[`${prefix}UV`], uv],
      [`${prefix}Tiles`, mi.scalars[`${prefix}Tiles`], 1 / scale]] : []),
    ...(paint ? [["BodyColorMultiplyNonMasked", mi.scalars.BodyColorMultiplyNonMasked, nonMasked],
      ["BodySurfaceOverride", mi.scalars.BodySurfaceOverride, surface]] : []),
  ];
  for (const [name, own, value] of explicit)
    if (own !== undefined && Math.abs(own - value) > 1e-6) throw new Error(`${name} ${own} disagrees with the evaluated uniform ${value}`);

  // TextureStreamingData records the UV channel and horizontal sampling scale the cooker saw. It must
  // agree where the MI lists the texture; TechwearSymbols' tattoo texture is not listed at all.
  const colorTexture = paint ? mi.textures.BodyPaintColor : mi.textures.TattooColor;
  const listed = [paint ? mi.textures.BodyPaintData : null, colorTexture].filter(Boolean).map(textureName);
  const stream = mi.streaming.find((s) => listed.includes(s.TextureName)) ?? null;
  if (stream && (stream.UVChannelIndex !== uv || Math.abs(stream.SamplingScale - scale) > 1e-4))
    throw new Error(`streaming UV ${stream.UVChannelIndex} x${stream.SamplingScale} disagrees with UV ${uv} x${scale}`);

  const placement = mi.vectors[`${prefix}Placement`];
  return {
    branch,
    shader: spec.shader,
    target: spec.target,
    colorParameter: paint ? "BodyPaintColor" : "TattooColor",
    colorTexture,
    // The head's own surface composition is still deferred, exactly as for the earlier head layers.
    dataTexture: paint && spec.target === "body" && surface === 1 ? mi.textures.BodyPaintData : null,
    layer: {
      target: spec.target,
      uv,
      uvScale: [scale, 1],
      ...(offset ? { uvOffsetX: offset } : {}),
      uvLayout: "sourceBodyPaint",
      colorOverride: override,
      colorMultiply: nonMasked ? "nonMasked" : "masked",
    },
    stream: stream ? { texture: stream.TextureName, uvChannel: stream.UVChannelIndex, samplingScale: stream.SamplingScale }
      : "texture not listed in TextureStreamingData",
    trace: TRACE[spec.shader][branch],
    deferred: {
      ...(paint ? { BodyNormalOverride: mi.scalars.BodyNormalOverride ?? 0 } : {}),
      ...(paint && spec.target === "head" ? { BodySurfaceOverride: surface } : {}),
      // Only (Placement).x is a uniform of either compiled base pass; the other components are inert here.
      ...(placement ? { placementUnread: [placement.G, placement.B, placement.A] } : {}),
    },
  };
}
