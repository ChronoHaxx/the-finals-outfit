# Guided functional review — player number (PR #60)

## What you are checking

You can set a two-digit player number that replaces the printed number on garments that carry one, and it stays with
the outfit through a reload and a link. This catches a number that does not change, changes the wrong thing, or gets
lost.

- PR: https://github.com/ChronoHaxx/the-finals-outfit/pull/60 (Shocka item 6)
- Test this revision: branch `claude/contestant-number-2026-11-21`, code at `ddf0dab8dee801164dff2dbff754393a7009ca2f`
  (later commits on the branch are docs only)
- Open: the dev server in worktree `E:\Coding\the-finals-outfit\.claude\worktrees\infallible-morse-05b63a`
- Prerequisites: none beyond the worktree (its `node_modules`, `public/items` and `public/models` are links to existing
  copies; nothing is written to them)
- Approximate hands-on time: 5 minutes
- Agent checks (21 Nov 2026):
  - PASS: typecheck and production build; `npm test` 925 pass, 0 fail, 1 skipped.
  - PASS: census, 237 of 237 matched programs agree with their authored number.
  - PASS, by looking at full-size captures in Chrome on an RTX 3080: the jersey sleeve went 32 → 45 → 10 → 99 → 32;
    the cargo-pants waist went 14 → 45 → 10 → 99 → 14 in the pants' own font. 23 held after a reload, and a `pn=77`
    link opened at 77.
  - NOT RUN: Safari, Firefox and phones; the share card upload, which needs the Worker deploy.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\infallible-morse-05b63a`:

```powershell
node node_modules/vite/bin/vite.js --port 5243 --strictPort --host 127.0.0.1
```

Wait for `Local: http://127.0.0.1:5243/`. The first page load takes about a minute. Stop it with Ctrl+C.

**Before anyone removes this worktree,** delete its three links first (PowerShell, removes only the links):

```powershell
foreach ($l in 'node_modules','public\items','public\models') { (Get-Item "E:\Coding\the-finals-outfit\.claude\worktrees\infallible-morse-05b63a\$l" -Force).Delete() }
```

Then confirm they are gone before running `git worktree remove`.

## Try it yourself

- [ ] **1. Start:** open `http://localhost:5243/?reconstructed=1#/?o=2.36o.81qz.a1bl.cct` and press Esc on the intro.
      Expected: the Fnatic Jersey and Hedge Hunter Cargos. Below Body type there is a **Number** row with **Own**
      highlighted and the hint "On 2 pieces · each shows its own". Turning to the character's left sleeve shows **32**.
- [ ] **2. Set a number:** click the box next to Own, type `45`. Expected: the sleeve shows **45** within a second, in
      the same white jersey font; behind, at the waistband under the shirt hem, the cargos show **45** in yellow stencil.
      Own is no longer highlighted.
- [ ] **3. What it refuses:** type `7` and click elsewhere. Expected: the box goes back to 45 and nothing changes on the
      model. Then clear the box and click elsewhere. Expected: Own is highlighted again, sleeve **32**, waist **14**.
- [ ] **4. Reload:** type `23`, then press F5. Expected: after loading, the box still says **23** and the sleeve shows 23.
- [ ] **5. Share:** click **Share outfit** and open the copied link in a new tab. Expected: the link contains `&pn=23`,
      and the new tab shows 23. (Until the share Worker is deployed, the panel may say a plain link was copied.)
- [ ] **6. Nearby use:** press **Randomise**. Expected: the number box keeps 23. If no piece in the new outfit prints a
      number, the hint says "Nothing equipped prints a number".

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass", or for example
"2 fails: the sleeve stays 32".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending user checks
- Merge authorization: not yet given
