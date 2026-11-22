# Chinals facial animation (21 Nov 2026)

In Chinals mode the faces now move during the 45 Chinals emotes and the Chinals idle, as global emotes have since
PR #48. Shocka saw "Effects and facial expressions not shown yet" on them on 16 Nov
(item 8 of the feedback list kept untracked in the main checkout, `_docs/feedback-shocka-2026-11/README.md`). Branch `claude/chinals-faces-2026-11-21`.

## What the Chinals data says

Everything was read offline from the Chinals client's paks (UE 5.3) with `chinals-probe`. Nothing touched a game.

- **Curves.** All 46 Chinals clips (45 emotes and the idle) carry the same `Face_*` curves as global clips. The
  re-export (`tools/export-faces.ps1`) also confirmed their bone tracks are identical to the 10 Nov export, so the
  published set-3 stays valid.
- **One spelling difference, and it matters.** The face rig names its surprise pose `Face_Surprise`. Most global
  clips send `Face_Suprise`, which matches no pose, so global emotes never show surprise (as in the game). The Chinals
  clips spell it correctly in all 46 clips, so Chinals emotes do show it (WeaponMaster and the World Cup backheel peak
  at 1.0). The Chinals rig spells the pose the same way, so this is faithful to the Chinals game.
- **Rig.** The Chinals head data assets have no `FaceRigPoseAsset` field. Each Chinals head instead runs its own
  AnimBP (`MABP_Head_Face_NN_Base`), whose PoseBlendNode names the pose asset; global moved that choice onto the data
  asset and shares one AnimBP. The node set is the same: copy the body's pose and curves, a facial layer with a 2.5
  distance LOD blended in local space, a linear (clamping) PoseBlendNode, a 0.2 s mask blend.
- **Same rig as global.** `tools/compare-rigs.mjs` converts the Chinals PoseAssets and head skeletons with the exact
  code that built the live global files, using global's head-to-pose mapping:
  - 25 of the 27 global pose assets exist in the Chinals build, and all 25 convert **byte-identical** to the live
    files: the same 24 pose names, the same bones, the same deltas.
  - The 32 heads that use them have the same bone parents; rest positions differ by at most 0.0001 cm (rounding) and
    rotations by 0.
  - Face 24's and Face 32's pose assets are newer than the Chinals build. Those two global heads still animate in
    Chinals mode, with their global poses.
  - First pass trap: comparing quaternions with 2·acos(a·b) reported 0.17° everywhere. That was the formula, not the
    data: the files' 6-decimal rounding makes a quaternion slightly non-unit, and acos is ill-conditioned near 1. The
    tool now uses 4·atan2(|a−b|, |a+b|).

## What ships

**Data:** `faces-1/` in a new deployment of the Chinals Pages project, built by `tools/assemble-faces.mjs`:
- heads, poses, cage skins and masks copied byte for byte from the live global `faces-1` (98 files, fetched from
  17ec92c3 by `tools/fetch-faces.mjs`), so a Chinals visitor downloads the same rig files as a global one;
- the 46 Chinals clips' curves (`scripts/anim-export/build-face.mjs`: clamped, key-reduced, spelt as the pose), whose
  frame times and lengths match the published clips;
- `faces.json`, the index; 145 files, 14 MB.

The rest of the deployment is 59209741's set unchanged (set-3, props-3, sounds-1; checked 188/188 byte-identical
against the live host before staging), and `manifest.json` gains one line, `"faces": "faces-1/faces.json"`.

**Runtime:** `FaceAnimator` already drives whatever faces index the manifest names. One code change came out of the
agent run of the checklist: the face contact for head-wrapped parts (below, "Balaclava lip clip").
- The emote picker's footer is the one Shocka read. It said "Effects and facial expressions are not shown yet" in both
  modes. This branch first fixed it, but PR #58 (emote speed and the face switch) merged the same fix to main first,
  so the branch takes main's: the footer names facial expressions whenever the set ships a faces index. With this
  host, Chinals mode does.
