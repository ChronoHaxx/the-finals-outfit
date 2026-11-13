# Chinals emote sounds (12-13 Nov 2026)

The 45 Chinals emotes in Chinals mode play their in-game sounds, in time with the animation, with the same player as
the global emotes. **43 of the 45 have sound.** Gacha_01 and Painter have no sound notify in the game files. Branch
`claude/chinals-emote-sounds-2026-11-12`: Chinals mode (PR #44) with emote sounds (PR #47) merged in, plus the fixes
below. Functional checklist: [functional-checklist.md](functional-checklist.md).

## What the Chinals client does (offline reads of its UE 5.3 paks)

Each emote has one sound notify, an `AnimNotifyStatePlaySoundAttachedWithCleanup` window. That is the same class as in
global; it is a native script class, so its code is not in the paks.

| Sound asset | Emotes | What it is |
|---|---|---|
| MetaSoundSource | 24 | The global musical template, checked by its wiring (below). |
| SoundCue | 12 | WavePlayer leaves; TakeAway's cue is a **SoundNodeMixer** playing two waves at once. |
| SoundWave | 7 | Played directly. |

- **Waves:** 44 SoundWaves in Bink Audio (`.binka`), like global. 393 s of audio.
- **Sync groups:** only MidAutumn and Swimsuit carry `AudioSyncGroup.MariachiBand` (with a 1 s fade). The other 41
  notifies have no sync tag.

### The 24 MetaSounds against the global template

Each graph was reduced to its wiring (which output feeds which input), node classes, literals and interfaces, and
compared with the 16 global ones ([tools/metasound-signatures.mjs](tools/metasound-signatures.mjs)):

- **22** (Applaud, CuteCat, Mahjong, NuoOpera...): the template plus `UE.Source.OneShot`, whose "On Finished" output is
  wired to the Wave Player. A looping Wave Player never finishes, and `Loop = true` in all 22, so that edge never fires
  and the graph sounds the same as the template. Their Wave Player node is version 1.0 (UE 5.3); global's 1.1 adds only
  an unconnected "Maintain Audio Sync" input.
- **2** (MidAutumn, Swimsuit): exactly the template's wiring, but their `FloatModulo` is a different patch asset,
  `/Game/Audio/MetaSound/FloatModulo`, where the others use `/EmbarkScript/Audio/MetaSound/FloatModulo`.
- **Both FloatModulo patches were read** (second probe pass) and are the same graph:
  `Result = X - float(int32(X / Y)) * Y`, a truncating modulo. For the X >= 0 a clock gives, that is X mod Y, as the
  player assumes. This also settles the global template's patch, which PR #47 had taken from its name. The global
  build's own copy has the same class ID but was not read.
- **SyncTime without a sync group:** `BP_AudioSyncManager` (a data-only Blueprint over Embark's Angelscript
  `AudioSyncManager`) configures one group, MariachiBand, with sync type `SyncTime`. So the 41 untagged MetaSounds keep
  the graph's stored SyncTime default, 0, and start at the top of their wave. The player does the same for a looping cue
  without a sync group. This is strong evidence, not proof: the Angelscript itself is not readable here.

The resolver ([sound-cues.mjs](../../scripts/anim-export/sound-cues.mjs)) now accepts a MetaSound only when its edges
equal the template's (plus the inert one-shot edge when `Loop` is true), its classes match, its only Wave Player literal
is `Loop`, and its FloatModulo is a patch that was read. Anything else still throws.

## Fixed along the way (shared with the global sounds, PR #47)

1. **MetaSound loudness.** The resolver gave a MetaSound volume 1 and multiplied in its inner wave's `Volume`. But
   `UMetaSoundSource` is a `USoundWave`: its own `Volume` scales its output, and the Wave Player inside ignores the
   wave asset's `Volume` and `Pitch` (Epic's audio lead on the UE 5.3 forum; the same in a 5.7 source copy). Now a
   MetaSound plays at its own `Volume` (default 1; no asset stores exactly 1, as delta serialization predicts).
   - **Global effect:** 14 of PR #47's 16 musical emotes change gain, e.g. Disco 1 -> 0.75, ElectroSynth 1 -> 0.55,
     Jester Drum 1 -> 2.1, Puppeteer 1.5 -> 1.3. Every wave file is unchanged. **PR #47's staged `anim-20261112c`
     `sounds.json` predates this and must be rebuilt before it is uploaded.**
   - Chinals: 22 MetaSounds play at 1.3, MidAutumn and Swimsuit at 0.75.
   - Fable advisor consulted (thread 395e1a3a, $1.32). Its assumptions were checked against the data: no stored
     `Volume` of exactly 1, no MetaSound `Pitch`, all template waves stereo, no modulation or source effects, and the
     sound classes store no volume.
2. **Mixer cues.** A `SoundNodeMixer` on a cue's root path is now reproduced: each input is a layer, and the build writes
   one cue per layer. Below a Random or Modulator it still throws.
3. **Audio devices left behind.** `EmoteSounds.dispose()` closed its context but left its gesture listeners installed,
   so the next click made a new AudioContext for the discarded object. Chinals mode replaces the animator on every
   mode switch, so each switch would have leaked one. Now dispose removes the listeners and refuses to unlock again.
4. **Codec.** `build-emote-sounds.mjs` looks for `<package>.<codec>` instead of `.binka` only.
5. **The first sound after unlocking.** Chrome reports a context made in a gesture as "running" before its device
   renders: `currentTime` still reads 0. A voice started then played late by the device's start-up and was then skipped
   forward by the drift rule. The player now treats a clock at 0 as not running yet, and the cue joins at its offset
   when it ticks. Chinals mode makes a fresh context after every mode switch, so this was the first emote after each.

