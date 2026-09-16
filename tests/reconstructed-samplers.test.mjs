// Observable contracts for the shared recovered-sampler budget plan.
// Run: node --experimental-strip-types --test tests/reconstructed-samplers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECOVERED_SAMPLER_TARGET, assemblePackedLayers, planReconstructedSamplers, rewriteSamplerGlsl,
  samplerPlanReport, samplerUniformBindings,
} from "../src/rig/ReconstructedSamplers.ts";

const layouts = JSON.parse(readFileSync(new URL("./fixtures/reconstructed-samplers/vest-layouts.json", import.meta.url), "utf8"));
const byItem = new Map(layouts.map((m) => [m.itemId, m]));
const layoutFor = (id) => byItem.get(`mi-military-assaultvest-polyester-${id}`).textures;

function mips(width, height, bytesPerPixel = 4) {
  const levels = [];
  let offset = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    const bytes = w * h * bytesPerPixel;
    levels.push({ width: w, height: h, offset, bytes });
    offset += bytes;
    if (w === 1 && h === 1) break;
  }
  return levels;
}

function spec(slot, overrides = {}) {
  return {
    id: overrides.id ?? `id-${slot}`, slot, file: `${slot}.bin`, array: false, depth: 1,
    srgb: false, wrapS: "TA_Wrap", wrapT: "TA_Wrap", sha256: overrides.sha256 ?? `sha-${slot}`,
    mips: mips(4, 4), ...overrides,
  };
}

/** n plain, mutually compatible 2D textures, starting at slot t1. */
const compatible = (n, overrides = {}) =>
  Array.from({ length: n }, (_, i) => spec(`t${i + 1}`, overrides));

// ---------------------------------------------------------------------------
// Shipped layouts
// ---------------------------------------------------------------------------

test("every shipped vest layout fits the sampler target in both modes", () => {
  assert.equal(RECOVERED_SAMPLER_TARGET, 12);
  assert.equal(layouts.length, 10);
  for (const manifest of layouts) {
    for (const deduplicate of [true, false]) {
      const plan = planReconstructedSamplers(manifest.textures, { deduplicate });
      assert.ok(plan.withinTarget, `${manifest.itemId} dedupe=${deduplicate} exceeded the target`);
      assert.ok(plan.counts.samplers <= RECOVERED_SAMPLER_TARGET);
      assert.equal(plan.counts.bindings, manifest.textures.length);
      assert.equal(plan.bindings.length, manifest.textures.length);
    }
  }
});

test("the observed failures reach the target the documented way", () => {
  // Black already aliases down to 12 unique resources: nothing else must move.
  const black = planReconstructedSamplers(layoutFor("black"), { deduplicate: true });
  assert.deepEqual(black.counts, { bindings: 17, unique: 12, packed: 0, packs: 0, samplers: 12 });

  // The arithmetic probe keeps all 17 slots independent, so 17 bindings must be
  // packed - not aliased - down to 12 samplers.
  const probe = planReconstructedSamplers(layoutFor("black"), { deduplicate: false });
  assert.equal(probe.counts.samplers, 12);
  assert.equal(probe.counts.bindings, 17);
  assert.ok(probe.bindings.every((b) => b.kind !== "alias"));
  const layered = probe.bindings.filter((b) => b.kind === "layer");
  assert.equal(layered.length, probe.counts.packed);
  // The three slots that share one identity still get three separate layers.
  const shared = ["t10", "t11", "t12"].map((slot) => probe.bindings.find((b) => b.slot === slot));
  assert.ok(shared.every((b) => b.kind === "layer" && b.pack === shared[0].pack));
  assert.deepEqual(shared.map((b) => b.layer), [0, 1, 2]);

  // Moolah has 15 unique samplers and exactly three compatible pairs.
  const moolah = planReconstructedSamplers(layoutFor("moolahcamo"), { deduplicate: true });
  assert.deepEqual(moolah.counts, { bindings: 15, unique: 15, packed: 6, packs: 3, samplers: 12 });

  // RedBlue has 16 bindings / 14 unique and three usable pairs: only two of
  // them may be spent, because only two samplers need to be recovered.
  const redblue = planReconstructedSamplers(layoutFor("redblue"), { deduplicate: true });
  assert.deepEqual(redblue.counts, { bindings: 16, unique: 14, packed: 4, packs: 2, samplers: 12 });
});

