# Guided functional review — light markers, dragging lights, more looks

## What you are checking

The Lighting panel can show each light as a bulb and cone in the 3D view, you can drag a bulb to move its light with
the panel's sliders following, the markers never reach a screenshot, and there are six more ready-made looks; this
catches markers leaking into pictures, drags that turn the camera instead, and lost lighting settings.

- PR: stacked on PR #57 (scene backdrops); link in the PR description.
- Test this revision: branch `claude/lighting-markers-presets-2026-11-21`, commit given in the PR's latest comment.
- Open: the dev viewer at `http://127.0.0.1:5261/?reconstructed=1` (commands below), in Chrome or Edge on a computer.
- Prerequisites: the repo's `node_modules` (this worktree links an existing install); internet (assets come from the
  live asset hosts). No account or secret.
- Approximate hands-on time: 10 minutes.
- Agent checks: see "Agent results" at the end.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

Git Bash, in the worktree `E:\Coding\the-finals-outfit\.claude\worktrees\elated-stonebraker-5f34bd`:

```bash
VITE_ASSETS_BASE=https://f4a8e069.the-finals-outfit-assets.pages.dev/ VITE_MODELS_BASE=https://a029b249.the-finals-outfit-assets.pages.dev/ VITE_RECONSTRUCTION_BASE=https://c062af24.the-finals-outfit-assets.pages.dev/ VITE_ANIMATIONS_BASE=https://17ec92c3.the-finals-outfit-assets.pages.dev/ VITE_SCENES_BASE=https://1d367244.the-finals-outfit-assets.pages.dev/ VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json npx vite --host 127.0.0.1 --port 5261 --strictPort
```

Open `http://127.0.0.1:5261/?reconstructed=1`, click **Enter builder**, and close the Items drawer (the ITEMS tab at its
edge) so the 3D view is wide. Stop the server with Ctrl+C. Your lighting on the live site is not touched: this address
keeps its own browser storage.

## Try it yourself

- [ ] **1. Show the lights:** click the sun button at the top right (it says **Studio**), then tick **Show lights in
  the 3D view** under Lights. Expected: two bulbs appear round the character, each with a cone pointing at the chest:
  the Sun (with a ring round it) upper right, and the Rim behind on the left, paler because it is behind him. The panel
  stays open.
- [ ] **2. Drag a light:** with the panel still open, drag the Sun's bulb across to the left of his head and let go.
  Expected: the bulb stays under the pointer, a label shows "Sun · -NN° / NN°", the camera does not turn, the shading
  on the face moves to the left, and in the panel the Sun card is outlined red and its **Direction** and **Height**
  read the same numbers as the label.
- [ ] **3. Slider to bulb:** drag the Sun card's **Direction** slider. Expected: the bulb slides round the character as
  you drag; **Brightness** makes its cone bolder or fainter, and the **Colour** picker recolours the bulb and cone.
- [ ] **4. Never in a picture:** with the bulbs showing, click the camera button, then **Save PNG**; open the saved
  file. Then press **H**. Expected: the PNG shows the character with no bulbs or cones, on the backdrop. After H the
  bulbs are gone with the rest of the UI; H again brings everything back.
- [ ] **5. The new looks:** in the panel's Looks, click each of **Dramatic, Cool, Warm, Fullbright, Nighttime** and
  **Season 12 menu**. Expected: each changes the lights and backdrop, the button at the top shows its name, and the
  bulbs follow the new lights (Fullbright has none). Season 12 menu shows the menu stage with strong blue light from
  behind on the left and a warm key on the face; dragging a bulb there moves the light and does not turn the character.
- [ ] **6. Kept after a reload:** pick a look, drag a bulb somewhere, click **Save current look**, then reload the page.
  Expected: the bulbs are still shown, the look is as you left it (the button says Custom), and the saved look is still
  in the list.

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass" (using the actual step
numbers), or e.g. "2 fails: the camera spins when I drag the bulb." The agent can guide the next action one at a time.
Do not assume a step passed because a merge is requested.

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given (and #57 merges first)

A later patch invalidates affected checks. Keep results for the previous revision and record the retest.

## Agent results (21 Nov 2026, on #57 9c484f0)

- Typecheck and production build: PASS.
- Unit tests: 915 pass; the 8 failures are the GLB fixture tests absent from worktrees (`public/models`), as on #57.
  New: `tests/light-markers.test.ts` (7: every look valid and named, the measured menu lights, Fullbright, dome
  placement, drag maths front/back/rim, distance and height limits, a capture camera cannot see the overlay layer) and
  store cases (Show lights stored beside the look, never in it; leaving a scene stays left after a reload).
- Browser (headless Chrome, `light-markers-test.mjs`, dev server, run as a person): 23 + 5 checks PASS.
  - every look applies and names itself;
  - markers mount one per light; a drag keeps the panel open, turns the sun, keeps its distance, lands the bulb under
    the pointer, and the Direction/Height sliders read the dragged angles; a slider moves the bulb;
  - screenshot on backdrop, transparent screenshot and the share card have 0 marker pixels while the screen shows them;
  - H hides them and brings them back; a reload keeps Show lights, the dragged look and the saved looks; Undo works;
  - in the Season 12 menu scene a bulb drag moves its light and leaves the character unturned, while a drag elsewhere
    still turns it; on a 390 × 844 phone view the markers mount.
- Found and fixed while testing: leaving a scene for a look without one came back as the scene after a reload (#57's
  storage merge). See README, "A fix to #57's scene storage".
- Looks judged by eye on the default outfit (screenshots kept outside git).
- Not covered: real touch, Safari, Firefox; the 3D export path (only reads the character's own objects, by code).
