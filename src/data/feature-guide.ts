// "What you can do": the builder's features in one place (21 Nov 2026). Regular visitors had missed that the site
// works on phones, keeps outfits in the browser and shares a paused emote frame, because each feature was only ever
// announced once, in a patch note. This list is the standing answer; FeatureGuide.tsx shows it.
//
// Every string here is public text: the build checks it with the rules in src/lib/public-text.ts, the same as the
// roadmap and the patch notes (vite.config.ts, `feature-guide-text`). Describe only what has shipped on the live site,
// in the words its controls use, and say where each control is. When a control is renamed or moved, update this file.
// Ids are stable, so a later change can refer to an entry; never reuse one.

/** A feature some deployments leave out; its entry is shown only where the feature exists. */
export type GuideCondition = "chinals" | "sharePreview";

export interface GuideItem {
  id: string;
  title: string;
  text: string;
  /** Where the control is, in the words on screen. */
  where?: string;
  only?: GuideCondition;
}

export interface GuideSection {
  id: string;
  title: string;
  items: readonly GuideItem[];
  only?: GuideCondition;
}

export interface GuideShortcut {
  /** Keys or gestures, each shown as its own key cap. */
  keys: readonly string[];
  action: string;
}

export const FEATURE_GUIDE: readonly GuideSection[] = [
  {
    id: "build",
    title: "Build an outfit",
    items: [
      {
        id: "items",
        title: "Items",
        text: "Pick cosmetics from the Items drawer beside the 3D view. Search a slot by name, or filter it by 3D status.",
        where: "Items tab, at the edge of the view",
      },
      {
        id: "body-type",
        title: "Body type",
        text: "Switch between Masculine and Androgynous. Saved outfits and share links keep it.",
        where: "Body type, under the outfit name",
      },
      {
        id: "randomise",
        title: "Randomise and lock",
        text: "Roll a random outfit whose pieces fit together. The lock on a piece keeps it through every roll. An outfit you made yourself is kept: the roll starts a new one.",
        where: "Randomise, at the foot of the outfit",
      },
      {
        id: "report",
        title: "Report issue",
        text: "Something looks wrong? Report issue opens a prefilled GitHub issue for you to review and send. The flag on a single piece reports just that piece.",
        where: "Report issue, next to Reset",
      },
    ],
  },
  {
    id: "saved",
    title: "Kept in this browser",
    items: [
      {
        id: "saved-outfits",
        title: "Saved outfits",
        text: "Every change saves as you go, up to 100 outfits. Switch, rename, duplicate or delete them from the list, and undo a delete. Private windows forget them when closed.",
        where: "The outfit name opens the list",
      },
      {
        id: "remembered",
        title: "Your settings",
        text: "Your lighting and saved looks, emote sound and loop, graphics settings and the drawer are remembered too.",
      },
    ],
  },
  {
    id: "share",
    title: "Share",
    items: [
      {
        id: "share-link",
        title: "Share links",
        text: "Share outfit copies a link to the outfit and its body type. With an emote on screen, tick Include this frame to share that exact pose, paused or playing. Lighting is not part of the link: whoever opens it sees the lighting set in their own browser.",
        where: "Share outfit, at the foot of the outfit",
      },
      {
        id: "share-preview",
        title: "Link previews",
        text: "A link with a preview image shows the outfit from four angles when you post it in a chat.",
        where: "Link style, in the share panel",
        only: "sharePreview",
      },
    ],
  },
  {
    id: "emotes",
    title: "Emotes and poses",
    items: [
      {
        id: "emotes",
        title: "Emotes",
        text: "Play any emote from its in-game icon, with its props, and its sound and facial animation where the game has them. Search by name. The speaker button mutes the sound.",
        where: "Emotes, on the right of the view",
      },
      {
        id: "timeline",
        title: "Timeline",
        text: "Pause on any frame, drag through the emote or step one frame at a time, and turn on Loop to repeat it.",
        where: "Along the bottom while an emote plays",
      },
      {
        id: "idle",
        title: "Idle or still",
        text: "The character plays the outfit-screen idle. Animate switches between the idle and a still pose.",
        where: "Animate, on the right of the view",
      },
    ],
  },
  {
    id: "look",
    title: "Light and graphics",
    items: [
      {
        id: "lighting",
        title: "Lighting and backdrop",
        text: "Start from Studio, Lobby or a sun look, then change each light's colour, brightness and direction, pick a solid or gradient backdrop, turn on a floor shadow and save your own looks.",
        where: "The button named after the look, top right",
      },
      {
        id: "graphics",
        title: "Graphics",
        text: "Auto suits the quality to your device. You can set quality, anti-aliasing and resolution yourself, or show a frame-rate counter.",
        where: "Graphics, top right",
      },
    ],
  },
  {
    id: "capture",
    title: "Capture",
    items: [
      {
        id: "full-window",
        title: "Full screen and hidden controls",
        text: "Full screen leaves only the character. The eye button, or H, hides every control and the pointer for a clean shot.",
        where: "Top right of the view",
      },
      {
        id: "screenshot",
        title: "Screenshots",
        text: "Save a PNG or copy it to paste into a chat, on the backdrop or with a transparent background, at up to three times the view's size.",
        where: "Camera button, top right",
      },
    ],
  },
  {
    id: "phone",
    title: "On a phone",
    items: [
      {
        id: "phone-layout",
        title: "Works on phones",
        text: "Held upright, the items are a sheet under the character: tap or swipe its handle. Held sideways, they sit beside it.",
      },
      {
        id: "phone-camera",
        title: "Touch controls",
        text: "Drag to turn the character, pinch to zoom and drag with two fingers to move the view. After the eye button hides the controls, double-tap to bring them back.",
      },
    ],
  },
  {
    id: "chinals",
    title: "Chinals mode",
    only: "chinals",
    items: [
      {
        id: "chinals",
        title: "终极角逐 emotes",
        text: "Switch to Chinals to play the emotes of 终极角逐, THE FINALS as published in mainland China, on your outfit.",
        where: "Global | Chinals, at the top",
      },
    ],
  },
];

