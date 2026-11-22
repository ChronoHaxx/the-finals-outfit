# Guided functional review — balaclava lip finding

## What you are checking

This PR changes no app behaviour. It documents why a sliver of upper lip can show through Balaclava Cotton Black when
the jaw opens: the game's own cloth proxy for that balaclava causes it (README.md). Main hides the sliver with PR #71's
FaceContact. The PR also adds a cloth-mapping dump to the offline extractor. The checks confirm that main with this
branch behaves as the README says, and that the extractor change adds a file without touching the others.

- PR: https://github.com/ChronoHaxx/the-finals-outfit/pull/75 (originating issue: PR #71's checklist step 5)
- Test this revision: branch `claude/chinals-balaclava-lip-2026-11-22` with main abfa045 merged in. Its app code
  equals main abfa045, and deploy.yml names the Chinals host 7c9add72.
- Open: the production build that `node _docs/balaclava-lip-2026-11-22/prod-steps.mjs` makes, served at
  http://127.0.0.1:4358/the-finals-outfit/#/chinals
- Prerequisites: none beyond the build. Steps 6 and 7 need the installed game's paks (read-only) and FModel's settings.
- Approximate hands-on time: 8 minutes
- Agent checks: PASS for steps 1-7 on this revision (Recorded result below; `prod-steps.json`, `cloth-data.json`).
- User checks: waived by the owner for all PRs (22 Nov). The agent ran them; agent results do not tick the boxes.

## Get it running

In PowerShell, in this worktree's root:

```powershell
node _docs/balaclava-lip-2026-11-22/prod-steps.mjs
```

It builds the site and drives it; nothing is left running. To look by hand, serve the same build:

```powershell
npx vite preview --outDir scripts/generated/balaclava-lip/prod/dist --base /the-finals-outfit/ --port 4358 --strictPort --host 127.0.0.1
```

Stop it with Ctrl+C. Nothing here saves to the live site.

## Try it yourself

- [ ] **1. Start:** open the link (Chinals mode), pick Facial Hair → **Full Beard**, play **Unrivaled Master** and
  pause at 3.2 s. Expected: the beard opens with the jaw.
- [ ] **2. Balaclava at the peak:** pick Facewear → **Balaclava Cotton Black**, same frame. Expected: the knit is closed
  over the mouth; no lip shows. FaceContact holds it out. Without FaceContact, at main d31db11, a 1 mm upper-lip speck
  showed here.
- [ ] **3. Face switch:** click **Facial animation** off, then on. Expected: closed both times.
- [ ] **4. Global, jaw open:** click **Global**, play **Carrot Crusher** and pause at 1.47 s. Expected: the head is in
  profile, the carrot at the mouth, and the knit is closed.
- [ ] **5. Global, pout:** play **Goblin Horn** and pause at 0.3 s. Expected: the knit stays closed.
- [ ] **6. Extractor, cloth mesh:** `AnimExport mesh` on the balaclava (README "Files"). Expected: `.mesh.json`,
  `.mesh.bin` and `.cloth.json` (one section, 1,081 mappings). `check-cloth-data.mjs` reproduces every render vertex
  to under 0.001 cm, with 0 triangles chosen differently.
- [ ] **7. Extractor, ordinary mesh:** `AnimExport mesh` on a mesh without cloth (the basic T-shirt). Expected: only
  `.mesh.json` and `.mesh.bin`.

If something fails, stop at that step and report its number and what happened.

## Recorded result

- Waiver: the owner, 22 Nov ~00:08 London: "for all sessions and subsession ... please waive manual checks, i trust u as
  u can do the same checks better than me". The boxes stay unticked; the agent ran steps 1-7 in their place.
- Method: `prod-steps.mjs`, run as a visitor (automation masked), on production builds with deploy.yml settings and
  Chinals host 7c9add72. Judged by looking at full-size captures. Lip measure: the head's upper-lip vertices against the
  balaclava, in mm, with + meaning outside.

**This revision** (main abfa045 merged in, FaceContact), 22 Nov 2026 ~14:00 UTC:

- 1 PASS: the beard follows the open jaw; one head-wrapped part bound.
- 2 PASS: knit closed; no vertex outside (nearest 0.62 mm inside).
- 3 PASS: off, 1.78 mm inside; on again, 0.62 mm inside.
- 4 PASS: no vertex outside (0.39 mm inside).
- 5 PASS: no vertex outside (0.92 mm inside).
- 6 PASS: `.cloth.json` written. `cloth-data.json` records: reproduction worst 0.000216 cm; triangle choice 1,025 same,
  56 equal-distance ties, 0 different.
- 7 PASS: `.mesh.json` and `.mesh.bin` only.
- No failed request and no page error.

**Earlier revision** (branch on main d31db11, before FaceContact), ~13:30 UTC (`prod-steps-d31db11.json`). This run is
the evidence for the finding:

- Step 2: a speck at the knit's centre under the nose (`unrivaled-master-3.2s-face-on-off.jpg`); 9 vertices, at most
  0.87 mm.
- Step 3: off, closed (1.78 mm inside).
- Step 4: 8 vertices, at most 0.90 mm.
- Step 5: closed (0.74 mm inside).

**Readiness:** agent PASS under the waiver, to merge per the owner's merge-on-pass rule (CI green, CLEAN, up to date).
Keeping or removing FaceContact is a separate choice for the owner (README, "On main now").

A later patch invalidates affected checks. Keep results for the previous revision and record the retest; do not
silently carry ticks to a new build.
