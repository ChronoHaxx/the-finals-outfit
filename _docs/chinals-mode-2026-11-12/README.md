# Chinals mode, emotes first (12 Nov 2026)

**Result: the builder has a labelled Chinals mode at `#/chinals`. It plays the 45 Chinals emotes on the visitor's
outfit. Its emotes are published on their own host, and merging this PR turns the mode on.** The site owner chose option B ("labelled
Chinals mode") from the Chinals intake decisions. The intake notes stay outside the repository, since they concern
the community member who supplied the files. This first step is emotes only: there are no Chinals cosmetics on the
site yet.

## What a visitor sees

- **A switch.** The top bar shows `Global | 终极角逐 Chinals`; on phones it gets a row of its own under the header. It
  is hidden while the mode is off.
- **A banner** in Chinals mode. It says what the Chinals is, that the files come from the China client, that most
  items can't be obtained outside China, what is and isn't shown, and that the outfit is made of global items.
  "More" opens the rest. The wording is a draft for the site owner (see the open decisions below).
- **The Chinals emotes** in the usual emote picker, under "Chinals emotes · 45", with their icons:
  - 21 carry the game's own English name.
  - 24 have only a Chinese name in the game. The tile shows the Chinese name; the detail line adds this site's own
    translation, marked "unofficial translation by this site".
  - Every Chinals emote is marked "Chinals exclusive". Chinese text is tagged `lang="zh-Hans"` and set in the system
    Simplified Chinese fonts, so shared Han characters don't take their Japanese forms.
- **The same outfit in both modes.** Switching changes the emote set only. The character is not reloaded.

## How it works

- **The route is the mode** (`src/lib/site-mode.ts`). `#/chinals` is the builder in Chinals mode; `#/` stays global.
  Both are children of one layout route, so the same Builder and 3D viewer stay mounted across a switch.
- **One build for both modes.** The design sketch gave each mode its own outfit. With no Chinals cosmetics, a
  Chinals-only outfit would be an empty character, so both modes dress the character from the one global build.
  The switch never touches the build store, the saved outfits or an unsaved shared-link draft. It replaces the
  address rather than pushing one, keeps the draft's `?o=` and drops the pose, since a pose names the other mode's
  emotes.
- **Links keep today's form.** Share links stay `#/?o=2.…&emote=…`, the form the share Worker also writes. A pose
  naming a Chinals clip (every Chinals clip id starts with `cn-`) is what opens Chinals mode, so the Worker and the
  link format are unchanged. Clip ids are therefore part of the link format: a set rebuild must keep them
  (`chinals-emote-set.mjs` refuses to change one).
  - Every place that read only `#/?` now accepts exactly `#/?` and `#/chinals?`, never a roadmap address.
  - Tidying a link away keeps the mode.
  - The roadmap has a Chinals twin (`#/chinals/roadmap`) so "Back to your outfit" returns to the same mode.
- **Animator swap.** `useRigAnimator(base)` loads the set for the current mode. On a switch it is null at once,
  the old animator is disposed, and the new set starts from its own idle (or a link's pose).
  - `RigAnimator.dispose()` bumps the request counter before resetting. A clip still downloading therefore returns
    without binding, instead of building a mixer on the shared body that nothing updates.
  - A Chinals pose that arrives on the global set waits in `share-pose.ts` until the Chinals set has loaded. It is
    never taken and dropped by the global viewer.
- **Off switch.** `VITE_CHINALS_ANIMATIONS_BASE` (deploy variable `CHINALS_ANIMATIONS_BASE` in `deploy.yml`) turns
  the mode on. Blanking it turns the mode off. With the mode off:
  - the switch is hidden;
  - a `#/chinals` address, or a link with a Chinals pose, shows "Chinals mode isn't available on this site right
    now…", keeps the address, and still opens the outfit.

Fable reviewed the plan before the build (about $2.06). It found the pose-dropping path, the late-download bind and
the replace-not-push point, and suggested keeping the link form.

## The Chinals set

`scripts/anim-export/chinals-emote-set.mjs` adds the picker's metadata to the converted Chinals clips:
- names from `emote-names.json`;
- Chinese descriptions from `DA_UIMetaData_Emote_*`, used for search;
- props and effects from the sequences' notifies;
- 41 icons decoded offline from the local Chinals paks with ChinalsProbe's texture mode.

It writes a new set directory (`set-3`) and keeps the previous manifest as `manifest.set-2.json`. The output is local
and gitignored (`scripts/generated/chinals-emotes/`). The props are `props-2`, built before PR #39's placement fixes
(AnimBlueprint root overrides, curve-driven props, child components). The Chinals props were checked by eye and look
right; a rebuild with those fixes would be a new `props-N`, on a new deployment.

## Agent checks (12 Nov 2026, branch `claude/chinals-mode-2026-11-12` on main `b930467`)

- **Type check:** `npm run typecheck` PASS.
- **Tests:** `npm test` 813 pass, 8 fail. The 8 also fail without this change: the worktree lacks the ski-blade
  fixture and `public/models/body/SK_Body_M.glb`.
  - New: `tests/chinals-mode.test.ts` (route grammar, Chinals links, the tidy-up staying in the mode, switching
    with an unsaved draft and a reload) and a dispose case in `tests/rig/rig-animator.test.ts`.
- **Browser, local preview with the mode on** (global emotes from the live host `fb06038b`, Chinals set local):
  - the switch, banner and picker as described above;
  - switching back to Global brings back the global idle and keeps the outfit;
  - a Chinals link on the global address, opened in the app and on a fresh load: it switches to Chinals mode, opens
    the shared outfit as an unsaved draft and holds the frame (1.5 s, frame 45);
  - a Chinals link whose outfit matches a saved outfit on a fresh load: it selects "Outfit 1", tidies to
    `#/chinals` and holds the frame (2.0 s);
  - switching to Global mid-emote with the baseball bat in hand: the bat and the Chinals-only bone go and the
    global idle plays;
  - phone width (375 px): the switch row and the banner.
- **Browser, mode off:** no switch; a Chinals link and a bare `#/chinals` both show the notice, keep the address and
  still open the outfit.
- **Not checked:** a real phone, Safari or Firefox, and the share Worker's preview card for a Chinals pose.
- **Security review (automatic, after the first push):** the preview server's `--proxy` would fetch any host for a
  request like `/animations//other-host/x`. Fixed: it fetches only plain relative paths under the proxy's own folder.

## Open decisions for the site owner

1. **Banner wording and credit.** It says "supplied by a community member". Name them, or keep it anonymous?
2. **Translations.** 24 names show this site's own translation, marked unofficial. Keep them, replace them with
   credited community translations, or show "untranslated" instead (intake decision 5)?
3. **Going live.** Done up to the merge: the set is published (below) and `CHINALS_ANIMATIONS_BASE` points at it.
   Merging after checks 1-7 turns the mode on with the banner and names as they are now.
4. **Share cards.** The Worker's card says "caught N s into an emote", and the image caption uses the emote's label.
   A card for a Chinese-named emote shows the Chinese name. Changing the Worker's text would need a Worker deploy.

## Published (12 Nov 2026, the owner's "yes please")

- **Host:** `https://dcb131a5.the-finals-outfit-chinals-assets.pages.dev/`, an immutable preview deployment on the new
  Cloudflare Pages project `the-finals-outfit-chinals-assets` (branch alias `chinals-1112-emotes`, wrangler 4.131.1).
  - Wrangler 4.131.1 now hands new Pages projects to Workers and failed there, so the project was created with
    `--force` as a classic Pages project, like `the-finals-outfit-assets`. Later commands need no `--force`.
- **Contents:** `manifest.json`, `set-3/` (46 clips, 41 icons), `props-2/` (54 GLBs and `props.json`) and `_headers`
  (CORS `*`, a year's immutable caching). That is 143 files, 61 MB. Before upload the manifests were checked for local
  paths and names: none.
- **Checks:**
  - `verify-hosted.mjs`: all 143 files byte-identical, GLBs `model/gltf-binary` with CORS `*` and immutable caching,
    404 for a missing file.
  - The app with `VITE_CHINALS_ANIMATIONS_BASE` set to the host: a Chinals link opened the mode and held Unchained at
    3.00 s with the bat in hand, every Chinals file coming from the host.
- **Wiring:** `deploy.yml` sets `CHINALS_ANIMATIONS_BASE` to the host, so merging turns the mode on. A later set needs a
  new deployment and a new hash, never an overwrite.
- **Withdrawing:** blank the variable and redeploy the site (old Chinals links then show the notice, and their outfits
  still open); deleting the Pages project removes the files too.

# Guided functional review: Chinals mode

## What you are checking

That the Global | Chinals switch plays the Chinals emotes on your outfit without ever changing the outfit, and that
Chinals share links open in the right mode and frame. The checks catch a lost outfit, a stray prop or pose after a
switch, and a Chinals link dropping its emote.

- PR / originating issue: not opened yet (intake decision 2, option B, 12 Nov 2026).
- Test this revision: branch `claude/chinals-mode-2026-11-12` in worktree
  `E:\Coding\the-finals-outfit\.claude\worktrees\stoic-golick-17e361`: the PR's head commit, based on main `b930467`.
- Open: http://127.0.0.1:5191/ after the command below.
- Prerequisites: the local Chinals set in `scripts/generated/chinals-emotes/` (already there) and an internet
  connection for the global emotes.
- Approximate hands-on time: 10 minutes.
- Agent checks: PASS (above).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\stoic-golick-17e361`:

```powershell
$env:VITE_CHINALS_ANIMATIONS_BASE = '/chinals-animations/'; node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=scripts/generated/chinals-mode-preview/empty-global --proxy=https://fb06038b.the-finals-outfit-assets.pages.dev/ --chinals=scripts/generated/chinals-emotes --port=5191
```

(From Git Bash, put `MSYS_NO_PATHCONV=1` in front, or Git Bash turns `/chinals-animations/` into a Windows path.)
The first load takes about 30 seconds while Vite compiles. Stop it with Ctrl+C. The preview keeps its own saved
outfits (it is a different address from the live site), so nothing here touches your outfits on the live site.

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:5191/. Expected: the builder loads; the top bar shows
  `GLOBAL | 终极角逐 CHINALS` with Global highlighted; the character plays the idle.
- [ ] **2. Switch:** click `终极角逐 CHINALS`. Expected: the banner appears under the top bar; the outfit panel keeps
  the same name and pieces; the character keeps moving (the Chinals idle). Click Emotes: the picker says
  "Chinals emotes · 45" with icons.
- [ ] **3. A Chinese-named emote:** type `heartbeat` in the emote search and click one. Expected: it plays; the line
  under the grid shows the Chinese name, "Chinals exclusive", and "Heartbeat Protocol, left/right" marked
  "(unofficial translation by this site)".
- [ ] **4. Switch mid-emote:** search `unchained` and play it. While the bat is in hand, click `GLOBAL`. Expected: the
  bat disappears; the character goes back to the global idle (no frozen or bent pose); the outfit is unchanged.
- [ ] **5. Share a Chinals frame:** switch to Chinals, play an emote, pause it with the timeline, then Share outfit
  and copy the link. Paste the link into a new tab. Expected: it opens in Chinals mode on the same paused frame.
- [ ] **6. Outfit across modes and a reload:** in Chinals mode put on a hat, reload the page. Expected: still Chinals
  mode, hat on. Click `GLOBAL`: the hat is still on, and the outfits menu lists the same outfits as before.
- [ ] **7. Mode off:** stop the server (Ctrl+C), then in the same PowerShell window clear the variable (it stays set
  for the window otherwise) and start without the Chinals set:

  ```powershell
  Remove-Item Env:VITE_CHINALS_ANIMATIONS_BASE; node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=scripts/generated/chinals-mode-preview/empty-global --proxy=https://fb06038b.the-finals-outfit-assets.pages.dev/ --port=5192
  ```

  Open http://127.0.0.1:5192/#/chinals. Expected: no switch in the top bar; a notice says Chinals mode isn't
  available; the builder works as usual.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass", or for example
"4 fails: the bat stays floating".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
