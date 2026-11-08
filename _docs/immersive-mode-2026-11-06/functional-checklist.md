# Guided functional review — full-screen (immersive) mode

## What you are checking

A new button on the 3D preview hides everything but the character (header, outfit panel, slot strip, item grid,
footer) and, where the browser allows, also hides the browser's own bars. This catches a mode you cannot leave, a
layout that stays stripped after the browser leaves full screen, a stretched or mis-sized character, controls under
the notch, and losing your place in the item list.

- PR / originating issue: the PR for branch `claude/fullscreen-mode-2026-11-06` (user request, 6 Nov evening: "allow
  a full screen mode for immersion or hide the whole picker bar thing")
- Test this revision: branch `claude/fullscreen-mode-2026-11-06`, commit in the PR header (base `b811c81`)
- Open: phone on the same Wi-Fi: <http://192.168.1.131:5190/the-finals-outfit/>; this PC:
  <http://localhost:5190/the-finals-outfit/>
- Prerequisites: the preview server from this session (production build of this branch, artwork from the live asset
  hosts). Nothing to download.
- Approximate hands-on time: 8 minutes
- Agent checks: PASS. See "Agent evidence" below.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If the preview server from this session is still up, skip to step 1. Otherwise, in **PowerShell**, working directory
`E:\Coding\the-finals-outfit\.claude\worktrees\determined-colden-c5f9cf` (the `dist` folder is already built):

```powershell
npx vite preview --port 5190 --strictPort --base /the-finals-outfit/
```

It listens on the whole network (the config sets `host: true`), so the phone link works too. If the phone cannot
connect, Windows Firewall is blocking Node on private networks: allow it when Windows asks, or test on this PC only.
Stop it with Ctrl+C. It does not touch the main session's 5174 server.

## Try it yourself

- [ ] **1. Start (phone, portrait):** open the phone link, close the welcome screen. Expected: the character loads as
  usual; a new small square button with four corner marks sits left of **Studio**.
- [ ] **2. Enter:** scroll down into the item grid a little, pick a slot further along the strip (e.g. **Feet**),
  then tap the corner-marks button. Expected: header, outfit panel, slot strip, grid and footer disappear; the
  character fills the screen, not stretched; **Exit full screen** shows top right. Android Chrome also hides its
  address bar; iPhone Safari keeps its bars (it has no full screen for pages) but the page is stripped the same way.
- [ ] **3. Use it inside:** drag to turn the character, pinch to zoom, tap **Emotes** and play one, close the emote
  sheet, then tap **Animated** to stop and **Animate** to start again. Expected: everything works and you stay in full
  screen after closing the sheet.
- [ ] **4. Leave with the button:** tap **Exit full screen**. Expected: the page comes back as you left it: same
  scroll position in the grid, **Feet** still selected, and the character does not reload (no "Loading contestant").
- [ ] **5. Leave through the phone (Android):** enter again, then use the system back gesture or button. Expected:
  full screen ends and the normal page comes back (not a stripped page with browser bars). On iPhone, skip this step.
- [ ] **6. Rotate:** enter, turn the phone to landscape and back. Expected: the character re-fits each time without
  stretching; no button sits under the notch or the rounded corners.
- [ ] **7. Desktop:** on this PC open the localhost link, click the corner-marks button, then press **Esc**. Expected:
  the browser goes full screen with only the character; Esc returns to the normal three-pane layout. Opening
  **Emotes** while in full screen shows the panel on the right of the character.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual
step numbers), or e.g. "4 fails: the grid jumps back to the top".

## Agent evidence

Run on the production build of this branch (live asset hosts, as deploy.yml builds it), headless Edge through
Playwright, plus unit tests. Screenshots reviewed by eye at full size; kept locally, not committed (renders of
extracted assets).

- Phone portrait 375×812 (DPR 2): enter → stage 375×812, drawing buffer 750×1624, `document.fullscreenElement` =
  `<html>`, header/picker hidden. Orbit by touch drag, emote sheet open, an emote (Boomerang) playing, Animate on:
  all inside full screen. Exit → stage back to 375×357, scroll restored to 900 px. Leaving through the browser
  (`document.exitFullscreen()`) and Esc both restore the layout.
- Desktop 1440×900: enter → 1440×900 stage and buffer; the emote picker opens inside the stage's right column and
  plays; exit and Esc restore the three-pane layout with the animation still running.
- Resize: a per-frame sampler over 40 frames after each enter and exit found 0 frames whose drawing-buffer aspect
  differed from the canvas's CSS aspect (no stretched frame) at either size.
- iPhone-style CSS-only mode (Fullscreen API removed): the stage fills 375×812 without browser full screen; Esc and the
  Exit button restore the page.
- Safe areas (emulated through CDP): landscape 812×375 with 47 px side insets: controls 47 px further in, background
  still edge to edge. Portrait with 44/34 px top/bottom insets: Exit button at y = 56, lower third 34 px higher,
  emote sheet padded 34 px.
- Unit tests: `tests/immersive-mode.test.ts`, 10 cases (CSS-only path, API path, browser exit, refused request, Esc,
  exit before the request lands, someone else's fullscreen, WebKit-prefixed API, unmount, change notifications).
  Mutation check: removing the browser-exit restore or the late-request undo each fails one test.
- Full suite `npm test`: 704 pass, 5 skipped, 8 fail. The 8 need extracted model files this worktree does not have
  (`public/models/body/SK_Body_M.glb`, the ski-blade fixture, socketed-static GLBs): the same 8 as on main.
  Typecheck and production build (`npm run build`, deploy.yml's asset hosts) clean.

What the agent could not check: a real phone (touch pinch, Android back gesture, real notch, iPhone Safari itself).
Steps 2, 5 and 6 cover those.

Re-run after merging main (8 Nov 2026; main at `25c0837`, the evening release #28, which also edits
`CharacterViewer.tsx`): clean merge; typecheck and production build clean; `npm test` 707 pass, 5 skipped, the same 8
model-file failures; the phone and desktop drive above repeated with identical geometry, 0 stretched frames, scroll
restored to 900 px, an emote playing inside full screen; screenshots reviewed at full size.

## Recorded result

- Tested revision/build: none by the user
- User reported at: 8 Nov 2026, no step results
- Passed / failed / untested step numbers: untested 1-7
- Explicitly waived checks, if any: none named; the user asked for the merge without running them
- Readiness: agent checks PASS; user checks not run
- Merge authorization: given 8 Nov 2026, verbatim: "ask main session to merge this feature then archive this
  chat/session"
