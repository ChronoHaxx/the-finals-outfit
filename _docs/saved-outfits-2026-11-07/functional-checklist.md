# Guided functional review — saved outfits (outfit slots)

## What you are checking

The builder now keeps several named outfits in your browser and saves every change as you go. This catches losing an
outfit: on a reload, a closed tab, an opened share link, Randomise or Reset, or a delete.

- PR / originating issue: the PR for branch `claude/outfit-slots-2026-11-07`. You asked on 7 Nov 2026 for an
  "outfit slot".
- Test this revision: branch `claude/outfit-slots-2026-11-07`, the commit shown in the PR header (base `25c0837`)
- Open: this PC: <http://localhost:5192/the-finals-outfit/>; phone on the same Wi-Fi:
  <http://192.168.1.131:5192/the-finals-outfit/>. If the phone can't connect, Windows Firewall is blocking Node on
  private networks: allow it, or test on this PC only.
- Prerequisites: the preview server below (a production build of this branch, with artwork from the live asset
  hosts). Nothing to download, and no account.
- Approximate hands-on time: 10 minutes
- Agent checks: see "Agent evidence" below.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If the preview server from this session is still running, skip to step 1. Otherwise, in **PowerShell**, working
directory `E:\Coding\the-finals-outfit\.claude\worktrees\zealous-chatelet-50d6bf` (the `dist` folder is already
built):

```powershell
npx vite preview --port 5192 --strictPort --base /the-finals-outfit/
```

Stop it with Ctrl+C. Saved outfits live in that browser, for that address only: the localhost address, the phone
address and the live site each keep their own outfits. Nothing reaches the live site.

## Try it yourself

- [ ] **1. Start:** open the link, close the welcome screen. Expected: the outfit panel's title reads **OUTFIT 1 ▾**
  with **SAVED** beside it, and the character wears the usual starting look.
- [ ] **2. Saves as you go:** put on any hair, then close the tab straight away (within a second) and open the link
  again. Expected: the hair is still on and the title still reads **OUTFIT 1**.
- [ ] **3. Randomise keeps your outfit:** press **Randomise**. Expected: the title becomes **RANDOM 1** and a message
  says "“Outfit 1” is kept" with **Undo**. Press **Randomise** again: still **RANDOM 1** (the roll is replaced, no
  pile-up). Press **Undo**: back to the previous roll. Open the title's menu: **Outfit 1** is still listed with your
  hair.
- [ ] **4. Rename, duplicate, delete:** in that menu, use the pencil to rename **Outfit 1** to something of yours
  (Enter to save), the copy icon to duplicate it, then the bin icon on the copy. Expected: the new name sticks; the
  copy appears and becomes the current outfit; deleting it shows "Deleted …" with **Undo**, and **Undo** brings it
  back.
- [ ] **5. A shared link doesn't overwrite:** press **Share outfit** and copy the link, press **Randomise**, then
  paste the copied link into the address bar and open it. Expected: the title shows **SHARED OUTFIT** with **NOT
  SAVED** beside it, and your outfits in the menu are unchanged. Change one piece: it becomes a saved **Shared
  outfit** in the menu.
- [ ] **6. Phone:** on the phone link, repeat steps 1 and 3, then open the title's menu. Expected: the menu fits
  the screen width, the rename/duplicate/delete buttons are easy to hit, and the Undo message sits at the bottom
  of the screen without covering the **Randomise** button.
- [ ] **7. Private window (optional):** open the link in a private/incognito window. Expected: the app works and
  saving still happens for that window (it is forgotten when the window closes; the menu explains this). If your
  browser blocks site data there, the title shows **SAVING OFF** instead and everything else still works.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual
step numbers), or e.g. "3 fails: Randomise changed Outfit 1".

## Agent evidence

All on this branch, 7 Nov 2026. These are agent checks; they do not tick the boxes above.

- `npx tsc -b --noEmit`: PASS.
- `npm test`: 726 pass, 8 fail, 5 skipped. The 8 failures need extracted model files that are not in this worktree
  (`ENOENT … public/models/body/SK_Body_M.glb`, "the extracted ski-blade fixture is required"). They don't depend on
  this change.
- New unit tests (29, all PASS): `tests/outfit-library.test.ts` covers the storage core. A tab killed with a write
  still pending is replayed from the journal. Saving twice, and an edit made during an in-flight write, both land
  without a fork. In two tabs, a divergent edit becomes a copy and an idle tab follows. Fields this version doesn't
  know survive. A record from a newer schema is never overwritten. A delete never beats another tab's edit. The cap
  refuses rather than evicts. A quota error keeps the change and retries. Storage wiped under an open tab is written
  back. With no storage the library runs in memory, and a hanging IndexedDB open falls back to localStorage.
  `tests/saved-outfits.test.ts` runs against the shipped catalogue: reload, share-link draft and promotion
  (StrictMode double call included), Randomise/Reset next to hand-made work, a catalogue change under a saved outfit
  (missing pieces kept and named), a historical slot correction, the render-time face fallback, delete/undo, the
  cap, storage off, and an unreadable link.
- Real browser (`check-saved-outfits.mjs` in this folder, headless Chrome, 1440×900 and a 375×812 touch phone):
  27/27 PASS on the dev server and on the production build served under `/the-finals-outfit/`. Log:
  `agent-browser-check.txt`. It includes a renderer crash right after an edit, two tabs, and every storage API
  throwing `SecurityError`.
- Visual check: desktop and phone screenshots looked at full size (panel, toast, missing-pieces notice, saving off).
  They show game artwork, so they are not committed.

Not covered by the agent: a real iPhone/Android, Safari and Firefox (only Chrome was driven), a real private window,
and a real full disk.

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
