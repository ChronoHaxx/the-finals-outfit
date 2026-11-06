# Guided functional review: Season 12 Medium body types (stage 1)

## What you are checking

The outfit builder can show the three Season 12 Medium body types: masculine, feminine, and the new androgynous one.
The switch is a dev gate (`?bodyType=`); production still reads the index's own `bodyType` field (masculine).

Two servers show the same switch on different mesh data:
- **5191, live data.** The meshes the site ships today. Their body-type shapes are pre-Season 12, and consistent.
- **5192, Season 12 preview.** The S12 body, plus the garments proven to differ only in their morphs, where every
  item showing them is S12 throughout. It shows the fuller S12 feminine shape. It also shows why a partial swap is not
  shippable (step 6).

Details:
- Originating request: the Discord question "is your outfit builder able to change body type and class?". This is
  stage 1 (Medium body types) of `_docs/body-types-2026-11-06/README.md`.
- Test this revision: branch `claude/gracious-kepler-2ea9a7` at commit `aa6c2e6` (the code under test). The commits
  after it change only `_docs/`.
- Open: two local dev servers from this worktree, on ports 5191 and 5192. Neither is the main session's 5174.
- Prerequisites: none beyond this machine. Nothing is downloaded, and the game is not touched.
- Approximate hands-on time: 10 minutes.
- Agent checks: see **Agent results** below.
- User checks: **PENDING**. Agent results do not tick the boxes below.

## Get it running

Both servers were left running at the end of the agent session. If the links below do not load, start each server in
its own window.

**PowerShell**, in `E:\Coding\the-finals-outfit\.claude\worktrees\gracious-kepler-2ea9a7`:

```powershell
node scripts/body-types/serve-preview.mjs --port 5191
```

```powershell
node scripts/body-types/serve-preview.mjs --port 5192 --preview ../../../public/models/s12-bodytype-preview-v1 --index ../../../public/models/s12-bodytype-preview-v1/index-v5
```

- Each server prints a `Local: http://127.0.0.1:<port>/` line.
- The first page load takes about a minute while Vite builds.
- Stop a server with Ctrl+C in its window.
- Neither server writes to `public/`.

## Try it yourself

The outfits are Face 01 with dark jeans and tall sneakers, plus the upper body named in each step. Drag to orbit. To
change body type, edit `bodyType=` in the address bar and press Enter.

- [ ] **1. Start (zip hoodie, masculine, S12):**
  <http://127.0.0.1:5192/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJsb3dlckJvZHkiOiJjYXN1YWwtbG9vc2VqZWFucy1kZW5pbS1kYXJrYmx1ZSIsImZlZXQiOiJjYXN1YWwtdGFsbHNuZWFrZXJzLWNhbnZhcyIsInVwcGVyQm9keSI6ImNhc3VhbC1ob29kaWV6aXB1cC1jb3R0b24tYmxhY2sifX0&reconstructed=1&bodyType=masculine>
  - Expected: the character loads in the black zip hoodie, with no error banner.
- [ ] **2. Feminine (S12):** change to `bodyType=feminine`.
  - Orbit to the side.
  - Expected: a fuller chest and wider hips. The hoodie follows them, and no skin shows through at the chest, armpits
    or neck.
- [ ] **3. Androgynous (S12):** change to `bodyType=androgynous`.
  - Expected: a flat, straight torso. This is the unmorphed bind shape the item icons were captured on. Nothing pokes
    through.
- [ ] **4. Live vs S12:** open the step 2 link with port **5191** instead of 5192.
  - Expected: a smaller feminine chest than step 2. This is the pre-S12 shape the live meshes carry. Nothing pokes
    through.
  - Try masculine and androgynous on 5191 too; they should look like steps 1 and 3.
- [ ] **5. Pre-S12 tee over the S12 body (S12, feminine):**
  <http://127.0.0.1:5192/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJsb3dlckJvZHkiOiJjYXN1YWwtbG9vc2VqZWFucy1kZW5pbS1kYXJrYmx1ZSIsImZlZXQiOiJjYXN1YWwtdGFsbHNuZWFrZXJzLWNhbnZhcyIsInVwcGVyQm9keSI6ImNhc3VhbC1iYXNpY3RzaGlydC1jb3R0b24tYmxhY2sifX0&reconstructed=1&bodyType=feminine>
  - S12 reworked the basic tee's geometry, so the preview keeps the live tee.
  - Expected: the tee looks the same as on 5191, and the fuller S12 chest stays inside it.
