# Facial animation (12 Nov 2026)

Faces now animate with the body, in idles and emotes, using the game's own data: blinks, eye looks, jaw, brows and
expressions. Head-wrapped items (beards, balaclavas, mouth scarves) follow the face. Items that mask the face in the
game (helmets, balaclavas, scarves) damp it the same way. Branch `claude/facial-animation-2026-11-12`.

## How the game does it

Everything here was read offline from the installed Season 12 paks and the UE 5.7 source. Nothing touched the running
game.

- **Curves.** Every body clip carries float curves named after face poses (`Face_Blink`, `Face_LookLeft`,
  `Face_JawOpen`, `Face_Happy`, ...). 189 of the 190 clip files have them.
- **Head AnimBP.** The head runs `MABP_Head_Headmaster`:
  1. CopyPoseFromMesh copies the body's pose and curves.
  2. A `FacialAnimation` layer runs a PoseBlendNode: each curve, clamped to 0..1, weights the same-named pose of the
     head's PoseAsset (the head data asset's `FaceRigPoseAsset`).
  3. A distance LOD (2.5) switches the layer off away from the camera. That is why faces only animate up close in
     game. The viewer is always close, so here it always runs.
- **Poses.** A pose is ADDITIVE: local-space deltas on the head's ~300 `FACIAL_*` bones. There are no expression morph
  targets; bones alone move the face.
- **Composition.** UE composes poses in pose order:
  - the rotation becomes nlerp(identity, delta, w) × R;
  - translations add up;
  - nothing is normalised across poses.
- **Masks.** An item can set `bMaskOutFacialAnimation` and name a bone weights asset (`FaceAnimationWeights`). The
  layer takes it as its dynamic bone weights (Angelscript `FacialAnimationMask`). Each FACIAL bone then keeps only
  that weight of its facial motion. There are six masks:

  | Mask | What it keeps | Used by (examples) |
  |---|---|---|
  | `EyesOnly` | the eyes and lids | helmets, knight mask, empress mask |
  | `FaceMask` | the eyes; lips, jaw, cheeks and brows at 0.5 | balaclavas, combat helmets, luchador |
  | `FaceMaskLowerFace` | the upper face fully; the lower face at 0.5 | mouth scarves, samurai mask |
  | `UpperFace` | the upper face; the mouth not at all | streetwear face masks |
  | `MouthJaw` | (Phantom mask) | Phantom mask |
  | `EyesAndSomeFace` | the eyes, part of the face | hood wrap |

  Before the masks existed here, a smile pushed the lips through the balaclava.
- **Wrap cages.** Head-wrapped parts follow the worn face's `*_Wraps` cage: a 439-vertex skinned mesh that the
  facial bones deform like the face.

## What ships

**Data:** `faces-1/` in a new animations deployment, built by `scripts/anim-export/build-face.mjs`.

| Folder | Contents |
|---|---|
| `poses/` | 27 PoseAssets, in UE convention, FACIAL bones only |
| `heads/` | 34 heads: pose asset plus the UE reference local of every driven bone |
| `curves/` | 189 clips' face curves: clamped, key-reduced, canonical names |
| `wraps/` | 31 cage skins, all 8 influences per vertex (`MeshDump.cs` now writes `jointsAll`/`weightsAll`) |
| `masks/` | the 6 bone weight assets |

The manifest gains `faces`. In total: 288 files, 15 MB, most of it pose assets. A visitor downloads only their head's
pose file, the curves of the clip that plays, and their cage skin and masks.

**Runtime:**
- `src/rig/FaceAnimator.ts`: curves → pose weights → UE's additive evaluation → masks.
  - Each head is checked against its reference before it is driven, so a mismatched head stays still instead of
    distorting.
  - The bones use two axis conventions: S for legacy GLBs, P for source extension bones. Each delta converts in its
    parent's frame.
- `src/rig/FaceWrap.ts`: skins the cage on the CPU by the FACIAL bones relative to the head. The part's own skinning
  already follows the head, so only the face's motion is added on top.
- `CharacterRig.ts`: re-wraps each worn wrapped part on the moved cage.
- `HeadWrap.applyHeadWrap`: now allocation-free and bit-identical (tested), so still renders cannot change.
- Masks come from the worn items' published definitions (`SourceAssembly.loadSourceFaceMask`), the same files the
  outfit is assembled from.
- `RigAnimator` drives the face after the clip and the deformation rig, every frame and in every hold (pause, scrub,
  seek). `play()` waits for the face data, so a held frame is exact.

**Determinism.** Nothing runs while no clip plays. The automated harness starts still, so still renders and
`capture.mjs` captures are unchanged. Captures that play a clip (`?anim=`, `__rigAnim.play`) now include the face.
`?face=0` turns it off for comparisons.

## Verification (agent)

