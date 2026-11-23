# Takes: record what you do, then render it (22 Nov 2026)

The coordinator relayed the owner's ask (22 Nov): "A record button, so people can capture what they do (orbit the
camera, switch emotes, drag lights, scrub). Recommended design: 'record then render'." The rules:
- capture inputs and state over time;
- render offline at 60 fps with today's quality;
- show a clear recording state, a timer and Stop;
- save each take per browser the moment it stops;
- keep several, evicting the oldest only past a stated cap;
- keep a take until it is exported or discarded;
- never delete one on export.

Branch `claude/video-takes-2026-11-22` off main 3f954d3 (video range, #82); main 8333137 merged in on 23 Nov. Checklist: `functional-checklist.md`.

**Status: merged.** PR #88 (head b5e0037) merged into main as 13a6694 on 23 Nov 2026, 09:44 UTC, by the coordinator,
after the agent checklist PASS under the owner's waiver and green CI (build, compatibility).

## What a person sees

- Capture, then **Video**, then **Take** (beside **Emote**, today's export).
- **Record a take**:
  - The panel closes, so the viewer is what gets recorded.
  - The Capture button turns into **REC 0:12** with a pulsing red dot, and a red **Stop** sits beside it. On a narrow
    view (below the width where the buttons' names give way to icons) there is no room for both: the red Stop shows the
    time (■ 0:12) in the Capture button's place.
  - Orbit, zoom, play emotes, pause and drag the timeline, change the lights.
  - A take stops by itself at 3:00.
- **Stop** opens the panel on the new take: name, length, time recorded.
- Each take has **Render** and **Discard…**:
  - Render uses the tab's format, size, quality and sound, the same as an emote.
  - Discard asks first (Discard or Keep).
  - Rendering marks a take "rendered" and keeps it.
- A take renders with the outfit worn at render time, and with the viewer's current face switch.

## How it works

**Recording** (`src/lib/take-recorder.ts`)
- Once per frame, after the orbit, the roll, the animation and the contact shadow (frame step 0.5, before the draw),
  the viewer's probe is sampled (CharacterViewer's `TakeBridge`). A sample holds:
  - the camera's position, rotation and field of view;
  - the orbit's target, which the sway's camera turn is measured round;
  - the character's turntable yaw;
  - each clip the mixer blends: time, effective weight (crossfades included), rate (0 while held) and whether it is the
    front emote (`RigAnimator.takeSample`);
  - the sway and audible flags.
- A lighting change is an event holding the drawn look.
- Samples are packed (15 numbers + 5 a clip, `src/lib/video-take.ts`) and saved every second as a chunk, in one
  IndexedDB transaction with the take's record. A full disk keeps them in memory and retries with the next chunk.

**Storage** (`src/lib/take-store.ts`)
- IndexedDB `finals-take`: stores `takes` (records) and `chunks` (keyed `[take, index]`), apart from saved outfits and
  squads. Memory when IndexedDB is blocked; the panel then says takes last until the tab closes.
- Every write reads the stored record and changes only its own fields.
- A recording take that has not saved for 5 s is listed as interrupted (its tab closed or crashed) and renders from what
  it saved. Another tab only reads that state; it never writes it, so a hidden but live recording is never rewritten.
- A hidden tab draws no frames, so recording stops when the tab is hidden, saved.
- **Cap: 10 takes.**
  - Past it, the oldest take already rendered makes room, and the panel names it.
  - A take never rendered is never evicted. When all ten are unrendered, recording is refused with "10 takes are
    waiting to be rendered: render or discard one to record another."
  - This reconciles "evict the oldest only past a stated cap" with "keep a take until it is exported or discarded".

**Rendering** (`renderTake` in `src/rig/VideoExport.ts`)
- The encoders, muxers and frame loop are today's (`encodeVideo`). `recordVideo` is now one source of frames, the
  emote's frame plan, and a take is another.
- Each output frame `i` shows the take at `i/60` s (`TakeTimeline.frameAt`):
  - The capture's own camera moves there (`ViewCapture.setView`); the live camera stays where the viewer left it.
  - The character turns to the recorded yaw.
  - The sway is turned by the camera's change of angle, as playback turns it, and stepped 1/60 s.
  - The animator poses exactly the recorded blend (`RigAnimator.poseTake`; the still pose when none).
- **Clip times between samples.** A clip that plays on continuously from one sample to the next is interpolated: same
  clip, same rate, advancing no more than the time between them allows. At ordinary frame rates that is exactly its
  clock. Under 10 fps the mixer advances at most 0.1 s a frame, so playback itself ran slow; the video shows that pace
  evenly, never jumping to catch up. A seek, restart or speed change shows at the sample that recorded it. A held clip
  (paused, a timeline drag) is interpolated, so a scrub replays smoothly.
- **Lights.** The lighting store's `takeLook` (never stored) draws the recorded lights, environment, tone mapping and
  exposure. The live backdrop and an in-game scene stay the viewer's: switching scene mode mid-render would move the
  camera and open a second WebGL context. An MP4's backdrop follows the take's looks inside the capture
  (`ViewCapture.setBackdrop`). A frame waits until the change is on the stage: `TakeBridge` records the look it was
  given in a passive effect, which runs after `StudioEnvironment`'s (it sits after the stage lights in the tree), and
  that is where the reflections' environment is set.
- **Sound.** The front emote's audible stretches become segments (`TakeTimeline.soundSegments`), rendered on one
  OfflineAudioContext by the same cue rules as an emote's export: `EmoteSounds.renderSegments` shares
  `renderOffline`'s pass scheduling.
  - A segment the viewer interrupted (a pause, a seek, another emote) cuts with playback's 50 ms fade.
  - A one-shot that played to its end lets its sounds end as the game's do.
  - A segment that drifts 0.25 s from its own clock rejoins where the picture is.
  - Picks are seeded per emote and per play of it.
- The viewer gets everything back afterwards: its clip at its time, playing or paused, its look and its turn. Picking an
  emote while a take renders stops the render with a message.

## Traps found on the way

- **"Shown" a frame early.** `StudioEnvironment` sets the reflections' environment in passive effects. A layout effect in
  `TakeBridge` reported a look as on stage one frame before the reflections changed, so one of two renders of a take
  differed on the frame after a lighting change. `TakeBridge` now records it in a passive effect, after the stage's.
- **Re-anchoring a slow clock.** Re-anchoring each clip to an ideal clock whenever it drifted 0.25 s jumped backwards
  every quarter second under 10 fps (the mixer caps a frame at 0.1 s). Continuity-based interpolation replays the pace
  playback really had, evenly.
- **GPU rounding.** Two renders of one take agree to the byte apart from a single pixel at one level on a few frames.
  Three PNG renders of one 52 s take disagreed pairwise on 80–94 of 3,137 frames, in no order: no render was the odd one
  out, so nothing leaks from the viewer into a render. The app's inputs are pure functions of the take (no clock, no
  `Math.random`; alpha-hash seeds are per pixel, triangle and sample). The cause is below the app. A guess, not checked:
  the driver swapping in a background-optimised shader. The analysis allows exactly that (one level, a pixel or two).
- **Narrow views.** REC and Stop together pushed Full screen, Hide UI and half of Graphics off the left edge of the
  button row at 390 px, which is anchored right. On a narrow view Stop now shows the time in the trigger's place;
  step 9 checks the whole row stays on screen.
- **Harness.**
  - CDP's `Page.crash` never answers, and the renderer dies some time after it is sent. The step races it with a
    timeout and bounds the loss from below: what was recorded before the command, less one chunk, must be saved.
  - Playwright matches role names by substring, so "Render Take 1" also matched Take 10 and 11; the locator is exact.
  - On Windows, stopping the preview's PowerShell leaves vite's `node` child listening, so stop it by PID tree
    (`taskkill /T`).
  - The unit tests step frames synchronously, so a save's microtasks ran after every frame; the test steps a second
    at a time.

## Agent evidence

Run `takes-final5`, 23 Nov 2026 09:38–09:42: source 71aa32d (main 8333137 merged in), a production build served by
`vite preview` (`_docs/mov-export-2026-11-22/build-preview.ps1`). Headless Chrome on the GPU (ANGLE D3D11, RTX 3080),
navigator.webdriver masked so sounds load. `takes-steps.mjs` (16 checks), then `analyse-takes.py` (9 checks), all PASS, no
page errors.

- **Record (step 1):**
  - The panel closes; the button reads REC 0:13 with Stop beside it.
  - A 13.55 s take was saved as it recorded: 12 chunks, done on Stop, clips outfit-idle and clap.
- **Render (step 2):**
  - 813 frames, as PNG (20 s) and as MOV (10 s), at 480p Draft. That is one frame per 1/60 s of the take (1,842 samples,
    about 136 a second live).
  - The two renders' sound is byte-identical. Their frames match except for GPU rounding: 5 of 813 frames differ, each
    at one pixel by one level (see Traps).
  - The orbit is in the video: frame 0 against frame 72, silhouette IoU 0.76.
  - The change to Lobby lands on frame 504 (8.393 s): brightness jumps 1.66, against 0.007 for a typical frame.
  - The clap sounds at 4.33810 s, where the samples put it (4.3381 s).
  - The take stays, marked rendered. The viewer is given back: clap paused at its end, the Lobby look, not recording.
- **Slow machine (step 3):** a 9.79 s take with the CPU slowed 20×.
  - The live view drew 14.8 frames a second while the camera moved.
  - Over its 528 frame steps with the camera moving, a 60 fps screen recording would have repeated 408 frames; the
    render repeats none.
- **Crash (step 4):**
  - The tab crashed 4.80 s into a take. The next visit listed it as interrupted, saved so far, with 4.01 s in 4 chunks:
    no more than the last second was lost.
  - It renders all 241 frames.
- **Discard (step 5):** it asks first and Keep keeps the take. Discard removes it, still gone after a reload, and the
  others stay.
- **Hidden tab (step 6):** recording stopped and said "Stopped: the tab was hidden. The take so far is saved."
- **Cap (step 7):**
  - With ten unrendered takes, an eleventh is refused: "10 takes are waiting to be rendered…", and all ten are kept.
  - After one is rendered: "Made room: Take 1 (already rendered) was removed." Ten takes remain.
- **Emote (step 8):** the emote export is as before (Record video, Loops).
- **Phone (step 9, 390 × 844 touch):**
  - The red Stop shows 0:01, and nothing on the button row is off screen. The layout fits down to 375 px (measured).
  - The take is listed after Stop.
- **Pictures looked at:** the recording row on desktop and phone, the Take panel after the crash reload, frames across
  the orbit, the frames either side of the lighting change, and the slowed take's frames.
- **Unit tests:** `npm test` on the merged head gives 1,128 of 1,142 passing and 6 skipped. The 8 failures are this
  worktree's missing GLB fixtures (the ski-blade GLB, `public/models`), failing as before this branch.
  `tests/video-take.test.ts` (17 tests) covers:
  - a kill mid-recording, a full disk, the cap and eviction, and a take discarded elsewhere;
  - unknown fields kept, broken records;
  - interpolation, seeks, speed, scrubs, crossfades, sound segments.
