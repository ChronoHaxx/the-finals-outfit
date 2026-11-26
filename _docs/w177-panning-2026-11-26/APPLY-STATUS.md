# w177 apply status (22 Nov 2026, main-folder session for the coordinator)

## Step 1: base check — passed (after a false alarm)

The APPLY.md `cmp` loop printed CHANGED for 5 files: build-materials.py, check-webgl.mjs, material_inputs.py,
prepare-large-sneakers.py and test_translation.py. None of them had a real edit.

- The main checkout has `core.autocrlf=true`, so `git show 9f7bddf:…` prints the stored blob with LF endings.
- Those 5 files are CRLF in the main checkout.
- Ignoring CR, all 9 files are identical to the snapshot. Each of the 5 is larger by exactly one byte per line.
- The other 4 (the hologram_* files) are LF on disk and compare equal byte for byte.

For future runbooks: compare `tr -d '\r'` on both sides, or the CRLF files will always look changed.

## Step 2: back up and copy — done, checks pass

- `before/` holds the 9 original files with SHA256SUMS, verified with `sha256sum -c`.
- The 12 files were written from `claude/w177-panning-contract`. Each one keeps the line endings of the file it
  replaces: the 5 files above stay CRLF; the others, and the 3 new files, are LF as on the branch. Each was checked
  equal to its branch blob, ignoring CR.
  - The w177 worktree is checked out on `claude/w177-panning-runtime`, so the files came from the contract branch
    via git, not from that worktree's working copy.
- Records were copied from the branch: README, APPLY, fable-plan-review and evidence/. PLAN-v1.md was already
  identical.
- `run_hologram_tests.py scripts/shader-probe test_hologram_contract`: 35/35.
- `floating_gate.py scripts/shader-probe`: identical to evidence/floating-gate-snapshot.txt (7 instances).
- `smoke_panning.py scripts/shader-probe cpu`: both instances 24 cases, maxError 0 (as in the README table).

## Step 3: batch — BLOCKED at the source stage