test("shipped 2D arrays and cubes are never packed or retyped", () => {
  for (const manifest of layouts) {
    for (const deduplicate of [true, false]) {
      const plan = planReconstructedSamplers(manifest.textures, { deduplicate });
      for (const texture of manifest.textures) {
        if (!texture.array && !texture.cube) continue;
        const binding = plan.bindings.find((b) => b.slot === texture.slot);
        assert.notEqual(binding.kind, "layer", `${texture.slot} of ${manifest.itemId} was packed`);
        assert.equal(binding.uniform, `u_${texture.slot}`);
      }
      for (const resource of plan.resources)
        if (resource.kind === "pack")
          for (const layer of resource.layers) {
            assert.equal(layer.texture.array, false);
            assert.notEqual(layer.texture.cube, true);
            assert.equal(layer.texture.depth, 1);
          }
    }
  }
});

test("planning is deterministic and does not touch manifest metadata", () => {
  for (const manifest of layouts) {
    const before = JSON.stringify(manifest.textures);
    const first = planReconstructedSamplers(manifest.textures, { deduplicate: true });
    const second = planReconstructedSamplers(structuredClone(manifest.textures), { deduplicate: true });
    assert.equal(first.cacheKey, second.cacheKey);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(JSON.stringify(manifest.textures), before, `${manifest.itemId} metadata was mutated`);
  }
  // The key describes the plan, so it separates the materials that are planned
  // differently. (Vests with the same slot layout legitimately share a key; the
  // shader hash is a separate component of the program cache key.)
  const keys = new Set(["black", "moolahcamo", "redblue"].map((id) =>
    planReconstructedSamplers(layoutFor(id)).cacheKey));
  assert.equal(keys.size, 3);
  // The mode is part of the key, so a probe plan can never be mistaken for the
  // production plan in a shader cache or a report.
  const one = layoutFor("moolahcamo");
  assert.notEqual(planReconstructedSamplers(one, { deduplicate: true }).cacheKey,
    planReconstructedSamplers(one, { deduplicate: false }).cacheKey);
  assert.match(samplerPlanReport(planReconstructedSamplers(one)).cacheKey, /^rsp1:12:1:15\/15\/6\/3\/12:/);
});

// ---------------------------------------------------------------------------
// Grouping rules
// ---------------------------------------------------------------------------

test("identical ids must agree; conflicting identities are rejected, not merged", () => {
  const conflict = [spec("t1", { id: "shared" }), spec("t2", { id: "shared", sha256: "other" })];
  for (const deduplicate of [true, false])
    assert.throws(() => planReconstructedSamplers(conflict, { deduplicate }),
      /Conflicting recovered texture identity/);

  const agreeing = [spec("t1", { id: "shared", sha256: "same" }),
    spec("t2", { id: "shared", sha256: "same", file: "t1.bin" })];
  const plan = planReconstructedSamplers(agreeing, { deduplicate: true });
  assert.equal(plan.counts.samplers, 1);
  assert.deepEqual(plan.bindings.map((b) => b.kind), ["direct", "alias"]);
  assert.equal(plan.bindings[1].aliasOf, "t1");
});

