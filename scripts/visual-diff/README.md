# Visual-diff harness: renders against the official icons

`render.mjs` drives a dev server with headless Chrome or Edge and screenshots each case in `cases.json`: one item
equipped alone, with the camera pinned through the dev-only `?cam` and `?fov` hooks. `compare.mjs` then samples
the probe rectangles on each render and on the item's icon (`public/<imageUrl>`). It reports the Oklab ΔE (×100)
between their mean colours in `visual-diff/scores.json`, with a side-by-side `report.html`.

```bash
# Git Bash, from the repo root, with a dev server running (npm run dev, or any server passed as VDIFF_BASE)
node scripts/visual-diff/render.mjs [--only=<itemId>]
node scripts/visual-diff/compare.mjs
```

| Variable | Default | Use |
|---|---|---|
| `VDIFF_ROUTE` | `reconstructed` | which outfit route to draw: `reconstructed` (`?reconstructed=1`, the route the site draws) or `cosmetics` (`?reconstructed=0`, the older route, for a deliberate legacy comparison only) |
| `VDIFF_BASE` | `http://localhost:5173` | the server to render from |
| `VDIFF_QUERY` | none | extra viewer switches, e.g. `bodyType=feminine`. It may repeat the route switch only with the same value |
| `VDIFF_OUT` | `<repo>/visual-diff` | where renders, scores and the report go (`render.mjs`) |
| `VDIFF_PUBLIC` | `<repo>/public` | where the icons are. A worktree has none, so point it at the root checkout's `public/` |

`VDIFF_QUERY`, `VDIFF_OUT` and `VDIFF_PUBLIC` were added on 25 Nov 2026 (C0b review,
`_docs/s12-refresh-tier2-2026-11-22/C0b.md`). `VDIFF_ROUTE` was added the same day; every script that opens the
viewer reads `VDIFF_ROUTE`, `VDIFF_BASE` and `VDIFF_QUERY` through `viewer-url.mjs`.

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
- **From 25 Nov 2026,** every script here builds its URLs with `viewerUrl()` in `viewer-url.mjs`, which adds an
  explicit `reconstructed=1` (or `reconstructed=0` under `VDIFF_ROUTE=cosmetics`) and refuses a URL without one.
  An explicit value draws the same route on a dev server and on a production build. Each run prints its route once.
  `tests/visual-diff-route.test.mjs` fails if a script here opens the viewer with a hand-built URL, or if
  `viewer-dev-params.ts` changes how it reads the switch.

Before that fix, these scripts built their URLs without the switch, so their dev-server runs from 9 Sep to 25 Nov drew
the cosmetics route: `render` (until `VDIFF_QUERY`), `build-garment-masks`, `coatback`, `coatsweep`,
`material-ab-render`, `material-bindings`, `orbit`, `render-hairs`, `render-hairs-ctx`, `streak-sweep`, `sweep`,
`verify-render` and `verify-render2`.

What relied on those runs, and a 30-item re-score on both routes: `_docs/visual-diff-route-audit-2026-11-25/README.md`.
In short, no decision in the window used an affected run. But the older verdict ledger and the June cluster map
describe the cosmetics route, and 18 of 30 sampled verdicts flip on the route the site draws.

On the reconstructed route the viewer runs its temporal accumulator, so captures now wait at least 2.5 s after
`window.__rigIdle` (`settleMs`, the wait `capture-review.mjs` uses). The cosmetics route keeps each script's old wait.
`--albedo` still works there (it draws the base colour view); `--nobaked` only means something on the cosmetics route.

The body-type and refresh reviews never had this problem: `scripts/body-types/capture-review.mjs` always passes
`reconstructed=1`.
