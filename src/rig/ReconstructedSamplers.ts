// Shared texture-budget planner for recovered THE FINALS materials.
//
// Recovered shaders bind one sampler per authored texture slot. A handful of
// instances bind more slots than WebGL2 guarantees (MAX_TEXTURE_IMAGE_UNITS is
// 16 on the viewer's baseline), and the viewer's own lighting, shadow and
// environment maps need units on top of that. This module produces one
// deterministic plan that both the runtime loader and the shader probe follow:
//
//   * identical texture identities collapse onto one sampler (production only),
//   * the remaining 2D textures are packed into 2D array layers *only as far as
//     the budget requires*, and
//   * the generated GLSL is rewritten so the affected sample calls read a fixed
//     array layer instead of a 2D texture.
//
// Nothing here resamples, drops or reorders authored data: a packed layer holds
// the same bytes, at the same size, for every authored mip level, and layers do
// not filter into each other, so a fixed-layer array sample is bit-identical to
// the original 2D sample. Only textures whose full mip chain, component type,
// colour space and wrap modes already agree are ever grouped. Sampling policy
// (trilinear, no generated mips, no flip) is a loader-wide constant, so it is
// shared by construction.
//
// This file is pure data: no Three.js, no DOM, no fetching, and no mutation of
// the caller's manifest metadata. It must stay erasable-types only so Node can
// run it directly with --experimental-strip-types.

/** Conservative recovered-sampler target.
 *
 * WebGL2 guarantees 16 fragment texture units. Three's MeshPhysicalMaterial
 * additionally consumes units for the environment map, the LTC transmission /
 * IBL lookups and every shadow map in the viewer scene. 12 leaves four units
 * for that lighting work while still being reachable for every shipped layout.
 * A plan that lands under this number is *not* an acceptance signal: it only
 * says the material fits the budget. */
export const RECOVERED_SAMPLER_TARGET = 12;

export interface SamplerMipSpec {
  width: number;
  height: number;
  offset: number;
  bytes: number;
}

/** The manifest texture record. Extra manifest fields are preserved untouched. */
export interface SamplerTextureSpec {
  id: string;
  slot: string;
  file: string;
  array: boolean;
  cube?: boolean;
  componentType?: "float16";
  depth: number;
  srgb: boolean;
  wrapS: string;
  wrapT: string;
  sha256: string;
  mips: SamplerMipSpec[];
}

export interface SamplerPackLevel {
  width: number;
  height: number;
  /** Bytes of a single layer at this level. */
  bytes: number;
}

export interface SamplerPackLayout {
  width: number;
  height: number;
  depth: number;
  bytesPerPixel: number;
  componentType?: "float16";
  srgb: boolean;
  wrapS: string;
  wrapT: string;
  levels: SamplerPackLevel[];
  /** Bytes of one complete layer, i.e. the authored file length. */
  layerBytes: number;
}

export interface SamplerTextureResource {
  kind: "texture";
  key: string;
  uniform: string;
  /** Every manifest slot served by this resource, in manifest order. */
  slots: string[];
  texture: SamplerTextureSpec;
}

export interface SamplerPackLayer {
  slots: string[];
  texture: SamplerTextureSpec;
}

export interface SamplerPackResource {
  kind: "pack";
  key: string;
  uniform: string;
  index: number;
  layers: SamplerPackLayer[];
  layout: SamplerPackLayout;
}

export type SamplerResource = SamplerTextureResource | SamplerPackResource;

export interface SamplerBinding {
  /** Manifest slot, e.g. "t3". */
  slot: string;
  /** Resource key this slot reads from. */
  resource: string;
  /** Uniform the rewritten shader actually samples. */
  uniform: string;
  kind: "direct" | "alias" | "layer";
  /** Fixed array layer, for kind === "layer". */
  layer?: number;
  /** Pack index, for kind === "layer". */
  pack?: number;
  /** Representative slot, for kind === "alias". */
  aliasOf?: string;
}