test("incompatible textures are never put in one array", () => {
  // 16 textures, forced down to 12: the four variants differ only in one
  // property each and must stay out of the base group.
  const textures = [
    ...compatible(12),
    spec("t13", { srgb: true }),
    spec("t14", { wrapS: "TA_Clamp" }),
    spec("t15", { mips: mips(8, 8) }),
    spec("t16", { componentType: "float16", mips: mips(4, 4, 8) }),
  ];
  const plan = planReconstructedSamplers(textures, { deduplicate: false });
  assert.equal(plan.counts.samplers, 12);
  const pack = plan.resources.find((r) => r.kind === "pack");
  const packedSlots = pack.layers.map((l) => l.texture.slot);
  for (const odd of ["t13", "t14", "t15", "t16"])
    assert.ok(!packedSlots.includes(odd), `${odd} was grouped with incompatible textures`);
  assert.equal(pack.layout.depth, 5);
  assert.equal(pack.layout.srgb, false);
  assert.equal(pack.layout.wrapS, "TA_Wrap");
  assert.deepEqual(pack.layout.levels.map((l) => [l.width, l.height]), [[4, 4], [2, 2], [1, 1]]);
});

test("a wrap/sRGB/mip variant is grouped only with its own kind", () => {
  // Two compatible families of three; the budget needs two samplers back.
  const textures = [
    ...Array.from({ length: 3 }, (_, i) => spec(`t${i + 1}`)),
    ...Array.from({ length: 3 }, (_, i) => spec(`t${i + 4}`, { srgb: true })),
    ...Array.from({ length: 8 }, (_, i) => spec(`t${i + 7}`, { mips: mips(2 + i * 2, 2) })),
  ];
  const plan = planReconstructedSamplers(textures, { deduplicate: false });
  assert.equal(plan.counts.samplers, 12);
  for (const resource of plan.resources) {
    if (resource.kind !== "pack") continue;
    const srgb = new Set(resource.layers.map((l) => l.texture.srgb));
    assert.equal(srgb.size, 1);
  }
});

test("under-budget materials keep their existing behaviour", () => {
  const textures = [...compatible(11), spec("t12", { id: "dup", sha256: "dup" }),
    spec("t13", { id: "dup", sha256: "dup", file: "t12.bin" })];
  const plan = planReconstructedSamplers(textures, { deduplicate: true });
  assert.deepEqual(plan.counts, { bindings: 13, unique: 12, packed: 0, packs: 0, samplers: 12 });
  assert.ok(plan.resources.every((r) => r.kind === "texture"));
  assert.deepEqual(plan.bindings.filter((b) => b.kind === "alias").map((b) => b.slot), ["t13"]);
  // Aliasing alone is still the classic `#define`, byte for byte.
  const glsl = "uniform highp sampler2D u_t12;\nuniform highp sampler2D u_t13;\nvec4 f(vec2 uv){return texture(u_t13,uv);}\n";
  assert.equal(rewriteSamplerGlsl(glsl, plan),
    "uniform highp sampler2D u_t12;\n#define u_t13 u_t12\nvec4 f(vec2 uv){return texture(u_t13,uv);}\n");
});

test("a material that cannot reach the target reports the shortfall instead of guessing", () => {
  const textures = Array.from({ length: 14 }, (_, i) => spec(`t${i + 1}`, { mips: mips(2 + i * 2, 2) }));
  const plan = planReconstructedSamplers(textures, { deduplicate: false });
  assert.equal(plan.counts.samplers, 14);
  assert.equal(plan.withinTarget, false);
  assert.equal(plan.counts.packs, 0);
});

test("malformed slot lists are rejected", () => {
  assert.throws(() => planReconstructedSamplers(null), /Invalid recovered texture bindings/);
  assert.throws(() => planReconstructedSamplers([spec("map")]), /Invalid recovered texture slot/);
  assert.throws(() => planReconstructedSamplers([spec("t1"), spec("t1", { id: "b", sha256: "b" })]),
    /Duplicate recovered texture slot/);
});

