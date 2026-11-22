// Provenance of the player-number route (22 Nov 2026): for every numbered program in an asset index, find the SM5
// assembly it was sliced from (manifest.assemblySha256) among the local shader-probe exports, and check that every
// site src/rig/PlayerNumber.ts rewrites is MF_CharacterAtlasUV's number branch reading the DecalNumber preshader lanes:
//
//   N     max   uc, u, cb3[lo]            lo     = 0.25 * (1 - saturate(floor(DecalNumber * 0.1)))
//   N+1   min   uc, uc, cb3[hi]           hi     = saturate((1 - (1 - saturate(floor(...)))) + 0.75)
//   N+2   mul   s, uc, 2.0
//   N+3   mul   s, s, 0.1
//   N+4   add   left.right0, s, cb3[tens/ones]
//   N+5   add   right, -k, right0         k written earlier as  mul k, cb3[single], -0.05 ; add k, k, 0.1
//   N+6   add   t, uc, 0.5
//   N+7   round_ni t, t
//   N+8   add_sat sel, t, cb3[single]     single = 1 - saturate(floor(DecalNumber * 0.1))
//   N+9   add   d, -left, right
//   N+10  mul   r, sel, d
//   N+11  add   atlas, r, left
//
// The lane meanings come from each export's own binding report (`// cb3[i].c = <preshader expression>`), so the six
// values the route makes live are shown to be these lanes in every program, not assumed from one.
// Reads local files only; writes nothing.
//   node --import tsx scripts/check-player-number-provenance.mjs --reports <list of *.named.asm paths, one per line>
//        [--index public/models/reconstructed-assemblies-v1/assets.json]
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { findPlayerNumberSites } from "../src/rig/PlayerNumber.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const indexPath = resolve(option("--index", "public/models/reconstructed-assemblies-v1/assets.json"));
const reportsList = option("--reports");
if (!reportsList) throw new Error("--reports <file listing *.named.asm paths> is required");
const repoRoot = resolve(option("--root", "."));
const index = JSON.parse(readFileSync(indexPath, "utf8"));

const byOwner = new Map();
for (const line of readFileSync(reportsList, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const owner = basename(line).replace(/\.SP_PCD3D_SM5\.basepass-pixel\.named\.asm$/, "");
  (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)).push(resolve(repoRoot, line.trim()));
}

const D = String.raw`\(DecalNumber \* 0\.1\d*\)`;
const LANES = {
  lo: new RegExp(String.raw`^\(0\.25 \* \(1\.0 - saturate\(floor\(${D}\)\)\)\)$`),
  hi: new RegExp(String.raw`^saturate\(\(\(1\.0 - \(1\.0 - saturate\(floor\(${D}\)\)\)\) \+ 0\.75\)\)$`),
  tens: new RegExp(String.raw`^\(floor\(${D}\) \* 0\.1\d*\)$`),
  ones: new RegExp(String.raw`^\(\(fmod\(${D}, 1\.0\) \* 10\.0\) \* 0\.1\d*\)$`),
  single: new RegExp(String.raw`^\(1\.0 - saturate\(floor\(${D}\)\)\)$`),
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function splitOperands(text) {
  const out = []; let depth = 0, current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current.trim()); current = ""; } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
function instruction(line) {
  const m = /^\s*([a-z_0-9]+)(?:\s+\[precise(?:\([xyzw]+\))?\])?(?:\([^)]*\))*\s+(.*)$/.exec(line ?? "");
  return m ? { op: m[1], operands: splitOperands(m[2]) } : { op: "", operands: [] };
}
const COMPS = "xyzw";
// Operands: a register or cb3 slot with its swizzle (and sign), or an immediate l(...).
function operand(text) {
  const m = /^(-)?\|?((?:r\d+)|(?:cb\d+\[\d+\]))\.([xyzw]+)\|?$/.exec(text ?? "");
  if (m) return { neg: !!m[1], base: m[2], swizzle: m[3] };
  const l = /^l\((.*)\)$/.exec(text ?? "");
  return l ? { literal: l[1].split(",").map(v => Number(v.trim())) } : { other: text };
}
const destOf = (ins) => { const m = /^(r\d+)\.([xyzw]+)$/.exec(ins.operands[0] ?? ""); return m ? { reg: m[1], mask: m[2] } : null; };
/** The component (or immediate) a source supplies to destination component c: DXBC selects by destination position. */
const compFor = (src, c) => src.swizzle.length === 1 ? src.swizzle : src.swizzle[COMPS.indexOf(c)];
const litFor = (src, c) => src.literal.length === 1 ? src.literal[0] : src.literal[COMPS.indexOf(c)];
const near = (a, b) => Math.abs(a - b) < 1e-6;

