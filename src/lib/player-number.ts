// The player (contestant) number as part of an outfit (21 Nov 2026).
//
// In THE FINALS the number is a player setting (Season 7 on: Social Settings -> PlayerNumber) printed by garments
// whose material turns a decal slot's UseNumber on. Here it travels with the outfit, like the body type: saved with
// it and carried by links as `pn=<number>`. Without one, every piece shows its own authored number (the material's
// DecalNumber, 32 unless the skin sets another), which is what the site always showed and what the item icons show.
//
// Only two-digit numbers are offered: those are the ones the recovered programs can print exactly
// (src/rig/PlayerNumber.ts explains why a single digit cannot be). This module stays free of three.js so the outfit
// store, the saved-outfit library and the link codec can use it in Node tests.

export const PLAYER_NUMBER_MIN = 10;
export const PLAYER_NUMBER_MAX = 99;
export const PLAYER_NUMBER_PARAM = "pn";

/** A number the viewer can print. */
export function isPlayerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= PLAYER_NUMBER_MIN && value <= PLAYER_NUMBER_MAX;
}

/** An outfit's number exactly as stored: any finite number is kept (a value from a newer site that this one cannot
 *  print survives a save); anything else, or nothing, is null: each piece's own number. */
export function storedPlayerNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The number to print: the outfit's own when this site can print it, else null (each piece's own number). */
export function shownPlayerNumber(value: unknown): number | null {
  return isPlayerNumber(value) ? value : null;
}

/** Absent and null mean the same: compare by meaning, so the field's arrival is not an edit. */
export const samePlayerNumber = (a: unknown, b: unknown) => storedPlayerNumber(a) === storedPlayerNumber(b);

const SHARE_CODE = /^[1-9][0-9]$/;

/** The `pn` value for an outfit's number, or undefined when the link needs none. */
export function playerNumberShareCode(value: unknown): string | undefined {
  return isPlayerNumber(value) ? String(value) : undefined;
}

/** The number a `pn` value names. Missing, malformed or out-of-range values give null and never throw. */
export function playerNumberFromShareCode(code: string | null | undefined): number | null {
  return typeof code === "string" && SHARE_CODE.test(code) ? Number(code) : null;
}
