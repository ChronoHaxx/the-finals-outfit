# Emote props: spawn-notify transforms and socket bones (10 Nov 2026)

**Result: emote props now sit at the game's size, angle and offset, and props on bones the body lacks attach to
them, not the character's feet.** The defect was found while running the Chinals emotes. It also affects the live
global site, but the live site only changes once a corrected `props.json` is published, which is a separate step
needing approval.

## The defect

- **Dropped transform.** The game spawns emote props with `AnimNotifyState_DiscoverySpawnProp`. Its
  `RelativeTransform` places the prop relative to its socket.
  - `build-emote-catalog.mjs` kept it, but `build-props.mjs` dropped it when writing `props.json`, and
    `src/rig/EmoteProps.ts` applied nothing.
  - **Global (live, assets host `cd858839`):** 122 of 290 spawn notifies carry a transform, 118 of 289 `props.json`
    windows. 64 of those are on props the site shows.
  - Examples:
    - Dragon-Backed's throne turned 90° with the character behind its armrest.
    - Matcha Point's tea table under the knees.
    - Witch Way's broom backwards.
    - Sudden Lounge's side table inside the deckchair.
    - Core Slinger's three target cans as one can on the floor.
    - Rocking Chair's mirrored second minigun (scale −1) missing.
  - **Chinals (not published):** 27 of 82; the footballs were 6× too big, the chairs and mirrors turned 90°.
- **Missing socket bones.** `convert-clips.mjs` added only `weapon_buffer`, `weapon_root` and `prop_01` to the rig.
  - A prop on any other master-skeleton bone fell back to the character origin.
  - Chinals cases: `weapon_belt_01`, `weapon_dynamic_part_attach_01`, and `ik_hand_l` (whose parent `ik_hand_root`
    hangs under the root).
  - None in the live global set.

## The fix

- **`scripts/anim-export/notify-transform.mjs`** (new): converts the RelativeTransform to the app's frame with the
  same per-axis mirror as every bone and vertex.
  - M·X·M with M = diag(1, −1, 1): translation (x, −y, z)/100, rotation (−x, y, −z, w), scale unchanged.
  - Identity parts are left out.
- **`build-props.mjs`** writes it per window as `transform`.
- **`src/rig/EmoteProps.ts`** sets it on each spawned copy.
  - Never on the shared socket node or the template: several props share a socket, and the template is reused by
    every later spawn.
  - A `props.json` without `transform` (the live one) behaves exactly as before.
- **`convert-clips.mjs --props <dir>`** also adds the bones that shown props' sockets name, with their missing
  ancestors, parent first.
  - A bone under the root needs no frame fix of its own, because the root's local is P × conv(UE local), so P is a
    left factor (pelvis already passes that check).
  - The old guard against bones under the root is removed.
- **`scripts/anim-export/add-notify-transforms.mjs`** (new) adds the transforms to an already-published `props.json`
  from the sequences' JSON, without rebuilding the GLBs. The global build folders no longer exist.
  - Each window is matched to its notify by actor and start time.
  - Any unmatched window fails the run: all 289 live windows matched.

## Checks (agent)

- **Type check:** `npx tsc -b --noEmit` PASS.
- **Tests:** `npm test` 747 pass, 8 fail, 5 skipped. The 8 need assets this worktree doesn't have: the extracted
  ski-blade fixture and `public/models/body/SK_Body_M.glb` (ENOENT). They are unrelated.
- **`tests/rig/emote-props.test.ts`** (new case):
  - A transformed and a plain spawn of one actor on one socket.
  - The shared socket bone stays untouched.
  - The chain under the root attaches.
  - It fails on the unfixed `EmoteProps.ts` (checked) and passes with the fix.
- **`tests/notify-transform.test.mjs`** (new): identity handling, and the converted matrix equals M·X·M for real
  notifies, including non-uniform (RainCoat 0.4/0.4/0.35) and negative (Rocking Chair −1) scale.
- **Fable plan review:** thread 776570ce, $1.54. It confirmed the socket × notify × actor composition and the
  conversion. It narrowed the attach bones to the ones sockets actually use. It asked for the notify-property dump
  and the IK check below.
- **Notify properties:** all 82 Chinals spawn notifies' properties were listed, to look for anything else dropped.
  - `bUseCharacterScale` (70×) matters only for the Light/Heavy bodies, which emotes don't use yet.
  - The end-of-notify physics behaviour is already listed as not reproduced.
