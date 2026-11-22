// Coverage dates are editorial facts, not the time the app was built or opened.
// The 3,332-item catalog has season tags through 12: Season 12 wearables released at
// Update 12.0.0 (20 Oct 2026; the installed build), matched to the wiki by icon on 28 Oct.
// 6 Nov 2026: 76 user-facing items from earlier seasons that the June import had skipped
// (no slot keyword) were added from the game's own slot tag; coverage stays through 12.0.0.
// 6 Nov 2026 (evening): the Face of Eternel (DA_Head_BlankFace_AbsorbeGlitter), held back on 28 Oct for lack of
// a wiki icon match, was added on in-game evidence (3,332 items); same build, coverage unchanged.
// 12 Nov 2026: 150 more items the June import had skipped (whole folders, among them the practice-range mannequin
// pieces), added with game or wiki names and wiki release evidence (3,482 items); same build, coverage unchanged.
// Do not advance coverage just because a newer game archive or mapping has been downloaded.
export const CATALOG_UPDATE = {
  updatedAt: "2026-11-12",
  updatedLabel: "12 Nov 2026",
  throughSeason: 12,
  latestGamePatch: "12.0.0",
  checkedAt: "2026-10-28",
  patchNotes: "https://www.reachthefinals.com/patchnotes/12-00",
} as const;
