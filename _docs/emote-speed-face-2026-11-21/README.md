# Emote speed and the facial animation switch (21 Nov 2026)

Shocka's feedback list, item 2 (`_docs/feedback-shocka-2026-11/README.md`): an emote speed slider from 0.25× to 4×
(his list 10), and a facial animation on/off toggle (his list 4: "you mostly want them but sometimes you don't").

## What changed

- **Speed** (`src/lib/emote-playback.ts`, `RigAnimator.setSpeed`, `EmoteSpeedControl.tsx`). A slider with eleven stops,
  0.25, 1/3, 0.5, 2/3, 0.8, **1**, 1.25, 1.5, 2, 3 and 4×. They are symmetric in ratio, so normal speed sits in the
  middle and each step changes the pace by a similar amount. It shows in the right-hand column while an emote or
  reaction is in front. The value beside it reads the speed, and clicking it away from 1× resets to 1×. While the
  timeline shows, `<` and `>` step the speed, as Shift+, and Shift+. do in video players (`,` and `.` still step frames).
- **Facial animation** button beside Sway, shown while anything animates and the clip set has face data. The global
  set has it; the Chinals set does not yet, so the button is hidden there. `?face=0` still opens with the face off for
  that visit, and it no longer changes the remembered choice.
- Both choices are remembered in this browser, under their own `localStorage` keys: `finals-outfit.emote-speed` (a
  number; normal speed removes it) and `finals-outfit.facial-animation` (`off`; on removes it). Saved outfits are
  untouched, and older builds never read the keys. A stored speed is clamped, not matched to a stop, so a later build
  with other stops still honours it. Automated browsers ignore both, as they ignore Loop, so captures stay at 1× with
  the face on.

## How speed works, and what it must not break

- `mixer.timeScale` remains the "paused" switch (`RigAnimator.ts` header). Speed is the **emote action's own**
  `timeScale`. three times fades on the mixer's clock, not the action's, so the idle and every crossfade keep real time.
  The idle always plays at 1×. The control lives with the emote, and a sped-up rest pose would look broken.
- **Pause, scrub and frame steps** work in clip time, so they are unaffected. A held frame does not move when the speed
  changes. Resuming continues at the new speed.
- **Seek preroll** (the 1.5 s played through so the sway chains carry motion into a held frame) always runs at 1×. A
  held frame, chains included, is therefore a function of (clip, time) alone. A paused share link opens on the same
  pose whatever speed the person opening it has stored. The tests cover this at 0.25×, 1× and 4×.
- **Loops** wrap on the scaled clock (three handles that). An untouched emote still returns to the idle at its scaled
  end.
- **Sounds** (`EmoteSounds.ts`). Before this change the sound code assumed one clip second per audio second: cues were
  scheduled at `now + (cueTime - clipTime)`, voices played at the variant's pitch, and the drift rule compared the clip
  position with `offset + elapsed × rate`. At 2× that would have scheduled every cue late, and it would have restarted
  every long voice once a second as it drifted. The clock now carries `rate` (the speed), and sound follows it **like
  tape**: each voice plays at its pitch × speed, cue times and the look-ahead are converted to the audio clock, and the
  drift rule uses the real playback rate. Every clap and footstep lands on its frame, and pitch moves with the speed.
  Web Audio's buffer sources cannot time-stretch, and the only alternative was to mute away from 1×. The game's own
  fades (attack, window fade-out) are clip time and scale with the speed. The interface's short fades do not. A speed
  change counts as an interruption, like a seek: the voices fade and the emote rejoins mid-sound at the new rate.

## Share links carry neither, on purpose

- **Speed:** a link's pose is a clip and a time (`src/lib/share-pose.ts`), and that frame is identical at any speed,
  as above. Speed is how the viewer watches, like Loop and volume, which links don't carry either. A recipient landing
  in a 0.25× emote would think the site was broken.
