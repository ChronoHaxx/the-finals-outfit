// Chinals mode (12 Nov 2026): the same builder, with the emotes of 终极角逐 (THE FINALS as Tencent publishes it in
// mainland China, "the Chinals") in place of the global ones. See _docs/chinals-mode-2026-11-12/README.md.
//
// - The mode is a route: #/chinals is the builder in Chinals mode, #/ the global builder.
// - It is off unless the deployment sets VITE_CHINALS_ANIMATIONS_BASE (the Chinals clip set's own host). Off, the
//   toggle is hidden and a Chinals address says the mode isn't available, keeping the address as it is.
// - Both modes dress the character from the one global build: there are no Chinals cosmetics on the site yet, and
//   one build means switching never touches the outfit or the saved outfits.
// - Share links keep today's form (#/?o=2.…&emote=…). A pose naming a Chinals clip (ids start with cn-) is what
//   opens the mode, so the share Worker, which always writes #/?o=, needs no change.

export type SiteMode = "global" | "chinals";

export const CHINALS_PATH = "/chinals";

/** The Chinals clip set's base URL (its manifest.json lives there), or "" when this deployment ships none. */
export function chinalsAnimationsBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env; // no env in node tests
  const base = env?.VITE_CHINALS_ANIMATIONS_BASE?.trim() ?? "";
  return base && !base.endsWith("/") ? `${base}/` : base;
}

export const chinalsAvailable = (): boolean => chinalsAnimationsBase() !== "";

/** Chinals clip ids all start with "cn-" (they never collide with a global clip id), and are part of the link format:
 *  a set rebuild must keep them. */
export const isChinalsClip = (id: string): boolean => id.startsWith("cn-");

/** The mode a router pathname shows: /chinals and the pages under it (its roadmap). */
export function modeOfPath(pathname: string): SiteMode {
  return pathname === CHINALS_PATH || pathname.startsWith(`${CHINALS_PATH}/`) ? "chinals" : "global";
}

export const builderPath = (mode: SiteMode): string => mode === "chinals" ? CHINALS_PATH : "/";
export const roadmapPath = (mode: SiteMode): string => mode === "chinals" ? `${CHINALS_PATH}/roadmap` : "/roadmap";

const BUILDER_HASH = /^#(\/|\/chinals\/?)(\?.*)?$/;

/** The builder route a URL hash shows ("#/…" global, "#/chinals…" Chinals), or null for another page. Exactly these
 *  routes: a roadmap address also carries ?o=, and reading it as a link would open a draft on every roadmap reload. */
export function builderHashMode(hash: string): SiteMode | null {
  if (hash === "" || hash === "#") return "global";
  const match = BUILDER_HASH.exec(hash);
  return match ? (match[1] === "/" ? "global" : "chinals") : null;
}

/** The builder route's parameters from a URL hash ("#/?o=…", "#/chinals?o=…"), or null on any other route. */
export function builderHashParams(hash: string): URLSearchParams | null {
  const match = BUILDER_HASH.exec(hash);
  return match?.[2] ? new URLSearchParams(match[2].slice(1)) : null;
}

/** The route's own query from a URL hash ("#/chinals?o=1" -> "?o=1"), read live: the router's copy can lag behind a
 *  tidy-up that rewrote the address directly. */
export function hashSearch(hash: string): string {
  const at = hash.indexOf("?");
  return at < 0 ? "" : hash.slice(at);
}
