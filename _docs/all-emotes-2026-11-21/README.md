# Every emote in the picker (21 Nov 2026, in progress)

Shocka's feedback item 1 (`_docs/feedback-shocka-2026-11/README.md`). Branch `claude/all-emotes-2026-11-21` off main
0951e1b. Outputs are in this worktree's gitignored `scripts/generated/all-emotes-2026-11-21/`. Nothing is uploaded.

## Why Seasons 1-2 were missing

- The game has two families of emote items, both of class `CharacterInGameEmoteDataAsset`:
  - `DataAssets/Emotes/<Id>/DA_Emote_<Id>`: 247 today;
  - `DataAssets/Emotes/InGame/DA_InGameEmote_<Id>`: 66, the Season 1-2 emotes and a few later ones (Abracadabra S11).
- The 5 Nov inventory read only `DA_Emote_*`. Eight `InGame` animations (Wave, Clap, Flex...) were already in the base
  clip list, so they showed as "unlisted", with no name or icon.
- **The 17 Nov update broke the 12.00 mapping for this class.** `EmoteAnimSequence`, `RandomEmoteAnimSequences` and
  `LoopingAnimation` became soft references. Read as hard references, every later field shifts, so items read as no
  animation, Common, DeveloperOnly and no season. `scripts/anim-export/patch-usmap.mjs` fixes those three types in a
  copy of the mapping (`research/discovery_12.00-emote-soft-4.usmap`). Check: all 229 old items match their 5 Nov read
  (sequence, rarity, availability, tags), 0 exceptions.
- The exporter gained an `imports` mode (name map and imports, which need no mapping); it showed the soft path.

## Census (`research/inventory-1/census.md`)

313 items, all `UserFacing`, all with their own icon. Against the live host 17ec92c3: 229 listed, 23 present only as
an animation, 61 missing.

- 66 to add: the `InGame` family. Ids kept for share links: `wave`, `victory`, `skeleton-dance`, `clap`, `flex`,
  `face-palm`, `shadow-boxing`. TapDance plays `NamaKick_00`, not the live `tap-dance` clip, so its id is `tama-kickoff`.
- 18 held (`emotes-1/held.json`): 16 esports-2026 emotes, Gladiator and MajorPass26, added 17 Nov. Their names are
  still placeholders (the item id), so they look unreleased (Major, 27-29 Nov). **The owner decides whether to list them.**
- Not offered yet: `RandomEmoteAnimSequences` (the game picks one of several, e.g. ActionFigure, the esports emotes)
  and `LoopingAnimation`.

## Chinals

- The Chinals client has 256 `DA_Emote` and 66 `DA_InGameEmote` items. Chinals mode lists the 45 Chinals-only ones;
  the other 277 are global emotes, which global mode lists after this change.
- Five Chinals emotes use the generic store icon (`T_UI_Icon_General_Emote`): Campus_Left, CLittlePainter_01,
  Gacha_01, PolicePTU, SpaceBotanist. They belong in the Uncategorised group.
- **Floss: no emote in either client is a floss.** No name or description mentions one. A motion scan
  (`floss-scan.mjs`: both hands on the same side of the hips, switching sides) over all 296 global and 45 Chinals
  emote clips finds at most 2 side switches per clip; a floss makes 10 or more in a few seconds. Gacha_01 works its
  hands at chest height (`sheets-floss/`); Street Grooves (`NotEDance`, S1, in both clients) keeps each hand on its own
  side (`hand-trace.mjs`). Our Chinals client copy is from 29 Oct 2026. So the floss in the store video is another kind
  of cosmetic (the game also has squad-intro animations, `BP_SquadIntros_*`), or it was added after 29 Oct; checking
  that needs a newer Chinals pak.

## Built so far (all byte-checked where possible)

| Step | Output | Check |
|---|---|---|
| Item DAs, UI metadata | `research/json-items-4`, `json-das` | 229/229 match 5 Nov |
| Catalog of the 66 | `emotes-1/` (clips.json, emote-catalog.json, icons) | |
| Clips | `run-1/` (59 exported), `set-new/` (59 converted) | re-converting clap, ace-pilot, outfit-idle from today's paks gives the live set-5 files byte for byte |
| Props | `props-research/`, `props-new/` (55 GLBs, 18 MB; 16 effects-only skipped) | 5 actors overlap live props-9: keep the live ones |
| Faces | `faces-2/` = faces-1 + 59 curve files | `build-face.mjs --from` regenerates 3 published curve files byte for byte |
| Sounds | `sounds-new/` (63/66 with sound, 97 waves, 4.86 MB) | overlapping cues/waves identical to the 12 Nov dumps |

Note: BP_Emote_FoxChicken_Prop is 5.9 MB (its plushie animation is stored at 1920 fps); left as the game stores it.

## Staged deployment (not uploaded)

`upload/anim-20261121a` (`stage-superset.mjs`): every file of the live host 17ec92c3 at its path, byte for byte, plus
`set-6/` (set-5 + 59 clips + 66 icons), `props-10/` (props-9 + 50 GLBs), `faces-2/` and `sounds-2/`; the manifest
points at them. 2,587 files, **323 new (35.4 MB)**; the rest dedupe on upload. 304 clips: the 7 live "unlisted"
entries became named emotes (ids kept) and 59 were appended. Live wins every overlap; one differs and keeps the live
copy (`BP_Emote_LeanOnWall_Prop.glb`, shared with a live emote).

Checked first: the live host 17ec92c3 equals `reverent-cannon-ce6e39/.../upload/anim-20261115e` (1132/1132,
`upload/verify-live-17ec92c3-vs-15e.json`), not `anim-20261112c` as the brief said. After an upload: run
`verify-hosted.mjs` against the new host, bump `ANIMATIONS_BASE` in `deploy.yml`, and re-run the checklist on a
production build.

## Picker

`emoteGroups()` in `src/components/EmotePicker.tsx`: seasons newest first (now with Seasons 1 and 2), the Chinals set,
then **Uncategorised** for emotes without an icon of their own (none, or the store's generic card
`T_UI_Icon_General_Emote`); a tile with no icon says so. Tests: `tests/rig/emote-groups.test.ts`.

## Verification (agent, 21 Nov)

- Census: 229/229 old items read as on 5 Nov with the patched mapping; 0 exceptions.
- Pipelines against live bytes: 3 re-converted clips, 3 regenerated face-curve files, 8 waves and 8 cue/wave dumps are
  identical to the live or 12 Nov files.
- `tsc -b` clean. `npm test`: 899 pass, 8 known failures (gitignored model files, ski-blade fixture).
- Real app (`serve-preview.mjs` on the staged set, live model hosts, `?reconstructed=1`, headless Chrome): Emotes 295
  with Season 2 · 16 and Season 1 · 41; Chinals mode ends with Uncategorised · 5 (`picker-shots/`). Coop Caper's
  plushie and Gimme Five's hologram partner look right (`sheets-new/`).
- Preview trap: the dev server needs `VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json` and the
  asset hosts from `deploy.yml`, or the outfit fails ("Skin pair requires its preserved fitted body"). The root
  checkout's `public/models/body` was mid-rewrite by another session, so models come from the live hosts.

User checks: [functional-checklist.md](functional-checklist.md).
