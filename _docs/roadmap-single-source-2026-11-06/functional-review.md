# Guided functional review — roadmap page from one ROADMAP.md

## What you are checking

The Roadmap page now renders `ROADMAP.md` (rewritten for 5–6 Nov), with live counts filled in. The build
refuses a malformed, hand-counted or stale roadmap, so the page can't silently go out of date again.

- PR / originating issue: none yet (not pushed). Your request: "our roadmap page is so outdated... we should have
  single source of truth (in repo)".
- Test this revision: branch `claude/stoic-ramanujan-5621c7`, commit `0842b45888fc989ee140e63a0312fe8977c78c3e`
  (based on `main` 11b4185 = the merged 5 Nov release, PR #19). It is `f9fba90` plus three 6 Nov edits:
  - your request to drop the two internal 3D-file items (`799a670`);
  - a text fix (`0b80862`). The catalog item no longer claims to be complete, because the 6 Nov release adds 76
    cosmetics the catalog had skipped and more are still being added. The red-items text no longer says "most" are
    material-type gaps, since no current count supports that.
  - the same-day gap you asked to close (`0842b45`). `ROADMAP.md` now records `Reviewed after patch note:`, the id of
    the newest patch note at the last review. The build refuses the file once a newer patch note exists, even one
    dated the same day.

  The later commit that updates this file changes no code.
- Open: http://localhost:5186/#/roadmap in a browser.
- Prerequisites: none beyond the worktree's own `node_modules` (installed). A gitignored
  `.env.development.local` in the worktree points the dev server at the production asset hosts from `deploy.yml`, so
  the counts match the live site. The main session's dev server on 5174 is untouched.
- Approximate hands-on time: 8 minutes, most of it reading the roadmap text (step 3).
- Agent checks (6 Nov 2026):
  - `tests/roadmap.test.ts`: 7/7 PASS, including a same-day second patch note and an unknown id.
  - `npm test`: 648 PASS, 8 FAIL, 1 skipped. All 8 failures need gitignored extracted assets that a fresh worktree
    doesn't have (`ENOENT`, ski-blade fixture and base-body GLBs); none touch the roadmap.
  - `tsc -b --noEmit`: PASS.
  - `npm run build`: PASS, with the existing chunk-size warning. `check:catalog-split`: PASS.
  - Negative builds:
    - A `Last reviewed: 2026-11-04` date fails, naming the 5 Nov "Seasons 11 and 12" patch note.
    - A hand-typed "209" fails, naming the line.
    - `Reviewed after patch note: 2026-11-04-new-look` fails (`npm run build`, after `0842b45`), naming the newer
      "Seasons 11 and 12" patch note and its id.
  - Against the 6 Nov release's patch notes (branch `claude/release-2026-11-06`, loaded read-only):
    - this `ROADMAP.md` fails, naming patch note "76 missing cosmetics" and its id;
    - it passes once `Reviewed after patch note:` is set to that id.
  - Dev page in the browser pane:
    - The placeholders fill from the deployed status data (238 red, 10 purple, 3,255 total, Season 12).
    - Editing `ROADMAP.md` updates the open page in place.
    - At 375 px there is no sideways scroll.
  - NOT RUN: a production deploy; `ROADMAP.md` as rendered on GitHub.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If http://localhost:5186 already answers, that is the review server left running; skip to step 1. Otherwise, in
**PowerShell**, from `E:\Coding\the-finals-outfit\.claude\worktrees\stoic-ramanujan-5621c7`:

```powershell
npx vite --port 5186 --strictPort
```

Stop it with Ctrl+C. The first page load can take about 30 seconds while Vite warms up.

## Try it yourself

- [ ] **1. Start:** open http://localhost:5186/#/roadmap. Press Esc if the welcome screen appears.
  Expected:
  - the "Progress & roadmap" heading, a goal paragraph, and "Roadmap reviewed 06 Nov 2026" under it;
  - the 3D preview progress panel showing 3,255 items;
  - five sections in order: Current focus, Next, Waiting on a decision, Later, Done;
  - only the first Current focus item expanded.
- [ ] **2. Live numbers:** compare the expanded "Rebuild the remaining red items" text with the panel's Red card, then
  open "Fix known issues" and Done → "The catalog".
  Expected:
  - the red count in the text equals the Red card (238 with today's deployed data);
  - the purple count equals the Purple card (10);
  - "3,255 cosmetics through Season 12", followed by a sentence saying some earlier-season cosmetics are still
    being added.
  - No `{…}` placeholder shows anywhere.
- [ ] **3. Content:** read every section, expanding the items. "Waiting on a decision" should have four items:
  default lighting, cloth physics, items that recolour another item, and animated noise. Nothing should mention 3D
  export, asset protection or hosting (removed 6 Nov at your request).
  Expected: nothing is wrong, overclaimed, internal or something you'd rather not publish. If anything is, name it;
  this step is judgement, not mechanics.
- [ ] **4. One source:** open `ROADMAP.md` in the worktree. Change line 77 from `### Default lighting` to
  `### Default lighting test` and save.
  Expected: within a few seconds, without reloading, the page's first "Waiting on a decision" item reads
  "Default lighting test". Undo the edit and save; the page reverts.
- [ ] **5. The build gate:** two edits, one at a time. Run each build in the same PowerShell directory (a second
  window if the dev server is running). A file that doesn't parse reports only its parse problems, so the second
  message appears only once the first edit is undone.

  a. On line 33 of `ROADMAP.md`, replace `{red}` with `209` and save, then run:

  ```powershell
  npm run build
  ```

  Expected:
  - the build fails with `line 33: hand-typed figure "209"; use a placeholder such as {red}...`;
  - the dev page shows Vite's red error overlay with the same message.

  Undo with:

  ```powershell
  git restore ROADMAP.md
  ```

  b. On line 23, change `Reviewed after patch note: 2026-11-05-seasons-11-12` to
  `Reviewed after patch note: 2026-11-04-new-look` (an older patch note) and save. Run `npm run build` again.
  Expected: the build fails with `ROADMAP.md was reviewed after patch note "2026-11-04-new-look", but a newer patch
  note "Seasons 11 and 12" ... has been added since, id "2026-11-05-seasons-11-12"`. Undo with `git restore ROADMAP.md`
  as above; the overlay clears.
- [ ] **6. Nearby ordinary use:** on the roadmap page, click "← Back to your outfit", then the header's "Roadmap" link,
  then "Patch notes" in the header.
  Expected:
  - the builder opens with its outfit;
  - Roadmap returns to this page;
  - the patch-notes panel opens;
  - the full patch-notes list still appears at the bottom of the roadmap page.

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass", or for example
"3 fails: drop the 3D file items".

## What changes for the release workflow

Adding a patch note (`src/data/changelog.ts`) or moving `CATALOG_UPDATE.updatedAt` now also means re-reading
`ROADMAP.md`. Then set `Reviewed after patch note:` to the newest patch note's `id`, and `Last reviewed:` to today.
Otherwise `npm run build`, and so the deploy, fails with a message that says exactly that. This is the staleness
guard, so a release will hit it deliberately.

- Patch notes are matched by `id`, so a second patch note on the day of the review still fails the build. Until
  `0842b45` the check compared days, and the 6 Nov release passed unread.
- Whichever of this branch and the 6 Nov release (`claude/release-2026-11-06`) merges second must set the line to
  `2026-11-06-missing-cosmetics`, after re-reading the roadmap.
- The catalog update has no id, so it is still matched by date. In practice it ships with a patch note, which the
  id does catch.

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not given (nothing pushed or merged)