What ran:
- `ids.json` lists the two items.
- Fresh drift `drift/v1`: both identical.
- `neutral-drift.py` (a copy of w152's with the folder changed): no neutral entries.
- `prepare-cohort.mjs` (a copy of w172's; NAME `w177-panning`, T = this folder, so the records stay here): 2 rows,
  0 skipped.
- `batch-attached.json` was written by the preparer.
- `run-v1.sh` is a copy of w172's with the names changed.

What failed: `run-v1.sh` exits 1 in the source stage at `parents-02`. See `batch-attached-source.out` and
`scripts/generated/shader-probe/w177-panning-v1/source/parents-02.log`. The failed run is kept.

Cause: the game's containers were rewritten on **17 Nov 2026** (pak `lastWriteTimeUtc`; a game update). The source
probe still uses the 12.00 usmap (sha E5B29E28…). With it, CUE4Parse can no longer read the root materials:
- `M_Character_Layered`: "Unknown property with value 159";
- `M_Character_8Layers_Master` and `M_Character_PlasticSheet` also export 0 shaders.

The drift gate (data assets only) still reads. The w172 batch ran on 11 Nov, before the update.

This blocks every fresh material extraction, not just w177. Options (not chosen here):
1. A usmap for the 17 Nov build, as the community 12.00 map was for Season 12 (w69-s12-schema).
2. Run the batch on the pre-update w172 source exports, which the w177 contract was verified against. That mixes
   builds, so it needs the owner's sign-off.

Steps 4 (review) and 5 (index apply) have not started. The active `public/models/reconstructed-assemblies-v1`
index is untouched.

## Step 3b: per-package proof for the pre-update files — no item qualifies (22 Nov 2026)

Decision (coordinator, 22 Nov): the user chose "Use proven pre-update files". Use w172's 11 Nov source copies only for
packages proven identical to today's 17 Nov containers, either:
- (a) byte-identical package bytes, or
- (b) an identical export where the 12.00 usmap still reads today's package.

Skip and list everything else. Write no mixed data.

Proof: `prove-prepatch.py` (read-only over both runs) wrote `prepatch-proof-v1.json`, with sha256 values and diff
fields per package; console output is in `prove-prepatch.out`. Both runs saved each material's raw `.uasset`, so (a)
compares real package bytes. Today's run read 13 packages; w172 read every one of them.

| Package | Call | Verdict | Evidence |
|---|---|---|---|
| SK_Streetwear_SportsJacketHologramStrip_M | meshes-01 | proven (b) | mesh, properties and colour-evidence exports identical |
| MI_Streetwear_VaporWaveGlasses_Plastic_CNSS7SP | materials-01 | proven (a) | package sha 696d9a08… both runs |
| MI_SportsJacket_SportsJacket | parents-01 | proven (a) | package sha 3c29e6a6… both runs |
| MI_Character_PanningHologram_Ospuze | materials-01 | skip | bytes differ; shader map ResourceHash ×2 + library indices; SM6 pixel changed (SM5 pixel + uniforms identical) |
| MI_Character_PanningHologram_VaporWaveVisor_CNS | materials-01 | skip | as the Ospuze row |
| MI_SportsJacket_SportsJacket_TranslucentOspUze | materials-01 | skip | bytes differ; ResourceHash ×2; SM5 and SM6 pixel changed |
| MI_Casual_SlimTankTop_NylonEmissive_OspUze | materials-01 | skip | bytes differ; ResourceHash ×6; SM5 and SM6 pixel changed |
| MI_Character_4Layers | parents-01 | skip | bytes differ; ResourceHash ×8, CookedShaderMapIdHash ×8; SM5 and SM6 pixel changed |
| MI_Character_Layered_2 | parents-01 | skip | bytes differ; ResourceHash ×6; SM5 and SM6 pixel changed |
| M_Character_PanningHologram | parents-01 | skip | bytes differ; today's read is a **silent misread** (see below) |
| M_Character_PlasticSheet | parents-02 | skip | bytes differ; unreadable today |
| M_Character_8Layers_Master | parents-02 | skip | bytes differ; unreadable today |
| M_Character_Layered | parents-02 | skip | bytes differ; unreadable today |

Not compared: textures and the glasses mesh. Today's run never reached them, and the result is already decided without
them.

**Item result: both items are skipped and nothing was built.**
- `streetwear-sportsjacket-translucentospuze` needs these skipped packages:
  - MI_SportsJacket_SportsJacket_TranslucentOspUze;
  - M_Character_PlasticSheet;
  - the Ospuze PanningHologram MI and its parent.
- `streetwear-vaporwaveglasses-plastic-cnss7sp` needs these skipped packages:
  - MI_Character_4Layers;
  - M_Character_8Layers_Master;
  - the CNS PanningHologram MI and its parent.
- The batch was not rerun. Steps 4 (review) and 5 (idle check, assets.json backup, index apply) do not apply. The
  active index is untouched.

**Silent misread (pipeline-wide hazard).**
- Today's `parents-01` call exited 0, but the 12.00 usmap misreads the `M_Character_PanningHologram` root:
  - `CachedExpressionData`, `TextureStreamingData` and `bIncludedInBaseGame` are missing;
  - `LoadedMaterialResources` went from 2 entries to 0;
  - a spurious `AssetUserData: [None]` appeared.
- So, on the 17 Nov build, an exit code of 0 does not prove a root material was read correctly. Only the error case
  (`parents-02`) is caught.
- The MI exports and the hologram strip mesh look sound: their exports differ only in shader-library fields, or not at
  all.

What changed in the update, as far as these packages show: the shader library was rebuilt. Shader ResourceIndex and
SortKey values are reshuffled, some ResourceHash values changed, and SM6 bytecode changed for every MI. SM5 bytecode
changed for every MI except the two PanningHologram instances. The root materials' property schema changed.

Probe reads on the 17 Nov build since 17 Nov (scan of probe logs carrying "Mounted 32 containers; 399699 files" under
`scripts/generated` to depth 7, `.claude/worktrees` to depth 9 and `_docs` to depth 4):
- Root materials: w177's own four calls only. No other root-material read was found.
- `accessory-frames-source-v1/heads-s12-01` and `skeletons-02` (21 Nov, head-socket frames): heads and skeletons, no
  materials. That work admitted them only through whole-skeleton bone equality.
- `_archived-worktrees/heuristic-darwin-d076c9/all-emotes-2026-11-21` (`run-1`, `research/json-*`): animation and data
  asset reads behind PR #62's 66 emotes. These are not material reads, but they used the same 12.00 usmap on the new
  build. Live checks of the emotes passed. If an emote ever shows wrong curves or props, check that read first.
- The 31-container logs under the worktrees' `.claude/evidence/` copies are pre-update reads (20 Oct build) with newer
  copy times.

Still open: a usmap for the 17 Nov build (the coordinator said not to download one without asking), or a looser rule
from the owner. Example: admitting the two hologram MIs on identical SM5 pixel bytecode + uniforms. That would still
leave each item's other slot, and all three roots, unproven.

## Step 3c: usmap search for the 17 Nov build — none exists; w177 parked (22 Nov 2026)

The user approved (via the coordinator) a search of the FModel Discord for a usmap matching the installed build
(`Discovery-*.exe` FileVersion `discovery_12.03.x-CL-1460914`, Steam buildid 26706524). The search was done in the
built-in browser on 22 Nov, signed in as the user.

What was searched (Discord search, then reading each result):
- `in:"THE FINALS" usmap`: 30 results. The newest is 16 Nov 19:02 UTC ("Do you have a recent USMAP file?"), after a
  16 Nov 16:43 post asking for a new AES key and usmap "since today's patch". No reply posts a file.
- `in:"THE FINALS" has:file`, every post from 16 Nov to 22 Nov (7 pages): only images, videos, one `.aup4` and
  renders. No `.usmap`, `.zip` or `.7z`.
- Server-wide `usmap 12.03`, `1460914`, `discovery usmap`: no results. Server-wide `usmap` (newest first) shows only
  other games' threads.

**Result: no usmap for the 17 Nov build has been posted. Nothing was downloaded.** w177 is parked at step 3:
- both items are still skipped;
- the batch was not rerun;
- the active `public/models/reconstructed-assemblies-v1` index is untouched.

Possible route, for the user to decide (not taken):
- What it is: [UsmapGen](https://github.com/Ka1serM/UsmapGen) (MIT, C++), by Ka1serM, an FModel developer. It was
  posted in the FModel #programming channel on 18 Nov.
- What it does: it generates a usmap (version 5, with engine and package versions) from a Win64 UE executable on
  disk, without running the game. Pointed at a copy of the installed exe, it would not touch the live game.
- What it would take: downloading and running a third-party executable (or building it from source). The
  coordinator's brief excluded executables, so it needs the user's own decision.
- Unknown: whether it can read THE FINALS' exe if the exe is packed or protected (a guess, not checked).

If any usmap is used later, check it against the hazard above before trusting a read: all four roots
(`M_Character_Layered`, `M_Character_PanningHologram`, `M_Character_PlasticSheet`, `M_Character_8Layers_Master`) must
read with `CachedExpressionData` present and `LoadedMaterialResources` > 0. Exit 0 alone is not enough.

## Step 3d: UsmapGen built from source; the 17 Nov exe is encrypted on disk, so no usmap (23 Nov 2026)

The user chose (relayed by the coordinator, download yes given in this session): review UsmapGen's source, build it
from source, run it on a copy of the exe with the game closed, and verify the four roots before use.

What was done (everything is in `scripts/generated/usmapgen-2026-11-23/`, evidence in `usmapgen-2026-11-23/` here):
- **Source:** `Ka1serM/UsmapGen` at `dcf2da9d801fcb333dd8578c4a5f9c0d375ad9dc`. Submodules: zydis v4.1.1 `a2278f1d`
  (zycore v1.5.2 `0b2432ce`), zstd v1.5.7 `f8745da6`, brotli `028fb5a2`, `Ka1serM/ooz` `1e1d8cc3` (simde `dd0b662f`,
  munit `da8f7341`).
- **Toolchain:** `llvm-mingw-20261020-ucrt-x86_64.zip`, 190,612,575 bytes, sha256 `fd5462b7f5d93b2f…eebd74cd`,
  equal to the GitHub release digest. CMake 3.29.5 from Visual Studio 2022, because the 3.28 on PATH is below the
  project's minimum. `--preset windows-release -DUSMAPGEN_BUILD_TESTS=OFF`. The test suite downloads dedicated
  servers with DepotDownloader, so it was not built.
- **Review result: passes the brief.**
  - The tool memory-maps the exe with `GENERIC_READ` / `PAGE_READONLY`, analyses it in-process (Zydis decode plus a
    small emulator whose stores go to an in-memory page overlay, never the file), and writes one `.usmap`. The
    default output name is sanitised of path characters; an explicit output path was passed anyway.
  - UsmapGen's own code contains no process, network, registry, driver or loader APIs.
  - The built exe imports only KERNEL32, SHELL32 (`CommandLineToArgvW`) and the C runtime.
  - The ooz fork's three commits are two Huffman bug fixes and a file move. zycore's `API/Memory.c` wraps
    `VirtualAlloc` (upstream code); UsmapGen never calls it.
  - Built `usmapgen.exe` sha256 `92f8a00c01e936d1…2918c31b`.
- **Run:** the game was not running (tasklist). Both 17 Nov 14:41 exes from `Discovery/Binaries/Win64` were copied
  out and verified equal to the installed files by sha256; the tool ran on the copies only.
  - `Discovery-d.exe`: sha256 `b5e566a5db0b6dbcb1d1a2c9699e2fbdfada330de2e8a8c0d0a1a6a2ab027d54`.
  - `Discovery-e.exe`: sha256 `519befb1ce2379e2c216b62d83a6c33fd8561d8ecf94aa8d4e84c8516bb62f0f`.
  - Both exit 1: "The executable has no exception directory." No usmap was written.

**Why: both exes are encrypted at rest** (`pe-probe.out`, `objdump-*.txt`):
- `.text`, `.rdata` and `.pdata` have byte entropy 8.00 in every 64 KB sample, which is ciphertext, not code or
  data.
- `.rdata` holds none of `CoreUObject`, `MaterialInterface`, `CachedExpressionData`, `LoadedMaterialResources`,
  `StaticMesh` (ASCII or UTF-16).
- The exception-directory and import-table entries are zeroed. `Discovery-d.exe` also has extra executable sections
  `dnv0`–`dnv4` (an anti-tamper protector's sections, by their look). The protector decrypts the image in memory when
  the game starts.
- So no static tool can build a usmap from the files on disk. UsmapGen's own message points to a memory dump of the
  running game, which the user ruled out ("never touch the live game"), and which would run beside the anti-cheat.

**Result: stopped as the brief says. No usmap from UsmapGen; w177 stays parked at step 3 (see step 3e).** The SOURCE_USMAP pin is unchanged. The
active `public/models/reconstructed-assemblies-v1` index is untouched. The UsmapGen build is kept for reuse if an
unencrypted 12.03 binary ever appears; the two exe copies were deleted after hashing (re-copyable from the install).

## Step 3e: hand-patched usmap — patched and proven, with one guarded window (23 Nov 2026)

The coordinator relayed the task; the user's words were "try patch it". It is Fable's route B, timeboxed, and ships
nothing. Full record: `usmap-patch-2026-11-23/README.md`; probe outputs: `scripts/generated/shader-probe/usmap-patch-2026-11-23/`.

**The patch:**
- File: `usmap-patch-2026-11-23/mapping/5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap`, sha256
  `f36b7c4f27182664ee0ff6dd175d1ed854f3e00b4184607c8599d319502c0c3c`.
- Built from the 12.00 map (`e5b29e28…`) by `patch_usmap.py patch-spec-v1.json`.
- One edit: UMaterial gains one placeholder slot at own index 148 (150 → 151 slots), so every MaterialInterface slot
  shifts by +1.

**Found from unversioned headers alone** (`zen.py` + `usmap.py`):
- The four roots' slots below 146 are unchanged, and their MaterialInterface slots are all +1. "Unknown property 159"
  and the PanningHologram silent misread are both this shift.
- The 8 MIs' headers are identical, so MaterialInterface did not change.
- 11 other root materials moved bContactShadowsDeferred from 148 to 149, so the new slot is before it.

**Acceptance (all pass):**
- All four roots read today:
  - CachedExpressionData is present and equal to 11 Nov;
  - TextureStreamingData and bIncludedInBaseGame are present (8Layers_Master's asset no longer has
    TextureStreamingData: its header has no such slot);
  - no AssetUserData;
  - LoadedMaterialResources 2/2/8/6, as on 11 Nov, and PlasticSheet, 8Layers_Master and Layered export shaders again.
- Differences from 11 Nov:
  - shader-library fields only: SortKey, ResourceIndex, ResourceHash;
  - plus 8Layers_Master's StateId and CookedShaderMapIdHash ×8 (the asset was re-saved).
  - SM5/SM6 uniform layouts are byte-identical.
- Extra: the 11 slot-148 roots also match their own 12.00 reads.
- Regression: 63 MIs, DAs and meshes give identical exports with v1 and 12.00. The only difference is MI_ClownNose's
  shader archive location, which also flips between repeat runs with the 12.00 map.

**Not proven: the guarded window.** Whether the new slot sits before BillboardMode (146), before bOutputVelocity (147)
or right before bContactShadowsDeferred (148) is unknown, and so is its type: no asset in reach sets those slots.
- Materials that set none of new slots 146–148 read the same under every placement.
- `check_window.py` refuses any Material that sets one (15 checked, 0 refused; a positive test refuses).
- Any use of v1 must pin its sha and run that guard.

Unchanged: the SOURCE_USMAP pin, active index b164180c, skin-pairs f15a73a2. Using v1 in w177, S12 batch C or the
Heavy body is the coordinator's next call, after review.

## Step 3f: v1 adopted; w177 v2 batch ran; stopped on a View-layout change (23 Nov 2026)

**Adoption (the coordinator approved v1, with terms):**
- `SOURCE_USMAP` is now pinned to v1 by sha (`f36b7c4f`) in `prepare-accessory-defaults.py`,
  `run-catalog-metadata.mjs` and `s12-definition-drift.py`; the shared runner `w82-sweep/run-batch.sh` exports it.
  The 12.00 map (`e5b29e28`) is the recorded rollback. `test_s12_usmap.py` now also proves the 12.00 map is refused.
- v1 sits beside the 12.00 map in `scripts/generated/shader-probe/tools/`.
- **Guard inside the runner:** `scripts/shader-probe/usmap_window_guard.py` runs in the source stage whenever v1 is
  the map. A refused root's materials become error rows: the build skips them and the index defers their items with
  the reason. It writes `source/usmap-window-guard.json`.
- Backups of the 7 changed files, with SHA256SUMS: `usmap-patch-2026-11-23/adoption-before/`.
- Tests: `test_s12_usmap` 5/5; preparer suites 39/39; `test_hologram_contract` passes.

**Batch v2** (`run-v2.sh`, `batch-attached-v2.json` = a copy of v1's; folders `w177-panning-v2`):
- Drift v2 (with v1): both items identical, so no neutral-drift is needed.
- Source exit 0. The guard checked the 4 roots and refused none. 5 materials, 1 mesh and 31 textures extracted.
- **Contract defect found and fixed:** both PanningHologram MIs were refused with "Unsupported master material".
  - `material_inputs`' root filter never admitted `PANNING_ROOT`; the contract's smoke test had passed
    `genericRoot: True`, which skips that filter.
  - Fix: admit it when `pinned_panning` holds, as the hologram gate below and build-materials intend. It is
    CRLF-preserving, with a backup.
  - New `test_panning_admission.py` (4 pass).
- Build exit 0: SlimTankTop and the VaporWave glasses built and pass CPU (max error 0). The TranslucentOspUze sleeve
  was refused: "Unrecognized nail View sampler layout".
- GPU exit 1: `page.goto` timed out after 30 s on a cold 5174 Vite server. The next run must warm 5174 first.

**The blocker: the 17 Nov update changed the View uniform-buffer layout hash, not the programs.**
- Every SM5 shader read today has View layout hash `C838D617`, where all 23 on 11 Nov had `C873DB14`. The other five
  layout hashes per shader are unchanged.
- Two fail-closed pins key on it:
  - `nail_sampler` admits View samplers only for `C873DB14`, which refuses the sleeve;
  - the w177 hologram pin checks the raw `.ue-shader.bin` hash, which refuses both panning MIs after admission.
- **Evidence that the programs are the same:**
  - Panning MIs: the DXBC is byte-identical (same checksum, ISGN/OSGN/SHEX); only UE's wrapper differs (the View hash,
    and 242 bytes of trailing metadata, the same length).
  - The sleeve: one instruction swaps a commutative `mad` operand pair; every View constant-buffer offset it reads is
    unchanged.
  - Sampler tables: identical in all 10 shaders present in both builds, so View's shared samplers keep resource indices
    0 and 1 (and 43).
- **Decision needed, not taken (rendering sign-off):**
  - (a) admit `C838D617` in `nail_sampler` beside `C873DB14`;
  - (b) requalify the panning program's 17 Nov wrapper: pin its new raw hash, or compare the DXBC only.
  - Until then, both w177 items stay refused. Nothing built for them; nothing was reviewed or applied. The active index
    is untouched.
- Every view-lane pin (cb0[N]) elsewhere should still be checked against today's shaders before trusting other batches.
  The evidence here covers only these 10 shaders.

## Step 3g: the 17 Nov View layout requalified; samplers admitted, lanes gated, panning wrapper pinned (23 Nov 2026)

The coordinator decided (a) and (b) on 23 Nov, with these conditions: try RDEF first, decode the wrapper diff before
pinning, add the View-lane refusal now with a test, then run w177 v3 with 5174 warmed.

**What changed in the wrapper** (`usmap-patch-2026-11-23/decode_wrapper.py` → `wrapper-diff-v1.json`, 10 programs ×
SM5/SM6 × pixel/vertex):
- RDEF is stripped from every shader in both builds, so offsets were recovered from the wrapper and the disassembly.
- The wrapper layout: a u32 flags word, six u32-counted arrays (srvs, samplers, uavs, layoutHashes, textures,
  collections), the DXBC, then optional entries `{u8 key, u32 size, data}` closed by a u32 total size. Keys: `p`
  (packed resource counts), `u` (uniform-buffer names), `m` (mask), `s` (zero), `V` (validation: buffer sizes).
- In every shader, only View changed: its layout hash `C873DB14` → `C838D617`, and its size 6912 → 6976 bytes in `V`
  (CB0 430 → 434 float4). Pixel shaders that bind View textures also moved the View texture resource index
  (`textures` 0x6300 → 0x6500). Samplers keep resource indices 0, 1 and 43.
- **The panning pixel program's 242 trailing bytes** are the optional-data block, the same length in both builds.
  Only the `V` entry differs, in the View size field. The `u` names, `p` counts, `m` mask and every other buffer size
  are equal. The DXBC is byte-identical (checksum, ISGN, OSGN, SHEX).

**View cb lanes requalified offset by offset** (`requalify_view_lanes.py` → `view-lanes-c838d617.json`; method:
align the same program's 11 Nov and 17 Nov disassembly line by line; an aligned instruction reading offset N in both
proves the member at N is unchanged):
- 65 offsets requalified: 0–7, 16–18, 31, 37, 44–47, 64–66, 72–73, 79–81, 84–85, 121–122, 124, 148–149, 152, 156–167, 170–174, 202–206, 253–254, 259–260, 319–320, 322–325.
  Remapped: 428 → 432 and 429 → 433 (not admitted). No conflicts.
- Copied to `scripts/shader-probe/view_layout_c838d617.json`, with the evidence file's sha256.

**(a) View samplers** — `nail_sampler.py` (CRLF kept; backup in `usmap-patch-2026-11-23/view-before/`): admits
`C838D617` beside `C873DB14`, still only where the shader's own table puts the sampler at View resource 0 or 1. The
result records the actual `viewLayoutHash`.

**View-lane refusal** — new `scripts/shader-probe/view_layout.py`, called by `material_inputs` for every program:
- An unknown layout is refused. A baseline (`C873DB14`) program passes unchanged.
- Pixel stage: every View lane the pipeline pins or interprets by number (`PIXEL_PIPELINE_LANES`, 47 offsets) that the
  program reads must be requalified. Lanes the pipeline does not pin stay sm5_slice `external` nodes, which the
  emitter already refuses when live, so they fail closed by themselves.
  - Why not every read: all 17 Nov layered programs (Layered, 4Layers, 8Layers, the tank top) read the remapped
    lanes 432/433, an integer and/imad block whose result the slice leaves dead. The v2 GLSL for the glasses and
    tank top contains no View lane at all. A whole-asm gate would refuse every 17 Nov layered material for a lane
    nothing uses.
  - Pinned lanes not requalified, and so refused on `C838D617`: 12–14 (viewRotation), 15, 24–26 (cameraBasis), 27,
    183 (sun direction). Families using them need a 17 Nov requalification first.
- Vertex stage: every View read must be requalified (vertex paths are not sliced this way); all current reads are.
- The View register comes from the wrapper's `u` list (cb0 in pixel shaders, cb1 in the panning vertex shaders). A
  non-baseline pixel shader with View off cb0 is refused.
- A test scans the pipeline sources (py, json, mjs) for numbered `cb0[N]` lanes, so a new pin outside the declared
  set fails the suite.

**(b) Panning wrapper pin** — `hologram_programs.json` entry 5530ee90 gains `requalifiedRawHashes`: the exact 17 Nov
raw hash `ab1af562…` (both panning MIs), with its View hash, DXBC hash, wrapper diff, decision and evidence.
`hologram_contract.require_hologram_program` accepts the qualified hash or a listed requalified one; the DXBC pin is
unchanged.

**Tests:** new `test_view_layout.py` (27) and `test_panning_admission.py` (7): the requalified wrapper passes the
real pin and the View gate, a one-bit change to it is refused, and material_inputs runs the gate on every program.

**Batch v3** (`run-v3.sh`, `batch-attached-v3.json` = a copy of v1's; GPU rerun `rerun-v3-gpu.sh`; folders
`w177-panning-v3`):
- Source exit 0 on map v1: the window guard checked 4 roots and refused none. 5 materials resolved with no error rows;
  1 mesh and 34 textures extracted.
- Build exit 0: 5 built, 0 build errors, 5/5 CPU pass, no audit blockers. That includes both PanningHologram MIs and
  the TranslucentOspUze sleeve the sampler pin refused in v2.
- GPU: attempt 1 (in `run-v3.sh`) timed out in `page.goto` (30 s) on a saturated PC. Attempt 2
  (`batch-attached-v3-gpu.attempt2.out`, after loading the whole app once headless) passed: 5 materials, 97 cases,
  max error 8.34e-6, 0 failed.
- **Index stage not run (25 Nov):** the session's auto-mode permission check denied running
  `prepare-attached-batch.py index`, which writes the staged copy into `public/models/reconstructed-w177-panning-v3`
  and `-preview-v3` (the tool refuses the active folder itself). Waiting on the user. The review (step 4) needs that
  preview, and the apply (step 5) comes after it. Nothing is applied; the active index is untouched.

**Test fallout from the View gate, fixed 25 Nov** (backups with SHA256SUMS in `usmap-patch-2026-11-23/regress-fix-before/`):
- `precheck-family-materials.py`'s VirtualExports has no shader files, and `exports / 'shaders'` raised TypeError on
  every material (10 failures). `material_inputs` now runs the gate only on real export folders (a `Path`); the source
  and build stages always pass one.
- `test_metal_contract` and `test_w41c_contracts` write placeholder program files, not shader wrappers. The gate now
  refuses an unreadable wrapper with a clear ValueError (a new test covers it), and both fixtures stub the gate.
- All 90 shader-probe test files pass except two older failures this work did not cause: `test_prepatch_cache` (the
  22 Nov `prepare-large-sneakers.py` no longer matches its October backup) and `test_scalp_only_hair` (it needs a Node
  preflight report). `test_translation.py` is a CLI script with no tests.

**Manifest provenance fixed (25 Nov, the coordinator's flag)** (backups with SHA256SUMS in
`usmap-patch-2026-11-23/provenance-before/`):
- The v3 panning manifests read `hologramProgram.rawSha256 c2bad042…` (the 11 Nov wrapper), although the build read
  and admitted the 17 Nov wrapper `ab1af562…`. The policy copied the contract's qualified hash.
- Now `hologram_contract.program_record` records the hash the build actually admitted. A requalified wrapper also
  records `qualifiedRawSha256` beside it; the qualified wrapper's record is unchanged, byte for byte.
  - `hologram_policy` / `panning_policy` take `raw_sha256` as a required keyword, so no caller can fall back silently.
  - Callers: `build-materials.py` (build), `prepare-large-sneakers.py` (surface audit) and `test_hologram_contract`.
  - The raw-pin check in `require_hologram_program` uses the same `admitted_raw_sha256`.
- Tests: new `test_the_manifest_record_names_the_wrapper_actually_admitted`. The suites touching these files pass
  117/118; the one failure is the older `test_prepatch_cache` one.
- **v3's outputs carry the old record, so w177 must be rebuilt before it applies:** `run-v4.sh` (v4 folders, not yet
  run). It writes `public/models/reconstructed-w177-panning-v4` and `-preview-v4`, so it waits on the user's answer to
  the same auto-mode permission denial. Its source stage reads the containers, so tell the Light session first.
- Other manifest checks on v3 (APPLY.md step 3) pass for both panning MIs: hologramSurface, MSM_DefaultLit,
  twoSided false, ambientPolicy, emissiveBoundary.finiteInputs, no generic dead-effect fields. The build enforces the
  UNORM texture format.
- **`test_prepatch_cache` was already failing before this work (shown 25 Nov):** the test function run against
  `provenance-before/prepare-large-sneakers.py` (sha `02f8895e…`, before the provenance edit) fails at the same line
  as the current file: `test_prepatch_cache.py:45 assert strip(new_mod) == strip(old_mod)`. The first difference is
  module statement 2 (`import hashlib` where the October backup has `import json`), plus a new `__main__` block, from
  the 22 Nov change to `prepare-large-sneakers.py`. The 24 Nov file-by-file run (before any provenance edit) already
  showed it failing. Pre-existing; not this work's to fix.

**Batch v4 (26 Nov, the user's "Yes, both"): the provenance-fixed rebuild** (`run-v4.sh`, folders `w177-panning-v4`):
- The 5174 server was warmed headless first: the cold load took 128 s, the warm reload 0.7 s. All four stages ran with
  no retry.
- Source exit 0: 2 choices, 5 materials extracted, 1 mesh, 34 textures; nothing unresolved.
- Build exit 0. GPU exit 0: 5 materials matched 97 cases, max error 8.34e-06, 0 failed.
- Index exit 0: 2 candidates, 2 implemented, 1 mesh and 5 materials added, supportedItems 2955.
- Both panning manifests now record `hologramProgram.rawSha256 ab1af562…`, the 17 Nov wrapper the build admitted,
  with `qualifiedRawSha256 c2bad042…` beside it (`textSha256 5530ee90…`, High).
- Against v3: the 37 shared files are byte-identical. The two staging manifests differ only in `hologramProgram`. The
  files only v4 has are index-stage outputs, a stage v3 never reached.
- Step-4 review captures: `capture-review-v4.json` → `review-v4-captures/` (log `review-v4.capture.log`). capture-items refuses an existing output folder, so do not pre-create it. The empty `review-v4/` beside it is left from a pre-created attempt (a safety check blocked removing it while it was the session cwd); it is safe to delete.
- **Review trap, 26 Nov:** the first v4 captures (`review-v4-captures/`) went through serve-5174. That server serves
  `scripts/generated/catalog-public-worktree`, which is on `codex/current-app-2026-10-07` (fd299ab), the 7 Oct app.
  That app predates the PanningHologram runtime (PR #74, merged 22 Nov), so both items refused their panning material:
  "Unsupported recovered hologram contract: blend, shading or emission state". Those images are not a review of v4.
  The review was rerun on current main's app: the lockdown worktree at main 963d906 served on 5175 by a temporary
  `.serve-review-w177.tmp.mjs` (same root `public/`, same in-memory model JSON), into `review-v4-captures-main/`.

**Step 4 review (26 Nov, v4 on current main's app, `review-v4-captures-main/`, judged by looking at full size against the icons):**
- Both items loaded with 0 errors and 0 failed requests. `mi-character-panninghologram-ospuze` and
  `-vaporwavevisor-cns` are reconstructed and visible.
- The current app's item drawer fills the lower half of the 900x1000 page, so the viewer is 900x440. The framing
  still centres each target; the shots are smaller, not mis-aimed.
- **Jacket (streetwear-sportsjacket-translucentospuze): accepted.** The front, both sides and the back match the icon:
  yellow translucent shell, OSPUZE / 32 / "let it breathe" print, yellow zip and drawcord. The Ospuze hem tabs read as
  the PopPour decal (white logo on black, yellow border). No pixel grid shows even in the close-ups (fade 1 at this
  distance, as expected).
- **Glasses (streetwear-vaporwaveglasses-plastic-cnss7sp): accepted, with a note.** The CNS lens shows the panning
  rainbow gradient through fine vertical scanlines, with the eyes visible behind it. The 20x BaseIntensity does
  **not** clip white. Recorded rather than tuned, per APPLY.md: it reads more saturated and a little darker than the
  icon's pastel pink / yellow / cyan. Hue placement pans with time, so a still icon fixes one moment. Frame and temple
  arms are the icon's purple and black.
- **Accepted list: both rows** (jacket and glasses).

**Step 5: applied as wave 137 (26 Nov)** (`../wave137-merge/`; the wrapper is `accepted/`, with spec suffix
`:../review-v4-captures-main`):
- Before applying:
  - Drift: none. The active index was b164180c, the one the v4 index stage ran on.
  - Idle check: IDLE.
  - Backups are in `before-wave137/` with SHA256SUMS. The coordinator was told first.
- merge.py staged and activated: +2 ids, 1 mesh, 5 materials; advertised 2953 -> 2955. Rollback:
  `../wave137-w177-panning/activation-before`.
- **Active index now:** assets.json `1d778be3…`, supported-items `54e8789c…`; skin-pairs `f15a73a2` unchanged.
- Progress: 3153 blue / 27 purple / 302 red.
- Pair census:
  - Gate-aware (`../w175-cns-glitch/pair-context-census.mts`): 5,214 pairs, 0 failing.
  - Original (`pair-context.json`): 26 failing. In every row the new item's list is empty and the missing mesh is the
    partner's CNS glitch overlay (14 meshes), which the w175 gate drops by design.
- Live check (`../wave137-merge/live/`, current main on 5175, active index): 0 errors and 0 failed requests in 4
  cases.
  - Both items equal their review captures.
  - Jacket + tech joggers CNS glitch and glasses + long hoodie CNS draw both garments, without the dropped overlay.
- App suite: 532/532 (`../wave137-merge/app-tests.log`).
