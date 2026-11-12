# Chinals emote props rebuilt: props-3 (12 Nov 2026)

**Result: Chinals mode now loads its props from `props-3`, built with main's prop builder.** That builder has PR #39's
placement fixes and PR #42's root-scale fix. Five Chinals emotes show their props the way the game data places them.
The clips (`set-3`) and every prop window are unchanged. Published on the owner's "Yes, publish it".

## What changed (props-2 → props-3)

Of 54 prop GLBs, 31 are byte-identical and 7 have only a new buffer layout (the same scene once decoded). 16 changed:

| Emote | Before → after | Cause |
| --- | --- | --- |
| 体面送走 (A Dignified Send-off) | A palm-sized soil patch (18 × 21 cm) → about 53 × 59 cm; the hoe lands in it | PR #42: the actor's root template scale (0.35) is left out; the spawn notify's 0.4/0.4/0.35 places it |
| 警察异头动作 (police emote) | The hologram partners' MP5s lay on the floor → held at chest height | PR #39: Blueprint child components hang from the hidden leader's `weapon_root` |
| One-Tap | The KS-23 barrel sat apart from the receiver → one assembled shotgun | PR #39: the barrel rides bone `weapon_barrel` |
| Courtesy First | The pistol slide hung beside the frame (3.0–6.1 s) → one assembled pistol | PR #39: the slide rides bone `weapon_slide1` |
| Fire Support | Minigun assembled in both; the barrels now turn with bone `weapon_barrels` | PR #39 |
| Crow Takes Flight, Little Painter, Red Card, Lifting the Cup | Identical | Hologram proxies sit under their (identity) leader node; float-noise root scales dropped |

- `emotes` (every window's socket, timing and transform), `sockets` and `skipped` in `props.json` are identical to
  props-2, so `set-3` (whose attach bones come from the sockets) stays valid.
- Nothing from PR #39's other two fixes applies here. No Chinals prop AnimBlueprint has a ModifyBone root override, and
  no Chinals spawn notify has a `CurveDrivenTransformPrefix`.
- **Correction:** `_docs/emote-prop-placement-2026-11-11/README.md` (PR #39) calls Terracotta and TaoistPriest
  "unchanged". Their weapon parts did move; it only shows inside the short pistol window and close to the KS-23.

## Checks (agent)

- **Reproducible:** against PR #39's offline Chinals build, only the soil and three float-noise roots differ (PR #42's
  share); the other 50 GLBs are byte-identical. Main's survey matches PR #39's byte for byte. 0 missing textures.
- **By eye, local:** headless Chrome, before (props-2) and after (props-3) for the 9 emotes with a changed GLB, 4
  moments × front and side, plus a ground view, a wide view, the pistol window and a KS-23 close-up. Every frame read
  at full size; the table above is what they show.
- **Hosted:** `verify-hosted.mjs` found all 143 files byte-identical, GLBs `model/gltf-binary` with CORS `*` and
  immutable caching, and 404 for a missing file.
- **App:** this branch's app with `VITE_CHINALS_ANIMATIONS_BASE` set to the new host, at `#/chinals`: 体面送走, the
  police emote, One-Tap and Courtesy First all showed the fixed props. All 32 Chinals files came from the new host,
  none from props-2, with no failed requests or console errors.
- **Not checked:** in-game footage. The soil size follows PR #42's rule; the emote icon is a pictogram and can't
  confirm it. Unchanged and not investigated: Little Painter's barbecue skewer stands upright on the floor in front of
  him in both builds.

## Published (12 Nov 2026)

- **Host:** `https://e7796a7c.the-finals-outfit-chinals-assets.pages.dev/` on the `the-finals-outfit-chinals-assets`
  Pages project, branch alias `chinals-1112-props-3`, wrangler 4.131.1, no `--force`.
- **Contents:** `manifest.json` (the previous manifest with only `"props": "props-3/props.json"` changed), `set-3/`
  (identical to `dcb131a5`), `props-3/` and `_headers`: 143 files plus `_headers`, 61 MB. Wrangler uploaded 25 new
  files (the 23 changed GLBs, `props.json`, `manifest.json`); 118 were already on the project. Screened for local paths
  and names first: none.
- **Wiring:** `deploy.yml` `CHINALS_ANIMATIONS_BASE` now points at `e7796a7c`.
- **Rollback:** `dcb131a5` (props-2) is untouched; reverting the one `deploy.yml` line restores it.
- Rebuild recipe, diff tool and captures: gitignored, in the worktree that built them
  (`scripts/generated/chinals-props-3-2026-11-12/`, README there).

# Guided functional review: Chinals props-3

## What you are checking

That Chinals mode loads its props from the new host, and that the five fixed emotes show their props in place: the
checks catch a prop that is still floor-bound, mis-sized or in pieces, or a file still coming from the old set.

- PR: the PR that adds this file, stacked on PR #44 (`claude/chinals-mode-2026-11-12`).
- Test this revision: branch `claude/chinals-props-3-2026-11-12` (the head commit in the PR).
- Open: the preview below, http://127.0.0.1:5200/#/chinals.
- Prerequisites: this branch checked out with a `node_modules` junction (as in PR #44's checklist), the main checkout's
  `public/`, internet access (the clips and props come from the published hosts).
- Approximate hands-on time: 8 minutes.
- Agent checks: PASS (above).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in the worktree root of this branch:

```powershell
New-Item -ItemType Directory -Force scripts\generated\empty-global | Out-Null; $env:VITE_CHINALS_ANIMATIONS_BASE = 'https://e7796a7c.the-finals-outfit-chinals-assets.pages.dev/'; node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=scripts/generated/empty-global --proxy=https://cf84e9b6.the-finals-outfit-assets.pages.dev/ --port=5200
```

The first load takes about 30 seconds. Stop it with Ctrl+C. The preview has its own saved outfits, separate from the
live site.

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:5200/#/chinals. Expected: Chinals mode (banner under the top bar); Emotes
  says "Chinals emotes · 45".
- [ ] **2. 体面送走 (search `send-off`):** play it and pause around 5–6 s. Expected: a patch of soil about two shoe
  lengths across lies on the floor beside him, and the hoe strikes into it. Before, it was palm-sized.
- [ ] **3. Police emote (search `police`):** pause around 4 s. Expected: both cyan hologram partners hold an MP5 at
  chest height; no gun lies on the floor.
- [ ] **4. One-Tap and Courtesy First:** pause One-Tap around 3 s and Courtesy First around 5 s. Expected: the
  shotgun and the pistol are each one solid gun, with no barrel or slide hanging apart.
- [ ] **5. Unchanged emote, then stop:** play Unchained (bat in hand), then stop the emote. Expected: the bat is
  in hand; after stopping, the Chinals idle with no prop left behind.

If something fails, stop at that step and report its number and what happened ("1-5 pass", or "3 fails: …").

## Recorded result

- Tested revision/build: pending.
- User reported at: pending.
- Passed / failed / untested step numbers: 1-5 untested.
- Explicitly waived checks: none.
- Readiness: pending.
- Merge authorization: not yet given.
