// Studio lighting v2 (w157, 10 Nov 2026; decision #3, delegated to Claude by the user on 10 Nov).
//
// Two changes ship together behind this one switch, because either alone makes the catalogue wrong:
// - the recalibrated Studio rig (about 2.5x less light, and a larger share on the shadowed key light), which on its own
//   turns every ShadeAsCloth cotton grey;
// - UE's MSM_Subsurface cloth lighting from each material's captured subsurface colour (manifest subsurfaceShading),
//   which on its own makes cotton brighter still under the over-exposed v1 rig.
// It stays off until every live material with a nonzero ShadeAsCloth weight carries its captured subsurface colour (the
// w157 rollout), so the active index stays releasable while rebuilt materials merge. Evidence and numbers:
// _docs/goal-100-2026-10-11/w157-lighting/README.md. Dev builds: ?lighting=v2 turns it on for a capture.
// FLIPPED LOCALLY 11 Nov 2026 (wave 127, _docs/goal-100-2026-10-11/wave127-merge/README.md): the rollout rebound 699
// materials in wave 120; the one held material (MI_StarterSet_TShirt_Cotton_USA) reads the same under v2
// (w164-flip/usa-v1). Not yet released: publishing it needs the user's functional checks or waiver. Revert = false.
const SHIPPED = true;

// The window check comes first: under the node test runner import.meta.env is undefined (Vite defines it), and a
// module-level read of .DEV crashed every rig test file on import (wave 120 app suite, 11 Nov).
export const STUDIO_LIGHTING_V2: boolean = SHIPPED || (typeof window !== "undefined" && !!import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("lighting") === "v2");

// v1: the rig as it shipped through PR #28. v2: rig R1 of the w157 chart (nylon shirts within about 5 sRGB levels of
// their icons; a joint nylon + cotton re-fit is due once the rollout's per-pixel subsurface colour is everywhere).
export const STUDIO_RIG_V1 = {
  room: 0.4, keyPanel: 7, fillPanel: 3, accentPanel: 2, env: 1.5, hemi: 0.5,
  key: 1.2, fill: 0, rim: 0.5, exposure: 1.0,
};
export const STUDIO_RIG_V2: typeof STUDIO_RIG_V1 = {
  room: 0.1, keyPanel: 2, fillPanel: 1, accentPanel: 1, env: 1.5, hemi: 0.3,
  key: 4, fill: 0, rim: 0.5, exposure: 1.0,
};
