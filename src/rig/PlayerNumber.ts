// Player (contestant) number on reconstructed garments.
//
// THE FINALS prints the number with the layered master's global scalar `DecalNumber` (master default 32). A decal
// slot with `{i}_UseNumber` on runs its UV through MF_CharacterAtlasUV and samples a ten-cell digit strip
// (T_Decal_NumbersAtlas_*: 0123456789 left to right, plus a matching normal atlas on some skins). Since Season 7 the
// player picks the number in Social Settings (WBP_SocialOptions -> PlayerNumber, ID_OPTION_COSMETIC_NUMBER).
//
// The number reaches the shader only through the material preshader, which writes five buffer lanes:
//   single = 1 - saturate(floor(N * 0.1))                    (1 below 10)
//   lo     = 0.25 * single,  hi = saturate(1 - single + 0.75)   (the decal-local u clamp)
//   tens   = floor(N * 0.1) * 0.1                             (left cell's atlas U offset)
//   ones   = fmod(N * 0.1, 1) * 10 * 0.1                      (right cell's atlas U offset)
// and the pixel shader runs (22 Nov 2026, read from the shipped SM5 assembly of MI_Casual_BasicTshirt_Cotton_*):
//   k     = single * -0.05 + 0.1
//   uc    = clamp(u, lo, hi)
//   base  = uc * 2 * 0.1
//   left  = base + tens,  right = (base + ones) - k
//   sel   = saturate(floor(uc + 0.5) + single)
//   atlas = (right - left) * sel + left
// Two digits: u in 0..1 shows tens on the left half and ones on the right. One digit (0-9): u is clamped to the middle
// half and sel is forced to the right cell, shifted by 0.05 instead of 0.1, so the lone ones digit prints centred at
// one cell's width; outside the middle half the clamp holds the cell's edge column. That is the game's own layout.
//
// Our programs are sliced with the item's own number folded in (scripts/shader-probe/sm5_slice.py inlines buffer
// constants and drops x*0 and x+0), so every lane is a literal, and a zero lane leaves no instruction at all (an
// authored 5 has no tens add, an authored 10 no ones add). The route below finds the atlas arithmetic by its shape,
// not by its literals, and rewrites six expressions to read the six lanes from uniforms. For the authored number that
// is bit-exact; for every other number 0-99 it is the game's arithmetic. A program whose shape differs is left alone.

import * as THREE from "three";
import { shownPlayerNumber } from "../lib/player-number";

const f = Math.fround;
const TENTH = f(0.1);

/** The lanes the game computes for DecalNumber N, in float32 and in the game's order of operations. */
export interface PlayerNumberLanes {
  tens: number;
  ones: number;
  /** The decal-local u clamp: 0..1 for two digits, 0.25..0.75 for one. */
  lo: number;
  hi: number;
  /** The right cell's shift, computed in the shader: single * -0.05 + 0.1. */
  k: number;
  /** 1 below 10: the right cell alone, centred. */
  single: number;
}

export function playerNumberLanes(n: number): PlayerNumberLanes {
  const scaled = f(f(n) * TENTH);
  const tensDigit = Math.floor(scaled);
  const single = f(1 - Math.min(Math.max(tensDigit, 0), 1));
  const remainder = f(scaled % 1); // fmod(x, 1): same sign as x, and N is never negative here
  return {
    tens: f(f(tensDigit) * TENTH),
    ones: f(f(remainder * f(10)) * TENTH),
    lo: f(f(0.25) * single),
    hi: Math.min(Math.max(f(f(1 - single) + f(0.75)), 0), 1),
    k: f(f(single * f(-0.05)) + TENTH),
    single,
  };
}

export interface PlayerNumberSite {
  /** The atlas-local coordinate `uc * 2 * 0.1`. */
  baseNode: string;
  asmLine: number;
  /** The authored number this site prints. */
  authored: number;
  /** The decal-local u the arithmetic starts from, and the atlas U it ends with (for offline checks). */
  uNode: string;
  atlasNode: string;
  /** Node -> the expression that replaces its definition. */
  rewrites: Map<string, string>;
}

export interface PlayerNumberProgram {
  /** The number the program was built with (the item's MI DecalNumber). */
  authored: number;
  sites: PlayerNumberSite[];
}