test("constant nail materials need no texture and keep their shader unchanged", () => {
  const shader = "vec4 constantNail(){return vec4(0.8,0.0,0.0,1.0);}";
  for (const deduplicate of [true, false]) {
    const plan = planReconstructedSamplers([], { deduplicate });
    assert.equal(plan.counts.samplers, 0);
    assert.equal(plan.withinTarget, true);
    assert.deepEqual(plan.resources, []);
    assert.deepEqual(samplerUniformBindings(plan), []);
    assert.equal(rewriteSamplerGlsl(shader, plan), shader);
  }
});

// ---------------------------------------------------------------------------
// GLSL rewriting
// ---------------------------------------------------------------------------

/** Two compatible textures forced into one array: t1 is layer 0, t2 is layer 1. */
const packPair = () => planReconstructedSamplers(compatible(2), { deduplicate: false, target: 1 });
const PAIR_DECLS = "uniform highp sampler2D u_t1;\nuniform highp sampler2D u_t2;\n";

test("texture, textureLod and textureGrad survive with nested coordinates", () => {
  const source = readFileSync(new URL("./fixtures/reconstructed-samplers/sampling-examples.glsl", import.meta.url), "utf8")
    .replaceAll("u_t19", "u_t13");
  const textures = [spec("t3"), spec("t4"),
    spec("t13", { array: true, depth: 2, mips: mips(4, 4).map((m) => ({ ...m, bytes: m.bytes * 2 })) })];
  // Force t3/t4 into one array while the existing 2D array stays alone.
  const plan = planReconstructedSamplers(textures, { deduplicate: false, target: 2 });
  assert.equal(plan.counts.samplers, 2);
  const out = rewriteSamplerGlsl(source, plan);
  assert.ok(out.startsWith("uniform highp sampler2DArray u_recoveredPack0;\n"));
  assert.ok(!/\bu_t3\b/.test(out) && !/\bu_t4\b/.test(out));
  // The existing array sampler is untouched, types are not conflated.
  assert.ok(out.includes("uniform highp sampler2DArray u_t13;"));
  assert.ok(out.includes("texture(u_t13,vec3(uv1,0.0))"));
  assert.ok(out.includes("texture(u_recoveredPack0, vec3((vec2(uv0.x, uv0.y)), 0.0))"));
  assert.ok(out.includes("textureLod(u_recoveredPack0, vec3((vec2(uv1.x, uv1.y)), 1.0), 0.0)"));
  // Explicit gradients keep their own vec2 derivatives; only P gains a layer.
  assert.ok(out.includes("textureGrad(u_recoveredPack0, vec3((vec2(uv0.x, uv0.y)), 0.0), "
    + "vec2(dFdx(uv0.x), dFdx(uv0.y)), vec2(dFdy(uv0.x), dFdy(uv0.y)))"));
});

