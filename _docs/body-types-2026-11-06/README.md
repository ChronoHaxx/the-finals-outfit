# Body types and archetypes (Light / Medium / Heavy): survey, 6 Nov 2026

Question (Discord user, then the user): can the outfit builder change body type and class, and is that generic or
per-outfit tuning?

**Answer.** The game makes it generic, and almost all of it is authored data. For us, the masculine/feminine switch on
Medium is small and generic. Light and Heavy are also generic in mechanism, but they need a bulk mesh extraction. They
also need every per-mesh artefact we built on Medium to be aliased or rebuilt. Hand tuning per outfit should be rare,
about 6% of meshes.

All reads are offline: the June dump, the S11 staging extraction, and the live index under `public/models/`. Nothing
was downloaded, and the game was never touched. The scripts are in `scripts/` and read the paths below.

## 1. How the game builds the three classes

| Fact | Evidence |
|---|---|
| Three bodies, `SK_Body_L/M/H`, each with its own skeleton (92 bones, identical names) | dump `Characters/Body/SK_Body_*_Skeleton.json` |
| The L and H skeletons are **exact uniform scales** of M: translations ×0.85 / ×1.15, local rotations identical (max diff 0.0) | skeleton compare (pelvis 82.8 / 97.5 / 112.1 cm; head 142.9 / 168.1 / 193.3 cm) |
| `SK_Body_L/H` bind shapes are exactly 0.85 / 1.15 × `SK_Body_M` (22,072 verts, same indices and UVs, residual 0.00 cm) | `glbcmp.py` on `season11-staging-20261018/source-glb` vs `reconstructed-meshes-v2` |
| Each body carries the same 30 `push_*`/`head_neck_match` fitting morphs (L = 0.85 × M deltas, residual 0.000 cm). The class-specific morphs are `light_male/female`, `medium_male/female`, `heavy_male/female(+_muscular)` | `morphs.py` |
| The class morphs do the real shape work. Light ≈ scaled Medium (the light morph differs from 0.85 × medium by ≤1.1 cm p99, 2.1 cm max). Heavy adds bulk: up to 8-10 cm, body depth 28 → 42 cm | `morphs.py` |
| Body type = `DA_BodyType_*`: one morph name per class, a `Customization.BodyType.*` tag, and socket offsets per class (`SocketOffsetLight/Medium/Heavy`). The muscular types are Heavy-only and add an `MI_Skin_Muscular*` material override | `definitions-v1/DA_BodyType_*.properties.json` |
| Heads are **shared** across classes; their class morphs are small neck/jaw tweaks (≤1.9 cm L, ≤4.4 cm H), not a rescale. A Light contestant has a smaller body under a full-size head | `morphs.py` head decomposition (scale ≈ 1.00) |
| Head-wrapped parts (beards, mouth scarves, balaclavas: 68 parts) have no L/H mesh; they ride the head cage | `repl.py` |

## 2. How items author it

From 3,699 definitions in the live `reconstructed-assembly-v2/customization.json`:
- **2,509** definitions carry archetype/body-type TagOverrides.
- **3,310 of 3,378** `_M` skeletal parts have explicit `Archetype.Light → SK_*_L` and `Archetype.Heavy → SK_*_H` mesh
  replacements (3,298 Light, 3,335 Heavy). The resolver already applies mesh-replacement TagOverrides; it only resolves
  in `Archetype.Medium` today.
- Per-item transform offsets, mostly static attachments: Heavy 52, Heavy+Feminine 30, Heavy+FeminineMuscular 29,
  Light 3, Masculine 2. This is Embark's own per-item tuning, and it is data.
- Material overrides keyed on archetype: only the 7 pleated skirts (combined with HideMesh.SkirtCovered).

Morph coverage of the 1,405 live source meshes: 922 skeletal meshes carry `medium_male`/`medium_female`. Only heads
and a few hairs carry `light_*`/`heavy_*`, because the live index holds only `_M` meshes.

## 3. Are the L/H meshes just scaled M meshes?

- S11 staging (both versions extracted): **186 / 209** garments have L = 0.85 × M and H = 1.15 × M exactly, with the
  same topology and UVs. The rest have different topology (5), reshaped geometry (≈8), or mixed results.
- Live set, June-dump proxy (vertex count + bounds; not a vertex-level proof): **1,424 / 1,512** have the same vertex
  count and scaled bounds. 66 differ by 1-40 vertices with scaled bounds (re-export seams), and about 22 genuinely
  differ.
- The L/H meshes carry `light_*` / `heavy_*` morphs: 193 / 207 L and 193 / 207 H in S11.

## 4. Volume for the live set

The live index's `_M` meshes need **1,878** distinct L/H meshes. 27 are already indexed (hairs), and 1,518 are in the
June dump. About 366 are S11/S12, which the S11 staging partly covers; the rest need the paks probe route
(`prepare-accessory-defaults.py extract`).

## 5. What is NOT generic for us

