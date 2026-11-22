// The builder's controls, named once (22 Nov 2026). This file is the single source of every hint the builder shows about
// itself: the callout beside a control when the pointer comes near it or it takes keyboard focus, the tour that frames
// each control in turn, the Guide sheet's index ("Show me"), and the one-time nudges tied to an action. It replaced
// "What you can do" (21 Nov), a page of paragraphs that said where each control was; now the interface points at the
// control itself, so the words only say what it does.
//
// To add a feature: give its control one entry here (a new id, never a reused one), then put `useFeature("<id>")` on
// that control (src/lib/discovery.ts). tests/feature-guide.test.ts checks that every id here is on a control.
//
// Every string here is public text: the build checks it with the rules in src/lib/public-text.ts, the same as the
// roadmap and the patch notes (vite.config.ts, `feature-guide-text`). Name a control the way the control names itself.
// A hint is one line, starts with a verb, and says what the control does, not where it is.

/** A feature some deployments leave out; its entry is used only where the feature exists. */
export type GuideCondition = "chinals" | "sharePreview";

/** The Guide sheet's groups, verbs in the order an outfit gets made. */
export type FeatureGroup = "build" | "pose" | "light" | "shoot";

export const FEATURE_GROUPS: readonly { id: FeatureGroup; title: string }[] = [
  { id: "build", title: "Build" },
  { id: "pose", title: "Pose" },
  { id: "light", title: "Light" },
  { id: "shoot", title: "Shoot" },
];

export interface Feature {
  /** Stable: it is the control's `data-feature`, and a visitor's progress is stored under it. Never reuse one. */
  id: string;
  group: FeatureGroup;
  /** The control's own name, as it reads on screen. */
  name: string;
  /** One line, verb first: what the control does. */
  hint: string;
  /** Its keyboard shortcut, each key its own cap. */
  keys?: readonly string[];
  /** When the control only shows in some state, what brings it up (the Guide sheet says so instead of "Show me"). */
  needs?: string;
  /** Leave the control without the red "not tried yet" corner: its own label already says what it does. */
  noMark?: true;
  only?: GuideCondition;
}

export const FEATURES = [
  // Build
  { id: "items", group: "build", name: "Items", hint: "Pick a slot, then a piece to put it on.", noMark: true },
  { id: "in-game-outfits", group: "build", name: "In-game outfits", hint: "Wear one of the game's own outfits in one go." },
  { id: "saved-outfits", group: "build", name: "Saved outfits", hint: "Switch, rename or duplicate outfits. Every change saves itself." },
  { id: "randomise", group: "build", name: "Randomise", hint: "Roll a whole outfit. Lock a piece to keep it through every roll." },
  { id: "share", group: "build", name: "Share outfit", hint: "Copy a link with the outfit, your camera, lighting and pose.", noMark: true },
  // Pose
  { id: "emotes", group: "pose", name: "Emotes", hint: "Play any emote from the game, with its props, sound and face." },
  { id: "timeline", group: "pose", name: "Timeline", hint: "Pause, drag or step through an emote one frame at a time.", keys: [",", "."], needs: "Play an emote" },
  { id: "emote-speed", group: "pose", name: "Speed", hint: "Slow an emote to a quarter, or speed it up four times.", keys: ["<", ">"], needs: "Play an emote" },
  { id: "animate", group: "pose", name: "Animate", hint: "Switch between the outfit-screen idle and a still pose." },
  { id: "chinals", group: "pose", name: "Chinals", hint: "Play the emotes of 终极角逐 on your outfit.", only: "chinals" },
  // Light
  { id: "lighting", group: "light", name: "Lighting", hint: "Pick a look, move each light, set a backdrop or a game scene." },
  { id: "sun", group: "light", name: "Sun", hint: "Turn the sun round the character. Double-click to put it back.", needs: "A look with a sun, on a wider view" },
  // Shoot
  { id: "camera", group: "shoot", name: "Camera", hint: "Place the camera exactly, roll it, and save views." },
  { id: "capture", group: "shoot", name: "Capture", hint: "Save a PNG up to three times the view's size, or an emote as video." },
  { id: "hide-ui", group: "shoot", name: "Hide controls", hint: "Leave only the character on screen for a clean shot.", keys: ["H"] },
  { id: "full-screen", group: "shoot", name: "Full screen", hint: "Fill the whole screen with the character. Esc leaves." },
  { id: "graphics", group: "shoot", name: "Graphics", hint: "Set quality, anti-aliasing and resolution, or show the frame rate." },
] as const satisfies readonly Feature[];

