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
- User checks: **WAIVED** by the user on 22 Nov 2026 (standing waiver, quoted under "Recorded result"). The agent ran
  steps 1-6 on a production build instead: **agent PASS under the waiver**, not a user PASS.

## Get it running

Git Bash, in the worktree `E:\Coding\the-finals-outfit\.claude\worktrees\elated-stonebraker-5f34bd`:

```bash
VITE_ASSETS_BASE=https://f4a8e069.the-finals-outfit-assets.pages.dev/ VITE_MODELS_BASE=https://a029b249.the-finals-outfit-assets.pages.dev/ VITE_RECONSTRUCTION_BASE=https://c062af24.the-finals-outfit-assets.pages.dev/ VITE_ANIMATIONS_BASE=https://fd946744.the-finals-outfit-assets.pages.dev/ VITE_SCENES_BASE=https://1d367244.the-finals-outfit-assets.pages.dev/ VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json npx vite --host 127.0.0.1 --port 5261 --strictPort
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

- Tested revision/build: app code `920cfca` (this branch rebased onto #57 `8e93a1c`), merged locally with main
  `96bf586` (not pushed) as it will land, in a production build with `deploy.yml`'s asset hosts, served by
  `vite preview --base /the-finals-outfit/`.
- User reported at: none. The user waived the hands-on checks:
  - 22 Nov 2026, about 00:08 London, for all PRs: "for all sessions and subsession especially ones that are still open
    and waiting for me, where possible please waive manual checks, i trust u as u can do the same checks better than me".
  - 22 Nov 2026, for this PR: "do the checks for me, if pass, merge it".
- Agent run under the waiver, 22 Nov 2026 00:31 London: steps **1-6 pass** (details under "Agent results, 22 Nov").
  Untested: real touch, Safari, Firefox.
- Explicitly waived checks: steps 1-6 as user checks (run by the agent instead).
- Re-run on the final revision, 22 Nov 2026 00:47 London. This branch was rebased onto #57 `7fe370d` (main `1545566`
  with the feature guide #65 and multi-character #66 merged in) and given its patch note, guide entry and roadmap
  review (`781c52a`). On that production build: steps 1-6 pass again, 24 of 24, 0 page errors. The key frames were
  judged by eye: the drag, the PNG with no bulbs, H, and the menu-scene drag. Typecheck, build and the public-text
  and roadmap checks pass; unit tests 980 pass, with the same 8 GLB-fixture failures.
- Readiness: ready, once #57 is on main (this PR is stacked on it).
- Merge authorization: "if pass, merge it" (22 Nov). #57 merges first, under the user's merge-on-pass direction
  (relayed by the coordinator).

A later patch invalidates affected checks. Keep results for the previous revision and record the retest.

## Agent results, 22 Nov 2026 (the checklist under the waiver)

On `920cfca` + main `96bf586`, as it will land. Checks:
- Production build (typecheck included): PASS.
- Unit tests: 964 pass; the same 8 GLB-fixture failures (`public/models` absent from worktrees).
- The checklist, steps 1-6, on the production build: `checklist-run.mjs` (headless Chrome as a visitor, the
  checklist's own clicks and drags; bulbs found with the default camera and confirmed by hovering their labels): 24 of 24
  pass, 0 page errors. Each step's full-page screenshot was also judged by eye:
  1. Two bulbs with cones: Sun with its ring upper right, Rim behind on the left and paler; the panel stays open.
  2. The label follows the drag (mid-drag "Sun · -11° / 41°", released at "-55° / 37°"). The camera does not move,
     the light moves to his right side, and the Sun card is outlined in red with Direction -55 / Height 37.
  3. Direction 149° slides the bulb round behind him on the right. Brightness 10 vs 0.65 makes the cone bolder or
     fainter; the change is modest for a light behind him, which is drawn at half strength. Colour #33ff66 turns the
     bulb, cone and rim light green.
  4. The saved PNG (2880 × 1688) shows the green-lit character on the backdrop with no bulbs or cones. H hides the bulbs
     with the UI ("Press H to show UI"); H again brings them back.
  5. Each look names itself and its bulbs are its lights:
     - Dramatic: Key, Rim;
     - Cool: Key, Fill, Rim;
     - Warm: Sun, Fill, Rim, with the floor shadow;
     - Fullbright: no bulbs, even light, no shadow;
     - Nighttime: Moon, Fill, Lamp;
     - Season 12 menu: the live menu stage, with Key, Blue side, Back light, Under fill.

     Dragging the Blue side bulb in the menu scene moves it from -116°/9° to -160°/19°, and the character still faces
     forward.
  6. Warm, then the sun dragged to 20°/15°, then Save current look ("Look 1"). After a reload: Custom, Show lights still
     ticked, the sun's bulb at 20°/15°, and Look 1 kept.
- The scripted suite (`light-markers-test.mjs`) on a dev server of the same code: 31 of 31 pass. This includes the share
  card, which was also judged by eye: four views, no markers. The only console noise is dev-only: a font 403 through the
  `node_modules` link, and a catalog fetch cut off by a reload.

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