export interface SamplerPlanCounts {
  /** Manifest texture bindings. */
  bindings: number;
  /** Distinct texture identities in the manifest. */
  unique: number;
  /** Textures moved into array layers. */
  packed: number;
  /** Array resources created by packing. */
  packs: number;
  /** Samplers the rewritten shader declares. */
  samplers: number;
}

export interface SamplerPlan {
  version: 1;
  target: number;
  deduplicate: boolean;
  withinTarget: boolean;
  counts: SamplerPlanCounts;
  /** One entry per manifest texture, in manifest order. */
  bindings: SamplerBinding[];
  resources: SamplerResource[];
  cacheKey: string;
}

export interface SamplerPlanOptions {
  target?: number;
  /** Collapse identical texture identities onto one sampler. Production binds
   * real cooked bytes and wants this; the arithmetic probe binds independent
   * per-slot synthetic values and must keep every slot separate. */
  deduplicate?: boolean;
}

export interface SamplerRewriteOptions {
  /** Coverage shaders declare a subset of the surface shader's samplers.
   * Slots with no declaration are left alone instead of being invented. */
  allowMissingDeclarations?: boolean;
}

export interface SamplerUniformBinding {
  name: string;
  resource: string;
}

export interface SamplerPackedLevelData {
  width: number;
  height: number;
  data: Uint8Array | Uint16Array;
}

const SLOT_PATTERN = /^t\d+$/;
const SAMPLER_REFERENCE = /\bu_t\d+\b/g;
/** Sample call shapes the rewriter can retarget at a 2D array. Anything else
 * (texelFetch, textureSize, textureOffset, a sampler passed to a helper, …)
 * fails closed rather than being guessed at. */
const SAMPLE_CALL_ARITY: Record<string, number[]> = {
  texture: [2, 3],
  textureLod: [3],
  textureGrad: [4],
};

function slotIndex(slot: string): number {
  return Number(slot.slice(1));
}

function bytesPerPixel(spec: SamplerTextureSpec): number {
  return spec.componentType === "float16" ? 8 : 4;
}

/** Exact resource identity, matching the loader's historical alias check. Two
 * manifest entries that claim the same id must agree on all of it. */
function identitySignature(spec: SamplerTextureSpec): string {
  return JSON.stringify([
    spec.sha256, spec.array, spec.cube, spec.componentType, spec.depth,
    spec.srgb, spec.wrapS, spec.wrapT, spec.mips,
  ]);
}

/** Everything a packed layer must share with its neighbours. Deliberately does
 * not include the content hash: packing groups distinct images, it only
 * requires that the GPU resource description is identical. */
function compatibilitySignature(spec: SamplerTextureSpec): string {
  return JSON.stringify([
    spec.componentType ?? null, spec.srgb, spec.wrapS, spec.wrapT,
    spec.mips.map((mip) => [mip.width, mip.height]),
  ]);
}

/** A texture can become an array layer only if it is a plain single-slice 2D
 * image with an authored mip chain. Arrays and cubes stay independent so the
 * rewriter never has to conflate sampler types. */
function isPackable(spec: SamplerTextureSpec): boolean {
  if (spec.array || spec.cube || spec.depth !== 1) return false;
  if (spec.componentType !== undefined && spec.componentType !== "float16") return false;
  if (spec.componentType === "float16" && spec.srgb) return false;
  if (!Array.isArray(spec.mips) || spec.mips.length === 0) return false;
  return spec.mips.every((mip) => Number.isInteger(mip.width) && Number.isInteger(mip.height)
    && mip.width > 0 && mip.height > 0);
}

function packLayout(members: SamplerTextureSpec[]): SamplerPackLayout {
  const first = members[0];
  const perPixel = bytesPerPixel(first);
  const levels = first.mips.map((mip) => ({
    width: mip.width, height: mip.height, bytes: mip.width * mip.height * perPixel,
  }));
  return {
    width: levels[0].width,
    height: levels[0].height,
    depth: members.length,
    bytesPerPixel: perPixel,
    ...(first.componentType ? { componentType: first.componentType } : {}),
    srgb: first.srgb,
    wrapS: first.wrapS,
    wrapT: first.wrapT,
    levels,
    layerBytes: levels.reduce((total, level) => total + level.bytes, 0),
  };
}

