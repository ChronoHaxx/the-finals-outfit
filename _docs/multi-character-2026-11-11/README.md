# Several characters in one scene: design (11 Nov 2026)

The request (11 Nov): "maybe the whole add more characters blender/3d editor mode thingy". Several contestants in
one scene, each with its own outfit, emote and pose, plus an editor mode: select a character, move and rotate it with
a gizmo, set each one's emote and time, frame the camera. Group shots and dioramas.

This is a design only. Nothing is implemented. The decisions at the end are yours.

## TLDR

- **Doable. The 3D part is not the hard bit.** The viewer already keeps every character's state in one object
  (`CharacterRig`) and every animation's state in another (`RigAnimator`); four of each in one scene is what three.js
  is built for.
- **The hard bit is the code around them.** The outfit-loading logic (about 500 lines) lives inside one React effect
  in `CharacterViewer`, the outfit picker writes straight into the one global outfit, and saved outfits autosave
  whatever that global outfit holds. Scene mode built naively would **overwrite your saved outfits**. Step 1 is a
  refactor that changes nothing on screen.
- **Cost per extra character** (measured, see "Measured cost"): about **270-350 MB of GPU memory** (raw 2048² textures are most of it) and **35-70 MB of download** (less when outfits share pieces or a face). Four characters drew at **38-58 ms a frame** on this PC while animating, against 11-14 ms for one, and a quarter of the pixels did not help: it is geometry/CPU bound, so the cap matters more than resolution.
- **MVP I recommend:** a separate **Scene** page, up to 3 characters (2 on phones), each a copy of a
  saved outfit with its own emote/time, a **floor-only gizmo** (slide on the ground, turn around the vertical axis),
  click or list to select, "frame all / frame selected" camera, scenes saved like outfits (separate store, nothing
  migrated), a **Save image** button. Scene share links and the link-preview card come after (the card needs a Worker
  deploy).
- **Never lose work:** saved outfits are not touched or migrated at all. Scenes get their own store with the same
  rules (records, journal, tombstones, keep unknown fields). Scene characters hold a copy of their outfit, so editing
  or deleting the outfit never breaks a scene.
- **Phases:** 0 measure and decide → 1 refactor, no visible change → 2 two characters on the Scene page → 3 editor
  (gizmo, picking, camera, save) → 4 sharing → 5 extras (body types, more characters, shared GPU memory).
- **Parts you could build yourself** (you're learning this): the gizmo + raycast picking, the "frame all" camera
  maths, the placement-invariance test. Each is a self-contained exercise; see the end.

## How it works today, and what assumes one character

| Where | What it does | Single-character assumption |
| --- | --- | --- |
| `src/components/CharacterViewer.tsx:437` | One `CharacterRig` in a `useMemo`; `rig.root` mounted as a `<primitive>` (`:1081`) | One rig per viewer |
| `CharacterViewer.tsx:546-1037` | The whole outfit pipeline: diff `build` against what is equipped, load source assemblies, face/hair transactions, conflicts, companions, visibility | Inside one effect, with `prev`/`companions` refs, one busy/error state, one progress bar |
| `src/store/useBuildStore.ts` | The outfit as `slot → item id` | One global outfit |
| `src/store/useSavedOutfits.ts:74` | Subscribes to `useBuildStore` and autosaves every change into the current saved outfit | Anything that writes the global outfit writes your saved outfit |
| `src/components/SlotPicker.tsx:42,135`, `OutfitBar.tsx:23` | Read and toggle `useBuildStore` directly | The picker can only edit the global outfit |
| `src/components/AnimationControls.tsx:44` | `useRigAnimator()` makes one `RigAnimator` | One animator; `__rigAnim`, `setPoseSource` are singletons |
| `src/rig/RigAnimator.ts:185` | One mixer bound to the body scene, one idle + emote, props, springs, deformation rig | Fine per character; its clip download cache is per instance (`:188-189`) |
| `src/rig/StableFrameAccumulator.ts`, `StablePreview.tsx` | Jittered, accumulated still view of the **whole scene**; reprojects when only transforms changed | `isMoving` reads one animator; anything drawn into the scene (a gizmo) gets jittered and accumulated |
| `CharacterViewer.tsx:367-395, 409-416` | Key-light shadow frustum ±1.4 m × ±1.6 m around the origin; `ContactShadows` 3 m square at the origin | Characters further than about 1.4 m from the centre lose their shadows |
| `src/rig/SharePreviewRender.ts` | Four angles of one character, framed on its pelvis | A group needs one framed view, not four turntable angles |
| `src/lib/share-url.ts`, `workers/share-preview/src/share.ts:16` | `2.` codec: one outfit; Worker validates exactly that grammar | One outfit per link and card |
| `src/rig/CharacterRig.ts:806-855` | Legacy statics: "is this near the ground" test on **world** y, head statics placed from **world** position without subtracting the bone's | Equips assume the rig root sits at the world origin, unrotated |
| Harness globals | `__rigRoot`, `__rigIdle`, `__rigAnim`, `__sourceAssembly` | One character; the visual-diff and probe scripts read them |
| Body types | `setBodyTypePreview` is per rig already, but production pins one Medium body; L/H meshes are not extracted | Per-character body type waits on the body-type project, not on this |

Things that are already fine for several characters:

- Every name lookup is scoped to a rig root (`EmoteProps`, `SpringBones`, `SharePreviewRender` use `root.getObjectByName`),
  and each mixer resolves tracks under its own body scene, so 92 bones called `pelvis` in four characters do not clash.
- `setAnimationPins` already works in rig-root space (`CharacterRig.ts:424-425`), so playback is placement-safe.
- The reconstructed shaders work in world space the way the game's do (`ReconstructedMaterial.ts:776-800`, the
  `.xzy` source-world conversion and `modelMatrix * boundsOrigin`). A turned character is lit and shaded as the game
  would shade a turned character. (wuwa-studio hit the opposite bug: its face-shadow head frame was global, so a
  second or turned character shaded wrong. Ours has no such global per-character uniform; worth one capture to
  confirm.)
