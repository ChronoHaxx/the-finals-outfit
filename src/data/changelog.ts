// Player-facing patch notes, newest first. The welcome screen opens again whenever the first
// entry's id differs from the one a visitor last dismissed, so add a new entry (with a new id)
// only for changes worth interrupting someone for. Keep claims to what shipped.
// Titles and notes are public text: the build checks them with the rules in src/lib/public-text.ts.
export interface ChangelogEntry {
  id: string;
  date: string; // ISO date the change reached the live site
  title: string;
  notes: readonly string[];
  /** Ids of the ROADMAP.md items this change advanced ("<!-- id: ... -->" under each item title).
   *  Optional; an id that ROADMAP.md does not contain fails the build. */
  items?: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: "2026-11-06-54-more-in-3d",
    date: "2026-11-06",
    title: "54 more in 3D",
    notes: [
      "54 of this morning's 76 added cosmetics now render in 3D, among them the plushies, guitars and lutes, swords and shields, hard cases, TV heads, rings, and the frog, Bigfoot and Kaiju costumes.",
      "The Face of Éternel joins the catalog with its icon. Its 3D comes later.",
      "A face without 3D yet now keeps the default head in the preview instead of leaving the body headless, and items with only an icon are labelled ICON in the picker.",
      "3,091 of the catalog's 3,332 cosmetics now have a first-pass 3D reconstruction.",
    ],
  },
  {
    id: "2026-11-06-missing-cosmetics",
    date: "2026-11-06",
    title: "76 missing cosmetics",
    notes: [
      "76 cosmetics from earlier seasons that the catalog had skipped, the Final Fly Durag among them, join it under their wiki names. They show their icons for now; 3D comes later.",
      "30 more cosmetics render in 3D, among them the sci-fi knight tops, the paper tiger heads, the Christmas-light sweaters and the smart step counter.",
      "3,037 of the catalog's 3,331 cosmetics now have a first-pass 3D reconstruction. The share reads 91% because the catalog grew.",
      "Robot legs that come with their own feet now replace your shoes, as in game.",
    ],
  },
  {
    id: "2026-11-05-seasons-11-12",
    date: "2026-11-05",
    title: "Seasons 11 and 12",
    notes: [
      "389 cosmetics from Seasons 11 and 12 join the catalog, under their wiki names.",
      "92% of the catalog's 3,255 cosmetics now have a first-pass 3D reconstruction, up from 84%.",
      "Gems, glass, fur, glowing LED pieces and more faces render with their recovered materials.",
      "Outfits download faster, with a progress readout while the character loads.",
    ],
  },
  {
    id: "2026-11-04-new-look",
    date: "2026-11-04",
    title: "New look",
    notes: [
      "The builder is rebuilt around the 3D preview. The category list shows what you are wearing in each.",
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