interface PlanGroup {
  spec: SamplerTextureSpec;
  slots: string[];
  pack?: number;
  layer?: number;
}

/**
 * Build the deterministic sampler plan for one manifest's texture list.
 *
 * The input array and its records are only read; callers keep ownership of the
 * manifest metadata and it is never rewritten.
 */
export function planReconstructedSamplers(
  textures: SamplerTextureSpec[],
  options: SamplerPlanOptions = {},
): SamplerPlan {
  const target = options.target ?? RECOVERED_SAMPLER_TARGET;
  const deduplicate = options.deduplicate ?? true;
  // Constant materials (including existing solid nail colours) legitimately
  // have no textures. Their empty plan leaves the shader untouched.
  if (!Array.isArray(textures)) throw new Error("Invalid recovered texture bindings");

  const seenSlots = new Set<string>();
  for (const spec of textures) {
    if (!SLOT_PATTERN.test(spec.slot)) throw new Error("Invalid recovered texture slot");
    if (seenSlots.has(spec.slot)) throw new Error("Duplicate recovered texture slot");
    seenSlots.add(spec.slot);
  }

  // Identical ids must describe an identical resource in either mode. Reject a
  // disagreement instead of quietly picking one of the two descriptions.
  const firstById = new Map<string, PlanGroup>();
  const groups: PlanGroup[] = [];
  for (const spec of textures) {
    const first = firstById.get(spec.id);
    if (first && identitySignature(first.spec) !== identitySignature(spec))
      throw new Error("Conflicting recovered texture identity");
    if (deduplicate && first) {
      // Material instances often bind the same null decal texture to several
      // shader slots. Alias identical resources so they cost one sampler.
      first.slots.push(spec.slot);
      continue;
    }
    const group: PlanGroup = { spec, slots: [spec.slot] };
    if (!first) firstById.set(spec.id, group);
    groups.push(group);
  }

  // Pack only as far as the budget requires, preferring the largest compatible
  // group so the fewest textures move and the fewest new resources appear.
  const buckets = new Map<string, PlanGroup[]>();
  for (const group of groups) {
    if (!isPackable(group.spec)) continue;
    const key = compatibilitySignature(group.spec);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(group); else buckets.set(key, [group]);
  }
  const candidates = [...buckets.values()].filter((bucket) => bucket.length > 1)
    .sort((a, b) => b.length - a.length || slotIndex(a[0].slots[0]) - slotIndex(b[0].slots[0]));

  const packs: PlanGroup[][] = [];
  let excess = groups.length - target;
  for (const bucket of candidates) {
    if (excess <= 0) break;
    const members = bucket.slice(0, Math.min(bucket.length, excess + 1));
    const index = packs.length;
    members.forEach((group, layer) => { group.pack = index; group.layer = layer; });
    packs.push(members);
    excess -= members.length - 1;
  }

  // Resources in first-use order; a pack materialises where its first layer was.
  const resources: SamplerResource[] = [];
  const emittedPacks = new Set<number>();
  for (const group of groups) {
    if (group.pack === undefined) {
      resources.push({
        kind: "texture", key: `tex:${group.spec.id}:${group.spec.slot}`,
        uniform: `u_${group.spec.slot}`, slots: group.slots, texture: group.spec,
      });
      continue;
    }
    if (emittedPacks.has(group.pack)) continue;
    emittedPacks.add(group.pack);
    const members = packs[group.pack];
    resources.push({
      kind: "pack", key: `pack:${group.pack}`, uniform: `u_recoveredPack${group.pack}`,
      index: group.pack,
      layers: members.map((member) => ({ slots: member.slots, texture: member.spec })),
      layout: packLayout(members.map((member) => member.spec)),
    });
  }

  const resourceBySlot = new Map<string, SamplerResource>();
  const groupBySlot = new Map<string, PlanGroup>();
  for (const resource of resources) {
    const layers = resource.kind === "pack" ? resource.layers : [resource];
    for (const layer of layers) for (const slot of layer.slots) resourceBySlot.set(slot, resource);
  }
  for (const group of groups) for (const slot of group.slots) groupBySlot.set(slot, group);

  const bindings: SamplerBinding[] = textures.map((spec) => {
    const resource = resourceBySlot.get(spec.slot)!;
    const group = groupBySlot.get(spec.slot)!;
    if (resource.kind === "pack")
      return {
        slot: spec.slot, resource: resource.key, uniform: resource.uniform,
        kind: "layer", layer: group.layer!, pack: group.pack!,
      };
    if (group.spec.slot !== spec.slot)
      return {
        slot: spec.slot, resource: resource.key, uniform: `u_${group.spec.slot}`,
        kind: "alias", aliasOf: group.spec.slot,
      };
    return { slot: spec.slot, resource: resource.key, uniform: `u_${spec.slot}`, kind: "direct" };
  });

  const counts: SamplerPlanCounts = {
    bindings: textures.length,
    unique: firstById.size,
    packed: packs.reduce((total, pack) => total + pack.length, 0),
    packs: packs.length,
    samplers: resources.length,
  };
  const summary = bindings.map((binding) => binding.kind === "layer"
    ? `${binding.slot}@${binding.pack}.${binding.layer}`
    : binding.kind === "alias" ? `${binding.slot}>${binding.aliasOf}` : binding.slot).join(",");
  return {
    version: 1, target, deduplicate, withinTarget: counts.samplers <= target, counts, bindings, resources,
    cacheKey: `rsp1:${target}:${deduplicate ? 1 : 0}:${counts.bindings}/${counts.unique}/`
      + `${counts.packed}/${counts.packs}/${counts.samplers}:${summary}`,
  };
}

