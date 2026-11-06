# Guided functional review — showcase animation prototype

## What you are checking

The 3D character plays the game's outfit-screen idle by default, plus outfit reactions and all 229 Season 12
emotes, picked from the game's icons. Every equipped cosmetic follows. Emotes show their props (cups, swords,
wings, hologram partners…) in the hands or places the game puts them; effects are not shown and each emote says so.
Twisted wrists and bent elbows keep their shape (the game's deformation rig, ported). One click returns to exactly
today's still pose, and the choice is remembered. Turning the view swings tails and hat tips. This catches
cosmetics left behind, props in the wrong place or time, pinched joints, a picker that hides the character or
mislabels what is missing, a still choice that is forgotten, or a pose that does not come back.

- PR / originating issue: none (prototype; no PR requested)
- Test this revision: uncommitted working tree of branch `claude/agitated-northcutt-fbe7d2`, base `11b4185` (main
  after PR #19), worktree `E:\Coding\the-finals-outfit\.claude\worktrees\agitated-northcutt-fbe7d2`, clip set `set-5`
  with props `props-7`
- Open: http://127.0.0.1:5181/?reconstructed=1 (dev server from this worktree; the `?reconstructed=1` gives the
  production rendering path in dev)
- Prerequisites: the root checkout's `public/models` (read-only) and the clips in this worktree's `public/animations`
  — both already on disk. Nothing to download.
- Approximate hands-on time: 12 minutes
- Agent checks: PASS. Covered:
  * Props (6 Nov): 23 emotes × 2 angles captured and reviewed by eye at full size (static props on sockets,
    skeletal props on the emote's own prop clock, hologram partners, six character-space props, hidden sections);
    four placement bugs found that way and fixed (README "Emote props"); positions measured against the hands in
    the running app; 7 new tests.
  * Joints (6 Nov): before/after pairs for wrist, elbow and knee; still pose restored exactly (397 bones, worst
    difference 0); 4 body-backed rig tests. Full suite 664/677 (8 asset-fixture failures unrelated, 5 skipped),
    typecheck clean.
  * Emote picker captures at desktop and phone width (open, search, complete-only, playing, More, closed with a
    prop emote), plus 8 new emotes × 2 angles, all reviewed by eye.
  * A crossfade bug those captures exposed (a replaced emote kept running), fixed and covered by a test.
  * Earlier: captures of 7 outfits × 3–5 clips × 2 angles reviewed by eye, live (moving) captures of 3 outfits, bit-exact restore after Stop (both render paths), accumulator/`?temporal=0`, unequip during playback,
  idle autostart in the in-app browser, turn sway measured with a real drag (33 cm tail swing, 0 with sway off),
  moving-view smoothing (38 GPU checks; the still view's 100 GPU checks unchanged; grain −97%, no trails), 16 new
  tests, full suite 657/666 (8 asset-fixture failures unrelated), typecheck and production build clean. Details:
  [README.md](README.md).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If this session's preview server is still running, port 5181 is already up: skip to step 1. Otherwise, in
**PowerShell or Git Bash**, working directory `E:\Coding\the-finals-outfit\.claude\worktrees\agitated-northcutt-fbe7d2`:

```bash
node _docs/showcase-animation-2026-11-05/serve-5181.mjs
```

Stop it with Ctrl+C. It does not touch the main session's 5174 server. In dev mode a "Recovered shader · preview
lighting" panel shows at the top left; that is the existing developer panel, not part of this change.

## Try it yourself

- [ ] **1. Start:** open the URL, press Esc on the welcome screen. Expected: once the outfit has loaded the character
  relaxes from the usual arms-out pose into the outfit-screen idle by itself and keeps moving subtly; under the
  **Studio** button: **Pause**, **Animated** (red square), **Emotes** and **Sway · approx.** (If Windows "Show
  animations" is off, the page respects reduced motion and stays still: click **Animate** instead.)
- [ ] **2. Turn:** equip **Lower Back → Tale of the Tiger** (search "tiger"), then drag the view quickly left or right
  and let go. Expected: the tail swings out behind the turn and settles back within a second or two. With
  **Sway · approx.** off the tail stays rigid on the hips.
- [ ] **3. Emote picker:** click **Emotes**. Expected: a panel of the game's emote icons appears, grouped by season
  with Season 12 first. On a wide window it sits beside the 3D view; on a narrow one it is a sheet under the view.
  Either way the character stays visible. Many tiles carry a **PROP** or **FX** badge.
  * Type `center stage` in the search and click **Center Stage**. Expected: it plays with shirt, jeans, shoes and
    face following, and the line at the bottom shows "Center Stage  RARE · SEASON 4" with "No prop or effects in
    the game."
  * While it plays, click **Valkyria's Embrace** (clear the search first). Expected: a smooth switch; about a second
    in, feathered wings appear on the back, unfold and stay spread at shoulder height (as on the emote's icon), and
    are gone after the pose; the line reads "Not shown: effects".
  * Press **Esc**. Expected: the panel closes, and the button shows that emote's icon and name with the "Not shown…"
    line under it. When the emote ends, the character goes back to the idle by itself.
- [ ] **4. Props and wrists:** in **Emotes** search `cuppa` and play **Fancy a Cuppa?**; click **Pause** once the cup
  is raised (about 3–4 s in). Expected: a teacup on its saucer in one hand, the other hand holding the tea-bag string;
  both wrists look like wrists (no twisted, pinched "candy wrapper"). **Resume**. Then play **Detective Work**
  (search `detective`): a notepad in one hand, a pen writing on it. Then **Cashout Crusher** (search `cashout`): a
  translucent blue hologram partner appears and is wrestled. Each prop disappears when its part of the emote ends.
- [ ] **5. Moving vs paused:** equip **Lower Body → Short Temper Dress** (search "short temper"; a sheer mesh skirt)
  and any long hairstyle from **Hair**; watch the idle for a few seconds, then click **Pause**. Expected: while moving, the sheer
  skirt and the hair edges look smooth (no salt-and-pepper speckle) and arms leave no blurry trail; paused, the frame
  freezes and looks the same or slightly crisper within about a second; **Resume** continues from the same frame.
- [ ] **6. Outfit change while animated:** with the idle playing, equip **Headwear → Casual Hat Wool** (search
  "casual hat"), then in **Emotes** search `cut down` and play **Cut Down to Size**. Expected: the hat stays on the
  head and the tail on the hips through the whole emote, and the katana stays in the hand (a gold coin flipped above
  the head is cut in two; zoom out to see it).
- [ ] **7. Back to still, remembered:** click **Animated**. Expected: a smooth return to the arms-out still pose
  (hat and tail where they were). Reload: it opens still and stays still. Click **Animate**, reload again: it opens
  with the idle playing.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" or e.g. "4 fails:
the cup floats beside the hand." A real-phone check is not part of this list: the server listens on 127.0.0.1 only.

## Recorded result

- Tested revision/build: uncommitted working tree of `claude/agitated-northcutt-fbe7d2` (base `11b4185`), clips `set-5`,
  props `props-7`, dev server 5181. The server script was changed the same day (Vite publicDir off, same files
  served); the app code did not change.
- User reported at: 6 Nov 2026, about 13:00 (London), in the Claude session: "tested all steps, seems good"
- Passed / failed / untested step numbers: 1-7 passed; none failed; none untested
- Defects the user noticed alongside (not checklist failures; the user chose "publish as is, fix later" for the emote
  ones):
  * The image flickers while a drag slows to a stop, and when the browser window changes shape (Firefox: pressing
    Alt shows the menu bar). This was an escaped defect from this branch, not a pre-existing one as first reported.
    The still view drew partly converged frames too bright. Fixed on branch `claude/still-view-flicker-2026-11-06`
    (README "Fix (6 Nov)").
  * Valkyria's Embrace: the wings look wrong (mesh or effect; no in-game reference here).
  * Jetpack emote: the prop is far too big.
  * Death emote: the wings are rotated 90 degrees.
  * Other emotes have wrong props too (not listed).
- Explicitly waived checks, if any: none
- Readiness: user PASS on the dev build; the user asked to publish as is (6 Nov)
- Merge authorization: "lets just publish as is imo for now then fix more later", then "Yes, publish" and "Merge
  when green" (6 Nov)
- Merged: PR #22 as `e9f870e` on 6 Nov 2026 at 13:30 UTC, after CI (`build`, `compatibility`) passed at head
  `e99a377`. Animation host `cd858839`.
- Live-site agent check (6 Nov, after deploy run 42226092408 succeeded):
  * https://chronohaxx.github.io/the-finals-outfit/ serves `index-Czpohymp.js`, which names the animation host.
  * Played headless, Fancy a Cuppa paused with the cup, saucer and tea bag in the hands (screenshot reviewed by eye).
  * 54 animation-host responses, all 200; no console errors (`publish/live-check.json`).
  * This is agent PASS only. The user has not re-checked the live site.
