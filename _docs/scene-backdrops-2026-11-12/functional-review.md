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

- **PR / origin:** not opened yet. The branch is stacked on PR #40. The design is in `README.md` section 8.
- **Test this revision:** branch `claude/scene-backdrops-p2-2026-11-15`, app code at
  `705d7aa3b207b2b24bdf0192b9314cc55b9c9c81`. Later commits on the branch that touch only `_docs/` leave it the same.
- **Open:** http://127.0.0.1:5243 in Chrome, served from the worktree below.
- **Prerequisites:**
  - The scene files are in the worktree's ignored `public/scenes/` folder: `s12-menu/icon-stroke-a.webp` and
    `s12-tunnel/plate-v1.webp`.
  - The models stream from the deployed asset hosts, so you need an internet connection. No account is needed.
- **Approximate hands-on time:** 10 minutes.
- **Agent checks (15 Nov):** PASS.
  - Typecheck passes.
  - Scene tests: 9 of 9 pass.
  - Full suite: 804 pass. 8 fail only because extracted GLBs (`public/models`) are absent in the worktree.
  - In the dev browser pane (synthetic mouse input), the agent checked:
    - menu colours against your screenshot;
    - the tunnel's feet on the walkway;
    - zoom scaling;
    - the turn;
    - restore on leave;
    - phone size;
    - persistence across a reload.
  - Not covered: real touch input, a real phone's memory, the feel.
- **User checks:** **PENDING**. Agent results do not check the boxes below.

## Get it running

If http://127.0.0.1:5243 already opens the builder, the agent's server is still up: skip to the checklist.

Otherwise, in **PowerShell**, run these commands. The asset hosts are the deployed ones from `deploy.yml`.

```powershell
cd E:\Coding\the-finals-outfit\.claude\worktrees\trusting-davinci-1693fd
$env:VITE_ASSETS_BASE = "https://f4a8e069.the-finals-outfit-assets.pages.dev/"; $env:VITE_MODELS_BASE = "https://a029b249.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_BASE = "https://c062af24.the-finals-outfit-assets.pages.dev/"; $env:VITE_ANIMATIONS_BASE = "https://cd858839.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_ROUTES_FILE = "src/data/reconstruction-routes.json"
npx vite --host 127.0.0.1 --port 5243 --strictPort
```

Stop it with Ctrl+C. The look you pick is saved in this browser for `127.0.0.1:5243` only, not on the live site.

## Try it yourself

- [ ] **1. Start: the default is unchanged.**
  - Do: open http://127.0.0.1:5243 in Chrome.
  - Expected: the builder loads with the usual Studio look. Dragging orbits the camera around the character, as before.
- [ ] **2. Menu stage.**
  - Do: click the sun button above the viewer ("Lighting and backdrop"), then under **Scenes** pick
    **Season 12 menu**.
  - Expected:
    - a blue stage replaces the gradient;
    - the large glowing LED "A" sits behind the character, with the grid of round lights and haze;
    - the floor faintly reflects the glow;
    - the character stands in front of it, framed as before.
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
    - dragging orbits the camera again, from the usual starting view.
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

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not given
