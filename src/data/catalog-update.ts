// Coverage dates are editorial facts, not the time the app was built or opened.
// The 3,331-item catalog has season tags through 12: Season 12 wearables released at
// Update 12.0.0 (20 Oct 2026; the installed build), matched to the wiki by icon on 28 Oct.
// 6 Nov 2026: 76 user-facing items from earlier seasons that the June import had skipped
// (no slot keyword) were added from the game's own slot tag; coverage stays through 12.0.0.
// Do not advance coverage just because a newer game archive or mapping has been downloaded.
export const CATALOG_UPDATE = {
  updatedAt: "2026-11-06",
  updatedLabel: "6 Nov 2026",
  throughSeason: 12,
  latestGamePatch: "12.0.0",
  checkedAt: "2026-10-28",
  patchNotes: "https://www.reachthefinals.com/patchnotes/12-00",
} as const;