- **Face off:** it is the viewer's own preference, as Sway is. Sway also changes the frame and is not in links.
  Carrying it would override the recipient's own choice, and it would change the link grammar that the share Worker
  validates (`workers/share-preview/src/share.ts`). Both sides would then need a coordinated Worker redeploy, for a
  small gain. Older builds would ignore it anyway. The recipient sees the same body frame, and the toggle is right
  there if they want the face at rest. If people start sharing "neutral face" frames, revisit this. It would be an
  optional `&face=0`-style key applied only to paused poses, and it would never be saved over the recipient's
  preference.

## Also changed

The emote picker's footer said facial expressions "are not shown yet". That has been stale since facial animation
shipped on 12 Nov. It now lists what the set really has (props, sound, facial expressions) and still says effects are
missing. The Chinals set has no face data, so its footer is unchanged.

## Agent checks (21 Nov 2026)

Static and unit:

- `tsc -b --noEmit`: PASS. `vite build`: PASS.
- New tests: `tests/emote-playback.test.ts` (stops, clamping, storage, blocked storage); `rig-animator-transport`
  (speed scales only the emote, pause holds at any speed, a later emote starts at the chosen speed and still returns to
  the idle, a paused link opens on the identical pose at 0.25×, 1× and 4×, Loop wraps on the scaled clock, the sounds
  are told the rate, face off fetches nothing and on fetches); `emote-sounds` (half speed schedules on the slower clock
  at half rate, 2× keeps a long voice without drift restarts and halves the window fade, a speed change rejoins
  mid-sound once). The affected files: 59/59 pass.
- Full `npm test`: 912 pass, 8 fail. All 8 need gitignored local model files that a worktree does not have
  (`public/models/body/SK_Body_M.glb`, `public/models/earring/beetlegold-01.glb`, the ski-blade fixture). None is in
  the code this change touches.

Real app (dev server on the live asset hosts, `?reconstructed=1`, the Studio light):

- **Built-in browser (a normal visitor):** the slider at 0.25× ran the emote at 0.25 clip-s/s, with the idle at 1 and
  `mixer.timeScale` at 1, and stored `0.25`. `<` stepped 4× to 3× to 2× and stored each. Paused at 2×, three `.`
  presses moved exactly three frame boundaries. A speed change while paused left the time at 6.6 s, and the 1× label
  reset it and removed the key. Face off put the posed facial bones back to rest (279 of 280; the last was 0.0001 rad,
  float noise), and on brought all 280 back on the same frame. After a reload with 0.5× and face off, both came back.
  No facial-animation file was fetched while off. Switching on mid-emote bound the head and posed it. All other
  `localStorage` keys, saved outfits included, were byte-identical before and after.
- **Playwright Chromium with `navigator.webdriver` masked**, so sounds and stored choices behave as for a visitor:
  - **Major Coronation, 4 cues.** At 0.5×, 2× and 4× the 7.67 s clip took 15.33, 3.82 and 1.87 s. Every cue was heard
    within one frame of its clip time: at most 0.021 clip-s off at 2× and 0.054 at 4× (13 ms real), against 0.013 at
    1×. The voices played at pitch × speed, with no drift restarts. Each untouched emote ended and returned to the idle.
  - **Loop at 2×:** two passes, both passes' cues within 0.017 clip-s, no restarts.
  - **Paused share link** made at 0.25× (frame 23): the link holds only `emote`, `t` and `paused`. Opened in fresh
    contexts with 1×, 0.25× and 4× stored, it landed on frame 23, paused. All 367 driven bones (body and face) matched
    the sender's matrices exactly, a maximum difference of 0.
  - **Face on/off, Major Coronation at 1.5 s:** the pixel difference was confined to the head, and the body did not
    move.
  - **Phone, 375×812 with touch:** the Speed row is 36 px tall and fits the column. The timeline's frame slider keeps
    its width, and the page does not scroll sideways.
- **Not covered:** a real phone and real touch drags; Safari and Firefox; listening by ear, since the checks read the
  audio scheduling, not speakers.
