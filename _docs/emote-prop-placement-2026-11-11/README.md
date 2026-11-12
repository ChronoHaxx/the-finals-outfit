# Emote props: AnimBlueprint root overrides, curve-driven props, Blueprint child components (11 Nov 2026)

**Result: emote props now sit where the game's own data puts them.** The fixed props set rebuilds offline as
`props-8`. Its GLBs differ from the live props-7 only where a fix applies. The live site changes only when props-8 is
published, which is a separate step that needs approval.

Follows `_docs/emote-prop-transforms-2026-11-10` (PR #34, spawn-notify transforms). A Fable review on 11 Nov found
three more placement sources the pipeline ignored. It also found that the corrected props.json from that work would
place the StickAround statue twice.

## How the game places an emote prop

1. **Socket:** the emote's spawn notify attaches the prop actor to a socket on the character (usually the clip-animated
   `prop_01` / `weapon_root`, or none: the character's origin).
2. **Notify transform:** its `RelativeTransform` offsets the actor from that socket (PR #34).
3. **Actor components:** the Blueprint's component tree (SCS nodes) nests meshes, and a child can hang from a bone of
   its parent (`AttachToName`).
4. **The prop's AnimBlueprint** poses a skeletal prop, and can override bones with `ModifyBone`.
5. **Curves:** a notify with a `CurveDrivenTransformPrefix` is moved every frame by the emote's own float curves.

Steps 3 to 5 were wrong or missing.

### 1. ModifyBone: the root override

- 25 of the 33 prop AnimBlueprints end in an `AnimGraphNode_ModifyBone` on their skeleton's root bone. The weapon
  skeletons' root is `weapon_root`.
- Every one is `BMM_Replace` in component space with a constant, at alpha 1, with no pin bindings. Translation is
  always (0,0,0). Rotation is (0,0,0), except the sensu fan (roll 90), the bear plushie (pitch 90, roll 90) and the
  fencing foil (yaw −30). The laptops and TypeCat leave rotation alone.
- A root bone has no parent bone, so its component space is its local space. "Replace in component space" therefore
  means the sequence's keyed root is thrown away and the constant used instead. The prop then sits on its socket, and
  the emote clip's `prop_01` carries it.
- The animation packages key the root in character space. Forward kinematics shows the judge's paper, spyglass and
  notepad roots follow `prop_01` within 0–0.4 cm (median). The statue's root is the notify's (0,20,120) exactly. The
  turret's root is frozen at (−29, 37, 107) cm while `prop_01` moves.
- **Before:** the GLBs baked that keyed root, and a 30 cm heuristic attached six such props to the character's origin
  (`space: "component"`).
  - The turret floated in front of his chest.
  - The fan and the bear lost their constant rotations.
  - With PR #34's notify transforms, the statue would have shown twice.
- **Fix:**
  - `prop-placement.mjs` parses ModifyBone from the AnimBlueprint's class default object.
  - `build-props.mjs` bakes the override: the root node holds the constant and has no translation (or rotation)
    channel. The inverse bind matrices still come from the reference pose.
  - A two-person proxy takes its leader's override, because leader pose copies the leader's component-space bones.
  - Anything not verified is refused with a note rather than applied: a bound pin, alpha below 1, a non-root bone,
    Additive mode or another space.
  - The heuristic is gone. `props.json` records `rootOverrides` per actor.
  - The app still honours `space` for the live props-7.

### 2. Curve-driven props

- 10 notifies in 5 emotes have no socket and a `CurveDrivenTransformPrefix`: BlackSmith anvil and log, MonsterMan's two
  poles, the PilotCheckList pen, RockingChair's two guns and two effects, and the UO5 wall.
- The emote sequence carries `<Prefix>_TranslateX/Y/Z` (cm), `_RotateX/Y/Z` (degrees) and `_ScaleX/Y/Z` in the
  character's component space.
- **Order:** the curve acts as a moving socket, and the notify transform goes on top. Only that order puts MonsterMan's
  poles at ±43 cm and the RockingChair mirror gun at −49 cm against +51.
- **Euler convention:** UE `FRotator` with Roll = RotateX, Pitch = RotateY, Yaw = RotateZ.
  - Of 49 readings (6 orders × 8 sign sets, plus FRotator), it is the only one that keeps the pen rigid against the
    head within 0.01° and 0.0 cm while it is tucked behind his ear (4.4–7.6 s).
  - In the app, the pen's world position matches the UE forward-kinematics prediction within 0.5 cm.
- **Fix:**
  - `build-emote-catalog.mjs` keeps `curvePrefix`.
  - `build-props.mjs --anims <run>/anims` writes each shown window's curve into `props.json` as `curve`. It is
    converted per frame to a quaternion, kept in one hemisphere, then key-reduced to 0.1 mm / 0.1°.
  - `EmoteProps.ts` sets that copy's matrix to curve(t) × notify every frame. It is a full matrix, so the mirrored gun
    and the non-uniformly scaled wall stay exact.
  - The curves live in props.json, so the clip set doesn't change.

### 3. Blueprint child components (SCS)

- `survey-props.mjs` read only `ParentComponentOrVariableName`, which only root SCS nodes have. Children listed in
  `ChildNodes` lost their parent, and `AttachToName` (the socket on the parent) was ignored.
- **Global effects:** the Puppeteer doll lost its 0.3-scaled leader and showed life-size. CoconutRider's cans lay at the
  feet instead of on the leader's `prop_01` / `weapon_root`.
- **Chinals effects:** the PolicePTU partners' MP5s lay on the floor. The Terracotta and TaoistPriest weapon parts
  didn't ride their weapon bones.
- **Fix:**
  - The survey walks `ChildNodes` and reads `AttachToName`.
  - The builder hangs a child from the named bone of its skeletal parent. A hidden leader skeleton contributes only
    the animated bone chain down to that bone. Its nodes are prefixed (`SkeletalMesh_prop_01`) so they can never catch
    the body clip's tracks of the same name.

### Smaller fixes found on the way

- **sharp could not open texture paths of 260+ characters on Windows.** Node can, and reported them as missing. A full
  rebuild failed on that alone. Both builders now pass sharp the file's bytes. A texture that is really missing now
  fails the build instead of baking flat grey (`--allow-missing-textures` overrides).
- **`convert-clips.mjs` matches `PropAnimSequenceTime` case-insensitively.** Death_00 spells it in lowercase, so the
  Death wings ran on the spawn clock. This takes effect only when the clip set is rebuilt; see below.
- ControlRig nodes in a prop AnimBlueprint are noted as not reproduced.

## Checks (agent)

- **Reproducibility first.** The unchanged main builder (with only the path fix) rebuilds all 174 live props-7 GLBs and
  all 54 Chinals props-2 GLBs byte-identical. Its props.json differs from props-7 only by PR #34's `transform` fields.
  So every difference below is caused by these fixes.
- **GLB diff, props-7 → props-8** (`scripts/generated/emote-prop-placement-2026-11-11/diff-glbs.mjs`, `glb-semantic.mjs`):
  - 141 GLBs are byte-identical.
  - 25 change as intended. The overridden roots lost their translation channel and hold the constants, and the
    converted quaternions check out against M·R·M. The proxies gained their leader node, and the CoconutRider cans hang
    from `SkeletalMesh_weapon_root` / `SkeletalMesh_prop_01`.
  - 8 changed only in buffer layout: the same scene once accessors and images are decoded.
  - `space: "component"` actors drop from 6 to 0.
- **Chinals props-2 → props-3:** 35 identical, 7 layout-only, and the rest as intended (MP5s, weapon parts, proxy leader
  nodes). The 4 Chinals `space` props are socket-free proxies with no AnimBlueprint, so dropping the flag changes
  nothing; captures confirm it.
- **Catalog:** the regenerated catalog equals the live one apart from `curvePrefix` on exactly the 10 notifies. Its
  `clips.json` and `requests.json` are identical.
- **Survey:** 16 global and 23 Chinals components gain a parent or socket, all of them SCS children. Output is identical
  before and after the refactor into `surveyActor`.
- **Tests:**
  - `tests/prop-placement.test.mjs` (new, 7 cases): the root override and its FRotator conversion, the refusals, the
    curve axis convention, key reduction with an Euler wrap, and the SCS parents and sockets.
  - `tests/rig/emote-props.test.ts` (new case): curve × notify with a mirrored notify, interpolation and holding at the
    end, and a scene update keeping the set matrix.
  - `npm test`: 807 pass, 8 fail, 5 skipped. The 8 failures are the same missing gitignored assets as on 10 Nov
    (`SK_Body_M.glb`, cosmetics, the ski-blade fixture: ENOENT).
  - `npx tsc -b --noEmit`: PASS.
- **By eye**, full-size before/after captures with headless Chrome, 16 global emotes × 4 moments × front and side
  (`scripts/generated/emote-prop-placement-2026-11-11/pairs/`, gitignored). Each was compared with the game's emote icon.
  - **Turret:** before, it floated at one spot in front of his chest. After, it rides his arm, and at 2.67 s sits
    upright on his shoulder (icon).
  - **Bear:** on its side before; upright and held at the shoulder after (icon).
  - **Fan:** at 2.5 s the open fan sits flat over his head (icon); before, it stood on edge beside his face.
  - **MonsterMan:** one pole stacked at his feet before. After, one each side, falling outward around 5 s (icon).
  - **BlackSmith:** before, the anvil was buried in the log at his feet. After, the log stands 65 cm in front with the
    anvil on top (icon).
  - **RockingChair:** one gun on the floor before; a mirrored pair on the armrests after.
  - **UO5:** after, the wall stands at his side and he leans on it (icon); before, it was on the wrong side, through
    his raised hand.
  - **Puppeteer:** after, a knee-high doll (icon). **CoconutRider:** the cans are in the hologram partner's hands.
  - **StickAround:** identical before and after (the statue shows once, not twice). Judge's paper, notepad and spyglass
    are unchanged, as predicted.
  - **Chinals:** PolicePTU's MP5s moved from the floor to the partners' chests (about 1.2 m, measured). Terracotta,
    TaoistPriest and Campus are unchanged.
  - **Not compared with in-game footage.**
- **Fable review** (subagent, no API spend) of the build plan. Adopted:
  - prefixed leader-chain names;
  - no zero-channel animations;
  - refusing missing textures;
  - a ControlRig note.

  It confirmed that the curves are in mesh-component space.

## Fix (12 Nov): the actor's root scale

**Report.** On the live site after PR #39 the user wrote: "the jetpack still too big". This escaped defect has been
live since PR #22 (6 Nov), which shipped it as a known issue ("Jetpack too big"). PR #39 kept it, and its README
wrongly called root scale "composed".

**Cause.** In UE the actor's transform *is* its root component's transform. The spawn notify places the actor
(socket × RelativeTransform), so the root component's template `RelativeScale3D` never takes effect. `build-props`
baked that scale into the GLB's top node, and five actors carry one:

| Actor | Raw mesh | Root scale | We showed |
| --- | --- | --- | --- |
| JetPack | 14 × 100 × 41 cm (1 m fins) | 100 | about 41 m tall |
| RollerDerby skate | 31 cm long | 3 | 92 cm skates |
| PleaseHold phone (VRAthlete) | 13 × 7 cm | 3 | 40 cm |
| HoldSign tablet | 46 × 30 cm | 3 | 1.4 m |
| TurretBuddy base | 40 cm | 0.9 | 10% small (the skeletal child keeps its 0.8) |

**Why we can trust the rule:**
- Every raw mesh is already real-world size.
- Seven other actors leave the root `Mesh` empty and scale a child instead: CupidWings 0.5, SummerChair C/T, Trentila,
  CoconutRider and Puppeteer. That is the usual workaround for a root scale that doesn't take effect.
- "Only when the notify has a transform" is ruled out: PleaseHold has no notify transform.

**Fix.** `build-props.mjs` `ensureNode` leaves the root component's template scale out and records a note on the actor.
A root location or rotation, which no actor has, stops the build until it has been checked. Child components keep
their relative transforms.

**Checks:**
- The rebuild (`props-9`) changes exactly those 5 GLBs. The other 169 are byte-identical, and `emotes`/`sockets` in
  props.json are unchanged.
- None of the 5 actors' notifies carries a scale.
- Before/after captures (`rootscale-before/`, `rootscale-after/`) checked by eye:
  - jetpack on his back, a thruster beside each shoulder, as in the emote icon;
  - skates on his feet;
  - phone in the hologram's hand;
  - tablet held overhead;
  - turret about 11% larger, hands still on it.
- Fable reviewed the rule and agreed: a subagent, no API spend.
- Chinals (not live): RainCoat soil drops its root 0.35. The notify's own 0.4/0.4/0.35 gives a patch about
  53 × 59 cm; both readings are plausible. The CLittlePaint roots are 0.99999994, float noise.

**Published (12 Nov, on the user's "Yes, ship it"):**
- **Host:** `https://cf84e9b6.the-finals-outfit-assets.pages.dev/`, alias `anim-1112-root-scale`. It holds set-5
  (unchanged) plus props-9, and its manifest points at `props-9/props.json`.
- **Upload:** 7 new files (the 5 GLBs, props.json, manifest.json); 561 were already there.
- **Verification:** `verify-hosted.mjs` found all 568 files byte-identical, with the right headers and a 404 for a
  missing file. Staged at `upload/anim-20261112b/`; receipts `upload/deployment-anim-cf84e9b6.json` and
  `upload-anim-b.log`.
- **App:** `ANIMATIONS_BASE` now points at `cf84e9b6`.
- **Rollback:** `fb06038b` (props-8) and `cd858839` (props-7) are untouched.

## Not settled or not reproduced

- **Fencing foil and bows:** a ControlRig runs after the ModifyBone. The foil's −30° yaw on its reference pose is a best
  guess, and the bow's override changes nothing visible.
- ~~**Root-component scale is composed, not replaced.** JetPack's root 100 shows that the template scale survives a
  notify without a scale.~~ **Wrong; corrected 12 Nov** (see "Fix (12 Nov): the actor's root scale"). The jetpack
  rendered about 41 m tall, which the user reported on the live site.
- **`PropIndex`** (12 notifies) is read by game script, and its effect is unknown. **`bUseCharacterScale`** matters only
  for Light and Heavy bodies, which emotes don't use.
- **The live clip set-5 keeps the Death wings on the spawn clock** until clips are rebuilt with the fixed
  `convert-clips.mjs` (or the clock is shipped in props.json). **CPop_01** has `rateScale` 1.08, and its notify
  start/duration are not divided by it.
- **Latent:** `RigAnimator` binds a new emote's clip before the previous emote's props are removed. Today no prop node
  shares a body bone's name ahead of the body in traversal order, and the new leader-chain names are prefixed.
- **First shipped in props-8:** PR #34's notify transforms. props-7 never had them, so props-8 also moves every
  transformed prop, for example the Judge gavel's block from the floor to his hand.

## Publishing props-8 (published 12 Nov on the user's "just merge to live, i'll check it there")

1. Upload a new assets deployment: the live set (`manifest.json`, `set-5/` unchanged) with `props-8/` from
   `scripts/generated/emote-prop-placement-2026-11-11/props-8/` (174 GLBs + props.json, 58.7 MB). Point
   `manifest.json` → `props-8/props.json`. Never overwrite props-7 in place (immutable caching).
2. Point `ANIMATIONS_BASE` at the new deployment.
3. **App order:** the root overrides and SCS fixes are baked in the GLBs and need no app change. The curve windows need
   this branch's `EmoteProps.ts`. An older app shows them as before, at the character's origin. Merge the app first or
   together.

**Done (12 Nov):**
- **Host:** `https://fb06038b.the-finals-outfit-assets.pages.dev/`, an immutable preview deployment on the
  `the-finals-outfit-assets` project. Branch alias `anim-1112-prop-placement`, wrangler 4.131.1.
- **Staged:** `scripts/generated/emote-prop-placement-2026-11-11/upload/anim-20261112/` holds `_headers`,
  `manifest.json` (live pointer, only `props` changed), `set-5/` copied from the `cd858839` evidence copy, and
  `props-8/`. That is 569 files, 103 MB.
- **Upload:** 35 new files (the 33 changed GLBs, props.json, manifest.json). The other 533 were already on the
  project.
- **Verification:** `verify-hosted.mjs` found all 568 files byte-identical, GLB `model/gltf-binary` with CORS `*`
  and immutable caching, and a 404 for a missing file. Receipts are in the gitignored `upload/` folder
  (`deployment-anim.json`, `upload-anim.log`).
- The old host `cd858839` is untouched (props-7), so a rollback is a one-line `ANIMATIONS_BASE` revert.
- `deploy.yml` `ANIMATIONS_BASE` now points at `fb06038b`.

## Guided functional review: emote prop placement

The fix makes emote props follow the game's AnimBlueprint root override, the emote's own placement curves and
Blueprint child components. Before it, the turret floated in mid-air, the anvil was buried in its log, MonsterMan's
poles stood in one spot, and the Puppeteer doll was life-size.

- **Revision:** branch `claude/emote-prop-placement-2026-11-11` (commit recorded in the PR), worktree
  `E:\Coding\the-finals-outfit\.claude\worktrees\nervous-bhabha-fb88b1`.
- **Prerequisites:** this worktree's gitignored `scripts/generated/emote-prop-placement-2026-11-11/` (props-8 and the
  `after-set` folder), the evidence folder's local copy of the live set, and its `node_modules` junction. No internet
  is needed and nothing is published.
- **Hands-on time:** about 10 minutes.
- **Agent checks:** PASS as above. **User checks:** waived before merge on 12 Nov (see Recorded result). The live
  check is pending.

Start the preview (PowerShell, in the worktree root). Stop it with Ctrl+C.

```powershell
node _docs/emote-prop-placement-2026-11-11/serve-preview.mjs --set=scripts/generated/emote-prop-placement-2026-11-11/after-set
```

- [ ] **1. Start:** open http://127.0.0.1:5195/ and wait for the character. Expected: the default outfit idles, and
  the emote button is shown.
- [ ] **2. Who's a Good Turret?:** play it and pause around 2.5 s. Expected: the turret is held on his arm and sits
  upright on his shoulder; it moves with him. Live, it floats in front of his chest.
- [ ] **3. MonsterMan and BlackSmith:** play both.
  - MonsterMan: a pole stands on each side of him, and both fall outward around 5 s.
  - BlackSmith: a log stands in front of him with the anvil on top, and he hammers on it.
- [ ] **4. Fan Service and Bear Necessity:** play both.
  - Fan Service: around 2.5 s the open fan is held flat over his head like a hat.
  - Bear Necessity: the teddy is upright, held at his chest and shoulder.
- [ ] **5. Muertionette and CoconutRider:** play both.
  - Muertionette: the hologram doll is knee-high.
  - CoconutRider: the soda cans are in the hologram partner's hands, not on the floor.
- [ ] **6. RockingChair, then stop:** play RockingChair_s12. Expected: two miniguns, one on each armrest, mirrored.
  Then stop the emote. Expected: back to the idle, with no prop left behind.
- [ ] **7. Chinals (optional):** stop the server and start it with
  `--set=scripts/generated/emote-prop-placement-2026-11-11/chinals-after-set`. Play "警察异头动作 (police emote, working
  title)". Expected: both
  hologram partners hold their MP5s at chest height. Before, the guns lay on the floor.

If something fails, stop at that step and report its number and what happened ("1-6 pass", or "3 fails: …").

### Recorded result

- Tested revision: none before merge.
- User reported at: 12 Nov 2026, "just merge to live, i'll check it there".
- Passed / failed / untested: checks 1-7 untested. That message is an explicit waiver of the pre-merge checks and the
  authorization to publish props-8 and merge. The user will check on the live site instead.
- Readiness: merged and published on the waiver. User acceptance is still pending until the user reports results from
  the live site.
- **12 Nov, live (revision b930467, host fb06038b):** the user reported "the jetpack still too big". This is a FAIL
  outside checks 1-7. The cause and the repair are in "Fix (12 Nov): the actor's root scale". The user has not
  reported on checks 1-7. Live re-test of the jetpack: pending.

### Guided functional review: root-scale fix (props-9)

Same preview as above, with `--set=scripts/generated/emote-prop-placement-2026-11-11/after9-set`, or on the live site
once published.

- [ ] **R1. JetPack:** play it. Expected: a backpack on his back, with a thruster beside each shoulder and the
  character fully visible. Live today, a grey wall fills the view behind him.
- [ ] **R2. Rollout Rumble:** expected: a roller skate on each foot, shoe-sized. Today, two skateboard-sized skates.
- [ ] **R3. Now You Know:** expected: a tablet held overhead in both hands. Today, a frame 1.4 m across hides his
  head.
- [ ] **R4. Flashpoint:** expected: the hologram partner holds a phone-sized phone. Today, it is torso-sized.
- [ ] **R5. Who's a Good Turret?:** expected: unchanged apart from about 10% larger, hands still on it.