- `tsc -b --noEmit` passes. `npm test`: 815 pass. 8 fail, the same without this change: they need extracted GLBs that
  this worktree lacks (`public/models/...`, the ski-blade fixture).
- New tests, `tests/rig/face-animator.test.ts`:
  - curve sampling and crossfade weights;
  - the UE composition order, against a hand computation;
  - the S/P conventions, with Face 01's measured FacialRoot numbers;
  - refusing a mismatched or re-parented bone;
  - mask inheritance and minimum;
  - cage skinning equals linear blend skinning, and the head's own motion adds nothing;
  - the head wrap is bit-identical to its previous code.
- **Looked at full size** (`evidence/`, captured headless with `scripts/anim-export/capture-face.mjs` and
  `single-poses`):

  | Sheet | What it shows |
  |---|---|
  | `emotes.jpg` | Take a Bow happy, Boxer furious, Wolf Mask surprise, blue steel, sad; Matcha's jaw is behind the cup |
  | `faces-and-routes.jpg` | Faces 20, 18, 30 and CNS (legacy route) |
  | `single-poses.jpg` | each pose alone: LookLeft goes to the character's left; WinkLeft closes the left eye |
  | `beard-moved-vs-still-cage.jpg` | the beard opens with the jaw; on a still cage it covered the open mouth |
  | `balaclava-unmasked-moved-vs-still.jpg` | why the mask matters |
  | `balaclava-with-game-mask.jpg` | clean, except a pin of lower lip at JawOpen = 1, a weight no clip reaches (Matcha's peak is 0.43) |
  | `played-*.jpg` | real `play()`: masks from the live definitions (EyesOnly, FaceMaskLowerFace, FaceMask) |

- **Cost per frame** (desktop, headless):

  | Worn | Cost |
  |---|---|
  | face alone | 0.1-0.2 ms |
  | balaclava (1k vertices) | 0.3 ms |
  | full beard (37k vertices, re-wrapped every frame) | 1.6 ms |

## Known gaps

- The distance LOD is not replicated: faces always animate.
- The mask blend time (0.2 s) is not reproduced.
- When two masked items are worn, each bone takes the smaller weight. The game holds one mask, and which one wins is
  decided in Angelscript that we cannot read.
- Some clips and faces carry nothing to play:
  - `Face_Suprise` (a misspelling in the clips) matches no pose and is dropped, as in the game;
  - TapDance has no face curves;
  - blank faces, statues and the skull have no face rig and stay still, as in game.
- At JawOpen = 1 a pin of lip can show through a balaclava. That weight does not occur in the clips.
- The beard re-wrap costs about 1.6 ms per frame on desktop; phones not measured.

## Hosting

Uploaded 12 Nov with the owner's yes: **`https://e5250f94.the-finals-outfit-assets.pages.dev/`**, a new immutable
Cloudflare Pages deployment (branch alias `anim-1112-faces`, wrangler 4.131.1). `deploy.yml` now sets
`ANIMATIONS_BASE` to it; the previous host, `cf84e9b6`, stays untouched.

- **Contents:** 857 files, from `scripts/generated/face-anim/upload/anim-20261112-faces1/`. That is the live
  `cf84e9b6` (`set-5`, `props-9`, `_headers`, byte-identical to the uploaded `anim-20261112b`) plus `faces-1/`. The
  manifest differs from the previous one by the `faces` line only. Cloudflare took 289 new files; the other 567 were
  already stored.
- **Receipts** in `publish/`:
  - `upload-anim.log`;
  - `deployment-anim.json`: all 856 files byte-identical (`_headers` is applied, not served), CORS `*`, immutable
    caching, a missing file returns 404;
  - `prod-check.json` (from `prod-check.mjs`): a production build at `/the-finals-outfit/` loads `faces-1` from the
    host and holds Take a Bow on a balaclava and Evil Jester on a beard. Face posed, cage moved, FaceMask applied, all
    face requests 200, no errors.
- **To publish again:** stage a new folder, then run from the worktree root, in Git Bash:
  1. `node /c/Users/ChronoHax/AppData/Local/npm-cache/_npx/c4e09ea4da0c6ba2/node_modules/wrangler/bin/wrangler.js pages deploy <folder> --project-name the-finals-outfit-assets --branch <alias> --commit-dirty=true`
  2. `node _docs/showcase-animation-2026-11-05/publish/verify-hosted.mjs <folder> <host>/`
  3. Bump `ANIMATIONS_BASE`.
- **PR #47 (emote sounds)** also needs a new animations deployment and edits `RigAnimator.ts` and
  `AnimationControls.tsx`. Its conflicts with this branch are additive: faces beside sounds in the manifest type,
  constructor options and header comment. Whichever PR merges second must rebase, and must upload one deployment that
  holds both `faces-1/` and the sounds.

## Advice

On 12 Nov Fable (thread `4e17a1a2`, $2.91) reviewed the integration plan before implementation. Adopted from it:
- skip stopped actions, whose stale weights broke paused frames;
- bind explicitly after the still pose is recorded, and record the rest on every bind;
- restore in the stop branch and in `reset()`;
- check each head's bones against its reference and refuse a mismatch;
- collect bones by identity, not by name;
- redraw a held frame when late data arrives;
- add `?face=0`.

Its pose-combination formula, given from memory, differs from UE 5.7's `PoseAsset.cpp`. The source is what this code
follows: sequential nlerp-from-identity per pose.

## Functional checklist (user checks: PENDING)

- **What you are checking:** faces animate during idles and emotes; wrapped beards and balaclavas follow; masked
  items damp the face as in game; stopping returns everything to rest.
- **Test this revision:** the PR's head commit on `claude/facial-animation-2026-11-12`, with the local `faces-1` data.
- **Open:** a dev server from this worktree. In Git Bash, at
  `E:\Coding\the-finals-outfit\.claude\worktrees\determined-goldberg-587518`, run:
  `bash scripts/generated/face-anim/serve.sh`
  Then open the links below in Chrome. Stop the server with Ctrl+C.
- **Prerequisites:** none beyond this worktree; game assets come from the live hosts.
- **Hands-on time:** about 10 minutes.
- **Agent checks:** PASS (above).

The links:
- Plain: `http://127.0.0.1:5193/?reconstructed=1&outfit=1.eyJzbG90cyI6eyJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UifX0`
- Beard: `http://127.0.0.1:5193/?reconstructed=1&outfit=1.eyJzbG90cyI6eyJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmYWNpYWxIYWlyIjoiZmFjaWFsaGFpcnMtYmVhcmRmdWxsLWJsYWNrIn19`
- Balaclava: `http://127.0.0.1:5193/?reconstructed=1&outfit=1.eyJzbG90cyI6eyJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmYWNld2VhciI6InN0cmVldHdlYXItYmFsYWNsYXZhLWNvdHRvbi1ibGFjayJ9fQ`
- Helmet: `http://127.0.0.1:5193/?reconstructed=1&outfit=1.eyJzbG90cyI6eyJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJoZWFkd2VhciI6Im1pbGl0YXJ5LWNvbWJhdGhlbG1ldC1wbGFzdGljLWJsYWNrIn19`

The checks:

- [ ] **1. Idle face.** Open the Plain link and zoom onto the face while the idle plays. Expected: the eyes blink and
      glance left and right; the brows and mouth move a little. With `&face=0` added to the link, the face stays still.
- [ ] **2. An emote expression.** Add `&anim=take-a-bow&animTime=1.2` to the Plain link. Expected: the emote is paused
      at 1.2 s with an open smile showing teeth. With `&face=0` added, the face is neutral.
- [ ] **3. Beard follows the jaw.** Add `&anim=evil-jester&animTime=1.3` to the Beard link. Expected: the mouth is
      open; the moustache stays above the upper lip and the beard below the lower lip; no beard hangs across the
      mouth.
- [ ] **4. Masks.** Add `&anim=take-a-bow&animTime=1.2` to the Balaclava link. Expected: the smile shows only as a
      soft stretch of the fabric; no cheek or lip pokes through. Then open the Helmet link and play any emote.
      Expected: only the eyes move behind the visor.
- [ ] **5. Stop and pause.** On the Beard link, play an emote from the Emotes menu, pause mid-way, scrub, then stop.
      Expected: the face and the beard follow every scrubbed frame; after stopping, both are back to rest (no open
      mouth or stretched beard left behind).
- [ ] **6. Change face mid-emote.** While an emote plays, pick another face (for example Face 20) in the items drawer.
      Expected: the new face animates too; nothing stays distorted.

If something fails, stop at that step and report its number and what happened ("1-6 pass", or for example "3 fails:
the beard covers the mouth").

### Recorded result

- Tested revision/build: the dev server on this worktree at `2633919`, serving the local `faces-1` (the same files
  as the hosted `e5250f94`).
- User reported at: 12 Nov 2026, verbatim: "icl i only tested 1 but i trust u, just merge to live/deploy".
- Passed / failed / untested step numbers: 1 tested by the user (no failure reported); 2-6 not tested by the user.
- Explicitly waived checks: 2-6, by the user in the same message.
- Agent cover for the waived steps:
  - 2-4: the captures in `evidence/` (played emotes, beard, balaclava, helmet);
  - 5 and 6: re-checked headless before merging (`publish/check-stop-and-swap.json`, PASS).
    - Step 5: a held frame and a seek move the beard and the face; stopping restores both bit for bit.
    - Step 6: changing Face 01 to Face 20 mid-emote binds and animates the new head, with no errors.
  - Real-device behaviour is unverified.
- Readiness: check 1 user-tested; checks 2-6 explicitly waived.
- Merge authorization: given by the user on 12 Nov ("just merge to live/deploy").