- [ ] **6. Known preview limitation (S12, feminine, short dress):**
  <http://127.0.0.1:5192/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJsb3dlckJvZHkiOiJjYXN1YWwtbG9vc2VqZWFucy1kZW5pbS1kYXJrYmx1ZSIsImZlZXQiOiJjYXN1YWwtdGFsbHNuZWFrZXJzLWNhbnZhcyIsInVwcGVyQm9keSI6ImNhc3VhbC1zaG9ydGRyZXNzLWNvdHRvbiJ9fQ&reconstructed=1&bodyType=feminine>
  - Orbit to the back and zoom to the waist.
  - Expected (the agent's finding): a thin light line and a dark fleck just under the dress hem, and the jeans' light
    inner waistband above the belt. The same view on 5191 is clean.
  - Report whether you see the same. This step confirms the finding; it is not a pass/fail of stage 1.
- [ ] **7. Ordinary use (live, feminine):** on 5191 with `bodyType=feminine`, change Lower Body and Feet to any other
  items in the panel.
  - Expected: they load and follow the feminine body.
  - The body type stays feminine after each change; it does not snap back to masculine.
- [ ] **8. In-game look (decision #20, optional):** in your own game client, compare a Medium masculine, feminine and
  androgynous character in the customization screen with steps 1-4.
  - Note which of 5191 or 5192 the feminine chest matches.

If something fails, stop at that step and report its number and what happened. For example, reply "1-7 pass, 6 seen"
or "2 fails: the chest pokes through the hoodie".

## Agent results

Agent PASS for stage 1 on live data. The S12 preview works as a preview, but is not shippable piecemeal.

**Tests.**
- `node --import tsx --test tests/rig/body-type-preview.test.ts`: 14 / 14 pass (re-run 6 Nov after the commit).
- In the full suite, 8 tests fail before and after this branch. They need meshes that are absent from this checkout.

**Captures** (`scripts/body-types/capture-review.mjs`, headless Edge, 1500×1100):
- 7 outfits × 3 body types × 3 cameras (torso front, torso side, full).
- Outfits: tee, zip hoodie, bomber, padded shirt, rolled sleeves, short dress, tech crop top.
- `review-v1`: 126 shots, live plus S12 on index-v2. `review-v2`: S12 recaptured on index-v5.
- 189 shots in all, with 0 console errors.
- Every source mesh carries exactly its body type's Medium morph (none for androgynous).
- Sheets: `review-v1-sheets/`, `review-v2-sheets/` (local, not committed).

**Live data (5191).** Clean in all three body types and all 7 outfits. No skin pokes through, and the three shapes
read as intended.

**S12 preview (5192).**
- Fuller feminine chest on the fully S12 items (hoodie, bomber, padded shirt).
- Defect found in review-v1 and fixed: on index-v2, the S12 undershirt bulged through the pre-S12 short-dress shell.
  The fix is the item rule in `build-preview-index.py`; on index-v5 the dress is clean.
- Remaining: the step 6 edge artifacts on S12 feminine only. Their cause is the S12 body against garments the preview
  holds pre-S12 (jeans, dress).

**Step 7 re-check (6 Nov, after the user's report, at their request).** The captures above load each outfit by link,
so they never exercised the panel. This re-check did, headless at 1500×1100 on 5191: Lower Body to Active Shorts,
then Feet to Toboggan Boots, through the panel's own search and tiles.
- Body types: feminine, then masculine.
- After each change, every source mesh kept the requested morph (`medium_female` / `medium_male`). The 12 → 13 → 15
  meshes include the shorts' tights. There were 0 console errors, and `bodyType` stayed in the address.
- Full-size legs render: clean. The fitted tights, the boots' sock tops and the hips follow the body.
- Observation outside this change: the yellow Active Shorts show a thin light line along the hem. It is the same on
  masculine, so it belongs to that item's edge, not to the body type.

**Conclusion.** Season 12 shapes need one whole-catalogue refresh: the body and every garment together. Morph-only
meshes can be swapped; reworked ones go through the S12 item refresh route. That refresh changes the active index,
which the main session owns, so it needs coordinating with them.

## Recorded result

- Tested revision/build: `claude/gracious-kepler-2ea9a7` at aa6c2e6 (code), docs ad2efac. Servers 5191 (live) and
  5192 (index-v5), restarted 6 Nov 12:21.
- User reported at: 6 Nov 2026, about 13:00 London. Their words: "All steps pass".
- The user added that they may be an unreliable narrator and asked the agent to double-check. The agent re-checked
  step 7, the one step its captures had not covered (see Agent results); it passed.
- Step 8 (in-game) can only be checked in the user's own client. The agent cannot verify it.
- Passed / failed / untested step numbers: 1-8 passed as reported by the user. No failures.
- Readiness: user checks passed; stage 1 is ready for review as a dev-gated change. The S12 shapes are not part of it
  (whole-catalogue refresh, separate task).
- Merge authorization: not given.