/** A scalar value in the assembly: register component written at `line` (1-based). */
function makeTracer(asm) {
  const ins = (line) => instruction(asm[line - 1]);
  /** Instructions after `line` that read ref, until ref is written again: [{line, ins, comps: destination comps}]. */
  function consumers(ref, line) {
    const out = [];
    for (let l = line + 1; l <= asm.length; l++) {
      const i = ins(l), d = destOf(i);
      const comps = d ? [...d.mask].filter(c => i.operands.slice(1).some(o => {
        const op = operand(o); return op.base === ref.reg && compFor(op, c) === ref.comp; })) : [];
      if (comps.length) out.push({ line: l, ins: i, d, comps });
      if (d && d.reg === ref.reg && d.mask.includes(ref.comp)) break;
      if (/^(ret|retc)$/.test(i.op)) break;
    }
    return out;
  }
  /** The last write of ref before `line`. */
  function writer(ref, line) {
    for (let l = line - 1; l > 0; l--) { const i = ins(l), d = destOf(i); if (d && d.reg === ref.reg && d.mask.includes(ref.comp)) return { line: l, ins: i, d }; }
    return null;
  }
  return { ins, consumers, writer };
}

function checkSite(asm, notes, n) {
  const lane = (ref) => notes.get(ref) ?? "";
  const is = (ref, name) => LANES[name].test(lane(ref));
  const { ins, consumers, writer } = makeTracer(asm);
  const cbFor = (i, c) => { for (const o of i.operands.slice(1)) { const op = operand(o); if (op.base?.startsWith("cb3")) return `${op.base}.${compFor(op, c)}`; } return null; };
  const litOf = (i, c) => { for (const o of i.operands.slice(1)) { const op = operand(o); if (op.literal) return litFor(op, c); } return undefined; };
  const one = (list, test, what) => { const hit = list.filter(test); if (hit.length !== 1) throw new Error(`${what}: ${hit.length} candidates`); return hit[0]; };
  const refOf = (hit, c = hit.comps[0]) => ({ reg: hit.d.reg, comp: c });
  try {
    const first = ins(n), d0 = destOf(first);
    if (first.op !== "max" || !d0 || d0.mask.length !== 1) return `line ${n} is ${first.op}, not the clamp's max`;
    const lo = cbFor(first, d0.mask);
    if (!lo || !is(lo, "lo")) return `lo reads ${lo} = ${lane(lo)}`;
    const minHit = one(consumers({ reg: d0.reg, comp: d0.mask }, n), h => h.ins.op === "min", "clamp min");
    const hi = cbFor(minHit.ins, minHit.comps[0]);
    if (!hi || !is(hi, "hi")) return `hi reads ${hi} = ${lane(hi)}`;
    const uc = refOf(minHit), ucUses = consumers(uc, minHit.line);
    const scale = one(ucUses, h => h.ins.op === "mul" && near(litOf(h.ins, h.comps[0]), 2), "uc * 2");
    const half = one(ucUses, h => h.ins.op === "add" && near(litOf(h.ins, h.comps[0]), 0.5), "uc + 0.5");
    const baseHit = one(consumers(refOf(scale), scale.line), h => h.ins.op === "mul" && near(litOf(h.ins, h.comps[0]), 0.1), "* 0.1");
    const base = refOf(baseHit);
    // tens and ones: the adds of base and a cb3 lane, per destination component.
    const laneAdds = consumers(base, baseHit.line).filter(h => h.ins.op === "add" && cbFor(h.ins, h.comps[0]));
    const found = {};
    for (const h of laneAdds) for (const c of h.comps) {
      const ref = cbFor(h.ins, c);
      if (is(ref, "tens")) found.tens = { ...h, comp: c };
      else if (is(ref, "ones")) found.ones = { ...h, comp: c };
      else return `base + ${ref} = ${lane(ref)}`;
    }
    if (!found.tens || !found.ones) return `tens/ones not both added to base (${Object.keys(found).join(",") || "none"})`;
    const round = one(consumers(refOf(half), half.line), h => h.ins.op === "round_ni", "round_ni");
    const sat = one(consumers(refOf(round), round.line), h => h.ins.op === "add_sat", "add_sat");
    const single = cbFor(sat.ins, sat.comps[0]);
    if (!single || !is(single, "single")) return `saturate adds ${single} = ${lane(single)}`;
    // right = (base + ones) - k, k = single * -0.05 + 0.1 computed earlier in the shader.
    const right = one(consumers({ reg: found.ones.d.reg, comp: found.ones.comp }, found.ones.line),
      h => h.ins.op === "add" && h.ins.operands.slice(1).some(o => operand(o).neg), "right - k");
    const kOp = right.ins.operands.slice(1).map(operand).find(op => op.neg && op.base?.startsWith("r"));
    if (!kOp) return `right subtracts ${right.ins.operands.slice(1).join(", ")}`;
    const kRef = { reg: kOp.base, comp: compFor(kOp, right.comps[0]) };
    const kAdd = writer(kRef, right.line);
    if (!kAdd || kAdd.ins.op !== "add" || !near(litOf(kAdd.ins, kRef.comp), 0.1)) return `k written at ${kAdd?.line} as ${asm[(kAdd?.line ?? 1) - 1]?.trim()}`;
    const kMul = writer(kRef, kAdd.line);
    if (!kMul || kMul.ins.op !== "mul" || !near(litOf(kMul.ins, kRef.comp), -0.05)) return `k's product at ${kMul?.line} is ${asm[(kMul?.line ?? 1) - 1]?.trim()}`;
    const kLane = cbFor(kMul.ins, kRef.comp);
    if (!kLane || !is(kLane, "single")) return `k reads ${kLane} = ${lane(kLane)}`;
    return null;
  } catch (error) {
    return error.message;
  }
}