/** Compact, JSON-safe plan description for reports and material userData. */
export function samplerPlanReport(plan: SamplerPlan) {
  return {
    ...plan.counts, target: plan.target, deduplicate: plan.deduplicate,
    withinTarget: plan.withinTarget, cacheKey: plan.cacheKey,
  };
}

/**
 * Uniform names the host must populate, and the plan resource behind each.
 *
 * Aliased slots keep an entry: the surface shader replaces their declaration
 * with a `#define`, so the uniform simply does not exist in that program, while
 * a coverage shader that declares the alias but not its representative still
 * receives the right texture. The mapping is therefore identical for the
 * surface pass and the shadow/coverage pass.
 */
export function samplerUniformBindings(plan: SamplerPlan): SamplerUniformBinding[] {
  const bindings: SamplerUniformBinding[] = [];
  const seen = new Set<string>();
  const add = (name: string, resource: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    bindings.push({ name, resource });
  };
  for (const binding of plan.bindings)
    if (binding.kind !== "layer") add(`u_${binding.slot}`, binding.resource);
  for (const resource of plan.resources)
    if (resource.kind === "pack") add(resource.uniform, resource.key);
  return bindings;
}

function declarationPattern(slot: string, type: string): RegExp {
  return new RegExp(
    `^[ \\t]*uniform[ \\t]+(?:(?:highp|mediump|lowp)[ \\t]+)?${type}(?![A-Za-z0-9_])[ \\t]+u_${slot}[ \\t]*;`,
    "m",
  );
}

function samplerType(spec: SamplerTextureSpec): string {
  return spec.cube ? "samplerCube" : spec.array ? "sampler2DArray" : "sampler2D";
}

/** Mark every byte that belongs to a comment so identifier scanning and
 * argument splitting never trip over commented-out code. */
function commentMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let i = 0;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    const next = source.charCodeAt(i + 1);
    if (c === 47 && next === 47) {
      while (i < source.length && source.charCodeAt(i) !== 10) mask[i++] = 1;
    } else if (c === 47 && next === 42) {
      mask[i++] = 1; mask[i++] = 1;
      while (i < source.length && !(source.charCodeAt(i) === 42 && source.charCodeAt(i + 1) === 47)) mask[i++] = 1;
      if (i < source.length) { mask[i++] = 1; mask[i++] = 1; }
    } else i++;
  }
  return mask;
}

function isIdentifierChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122) || code === 95;
}

interface ParsedCall {
  name: string;
  start: number;
  end: number;
  args: string[];
}

/** Read the sample call whose first argument starts at `at`, or fail closed. */
function parseSampleCall(source: string, mask: Uint8Array, at: number, name: string): ParsedCall {
  let i = at - 1;
  while (i >= 0 && (mask[i] === 1 || /\s/.test(source[i]))) i--;
  if (i < 0 || source[i] !== "(") throw new Error(`Unsupported recovered sampler usage: ${name}`);
  const open = i;
  i--;
  while (i >= 0 && (mask[i] === 1 || /\s/.test(source[i]))) i--;
  const nameEnd = i + 1;
  while (i >= 0 && isIdentifierChar(source.charCodeAt(i))) i--;
  const callName = source.slice(i + 1, nameEnd);
  const arity = Object.prototype.hasOwnProperty.call(SAMPLE_CALL_ARITY, callName)
    ? SAMPLE_CALL_ARITY[callName] : undefined;
  if (!arity) throw new Error(`Unsupported recovered sampler usage: ${name}`);

  const args: string[] = [];
  let depth = 0;
  let argStart = open + 1;
  let j = open;
  for (; j < source.length; j++) {
    if (mask[j] === 1) continue;
    const ch = source[j];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) { args.push(source.slice(argStart, j)); break; }
    } else if (ch === "," && depth === 1) {
      args.push(source.slice(argStart, j));
      argStart = j + 1;
    }
  }
  if (depth !== 0 || j >= source.length) throw new Error(`Unsupported recovered sampler usage: ${name}`);
  if (!arity.includes(args.length) || args[0].trim() !== name)
    throw new Error(`Unsupported recovered sampler usage: ${name}`);
  return { name: callName, start: i + 1, end: j + 1, args };
}

/**
 * Retarget the generated GLSL at the planned samplers.
 *
 * Aliased slots become a `#define` onto their representative, exactly as the
 * loader has always done. Packed slots lose their `sampler2D` declaration and
 * every `texture` / `textureLod` / `textureGrad` call against them is rewritten
 * to the pack's `sampler2DArray` with a constant layer appended to the
 * coordinate. Explicit LODs and explicit gradients keep their own arguments:
 * a 2D array sample takes a vec3 coordinate but still vec2 derivatives, so the
 * filtering footprint is unchanged. Nested coordinate expressions are re-emitted
 * verbatim and are themselves rewritten if they sample a packed slot.
 *
 * The source shader text is never written back to disk; this is a runtime
 * transform of an already hash-verified string.
 */