Global regression: rebuilding PR #47's global sounds gives the same 275 wave files byte for byte, and a `sounds.json`
that differs only in the 14 MetaSound gains above.

## Pipeline (offline, nothing downloaded)

The paks are read with `scripts/chinals-probe` (CUE4Parse 1.2.2.202611, `GAME_TheFinalsTencent`), which gained a
`sound` mode identical to anim-export's. anim-export was not rebuilt. The probe and its docs stay out of this public
repo, as before (they live untracked in the Chinals mode worktree).

**Read-only exports** (the key is typed into a hidden prompt and stays in that process):
[tools/export-sounds.ps1](tools/export-sounds.ps1) (46 sequences, 43 sound assets, then the 44 waves'
JSON and audio; [tools/wave-targets.mjs](tools/wave-targets.mjs) lists the waves), then [tools/export-patches.ps1](tools/export-patches.ps1) (the two FloatModulo patches and `BP_AudioSyncManager`). Outputs go to
`scripts/generated/chinals-sounds-2026-11-12/research/` (ignored by git).

**Build** (Git Bash, worktree root; `W=scripts/generated/chinals-sounds-2026-11-12`):

```bash
MSYS_NO_PATHCONV=1 node scripts/anim-export/build-emote-sounds.mjs --manifest <live Chinals manifest.json> \
  --seqs $W/research/json-seqs-1 --sounds $W/research/json-sound-1 --wave-json $W/research/json-waves-1 \
  --waves $W/research/waves-1 --vgmstream <FModel .data>/vgmstream-cli.exe --out $W/sounds-1
```

**Output `sounds-1/`:** `sounds.json`, 44 AAC-LC `.m4a` files, 5.7 MB (median 133 KB, largest 225 KB). 44 cues (43
windows plus TakeAway's second layer), 24 musical loops. Encoded lengths within -0.7 to +0.3 ms of the sources.

## Verification

**Unit tests:** `tests/emote-sound-cues.test.mjs` (10) and `tests/rig/emote-sounds.test.ts` (15), all pass. New since
PR #47: the template by wiring on both engine layouts, unread patches and pitch literals refused, MetaSound volume,
mixer layers, dispose removing its listeners, and a context whose clock has not started. The dispose and clock tests
fail on PR #47's code, so they cover the bugs they were written for.

**Suite:** `npm test` 838 pass, 8 fail, 5 skipped. The 8 are the same as PR #47's: they need extracted game GLBs this
worktree lacks. `npm run build` passes.

**Real browser** ([check-chinals-sounds.mjs](check-chinals-sounds.mjs), Chrome, real clicks, the animation clock
sampled against the audio clock every frame; the preview below). **12/12** ([check-chrome.json](check-chrome.json)):
- Chinals mode fetches `sounds.json` from its own host (`/chinals-animations/`), global from `/animations/`.
- Onsets: Ovation +26 ms (the first sound after audio unlocked), Drink Up both layers +3.8 ms and together, Keepy-Uppy
  -1.5 ms, Forced Ignition +5.6 ms, Floating Greeting -1 ms.
- Floating Greeting played through: no restart (animation at 1.00x, longest frame 32 ms) and stopped at 10.223 s, its
  window ending at 10.212 s.
- Gacha_01: no Sound button and no voice.
- Decoded AAC lengths within 0.7 ms of the sources.
- Three Global <-> Chinals round trips, an emote with sound in each: each mode plays its own sounds, and at the end
  exactly one AudioContext is open (7 made, 6 closed).
- No console errors or audio warnings.

**Found by these checks and fixed:** the first run started Ovation's voice on a context made moments earlier, whose
clock still read 0; it sounded about 0.7 s late and the drift rule skipped it forward. The player now waits for the
clock (item 5 below).

**Not checked:** Firefox and Safari for the Chinals set, phones, and a listen by ear against in-game Chinals footage.

**Preview:** the command in the functional checklist:
[serve-preview.mjs](../chinals-mode-2026-11-12/serve-preview.mjs) with `--chinals=` the staged folder and `--set=` PR
#47's staged global set (so global has sounds too).

## Hosting (needs your yes)

Staged: `scripts/generated/chinals-sounds-2026-11-12/upload/chinals-20261113-sounds/`, 189 files, 67 MB.
- The live `dcb131a5` set (144 files: `manifest.json`, `set-3/`, `props-2/`, `_headers`), copied from the folder it was
  published from. The live manifest was fetched and is byte-identical to that copy.
- `sounds-1/` (45 files).
- `manifest.json` differs from the live one by one line: `"sounds": "sounds-1/sounds.json"`.

A new deployment of `the-finals-outfit-chinals-assets` uploads about 45 new files (5.7 MB). Then deploy.yml's
`CHINALS_ANIMATIONS_BASE` (on PR #44's branch) moves to the new host. **Rollback:** revert that line; `dcb131a5` stays.
Without the bump, nothing changes for users: the live Chinals manifest has no `sounds`, and the player stays silent.

## Open items

- **Loud transients.** TakeAway's foley plays at gain 4.8 (cue volume 4 x mixer input 1.2). At the default volume 0.7,
  11 of its 830,000 samples go over full scale (19 at full volume) and are clipped by the browser. Global has gains up
  to 3. A limiter on the player's master would catch these; it changes existing behaviour, so it is your call.
- **PR #47's global staging** needs `sounds.json` rebuilt with the MetaSound volume fix before its upload.
- **Cue looping (from memory, unchecked):** Fable recalls that a cue's WavePlayer clears the wave's `bLooping`. No
  Chinals wave sets it; one global wave does (`Emote_Frontend_Electro_01`, used by a MetaSound, where it is now
  ignored).
- Not checked: Safari, phones, and a listen against in-game Chinals footage.