- The accumulator tracks every object's world matrix and treats a transform-only change as reprojectable
  (`StableFrameState.ts:23-28`), so dragging a character reprojects instead of resetting.

## Concepts (the mechanisms, briefly)

**Scene graph and transforms.** three draws a tree of `Object3D`s. Each node has a local position/rotation/scale; its
`matrixWorld` is its parent's `matrixWorld × its own local matrix`. Put each character under its own `Group` (call it
the *placement*), and moving that group moves everything below it: body, bones, clothes, props. The rig itself never
needs to know where it stands, **as long as its own code only uses positions relative to its root**. That is the
"placement invariance" the legacy-statics code above breaks (it reads `matrixWorld`, which includes the placement).

**Instancing vs cloning vs separate loads.** Three ways to show "more of the same":

- *Instancing* (`InstancedMesh`): one draw call, one geometry, N transforms. Great for 10 000 identical rocks. Useless
  here: three's instancing does not do skinning, every character has its own pose, and the outfits differ.
- *Cloning* (`SkeletonUtils.clone`): copies the object tree but **shares** geometry and materials. Cheap in memory.
  A skinned mesh cannot be cloned with plain `.clone()`: the copy would still point at the original's bones and move
  with it. `SkeletonUtils.clone` rebuilds each skeleton from the copied bones and re-binds the mesh with the same
  bind matrices. Our rig makes clones a poor fit: materials carry per-character state (body-hide masks, tints, decal
  composites, fitting morph weights live per mesh), and a clone wearing a different outfit shares nothing anyway.
- *Separate loads*: each character is its own `CharacterRig`, built exactly as today. Memory is paid per character,
  but every existing guarantee (fitting, hides, face transactions) holds unchanged. The network is still shared:
  a second download of the same file comes from the browser's cache and the in-memory caches.

**Skinned meshes in one sentence.** Each vertex stores up to 4 (here up to 8) bone indices and weights; the vertex
shader moves it by the weighted sum of `bone matrix × inverse bind matrix`. The bind matrices freeze the pose the mesh
was modelled in, which is why rebinding (what `CharacterRig` does for every cosmetic) and cloning must preserve them.

**Gizmos and raycasting.** A gizmo is a small helper object with handles (arrows, rings). On pointer down, the
mouse position becomes a *ray* from the camera through that pixel (`Raycaster.setFromCamera`); the gizmo tests which
handle the ray hits, then on each move intersects the ray with a plane (the ground for "slide", a ring's plane for
"turn") and converts the hit point into a new position or angle. Picking a character works the same way, but testing
a ray against a **skinned** mesh is expensive and unreliable: three re-skins each vertex on the CPU for the test,
and a skinned mesh's bounding sphere is computed once and goes stale when it animates. The usual fix is an invisible
*proxy* (a capsule that follows the pelvis), which is one cheap ray test per character.

