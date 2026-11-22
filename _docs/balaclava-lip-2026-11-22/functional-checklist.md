# Guided functional review — balaclava lip finding

## What you are checking

This PR changes no app behaviour. It documents why a sliver of upper lip shows through Balaclava Cotton Black when the
jaw opens: the game's own cloth proxy for that balaclava causes it (README.md). It also adds a cloth-mapping dump to the
offline extractor. The checks confirm, on a production build, that the documented behaviour is exactly what the site
does, and that the extractor change adds a file without touching the others.

- PR: see the branch `claude/chinals-balaclava-lip-2026-11-22` (originating issue: PR #71's checklist step 5)
- Test this revision: the branch head. Its app code is identical to main d31db11, and the build adds the Chinals host
  with faces, 7c9add72, from PR #71.
- Open: the production build that `node _docs/balaclava-lip-2026-11-22/prod-steps.mjs` makes and serves at
  http://127.0.0.1:4358/the-finals-outfit/#/chinals
- Prerequisites: none beyond the build. Steps 6 and 7 need the installed game's paks (read-only) and FModel's settings.
- Approximate hands-on time: 8 minutes
- Agent checks: PASS for steps 1-7 (Recorded result below; `prod-steps.json`, `cloth-data.json`).
- User checks: waived by the owner for all PRs (22 Nov). The agent ran them; agent results do not tick the boxes.

## Get it running

In PowerShell, in this worktree's root:

```powershell
node _docs/balaclava-lip-2026-11-22/prod-steps.mjs
```

This builds the site, then keeps nothing running when it finishes. To look by hand, serve the same build:

```powershell
npx vite preview --outDir scripts/generated/balaclava-lip/prod/dist --base /the-finals-outfit/ --port 4358 --strictPort --host 127.0.0.1
```

Stop it with Ctrl+C. Nothing here saves to the live site.

## Try it yourself

- [ ] **1. Start:** open the link (Chinals mode), pick Facial Hair → **Full Beard**, play **Unrivaled Master** and
  pause at 3.2 s. Expected: the beard opens with the jaw.
- [ ] **2. The known sliver:** pick Facewear → **Balaclava Cotton Black**, same frame. Expected: one small lip-coloured
  speck at the centre of the knit, just under the nose (the upper lip, about 1 mm). Nothing else shows through.
- [ ] **3. Face switch:** click **Facial animation** off, then on. Expected: off, the knit is closed; on, the speck is
  back.
- [ ] **4. Global, jaw open:** click **Global**, play **Carrot Crusher** and pause at 1.47 s. Expected: the head is in
  profile with the carrot at the mouth. The same sliver exists there (measured), mostly hidden by the carrot.
- [ ] **5. Global, pout:** play **Goblin Horn** and pause at 0.3 s. Expected: the knit stays closed.
- [ ] **6. Extractor, cloth mesh:** `AnimExport mesh` on the balaclava (README "Files"). Expected: `.mesh.json`,
  `.mesh.bin` and `.cloth.json` (one section, 1,081 mappings). `check-cloth-data.mjs` reproduces every render vertex
  to under 0.001 cm, with 0 triangles chosen differently.
- [ ] **7. Extractor, ordinary mesh:** `AnimExport mesh` on a mesh without cloth (the basic T-shirt). Expected: only
  `.mesh.json` and `.mesh.bin`.

If something fails, stop at that step and report its number and what happened.

## Recorded result

- Waiver: the owner, 22 Nov ~00:08 London, "for all sessions and subsession ... please waive manual checks, i trust u as
  u can do the same checks better than me". The boxes stay unticked; the agent ran steps 1-7 in their place.
- Tested build: production build (deploy.yml settings plus Chinals host 7c9add72) of the branch's app code (= main
  d31db11), run as a visitor (automation masked) by `prod-steps.mjs`, 22 Nov 2026 ~13:30-13:45 UTC. Judged by looking at
  full-size captures; the lip measurement is the head's upper-lip vertices against the balaclava, in mm.
- 1 PASS: the beard follows the open jaw; one head-wrapped part bound.
- 2 PASS: the speck shows at the knit's centre under the nose (`unrivaled-master-3.2s-face-on-off.jpg`, left): 9
  upper-lip vertices, at most 0.87 mm outside. The face mask is `BWA_FaceJoints_FaceMask`.
- 3 PASS: face off, the knit is closed (no vertex outside; the nearest is 1.78 mm inside). Face on again gives the same
  9 vertices at 0.87 mm.
- 4 PASS: 8 vertices at most 0.90 mm outside. In profile the carrot covers the mouth; the dev front view
  (`balaclava-pout.mjs`) shows a speck between the fingers.
- 5 PASS: none outside (0.74 mm inside); the knit is closed.
- 6 PASS: `.cloth.json` written. `cloth-data.json` records: reproduction worst 0.000216 cm; triangle choice 1,025 same,
  56 equal-distance ties, 0 different.
- 7 PASS: `.mesh.json` and `.mesh.bin` only.
- No failed request and no page error in the production run.
- Readiness: agent PASS under the waiver. Merge per the owner's merge-on-pass rule (CI green, CLEAN, up to date).

A later patch invalidates affected checks. Keep results for the previous revision and record the retest; do not
silently carry ticks to a new build.
