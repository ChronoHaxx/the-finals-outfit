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

**Runtime:** no code change: `FaceAnimator` already drives whatever faces index the manifest names.
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

All on the branch after merging main 96bf586 (code revision ee16736), 21-22 Nov 2026.

- **Rig and curves:** `tools/compare-rigs.mjs` (above): 25/25 pose assets byte-identical, 32 heads within 0.0001 cm.
- **Real app, local files** (`capture-chinals-faces.mjs` against `serve-preview.mjs` serving the staged host), then
  **again against the hosted deployment 7c9add72** (every face file loaded from it, all 200). Looked at full size,
  facial animation on and off at the same frame:
  - Unrivaled Master 3.2 s: open "O" mouth, raised brows (off: neutral); Lucky Touch (Mahjong) 3.37 s: brows down,
    eyes narrowed, lips pressed; Cute Cat 2.3 s: fear squint; Duanwu 2.37 s: jaw open; World Cup goalkeeper 2.13 s:
    snarl; the Chinals idle blinks.
  - Face 20 (another rig, eyelashes) smiles with teeth in Gacha 01 at 9.67 s.
  - Full beard: follows the open jaw (wrap cage). Balaclava: the face mask damps the face; no lip pokes through.
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