export const PLAYER_NUMBER_UNIFORM = "uRecoveredPlayerNumber"; // vec4: tens, ones, lo, hi
export const PLAYER_NUMBER_CENTRE_UNIFORM = "uRecoveredPlayerNumberCentre"; // vec2: k, single
const U = PLAYER_NUMBER_UNIFORM, C = PLAYER_NUMBER_CENTRE_UNIFORM;

const LINE = /^(\s*\w+ (n\d+) = )(.*?)(; \/\/ asm:(\d+)\s*)$/;
const NODE = /^n\d+$/;
const LITERAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/;
const literal = (text: string | undefined) => text !== undefined && LITERAL.test(text) ? f(Number(text)) : undefined;
const is = (value: number) => (text: string) => literal(text) === f(value);

interface Definition { expr: string; asm: number }
interface Clamp { fn: "max" | "min"; value: string; bound: string; guarded: boolean }

// max/min as the slicer writes them: plain, or (since autumn 2026) with Direct3D's NaN rule spelled out.
// An operand: a token, or one parenthesised expression (the rewritten forms, for the offline evaluator).
const VAL = String.raw`(\([^()]*\)|[^\s(),]+)`;
const PLAIN_CLAMP = new RegExp(String.raw`^(max|min)\(${VAL}, ${VAL}\)$`);
const GUARDED_CLAMP = new RegExp(String.raw`^\(isnan\(${VAL}\) \? ${VAL} : isnan\(${VAL}\) \? ${VAL} : (max|min)\(${VAL}, ${VAL}\)\)$`);
const BINARY = new RegExp(String.raw`^\(${VAL} ([+*]) ${VAL}\)$`);
function clamp(expr: string | undefined): Clamp | undefined {
  if (!expr) return undefined;
  const plain = PLAIN_CLAMP.exec(expr);
  if (plain) return { fn: plain[1] as Clamp["fn"], value: plain[2], bound: plain[3], guarded: false };
  const g = GUARDED_CLAMP.exec(expr);
  if (g && g[1] === g[4] && g[4] === g[6] && g[2] === g[3] && g[3] === g[7])
    return { fn: g[5] as Clamp["fn"], value: g[6], bound: g[7], guarded: true };
  return undefined;
}
const writeClamp = (shape: Clamp, value: string, bound: string) => shape.guarded
  ? `(isnan(${value}) ? ${bound} : isnan(${bound}) ? ${value} : ${shape.fn}(${value}, ${bound}))`
  : `${shape.fn}(${value}, ${bound})`;

/** `(a op b)` with either operand order; returns the other operand when one side is `known`. */
function binary(expr: string | undefined, op: "+" | "*", known: (operand: string) => boolean): string | undefined {
  const m = expr && /^\((\S+) ([+*]) (\S+)\)$/.exec(expr);
  if (!m || m[2] !== op) return undefined;
  if (known(m[1])) return m[3];
  if (known(m[3])) return m[1];
  return undefined;
}

function parse(glsl: string) {
  const definitions = new Map<string, Definition>();
  const users = new Map<string, Set<string>>();
  glsl.split("\n").forEach((line, index) => {
    const m = LINE.exec(line);
    const owner = m ? m[2] : `line:${index}`;
    if (m) definitions.set(m[2], { expr: m[3], asm: Number(m[5]) });
    for (const ref of (m ? m[3] : line).matchAll(/\bn\d+\b/g)) {
      if (ref[0] === owner) continue;
      const set = users.get(ref[0]) ?? new Set<string>();
      set.add(owner);
      users.set(ref[0], set);
    }
  });
  return { definitions, users };
}

/** Every number in 0-99 whose lanes match. */
const LANES = Array.from({ length: 100 }, (_, n) => playerNumberLanes(n));
function numberFor(lanes: Omit<PlayerNumberLanes, "single">): number | undefined {
  const found = LANES.findIndex(l => l.tens === lanes.tens && l.ones === lanes.ones && l.lo === lanes.lo
    && l.hi === lanes.hi && l.k === lanes.k);
  return found < 0 ? undefined : found;
}

