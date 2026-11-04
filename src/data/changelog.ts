// Player-facing patch notes, newest first. The welcome screen opens again whenever the first
// entry's id differs from the one a visitor last dismissed, so add a new entry (with a new id)
// only for changes worth interrupting someone for. Keep claims to what shipped.
export interface ChangelogEntry {
  id: string;
  date: string; // ISO date the change reached the live site
  title: string;
  notes: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: "2026-11-03-new-look",
    date: "2026-11-03",
    title: "New look",
    notes: [
      "The builder is rebuilt around the 3D preview. The slot list shows what each slot is wearing.",
      "This welcome screen and these patch notes. They come back only when something new ships.",
      "On phones the preview stays on screen while you browse, and equipping in large slots is quicker.",
    ],
  },
  {
    id: "2026-10-20-link-previews",
    date: "2026-10-20",
    title: "Link previews",
    notes: [
      "Share with “Link with preview image” and chat apps show your outfit from four angles.",
      "If a preview can’t be made, you still get the plain short link.",
    ],
  },
  {
    id: "2026-10-18-84-release",
    date: "2026-10-18",
    title: "The 84% release",
    notes: [
      "More cosmetics render with reconstructed meshes and materials on Medium.",
      "Eyes and glass use their recovered materials; head wraps and plastic-sheet pieces load.",
      "Full-body garments fill both upper and lower body, and Randomise respects them.",
    ],
  },
  {
    id: "2026-09-25-randomise",
    date: "2026-09-25",
    title: "Randomise and reports",
    notes: [
      "Randomise builds a rules-based outfit. Lock a piece to keep it between rolls.",
      "Report issue opens a prefilled GitHub issue for you to review. Nothing is sent automatically.",
    ],
  },
  {
    id: "2026-09-23-hair-face",
    date: "2026-09-23",
    title: "Hair and faces",
    notes: [
      "Hair and faces appear in the 3D preview, with feedback while an outfit loads.",
    ],
  },
  {
    id: "2026-09-19-37-percent",
    date: "2026-09-19",
    title: "37.6% on Medium",
    notes: [
      "Medium reconstruction expanded to 37.6% of the catalog through shared clothing-family fixes.",
    ],
  },
  {
    id: "2026-09-16-roadmap",
    date: "2026-09-16",
    title: "Progress and roadmap",
    notes: [
      "A progress page tracks every item’s 3D status and what comes next.",
    ],
  },
  {
    id: "2026-09-12-share-links",
    date: "2026-09-12",
    title: "Stable share links",
    notes: [
      "Outfit links keep working as the catalog grows.",
      "Cosmetic names now come from THE FINALS Wiki.",
    ],
  },
];

export const LATEST_CHANGELOG_ID = CHANGELOG[0].id;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" -> "03 Nov 2026", independent of the visitor's locale and time zone. */
export function formatPatchDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}
