// Player (contestant) number on reconstructed garments.
//
// THE FINALS prints the number with the layered master's global scalar `DecalNumber` (master default 32). A decal
// slot with `{i}_UseNumber` on runs its UV through MF_CharacterAtlasUV and samples a ten-cell digit strip
// (T_Decal_NumbersAtlas_*: 0123456789 left to right, plus a matching normal atlas on some skins). Since Season 7 the
// player picks the number in Social Settings (WBP_SocialOptions -> PlayerNumber, ID_OPTION_COSMETIC_NUMBER).
//
// The number reaches the shader only through the material preshader, which writes five buffer lanes:
//   single = 1 - saturate(floor(N * 0.1))       (1 below 10)
//   tens   = floor(N * 0.1) * 0.1               (left cell's atlas U offset)
//   ones   = fmod(N * 0.1, 1) * 10 * 0.1        (right cell's atlas U offset)
//   0.25 * single, saturate(1 - single + 0.75), single   (centre a lone digit)
// Our programs are sliced with the item's own number folded in (scripts/shader-probe/sm5_slice.py inlines buffer
// constants and drops x*0 and x+0). For an authored two-digit number the three single-digit lanes fold away, and
// tens/ones survive as one instruction's two literal adds onto the same atlas-local coordinate. Replacing exactly
// those two literals with a uniform reproduces the game's arithmetic for every other two-digit number. A one-digit
// number would need the folded centring lanes back, so it is refused rather than approximated.

import * as THREE from "three";
import { PLAYER_NUMBER_MAX, PLAYER_NUMBER_MIN, shownPlayerNumber } from "../lib/player-number";

const f = Math.fround;
const TENTH = f(0.1);

/** The preshader's float32 tens/ones lanes for N, in the order the game evaluates them. */
export function playerNumberLanes(n: number): [number, number] {
  const scaled = f(f(n) * TENTH);
  const tens = f(f(Math.floor(scaled)) * TENTH);
  const remainder = f(scaled % 1); // fmod(x, 1): same sign as x, and N is never negative here
  const ones = f(f(remainder * f(10)) * TENTH);
  return [tens, ones];
}

export interface PlayerNumberSite {
  /** The two GLSL node names whose literal is replaced, in lane order. */
  tensNode: string;
  onesNode: string;
  /** The atlas-local coordinate both adds read. */
  baseNode: string;
  asmLine: number;
}

export interface PlayerNumberProgram {
  /** The number the program was built with (the item's MI DecalNumber). */
  authored: number;
  sites: PlayerNumberSite[];
}

