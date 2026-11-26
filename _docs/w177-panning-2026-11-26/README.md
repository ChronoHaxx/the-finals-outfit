# w177 PanningHologram: rebuilt (v4) and applied as wave 137 (26 Nov 2026)

Two rows went blue: `streetwear-sportsjacket-translucentospuze` (the translucent Ospuze sports jacket) and
`streetwear-vaporwaveglasses-plastic-cnss7sp` (the vaporwave glasses).
- The runtime is PR #74 (merged 22 Nov).
- The pipeline and records live in the main checkout's `_docs/goal-100-2026-10-11/w177-panning-contract/`, which is not
  on main.
- This folder copies the record (`APPLY-STATUS.md`, the full step-by-step history) and the small evidence files.

## What changed since v3

On the 17 Nov build, the manifests had recorded the 11 Nov wrapper hash (`c2bad042…`) although the build admitted the
17 Nov wrapper. v4 records the hash actually admitted: `hologramProgram.rawSha256 ab1af562…`, with
`qualifiedRawSha256 c2bad042…` beside it.

The View layout C838D617 (17 Nov) is requalified by a fail-closed gate on the lanes the pipeline pins (`view_layout.py`;
see APPLY-STATUS step 3g).

## v4 batch (`run-v4.sh`)

| Stage | Result |
|---|---|
| source | 5 materials, 1 mesh, 34 textures, nothing unresolved |
| build | exit 0 |
| gpu | 5 materials, 97 cases, max error 8.34e-06, 0 failed |
| index | 2 of 2 implemented, 1 mesh and 5 materials added |

Against v3: 37 shared files byte-identical; the two staging manifests differ only in `hologramProgram`.

## Review (`review-v4/report.json`; `capture-review-v4.json`)

Done at full size against the icons, on current main 963d906.
- **Jacket: accepted.** It matches the icon at every angle. The Ospuze hem tabs read as the PopPour decal, with no pixel
  grid.
- **Glasses: accepted.** The CNS lens pans its rainbow gradient through fine scanlines, and 20x BaseIntensity does not
  clip white. It reads more saturated than the icon's pastel; recorded, not tuned.

**Trap:** `serve-5174` serves the 7 Oct `catalog-public-worktree` app. That app predates the PR #74 runtime and refuses
panning materials ("Unsupported recovered hologram contract: blend, shading or emission state"). The review and the
live check therefore ran on current main through a temporary vite server (5175, root `public/`).

## Apply (wave 137; `wave137/`)

- **Before:**
  - Drift: none. The active index was b164180c, the one the v4 index stage ran on.
  - Idle check: IDLE (the process dump is kept local).
  - Backup hashes: `before-wave137.SHA256SUMS`.
- **merge.py:** +2 ids, 1 mesh, 5 materials; advertised 2953 → 2955.
- **Active index:**

  | File | Before | After |
  |---|---|---|
  | assets.json | `b164180c…` | `1d778be378326c34…` |
  | supported-items.json | `0f71ea9f…` | `54e8789c8ab1cc4b…` |
  | skin-pairs.json | `f15a73a2…` | unchanged |

  Progress: 3153 blue / 27 purple / 302 red.
- **Pair census:**
  - Gate-aware (the w175 copy): `pair-context-gate.json`, 5,214 pairs, 0 failing.
  - The plain census (`pair-context.json`) flags 26 pairs. All are partner CNS glitch-overlay meshes that the w175 gate
    drops. None names the new items.
- **Live check** (`live/report.json`, 4 cases, 0 errors): both items equal their review. Two flagged pairs (tech
  joggers CNS glitch, long hoodie CNS) draw both garments.
- **App suite:** 532/532.

Next in the queue was the Light bulk apply (`../archetypes-2026-11-22/light-bulk-apply-2026-11-26.md`), re-pinned onto
1d778be3.