/** The Guide button itself: a control like the rest, but not listed in its own index. */
export const GUIDE_FEATURE = {
  id: "guide", group: "build", name: "Guide", hint: "Take the tour, find any control, see every shortcut.", keys: ["?"],
} as const satisfies Feature;

export type FeatureId = (typeof FEATURES)[number]["id"] | typeof GUIDE_FEATURE.id;

const BY_ID = new Map<string, Feature>([...FEATURES, GUIDE_FEATURE].map(feature => [feature.id, feature]));
export const featureById = (id: string): Feature | undefined => BY_ID.get(id);

/** The tour: each stop frames one control. Stops whose control is not on screen (or not on this site) are skipped. */
export const TOUR: readonly FeatureId[] = [
  "items", "in-game-outfits", "saved-outfits", "share", "emotes", "lighting", "capture", "camera", "hide-ui",
];

/** The tour's own words, on the welcome screen and the Guide sheet. */
export const TOUR_TEXT = {
  start: "Take the tour",
  resume: "Resume the tour",
  replay: "Replay the tour",
  next: "Next",
  back: "Back",
  finish: "Finish",
  end: "End tour",
} as const;

/** One-time nudges, each tied to the moment it is useful (lib/hints.ts records that it was shown), by hint id. Earlier
 *  entries take over from later ones. `{x}` is drawn as the key cap x. */
export const NUDGES = {
  "pause-share": { feature: "timeline", title: "Share this pose", text: "Share outfit can include this exact frame." },
  "emote-keys": { feature: "timeline", title: "Frame by frame", text: "Step with {,} and {.}, change the speed with {<} and {>}." },
} as const satisfies Record<string, { feature: FeatureId; title: string; text: string }>;

export interface GuideShortcut {
  /** Keys or gestures, each shown as its own key cap. */
  keys: readonly string[];
  action: string;
}

/** With a mouse and keyboard. */
export const POINTER_SHORTCUTS: readonly GuideShortcut[] = [
  { keys: ["Drag"], action: "Turn the camera" },
  { keys: ["Right-drag"], action: "Move the camera" },
  { keys: ["Scroll"], action: "Zoom" },
  { keys: ["H"], action: "Hide or show the controls" },
  { keys: [",", "."], action: "Step an emote back or on a frame" },
  { keys: ["<", ">"], action: "Slow an emote down or speed it up" },
  { keys: ["Esc"], action: "Close a panel, show the controls or leave full screen" },
  { keys: ["?"], action: "Open or close the guide" },
];

/** On a touch screen. */
export const TOUCH_SHORTCUTS: readonly GuideShortcut[] = [
  { keys: ["Drag"], action: "Turn the camera" },
  { keys: ["Pinch"], action: "Zoom" },
  { keys: ["Two-finger drag"], action: "Move the camera" },
  { keys: ["Double-tap"], action: "Show the controls again" },
];

/** Every visitor-facing string with where it lives, for the public-text check. */
export function featureGuideStrings(): { text: string; where: string }[] {
  const at = (path: string) => `feature guide ${path} (src/data/feature-guide.ts)`;
  const out: { text: string; where: string }[] = [];
  for (const group of FEATURE_GROUPS) out.push({ text: group.title, where: at(`group "${group.id}"`) });
  for (const feature of [...FEATURES, GUIDE_FEATURE] as readonly Feature[]) {
    for (const field of ["name", "hint", "needs"] as const) {
      const text = feature[field];
      if (text) out.push({ text, where: at(`"${feature.id}" ${field}`) });
    }
    feature.keys?.forEach(key => out.push({ text: key, where: at(`"${feature.id}" key`) }));
  }
  for (const [id, text] of Object.entries(TOUR_TEXT)) out.push({ text, where: at(`tour "${id}"`) });
  for (const [id, nudge] of Object.entries(NUDGES)) {
    out.push({ text: nudge.title, where: at(`nudge "${id}" title`) });
    out.push({ text: nudge.text, where: at(`nudge "${id}"`) });
  }
  for (const [list, shortcuts] of [["pointer", POINTER_SHORTCUTS], ["touch", TOUCH_SHORTCUTS]] as const) {
    shortcuts.forEach((shortcut, index) => {
      out.push({ text: shortcut.action, where: at(`${list} shortcut ${index + 1}`) });
      shortcut.keys.forEach(key => out.push({ text: key, where: at(`${list} shortcut ${index + 1} key`) }));
    });
  }
  return out;
}
