# Guided functional review — roadmap page from one ROADMAP.md

## What you are checking

The Roadmap page now renders `ROADMAP.md` (rewritten for 5–6 Nov), with live counts filled in. The build
refuses a malformed, hand-counted or stale roadmap, so the page can't silently go out of date again.

- PR / originating issue: none yet (not pushed). Your request: "our roadmap page is so outdated... we should have
  single source of truth (in repo)".
- Test this revision: branch `claude/stoic-ramanujan-5621c7`, commit `f9fba90cceb94ea4b658fa5610b1c05c1c385ed9`
  (based on `main` 11b4185 = the merged 5 Nov release, PR #19). The later commit that adds this file changes no code.
- Open: http://localhost:5186/#/roadmap in a browser.
- Prerequisites: none beyond the worktree's own `node_modules` (installed). A gitignored
  `.env.development.local` in the worktree points the dev server at the production asset hosts from `deploy.yml`, so
  the counts match the live site. The main session's dev server on 5174 is untouched.
- Approximate hands-on time: 8 minutes, most of it reading the roadmap text (step 3).
- Agent checks (6 Nov 2026):
  - `tests/roadmap.test.ts`: 6/6 PASS.
  - `npm test`: 648 PASS, 8 FAIL, 1 skipped. All 8 failures need gitignored extracted assets that a fresh worktree
    doesn't have (`ENOENT`, ski-blade fixture); none touch the roadmap.
  - `tsc -b --noEmit`: PASS.
  - `npm run build`: PASS, with the existing chunk-size warning. `check:catalog-split`: PASS.
  - Negative builds:
    - A `Last reviewed: 2026-11-04` date fails, naming the 5 Nov "Seasons 11 and 12" patch note.
    - A hand-typed "209" fails, naming line 30.
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
  open "Fix known issues" and Done → "The whole catalog".
  Expected:
  - the red count in the text equals the Red card (238 with today's deployed data);
  - the purple count equals the Purple card (10);
  - "All 3,255 cosmetics through Season 12".
  - No `{…}` placeholder shows anywhere.
- [ ] **3. Content:** read every section, expanding the items. Look hardest at the two items under "Waiting on a
  decision" that are about the 3D files: "Downloading your outfit as a 3D file" and "Protecting the 3D files". They
  go public with this page.
  Expected: nothing is wrong, overclaimed or something you'd rather not publish. If anything is, name it; this step
  is judgement, not mechanics.
- [ ] **4. One source:** open `ROADMAP.md` in the worktree. Change line 74 from `### Default lighting` to
  `### Default lighting test` and save.
  Expected: within a few seconds, without reloading, the page's first "Waiting on a decision" item reads
  "Default lighting test". Undo the edit and save; the page reverts.
- [ ] **5. The build gate:** on line 30 of `ROADMAP.md`, replace `{red}` with `209` and save. In the same PowerShell
  directory (a second window if the dev server is running), run:

  ```powershell
  npm run build
  ```

  Expected:
  - the build fails with `line 30: hand-typed figure "209"; use a placeholder such as {red}...`;
  - the dev page shows Vite's red error overlay with the same message.

  Undo with:

  ```powershell
  git restore ROADMAP.md
  ```

  The overlay clears.
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
`ROADMAP.md` and moving its `Last reviewed` date. Otherwise `npm run build`, and so the deploy, fails with a message
that says exactly that. This is the staleness guard, so a release will hit it deliberately.

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not given (nothing pushed or merged)
