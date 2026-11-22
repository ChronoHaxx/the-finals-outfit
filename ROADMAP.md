<!--
This file is the roadmap's only source. The app's Roadmap page is built from it: src/lib/roadmap.ts
parses it, and the `roadmap` plugin in vite.config.ts checks it, so `npm run build` fails when:
- a line is not one of: "## " section, "### " item title, plain paragraph, "- " bullet (wrap a bullet
  with a two-space indent), or a "Done when: " paragraph;
- a section is not one of: Current focus, Next, Waiting on a decision, Later, Done;
- a count or percentage is typed by hand. Write {total}, {blue}, {red}, {purple}, {green} or
  {latestSeason}; the page fills them from the shipped catalog and status data, like the progress bar.
  Here on GitHub they show as placeholders;
- the text uses bold, code, links or HTML, which the page would show as raw characters;
- an item has no id line directly under its "### " title (an HTML comment holding "id: kebab-case-id",
  like the ones below), or two items share an id. Patch notes (their `items` field) and the internal
  board refer to items by id, so never change or reuse one; a new item gets a new id;
- the text leaks internal detail: a commit hash, file path, branch, issue number, game asset name,
  game-data tooling, hosting or admin work, the tooling behind the project, or an internal batch
  name. The rules are in src/lib/public-text.ts and apply to the patch notes too;
- "Reviewed after patch note" is not the id of the newest patch note (src/data/changelog.ts), or
  "Last reviewed" is older than that patch note or the catalog update (src/data/catalog-update.ts).
  Whenever you ship either, re-read this file, fix what changed, then set both lines. The id is what
  catches a second patch note on the day of the last review.
Keep it player-facing: what a visitor will notice, no internal batch names, no claims the census
does not support. Leave out internal work: hosting, asset protection, repository access and
developer-only tools such as the 3D export. Comments like this one are not shown on the page.
-->

# Roadmap

Last reviewed: 2026-11-22
Reviewed after patch note: 2026-11-22-chinals-emote-sounds

The goal is every cosmetic in THE FINALS looking right in the 3D preview, in any outfit. Medium comes first; Light and Heavy follow.

These are plans, not dated promises. Item counts are live and use the same statuses as the item picker.

## Current focus

### Rebuild the remaining red items
<!-- id: red-items -->

{red} items are still red. Some use material types the preview cannot draw yet: animated screens and holograms, glitch effects, and coats and capes that the game moves with cloth physics. Some wait on a decision listed below. Items newly added to the catalog also start red, showing their icon until their 3D is built.

- Add each missing material type once, so every item and colour variant that uses it moves together.
- Compare every rebuilt item with its in-game icon before it turns blue.
- Keep an item red until its result has been checked; a first pass that looks wrong is not counted.

Done when: every item is blue or green, or this roadmap names what still blocks it.

### Fix known issues
<!-- id: known-issues -->

{purple} items are purple: a visible problem has been recorded, such as a missing part, a wrong finish or skin showing through.

- Fix the shared cause where there is one, rather than patching a single item.
- Re-check each fix in the outfit where the problem was found.

Done when: no item stays purple without a known cause and a planned fix.

### Check items together, not only alone
<!-- id: item-pairs -->

An item that looks right alone can break another: a helmet that hides a beard, or a jacket that leaves a gap at the neck. Each update is checked with pairs of items that share a part of the body before it ships.

- Fix clipping, missing pieces and wrongly hidden skin found in those pairs.
- Keep a problem found after release purple until its fix is verified.

## Next

### Light and Heavy contestants
<!-- id: light-heavy -->

The preview shows the Medium contestant. Its Masculine and Androgynous body types can already be picked. Feminine follows once the Season 12 clothing has been refitted, then the Light and Heavy bodies with their own body types.

- Refit clothing that changed in Season 12, so it fits the body it was made for.
- Fit every garment and accessory to each body, using the game's own fitting data.
- Report each item's status per body, so blue on Medium does not imply blue on Heavy.

## Waiting on a decision

### Jackets and capes moved by cloth physics
<!-- id: cloth-physics -->

In the game, cloth physics moves some jacket sleeves, coats and capes. The preview cannot run that simulation yet, and a simpler approximation is waiting for approval.

### Items that recolour another item
<!-- id: recolour-items -->

Some gloves, masks and makeup change the colour of the hands, face or hair they sit on. Doing this as the game does needs a decision on which default values to use where the game files record none.

### Animated noise on some screens and visors
<!-- id: screen-noise -->

