# Emote sound effects (12 Nov 2026)

Emotes in the viewer play the game's own sound effects and music, in time with the animation. **235 of the 237 emotes
in the picker have sound.** CoconutRider and Tap dance are silent in the game too. Branch
`claude/emote-sfx-2026-11-12`. Functional checklist: [functional-checklist.md](functional-checklist.md).

## What the game does (offline survey of the Season 12 paks, read 12 Nov 2026)

THE FINALS uses **Unreal's built-in audio, not Wwise**. There are no `.bnk` banks and no `.wem` media. The path from an
emote to its sound:

| Step | Asset | What it holds |
|---|---|---|
| Event | `AnimNotifyStatePlaySoundAttachedWithCleanup` on the emote's AnimSequence (276 notifies) | A window: start the sound at its begin, stop it at its end over `FadeOutDuration`. |
| | `AnimNotify_DiscoveryPlaySound` / `AnimNotify_EmbarkPlaySound` (5) | Start once and ring out. |
| | `AnimNotifyVocalization` (3, BlackSmith) | A gameplay tag (`Vocalization.Effort`). The character's voice picks the line at run time: no asset, not played. |
| Logic | `SoundCue` (243): WavePlayer leaves under Random (weighted) and Modulator (random volume/pitch), plus the cue's own Volume/PitchMultiplier | Which wave, how loud, what pitch. |
| | `MetaSoundSource` (16, the musical emotes) | One shared template: `Wave Player.StartTime = SyncTime mod WaveDuration`, looping, 50 ms ADSR attack. |
| Media | `SoundWave` (275) | Cooked bulk data in **Bink Audio** (`ABEU` header), 48 kHz, 267 stereo + 1 mono, 1,334 s in all, 38 MB. |

Like Wwise, Unreal separates the **event** (gameplay: the notify and the cue graph) from the **media** (encoded waves).
Many events can share one wave, and the graph decides at play time which wave plays and how. The resolver walks from
the event to the media: `scripts/anim-export/sound-cues.mjs` (its header has the details).

**Coverage:**
- **Global:** 180 of the 182 emote sequences the live set plays have sound, 281 cues in all. Idles and slot
  reactions have none. Today's patch (paks dated 12 Nov 12:26) changed none of the 174 notify lists read on 5 Nov.
- **Chinals:** 43 of the 45 emotes have a sound notify (24 MetaSound, 12 SoundCue, 7 SoundWave). 42 of those 43 assets
  exist only in the Chinals client (UE 5.3). They need the chinals-probe route and the Chinals host, so they are not
  in this PR.

**Class defaults the paks don't contain** (cooked assets store only values that differ from the class default):
- `SoundCue.VolumeMultiplier` defaults to **0.75**. 34 cues leave it out, and 135 store exactly 1, which is what delta
  serialization against 0.75 looks like.
- Modulator pitch defaults to 0.95-1.05.
- The notify's `FadeOutDuration` default is unknown. Stored values include 0, 0.05, 0.1, 0.3, 0.5, 1, 1.2, 1.5, 2 and
  2.5, so the default is none of those. An explicit 0 also rules out 0. The player uses **0.25 s** where a notify stores
  none.
- 125 windows stop their sound before it ends by itself. In 103 of them, what is cut is at least 20 dB below the played
  peak (reverb or silence). Most of the other 22 store their own fade.

## Pipeline (all offline, nothing downloaded)

