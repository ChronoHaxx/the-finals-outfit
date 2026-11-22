# An emote picked while the outfit loads snaps back to the idle (21 Nov 2026)

Found while verifying PR #62 (`_docs/all-emotes-2026-11-21/README.md`, "An emote can go back to the idle after about
2 s"). Also on the live site before this fix.

## Symptom

As a visitor, click an emote in the first few seconds after the page opens: it plays for 1-2 s, then the outfit idle
replaces it. Waiting about 20 s first, or an automated browser (no idle autoplay), plays it to the end.

## Cause

Two different "loaded" moments in `CharacterViewer.tsx`:

- `ready`: the base body has loaded. The emote button enables here (`AnimationControls`, `disabled = !ready`).
- `busy`: an outfit pass is still running. The first motion (the default idle, or a share link's pose) waits for
  `ready && !busy` (the effect in `AnimationControls.tsx` under "The first motion once the outfit has loaded").

Between the two, the viewer can already pick an emote. When the outfit pass ends, the first-motion effect runs for the
first time and calls `animator.play(root, defaultIdle)`. `RigAnimator.play()` with a looping clip crossfades from
whatever is in front, so the viewer's emote is replaced. An emote still downloading at that moment would be dropped
outright (the idle's play takes a newer request, so the emote's download returns as superseded).

Trace on the live site (`early-stop-trace.mjs`, page seconds; `__rigIdle` is the viewer's outfit-pass flag):

```
2.14 emote button enabled
5.45 play(ace-pilot) busy=true current=null        <- the viewer's emote (Valkyria)
8.77   front=ace-pilot idle=null 0.63/7.33
8.93 __rigIdle=true                                 <- the outfit pass ends
8.93 play(outfit-idle) busy=false current=ace-pilot <- the first-motion effect starts the idle over it
9.31   front=outfit-idle idle=outfit-idle
```

## Fix

- `RigAnimator.playUnder(root, id)`: starts an idle without taking the front. With an emote in front it installs the
  idle under it, disabled, exactly as `play()` leaves an idle under an emote, so `returnFromEmote` crossfades into it
  when the emote ends. It takes no new request (an emote still downloading is not superseded) and waits for that
  download to land first. With nothing up any more it plays the idle as `play()` would. It does nothing when an idle
  already runs, or when the viewer stopped or closed their emote meanwhile.
- `AnimationControls`: on the first start, if the animator is already active or loading (the viewer picked something
  while the outfit loaded), that pick stays in front. The default idle, when the viewer would be animating (not
  reduced motion, not a remembered still choice, not automated), goes under it with `playUnder`; a share link's pose
  taken at that moment is dropped, as the click is the viewer's later choice. Every other path is unchanged.

## Verification (agent, 21 Nov 2026)

- Unit tests (`tests/rig/rig-animator-transport.test.ts`, 3 new): the idle started during an emote goes under it, the
  emote keeps its clock and plays to its end, then crossfades into the idle; an emote still downloading is not
  superseded; with nothing up it plays the idle, and after the viewer's stop or with an idle running it does nothing.
  The 3 failed before the fix (no `playUnder`) and pass after it. After rebasing onto main `80ea734` (the emote speed
  and face switch, PR #58, merged meanwhile; its first-motion effect is unchanged): whole file 17/17, with
  `rig-animator` and `emote-sounds` 47/47.
- `npm run typecheck` (`tsc -b`): PASS.
- `npm test` (rebased): 941 tests, 928 pass, 8 fail, all 8 the known ones needing gitignored files (the ski-blade GLB
  fixture, 5 socketed-static checks, base body geometry and UV).
- Local production build (`prod-build.mjs`: deploy.yml's hosts, animations `17ec92c3`), headless Chrome as a visitor
  (`early-stop-probe.mjs`, Valkyria = `ace-pilot`, 7.33 s):
  - main's source (baseline, `a2c6019`): `ace-pilot 1.42/7.33`, then `outfit-idle`. The bug reproduces locally.
  - this fix on `a2c6019`, click 0.5 s after the button enables: plays to `6.93/7.33`, then `outfit-idle`; clicked at
    once (`SETTLE=0`): plays to `7.33/7.33`, then `outfit-idle`.
  - this fix rebased on `80ea734`: `6.88/7.33` (0.5 s) and `7.29/7.33` (at once), each then `outfit-idle`.
  - trace of the fix: the outfit pass ends at 7.84 s with the emote at 1.77 s; `playUnder(outfit-idle) -> true`; the
    state reads `front=ace-pilot idle=outfit-idle` up to 6.97 s, then `front=outfit-idle`.
  - late click (`SETTLE=15000`, ordinary path): `play(outfit-idle)` when the outfit loads, the emote over it, back to
    the idle. Unchanged.
  - automated browser (`--unmasked`): the emote plays to the end and returns to the still pose. Unchanged.
- Headless timing differs from a real browser (software rendering, slower outfit pass): the hand checks are in
  `functional-checklist.md`.

## Scripts (Git Bash, worktree root)

```bash
node _docs/emote-early-stop-2026-11-21/prod-build.mjs                    # build to scripts/generated/emote-early-stop-2026-11-21/prod/dist
node _docs/emote-early-stop-2026-11-21/early-stop-probe.mjs "Valkyria"   # clip in front every 0.5 s after a quick click
node _docs/emote-early-stop-2026-11-21/early-stop-trace.mjs "Valkyria"   # who calls play()/playUnder(), and when
node _docs/emote-early-stop-2026-11-21/prod-build.mjs --anim=https://fd946744.the-finals-outfit-assets.pages.dev/   # PR #62's emotes
SHOTS=1 RUNS=4 node _docs/emote-early-stop-2026-11-21/back-to-back-trace.mjs "Coop Caper" "Gimme Five"   # every clip switch, with stacks
APP_URL=https://chronohaxx.github.io/the-finals-outfit/ node _docs/emote-early-stop-2026-11-21/early-stop-trace.mjs "Valkyria"   # the live site
```

## A later stop, reported once, not reproduced

PR #62's agent checks (`_docs/all-emotes-2026-11-21/user-steps.mjs`, its production build on port 4355) saw Gimme
Five go back to the idle at 1.49/5.67 s about 30 s after load, once in three runs: Coop Caper played to its end, then
Gimme Five was clicked straight away. That run's record was overwritten (the two saved runs passed, the idle already
running at step 1).

`back-to-back-trace.mjs` repeats that sequence on fresh pages and logs every clip switch inside the page (play, stop,
leaveEmote, openPose, playUnder, reset, returnFromEmote, the mixer's `finished` events, each change of the clip in
front) with call stacks. 0 early stops in 18 runs on 21 Nov:
- 8 on this branch built against PR #62's animations host (`prod-build.mjs --anim=https://fd946744.the-finals-outfit-assets.pages.dev/`),
  4 of them with screenshots at user-steps.mjs's moments (the reported stop was at 1.49 s, the screenshot at 1.5 s);
- 6 on PR #62's own build (port 4355), with those screenshots;
- 4 running user-steps.mjs's exact steps 1-3 on PR #62's build, with the same logging.

In the code, an emote in front goes back to the idle only through the first-motion effect (the race fixed here; it
runs once unless a share link's pose arrives), a mixer `finished` event for that emote (three fires it only when the
clip's time reaches its end), or the viewer's own input (picker, Animate button, the timeline's close). If it shows up
again, run `back-to-back-trace.mjs` (or add its `instrument()` to the failing script): the log names which one.

## Not changed here

- `returnFromEmote` without an idle fades the ended emote out without adding it to `fading`; if an idle is then played
  before that fade completes (the viewer clicks the idle just as an emote ends, or `playUnder` after an emote ended
  while the idle downloaded), the faded action stays bound, disabled, until the clip is played again. Harmless (weight
  0), pre-existing.
