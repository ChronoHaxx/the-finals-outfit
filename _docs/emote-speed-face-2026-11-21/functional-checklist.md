# Guided functional review — emote speed and facial animation switch

## What you are checking

Emotes get a speed slider (0.25× to 4×) and the viewer gets a Facial animation on/off button, both remembered in this
browser. This catches a speed that breaks pause, the frame slider, Loop or the sounds, a paused share link opening on
a different frame, and a remembered choice that is lost or disturbs saved outfits.

- PR / originating issue: the PR for branch `claude/emote-speed-face-toggle-2026-11-21` (Shocka's feedback, item 2:
  `_docs/feedback-shocka-2026-11/README.md`).
- Test this revision: branch `claude/emote-speed-face-toggle-2026-11-21`, the commit shown in the PR header.
- Open: this PC, the local dev server below, at <http://localhost:5173/?reconstructed=1> (if Vite reports another port, use that).
- Prerequisites: Node and the repository's dependencies. The dev server uses the live asset hosts (read-only).
  Nothing touches the live site.
- Approximate hands-on time: 10 minutes.
- Agent checks: see the PR body (typecheck, tests, build, and a real-app run in Chromium).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in the worktree folder `E:\Coding\the-finals-outfit\.claude\worktrees\nervous-bhabha-fb88b1`:

```powershell
$env:VITE_ASSETS_BASE='https://f4a8e069.the-finals-outfit-assets.pages.dev/'; $env:VITE_MODELS_BASE='https://a029b249.the-finals-outfit-assets.pages.dev/'; $env:VITE_RECONSTRUCTION_BASE='https://c062af24.the-finals-outfit-assets.pages.dev/'; $env:VITE_ANIMATIONS_BASE='https://17ec92c3.the-finals-outfit-assets.pages.dev/'; $env:VITE_RECONSTRUCTION_ROUTES_FILE="$PWD\src\data\reconstruction-routes.json"; npx vite
```

Open the link above. Stop the server with Ctrl+C. To undo the remembered choices afterwards, set the speed back to 1×
and turn Facial animation back on (both then leave nothing stored).

## Try it yourself

- [ ] **1. Start:** open the link and close the welcome screen. Expected: the idle plays. Under **Emotes** in the
  right-hand column there is a **Facial animation** button (filled square) above **Sway · approx.**, and no Speed
  control yet.
- [ ] **2. Speed:** **Emotes**, then pick an emote with clear motion and sound (e.g. **Boomerang**). Expected: a
  **Speed** row appears under the emote button, reading **1×**. Drag it to **0.25×**: the emote slows to a quarter, the
  timeline's seconds count slowly, and the sound plays slow and low but each hit still lands on its motion. Drag it to
  **4×**: everything runs four times as fast. Click the red **4×** label: back to **1×**. With focus off the slider,
  **>** and **<** (Shift+. and Shift+,) step the speed one stop.
- [ ] **3. Transport at speed:** set **2×**, pause on the timeline, press **.** three times, then drag the frame
  slider. Expected: each key moves exactly one frame. Changing the speed while paused does not move the frame. Play
  resumes at the speed shown. Turn on **Loop**: the emote repeats at that speed and the sound stays in step on every
  pass. Close the emote (×): the idle plays at normal speed.
- [ ] **4. Paused share link:** at **0.25×**, pause an emote on a pose, then **Share outfit**, **Copy link**. Open the
  link in a private window (normal speed there). Expected: the same frame number, paused, with the same pose. The link
  has no speed in it.
- [ ] **5. Facial animation:** pick an emote with an obvious expression (e.g. a laughing or shouting one), pause on a
  frame where the face is clearly animated, then click **Facial animation**. Expected: the square empties and the face
  goes to rest at once, while the body stays on the same frame. Click again: the expression comes back on the same
  frame. Press play: the face animates (on) or stays at rest (off) as the emote plays.
- [ ] **6. Remembered:** set the speed to **0.5×** and turn Facial animation **off**, then reload the page. Expected:
  the idle's face stays at rest and the button shows off. Pick an emote: it plays at **0.5×**. Your saved outfits (the
  outfits menu) are unchanged.
- [ ] **7. Phone (optional):** on a phone on the same Wi-Fi, open the "Network" address Vite prints, with `?reconstructed=1`, and pick an emote.
  Expected: the Speed slider follows your thumb, and the frame slider along the bottom keeps its width.

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass" (using the actual
step numbers), or e.g. "3 fails: the frame jumps when I change speed while paused".

## Recorded result

- Tested revision/build: none by the user. The waiver applies to commit `932f9ef`.
- User reported at: 21 Nov 2026, about 20:25 London, in the session: "Waive the checks" (verbatim).
- Passed / failed / untested step numbers: 1-7 untested by the user.
- Explicitly waived checks, if any: 1-7, by the user's instruction above. The waiver accepts these unknowns: a real
  phone and real touch drags, Safari and Firefox, and how the sped-up or slowed sound actually sounds to a listener.
- Agent re-check after the waiver (same commit, local dev server on the live asset hosts, Playwright Chromium with
  `navigator.webdriver` masked, 21 Nov about 20:30 London). It covered what the earlier agent run had not driven
  through the real controls:
  - Step 1: with only the idle playing there is no Speed row, and the Facial animation button shows.
  - Step 2: picking Major Coronation through the picker brings up the Speed row.
  - Step 3: at 2×, Pause on the timeline; changing to 0.5× while paused left the frame at 0.167 s, and Play resumed at
    exactly 0.5 clip-s per animator second. The browser was rendering about 1 frame a second by then, so the rate is
    measured per animator step with the fixed capture clock, not per wall-clock second. Close (×) returned to the idle
    at 1×, and the Speed row went away.
  - All PASS. Steps 4-6 and Loop were already covered by the earlier run (`README.md`), and step 7 only by an emulated
    phone.
- Readiness: checks explicitly waived (not user-verified).
- Merge authorization: given by the user on 21 Nov 2026, about 22:00 London, in the session: "Yes, merge it"
  (verbatim). It covers this PR with the waiver above. Nobody has checked it by hand.
