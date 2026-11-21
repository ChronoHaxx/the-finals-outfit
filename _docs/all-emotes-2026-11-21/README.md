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
- Floss: no name or description in either build mentions it. Gacha_01 is not it (`sheets-floss/`, hands at chest
  height). Likely candidate: Street Grooves (`NotEDance`, S1, in both clients). **Not yet checked by eye.**

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

## Next

1. Merge into a superset of the live host. **The live host 17ec92c3 was uploaded from
   `reverent-cannon-ce6e39/.../upload/anim-20261115e`, not `anim-20261112c`** (its manifest matches live). Verify it
   byte for byte against the host first (`verify-hosted.mjs`). New dirs: `set-6` (set-5 + set-new + icons), `props-10`
   (props-9 + new actors, live entries win), `faces-2`, `sounds-2` (sounds-1 + new keys), manifest with the 66 new clip
   entries replacing the 8 unlisted ones (same ids).
2. Picker (`src/components/EmotePicker.tsx`): the in-game emotes group by season; an **Uncategorised** group for emotes
   without an icon (Chinals generic-icon ones; unlisted animations such as `tap-dance`).
3. Check in the real app (`serve-preview.mjs`, `?reconstructed=1`): contact sheets (`capture-sheet.mjs`) of the new
   emotes and props; confirm or rule out the floss.
4. PR with user checks (`_ops/templates/pr-functional-review.md`); ask the owner to approve the upload (host, size,
   changes) and decide on the 18 held items; message coordinator local_5cf48e40.
