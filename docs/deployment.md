# Static app and asset releases

The app runs on GitHub Pages. Extracted artwork lives in separate Cloudflare
Pages deployments. A phone preview can publish the same production app build to
a Cloudflare branch deployment before the GitHub Pages release is merged.

## Use more deployments when needed

The maintainer approved this policy on 23 September 2026: partition the referenced
asset graph across as many free static deployments as needed. Do not remove active
items or enable a paid product because a combined package exceeds one site's limit.
The current three asset groups are a useful split, not a fixed maximum.

Cloudflare currently allows 20,000 files per Free Pages site and 25 MiB per file.
[Check the current provider limits](https://developers.cloudflare.com/pages/platform/limits/)
before publishing. The staging preflight reserves three entries for release metadata
and refuses oversized packages before copying them. A single oversized file needs
asset optimization or format work; extra deployments do not change its size limit.

| Group | Build setting | Validation setting |
| --- | --- | --- |
| Icons and fallback assets | `VITE_ASSETS_BASE` | `ASSETS_BASE` |
| Base models and legacy textures | `VITE_MODELS_BASE` | `MODELS_BASE` |
| Reconstructed meshes, shaders and textures | `VITE_RECONSTRUCTION_BASE` | `RECONSTRUCTION_BASE` |
| Additional reconstruction shards | `VITE_RECONSTRUCTION_ROUTES` | `RECONSTRUCTION_ROUTES` |

The browser and catalog validator share `src/lib/asset-routing.mjs`. The reconstruction
override applies to `models/reconstructed/` and `models/reconstructed-*` paths. Blank
overrides preserve existing one-host and two-host releases and local development.

The adaptive reconstruction planner below packs complete dependency groups into
as many packages as required. Shared dependencies are duplicated where needed.
The route settings are optional JSON; omitted settings retain older releases.
Icons and legacy base models retain their existing host settings.

## Adaptive reconstruction packages

Checked against the official Pages limits on 7 October 2026: **20,000 files per
Free site, 25 MiB per file**, with a 100-project account limit. Check that page
again before publishing. Additional immutable deployments can reuse the existing
asset project; adding another shard does not require another paid service or
necessarily another Pages project.

Run from the release worktree, with the complete shared `public` directory as
the asset source. Use a new immutable version and output path each time:

```powershell
$env:ASSET_SOURCE_DIR = 'E:\Coding\the-finals-outfit\public'
$env:ASSET_PLAN_OUT = 'E:\Coding\the-finals-outfit\_docs\RELEASE\shard-plan.json'
node scripts/stage-assets.mjs RELEASE --reconstruction-only --auto-shard
```

`RELEASE` must contain lowercase letters, digits and hyphens. Create the evidence
directory first. Planning reads and hashes the exact catalog and active-index
closure, including GLB external resources, but copies no asset bytes. The output
pins each file's SHA256, size, relative dependencies, canonical host and package.
It reserves three files per package for `manifest.json`, `_headers` and `404.html`.
It refuses missing dependencies, invalid paths, a single oversized file, or a
dependency group that cannot fit even in its own package. Do not hand-edit the
plan: an active-index or source change needs a new plan and version.

1. **Stage leaf shards first.** For each plan shard with ID 1 or higher, run
   `node scripts/stage-asset-shard.mjs PLAN.json ID --dry-run`. Remove `--dry-run`
   to write its package when needed. Both modes rehash all its sources. Set
   `ASSET_SHARD_OUT` to override the default `_assets-upload/VERSION-SHARD` folder.
   Existing output directories are never overwritten. A source mutation during
   copying aborts; preserve or remove only that failed new package before retrying.
2. When publication is authorized, deploy **each package's contents** as a fresh
   Pages deployment. Preserve each immutable deployment URL and the
   `manifestSha256` printed by staging. Do not use a mutable branch alias.
3. Record a host JSON with the exact plan hash (SHA256 of
   `JSON.stringify(JSON.parse(planBytes))`) and the leaf deployment receipts:

   ```json
   {
     "planSha256": "EXACT_PLAN_HASH",
     "shards": {
       "reconstruction-001": {
         "immutable": true,
         "baseUrl": "https://IMMUTABLE-DEPLOYMENT.PROJECT.pages.dev/",
         "manifestSha256": "EXACT_STAGED_MANIFEST_HASH"
       }
     }
   }
   ```

4. **Stage shard 0 last**, passing `--hosts HOSTS.json`. Its four global control
   indexes are rewritten only in the staged package to reference the leaf hosts.
   Every other resource remains source-identical, including material/mesh relative
   references. Canonical body URLs remain consistent even when a mesh is duplicated
   across packages. Source assets and active indexes are never modified.
5. Publish shard 0 as a new immutable deployment and add its URL/manifest receipt
   to the same host JSON. Run `node scripts/asset-shard-config.mjs PLAN.json HOSTS.json`
   to produce matching build and catalog-validation settings without rereading GBs
   of assets. The compact routes group directory prefixes by host; oversized flat
   folders use exact-file routes. Longest matching prefix wins.
6. Run `node scripts/validate-asset-shards.mjs PLAN.json HOSTS.json REPORT.json`.
   It checks every hosted manifest's exact staged hash, full membership and relative
   closure, then fetches all control roots and deterministic representative files
   from every package and checks their SHA256. The report explicitly lists sampled
   files; this is not an exhaustive download of the release.
7. Use the emitted `RECONSTRUCTION_BASE` and `RECONSTRUCTION_ROUTES` alongside the
   existing icon/base settings for `npm run validate:catalog`. Use the corresponding
   `VITE_*` values for the app build and record them together in the release workflow.
   These are public host locations, not credentials. Then perform the browser and
   physical-phone checks in the release sequence below.

For the pinned 7 October baseline, the planner selected **23,445 distinct files**
and duplicated one shared body mesh: **20,000** total files in shard 0 and **3,452**
in shard 1, including package metadata. This is two reconstruction deployments
in addition to the existing icon/base deployments. It is evidence of a local
plan, not a published release or a permanent shard count. Later accepted assets
must be included in a new plan.

The final same-day accepted-state refresh contains **23,755 distinct files**,
still with one duplicated body mesh: **20,000 + 3,762** package files. Both plans
and their separate verification evidence are retained. Use the exact plan matching
the accepted indexes; never mix a new leaf-host mapping with an older control
package. Hosted validation rejects that mismatch even when leaf bytes are equal.

The full graph, package hashes and eight matching browser renders were checked
with two separate local hosts. This caught a body-URL identity mismatch before
release; a regression test now covers duplicated meshes and canonical ownership.
See `_docs/release-integration-2026-10-07/SHARDING.md` in the main workspace for
the exact evidence and remaining hosted checks.

## Release sequence

1. Inventory **only referenced** catalog assets, body-mask companions and active
   reconstruction dependencies. Keep candidates outside active indexes.
2. Stage each package under a new version. `node scripts/stage-assets.mjs VERSION`
   stages everything, `--models-only` omits icons, and `--reconstruction-only` stages
   reconstruction paths plus their complete dependency closure. For a release
   worktree, set `ASSET_SOURCE_DIR` to the shared extraction's `public` directory.
3. Prove reused assets unchanged against the previous staged release. Include any
   changed or newly required assets in a new package; never silently reuse stale bytes.
4. Publish the **version directory's contents**, its `_headers` file and a small
   `404.html` as one package to a new Cloudflare preview deployment in the existing
   asset project. Never upload the parent directory containing several old versions.
   Preserve CORS, cache headers and an exact `manifest.json`; the 404 prevents an
   HTML fallback from pretending to be a missing binary asset.
5. Record the returned immutable deployment URL. Reuse unchanged immutable icon or
   model URLs. Avoid mutable branch aliases in the production asset configuration.
6. Run `npm run validate:catalog` with all three validation settings. This checks
   manifest membership, reconstruction dependencies and real HTTP spot checks.
   Run `npm run validate:share-links`, the affected tests and the production build.
7. Pin those same URLs together in `.github/workflows/deploy.yml`, including matching
   `VITE_*` build variables. No account secret is needed in the public app bundle.
8. Test the hosted production build: initial model, item switches and loading feedback,
   retry, representative hair/face/clothing, old share links and browser network hosts.
   Mark phone-sized browser emulation separately from a real phone test.
9. Offer a versioned HTTPS preview for maintainer review. Keep previous deployments
   available; promote to the main app only through the approved release process.

This workflow uses static deployments. It does not require Workers, R2, a tunnel,
paid monitoring, a new domain or any account billing changes. No raw artwork is
committed to Git. Additional splits still need validation and applicable upload approval.