Tools already on this PC: `vgmstream-cli` r2168 (FModel's `.data` folder) decodes Bink Audio; ffmpeg encodes. The
exporter gained a `sound` mode: each SoundWave's cooked bytes, written as `<name>.<format>`.

**Git Bash, worktree root.** `R=scripts/generated/emote-sfx-2026-11-12/research`. `PAKS`, `USMAP`, `OODLE` and
`AnimExport` are as in `_docs/showcase-animation-2026-11-05/README.md`.

```bash
dotnet build scripts/anim-export/AnimExport.csproj -c Release -p:NativesDll='E:\Coding\the-finals-outfit\scripts\generated\chinals\natives\CUE4Parse-Natives.dll'
```

1. **Sequences:** `AnimExport list` → `targets-seqs-2.txt` (the manifest's 190 sources), then
   `AnimExport json ... $R/json-seqs-2 @$R/targets-seqs-2.txt`.
2. **Sound assets:** the notifies' sound assets (`targets-sounds-2.txt`, 268, plus 2 SoundClasses) →
   `json ... $R/json-sound-2`.
3. **Waves:** the cues' waves (`targets-waves-2.txt`, 275) → `json ... $R/json-waves-2` and
   `sound ... $R/waves-2` (.binka).
4. **Build:** `MSYS_NO_PATHCONV=1 node scripts/anim-export/build-emote-sounds.mjs --manifest <manifest> --seqs ... --sounds ...
   --wave-json ... --waves ... --vgmstream <...>/vgmstream-cli.exe --ffmpeg <...>/ffmpeg.exe --out <new dir>/sounds-1`
   (Windows paths for node).

**Output: `sounds-1/`.**
- `sounds.json` plus 275 AAC-LC `.m4a` files at 128 kbps (64 kbps mono), **20.4 MB**.
- An emote downloads only its own waves: 114 KB median, 256 KB at the 90th percentile, 544 KB at most.
- Encoding is bit-exact (`-fflags +bitexact`), so a rebuild gives identical bytes and an unchanged wave dedupes on
  upload.
- **AAC, not Opus:** every browser's `decodeAudioData` takes AAC in MP4, and Safari's Opus support is still partial.
- **Priming:** the MP4 edit list marks the encoder's 1024 priming samples. ffprobe says every file is within −0.7 to
  +0.3 ms of its source. Chrome and Firefox decode them to the source length within 0.5 ms (checked below).

## The player (`src/rig/EmoteSounds.ts`)

**Clocks.** The animation clock is the master, and audio follows it. Two mechanisms do two jobs:

- **Scheduling, for attacks.** Polling once per frame would start a cue up to a frame late. Starting it "at the right
  offset" instead skips its first milliseconds, and a clap *is* its first milliseconds. So cues beginning within the
  next 0.12 s are handed to the audio thread now, with an exact `AudioContext` time (`source.start(when)`), which it
  honours to the sample. The same goes for the next pass of a looping emote.
- **Reconciliation, for everything else.** Each frame asks what should be sounding at this clip time, and where in its
  wave, then makes the voices match. That makes seeking, pausing and looping safe against double-firing, and lets a
  resume or a shared link join mid-sound, as a video player does.

**Drift.** RigAnimator caps a frame at 0.1 s, so after a hitch the animation is *behind* the audio. Audio is allowed
to lead: a restart would replay sound already heard. Only a long or looping voice more than 0.25 s out restarts, at
most once a second.

**User actions.** Pause, seek, scrub, step, another emote or close fade everything out quickly (`hold()` calls
`cut()`). The animation's own flow follows the game: windows stop at their end with their fade, and "once" sounds ring
out across a loop and after the emote ends.

**Musical emotes in Loop mode** (a guess about Embark's code): SyncTime is taken as the time since the sync group's
current run began, and a run lasts while a window of the group is active.
- **Windows covering the whole pass** (CPop, Disco_03): the voice carries across the wrap, so the 8-16 s tracks keep
  going over a 7 s dance.
- **Windows with a gap before the clip ends** (Jester, Mariachi): the track restarts from the top each pass, in step
  with the strumming.

**Autoplay.**
- No AudioContext exists before a gesture. Chrome warns if one is made earlier, and Safari wants the resume inside a
  gesture handler.
- An emote that a link opens plays silently until the first click, then joins mid-sound.
- The gesture listeners stay installed, because iOS needs a gesture to resume after a call or Siri.
- A hidden tab fades out, then suspends.

**Settings.**
- Mute and volume are remembered (`finals-outfit.emote-sound`, every access in try/catch).
- **Default: on, at 0.7.** Sound only ever follows a click (the autoplay rule), and the idle has none, so "on" never
  surprises anyone. Muted by default would hide the feature.
- Muted, nothing is downloaded and no AudioContext is made.
- Automated browsers (`navigator.webdriver`) get no sound object at all, so captures stay silent and deterministic.

**UI.** A speaker button sits beside Pause and Animated while an emote with sound is in front. A slim volume slider
appears beside it on mouse screens; phones use their own buttons. It is not in the timeline: there it cut the phone's
frame slider from about 56 px to 36 px. The picker's intro line now says props and sound play.

**Fable plan review** (thread ead1b39a, about $3.55): it changed the drift rule (no rewinds),
added explicit cuts in `hold()`, the release at an inspected end, the portable fade envelope, no downloads while muted,
the persistent gesture listeners and the suspend after the fade. It also flagged the musical-loop phase question.

## Verification

**Unit tests:**
- `tests/emote-sound-cues.test.mjs` (7): the resolver.
- `tests/rig/emote-sounds.test.ts` (13): the player, on a fake AudioContext. Covers look-ahead, window ends and
  default fade, pause and resume mid-sound, the covering loop carried across wraps, instrument restarts, a musical loop
  joining, selective drift restarts, once cues never rewound, re-play after a seek back, muted means no downloads,
  locked until a gesture, settings.
- The flam test fails without its fix, so it covers the bug it was written for.

**Suite:**
- `npm test`: 827 pass and 8 fail. All 8 failures need extracted game GLBs under `public/models` that this fresh
  worktree lacks (`SK_Body_M.glb`, earrings, ski blade); none involve this change.
- `npm run build` (tsc + vite) passes.

**Real browser** ([check-sounds.mjs](check-sounds.mjs), real clicks, frame-by-frame samples of the animation clock
against the audio clock). The local preview is [serve-5192.mjs](serve-5192.mjs): the live set-5 and props-9 proxied,
with the local `sounds-1`.

**Chrome 17/17** ([check-chrome.json](check-chrome.json)):
- 15 measured cue onsets are −22 to +3 ms from their animation time (median −2 ms). The −22 ms is BlackSmith's first
  cue, 0.14 s into the emote: its props load on the first frames, a frame passes the 0.1 s cap, and the animation lags.
  Three runs gave −30, −15 and −22 ms. Under the ~45 ms where audio leading becomes noticeable.
- A link before any gesture leaves no AudioContext. The first click joins mid-line.
- Pause and scrub are silent. A resume starts at the held offset, once.
- Looping finger-crack: 8 starts, each once, and the once cues are never stopped by the wraps.
- CPop: one music voice across two wraps. Jester: the next pass is scheduled from the top at 0.333 s.
- Mute is remembered across a reload, with 0 waves downloaded while muted. Unmuting joins. No console errors or
  warnings.

**Firefox 16/17** ([check-firefox.json](check-firefox.json), Playwright's Firefox 1488 build):
- Every logic check passes. Firefox also trims the AAC priming.
- The failure is timing. Two cues near an emote start were −84 and +39 ms out while headless Firefox drew WebGL in
  software: the samples show the animation clock running at 0.96× and 0.90× of real time (frames over the 0.1 s cap).
  Steady-state cues are within ±5 ms.

**Production build, Chrome 17/17** ([check-chrome-prod.json](check-chrome-prod.json)):
- `vite build` with deploy.yml's hosts and `VITE_ANIMATIONS_BASE=https://ab913ac8.the-finals-outfit-assets.pages.dev/`,
  served by `vite preview --base /the-finals-outfit/`. The sounds come cross-origin from the published host.
- Cue onsets −18 to +4 ms (median 0 ms).

**After the rebase onto the facial animation (12 Nov 2026)**, the dev preview serving the staged faces + sounds set:
- **Chrome 17/17** ([check-chrome-superset-local.json](check-chrome-superset-local.json)): onsets −12.6 to +3.5 ms.
- **Faces 2/2** ([check-faces-superset-local.json](check-faces-superset-local.json), [check-faces.mjs](check-faces.mjs)):
  the facial session's two production cases, a balaclava and a beard. Both posed and wrapped, every `faces-1` file 200,
  and no sound file fetched (automated browser).
- **Check fixes:**
  - An emote now also waits for the head's face data before it starts, so the cold-link step waits for the pose asset
    too.
  - A dev build takes the source head route only with `?reconstructed=1`, so the face check passes it.
- **A self-inflicted failure:** Vite reloads the page whenever a file in the worktree changes, including these docs.
  Editing them during a run broke one run. Don't edit the worktree while a check runs.

**Not checked:**
- Real Safari (macOS or iOS): no Apple device here. Playwright's Windows WebKit doesn't use Apple's decoder.
- Phones by hand, and a listen by ear against in-game footage.
- Window ends and fades by ear.

**Found by these checks and fixed:**
- **A flam.** A voice the audio clock had started while the animation clock still read a few ms before its cue was
  stopped and scheduled again.
- **A measurement mistake.** Playwright's `evaluate` runs with a user gesture, so the first "before any gesture" check
  tested nothing.

## Hosting

### First upload: `ab913ac8` (12 Nov 2026, on your "Yes, upload it"), superseded and never to ship

**Animations host `ab913ac8`** (alias `anim-1112-emote-sfx`), from the staged
`scripts/generated/emote-sfx-2026-11-12/upload/anim-20261112c/` (845 files):
- The then-live `cf84e9b6` set: set-5 and props-9, byte-identical to the receipts of the 12 Nov upload.
- `sounds-1/`.
- `manifest.json`, which differs from `cf84e9b6`'s only by `"sounds": "sounds-1/sounds.json"`.

**Upload:** wrangler 4.131.1 `pages deploy` (see `_docs/showcase-animation-2026-11-05/README.md`): 277 new files,
567 deduplicated ([upload-anim-ab913ac8.txt](upload-anim-ab913ac8.txt)).

**Verified** ([deployment-anim-ab913ac8.json](deployment-anim-ab913ac8.json)):
- All 844 files are byte-identical to staging.
- `.m4a` is served as `audio/mp4`, with CORS `*` and an immutable cache. A missing file returns 404.

**Why it must not ship:**
- Facial animation (PR #48) went live on main while this PR waited. Its host `e5250f94` is `cf84e9b6` plus `faces-1/`,
  and main's `ANIMATIONS_BASE` points at it.
- `ab913ac8` has no `faces-1/`: pointing the site at it would switch the faces off.
- It stays published, untouched, as a record.

### Faces + sounds: `e4608dac` (13 Nov 2026, on your "Yes, upload it"), the host this PR ships

**Animations host `e4608dac`** (alias `anim-1113-faces-sfx`), from the staged set below:
- **Upload:** 1 new file (the manifest), 1,131 deduplicated ([upload-anim-e4608dac.txt](upload-anim-e4608dac.txt)).
- **Verified:** all 1,132 files are byte-identical to staging
  ([deployment-anim-e4608dac.json](deployment-anim-e4608dac.json)). `.m4a` is `audio/mp4` with CORS `*` and an
  immutable cache.
- **deploy.yml:** `ANIMATIONS_BASE` points at it. **Rollback:** `e5250f94`.
- **Production build against it** (15 Nov, with the prop prewarm below):
  - Chrome 17/17 ([check-chrome-prod-e4608dac-prewarm.json](check-chrome-prod-e4608dac-prewarm.json)): every cue
    within ±5.5 ms, and no frame over 40 ms.
  - Faces 2/2 ([check-faces-prod-e4608dac-prewarm.json](check-faces-prod-e4608dac-prewarm.json)).

#### Staging (as built 12 Nov)

**Rebased** onto main `64f68d3`: both features sit side by side in `RigAnimator.ts` and `AnimationControls.tsx`.

**Staged** `scripts/generated/emote-sfx-2026-11-12/upload/anim-20261112d/` (1,133 files, 140 MB):
- `e5250f94`'s set: set-5 392, props-9 175, faces-1 288, plus `_headers`.
  - Copied from the facial session's staging.
  - Checked first against the live host: 856 of 856 files byte-identical
    ([verify-faces-staged-e5250f94.json](verify-faces-staged-e5250f94.json)).
- `sounds-1/` (276): the bytes already verified on `ab913ac8`.
- `manifest.json`: `e5250f94`'s, unchanged except for `"sounds": "sounds-1/sounds.json"` added after `faces`.

Live users hear sounds only once this PR is merged.

## Prop prewarm: the first-play stall (15 Nov 2026)

**The failures.** The first production run against `e4608dac` failed 2 of 17 checks. BlackSmith's first cue played
37 ms early, and CPop's music restarted 5 times.
- **CPop** did not reproduce. In that run the animation clock ran at 0.22× real time, so the page was stalling
  (probably other load on the machine), and drift restarts are the player's designed response. The check now records
  frame gaps (`frames` in each emote's report), so a timing failure says whether the page stalled.
- **BlackSmith** reproduced every time. It stalls twice in its first 0.4 s (110-190 ms frames), when its anvil and log
  props first draw. A replay in the same page never stalls.

**Mechanism.**
- WebGL compiles a material's shader program the first time something using it is drawn, and uploads each texture on
  its first draw, both on the main thread.
- The animator steps at most 0.1 s per frame, so a 180 ms frame loses 80 ms of animation time.
- The audio clock does not stop: a cue scheduled before the stall plays early (−54 ms measured). Later cues are
  scheduled from the delayed animation clock, so they stay in step.
- Without sound this is still a visible hitch whenever a prop first appears.

**Fix** (`EmoteProps.warmForDraw`; `play()` already waits for an emote's props, so it now also waits for this):
- Each prop's textures are uploaded and its programs compiled (`compileAsync`) before the emote starts, once per prop.
- A failure leaves that prop to compile on its first frame, as before. A 3 s cap means a warm can never hang a start.
- The viewer's renderer and scene come through the existing preview handle (`getPreviewScene`), so
  `CharacterViewer.tsx` is unchanged.

**Matching the variants.** A shader log ([stall-diag.mjs](stall-diag.mjs); [stall-replay.mjs](stall-replay.mjs) plays an emote twice) showed what the
first draw actually compiled. A program's variant depends on the scene and the render target as well as the material,
so warming has to match all three:
- **Render target.** The viewer draws into `StableFrameAccumulator`'s target (linear output, no tone mapping) or, when
  that is off, to the canvas. Both variants are compiled.
- **Shadow pass.** Its depth programs are compiled through stand-ins that carry the depth material three's shadow map
  would choose. Programs are cached by their parameters, so the real pass finds them built.
- **Shadow filter type.** R3F's `shadows="soft"` sets `PCFSoftShadowMap` on every Canvas render, and three r184
  (which deprecated it) rewrites it to `PCFShadowMap` in its next shadow pass. PCFSoft has no shader define, so a
  program compiled in between gets `SHADOWMAP_TYPE_BASIC`: the anvil's rifle was warmed with the wrong variant. The
  warm compiles as the next pass will draw.

**Left as is:**
- drei's `<ContactShadows>` draws the scene with its own private `MeshDepthMaterial` override every frame. The first
  non-skinned mesh in the scene needs one new variant of it, once per session.
- Warming that would mean copying drei's private material and its `onBeforeCompile` (part of the cache key): fragile,
  for one small program that no longer stalls measurably.

**Result** (production build against `e4608dac`):
- BlackSmith's first cue went from −37 and −54 ms to −3.7 ms.
- No frame was over 40 ms in any measured emote.
- Four first plays of BlackSmith had no stall frames, where every run before had two.

**Tests:** `tests/rig/emote-props.test.ts` covers four cases:
- prepare waits for the warm;
- each prop warms once;
- a failure is retried;
- a warm that never settles holds the start for no more than the cap.

**Side note, not changed here:** `shadows="percentage"` in `CharacterViewer.tsx` would ask for PCF directly. That
would end the per-render rewrite and three's deprecation warning.

## Open items and follow-ups

- **Chinals emote sounds:** in PR #51, which carries this PR's code. That session reports three fixes to code from
  this PR, on its branch and not verified here:
  - **MetaSound volume:** a MetaSound plays at its own Volume. If right, 14 global musical emotes in `e4608dac`'s
    `sounds.json` have the wrong gain, and the global sounds need a rebuild and a new host.
  - **Leak:** `EmoteSounds.dispose()` should remove its gesture listeners; mode switches leaked AudioContexts.
  - **Late first sound:** a context whose clock still reads 0 is not running yet; the first sound came late, then
    was skipped.
- **Voice lines:** the 3 BlackSmith vocalization notifies resolve through the character's voice at run time.
- **Raising the frame cap while sounds play:** a 0.35 s cap would stop the audio leading after hitches. It changes
  existing animation behaviour, so it's your call.
- **Spatial audio:** not reproduced, and not needed in a close-up viewer. The game attaches to the head with
  `Generic_Loud` attenuation.
