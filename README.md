# the-finals-outfit

Fan-made cosmetic outfit builder for **THE FINALS**. Compose a look and share it by URL. Unaffiliated with Embark Studios AB — see [CREDITS](CREDITS.md) for what belongs to whom, and for why no extracted game asset is committed here.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4
- React Router (HashRouter) — share-by-URL state
- Zod for share-link validation
- Deployed as a static site to GitHub Pages via GitHub Actions

## Scripts

```sh
npm install
npm run dev                # local dev server
npm run build              # production build -> dist/
npm run preview            # preview the built bundle
npm run typecheck          # tsc --noEmit
npm run validate:catalog   # schema-check src/data/items.json
```

## Assets

**A fresh clone will not render anything, and that is intentional.**

No extracted game asset is committed to this repository — not item icons, not
meshes, not textures, not anything baked or rendered from them. They belong to
Embark Studios AB, and git history cannot be un-published. See
[CREDITS](CREDITS.md) for the full reasoning.

The application expects assets to exist locally at paths that are gitignored:

| Path | Contents |
|---|---|
| `public/items/<slot>/<id>.webp` | item icons referenced by the catalog's `imageUrl` |
| `public/models/` | character and cosmetic meshes, skin and material textures |
| `scripts/generated/` | composited eye textures and body masks |
| `visual-diff/` | render output from the fidelity-audit harness |

Regenerate them with the pipeline in `scripts/` against your own extraction, or
point `VITE_ASSETS_BASE` at a host that already serves them (see Deploy).
What is committed here is the *code that produces* assets, never their output.

**Assets no longer follow the branch.** They used to be tracked, so checking out
a branch gave you that branch's version of a mesh. Ignored files do not switch,
so a working tree carries one copy shared by every branch — and branches do
disagree: `claude/m5-materials-pipeline` has its own versions of the five
`.glb` meshes and 55 assets the June branches never had. Switching branches and
seeing stale geometry is this, not a bug.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on pushes to
the default branch, serving from `https://<user>.github.io/the-finals-outfit/`
until a custom domain is set via `public/CNAME`.

A CI checkout has no assets, so the build resolves them against
**`VITE_ASSETS_BASE`**, set from the `ASSETS_BASE` repository variable (Settings
→ Secrets and variables → Actions → Variables). Unset, the site builds and
deploys but renders no artwork.

### Releasing assets

Never overwrite a published asset path. They are served `immutable, max-age=1y`,
so replacing a file in place strands every existing visitor on the old bytes for
a year. Publish a new version directory instead and switch atomically:

```sh
npm run stage:assets -- v2        # copies only referenced files into _assets-upload/v2/
# publish _assets-upload/ to the host, then prove it before switching:
ASSETS_BASE=https://<host>/v2/ npm run validate:catalog
gh variable set ASSETS_BASE --body "https://<host>/v2/"
```

That validation step is the one that matters. It fetches every path the catalog
references and fails on any non-2xx, which is the only check that catches a
well-formed path pointing at nothing — CI has no assets locally, so it cannot
tell the difference any other way. The workflow runs the same check on every
deploy.

## Contributing catalog entries

The cosmetic catalog lives in `src/data/items.json`. Each entry must satisfy
the Zod schema in `src/lib/item.ts`:

```json
{
  "id": "knight-tunic",
  "slot": "upperBody",
  "name": "Knight Tunic",
  "season": 10,
  "rarity": "Epic",
  "source": "BattlePass",
  "sponsor": "vaiiya",
  "imageUrl": "/items/upperBody/knight-tunic.webp",
  "tags": ["fantasy", "medieval"]
}
```

- `id` is lowercase kebab-case, 2-48 chars, globally unique.
- `slot` must be one of the slots listed in `src/lib/slots.ts`.
- `sponsor` must match an entry in `src/data/sponsors.json` (or be omitted).
- `imageUrl` should point at `/items/<slot>/<id>.webp` under `public/items/`,
  kept ≤256px and ≤20kB. **Do not commit the image itself** — `public/items/`
  is gitignored, per [CREDITS](CREDITS.md). A catalog entry may reference an
  asset that is not in the repository; that is the normal state.
- Cite your source in the PR description — prefer
  [thefinals.wiki](https://thefinals.wiki),
  [the-finals.fandom.com](https://the-finals.fandom.com), and official patch
  notes at [reachthefinals.com/patchnotes](https://www.reachthefinals.com/patchnotes).

Run `npm run validate:catalog` before opening the PR. The workflow blocks
deploys if the catalog is invalid.

## Roadmap

Current milestone: M5 — materials pipeline (branch
`claude/m5-materials-pipeline`).
