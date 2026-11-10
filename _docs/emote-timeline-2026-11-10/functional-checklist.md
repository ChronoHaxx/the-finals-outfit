# Guided functional review — emote timeline and posed share links

## What you are checking

An emote can now be paused, dragged and stepped frame by frame, and a share link (and its preview card) keeps the
exact frame on screen. This catches a link or card showing a different pose from the one you shared, the timeline
losing your frame, and old links or saved outfits behaving differently.

- PR / originating issue: the draft PR for branch `claude/emote-scrubber-share-pose-2026-11-10` (your request of
  10 Nov 2026: share what's on screen, emote frame + time, paused state, timeline scrubber, frame stepping).
- Test this revision: branch `claude/emote-scrubber-share-pose-2026-11-10`, the commit shown in the PR header.
- Open: this PC <http://127.0.0.1:4344/the-finals-outfit/>; phone on the same Wi-Fi
  <http://192.168.1.131:4344/the-finals-outfit/> (if it can't connect, Windows Firewall is blocking Node on private
  networks; test on this PC only).
- Prerequisites: the two local servers in "Get it running" (a build of this branch with the live artwork, and the
  share Worker running locally with simulated storage). Nothing touches the live site or your Cloudflare account.
- Approximate hands-on time: 10-15 minutes.
- Agent checks: PASS, see `README.md` in this folder (screenshots in `shots/`).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If the servers from the session are still running (the PC link above loads), skip to step 1. Otherwise follow
"Local run" in `README.md`: one PowerShell window for the Worker, one for the app. Stop both with Ctrl+C.

The local build sends preview images to the local Worker only. On the phone address, "Link with preview image" falls
back to a plain link (the local Worker only accepts this PC's address); use the PC for steps 4 and 5.

## Try it yourself

- [ ] **1. Start:** open the PC link, close the welcome screen. Expected: the idle plays as usual and there is no bar
  along the bottom of the viewer.
- [ ] **2. Timeline:** **Emotes** → pick any emote with movement (e.g. **Boomerang**), close the picker. Expected: a
  bar appears along the bottom of the viewer with play/pause, two frame buttons, a slider filling in red, the time in
  seconds and **frame / last frame**. Let it play to the end: it returns to the idle and the bar goes away.
- [ ] **3. Pause, step, drag:** pick the emote again, press the bar's pause, then press **.** five times and **,**
  twice; then drag the slider. Expected: each key moves exactly one frame (the counter changes by 1); the pose
  follows the drag live and settles when you let go. Press play: it plays to the end and **stays on the last
  frame** (paused); play again restarts it; **×** returns to the idle.
- [ ] **4. Share a frame:** pause an emote on a pose you like, press **Share outfit** (style "Link with preview
  image"). Expected: "Link copied · preview shows frame N", and the panel shows **Include this frame** with the
  emote, seconds and frame. Open the copied link in a private window: it lands on the same frame, paused, with the
  bar showing the same frame number. Open `http://127.0.0.1:8787/i/<id>.jpg` (the 12 characters after `/s/` in the
  link): the card shows that pose from four angles with the emote name and frame along the bottom.
- [ ] **5. Nothing else changed:** close the emote (×) so the idle plays, and share again. Expected: the card is the
  usual still pose with no caption, and the link has no `emote=`. Untick **Include this frame** while an emote is
  paused and copy: same, a still-pose card and plain link.
- [ ] **6. Saved outfits:** with a few saved outfits, open a posed link from step 4 in a normal window. Expected: it
  opens as **SHARED OUTFIT · NOT SAVED** (or selects your matching saved outfit) on the shared frame; your saved
  outfits in the menu are unchanged; change one piece and it saves as a new outfit.
- [ ] **7. Phone:** open the phone link, pick an emote and pause it. Expected: the bar fits the screen width, the
  buttons are easy to tap, the slider follows your thumb, and the frame buttons step one frame.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual
step numbers), or e.g. "3 fails: the slider jumps back while I drag".

## Recorded result

- Tested revision/build: none by the user. The waiver applies to commit `2a30baa` (local build `index-BZcEuSAM.js`).
- User reported at: 10 Nov 2026, 22:54 London, in the session: "Waive the checks" (verbatim).
- Passed / failed / untested step numbers: 1-7 untested by the user.
- Explicitly waived checks, if any: 1-7, by the user's instruction above. Unknowns the waiver accepts: a real phone
  and real touch drags, Safari and Firefox, a real Discord/X unfurl from the deployed Worker.
- Agent re-check after the waiver (same build, Playwright Chromium, 22:50 London), covering what the earlier agent run
  had not: step 3's end (an emote paused once, then played, stays on its last frame 3.667 / 3.667 s paused; play
  restarts it); step 5's untick (status "Link changed · copy again", then a plain link without `emote=` and the
  still-pose card, `shots/17`); step 6 (a posed link to another outfit opens as "Shared outfit · Not saved" on its
  frame; one edit saves it as "Shared outfit", the address is tidied to `#/`, "Outfit 1" is untouched; a reload shows
  the saved outfit and does not re-apply the old pose). All PASS. Steps 1, 2, 4 were covered by the earlier run
  (`README.md`); step 7 only by an emulated phone.
- Readiness: checks explicitly waived (not user-verified).
- Merge authorization: not yet given. The share Worker must be redeployed **before** this merges (see the PR).