const ADD = /^\s*float (n\d+) = \((?:(n\d+) \+ ([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)|([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?) \+ (n\d+))\); \/\/ asm:(\d+)\s*$/;
const DEFINITION = /^\s*\w+ (n\d+) = (.*?); \/\/ asm:\d+\s*$/;
const LANE_TABLE = new Map<string, number>();
for (let n = PLAYER_NUMBER_MIN; n <= PLAYER_NUMBER_MAX; n++) {
  const [tens, ones] = playerNumberLanes(n);
  LANE_TABLE.set(`${tens}|${ones}`, n);
}

/**
 * Finds the atlas lanes in a recovered program. Returns undefined when the program prints no number this route can
 * change: no atlas lanes, an authored one-digit or round number (a lane folded away), or sites that disagree.
 */
export function findPlayerNumberSites(glsl: string): PlayerNumberProgram | undefined {
  const lines = glsl.split("\n");
  const definitions = new Map<string, string>();
  const adds = new Map<string, { node: string; literal: number }[]>();
  for (const line of lines) {
    const definition = DEFINITION.exec(line);
    if (definition) definitions.set(definition[1], definition[2]);
    const add = ADD.exec(line);
    if (!add) continue;
    const base = add[2] ?? add[5];
    const literal = f(Number(add[3] ?? add[4]));
    const key = `${base}|${add[6]}`;
    const group = adds.get(key) ?? [];
    group.push({ node: add[1], literal });
    adds.set(key, group);
  }
  const sites: PlayerNumberSite[] = [];
  let authored: number | undefined;
  for (const [key, group] of adds) {
    if (group.length !== 2) continue;
    const [baseNode, asm] = key.split("|");
    // MF_CharacterAtlasUV scales the decal-local U to two cells of a ten-cell strip: base = (u * 2) * 0.1.
    const scale = /^\((n\d+) \* 0\.100000001\)$/.exec(definitions.get(baseNode) ?? "");
    if (!scale || !/^\(n\d+ \* 2\.0\)$/.test(definitions.get(scale[1]) ?? "")) continue;
    for (const [tensSite, onesSite] of [[group[0], group[1]], [group[1], group[0]]]) {
      const n = LANE_TABLE.get(`${tensSite.literal}|${onesSite.literal}`);
      if (n === undefined) continue;
      if (authored !== undefined && authored !== n) return undefined;
      authored = n;
      sites.push({ tensNode: tensSite.node, onesNode: onesSite.node, baseNode, asmLine: Number(asm) });
      break;
    }
  }
  return authored === undefined || !sites.length ? undefined : { authored, sites };
}

export const PLAYER_NUMBER_UNIFORM = "uRecoveredPlayerNumber";

/** Rewrites the found literals to read `uRecoveredPlayerNumber` (vec2: tens, ones). Everything else is unchanged. */
export function rewritePlayerNumberGlsl(glsl: string, program: PlayerNumberProgram): string {
  const replace = new Map<string, string>();
  for (const site of program.sites) {
    replace.set(site.tensNode, `${PLAYER_NUMBER_UNIFORM}.x`);
    replace.set(site.onesNode, `${PLAYER_NUMBER_UNIFORM}.y`);
  }
  let replaced = 0;
  const out = glsl.split("\n").map((line) => {
    const add = ADD.exec(line);
    const lane = add && replace.get(add[1]);
    if (!add || !lane) return line;
    replaced++;
    const base = add[2] ?? add[5];
    return line.replace(/= \(.*\);/, `= (${base} + ${lane});`);
  });
  if (replaced !== replace.size) throw new Error("Player number rewrite did not find every lane");
  return `uniform vec2 ${PLAYER_NUMBER_UNIFORM};\n${out.join("\n")}`;
}

// ------------------------------------------------------------------ live materials

// Every recovered material that prints a number, with the number its program was built with. Its owner's choice
// (null: each piece's own) is applied to it; a material leaves when it is disposed.
//
// Owners (22 Nov 2026, multi-character Phase 2): the builder's one character is the default owner (undefined). A
// squad gives each contestant its own owner key (CharacterRig's `playerNumberOwner`), so each contestant prints the
// number its own outfit copy carries; setting one owner's number leaves every other owner's materials alone.
export type PlayerNumberOwner = object | undefined;
interface Entry { material: THREE.Material; uniform: { value: THREE.Vector2 }; authored: number; piece: string; owner: PlayerNumberOwner }
const entries = new Set<Entry>();
const listeners = new Set<() => void>();
let chosen: number | null = null;
const chosenBy = new WeakMap<object, number | null>();

const choiceOf = (owner: PlayerNumberOwner) => owner ? chosenBy.get(owner) ?? null : chosen;

function apply(entry: Entry) {
  const [tens, ones] = playerNumberLanes(choiceOf(entry.owner) ?? entry.authored);
  entry.uniform.value.set(tens, ones);
}

/** The uniform a material's program reads (bind it as `uRecoveredPlayerNumber` in onBeforeCompile). `owner`: whose
 *  number it prints (undefined: the builder's character). */
export function playerNumberUniform(material: THREE.Material, authored: number, piece: string,
  owner?: PlayerNumberOwner): { value: THREE.Vector2 } {
  const entry: Entry = { material, uniform: { value: new THREE.Vector2() }, authored, piece, owner };
  apply(entry);
  entries.add(entry);
  material.addEventListener("dispose", () => {
    entries.delete(entry);
    listeners.forEach(listener => listener());
  });
  listeners.forEach(listener => listener());
  return entry.uniform;
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
