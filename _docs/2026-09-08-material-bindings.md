# Material binding correction

The remaining helmet defect crossed three boundaries: the baker selected one
material instance from a skin directory, the catalog exposed one material block
for the entire item, and the rig applied that block to every primitive. The
racing helmet's shell and visor therefore received the same textures, although
the source gives them different shaders. The old blanket `doubleSided` export
also drew the shell's interior through its openings.

The correction preserves the exported material name from source resolution to
runtime. `model.materialBindings` carries each surface's maps, shader family,
and authored sidedness. Parent material parameters and explicit instance overrides
are merged before reading them; a missing parent is unknown, while a resolved
master with no `TwoSided` property supplies Unreal's default `false`.

The layered baker writes separate sets for distinct material slots and a
`<piece>.materials.json` sidecar. The importer only accepts a matching layered
bake from that sidecar; current source shader settings take precedence. The old
piece-wide material block is retained for existing diagnostics and undersuit
selection, but the viewer uses the slot bindings when present. Ambiguous source
assignments preserve embedded materials and appear in
`scripts/material-bindings.generated.json` rather than borrowing a neighboring
surface's bake.

For the racing helmet, the shell resolves to `M_Character_8Layers_Master` with
back-face culling. The carbon-fiber visor resolves independently to `M_LEDScreen`,
also single-sided; Holtow and RaceDriver visors resolve to `M_CharacterGlass_02`,
which explicitly requests two sides. LED atlases, gradients, and glass normals
are converted from their own source references. Normal maps reconstruct Z and
flip the DirectX green channel at export.

LED stills preserve a positive authored capture time. When the default time zero
selects a blank frame, the exporter chooses the first frame with maximal lit
coverage within that screen's selected track. The viewer uses the source pixel
width and height for its diode grid. Source brightness is unchanged; the still
does not establish parity with the game's exposure or animation.

Shared material instances are applied once. Unused embedded textures and failed
partial loads are released, and inspector side overrides rebuild LED callbacks
against their cloned textures. Verification now checks every bound surface's
maps and material names; both texture bytes and binding parameters participate
in verdict invalidation. Two skins sharing a shell cannot share the visor's
verification result accidentally.

The test command now discovers tests only beneath `tests/` and `scripts/lib/`.
The previous unrestricted `tsx --test` glob walked the extracted asset tree and
could saturate disk I/O before tests started. No development-server configuration
change was needed.

## Reproduction

Source: the existing extraction under the default `FINALS_DUMP` in the scripts,
ending in `Content/Discovery/Characters`. Set `FINALS_DUMP` to use another copy.
No extracted images, textures, meshes, or rendered derivatives belong in git.

```sh
node scripts/bake-composite.mjs --piece=racing/helmet --res=1024
npm run import:catalog -- --materials-only
npm test
npm run typecheck
npm run validate:catalog
npm run build
npm run dev
node scripts/visual-diff/material-bindings.mjs --phase=after
```

The material-only import updates bindings on the existing catalog without
recreating icons, body masks, or decals. A full catalog import uses the same
binding implementation. The capture harness records live material state and
shader compilation errors alongside twelve fixed-camera images in the ignored
`visual-diff/material-bindings/` directory. Use `--resume` to continue an
interrupted capture run. Each capture requires the GLB's material names to be
present in the live scene; an idle viewer alone does not establish a successful
load. The valid carbon-fiber helmet baseline was taken before the generated
bindings and new texture sets were installed. The other initial baseline frames
had incomplete model loads and are excluded from visual comparison.

## Validation on the local extraction

- `npm test`: 82 passed, zero failed.
- TypeScript and catalog schema validation pass (2,866 items across 22 slots).
- All 2,531 modeled items carry bindings: 2,969 material slots in total.
- All 7,236 referenced binding texture paths exist and are nonempty locally.
- Removing `materialBindings` from the updated catalog reproduces the original
  catalog, including field order; no unrelated item metadata changed.
- Material map/slot checks pass for the eleven textured capture fixtures; the
  hair fixture has no external maps and correctly reports not applicable.
- All twelve final captures contain the expected GLB material names, with zero
  page or shader compilation errors. The carbon-fiber helmet shows a distinct
  diode visor instead of the shell's texture; glass visor variants stay separate.
- Production code compilation and minification pass: 636 modules, 17.55 seconds,
  using Vite's existing config with `build.write: false` and
  `build.copyPublicDir: false`. This skips copying the extracted asset tree.
  The full `npm run build` passed transformation but was interrupted during its
  bulk local asset copy to meet the requested time limit.
- The leather-black coat's white undergarment and satin coat's body clipping
  reproduce when the original HEAD catalog is served to the same runtime.
  Those control images are effectively identical (mean channel difference
  below 0.025/255) and have no runtime errors. These existing undergarment/culling
  defects are outside the material binding correction.

The resolution report retains 202 source-data diagnostics: 105 ambiguous skins,
86 source/GLB name gaps, four missing attachment texture pairs, six missing
layered bake/dye sources, and one missing LED animation. These preserve embedded
appearance where available; they are not silently assigned another surface's
textures. The material-family counts include 797 unknown bindings, many of
which intentionally retain embedded materials. This is not a catalog-wide
claim of game shader fidelity.

Remote asset availability was not checked because `ASSETS_BASE` is unset. Nothing
was committed, pushed, or deployed, and generated artwork remains gitignored.

## Fidelity boundary

This fixes material identity and source-sidedness propagation. The cooked master
shader graphs remain absent. The LED appearance is a reconstruction using the
source atlas, dimensions, timing, tint, and UV parameters; it is not a recovered
Unreal shader. Icon capture times intentionally produce deterministic stills.
Motion, fresnel dirt effects, and remaining unknown shader families must not be
described as verified by a still image. Existing color/roughness/normal tuning
constants were not adjusted to hide these structural defects.

The generated resolution report is a list of remaining source-data gaps, not a
fidelity approval of every catalog item. Embedded preview materials containing
an OCM texture are explicitly not treated as layered shaders solely because that
texture is present.
