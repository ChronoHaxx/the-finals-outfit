# Visual-diff harness: renders against the official icons

`render.mjs` drives a dev server with headless Chrome or Edge and screenshots each case in `cases.json`: one item
equipped alone, with the camera pinned through the dev-only `?cam` and `?fov` hooks. `compare.mjs` then samples
the probe rectangles on each render and on the item's icon (`public/<imageUrl>`). It reports the Oklab ΔE (×100)
between their mean colours in `visual-diff/scores.json`, with a side-by-side `report.html`.

```bash
# Git Bash, from the repo root, with a dev server running (npm run dev, or any server passed as VDIFF_BASE)
VDIFF_QUERY=reconstructed=1 node scripts/visual-diff/render.mjs [--only=<itemId>]
node scripts/visual-diff/compare.mjs
```

| Variable | Default | Use |
|---|---|---|
| `VDIFF_BASE` | `http://localhost:5173` | the server to render from |
| `VDIFF_QUERY` | none | extra viewer switches; **`reconstructed=1` for the route the site draws** (below) |
| `VDIFF_OUT` | `<repo>/visual-diff` | where renders, scores and the report go |
| `VDIFF_PUBLIC` | `<repo>/public` | where the icons are. A worktree has none, so point it at the root checkout's `public/` |

`VDIFF_QUERY`, `VDIFF_OUT` and `VDIFF_PUBLIC` were added on 25 Nov 2026 (C0b review,
`_docs/s12-refresh-tier2-2026-11-22/C0b.md`).

## The route trap: which runs scored the wrong route

The viewer has two routes:
- the **reconstructed** source-assembly route, which reads `public/models/reconstructed-assemblies-v1/` (the asset
  index, rebuilt materials);
- the older **cosmetics** route.

`src/lib/viewer-dev-params.ts` picks between them differently by build:
- a **production build** draws the reconstructed route unless the URL says `?reconstructed=0`;
- a **dev server** (`import.meta.env.DEV`, what this harness drives) draws it only with `?reconstructed=1`.

Before 25 Nov 2026 no script here passed that switch, and every one defaults to a dev server on 5173. So:
- **Runs before 9 Sep 2026** (`04a0e3b`, which added the reconstructed preview) compared the only route there was.
  They stand.
- **Runs from 9 Sep to 25 Nov 2026 against a dev server scored the cosmetics route**, not what the site shows. Re-run
  any of their conclusions about the reconstructed route before relying on them. The C0b review found this: the
  live and candidate renders of an index change came out byte-identical.
- **From 25 Nov 2026,** `render.mjs` with `VDIFF_QUERY=reconstructed=1` scores the site's route.

The other scripts here still build their URLs without the switch: `build-garment-masks`, `coatback`, `coatsweep`,
`material-ab-render`, `material-bindings`, `orbit`, `render-hairs`, `render-hairs-ctx`, `streak-sweep`, `sweep`,
`verify-render` and `verify-render2`. Their dev-server runs have drawn the cosmetics route since 9 Sep. Add the switch
before using any of them for the reconstructed route.

The body-type and refresh reviews never had this problem: `scripts/body-types/capture-review.mjs` always passes
`reconstructed=1`.