function findSite(base: string, defs: Map<string, Definition>, users: Map<string, Set<string>>): PlayerNumberSite | undefined {
  const def = (node: string | undefined) => node ? defs.get(node)?.expr : undefined;
  const only = (node: string, ...allowed: string[]) => [...(users.get(node) ?? [])].every(u => allowed.includes(u));
  const exactly = (node: string, ...expected: string[]) =>
    only(node, ...expected) && (users.get(node)?.size ?? 0) === new Set(expected).size;
  const usersOf = (node: string) => [...(users.get(node) ?? [])];

  // base = (s * 0.1), s = (uc * 2.0), uc = min(m, hi), m = max(u, lo)
  const s = binary(def(base), "*", is(0.1));
  const uc = s && NODE.test(s) ? binary(def(s), "*", is(2)) : undefined;
  if (!s || !uc || !NODE.test(uc)) return undefined;
  const hiClamp = clamp(def(uc));
  if (hiClamp?.fn !== "min" || !NODE.test(hiClamp.value)) return undefined;
  const m = hiClamp.value;
  const loClamp = clamp(def(m));
  if (loClamp?.fn !== "max") return undefined;
  const lo = literal(loClamp.bound), hi = literal(hiClamp.bound);
  if (lo === undefined || hi === undefined) return undefined;

  // sel = saturate(floor(uc + 0.5) [+ 1.0 when the authored number is one digit])
  const half = usersOf(uc).find(u => is(0.5)(binary(def(u), "+", x => x === uc) ?? ""));
  const fl = half && usersOf(half).find(u => def(u) === `floor(${half})`);
  if (!half || !fl) return undefined;
  let satIn = fl;
  const plusOne = usersOf(fl).find(u => is(1)(binary(def(u), "+", x => x === fl) ?? ""));
  if (plusOne) satIn = plusOne;
  const satLo = usersOf(satIn).find(u => { const c = clamp(def(u)); return c?.fn === "max" && c.value === satIn && is(0)(c.bound); });
  const satLoShape = satLo ? clamp(def(satLo)) : undefined;
  const sel = satLo && usersOf(satLo).find(u => { const c = clamp(def(u)); return c?.fn === "min" && c.value === satLo && is(1)(c.bound); });
  if (!satLo || !satLoShape || !sel) return undefined;

  // atlas = ((-left) + right) * sel + left, right = (-k + right0); left and right0 are base, or base plus a literal
  const r = usersOf(sel).find(u => binary(def(u), "*", x => x === sel) !== undefined);
  const d = r && binary(def(r), "*", x => x === sel);
  if (!r || !d || !NODE.test(d)) return undefined;
  const dm = /^\((\S+) \+ (\S+)\)$/.exec(def(d) ?? "");
  if (!dm) return undefined;
  const negOf = (node: string) => /^\(-(n\d+)\)$/.exec(def(node) ?? "")?.[1];
  const [nL, right] = negOf(dm[1]) ? [dm[1], dm[2]] : negOf(dm[2]) ? [dm[2], dm[1]] : [];
  const left = nL && negOf(nL);
  if (!nL || !right || !left || !NODE.test(right)) return undefined;
  const out = usersOf(r).find(u => binary(def(u), "+", x => x === r) === left);
  if (!out) return undefined;
  const negK = binary(def(right), "+", x => literal(x) !== undefined && literal(x)! < 0);
  const rightLiteral = /^\((\S+) \+ (\S+)\)$/.exec(def(right) ?? "");
  const kText = rightLiteral && (literal(rightLiteral[1]) !== undefined ? rightLiteral[1] : rightLiteral[2]);
  const right0 = negK;
  if (!right0 || !kText) return undefined;
  const offset = (node: string) => node === base ? f(0) : literal(binary(def(node), "+", x => x === base));
  const tens = offset(left), ones = offset(right0);
  if (tens === undefined || ones === undefined) return undefined;

  // Everything the clamp feeds must belong to this site: the rewrite changes all of it.
  if (!exactly(m, uc) || !exactly(uc, s, half) || !exactly(s, base) || !exactly(half, fl)
    || !exactly(fl, plusOne ?? satLo) || (plusOne && !exactly(plusOne, satLo)) || !exactly(satLo, sel)
    || !exactly(sel, r) || !exactly(r, out) || !exactly(d, r) || !exactly(nL, d) || !exactly(right, d)
    || !only(base, left, right0, nL, out, right)) return undefined;

  const authored = numberFor({ tens, ones, lo, hi, k: f(-literal(kText)!) });
  if (authored === undefined) return undefined;

  const leftLive = `(${base} + ${U}.x)`, rightLive = `(${base} + ${U}.y)`;
  const rewrites = new Map<string, string>([
    [m, writeClamp(loClamp, loClamp.value, `${U}.z`)],
    [uc, writeClamp(hiClamp, m, `${U}.w`)],
    [satLo, writeClamp(satLoShape, `(${fl} + ${C}.y)`, "0.0")],
    [nL, `(-${leftLive})`],
    [right, `(-${C}.x + ${rightLive})`],
    [out, `(${r} + ${leftLive})`],
  ]);
  return { baseNode: base, asmLine: defs.get(base)!.asm, authored, uNode: loClamp.value, atlasNode: out, rewrites };
}

