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

M5 (materials pipeline) has shipped: 2,531 of 2,866 items carry a 3D model, with
per-skin baked albedo/normal/orm sets replacing the old flat region tint.

What's next, roughly in the order it's worth doing. Nothing here is committed to
a date.

**0. Lighting and tone calibration.** Everything below that touches colour is
measured against the official item icons, and that comparison is only meaningful
if this renderer's lighting resembles the one the icons were rendered with. It
currently may not: `scripts/lib/color-model.mjs` exists solely to bridge a gap
where authored colours come out brighter and more saturated in the icons than in
the raw values (`#a07819` reading as roughly `#eeb606`). That gap was attributed
to the game's shader; it has never been tested against the simpler explanation,
which is that our studio environment and exposure are darker and flatter. The
deliverable is not "nicer lighting" — it is a defensible answer to whether that
fitted colour model is a real finding about the game or an artefact of our
lighting. `?debugAlbedo=1` already renders unlit albedo, which is what separates
the two questions. **Build the light rigs and environments as data, not as
hardcoded scene code** — items 2 and 6 both need exactly this machinery.

**1. Per-item verification matrix.** `scripts/visual-diff/` scores each item's
render against its official icon, and `verdicts.generated.json` already records a
score, a category and a fix-class for 239 of them. The gap is granularity and
trust: a single score can't say *what* is wrong, and a verdict has no way of
expiring when the assets underneath it change. The plan is per-aspect marks —
position, culling, material, UV, shading, effects — each carrying who checked it
and a hash of the inputs, so any re-bake that could invalidate a mark flips it
back to unverified automatically. Everything below is easier to target, and
possible to measure, once this exists.

**2. Dev mode.** A gated in-app surface for inspecting and marking a single item:
swap parameters, toggle culling, see the icon side by side. `?tune=1` already
does a narrow version of this for five PBR factors (see `MaterialTuner.tsx`).

**What is actually wrong with it, from using it rather than reading it** — the
panel is `absolute right-0 top-0 h-full w-[300px]` and sits *over* the canvas at
`z-20` with no way to collapse it, so it permanently occludes roughly a third of
the viewport, including part of the model it exists to inspect. Five global PBR
multipliers is also a thin surface: the parameters that decide what a garment
looks like are per-layer and per-region, and none of them are reachable.

So the first two requirements are concrete: **do not cover the model**, and
**reach the parameters that actually matter**.

**The third came from a real failure on 2026-08-15, and it reframes the item.**
Looking at a rendered helmet, the owner asked whether the visor was a separate
mesh — because something looked wrong inside it. Answering took terminal queries
through `gltf-transform`, and the answer was two defects nobody had reported:
the piece is two primitives with two materials that the runtime flattens to one,
and every mesh in the catalogue is double-sided so the shell's interior renders
through the visor opening.

**Neither was visible to any check, and neither was answerable from the app.** So
dev mode is not primarily a slider panel — it is **an inspector for what is
actually being rendered**, closer to a scene outliner than a tuner:

- the mesh tree: primitives, their materials, triangle and vertex counts
- per-material state — `doubleSided`, `alphaMode`, which maps are actually bound,
  and **which texture the runtime ended up assigning**, which is not always the
  one the asset declares
- isolate or hide a primitive, and toggle back-face culling, to see what a part
  contributes
- the item's baked textures viewable directly, beside the model

The test for this item is simple: **the owner should be able to answer "what am I
looking at" without an agent running a query.** Every question that needed a
terminal to answer is a requirement.

**3. Mesh culling.** Two separate problems that need separate treatment.

*Body culling* — the base body poking through clothes: feet inside shoes, legs
through trousers. **The runtime supports this and it is roughly half-done.**
`CharacterRig` maps any equipped item to a `<name>.bodymask.png` sibling and
discards the body texels it covers, and 392 such masks already exist — covering
**363 of the 847 distinct meshes (43%)**. The remaining 484 need generating, and
none of the existing ones has ever been checked. Generating them is a coverage
bake from the garment mesh onto the body's UV, which the existing Blender
conversion step can do. Per mesh, and machine-checkable.

*Garment-vs-garment clipping* — a coat sleeve through an undersuit. This is a
property of a **combination**, not of an item, so it cannot be tracked per item
and should be sampled across common pairings instead.

**The game already ships the rules for both, and this repo already extracts
them.** `scripts/customization.generated.json` holds the per-item customisation
DataAssets, of 3,559 entries:

```
3,193  hideSlots   which slots this item suppresses
1,412  hideMesh    18 distinct tags — HairCovered, WristsCovered, TightPants,
                   SkirtCovered, BodyReplacement, WearingHood, RemoveTail …
2,273  shape       deformation rules, e.g. ShrinkWrap.shrink_gloves_under_jacket,
                   PushInsideClothes.push_lower_torso, PushLumbar.coat_covers_butt
```

None of it is consumed: `model.hides` is populated on **0 of 2,866** catalog
items, and `CharacterRig` carries a `TODO(clip)` where it would be read. So the
first half of this work is an import and wiring job against a closed 18-tag
vocabulary, not a research problem.

`shape` is the interesting half. The game does not only hide meshes — it deforms
them, shrink-wrapping gloves under a jacket rather than hiding either. That is
real work to implement, but the per-item rule list is already on disk, so it is
implementation rather than reverse-engineering.