const rows = [];
const seen = new Set();
for (const [key, manifestUrl] of Object.entries(index.materials)) {
  if (typeof manifestUrl !== "string") continue;
  const manifestPath = resolve(dirname(indexPath), manifestUrl);
  if (seen.has(manifestPath)) continue;
  seen.add(manifestPath);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { continue; }
  if (!(manifest.textures ?? []).some(t => /NumbersAtlas/i.test(typeof t === "string" ? t : t.source ?? ""))) continue;
  const name = key.split(".").pop();
  const glsl = readFileSync(resolve(dirname(manifestPath), manifest.shader), "utf8");
  const program = findPlayerNumberSites(glsl);
  if (!program) { rows.push({ name, status: "no sites" }); continue; }
  let asmText, notes;
  for (const report of byOwner.get(manifest.sourceShaderOwner) ?? []) {
    const asmPath = join(dirname(dirname(report)), "shaders", basename(report).replace(/\.named\.asm$/, ".dxbc.asm"));
    let bytes; try { bytes = readFileSync(asmPath); } catch { continue; }
    if (sha(bytes) !== manifest.assemblySha256) continue;
    asmText = bytes.toString("utf8");
    notes = new Map([...readFileSync(report, "utf8").matchAll(/^\/\/ (cb3\[\d+\]\.[xyzw]) = (.*)$/gm)].map(m => [m[1], m[2].trim()]));
    break;
  }
  if (!asmText) { rows.push({ name, status: "assembly not found", owner: manifest.sourceShaderOwner }); continue; }
  const asm = asmText.split(/\r?\n/);
  const lineOf = (node) => Number(new RegExp(String.raw`^\s*\w+ ${node} = .*// asm:(\d+)\s*$`, "m").exec(glsl)?.[1]);
  const failures = program.sites.map(site => checkSite(asm, notes, lineOf([...site.rewrites.keys()][0]))).filter(Boolean);
  rows.push({ name, status: failures.length ? "differs" : "verified", sites: program.sites.length, failures });
}
const count = (s) => rows.filter(r => r.status === s).length;
console.log(JSON.stringify({ programs: rows.length, verified: count("verified"), differs: count("differs"),
  assemblyNotFound: count("assembly not found"), noSites: count("no sites"),
  sites: rows.reduce((n, r) => n + (r.status === "verified" ? r.sites : 0), 0) }, null, 2));
for (const r of rows.filter(r => r.status !== "verified")) console.log(`${r.status}: ${r.name}${r.owner ? ` (owner ${r.owner})` : ""}${r.failures?.length ? `: ${r.failures.join("; ")}` : ""}`);
if (rows.some(r => r.status !== "verified")) process.exitCode = 1;