/**
 * Finds the atlas arithmetic in a recovered program. Returns undefined when the program prints no number this route
 * can change: no atlas arithmetic, a shape it does not know, or sites that disagree on the number.
 */
export function findPlayerNumberSites(glsl: string): PlayerNumberProgram | undefined {
  const { definitions, users } = parse(glsl);
  const sites: PlayerNumberSite[] = [];
  for (const [node, { expr }] of definitions) {
    if (!/\* /.test(expr)) continue;
    const site = findSite(node, definitions, users);
    if (site) sites.push(site);
  }
  if (!sites.length || sites.some(site => site.authored !== sites[0].authored)) return undefined;
  return { authored: sites[0].authored, sites };
}

/** The game's atlas U for decal-local u and number N (the assembly above, in float32), for offline checks. */
export function referenceAtlasU(u: number, n: number): number {
  const l = playerNumberLanes(n);
  const uc = Math.min(Math.max(u, l.lo), l.hi);
  const base = f(f(uc * 2) * TENTH);
  const left = f(base + l.tens), right = f(f(base + l.ones) - l.k);
  const sel = Math.min(Math.max(f(Math.floor(f(uc + 0.5)) + l.single), 0), 1);
  return f(f(f(right - left) * sel) + left);
}

/** Evaluates one node of a recovered program's arithmetic (+, *, negation, max/min with or without the NaN rule,
 *  floor) in float32, with `inputs` for the nodes it starts from and `lanes` for the uniforms. Offline checks only. */
export function evaluatePlayerNumberNode(glsl: string, node: string, inputs: Record<string, number>,
  lanes?: PlayerNumberLanes): number {
  const { definitions } = parse(glsl);
  const memo = new Map<string, number>(Object.entries(inputs));
  const uniform = (name: string, c: string) => {
    if (!lanes) throw new Error(`no lanes for ${name}`);
    const v = name === U ? { x: lanes.tens, y: lanes.ones, z: lanes.lo, w: lanes.hi } : { x: lanes.k, y: lanes.single };
    return (v as Record<string, number>)[c];
  };
  const value = (text: string): number => {
    const lit = literal(text);
    if (lit !== undefined) return lit;
    const u = new RegExp(`^(${U}|${C})\\.([xyzw])$`).exec(text);
    if (u) return uniform(u[1], u[2]);
    if (NODE.test(text)) return evaluate(text);
    if (text.startsWith("-") && !text.startsWith("-(")) return -value(text.slice(1));
    return expression(text);
  };
  const expression = (expr: string): number => {
    const c = clamp(expr);
    if (c) {
      const v = value(c.value), b = value(c.bound);
      // Direct3D: max/min with one NaN operand returns the other.
      return Number.isNaN(v) ? b : Number.isNaN(b) ? v : c.fn === "max" ? Math.max(v, b) : Math.min(v, b);
    }
    let m = BINARY.exec(expr);
    if (m) return f(m[2] === "+" ? value(m[1]) + value(m[3]) : value(m[1]) * value(m[3]));
    m = /^\(-(.+)\)$/.exec(expr);
    if (m) return -value(m[1]);
    m = /^floor\((\S+)\)$/.exec(expr);
    if (m) return Math.floor(value(m[1]));
    throw new Error(`cannot evaluate ${expr}`);
  };
  const evaluate = (n: string): number => {
    if (memo.has(n)) return memo.get(n)!;
    const d = definitions.get(n);
    if (!d) throw new Error(`no definition for ${n}`);
    const v = expression(d.expr);
    memo.set(n, v);
    return v;
  };
  return evaluate(node);
}

