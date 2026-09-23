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

The browser and catalog validator share `src/lib/asset-routing.mjs`. The reconstruction
override applies to `models/reconstructed/` and `models/reconstructed-*` paths. Blank
overrides preserve existing one-host and two-host releases and local development.

If another group outgrows its limit, partition it further and extend the shared
routing and its tests. Merely uploading another directory does not make it usable:
relative references inside JSON, meshes and materials must still resolve. Keep each
dependency closure together, duplicate required companions, or add explicit verified
routing for the new partition. Do not assume every arbitrary split is safe.

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
