# Guided functional review: player number 0–99

## What you are checking

You can now pick a player number from 0 to 99. A one-digit number prints centred on every piece that prints a number,
in that piece's own lettering, and stays with the outfit through a reload and a link. This catches a one-digit number
that prints off-centre, smeared or not at all, and a number that is lost or changes the wrong piece.

- PR / originating issue: this branch's PR (Shocka item 6, `_docs/feedback-shocka-2026-11/README.md`). Investigation:
  `README.md` beside this file.
- Test this revision: branch `claude/player-number-off-single-2026-11-22`, app code at `8962e71` (later commits on
  the branch are docs and this check's script).
- Open: the production build that `node _docs/player-number-2026-11-22/prod-steps.mjs` makes, served at
  http://127.0.0.1:4361/the-finals-outfit/ (deploy.yml's hosts; models from the live asset hosts).
- Prerequisites: none beyond the worktree's `node_modules` and Chrome.
- Approximate hands-on time: 6 minutes.
- Agent checks: see Recorded result. All pass:
  - typecheck;
  - `npm test` (1091 pass, 0 fail, 2 skipped);
  - the census (294 of 294, behaviour checked);
  - live identity (294 of 294 served programs byte-identical);
  - the assembly trace (294 programs, 339 sites).
- User checks: waived by the owner for all PRs (22 Nov). The agent ran them; agent results do not tick the boxes.

## Get it running

In PowerShell, in this worktree's root:

```powershell
node _docs/player-number-2026-11-22/prod-steps.mjs
```

It builds, serves, runs the steps below as a visitor in headless Chrome, and writes full-size screenshots to
`scripts/generated/player-number/prod/shots`. `--skip-build` reuses the last build. To try it by hand, run
`npx vite preview --base /the-finals-outfit/ --outDir scripts/generated/player-number/prod/dist --port 4361` from
PowerShell, not Git Bash, which rewrites the base path.

## Try it yourself

- [ ] **1. Start:** open `http://127.0.0.1:4361/the-finals-outfit/#/?o=2.36o.81qz.a1bl.cct&view=0.62_1.45_-0.42_0.2_1.36_0`
      and press Esc. Expected: the Fnatic Jersey and Hedge Hunter Cargos, framed on the left sleeve showing **32**. The
      Number row shows **Own** highlighted, the box's placeholder reads **0–99**, and the hint says "On 2 pieces · each
      shows its own".
- [ ] **2. One digit:** type `7` in the box and press Enter. Expected: the sleeve shows a single white **7**, centred
      where 32 was, in the same font. Nothing is smeared beside it. Type `0`: a centred **0**.
- [ ] **3. Two digits still work:** type `10`, then `99`. Expected: **10** and **99** fill the sleeve print as 32 did.
- [ ] **4. Other pieces follow:** open `#/?o=2.36o.a1bl.cct&view=0.42_0.98_-0.62_0.13_0.96_-0.1` (cargos without
      the jersey) and type `7`. Expected: the yellow stencil on the back of the left hip changes from **14** to a single
      centred **7**. Then open `#/?o=2.36o.81z3.a1bl.cct&view=0_1.25_-1.7_0_1.2_0` (Baseball Jersey). Expected: the back
      shows **8** under Own (this piece never followed the number before), **42** at 42, and a centred **7** at 7.
- [ ] **5. Keep it:** in the first outfit, type `07` and press Enter: the box shows **7**. Reload. Expected: still 7.
      Click **Share outfit**, choose Short link: the link contains `&pn=7`, and opening it shows 7.
- [ ] **6. Back to Own:** click **Own**. Expected: the box empties, the hint says "each shows its own", and the sleeve
      shows **32** again.

If something fails, stop at that step and report its number and what happened.

## Recorded result

- Tested revision/build: app code `8962e71`, production build with deploy.yml hosts.
- Waiver: the owner, 22 Nov ~00:08 London: "for all sessions and subsession ... please waive manual checks, i trust u as
  u can do the same checks better than me". The boxes stay unticked; the agent ran steps 1–6 in their place.
- Method: `prod-steps.mjs`, run as a visitor (automation masked), each scenario in a fresh browser context. Captures
  were taken in the still pose and judged by looking at them at full size.
- Agent results, 22 Nov 2026 (evening, London):
  - 1 PASS: sleeve 32; row "Own · On 2 pieces · each shows its own"; placeholder "0–99".
  - 2 PASS: a single centred white 7, and a centred 0, in the jersey's font, with no edge smear.
  - 3 PASS: 10 and 99 as before.
  - 4 PASS: cargos 14 → centred 7, 10, 99 in yellow stencil. Baseball Jersey back: 8 (Own) → 42 → centred 7. Its
    outfit's hint counts 3 pieces: the jersey, its large wristband (authored 96, a separate numbered material) and the
    cargos.
  - 5 PASS: `07` shows as 7; a reload keeps 7; the short link carries `pn=7` and opens at 7.
  - 6 PASS: Own clears the box and brings back 32.
  - Console: one expected error. The share panel's preview upload from 127.0.0.1 is refused by the live Worker's
    origin check (CORS) before anything is stored, and the panel falls back to the short link.
  - NOT RUN: Safari, Firefox and phones; a preview-card upload from the published site (needs the Worker deploy).
- Readiness: agent PASS under the standing waiver.