/** The one-time tips (lib/hints.ts), by hint id. */
export const GUIDE_HINTS = {
  guide: "Phones, saved outfits, sharing a paused pose: see everything the builder can do.",
  "pause-share": "Share outfit can include this frame, so the link opens on this exact pose.",
} as const satisfies Record<"guide" | "pause-share", string>; // the HintId values in lib/hints.ts (vite.config reads this file without DOM types)

/** With a mouse and keyboard. */
export const POINTER_SHORTCUTS: readonly GuideShortcut[] = [
  { keys: ["Drag"], action: "Turn the camera" },
  { keys: ["Right-drag"], action: "Move the camera" },
  { keys: ["Scroll"], action: "Zoom" },
  { keys: ["H"], action: "Hide or show the controls" },
  { keys: [",", "."], action: "Previous or next frame of an emote" },
  { keys: ["Esc"], action: "Close a panel, bring the controls back or leave full screen" },
  { keys: ["?"], action: "Open or close this guide" },
];

/** On a touch screen. */
export const TOUCH_SHORTCUTS: readonly GuideShortcut[] = [
  { keys: ["Drag"], action: "Turn the camera" },
  { keys: ["Pinch"], action: "Zoom" },
  { keys: ["Two-finger drag"], action: "Move the camera" },
  { keys: ["Double-tap"], action: "Bring hidden controls back" },
];

/** Every visitor-facing string with where it lives, for the public-text check. */
export function featureGuideStrings(): { text: string; where: string }[] {
  const at = (path: string) => `feature guide ${path} (src/data/feature-guide.ts)`;
  const out: { text: string; where: string }[] = [];
  for (const section of FEATURE_GUIDE) {
    out.push({ text: section.title, where: at(`"${section.id}" title`) });
    for (const item of section.items) {
      for (const field of ["title", "text", "where"] as const) {
        const text = item[field];
        if (text) out.push({ text, where: at(`"${section.id}/${item.id}" ${field}`) });
      }
    }
  }
  for (const [id, text] of Object.entries(GUIDE_HINTS)) out.push({ text, where: at(`hint "${id}"`) });
  for (const [list, shortcuts] of [["pointer", POINTER_SHORTCUTS], ["touch", TOUCH_SHORTCUTS]] as const) {
    shortcuts.forEach((shortcut, index) => {
      out.push({ text: shortcut.action, where: at(`${list} shortcut ${index + 1}`) });
      shortcut.keys.forEach(key => out.push({ text: key, where: at(`${list} shortcut ${index + 1} key`) }));
    });
  }
  return out;
}