Our pipeline derived these per mesh on Medium:
- body masks in body-UV space;
- proxy weight transfer (#15);
- fitted/legacy mask amends;
- material slot bindings;
- attached-static frames;
- head-wraps.

The L/H bodies share UVs and topology, so artefacts can be aliased `_L/_H → _M` where a build-time check proves the
same topology and UVs. Elsewhere they need rebuilding or refusing.

Verification is the other cost. Icons exist only for one capture body, so Light/Heavy acceptance needs in-game
references (the user looks in their own client).

## 6. Season 12 (stage 1 data source)

Read offline from the installed paks with the pinned 12.00 mapping (e5b29e28), probe `properties`/`assets` mode. The
folders below are new, and the reads of meshes stay local (see `.gitignore`).

| Read | Folder |
|---|---|
| `DA_BodyType_{Feminine,FeminineMuscular,List,Masculine,MasculineMuscular}` | `s12-bodytypes-read/` |
| `DA_BodyType_Androgynous` | `s12-androgynous-read/` |
| `SK_Body_M` | `s12-body-read/` |
| 24 sampled torso garments | `s12-garment-sample-read/` |
| Face 01 head, basic tee, loose jeans, tall sneakers, short dress | `s12-review-meshes-read/` |

What changed against the stored (pre-S12) copies:
- **New body type `DA_BodyType_Androgynous`**, first in `DA_BodyType_List`. It is Medium-only (`SupportedArchetypes
  [Medium]`) with tag `Customization.BodyType.Androgynous`. It authors **no `ActivatesMediumMorphTargets` and no
  `SocketOffsetsMedium`**, so its Medium body is the unmorphed bind shape. That is the shape w134 found the item icons
  match (decision #20).
- Feminine `SocketOffsetsMedium.clavicle_attachment` changed. All types gained `hat_attachment` and
  `eyewear_attachment` (identity for Medium). The Muscular types now activate their own tags
  (`Customization.BodyType.{Feminine,Masculine}Muscular`). Masculine's Medium values are unchanged.
- No item definition uses the Androgynous tag in S12 (S12 drift over all 3,254 stored items: 2,795 identical,
  459 differ; the body-type tags used are Feminine 30 and FeminineMuscular 30, all Heavy-qualified offsets).
- **The feminine body morph was re-sculpted.** `SK_Body_M.medium_female` moved on 3,612 vertices, by up to 3.65 cm.
  Its largest delta grew from 2.38 to 4.81 cm, concentrated at chest height (120–145 cm). `push_lower_torso` moved
  ≤0.8 cm. The bind shape and `medium_male` are unchanged.
- **Garments followed.** In the sample, most tops changed `medium_female` by 3.1–3.8 cm. Several also changed
  `medium_male`, by up to 1.4 cm, so the live masculine default is slightly pre-S12 too.

### Morph-only proof

`scripts/body-types/morph-only-proof.py` checks each S12 rebuild (`build-meshes.py`) against the live mesh. A mesh
qualifies only when everything matches except morph deltas:
- every vertex attribute;
- indices;
- material slots (ignoring the texture-streaming density hint);
- skin joints and inverse binds (≤1e-5);
- morph names (compared as a set).

On those meshes, every derived artefact built on the live mesh stays valid.

Report: `public/models/s12-bodytype-preview-v1/morph-only-proof-v3.json`.
- **20 / 30 morph-only:** the body, the Face 01 head, jeans, tall sneakers, zip hoodie, oversized bomber, padded
  shirt, rolled-sleeve shirt, crop-top undershirt and 11 others.
- **10 refused:** S12 genuinely reworked them.
  - basic tee and tech crop top: new `shrink_under_vest` morph plus new geometry;
  - short dress: 9 skirt jiggle bones removed;
  - cropped tee: new thigh helper bone and new weights;
  - Asian spirit jacket: rest pose moved up to 7 cm;
  - biker hoodie: new UV set;
  - and others.

Refused meshes need the S12 item refresh route, not a morph swap.

### Preview

`public/models/s12-bodytype-preview-v1/` holds:
- `meshes/`: the 30 S12 rebuilds;
- `index-v2/assets.json`: built by `build-preview-index.py` from the active index, swapping only the 20 proven meshes;
- `index-v2/skin-pairs.json`: built by `rewrite-skin-pairs.py`, since faces load their head through skin pairs.

The body keeps its preserved path, because the rig accepts skin pairs only on it. `scripts/body-types/serve-preview.mjs`
answers that path with the S12 body. The active index is only read.

## Scripts

The survey scripts in `scripts/` are read-only, and their outputs went to the session scratchpad. The stage 1 tools are
in the repo's `scripts/body-types/`:
- `morph-only-proof.py`, `build-preview-index.py`, `rewrite-skin-pairs.py`;
- `serve-preview.mjs`: ports 5191 (live) and 5192 (S12 preview); never 5174;
- `capture-review.mjs`, `review-sheets.py`.

| Script | What it does |
|---|---|
| `morph-census.mjs <assets.json> <out>` | Morph names per indexed source mesh |
| `repl.py <out>` | TagOverride census, L/H replacement set, June-dump existence |
| `glbcmp.py a.glb b.glb [c.glb]` | Topology, UV and uniform-scale comparison |
| `triple.py <source-glb dir>` | Pure-scale classification for every L/M/H triple in a folder |
| `morphs.py <S11 source-glb> <reconstructed-meshes-v2>` | Body class-morph magnitudes, scale-residuals and extents |
| `bounds.py <repl.json>` | June-dump proxy for pure-scale (vertex count + bounds) |
