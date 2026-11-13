# Guided functional review: S12 item refresh, tier-1 pilot (9 garments)

## What you are checking

The pilot swaps 9 garments to their Season 12 files. You are checking three things: they look right on the
production body types (Masculine and Androgynous); they don't clip against the pre-S12 items they are worn with; and
the USA biker vest no longer shows its tee through the vest.

- PR: the tier-1 PR on branch `claude/s12-refresh-tier1-2026-11-12` (contains PR #38's tools).
- Test this revision: branch `claude/s12-refresh-tier1-2026-11-12`, at the commit named in the PR description. The
  data under test is the garments-only index `public/models/s12-refresh-tier1-v1/index-pilot-v2-garments` (assets
  `431627fc…`), built on the active index `7678e698…`.
- Open: two local dev servers from this worktree. **5231** is live data and **5232** the pilot. Neither is the main
  session's 5174.
- Prerequisites: none beyond this machine. Nothing is downloaded, and the game is not touched.
- Approximate hands-on time: 10-15 minutes.
- Agent checks: PASS, no new defect in 320 shots (`README.md`, "Review").
- User checks: **PENDING**. Agent results do not tick the boxes below.

## Get it running

The agent left both servers running. If a link does not load, start that server in its own window.

**PowerShell**, in `E:\Coding\the-finals-outfit\.claude\worktrees\loving-napier-b93181`:

```powershell
$env:VITE_ANIMATIONS_BASE = "https://e5250f94.the-finals-outfit-assets.pages.dev/"; node scripts/body-types/serve-preview.mjs --port 5231
```

```powershell
$env:VITE_ANIMATIONS_BASE = "https://e5250f94.the-finals-outfit-assets.pages.dev/"; node scripts/body-types/serve-preview.mjs --port 5232 --preview ../../../public/models/s12-bodytype-refresh-v1 --index ../../../public/models/s12-refresh-tier1-v1/index-pilot-v2-garments --live-body
```

- Each server prints a `Local: http://127.0.0.1:<port>/` line. The first load takes about a minute.
- Stop a server with Ctrl+C. Neither server writes to `public/`.

Every outfit uses Face 01 and the tall canvas sneakers. Drag to orbit, and scroll to zoom. To compare with live data,
change the port from **5232** to **5231** and keep the rest of the address. To change body type, edit `bodyType=` in
the address bar.

## Try it yourself

- [ ] **1. Start (T-shirt + loose jeans, Masculine):**
  <http://127.0.0.1:5232/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJ1cHBlckJvZHkiOiJjYXN1YWwtdHNoaXJ0LWNvdHRvbi1ibGFjayIsImxvd2VyQm9keSI6ImNhc3VhbC1sb29zZWplYW5zLWRlbmltLWRhcmtibHVlIiwiZmVldCI6ImNhc3VhbC10YWxsc25lYWtlcnMtY2FudmFzIn19&reconstructed=1&bodyType=masculine>
  - Expected: the character loads in the black tee and jeans and plays the idle, with no error banner.
  - Then switch to port 5231. Expected: it looks the same. The tee's S12 file differs only in how its bone list is
    stored.
- [ ] **2. The fixed defect (USA biker vest, Androgynous):**
  <http://127.0.0.1:5232/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJ1cHBlckJvZHkiOiJjYXN1YWwtYmlrZXJ2ZXN0LWxlYXRoZXItdXNhIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMifX0&reconstructed=1&bodyType=androgynous>
  - Expected: both vest panels are whole over the eagle-print tee.
  - Then switch to 5231. Expected: the tee's print pokes through the vest's left panel. That is the live defect.
- [ ] **3. S12 pants under a pre-S12 tee (sniper pants + basic tee, Masculine):**
  <http://127.0.0.1:5232/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoibWlsaXRhcnktc25pcGVycGFudHMtd2luZGJyZWFrZXIteWVsbG93b3NwdXplIiwiZmVldCI6ImNhc3VhbC10YWxsc25lYWtlcnMtY2FudmFzIn19&reconstructed=1&bodyType=masculine>
  - Orbit all the way round, then zoom on the tee's hem.
  - Expected: the pants' waistband stays under the hem at the front, sides and back. The pants fold slightly
    differently from 5231 (their S12 Masculine shape moved up to 1.4 cm), with no clipping.
- [ ] **4. Weights in motion (single-sleeve top + tech gloves, Masculine):**
  <http://127.0.0.1:5232/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJ1cHBlckJvZHkiOiJzdHJlZXR3ZWFyLXNpbmdsZXNsZWV2ZXRvcC1ueWxvbi1ibGFjayIsImhhbmRzIjoic3RyZWV0d2Vhci10ZWNoZ2xvdmVzLW55bG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMifX0&reconstructed=1&bodyType=masculine>
  - Open the emote picker and play **Flex**, then **Wave**.
  - Expected: the sleeve, shoulder and armhole bend smoothly with no spikes, holes or stretched triangles. The glove
    cuff stays under the sleeve.
- [ ] **5. Varsity jacket in Androgynous, then Masculine:**
  <http://127.0.0.1:5232/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJ1cHBlckJvZHkiOiJzdHJlZXR3ZWFyLXZhcnNpdHlqYWNrZXQtamVyc2V5IiwiaGFuZHMiOiJzdHJlZXR3ZWFyLXRlY2hnbG92ZXMtbnlsb24tYmxhY2siLCJsb3dlckJvZHkiOiJjYXN1YWwtbG9vc2VqZWFucy1kZW5pbS1kYXJrYmx1ZSIsImZlZXQiOiJjYXN1YWwtdGFsbHNuZWFrZXJzLWNhbnZhcyJ9fQ&reconstructed=1&bodyType=androgynous>
  - Expected in Androgynous: the same as 5231.
  - Change `bodyType=` to `masculine`. Expected: the jacket sits slightly slimmer than on 5231 at the hem and sleeves,
    with no clipping at the jeans or the gloves.
- [ ] **6. Ordinary use:** in the step 5 page, use the items panel to change the lower body to any other pants, then
  add "Hip Bag Canvas Vaiya" (upper back).
  - Expected: each change loads without an error banner.
  - Expected: the bag looks normal from the back, with no dark or inside-out patches (its shading was re-baked in S12).

If something fails, stop at that step and report its number and what happened. Reply "1-6 pass", or for example
"3 fails: the waistband pokes through at the back".

## Recorded result

- Tested revision/build: pending.
- User reported at: pending.
- Passed / failed / untested step numbers: pending.
- Explicitly waived checks, if any: none.
- Readiness: pending.
- Merge authorization: not given. A merge is the main session's `HANDOFF.md` recipe, run while the index is idle.
