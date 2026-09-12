# Public catalog, sharing and preview recovery

The public builder now uses a conservative, wiki-matched catalog. The full
extracted catalog remains available at `thesecret-dev-mode-ganyu-only/` under
the app's deployment base, with internal names and the existing renderers.
This is an unlisted public URL, not authentication or private storage. Its
generated HTML includes `noindex, nofollow` before JavaScript runs. The public
page does not link to it. Both entries share the same application and assets.

## Catalog evidence and limits

- Snapshot: 12 September 2026, 15:09 UTC; 9,495 public `Cosmetic:` namespace
  pages read using the wiki's ordinary MediaWiki query/revisions API.
- Public selection: **860 of 2,866 items**. The other **2,006** remain available
  in the developer catalog. These counts concern identity matching, not shader
  quality or reconstruction progress.
- 856 matches use an exact localized game name and compatible wiki category,
  with one game item per wiki page. Four default outfit matches were checked
  visually against the wiki's item thumbnails. This is not a visual review of
  all 860 reconstructed models.
- Missing, ambiguous or multiply matched identities are excluded. Family-name
  guesses do not release every colour variant. A wiki name match is evidence
  of an identity, not a guarantee that the wiki's release data is complete.
- The wiki template defaults missing `IsHidden`/`IsUnreleased` flags to false.
  Explicit true flags and unrecognized values are excluded. The snapshot only
  contained two explicit unreleased flags and no explicit hidden flags, so
  these fields alone are insufficient to identify all datamined items.
- `IsUnobtainable` is not an exclusion: a previously released limited item may
  still be a legitimate outfit choice.
- Public hair currently has only two named matches; many ordinary hairstyles
  and other released variants still need an icon match. They are not being
  labelled unreleased. Expanding this mapping is the next catalog batch.

`src/data/wiki-catalog.json` contains names, page/revision IDs, match methods
and effective flags. The original `items.json`, item IDs and asset URLs remain
unchanged. Public browse/share hydration uses the explicit allowlist; renderer
companions can still resolve from the full internal catalog.

Sources:

- [THE FINALS Wiki cosmetic catalog](https://www.thefinals.wiki/wiki/All_Cosmetics)
- [Wiki cosmetic template and flag defaults](https://www.thefinals.wiki/w/index.php?title=Template:Cosmetic&action=raw)
- [SYNTHETIC RESOLVE, an explicit unreleased example](https://www.thefinals.wiki/wiki/Special:Cosmetic/12175/SYNTHETIC_RESOLVE)
- Default matches: [HEAD 1](https://www.thefinals.wiki/?curid=22043),
  [SPECTATOR STANDARD](https://www.thefinals.wiki/?curid=24279),
  [BUCKLE-UP JEANS](https://www.thefinals.wiki/?curid=16197),
  [CANVAS SHOES](https://www.thefinals.wiki/?curid=14025).

Only factual metadata is incorporated; wiki descriptions and images are not
copied into the repository. The app credits the wiki and continues serving
the existing extracted icons from the existing asset host.

To regenerate, supply a complete local MediaWiki query snapshot directory
(`0000.json` etc., plus sibling `wiki-snapshot.json` with `complete`, `count`,
and `at`) and the existing game localization export:

```powershell
node scripts/import-wiki-catalog.mjs '<wiki-pages directory>' '<ST_CustomizationItems.json>'
```

The importer writes the curated metadata and a gitignored unmatched report.
Review changes before publishing; do not automatically publish wiki updates.
Add reviewed ambiguous variants through `wiki-catalog-overrides.json`, including
the specific wiki page and evidence. The importer rejects duplicate page use.

## User-visible changes

- Share outfit copies the currently selected outfit. A selectable text field
  remains available if clipboard permission is unavailable. Public and developer
  links retain their respective paths; camera parameters are preserved.
- Short links use `#/?o=2.<codes>`. Readable links use `?look=2.<name--code>...`.
  Both carry their data directly, without a link-shortening service or database.
  Readable labels do not control identity: a renamed cosmetic still decodes by
  its stable suffix. All existing `?outfit=1...` links remain supported.
- `share-item-ids.json` is append-only. Never reorder, delete or reuse an item
  or slot entry, including retired items. After importing new items, run
  `npm run sync:share-ids`. Frozen link fixtures protect the first release;
  the Share link compatibility workflow compares the entire registry against
  each PR's base, protecting subsequent additions too. Future codecs must keep
  the v1/v2 decoders and registry; do not migrate by reassigning old codes.
- Known wiki identities are retained by page ID during refresh, so changing a
  wiki name or adding another same-name variant does not unmatch an existing
  public item. Explicit hidden/unreleased flags still exclude an item publicly;
  old links preserve the remaining selections and explain omitted items.
- Public links drop unavailable IDs and explain omissions. Empty shared builds
  remain empty instead of silently substituting the default outfit.
- The 3D status filter uses the same verdict as its badge and combines with
  category, search and 3D-only filtering. Unknown status data is grey, not an
  incorrect red claim. Existing green/blue/purple/red verdicts are unchanged.
- Shader and source-data downloads retry network errors and transient HTTP
  failures at most twice. Permanent missing files, long rate-limit delays,
  malformed data and shader integrity failures are not silently accepted.
- A failed preview offers Retry preview and explains that a previous selection
  may still be visible. The error no longer covers the whole orbit-control area.

## Verification and remaining uncertainty

- 183 automated tests passed, including mapping boundaries, public/developer
  share behavior, status precedence, bounded retries and permanent failures.
- Browser checks passed for startup, selection, sharing, filters, public link
  exclusion, developer HTML noindex, rapid switching and no Netlify requests.
- Injecting two HTTP503 responses for the pink boombox shader metadata recovers
  automatically. A persistent HTTP503 stops after three attempts; removing the
  injected outage and clicking Retry preview recovers without a page reload.
- Natural live switching across all 18 lower-back items passed earlier. The
  user's original intermittent failure has not been reproduced naturally;
  this change improves recovery, not a proven diagnosis of a hosting defect.
- The seven existing reconstruction regression outfits are exercised through
  the developer entry so their unmatched IDs remain available.
- Claude Opus/xhigh read-only review was attempted but rejected by the existing
  allowance cap before producing any review or tokens. Reported API cost: $0;
  wall time about 2.8 seconds. No paid fallback. Astra implemented and checked
  the change. Astra preparation/repair token cost is not separately measured.

Operational screenshots, logs and failure-injection scripts remain local in
`_docs/public-catalog-2026-09-12/` in the original checkout. User functional
acceptance is pending; a PR does not authorize merging or deploying this batch.
