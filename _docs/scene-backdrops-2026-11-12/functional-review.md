# Guided functional review: scene backdrops P2

## What you are checking

This check covers two in-game scenes, which you can now pick as the viewer's backdrop:
- the Season 12 menu stage, drawn live;
- the Season 12 intro tunnel, a relit image.

While a scene shows, the character turns on a turntable and the camera stays fixed.

The check catches four failures:
- a scene that looks wrong;
- feet that float off the floor;
- a turntable that drifts the camera;
- a default view that changed.

- **PR / origin:** ChronoHaxx/the-finals-outfit#57, from this branch into `main`. On 21 Nov it was rebased onto main,
  which already has #40, #46, #47, #48 and #55. On 22 Nov main was merged in at `e04075e` (multi-character Phase 1
  #66, player number #60, all emotes #62, emote early-stop #69, emote speed #58). Later that day main was merged in
  twice more: at `70b6a4d` (supersampled screenshots and video export, #63) and at `95e9bee` (the 12 Nov release,
  #67). The design is in `README.md` section 8.
- **Test this revision:** branch `claude/scene-backdrops-p2-2026-11-15`, app code at
  `863d1931c8b9987617337acb0d55b4655f7154ed` (the merge of main at `95e9bee`). Later commits on the branch that touch
  only `_docs/` leave it the same.
- **Open:** http://127.0.0.1:5243 in Chrome, served from the worktree below.
- **Prerequisites:**
  - The scene files stream from their pinned host, `scenes-1` (`1d367244`), as the models stream from theirs. You need
    an internet connection; no account is needed.
- **Approximate hands-on time:** 10 minutes.
- **Agent checks:** PASS.
  - **22 Nov, after merging main at `70b6a4d` (#63) and `95e9bee` (#67), on `863d193`:**
    - #63's conflicts: the viewer keeps main's capture driver plus the turntable's turn. The capture panel keeps main's
      Image and Video tabs, with the scene note on Image and a new matching note on Video, because an MP4 is also
      painted on the look's colours. #67's conflicts were notes only: both 22 Nov patch notes are kept, scenes first.
    - Typecheck and production build (with its roadmap and public-text checks) pass. Full suite: 1001 pass; the same 8
      fail on the absent extracted GLBs.
    - In the dev browser pane, against `deploy.yml`'s hosts:
      - the default Studio view is unchanged;
      - the Season 12 menu look shows the stage, cyan as in your menu screenshot;
      - a drag turns the character while the stage stays still;
      - the capture panel's Image tab shows the screenshot note and its Video tab the MP4 note;
      - Studio removes the stage canvas, turns the character back to 0 and stores no scene, and a reload keeps it gone;
      - the tunnel, picked and then reloaded, comes back, with the shoes on the walkway.
  - **22 Nov, after merging main at `e04075e`:**
    - One conflict, the viewer's imports. Typecheck and production build pass.
    - Full suite: 963 pass, scene tests included. The same 8 fail on the absent extracted GLBs.
    - In the dev browser pane:
      - the tunnel loads from `1d367244` with the character standing on the walkway;
      - a drag turns the character while the tunnel stays still;
      - Studio brings it back facing forward and stores no scene;
      - after a reload the scene stays gone.
  - **21 Nov, after the rebase, the scenes host pin, merging main at 0951e1b (#54, #56) and the scene-storage fix:**
    - Typecheck and production build pass.
    - Scene tests: 9 of 9 pass.
    - Full suite: 906 pass. 8 fail only because extracted GLBs (`public/models`) are absent in the worktree.
    - In the dev browser pane:
      - tunnel fit with the drawer open and closed;
      - the turn;
      - the menu stage under its look;
      - the screenshot panel's wording;
      - restore on leaving for Studio;
      - both scenes loading from the pinned `scenes-1` host (`1d367244`);
      - leaving a scene for Studio and reloading. Before the fix the scene came back; after it, Studio stays. A chosen
        scene still survives a reload.
  - **15 Nov, in the dev browser pane (synthetic mouse input):**
    - menu colours against your screenshot;
    - zoom scaling;
    - phone size;
    - persistence across a reload.
  - Not covered: real touch input, a real phone's memory, the feel.
- **User checks:** **WAIVED** by the user on 22 Nov 2026 (quoted under "Recorded result"). The agent ran steps 1-7
  on a production build instead: **agent PASS under the waiver**, not a user PASS.

## Get it running

If http://127.0.0.1:5243 already opens the builder, the agent's server is still up: skip to the checklist.

Otherwise, in **PowerShell**, run these commands. The asset hosts are the deployed ones from `deploy.yml`.

```powershell
cd E:\Coding\the-finals-outfit\.claude\worktrees\trusting-davinci-1693fd
$env:VITE_ASSETS_BASE = "https://2cbead71.the-finals-outfit-assets.pages.dev/"; $env:VITE_MODELS_BASE = "https://a029b249.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_BASE = "https://a70ffa7f.the-finals-outfit-assets.pages.dev/"; $env:VITE_ANIMATIONS_BASE = "https://fd946744.the-finals-outfit-assets.pages.dev/"; $env:VITE_CHINALS_ANIMATIONS_BASE = "https://dcb131a5.the-finals-outfit-chinals-assets.pages.dev/"; $env:VITE_SCENES_BASE = "https://1d367244.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_ROUTES_FILE = "src/data/reconstruction-routes.json"
npx vite --host 127.0.0.1 --port 5243 --strictPort
```

Stop it with Ctrl+C. The look you pick is saved in this browser for `127.0.0.1:5243` only, not on the live site.

## Try it yourself

- [ ] **1. Start: the default is unchanged.**
  - Do: open http://127.0.0.1:5243 in Chrome. Click **Enter builder** if the start page shows.
  - Expected: the builder loads with the usual Studio look. Dragging orbits the camera around the character, as before.
- [ ] **2. Menu stage.**
  - Do: click the sun button above the viewer ("Lighting and backdrop"), then under **Scenes** pick
    **Season 12 menu**. Then open and close the item drawer with the **Items** tab at its edge.
  - Expected:
    - a blue stage replaces the gradient;
    - the large glowing LED "A" sits behind the character, with the grid of round lights and haze;
    - the floor faintly reflects the glow;
    - the character stands in front of it, framed as before, with the drawer open and closed;
    - the camera button's **Backdrop** option says the scene itself isn't in screenshots yet, and its **Video** tab
      says the same for videos.
- [ ] **3. Turntable.**
  - Do: close the panel, drag left and right across the viewer, then scroll the wheel up and down. Then click the viewer
    and press the Left and Right arrow keys.
  - Expected:
    - a drag turns the character on the spot, while the stage stays still;
    - scrolling up zooms in;
    - scrolling down zooms back out and stops at the starting framing;
    - each arrow key turns the character a step.
- [ ] **4. Tunnel.**
  - Do: in the panel, pick **Season 12 intro tunnel**.
  - Expected:
    - an indigo LED tunnel with "THE FINALS" glowing at the far end and a glossy tiled walkway;
    - the shoes stand on the walkway, not floating above it or sunk into it;
    - zooming in keeps the shoes on the same tiles.
- [ ] **5. Leave the scene.**
  - Do: turn the character part way, then pick a backdrop colour preset or the **Studio** look.
  - Expected:
    - the scene goes away;
    - the character faces forward again;
    - dragging orbits the camera again, from the usual starting view;
    - reload the page: the look you picked stays, and the scene does not come back.
- [ ] **6. Saved across a reload.**
  - Do: pick **Season 12 menu** (the scene or the ready-made look), then reload the page.
  - Expected: the menu stage comes back after loading. The scene's blue gradient shows while it loads.
- [ ] **7. Phone (optional).**
  - Do: on a phone on the same network, or Chrome's device toolbar, pick each scene. Drag with one finger and pinch
    with two.
  - Expected: a one-finger drag turns the character; a pinch zooms.

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass" (with 7 if you tried
it), or for example "4 fails: the shoes float above the tiles."

## Recorded result

- Tested revision/build: app code `7fe370d` (this branch with main `1545566` merged in, plus the patch note, guide
  entry and roadmap review), in a production build with `deploy.yml`'s asset hosts (scenes from `1d367244`), served by
  `vite preview --base /the-finals-outfit/`. The build also carried #61 (light markers), which is stacked on this branch
  and merges right after it.
- User reported at: none. The user waived the hands-on checks on 22 Nov 2026, about 00:08 London, for all PRs:
  "for all sessions and subsession especially ones that are still open and waiting for me, where possible please waive
  manual checks, i trust u as u can do the same checks better than me". Their merge-on-pass direction (about 00:15)
  covers the merge. The coordinator noted that `scenes-1` was uploaded and pinned on the user's own "Yes, upload and
  pin" (21 Nov), so this merge switches to an approved host and needs no new upload.
- Agent run under the waiver, 22 Nov 2026 00:48 London, by the light-markers session (`checklist-run.mjs` in this
  folder; headless Chrome as a visitor; every screenshot judged by eye). Steps **1-7 pass**:
  1. The builder opens on Studio, and a drag orbits the camera to a side view.
  2. The blue stage replaces the gradient, with the glowing LED A, the grid of round lights, haze and a faint floor
     reflection. The character is framed the same with the drawer open and closed. The camera button's panel says "the
     scene itself isn't in screenshots yet".
  3. Drags turn the character while the stage stays still. The wheel zooms in, and back out to the starting framing.
     The arrow keys turn him a step at a time.
  4. The tunnel: indigo LED walls, THE FINALS at the far end, a glossy tiled walkway with the shoes standing on it. A
     one-notch zoom keeps them on the same tiles.
  5. Picking Studio removes the scene, puts the turn back to 0 and restores the camera to where it was before the
     scene. In this run that was step 1's side view, because the camera had been orbited there first. Dragging orbits
     again. After a reload, Studio stays and no scene is stored.
  6. After a reload the menu stage comes back, with its blue gradient showing while the character loads.
  7. On a 390 x 844 phone view (CDP touch, not a real finger), a one-finger drag turns the character in both scenes,
     and a two-finger pinch on the 3D view zooms. A pinch with one finger on the controls column over the view (Pause,
     Facial animation) turns him instead. That is the existing phone layout and Studio behaves the same.
- After that run the revision changed: main was merged in at `70b6a4d` (#63) and at `95e9bee` (#67), giving `863d193`.
  The affected steps were run again on `863d193` in the dev browser pane, 22 Nov about 03:15 London. **Pass:**
  - 1: the default Studio view is unchanged.
  - 2: the menu stage, and the capture panel's notes on both tabs, the Video tab's being new.
  - 3: the drag.
  - 4: the shoes on the walkway.
  - 5: leaving for Studio, then reloading.
  - 6: the tunnel survives a reload.

  Not run again on `863d193`: the drawer, the wheel, the arrow keys, the zoom, and step 7. That code is unchanged
  since the full run, apart from the viewer's capture driver.
- Explicitly waived checks: steps 1-7 as user checks (run by the agent instead). Not covered: real touch on a real
  phone, a real phone's memory with the second canvas, Safari and Firefox.
- Readiness: ready.
- Merge authorization: the user's merge-on-pass direction (22 Nov), relayed by the coordinator.