**4. Save and share, finished.** The share codec is done and shipped —
`?outfit=` carries a versioned, slot-named payload (`src/lib/outfit.ts`), and the
schema already reserves `dyes` and `presetName`. What's missing is the surface:
a copy-link control, and named local saves.

**5. Hair and effect dynamics.** Hair renders as static alpha-tested cards with
no motion. Separately, ~860 material instances carry time-driven shader effects
that currently render as a still frame — `ShimmerIntensity` (861),
`ShimmerRotationTimeMultiplier` (857), `FakeReflectionCubemap` (809), plus a
handful of `Animation` / `Pos Tex` / `Rot Tex` bindings. Those parameters survive
extraction and are self-describing, so a generic reconstruction is tractable. A
few bespoke shaders are not: the lava and lava-lamp materials expose *no*
parameters at all, so nothing can be inferred and only eyeballed approximation is
available.

**Multi-part pieces are flattened to one material.** A helmet is one mesh with two
primitives — shell (6,570 tris, `MI_Helmet_Helmet`) and visor (976 tris,
`MI_Helmet_Visor`) — but `CharacterRig` assigns the baked set to *every* material
on the mesh:

```js
for (const m of mats) { std.map = baked.map; ... }   // src/rig/CharacterRig.ts:807
```

So the visor is painted with the shell's texture. **5 of 40** sampled cosmetics
have more than one material, and all of them lose the distinction. The bake is
the other half of it: `readMI` takes the first material instance carrying layered
parameters, so a piece's second material is never even read.

**Every mesh is double-sided.** 40 of 40 sampled cosmetics have `doubleSided:
true` on every material, applied blanket at conversion. That is correct for
chainmail, cloth and hair cards, and wrong for a closed solid — through a
helmet's visor opening you see the interior of the far side of the shell, which
reads as stray geometry inside the item. It also costs fill rate everywhere.
Both are visible on `racing-helmet-carbonfiber`.

**`M_LEDScreen` is a third material family and nothing reads it.** The racing
helmet's visor is its own material instance parented to `M_LEDScreen`, separate
from the helmet shell, and it carries an animated sprite sheet rather than a
static map:

```
textures  Animation, ColorRamp, Normal, Roughness
scalars   AnimationTrack, FrameCount, TrackCount, Brightness,
          ColorSHiftSpeed, AnimationSpeed, FlickerSpeed,
          UVScale, UVOffsetV, VerticalFade, HorizontalFade
```

`bake-composite` reads **one** material instance per skin and takes the first
that carries layered parameters, so a piece whose parts use different masters
loses all but one of them. The visor is skipped entirely, which is why the helmet
renders with a plain dark band where the icon shows an orange LED pattern.

Note this one **does** have a static reference: the icon shows a frame of the
animation, so the still appearance is checkable even though the motion is not.

**Note this breaks the verification method.** A still frame cannot show whether
motion is right, and the official icons are static too — so for animated effects
there is no ground truth in any source we hold. These need their own status
(static-verified / motion-unverified / motion-approved-by-human) rather than a
plain pass/fail, or they will either sit permanently unverified or be marked
verified on a still frame while the motion is wrong.

**6. Scene editor.** A user-facing sandbox: swap backgrounds including 360°/180°
panoramas, add and move lights, frame a shot. Mostly a UI over item 0's
machinery, which is why that one says to build environments as data. Scene state
can ride the existing share codec as additional fields, turning "share your
outfit" into "share your shot" without a second system.

**Decide this before building it:** once users control lighting, "correct colour"
stops being well-defined, because every verdict in item 1 is relative to one
lighting setup. There must be a single canonical reference preset that
verification always uses and users cannot alter; everything else is a creative
departure from it. Left until late, this makes the matrix's colour marks
uninterpretable.

**7. Emotes.** Deliberately last. The rig poses a shared skeleton but has no
animation playback, so this is the only item that needs a genuinely new
subsystem rather than an extension of one.

### Why the detail normals are switched off

`bake-composite.mjs` sets `normalStrength` and `macroNormalStrength` to `0`, and
that is **correct, not a fudge** — though the reason was only established on
2026-08-14 and the source comments blamed the symptom rather than the cause.

The garment materials tile their detail normal aggressively: the Sentinel Top's
layers declare `DetailTiling` of **20**, and layers 4 and 6–8 declare **60**. In
engine that is fine, because the tiled map is sampled per-pixel at screen
resolution — the whole point of tiling is that the detail can be finer than any
atlas.

This pipeline bakes into a fixed **1024px** UV0 atlas, so a 20× tile gets about
51 pixels and a 60× tile about 17. Fine fabric weave aliases into coarse
quilting. Measured directly: re-baking the Sentinel Top with the authored
strengths restored changes 26% of the rendered pixels and covers the garment,
belt and shoulder pads in a visible waffle.

**So this is an architectural limit of baking to UV0, not a tuning problem, and
no constant fixes it.** Real surface detail needs the tiled normal applied at
*runtime* with its own texture repeat, the way the game does it — a second
normal sampled per-pixel rather than folded into the atlas. Baking at 4096 would
soften the aliasing at 16× the memory and still not reproduce it.

### Known gaps

The render-vs-icon census sits at a mean score of ~61/100 across 239 sampled
items, with colour accuracy the largest single category of failure. Some of that
is structural rather than fixable: the master material's node graph does not
survive extraction, so every material here is a reconstruction fitted against
the icons rather than a decode. See `finals-re-kb` for the format research this
is built on.
