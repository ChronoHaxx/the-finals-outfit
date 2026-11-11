# Guided functional review: roadmap ids and the public-text check

## What you are checking

ROADMAP.md items now carry hidden ids, and the build refuses roadmap or patch-note text that leaks
internal detail. This review checks three things: the Roadmap page looks exactly as before, the ids
stay invisible, and a leak or a missing id stops the build with a clear message.

- PR: see the PR that adds this file (branch `claude/roadmap-ids-leak-lint-2026-11-10`).
- Test this revision: the branch head. The code is commit `09e3afe06208da1e9a621d87ae39eb06f908c650`;
  the commit after it only adds this checklist.
- Open: PowerShell in `E:\Coding\the-finals-outfit\.claude\worktrees\heuristic-darwin-d076c9`. That
  worktree has its own `node_modules`; the main checkout is on another branch with older packages.
- Prerequisites: none. No secrets are needed: the private denylist is unset locally.
- Approximate hands-on time: 10 minutes.
- Agent checks (10 Nov 2026):
  - PASS: `tests/roadmap.test.ts` 11/11, `npm run typecheck`, `npm run build`.
  - PASS: a build with a test denylist failed on the right line without printing the term.
  - Full `npm test`: 747 pass, 8 fail. The 8 need extracted game files missing from this worktree
    (`SK_Body_M.glb`, a ski-blade fixture); none touches the roadmap.
  - The agent did not open the Roadmap page in a browser for this PR.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, from `E:\Coding\the-finals-outfit\.claude\worktrees\heuristic-darwin-d076c9`:

```powershell
npm run dev
```

Open http://localhost:5173/#/roadmap (use the port Vite prints if it differs). Stop with Ctrl+C. Steps
2 and 3 edit ROADMAP.md on purpose; step 3 ends by putting it back.

## Try it yourself

- [ ] **1. Start:** open the Roadmap page from the link above. Expected: the page shows "Progress &
  roadmap" with the sections Current focus, Next, Waiting on a decision, Later and Done. Their items
  match the live site, and no "id:" text or comment markers appear anywhere on the page.
- [ ] **2. A leak stops the build:** in ROADMAP.md, add the sentence `Fixed in 0842b45.` to the end of the
  first paragraph under "Rebuild the remaining red items" (after "until their 3D is built.") and save.
  Expected: Vite's error overlay says ROADMAP.md is not valid, with
  `line 40: public text looks like a commit hash ("0842b45")`.
- [ ] **3. A missing id stops the build, and undo recovers:** remove that sentence again. Then delete the
  `<!-- id: red-items -->` line under the same title and save. Expected: the overlay says
  `item "Rebuild the remaining red items" needs an "<!-- id: ... -->" line directly under its title`.
  Put the line back, or run
  `git restore ROADMAP.md` if you made no other edits; the page loads normally again.
- [ ] **4. Patch notes:** scroll to the patch notes at the bottom of the Roadmap page. Expected: the
  newest is "54 more in 3D", with the same notes as on the live site.
- [ ] **5. GitHub view:** on GitHub, open ROADMAP.md on this PR's branch (Files changed → the file's
  "View file"). Expected: the rendered page shows the item titles and text, with no visible id lines.

If something fails, stop at that step and report its number and what happened. Reply "1-5 pass", or
for example "2 fails: no overlay appears".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given

A later patch invalidates affected checks. Keep results for the previous revision and record the
retest; do not silently carry ticks to a new build.

## Owner follow-ups outside this PR (not merge checks)

- Add a repository secret `PUBLIC_TEXT_DENYLIST` with the private terms, one per line, so the Pages
  build enforces them. Until then they are checked only when the internal board builds.
- The local internal board reads this branch through its `.outfit-path` until this is merged.