test("the failing vests end up with 12 declared samplers in both modes", () => {
  // A generated-shader shape: one declaration per binding, and a mix of the
  // three sample forms the emitter produces.
  const synthesize = (textures) => {
    const declare = (s) => `uniform highp ${s.cube ? "samplerCube" : s.array ? "sampler2DArray" : "sampler2D"} u_${s.slot};`;
    const call = (s, i) => {
      if (s.cube) return `  sum += texture(u_${s.slot}, vec3(uv0, 1.0));`;
      if (s.array) return `  sum += texture(u_${s.slot}, vec3(uv1 * 2.0, 3.0));`;
      if (i % 3 === 1) return `  sum += textureLod(u_${s.slot}, vec2(uv0.x, uv1.y), 1.5);`;
      if (i % 3 === 2) return `  sum += textureGrad(u_${s.slot}, uv0 * vec2(2.0, 3.0), dFdx(uv0), dFdy(uv0));`;
      return `  sum += texture(u_${s.slot}, vec2(uv0.x + 0.5, uv0.y));`;
    };
    return `${textures.map(declare).join("\n")}\nvec4 recoveredSurface(vec2 uv0, vec2 uv1) {\n`
      + `  vec4 sum = vec4(0.0);\n${textures.map(call).join("\n")}\n  return sum;\n}\n`;
  };
  for (const id of ["black", "moolahcamo", "redblue"]) {
    const textures = layoutFor(id);
    const source = synthesize(textures);
    for (const deduplicate of [true, false]) {
      const plan = planReconstructedSamplers(textures, { deduplicate });
      const out = rewriteSamplerGlsl(source, plan);
      const declared = [...out.matchAll(/^uniform highp sampler\w+ (u_\w+);$/gm)].map((m) => m[1]);
      // What the driver counts is the number of sampler uniforms left standing.
      assert.equal(declared.length, plan.counts.samplers, `${id} dedupe=${deduplicate}`);
      assert.equal(declared.length, RECOVERED_SAMPLER_TARGET);
      assert.equal(new Set(declared).size, declared.length);
      // Nothing that was removed is still named, and every rewritten call went
      // through a pack uniform.
      for (const binding of plan.bindings)
        if (binding.kind === "layer")
          assert.ok(!new RegExp(`\\bu_${binding.slot}\\b`).test(out), `${id}: ${binding.slot} still referenced`);
      assert.equal((out.match(/u_recoveredPack\d+, vec3\(/g) ?? []).length,
        plan.bindings.filter((b) => b.kind === "layer").length);
      assert.equal((out.match(/^#define /gm) ?? []).length,
        plan.bindings.filter((b) => b.kind === "alias").length);
      // Sample counts are conserved: nothing was dropped or duplicated.
      assert.equal((out.match(/\btexture\(/g) ?? []).length, (source.match(/\btexture\(/g) ?? []).length);
      assert.equal((out.match(/\btextureLod\(/g) ?? []).length, (source.match(/\btextureLod\(/g) ?? []).length);
      assert.equal((out.match(/\btextureGrad\(/g) ?? []).length, (source.match(/\btextureGrad\(/g) ?? []).length);
    }
  }
});

test("nested and biased sample calls are rewritten inside out", () => {
  const plan = packPair();
  const source = PAIR_DECLS
    + "vec4 f(vec2 uv){ return texture(u_t1, texture(u_t2, uv * vec2(1.0, 2.0)).xy + uv, 0.5); }\n";
  const out = rewriteSamplerGlsl(source, plan);
  assert.ok(!/\bu_t1\b/.test(out) && !/\bu_t2\b/.test(out));
  assert.ok(out.includes("texture(u_recoveredPack0, vec3((texture(u_recoveredPack0, "
    + "vec3((uv * vec2(1.0, 2.0)), 1.0)).xy + uv), 0.0), 0.5)"));
});

test("commented-out references are left alone and do not block the rewrite", () => {
  const plan = packPair();
  const source = "uniform highp sampler2D u_t1;\n// legacy: texture(u_t1, uv)\n"
    + "/* u_t2 */\nuniform highp sampler2D u_t2;\nvec4 f(vec2 uv){return texture(u_t1,uv)+texture(u_t2,uv);}\n";
  const out = rewriteSamplerGlsl(source, plan);
  assert.ok(out.includes("// legacy: texture(u_t1, uv)"));
  assert.ok(out.includes("/* u_t2 */"));
  assert.ok(out.includes("texture(u_recoveredPack0, vec3((uv), 0.0))"));
  assert.ok(out.includes("texture(u_recoveredPack0, vec3((uv), 1.0))"));
});

test("unsupported sampler usage fails closed", () => {
  const plan = packPair();
  for (const body of [
    "vec4 f(vec2 uv){ return texelFetch(u_t1, ivec2(uv), 0); }",
    "ivec2 f(){ return textureSize(u_t1, 0); }",
    "vec4 f(vec2 uv){ return helper(u_t1, uv); }",
    "vec4 f(vec2 uv){ return textureGrad(u_t1, uv, vec2(0.0)); }",
    "vec4 f(vec2 uv){ return textureLod(u_t1, uv); }",
    "vec4 f(vec2 uv){ return textureProj(u_t1, vec3(uv, 1.0)); }",
  ]) assert.throws(() => rewriteSamplerGlsl(PAIR_DECLS + body, plan), /Unsupported recovered sampler usage/, body);
  // A slot the plan expects to rewrite but the shader never declared.
  assert.throws(() => rewriteSamplerGlsl("vec4 f(vec2 uv){return vec4(0.0);}", plan),
    /Missing recovered sampler declaration/);
  // Declared twice: the second declaration would dangle, so refuse.
  assert.throws(() => rewriteSamplerGlsl(PAIR_DECLS + "uniform highp sampler2D u_t1;\n", plan),
    /Unsupported recovered sampler usage/);
});

test("coverage subsets are rewritten from the same plan without inventing declarations", () => {
  const textures = [...compatible(13)];
  const plan = planReconstructedSamplers(textures, { deduplicate: false, target: 12 });
  const packed = plan.bindings.filter((b) => b.kind === "layer");
  assert.ok(packed.length >= 2);
  const [first, second] = packed;
  const coverage = `uniform highp sampler2D u_${second.slot};\n`
    + `float opacity(vec2 uv){ return texture(u_${second.slot}, uv).a; }\n`;
  const out = rewriteSamplerGlsl(coverage, plan, { allowMissingDeclarations: true });
  assert.equal(out, `uniform highp sampler2DArray u_recoveredPack0;\n\n`
    + `float opacity(vec2 uv){ return texture(u_recoveredPack0, vec3((uv), ${second.layer}.0)).a; }\n`);
  // The slot that this pass does not bind stays absent rather than invented.
  assert.ok(!out.includes(`u_${first.slot}`));
  assert.throws(() => rewriteSamplerGlsl(out + `\nvec4 g(vec2 uv){return texture(u_${first.slot}, uv);}`, plan,
    { allowMissingDeclarations: true }), /Missing recovered sampler declaration/);
  // Without the subset allowance the same coverage shader is a hard error.
  assert.throws(() => rewriteSamplerGlsl(coverage, plan), /Missing recovered sampler declaration/);
});

test("aliasing in a coverage subset keeps its own uniform when the representative is absent", () => {
  const textures = [...compatible(11), spec("t12", { id: "dup", sha256: "dup" }),
    spec("t13", { id: "dup", sha256: "dup" })];
  const plan = planReconstructedSamplers(textures, { deduplicate: true });
  assert.equal(plan.bindings.at(-1).kind, "alias");
  const coverage = "uniform highp sampler2D u_t13;\nfloat o(vec2 uv){return texture(u_t13,uv).a;}\n";
  assert.equal(rewriteSamplerGlsl(coverage, plan, { allowMissingDeclarations: true }), coverage);
  // …and the shared uniform mapping still feeds it the representative resource.
  const uniforms = samplerUniformBindings(plan);
  const t12 = uniforms.find((u) => u.name === "u_t12");
  const t13 = uniforms.find((u) => u.name === "u_t13");
  assert.equal(t13.resource, t12.resource);
});

test("the uniform mapping covers every planned sampler exactly once", () => {
  for (const manifest of layouts) {
    for (const deduplicate of [true, false]) {
      const plan = planReconstructedSamplers(manifest.textures, { deduplicate });
      const uniforms = samplerUniformBindings(plan);
      assert.equal(new Set(uniforms.map((u) => u.name)).size, uniforms.length);
      const keys = new Set(plan.resources.map((r) => r.key));
      for (const uniform of uniforms) assert.ok(keys.has(uniform.resource));
      // Every resource is reachable, so no sampler is left unbound.
      assert.equal(new Set(uniforms.map((u) => u.resource)).size, keys.size);
      // Packed slots are fed through their pack, never through a slot uniform.
      for (const binding of plan.bindings)
        if (binding.kind === "layer") assert.ok(!uniforms.some((u) => u.name === `u_${binding.slot}`));
    }
  }
});

// ---------------------------------------------------------------------------
// Layer assembly
// ---------------------------------------------------------------------------

test("packed levels are layer-major and keep every authored mip byte", () => {
  const layout = planReconstructedSamplers([spec("t1", { mips: mips(2, 2) }), spec("t2", { mips: mips(2, 2) })],
    { deduplicate: false, target: 1 }).resources[0].layout;
  assert.deepEqual(layout.levels, [{ width: 2, height: 2, bytes: 16 }, { width: 1, height: 1, bytes: 4 }]);
  assert.equal(layout.layerBytes, 20);
  const layer = (base) => Uint8Array.from({ length: 20 }, (_, i) => base + i).buffer;
  const levels = assemblePackedLayers([layer(0), layer(100)], layout);
  assert.deepEqual([...levels[0].data], [...Array(16).keys(), ...Array(16).keys()].map((v, i) => i < 16 ? v : v + 100));
  assert.deepEqual([...levels[1].data], [16, 17, 18, 19, 116, 117, 118, 119]);
  assert.equal(levels[0].width, 2);
  assert.equal(levels[1].width, 1);
});

test("half-float packs keep their byte order and RGBA16 element view", () => {
  const half = { componentType: "float16", mips: mips(1, 1, 8) };
  const layout = planReconstructedSamplers([spec("t1", half), spec("t2", half)],
    { deduplicate: false, target: 1 }).resources[0].layout;
  assert.equal(layout.bytesPerPixel, 8);
  assert.deepEqual(layout.levels, [{ width: 1, height: 1, bytes: 8 }]);
  const a = new Uint16Array([0x3c00, 0x0001, 0xbc00, 0x7bff]);
  const b = new Uint16Array([0x0002, 0x0003, 0x0004, 0x0005]);
  const levels = assemblePackedLayers([a.buffer, b.buffer], layout);
  assert.ok(levels[0].data instanceof Uint16Array);
  assert.deepEqual([...levels[0].data], [...a, ...b]);
});

test("layer assembly rejects the wrong number or size of source files", () => {
  const layout = planReconstructedSamplers([spec("t1", { mips: mips(2, 2) }), spec("t2", { mips: mips(2, 2) })],
    { deduplicate: false, target: 1 }).resources[0].layout;
  assert.throws(() => assemblePackedLayers([new ArrayBuffer(20)], layout), /layer count mismatch/);
  assert.throws(() => assemblePackedLayers([new ArrayBuffer(20), new ArrayBuffer(16)], layout), /layer length mismatch/);
});

test("distinct per-slot values stay distinct once slots become layers", () => {
  // Mirrors what the probe does: every binding writes only its own layer.
  const plan = planReconstructedSamplers(layoutFor("black"), { deduplicate: false });
  const buffers = new Map(plan.resources.map((r) => [r.key,
    new Float32Array((r.kind === "pack" ? r.layout.depth : 1) * 4)]));
  const value = (slot) => [Number(slot.slice(1)), 0.25, 0.5, 1];
  for (const binding of plan.bindings) {
    if (binding.kind !== "layer") continue;
    buffers.get(binding.resource).set(value(binding.slot), binding.layer * 4);
  }
  for (const binding of plan.bindings) {
    if (binding.kind !== "layer") continue;
    const data = buffers.get(binding.resource).subarray(binding.layer * 4, binding.layer * 4 + 4);
    assert.deepEqual([...data], value(binding.slot), `${binding.slot} lost its own fixture value`);
  }
  // No two slots were handed the same layer of the same array.
  const seats = plan.bindings.filter((b) => b.kind === "layer").map((b) => `${b.resource}#${b.layer}`);
  assert.equal(new Set(seats).size, seats.length);
});
