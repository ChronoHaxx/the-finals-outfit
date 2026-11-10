# Emote timeline and posed share links (10 Nov 2026)

The user's request: people use the site as a pose reference, so the share preview should show whatever is on screen,
including an emote frame (playing or paused), with the time noted; links should carry the emote, time and paused
state; and an emote should have a timeline with frame stepping.

## What changed

- **Timeline bar** (`src/components/EmoteTimeline.tsx`) along the bottom of the viewer while an emote or reaction is
  in front: play/pause, frame back/on (also `,` / `.`), a slider in whole frames (frame 0 first, as Unreal counts),
  seconds and frame / last frame, and a close button back to the idle. A drag holds the frame under the thumb once
  per rendered frame (no sway preroll); release does a proper seek. Pausing, dragging or stepping marks the emote
  "inspected": it stays on its last frame instead of returning to the idle, and play from there restarts it.
- **Transport in `RigAnimator`**: a pause is a hold of one clip at one time (fades and the idle under it stopped), so
  a paused frame is exactly (clip, time). `scrub`, `step`, `leaveEmote`, `openPose`, `timeline`, `sharePose`.
- **Links** (`src/lib/share-pose.ts`): `&emote=<clip id>&t=<seconds, ms>&paused=1` beside the outfit code, in both
  link styles. Old links have no `emote` and open exactly as before. `store/open-link.ts` reads the pose at boot and
  on every router change, before saved outfits can tidy the link away; a refused or unreadable link brings no pose.
- **Share card** (`src/rig/SharePreviewRender.ts`): with a pose, the live pose (props on), centred on the pelvis,
  measured from the skinned vertices as drawn, pulled back until wide poses fit, the ground kept above a caption
  ("BOOMERANG 1.57 s · frame 47 / 270 · paused"). No pose (the idle simply playing, or still): the same card as before.
- **Share panel**: "Include this frame" with the emote, time and frame; notes say which frame the link or card has.
- **Worker** (`workers/share-preview`): accepts, validates, stores and returns the pose; its page opens the builder on
  that frame and says "frozen 1.567 s into an emote" in og:description. Backward compatible both ways.
- **Bug fixed on the way**: an emote's natural end snapped toward the still pose for a frame before fading into the
  idle (three marks a clamped one-shot `paused`, so `!isRunning()` stopped it instantly). Regression test added.

## Choices made (reversible, flagged in the PR)

1. A share records a pose only when an emote is in front (playing or paused) or the idle is paused. The idle simply
   playing (the default) still shares the still-pose card and a plain link.
2. A playing link opens on its frame and plays on, returning to the idle at the end; a paused link holds its frame
   (reduced motion and automated browsers always hold).
3. Seconds (ms) in links, not frames: independent of a clip's frame rate; a time within 0.02 frames of a frame lands
   on it exactly.
4. Wide poses shrink the character (to 62.5% at most) rather than cut hands or props at the image edges.

## Plan review

Fable (thread 73e5862a, about $2.64) reviewed the plan before code. Adopted: one canonical hold for pause/seek/scrub,
`inspected` set by the viewer's transport only, a `seeking` guard so a preroll touching the end is not the emote
ending, superseded `openPose` never seeks what the viewer picked, posed bounds measured without three's bounding-box
cache, horizontal fit, integer-frame slider with a native `change` commit, the declined-link and in-app-link cases.
Its claim that the emote end skipped the crossfade was checked with a probe before fixing (90 deg -> 5 -> 30).

## Agent evidence (10 Nov 2026, local build of this branch)

Production asset hosts, local `wrangler dev` Worker (simulated KV, nothing touches the account), Playwright Chromium
with `navigator.webdriver` hidden (so the default idle runs as for a visitor). Screenshots in `shots/`, judged by eye.
They are renders of game assets, so they stay local (git-ignored, like the showcase captures): in the worktree
`.claude/worktrees/quizzical-hermann-33b51b/_docs/emote-timeline-2026-11-10/shots/`.

| Check | Result |
| --- | --- |
| Unit tests: transport (8), share-pose (8), framing (3), Worker (12, 3 new), existing animator (11) | PASS |
| Full `npm test` | 765 pass, 8 fail: the asset tests that need extracted models absent from a worktree (ENOENT), as on main |
| `tsc -b --noEmit` | PASS |
| Emote from the picker, pause on the bar, five `.` presses | frame 47 / 270 exactly (`03`) |
| Share while paused | "Link copied · preview shows frame 47"; Worker link carries `emote=boomerang&t=1.567&paused=1` (`04`, `05`) |
| Card | the paused frame from four angles, props on, caption (`06` before the framing fix, `09` after) |
| Open the Worker link in the same browser (link matches a saved outfit, so it is tidied away at boot) | address tidied to `#/`, pose still restored on frame 47, saved outfit untouched (`07`) |
| Close the emote, idle playing, share | still-pose card exactly as before, no caption, link without `emote` (`10`) |
| Share while playing; open in a second tab | link `t=2.306`, frame 69; receiver starts there, plays on, returns to the idle (`11`) |
| Mouse drag on the slider | motion flag on during the drag, no full seeks; one seek on release; `,` x10 steps 10 back; commas typed into search do not step |
| Pose link opened inside the running app (different outfit) | new outfit as a draft, flag emote held on frame 90 (`14`) |
| Long prop (flag) | everything fits, ground anchored above the caption (`15`) |
| Phone 390x844, touch | bar 48 px, buttons 40 px, tap on the slider jumps, step taps step; decorative tag hidden while the bar shows (`12`, `13`, `16`) |
| Console | no errors; warnings are existing three deprecations and the motion-vector shader note |

Not covered by agents: a real phone and real touch drags, Safari/Firefox (Firefox styles the range track with its own
pseudo-elements), a real Discord/X unfurl of a posed card (needs the deployed Worker), long sessions.

## Local run (for the checks below)

`build-local.sh` (Git Bash, worktree root) builds this branch against the live asset hosts with the Worker at
`http://127.0.0.1:8787`. Then two terminals:

PowerShell, `E:\Coding\the-finals-outfit\.claude\worktrees\quizzical-hermann-33b51b\workers\share-preview`:

```powershell
$env:WRANGLER_SEND_METRICS = 'false'; npx --yes wrangler@4.131.1 dev --port 8787 --ip 127.0.0.1 --var ALLOWED_ORIGINS:http://127.0.0.1:4344 --var APP_URL:http://127.0.0.1:4344/the-finals-outfit/
```

PowerShell, `E:\Coding\the-finals-outfit\.claude\worktrees\quizzical-hermann-33b51b`:

```powershell
npx vite preview --port 4344 --strictPort --host 0.0.0.0 --base /the-finals-outfit/
```

Ctrl+C stops either. `wrangler dev` keeps its simulated KV in `workers/share-preview/.wrangler/` (git-ignored).