/** Rewrites the found expressions to read the lanes from uniforms. Everything else is unchanged. */
export function rewritePlayerNumberGlsl(glsl: string, program: PlayerNumberProgram): string {
  const replace = new Map<string, string>();
  for (const site of program.sites) for (const [node, expr] of site.rewrites) replace.set(node, expr);
  const done = new Set<string>();
  const out = glsl.split("\n").map((line) => {
    const m = LINE.exec(line);
    const expr = m && replace.get(m[2]);
    if (!m || !expr) return line;
    done.add(m[2]);
    return `${m[1]}${expr}${m[4]}`;
  });
  if (done.size !== replace.size) throw new Error("Player number rewrite did not find every expression");
  return `uniform vec4 ${U};\nuniform vec2 ${C};\n${out.join("\n")}`;
}

// ------------------------------------------------------------------ live materials

// Every recovered material that prints a number, with the number its program was built with. Its owner's choice
// (null: each piece's own) is applied to it; a material leaves when it is disposed.
//
// Owners (22 Nov 2026, multi-character Phase 2): the builder's one character is the default owner (undefined). A
// squad gives each contestant its own owner key (CharacterRig's `playerNumberOwner`), so each contestant prints the
// number its own outfit copy carries; setting one owner's number leaves every other owner's materials alone.
export type PlayerNumberOwner = object | undefined;
export interface PlayerNumberUniforms {
  [PLAYER_NUMBER_UNIFORM]: { value: THREE.Vector4 };
  [PLAYER_NUMBER_CENTRE_UNIFORM]: { value: THREE.Vector2 };
}
interface Entry { material: THREE.Material; uniforms: PlayerNumberUniforms; authored: number; piece: string; owner: PlayerNumberOwner }
const entries = new Set<Entry>();
const listeners = new Set<() => void>();
let chosen: number | null = null;
const chosenBy = new WeakMap<object, number | null>();

const choiceOf = (owner: PlayerNumberOwner) => owner ? chosenBy.get(owner) ?? null : chosen;

function apply(entry: Entry) {
  const lanes = playerNumberLanes(choiceOf(entry.owner) ?? entry.authored);
  entry.uniforms[PLAYER_NUMBER_UNIFORM].value.set(lanes.tens, lanes.ones, lanes.lo, lanes.hi);
  entry.uniforms[PLAYER_NUMBER_CENTRE_UNIFORM].value.set(lanes.k, lanes.single);
}

/** The uniforms a material's program reads (assign them in onBeforeCompile). `owner`: whose number it prints
 *  (undefined: the builder's character). */
export function playerNumberUniforms(material: THREE.Material, authored: number, piece: string,
  owner?: PlayerNumberOwner): PlayerNumberUniforms {
  const uniforms: PlayerNumberUniforms = {
    [PLAYER_NUMBER_UNIFORM]: { value: new THREE.Vector4() },
    [PLAYER_NUMBER_CENTRE_UNIFORM]: { value: new THREE.Vector2() },
  };
  const entry: Entry = { material, uniforms, authored, piece, owner };
  apply(entry);
  entries.add(entry);
  material.addEventListener("dispose", () => {
    entries.delete(entry);
    listeners.forEach(listener => listener());
  });
  listeners.forEach(listener => listener());
  return uniforms;
}

/** Print this number on every piece of this owner that prints one (null: each piece's own). A value this site cannot print is
 *  treated as null. Changing it marks the materials for update, which also restarts the still-view accumulation. */
export function setPlayerNumber(value: unknown, owner?: PlayerNumberOwner) {
  const next = shownPlayerNumber(value);
  if (next === choiceOf(owner)) return;
  if (owner) chosenBy.set(owner, next); else chosen = next;
  for (const entry of entries) {
    if (entry.owner !== owner) continue;
    apply(entry);
    entry.material.needsUpdate = true; // same program cache key: no recompile, uniforms re-uploaded
  }
}

/** How many recovered materials (by item id) on screen print a number for this owner, for the UI's hint. */
export function playerNumberPieces(owner?: PlayerNumberOwner): number {
  return new Set([...entries].filter(entry => entry.owner === owner).map(entry => entry.piece)).size;
}

export function subscribePlayerNumberPieces(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
