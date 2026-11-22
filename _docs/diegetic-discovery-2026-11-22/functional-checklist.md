# Guided functional review: the builder shows itself (callouts, tour, Guide, one panel language)

## What you are checking

The builder now explains its controls where they are: a callout when the pointer comes near one, red corners on a
few not tried yet, a tour that frames each control, a short Guide with Show me, and two one-time nudges. The four
viewer panels share one shell. This review catches:
- a hint that blocks or covers the builder;
- a tour that loses its place;
- anything that touches saved outfits or looks;
- callouts on touch screens or in automated captures.

- Request: the user's message of 22 Nov 2026, relayed by the coordinator (see README.md)
- Test this revision: branch `claude/diegetic-discovery-2026-11-22`:
  - first run on `941ac65b82117796c3c2784118a9274a1a7f5c3a`;
  - final run on `b695551` (main `beba053`, #79, merged in; native tooltips kept and set aside while a callout shows;
    "Hide UI" kept; Number added). Later commits are docs only.
- Open: a production build of that revision (`npm run build` with the asset bases of `.github/workflows/deploy.yml`
  on main), served by `vite preview --base /the-finals-outfit/` on port 4472
- Prerequisites: none beyond the worktree's `node_modules`
- Agent checks (22 Nov 2026):
  - PASS: typecheck and production build, its public-text check of `src/data/feature-guide.ts` included.
  - PASS: `npm test`, 1,088 pass on `b695551`. The 8 failures are the known ones: they need extracted assets this
    worktree does not have (`public/models/body/SK_Body_M.glb`, the ski-blade fixture) and touch nothing here.
  - PASS: `tests/feature-guide.test.ts` (17, 11 new) covers the words, that every feature id is on a control, the
    discovery store's read-modify-write and broken-storage behaviour, the tour's stored state, and the placement
    geometry.
  - PASS: steps 1–11 below, 35/35 on `b695551` (34/34 on `941ac65`), by `discovery-check.mjs` in Playwright's Chrome (WebGL 2 on the GPU,
    `navigator.webdriver` masked except in step 10). Judged also by looking at full-size 1440×900 and 390×844 captures,
    plus 844×390 (phone held sideways) and 1024×768 captures from the walkthrough.
  - NOT RUN: Safari, Firefox, a real phone (steps 8 used touch emulation), a screen reader (step 3 checks the
    `role`/`aria-describedby` wiring, not speech).
  - Pre-existing, not this change: `scripts/check-production.mjs` fails the same way on main's own build (it rejects the
    reconstruction shard host).
- User checks: **waived** for all PRs (the user's standing waiver of 22 Nov); the agent ran the checklist below.

## Try it yourself

- [x] **1. Start:** fresh browser, open the builder, press Esc on the welcome screen. Expected:
  - The top row reads Full screen, Hide UI, then Graphics ▾, Capture ▾, Camera ▾ and the look ▾.
  - At most three controls wear a small red corner.
  - The native tooltips the test scripts use are all still there.
- [x] **2. Callout on approach:** rest the mouse about 18 px below Capture without touching it. Expected:
  - After a beat, "Capture · Save a PNG up to three times the view's size, or an emote as video" appears below it.
  - While it shows, Capture's native tooltip steps aside; it goes when you move away, and the tooltip comes back.
  - Press Capture: the panel opens with the same header as the others (red bar, icon, "Capture", ✕).
  - After that, approaching no longer calls it; a direct hover still does.
- [x] **3. Keyboard:** Tab onto Camera. Expected: its callout shows at once and describes the button (tooltip role,
  `aria-describedby`); Esc dismisses it.
- [x] **4. Tour:** Guide → Take the tour. Expected:
  - Nine stops in order: Items, In-game outfits, Saved outfits, Share outfit, Emotes, Lighting, Capture, Camera,
    Hide UI. Viewfinder brackets frame each one.
  - ← / → / Enter move it, and pressing a slot under the dim still works.
  - Esc at stop 4 stops it; the Guide then says "Resume the tour · Stop 4 of 9" and resumes there.
  - Finishing records it as done, and the Guide offers "Replay the tour".
- [x] **5. Show me:** Guide → Camera's Show. Expected: the sheet closes, Camera is framed and named, and the frame lets
  go by itself after a few seconds.
- [x] **6. Nudges:** play an emote, then pause it. Expected: "Frame by frame" with the four key caps shows above the
  timeline, and pausing switches it to "Share this pose · Share outfit can include this exact frame."
- [x] **7. Reload and your work:** reload, then play and pause another emote. Expected:
  - The tried controls and the finished tour are still recorded, and neither nudge comes back.
  - The saved outfits (IndexedDB) and every other stored setting are unchanged; the only other write was the Auto
    graphics measurement.
  - No page errors.
- [x] **8. Phone (390×844, touch):** close the items sheet, open the Guide, press In-game outfits' Show. Expected:
  - The sheet opens and the Outfits button is framed.
  - A tap on Capture opens its panel with no callout over it.
  - No page errors.
- [x] **9. Reduced motion:** with reduced motion on, open Lighting and start the tour. Expected: the panel appears
  without the drop, and the tour's frame jumps instead of gliding.
- [x] **10. Automation:** open as an automated browser. Expected:
  - No red corners, callouts, tour or welcome dialog.
  - `button[title="Lighting and backdrop"]` still exists, which the shader-probe scripts use.
- [x] **11. Storage refusing writes:** every `localStorage.setItem` throws. Expected: the tour starts and moves on,
  with no page errors.

## Recorded result

- Tested revision/build: production builds of the commits themselves (clean tree), 22 Nov 2026, London. Reports are in
  each run's output folder (outside git: game renders).
  - `941ac65`: 20:23–20:25.
  - `b695551`, the merge with main: 20:33–20:35.
- Agent result: 1–11 **PASS** (35/35 on `b695551`) under the user's standing waiver.
- Defects found and fixed during the runs, before the commit:
  - The tour card could not take focus (it was `visibility: hidden` before placement), so the arrow keys did nothing.
  - A synthetic tap left a stray callout for a neighbouring control.
  - A keyboard focus callout hid the first nudge.
  - The Guide offered to restart a tour that was still running.
  - After the first PR run: titles hidden from visitors would have broken the project's title-based harness scripts.
  Each was rerun after its fix.
- User reported at: not required (waiver)
- Explicitly waived checks: all user checks, by the user's standing instruction of 22 Nov
- Readiness: agent-verified
- Merge authorization: the task brief (merge on pass, CI green, CLEAN)