**Why the gizmo must be an overlay here.** Every frame the still view renders the scene with a sub-pixel jitter and
averages the results. A gizmo drawn into that scene would be averaged and blurred, and its handles' hash-dithered
edges would never settle. The gizmo, the selection ring and any guides belong in a second, small scene drawn on top
after the accumulator has presented its frame.

## Measured cost

Probe: `measure-character-cost.mjs` against the local dev app (`serve-5186.mjs`), headless Chrome on this PC,
1500×1000 at pixel ratio 1, vsync off. Raw results: `cost-v2.json` (`cost-v1.json` lost most download entries to
the browser's 250-entry resource-timing buffer; its GPU and frame numbers agree with v2). Hosted sizes = gzip -9 for
meshes, as released. Outfits: A = starting look; B = A with a bomber jacket and ponytail; C = B with face 03.

**Downloads**

| What | Hosted MB |
| --- | --- |
| Shared base (data indexes, body, animation manifest): paid once | 14.8 |
| Outfit A on top | 58.3 |
| Outfit B on top | 71.5 |
| A and B overlap (same face → same skin textures 19 MB, jeans, shoes) | 44.7 |
| C after B is loaded (only the face and its skin differ) | 35.2 |

So a second character costs 35-70 MB of download, less the more it shares; the big shared items are the **face's
skin textures** (skin follows the face, not the body).

**GPU memory per character** (unique textures and geometry under the rig; textures are cooked RGBA mips, exact bytes)

| | Textures MB | Geometry MB | Total |
| --- | --- | --- | --- |
| A | 216 (body + head 75) | 51 | ~267 |
| B / C | 295 (body + head 75) | 55 | ~350 |

Four characters ≈ 1.1-1.4 GB before render targets. Fine on a desktop GPU; unknown on phones (needs your phone in
Phase 0). Levers: skip the top mip for small, far characters (the cooked mip chain is in the file,
`ReconstructedMaterial.ts:300-312`, so it is a slice, ~¼ the texture memory, re-upload full for close-ups);
option B's shared body cache; GPU texture compression (biggest, but lossy against the bit-exact recovered textures).

**Draw cost** (B; three still copies cloned in beside the idling original, a lower bound)

| | Draw calls / frame | Triangles / frame | Frame ms (median, two runs) | Quarter pixels |
| --- | --- | --- | --- | --- |
| 1 character, idle | 63 | 0.57 M | 11.0 / 13.6 | 11.8 |
| 4 characters | 228 | 2.29 M | 38.1 / 58.5 | 58.6 |

Linear in characters, and **not fill-bound**: a quarter of the pixels changed nothing with four. The cost is per
object (four passes each: main, velocity, shadow, contact shadow; CPU state capture and skinning), so lowering the
resolution will not rescue a crowded scene; fewer characters, cheaper contact shadows and skipping the velocity
pass for still characters will. A still scene converges and then stops redrawing, so photos are unaffected.

## Options

### A. One full rig per character (recommended)

Each character is a `SceneCharacter` = placement `Group` → its own `CharacterRig` (exactly today's object) + its
own `RigAnimator` + an `OutfitSync` (today's effect, extracted). One canvas, one light rig, one accumulator, one
orbit camera.

- Shares: downloads (HTTP cache, the loader's in-flight dedupe, the 128 MB verified-byte cache in
  `lib/verified-bytes.ts`), compiled shader programs for identical reconstructed materials (their cache keys are
  content keys), animation clip files and emote prop templates (once their caches move to module level).
- Does not share: GPU textures, geometry and materials (per-character masks, tints, decals; the head-wrap path edits
  vertices in place, which is why each parse gets its own copy, `rig/loaders.ts:17-20`).
- Cost: memory and draw calls scale linearly; see the measurements for the cap.
- Risk: lowest. Every outfit rule that works today works the same per character.

### B. A plus a shared body/texture cache (later optimisation)

The body geometry is not edited in place (fitting is per-mesh morph weights, `SourceFitting.ts:28-45`), and every
character with the same skin uses the same skin textures. A ref-counted cache for those could save about 20 MB of body geometry and 75 MB of body/skin textures per
extra character. It needs reference counting through every `disposeObject3D` path (today a released body disposes
its geometry and textures outright, `CharacterRig.ts:577-590`, `dispose.ts`), which is exactly the kind of change that
loses textures mid-session when one path is missed. Only worth it if phones need it after A ships.

### C. Clones for "the same outfit twice"

`SkeletonUtils.clone` a finished rig: nearly free in GPU memory. But every per-character feature (a different emote
is fine, a different outfit, body type or tint is not) breaks the sharing, and the clone shares materials that the
rig mutates. Not worth a separate code path. (The measurement below uses clones only as a cheap lower bound on draw
cost.)

### D. 2D group photo (the cheap fallback)

Pose each character alone in the existing viewer, render each to an image with transparency, and arrange the images
in a 2D layout. Only one character in memory at a time, so it works on any phone. No shared lighting, no shadows
between characters, no orbiting the group. A possible phone fallback if A is too heavy there; not a diorama.

## Recommended MVP

**Scene page** at `#/scene` (the builder stays exactly as it is):

- **Characters**: up to 3 on desktop, 2 on touch devices (first guess; Phase 0 confirms). Add from a
  saved outfit, from the current builder outfit, or a duplicate of the selected one. Each holds its **own copy** of the
  outfit's slots (plus "copied from <outfit>" for display). Remove with undo.
- **Per character**: outfit (the existing picker, editing the selected character only), emote + time + paused/playing
  (the existing emote picker and timeline, for the selected one), placement (x, z, turn).
- **Editor**: select by clicking the character (capsule proxies) or its chip in a list; selected = ring on the floor.
  Gizmo restricted to the floor: two arrows for X/Z and one ring for turning (no height, no tilt, no scale: a
  contestant who floats or leans is a bug, not a feature). Keyboard: G move, R turn, Esc deselect, Delete remove
  (undoable). Snap toggle (10 cm / 15°).
- **Camera**: orbit as today; "Frame all", "Frame selected", front/three-quarter/side presets; the camera is saved
  with the scene.
- **Transport**: Play all / Pause all / "Sync" (restart every emote from 0 together); per-character time on the
  selected character's timeline.
- **Save**: scenes autosave like outfits (own list, cap stated, e.g. 30); **Save image** renders the current camera
  through the converged still view to a PNG.
- **Later, not MVP**: scene share links and the link card, body types per character, props/stands, lights.

## Data model, storage and never losing work

```ts
interface SceneRecord {            // its own store; outfit records are never touched
  v: 1; id: string; rev: number; writer?: string;
  name: string; createdAt: number; updatedAt: number; deletedAt?: number;   // tombstone, never removed
  characters: SceneCharacter[];    // at most the cap; refused past it, never evicted
  camera?: { position: [number, number, number]; target: [number, number, number]; fov: number };
  theme?: "studio" | "lobby";
  [field: string]: unknown;        // kept on every write (read-modify-write, as outfit-library does)
}
interface SceneCharacter {
  id: string;                      // stable id, so a later sync can merge character by character
  slots: Record<string, string>;   // its own copy, exactly as left (may hold ids the catalogue lost)
  labels?: Record<string, string>; // item names at save time, as saved outfits keep them
  from?: { outfitId: string; name: string };  // informational only; the scene never depends on it
  place: { x: number; z: number; yaw: number };
  pose?: { clip: string; time: number; paused: boolean } | null;
  bodyType?: string;               // reserved for the body-type stage
  [field: string]: unknown;
}
```

- **No migration of anything existing.** Scenes live in their own IndexedDB database (not a new object store in
  `finals-outfit`, which would need a version bump that another open tab can block) and their own journal key prefix.
  The same core (`lib/outfit-library.ts`) generalised to a record type, or a sibling module with the same tests.
- **Copies, not links.** Deleting or editing a saved outfit cannot break a scene; a scene character whose item left
  the catalogue keeps the id and label, shows the gap, and the rest still renders (the same "missing pieces kept" rule
  saved outfits use).
- **Scene edits never reach `useBuildStore`.** The picker and outfit bar get the outfit they edit injected (a small
  `BuildTarget` context: `build`, `toggle`, `unequip`); the builder passes the global store, the scene page passes
  the selected character. This removes the autosave-overwrite trap at the source instead of suspending autosave.
- **Save as it goes**: every add, remove, move (on release), emote change and camera "save view" is one write;
  removing a character is undoable; deleting a scene is a tombstone with undo.
- **Loss tests** before Phase 3 ships: kill mid-drag, two tabs editing one scene, an outfit deleted under a scene, an
  item removed from the catalogue under a scene, a scene written by a newer schema opened by older code.

## Sharing

- **Link (Phase 4)**: `#/scene?s=1.<character>_<character>…`, each character
  `<the 2. outfit codes>~<x>,<z>,<yaw>[~<clip>@<t>[p]]` with centimetres and degrees as integers. About 50-80
  characters per contestant, so four fit easily. Opening a scene link opens an unsaved draft, exactly like an outfit
  link does today.
- **Card (Phase 4, needs your OK for the Worker deploy)**: one wide view from the scene's camera instead of four
  turntable angles; the Worker gains a second grammar (`s=`) beside `o=`. Until then, scene links share without a card.
- **Save image (MVP)**: no network, no Worker.
- **Export 3D (dev panel)** stays per character; a scene export (several rigs in one glb) is a later, separate change.

## Risks

| Risk | Why | Mitigation |
| --- | --- | --- |
| Saved outfits overwritten from scene mode | autosave watches the global build | `BuildTarget` injection; a test that scene edits never change `useBuildStore` |
| Refactor changes the builder | the outfit effect has years of edge cases (face/hair transactions, conflicts, companions) | Phase 1 is a pure extraction verified by the existing scenario checks and visual-diff before any scene code |
| Statics misplaced on a moved character | world-space code in `CharacterRig` equip paths | Placement-invariance fix + a test: equip every slot kind under a moved/turned placement, compare root-relative matrices with an equip at the origin |
| GPU memory on phones | linear per character; context loss already handled by remounting | Cap per device class, load characters one at a time, measure in Phase 0, reload sequentially after a context loss |
| Frame time | accumulator, velocity pass, shadows and contact shadows all draw every character | measured lower bound below; graphics presets already lower resolution; contact shadows can run less often |
| Shadows cut off | fixed ±1.4 m frustum at the origin | fit the key light's frustum and the contact-shadow plane to the group's bounds each change (sharper shadows when characters stand close) |
| Gizmo blur / never converging | drawn through the accumulator | overlay scene after the still view |
| Shader compile hitches | tinted legacy materials compile one program each (`CharacterRig.ts:2176`, `tintUid`) | reconstructed ones share programs; load characters sequentially; `compileAsync` |
| Harness contracts | `__rigRoot`/`__rigIdle` are single-character | keep them meaning the builder's one character; scene gets `__scene` |

## Phased plan

0. **Measure and decide (this doc).** Remaining measurements before Phase 2: a real second rig on a phone (memory,
   frame time), and a turned-character capture of a face and a cel item.
1. **Refactor, no visible change.** Extract `OutfitSync` from `CharacterViewer`; `BuildTarget` context for the
   picker and outfit bar; animator clip and prop caches to module level; placement-invariance fixes and test. Checks:
   existing tests, scenario captures and visual-diff identical before/after.
2. **Two characters on `#/scene`.** Scene store (memory only), placement groups, per-character animator and
   `OutfitSync`, sequential loading with per-character progress, accumulator `isMoving` over all animators, shadow
   frustum fitting. Checks: frame time and memory with 2 and the cap, both themes.
3. **Editor.** Overlay scene, floor gizmo, capsule picking, selection list, camera presets and frame all/selected,
   transport, persistent scene library with loss tests, Save image, phone layout. Then your functional checklist.
4. **Sharing.** Scene links (no Worker change), then the scene card (Worker change and deploy, your OK).
5. **Extras.** Per-character body type (when the body-type production control exists), more characters, the shared
   body/texture cache (option B) if phones need it, scene Export 3D.

## Decisions for you

1. **Scope**: the MVP above, or smaller first (Phase 2 only: two characters side by side, no gizmo, fixed spots)?
2. **Where**: a separate Scene page (recommended), or a mode toggle inside the builder?
3. **Cap**: 3 on desktop / 2 on phones, or another number?
4. **Outfit link**: scene characters hold a copy (recommended), or stay linked to the saved outfit and follow its edits?
5. **Gizmo**: floor-only (recommended), or full move/rotate in 3D?
6. **Sharing**: links + Save image first and the Worker card later (recommended), or the card from the start?
7. **Who builds what**: which of the learning parts below you want to do yourself.

## Parts you could build yourself

Each is small, self-contained and teaches one mechanism; I'd set up the surrounding code and a check that tells you
when it works.

1. **Floor gizmo + picking** (raycasting, planes, pointer capture, why it must not fight OrbitControls). Done when you
   can drag a character along the floor and turn it, and orbiting still works.
2. **Frame all** (bounding boxes, field of view, `distance = radius / sin(fov / 2)`). Done when every character fits
   the view from any orbit angle.
3. **Placement-invariance test** (scene graph, local vs world matrices). Done when the test fails on today's
   legacy-statics code and passes after the fix.
4. **Shadow frustum fitting** (orthographic shadow cameras, texel density). Done when shadows stay crisp for two
   characters close together and still exist for four spread out.

## Plan review

Not done yet: the Fable plan review (authorised until 14 Nov) ran out of time in this session. Run it on this doc before Phase 1.