- The Chinals banner said "Props are shown; effects, sound and facial expressions are not." It now says props, sound
  and facial expressions are shown, effects not. The host carries the sounds too (59209741's set).
- Public text: the patch note `2026-11-22-chinals-faces` (first `2026-11-21-…`; re-dated 22 Nov when main's
  `2026-11-22-in-game-outfits` landed first, so it stays the newest), the roadmap's review lines, and one sentence on the Chinals
  emotes item ("Their faces move as in global emotes.").

## Verification (agent)

All on the branch after merging main 96bf586 (code revision ee16736), 21-22 Nov 2026. The face contact (below) was
checked again after main's 12 Nov release (#67) was merged in: see "Balaclava lip clip" and the checklist's retest.

- **Rig and curves:** `tools/compare-rigs.mjs` (above): 25/25 pose assets byte-identical, 32 heads within 0.0001 cm.
- **Real app, local files** (`capture-chinals-faces.mjs` against `serve-preview.mjs` serving the staged host), then
  **again against the hosted deployment 7c9add72** (every face file loaded from it, all 200). Looked at full size,
  facial animation on and off at the same frame:
  - Unrivaled Master 3.2 s: open "O" mouth, raised brows (off: neutral); Lucky Touch (Mahjong) 3.37 s: brows down,
    eyes narrowed, lips pressed; Cute Cat 2.3 s: fear squint; Duanwu 2.37 s: jaw open; World Cup goalkeeper 2.13 s:
    snarl; the Chinals idle blinks.
  - Face 20 (another rig, eyelashes) smiles with teeth in Gacha 01 at 9.67 s.
  - Full beard: follows the open jaw (wrap cage). Balaclava: the face mask damps the face, and no lip showed in that
    capture. The checklist run later found the upper lip through it at Unrivaled Master's 3.2 s: "Balaclava lip clip".
- **Production build** (`prod-check.mjs`, deploy.yml's production settings plus this host, `prod-check.json`): the
  paused Unrivaled Master loads `faces.json`, the head, its pose asset and the clip's curves from 7c9add72; as a
  visitor (automation masked) the banner reads "Props, sound and facial expressions are shown; effects are not.", the
  picker footer "...with their props, sound and facial expressions. Effects are not shown yet.", and a real click plays
  Unrivaled Master to 5.6 s with audio running and its sound file loaded, then returns to the Chinals idle. No request
  to either host failed; no page error.
- `npm test`: 946 pass, 8 fail, 5 skipped. The 8 are the known fixture tests that need game files the worktree lacks
  (the ski-blade GLB, the socketed-static and base-body geometry checks), as on main. `npx tsc --noEmit` clean;
  `npm run build` passes (its roadmap and public-text checks included).
- Not covered by the agent: hearing the sound and judging the motion live in a real browser (user checks).

## Balaclava lip clip (checklist step 5) and the face contact

The agent run of the checklist (22 Nov) failed step 5: in Unrivaled Master at 3.2 s, the upper lip showed through Balaclava
Cotton Black (`functional-checklist.md`, "Recorded result"). The owner chose to fix it before merging.

**Cause** (`tools/probe-balaclava.mjs`, dev preview, depth of the head's mouth vertices through the knit):
- At rest the knit sits only 1.6 mm above Face 01's lips.
- At 3.2 s Face_Surprise and Face_BlueSteel (the pout) are both at 1.0. Either alone leaves 0.6 mm and 1.6 mm of knit;
  together the upper lip comes 0.6 mm through. The balaclava's face mask (`BWA_FaceJoints_FaceMask`, lips and jaw at
  half motion) is applied; without it the lip would come 4.5 mm through.
- The balaclava follows the face on the face's wrap cage (`FaceWrap.ts`): 439 vertices for the whole head, a handful
  around the mouth. With the cage held still the lip comes 2.4 mm through; following it recovers most of that, but the
  cage cannot follow a bulge between its vertices.
- Global emotes rarely send both: most global clips misspell the surprise curve (`Face_Suprise`), so that pose never
  fires there, and the global pouts checked did not clip (Trophy, Jade Rabbit with surprise at 0.38, Spin Service;
  `balaclava-pout.mjs`). Among the Chinals clips, which spell it right, both peak together only in Unrivaled Master
  (1.0), World Cup Backheel (0.62 at 4.83 s) and Cute Cat (0.49 at 5.93 s).

**The game most likely shows it too.** `tools/probe-ue-wrap.mjs` replaces the viewer's wrap with Unreal's cloth
mesh-to-mesh formula (position = sum of b_i (X_i + h N_i) over the proxy triangle, N_i its smooth vertex normals), as a
delta on the same rest wrap. The lip still comes 0.53 mm through (viewer: 0.58 mm). The data and the mechanism are the
game's, so the fix below is the viewer's own addition, not something read from the game.

**The fix: a one-sided face contact** (`FaceContact` in `src/rig/FaceWrap.ts`, applied by `FaceAnimator` after each
re-wrap on the moved cage):
- At rest, each head vertex that a wrapped part covers is bound to the nearest point of the part triangle above it. A
  vertex counts as covered when that triangle is within 5 mm and faces the same way as the head.
- While the face moves, those head vertices move with the head's own skinning by its FACIAL bones, all eight
  influences, through the same `FaceCage` maths as the wrap cage.
- Where a head vertex comes closer to the part than min(its rest gap, 1 mm), the triangle's corners are pushed out
  along their normals to restore that gap. The face may push a part out; it never pulls it in. Over an opening mouth
  the knit still spans the gap as the cage carries it, and a still face changes nothing (still renders and links
  unchanged).
- The head's vertices test the part's triangles, not the other way round: the part is low-poly where the face is dense.
  A first version bound each part vertex to the face beneath it; it only reduced the clip to 0.39 mm, because the lip
  bulges between the knit's vertices.

**Checks** (dev preview, `capture-contact.mjs` at full size, contact off and on at the same frame):
- Unrivaled Master at 3.2 s, front and 40 degrees: the lip patch is gone, and the knit's outline looks unchanged.
  The nearest lip vertex now stays 0.68 mm under the knit, where it was 0.58 mm through.
- Unrivaled Master at 3.3 s, Backheel at 4.83 s, Cute Cat at 5.93 s, and the global Spin Service (`kawaii`) at its full
  pout: clean, eye holes included.
- Full Beard at 3.2 s, front and side: no visible difference with the contact on or off. Mouth Scarf Base Black: the
  contact binds nothing (the scarf hangs more than 5 mm off the face) and no skin shows.
- `tools/probe-contact.mjs` scans every 0.1 s of Unrivaled Master. Its depth metric still flags skin at the knit's eye
  holes and the neck rim, the same with the contact on and off. That skin shows by design at the holes, or comes from
  the body's own skinning at the rim (the neck already reads up to 5 mm out with the face still). The front-of-face count
  falls from 112 vertices to 63 with the contact on; the remaining 63 are at the lower rim of the right eye hole, and
  the captures show no skin through the knit there.
- Cost, on this desktop: binding takes 65 ms once per part, head and fitting (Balaclava Cotton Black: 8,239 head
  vertices held), then 0.48 ms per frame while the face moves. Full Beard: 3,682 held, 0.28 ms per frame. Nothing runs
  while no clip plays.
- `tests/rig/face-animator.test.ts`: the contact holds a face patch under a part 1.6 mm above it, and does nothing at
  rest. A lip moving 3 mm out pushes the part to 1 mm above it; moving 3 mm in, the part stays. A part the cage pulls to
  0.5 mm goes back to 1 mm.

## Hosting

Uploaded 22 Nov 2026 on the owner's yes ("Yes, upload it").

- New deployment of the Pages project `the-finals-outfit-chinals-assets`: **https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/**
  (alias `chinals-1121-faces`). 334 files staged, 82.7 MB; Cloudflare uploaded 146 new files (faces-1 and the
  manifest) and reused the 187 it already held from 59209741.
- `verify-hosted.mjs`: 333/333 served files byte-identical to the staged folder (`_headers` is configuration, not
  served); `.glb` and `.json` carry CORS `*` and the immutable cache header; a missing path is 404.
- `.github/workflows/deploy.yml` `CHINALS_ANIMATIONS_BASE` points at it. The live site changes only when this PR
  merges. Rollback: 59209741 (no faces; PR #51's host), e7796a7c, dcb131a5 (still live on main until a PR merges).
- **PR #51 conflict:** #51 sets the same line to 59209741. This host is a superset of it (every file at the same path),
  so whichever PR merges second keeps 7c9add72. The changelog top and the roadmap review lines also conflict: keep
  both patch notes, newest on top, and set "Reviewed after patch note" to the top entry's id.
