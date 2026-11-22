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
    id: "2026-11-22-builder-shows-you-around",
    date: "2026-11-22",
    title: "The builder shows you around",
    notes: [
      "Bring the pointer near a control you haven't tried and a one-line note names it, says what it does and shows its key. Once you have used it, the note waits for a hover. A small red corner marks a few controls you haven't tried yet.",
      "Take the tour from the welcome screen or the Guide: it frames each control in turn, right on the page, and nothing is blocked while it runs. Esc stops it, and it carries on from that stop next time.",
      "The Guide, also on the ? key, is now short: the tour, every control in one line with Show me to point at it, and the keys and gestures. On a phone, Show me and the tour do the pointing.",
      "Lighting, Camera, Capture and Graphics now look and open the same way, with their names on the buttons when there is room. Camera has a new icon, so it is no longer mixed up with Capture.",
    ],
    items: ["faster-builder"],
  },
  {
    id: "2026-11-22-shared-lighting",
    date: "2026-11-22",
    title: "Share links keep your lighting",
    notes: [
      "A share link now opens in the lighting you see: the look, every light, the backdrop and the scene. The preview image was already drawn in it, so now the outfit opens looking like its card. Untick Include lighting in the share panel to leave it out.",
      "Opening someone's link shows their lighting without touching yours. A bar under the top menu offers Keep this lighting, which makes it yours and adds it to your saved looks, and Use my lighting, which brings yours back. Changing anything in the lighting panel keeps theirs as well, and Undo returns to yours.",
    ],
    items: ["share-randomise-report", "lighting-backdrops"],
  },
  {
    id: "2026-11-22-chinals-emote-sounds",
    date: "2026-11-22",
    title: "Chinals emote sounds",
    notes: [
      "In Chinals mode, the emotes now play their own sound effects and music too, in time with the animation. 43 of the 45 have sound; the other two are silent in the game too. The speaker button and volume slider work as they do for the other emotes.",
      "A few Chinals emote props now look right: two guns that came apart are whole again, guns that lay on the floor are held, and a prop shown too small is back to its full size.",
    ],
    items: ["chinals-emotes", "emote-effects"],
  },
  {
    id: "2026-11-22-chinals-faces",
    date: "2026-11-22",
    title: "Faces in Chinals emotes",
    notes: [
      "In Chinals mode, faces now move during the emotes and the idle, as they do in global emotes: blinks, glances, smiles, surprise and anger, from each emote's own animation. Beards and balaclavas follow the face, and masks and helmets soften it where the game does.",
    ],
    items: ["chinals-emotes"],
  },
  {
    id: "2026-11-22-camera-controls",
    date: "2026-11-22",
    title: "Camera controls",
    notes: [
      "A new viewfinder button beside the camera button shows where the camera is and the point it looks at, in metres. Type any number to place the camera exactly, or nudge one with the arrow keys.",
      "Roll tilts the camera for an angled shot; Level straightens it again.",
      "Save views with an outfit and return to one in a click. Views saved with your other outfits are listed too. Like your outfits, they are kept in this browser.",
      "Share links now open on the camera you were looking through, so someone else can pick up your shot and improve it. Untick Include camera view in the share panel to leave it out. While a scene from the game is behind your outfit, the camera stays put and links leave it out. The preview image is unchanged.",
    ],
    items: ["share-randomise-report", "faster-builder"],
  },
  {
    id: "2026-11-22-light-markers-looks",
    date: "2026-11-22",
    title: "See the lights, drag them, five more looks",
    notes: [
      "Tick Show lights in the 3D view, in the lighting panel, to see each light as a bulb where it sits, with a cone the way it shines. Drag a bulb to move its light: the light's Direction and Height sliders follow. The bulbs never appear in screenshots or share images, and H hides them.",
      "Five more ready-made looks: Dramatic, Cool, Warm, Fullbright and Nighttime. The Season 12 menu look now lights the character the way the menu does: a warm key from above, strong blue light and a white back light from behind on the left, and a weak fill from below.",
    ],
    items: ["lighting-backdrops"],
  },
  {
    id: "2026-11-22-scene-backdrops",
    date: "2026-11-22",
    title: "Scenes from the game behind your outfit",
    notes: [
      "Two scenes from the game can now stand behind your outfit: the Season 12 menu stage, drawn live with its glowing lights, and the tunnel from the Season 12 intro. Pick one under Backdrop in the lighting panel, or choose the Season 12 menu look.",
      "While a scene shows, the camera stays where it is: drag to turn the character, and scroll or pinch to zoom. Screenshots, videos and share images show the scene's colours rather than the scene itself.",
    ],
    items: ["lighting-backdrops"],
  },
  {
    id: "2026-11-22-in-game-outfits",
    date: "2026-11-22",
    title: "In-game outfits",
    notes: [
      "Outfits, first in the wardrobe, lists the game's own 352 outfits with their in-game icons. One tap puts a whole outfit on and keeps your face and skin.",
      "An outfit you put on is not saved until you change something or press Save, so your saved outfits stay as they were. Pieces the catalog does not have yet, and effects the preview cannot show, are listed rather than left out.",
      "150 cosmetics join the catalog, among them the practice-range mannequin, Bull’s Eye Barry, and its wooden twin, Bull’s Eye Barrel. They show their icons for now; 3D comes later.",
      "42 more cosmetics render in 3D, among them the space pilot jackets, capes and skirts, the tiger pants and hoodie, the ballistic and demon LED masks, the carbon racing helmet and more hair. 15 cosmetics with a glitch pattern also render in 3D, without that effect, which the preview cannot show yet.",
      "3,151 of the catalog's 3,482 cosmetics now have a first-pass 3D reconstruction. The share reads 90% because the catalog grew.",
      "Earrings and Laugh Trigger now sit in place on every face, not only Face 01.",
      "An emote picked while the outfit is still loading now plays to its end instead of going back to the idle after a second or two.",
      "The preview does far less work each frame, so it runs more smoothly on slower computers such as laptops with built-in graphics, most of all with a face on.",
      "Pick your player number, 10 to 99, beside Body type. Clothing that prints a number, such as jerseys and cargo pants, shows yours in its own lettering, and Own keeps each piece's printed number. The number is saved with the outfit and carried by share links.",
      "Screenshots are now drawn at twice their size and scaled down, for crisper detail. The camera button's new Video tab saves the emote on screen as a 60 fps video, made in your own browser: an MP4 with sound, a see-through WebM, or a see-through PNG sequence for video editors.",
      "A What you can do guide lists everything the builder does and where each control is. Open it from the welcome screen, the Guide button in the top bar, or the ? key.",
    ],
    items: ["in-game-outfits", "catalog", "red-items", "idle-emotes", "faster-builder", "first-pass-3d"],
  },
  {
    id: "2026-11-21-emote-speed-face",
    date: "2026-11-21",
    title: "Emote speed and a face switch",
    notes: [
      "Emotes have a speed slider, from a quarter speed to four times. Sound follows it, so every clap and footstep stays on its frame, and its pitch rises and falls with the speed. Pause, the frame slider, Loop and shared poses work the same at any speed. On a keyboard, < and > change it.",
      "A Facial animation switch keeps the face still when you'd rather it didn't move. The speed and the switch are both remembered in this browser.",
    ],
    items: ["idle-emotes"],
  },
  {
    id: "2026-11-21-season-1-2-emotes",
    date: "2026-11-21",
    title: "Season 1 and 2 emotes",
    notes: [
      "The emote picker now lists all 295 emotes in the game files. 66 were missing, most of them from Seasons 1 and 2, such as Make It Rain, Keyed Up and Applause Pause. They play with their props, sound and facial animation like the rest.",
      "Eight of them were already under More with working-title names (Wave, Clap, Flex and others). They now show their game names and icons, and links to them still work.",
      "In Chinals mode, five emotes that have no icon of their own in the game files now sit under Uncategorised, at the end of the list.",
    ],
    items: ["idle-emotes"],
  },
  {
    id: "2026-11-15-faces-lighting-chinals",
    date: "2026-11-15",
    title: "Faces that move, your own lighting, Chinals emotes",
    notes: [
      "Faces now move in idles and emotes, from the game's own animation: blinks, glances, brows, jaw and expressions. Beards, balaclavas and scarves follow the face, and masks and helmets soften it where the game does.",
      "A new Lighting panel. Start from Studio, Lobby or one of four sun looks, then change each light's colour, brightness and direction, add lights, pick a solid or gradient backdrop and turn on a floor shadow. Your own looks can be saved.",
      "Pick a body type: Masculine or Androgynous. Saved outfits and share links keep it. Feminine follows once the Season 12 clothing has been refitted.",
      "Chinals mode plays the 45 emotes of 终极角逐, THE FINALS as published in mainland China, on your outfit. Switch with Global | Chinals at the top. Emotes without an English name show the Chinese name with this site's unofficial translation.",
      "Emote props sit where the game puts them: thrones, tables, brooms and turrets are no longer turned, buried or oversized. Emotes can also loop.",
    ],
    items: ["idle-emotes", "lighting-backdrops", "default-lighting", "light-heavy", "chinals-emotes", "emote-effects"],
  },
  {
    id: "2026-11-15-emote-sounds",
    date: "2026-11-15",
    title: "Emote sounds",
    notes: [
      "Emotes now play the game's own sound effects and music, in time with the animation. 235 of the 237 emotes in the picker have sound; the other two are silent in the game too.",
      "Sound starts with your first click or tap, as browsers require, and follows the emote through pause, scrubbing and loops. A speaker button beside Pause mutes it, and on a computer a slider sets the volume. Both are remembered in this browser.",
      "Props now appear without a hitch the first time an emote shows them.",
    ],
    items: ["emote-effects", "idle-emotes"],
  },
  {
    id: "2026-11-15-full-window-screenshots",
    date: "2026-11-15",
    title: "Full-window view and transparent screenshots",
    notes: [
      "The 3D view now fills the window. The item picker is a drawer you open and close from the Items tab at its edge; on a phone held upright it is a sheet under the character that you tap or swipe. It stays the way you left it.",
      "Press H to hide every control and the mouse pointer for a clean view. H, Esc or a double-click brings them back. On a phone, tap the eye button, then double-tap to return.",
      "Save a screenshot as a PNG from the camera button, or copy it to paste straight into a chat: on its backdrop, or with a transparent background to lay over anything. The lighting is the same as on screen, at up to three times the view's size.",
      "Fixed: earrings and Laugh Trigger stopped the preview loading with many faces other than Face 01. A few of them can only be placed on Face 01 for now and say so on other faces.",
    ],
    items: ["faster-builder"],
  },
  {
    id: "2026-11-11-new-studio-light",
    date: "2026-11-11",
    title: "New Studio light",
    notes: [
      "The default Studio light was rebuilt from measurements against the in-game icons. Dark clothing no longer washes out to grey, and fabrics catch the light the way they do in the game.",
      "18 more cosmetics render in 3D, among them the bunny costume, the Eastern emperor helmets, the sci-fi knight bottoms, the military ski mask, the red-glow tactical helmet and more beards and hair.",
      "3,109 of the catalog's 3,332 cosmetics now have a first-pass 3D reconstruction.",
      "Since the last notes: up to 100 saved outfits in your browser, a full-screen view, an emote timeline that pauses on any frame and shares that pose, and graphics settings for quality and resolution.",
    ],
    items: ["default-lighting", "red-items", "idle-emotes"],
  },
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