A few glowing screens and visors draw a random-noise pattern that the preview reproduces only approximately. Whether that difference is close enough is still open.

## Later

### From blue to green
<!-- id: blue-to-green -->

Blue is a first pass that may still need polish; green means an item has been checked in a reviewed outfit. A review pass will confirm items as green and fix the polish problems it finds.

### Physics and secondary motion
<!-- id: secondary-motion -->

Hair, cloth and dangling accessories that move when the character does, using the game's own physics settings for each item.

- Check the motion against the body and nearby clothing so it does not cause new clipping.
- Keep reduced-motion and lighter options for slower devices.

### Themes and outfit suggestions
<!-- id: themes-suggestions -->

Theme filters, such as playful or tactical, and outfit suggestions, once item tags and fitting are dependable. Randomise already builds rules-based outfits.

### Emote effects and props
<!-- id: emote-effects -->

Emotes play their sound effects and music, but not yet their visual effects. Props now follow the game's own placement and size; a few may still be off.

- Add particle effects such as sparks, smoke and confetti.
- Check each emote's props against the game and fix the ones that are off.

### Contributing fixes
<!-- id: contributing-fixes -->

A guide for reproducing a reported problem and checking a fix, so others can help move items from red to blue.

## Done

### The catalog
<!-- id: catalog -->

{total} cosmetics through Season {latestSeason}, under their THE FINALS Wiki names, with colour variants listed separately. Some cosmetics from earlier seasons were left out when the catalog was first built; adding them is in progress. Outfit links keep working as the catalog grows.

### The game's own outfits
<!-- id: in-game-outfits -->

The game's preset outfits are listed with their in-game icons, and one tap puts a whole outfit on without changing your saved outfits. Pieces the catalog does not have yet, and effects the preview cannot show, are listed rather than left out.

### A first-pass 3D preview on Medium
<!-- id: first-pass-3d -->

Meshes and materials are rebuilt from the game's own files for {blue} items so far. Recovered materials include layered fabrics, glass and gems, fur, hair, eyes and faces, makeup and glowing LED pieces. Numbers printed on clothing show the player number you pick.

### Default lighting
<!-- id: default-lighting -->

The default Studio light was rebuilt from measurements against the in-game icons. Dark clothing no longer washes out to grey, and fabrics catch the light the way they do in the game. It is the look every outfit opens in.

### Lighting and backdrops
<!-- id: lighting-backdrops -->

A Lighting panel offers ready-made looks, Studio and Lobby among them, and lets you change each light's colour, brightness and direction, add lights, choose a solid or gradient backdrop and turn on a floor shadow. Your own looks can be saved, and each light can be shown in the 3D view and dragged into place. Two scenes from the game, the Season 12 menu stage and the tunnel from the Season 12 intro, can stand behind the character.

### Outfits that fit together
<!-- id: outfit-fitting -->

Clothing hides the body beneath it, hair swaps to its under-hat shape, and full-body garments fill both upper and lower body.

### Idle animation and emotes
<!-- id: idle-emotes -->

The character plays the game's outfit-screen idle by default. Every emote in the game files can be picked from its in-game icon and plays with its props, and with its sound where it has one, and the equipped cosmetics follow the body. The face moves too: blinks, glances and expressions, with beards and scarves following, and a switch keeps it still. A timeline pauses an emote on any frame, loops it or changes its speed, and a share link keeps that pose. One click returns to the still pose.

### Chinals emotes
<!-- id: chinals-emotes -->

A labelled Chinals mode plays the emotes of 终极角逐, THE FINALS as published in mainland China, on your outfit, with their sound effects and music. Their faces move as in global emotes. Emotes without an English name show the Chinese name with this site's unofficial translation. Chinals cosmetics are not on the site.

### Share, randomise and report
<!-- id: share-randomise-report -->

Share links come with a four-angle preview image and open on the camera you were looking through. Randomise builds a rules-based outfit and keeps locked pieces. Report issue opens a prefilled GitHub issue for you to review and send.

### A faster builder that works on phones
<!-- id: faster-builder -->

The builder was redesigned around the 3D preview, which fills the window with the items in a drawer beside it, or in a sheet under it on phones. Outfits download faster, with a loading readout. Your outfits are saved in your browser as you work, a full-screen view or the H key shows only the character, screenshots save or copy as PNG with the backdrop or a transparent background, an emote can be saved as a video, the camera can be placed by numbers, tilted and saved as views with an outfit, a What you can do guide lists every feature, and graphics settings trade quality for speed. The preview does far less work each frame, so slower computers run it more smoothly.