export function rewriteSamplerGlsl(
  source: string,
  plan: SamplerPlan,
  options: SamplerRewriteOptions = {},
): string {
  const allowMissing = options.allowMissingDeclarations ?? false;
  const specBySlot = new Map<string, SamplerTextureSpec>();
  for (const resource of plan.resources) {
    const layers = resource.kind === "pack" ? resource.layers : [resource];
    for (const layer of layers) for (const slot of layer.slots) specBySlot.set(slot, layer.texture);
  }

  let code = source;
  const declared = (slot: string) => declarationPattern(slot, samplerType(specBySlot.get(slot)!)).test(code);

  // Declarations first, so the removed uniform's own name cannot be mistaken
  // for a sample call while the call sites are being rewritten.
  const packedSlots = new Map<string, SamplerBinding>();
  for (const binding of plan.bindings) {
    if (binding.kind === "direct") continue;
    const pattern = declarationPattern(binding.slot, samplerType(specBySlot.get(binding.slot)!));
    if (!pattern.test(code)) {
      if (!allowMissing) throw new Error("Missing recovered sampler declaration");
      // A coverage shader simply does not bind this slot. Leave it out rather
      // than inventing a declaration for it, but make sure nothing uses it.
      const stray = new RegExp(`\\bu_${binding.slot}\\b`);
      if (stray.test(code)) throw new Error("Missing recovered sampler declaration");
      continue;
    }
    if (binding.kind === "layer") {
      code = code.replace(pattern, "");
      packedSlots.set(binding.slot, binding);
      continue;
    }
    // Aliasing needs its representative in the same shader. A coverage subset
    // that declares the alias but not the representative keeps its own uniform.
    if (!declared(binding.aliasOf!)) {
      if (!allowMissing) throw new Error("Missing recovered sampler declaration");
      continue;
    }
    code = code.replace(pattern, `#define u_${binding.slot} u_${binding.aliasOf}`);
  }

  const usedPacks = new Set<number>();
  if (packedSlots.size) {
    for (;;) {
      const mask = commentMask(code);
      SAMPLER_REFERENCE.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      let found: RegExpExecArray | null = null;
      while ((match = SAMPLER_REFERENCE.exec(code)) !== null) {
        if (mask[match.index] === 1) continue;
        if (!packedSlots.has(match[0].slice(2))) continue;
        found = match;
        break;
      }
      if (!found) break;
      const binding = packedSlots.get(found[0].slice(2))!;
      const call = parseSampleCall(code, mask, found.index, found[0]);
      const args = call.args.map((arg) => arg.trim());
      args[0] = binding.uniform;
      args[1] = `vec3((${args[1]}), ${binding.layer}.0)`;
      code = code.slice(0, call.start) + `${call.name}(${args.join(", ")})` + code.slice(call.end);
      usedPacks.add(binding.pack!);
    }
  }

  const declarations = plan.resources
    .filter((resource): resource is SamplerPackResource => resource.kind === "pack" && usedPacks.has(resource.index))
    .map((resource) => `uniform highp sampler2DArray ${resource.uniform};`);
  if (declarations.length) code = `${declarations.join("\n")}\n${code}`;

  // Fail closed rather than shipping a shader that still names a uniform the
  // plan removed.
  const mask = commentMask(code);
  SAMPLER_REFERENCE.lastIndex = 0;
  let leftover: RegExpExecArray | null = null;
  while ((leftover = SAMPLER_REFERENCE.exec(code)) !== null) {
    if (mask[leftover.index] === 1) continue;
    if (packedSlots.has(leftover[0].slice(2)))
      throw new Error(`Unsupported recovered sampler usage: ${leftover[0]}`);
  }
  return code;
}

/**
 * Interleave verified per-layer files into one mip chain for a 2D array upload.
 *
 * Each authored file stores its levels back to back for a single slice. WebGL2
 * uploads a whole level of an array at once, layer-major, so level L of the
 * pack is every layer's level L concatenated in plan layer order. Every
 * authored byte is copied; nothing is resampled, padded or dropped. Half-float
 * data is handed back as Uint16 over a freshly allocated, aligned buffer.
 */
export function assemblePackedLayers(
  layers: ArrayBuffer[],
  layout: SamplerPackLayout,
): SamplerPackedLevelData[] {
  if (layers.length !== layout.depth) throw new Error("Recovered pack layer count mismatch");
  for (const layer of layers)
    if (layer.byteLength !== layout.layerBytes) throw new Error("Recovered pack layer length mismatch");
  const half = layout.componentType === "float16";
  const levels: SamplerPackedLevelData[] = [];
  let offset = 0;
  for (const level of layout.levels) {
    const slice = new Uint8Array(level.bytes * layout.depth);
    for (let index = 0; index < layers.length; index++)
      slice.set(new Uint8Array(layers[index], offset, level.bytes), index * level.bytes);
    levels.push({
      width: level.width, height: level.height,
      data: half ? new Uint16Array(slice.buffer) : slice,
    });
    offset += level.bytes;
  }
  if (offset !== layout.layerBytes) throw new Error("Recovered pack layer length mismatch");
  return levels;
}