- **IK bone:** `ik_hand_l` follows `hand_l` within 0.3 cm over the Botanist clip, so the baked IK track is safe to
  attach to.

### By eye (`scripts/generated/emote-prop-transforms-2026-11-10/`, gitignored)

- **Global:** 12 live emotes, live `props.json` versus corrected, front and side: `compare-front-*.png`,
  `compare-side-*.png`.
  - The live clips and models load from the assets host through the local preview's read-only proxy; only
    `props.json` is local.
  - Clear corrections in Dragon-Backed, Matcha Point, Witch Way, Sudden Lounge, Core Slinger, Hold Sign and Rocking
    Chair.
  - Death's skulls rise 1 m (plausible, unverified).
- **Chinals:** 15 emotes, `chinals-fixed-review-0*.png`.
  - The chair is upright with the character seated, the wok level, the ball normal-sized, the drum in front, the
    mirror held up, the cup upright, and the box in the hand.
  - Baseball and Plague Doctor are unchanged controls.
- **Not compared with in-game footage.**
- **One unsettled semantic:** the RainCoat soil's root-component scale 0.35 is *composed* with its notify's 0.4
  (UE's default spawn scaling, and what the GLBs did before). If the game replaces it instead, the soil should be
  2.9× bigger.

## Publishing the live correction (not done; needs approval)

1. Make a corrected copy of the live `props.json`:
   `node scripts/anim-export/add-notify-transforms.mjs --props <live props-7/props.json> --json scripts/generated/emote-prop-transforms-2026-11-10/json-global-seqs --out <props-8>/props.json`
2. Ship it in a new assets deployment, with the same GLBs and `manifest.json` → `props-8/props.json`.
3. Point `ANIMATIONS_BASE` at the new deployment.

The app change must be live first or together; it is backward compatible either way.

## Guided functional review: emote prop transforms

The fix places each emote prop where the game's spawn notify says. Before it, footballs were 6× too big, thrones and
chairs were turned 90°, and side tables sat inside the chair.

- **Revision:** branch `claude/emote-prop-notify-transforms-2026-11-10` (commit to be recorded when committed),
  working tree of `E:\Coding\the-finals-outfit\.claude\worktrees\stoic-golick-17e361`.
- **Prerequisites:** this worktree, which has two things outside this PR:
  - the preview server `_docs/chinals-intake-2026-11-06/emote-pilot/serve-5190.mjs` (untracked Chinals docs);
  - the gitignored `scripts/generated/` sets.

  Also its `node_modules` junction, and internet access to the live assets host. Nothing is published.
- **Hands-on time:** about 10 minutes.
- **Agent checks:** PASS as above. **User checks: PENDING.**

Start the preview (PowerShell, in the worktree root). It serves this branch's app; the global clips and models come
from the live host, with only the corrected `props.json` local:

```powershell
node _docs/chinals-intake-2026-11-06/emote-pilot/serve-5190.mjs --set=scripts/generated/emote-prop-transforms-2026-11-10/global-set --proxy=https://cd858839.the-finals-outfit-assets.pages.dev/
```

Stop it with Ctrl+C.

- [ ] **1. Start:** open http://127.0.0.1:5190/ and wait for the character. Expected: the default outfit idles; the
  emote button is shown.
- [ ] **2. Dragon-Backed:** open the emote picker and play "Dragon-Backed". Expected: the golden throne faces you
  and the character sits on its red cushion. On the live site it is turned sideways with him behind the armrest.
- [ ] **3. Matcha Point and Witch Way:** play both. Expected: the tea table stands in front of the kneeling
  character, not under his knees. The broom's bristles trail behind him.
- [ ] **4. Ordinary emote:** play "Boomerang", then stop the emote. Expected: the boomerang is in his hand (now 2×
  larger, per its notify), and stopping returns to the idle with no prop left behind.
- [ ] **5. Chinals set:** stop the server, then start it with `--set=scripts/generated/chinals-emotes` (no
  `--proxy`). Play "颠球 (Keepy-Uppy)" and "Applause". Expected: a normal-sized football at his feet, and an upright
  office chair he sits on.

If something fails, stop at that step and report its number and what happened ("1-5 pass", or "3 fails: …").

### Recorded result

- Tested revision: pending
- User reported at: pending
- Passed / failed / untested: pending
- Readiness: pending. Merge and publishing authorization: not given.
