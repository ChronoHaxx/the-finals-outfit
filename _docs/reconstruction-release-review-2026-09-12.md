# Guided release review — 12 September 2026

Check that the new cosmetic families load, swap and restore correctly in the production build.

- Branch: `codex/reconstruction-coverage-release`; the PR records its exact commit.
- Build: `index-Bor3PFYc.js`, SHA-256 `02367acd7608ba1acd024f5acd97d28adc22c151a7fb7dcfc52e6858bbc944f6`.
- Assets: immutable `v5-coverage-20260912`.
- Open the release preview linked in the PR. It runs on this computer at `http://127.0.0.1:4317/the-finals-outfit/` with the new hosted assets.
- Prerequisites: the prepared preview server is running; no account is needed.
- Allow around 3–5 minutes. Rotate by dragging the character; zoom with the mouse wheel.
- Agent checks: 168 application tests, typecheck, optimized build, and seven production browser cases passed. Earlier source and visual batch checks remain in the local acceptance records.
- User checks: **PENDING**. Automated results do not check these boxes.

If the preview server needs restarting, run from the repository in PowerShell:

```powershell
Set-Location E:\Coding\the-finals-outfit
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4317 --strictPort --outDir scripts/generated/release-2026-09-12/app --base /the-finals-outfit/
```

- [ ] **1. Start and rotate.** Open the PR's prepared outfit link. Expect Face01, Afro Fade, the white/red Eno Rino singlet, jeans, sneakers, gold chain earrings, a boombox and Crosses nails. Rotate to both ears and behind the character: the earrings and back prop should be present, with no error banner.
- [ ] **2. Replace and remove earrings.** Click Earrings, choose Earrings Gem 01, then click that same tile again to remove it and again to restore it. Expect one pair after restoring, with no old chain pieces. The worked-on tiles should have blue 3D labels.
- [ ] **3. Change face.** With earrings selected, click Face and select Face02, then return to Face01. Expect the existing fallback on Face02 and the reconstructed pair on Face01, without stranded or doubled pieces.
- [ ] **4. Nails.** Click Nail Polish and find the selected Nails Crosses 01 tile. Zoom toward a hand, then click that tile to remove it and again to restore it. Expect the nail design to disappear/reappear without tinting the fingers or leaving the old design behind.
- [ ] **5. Body paint.** Click Body Paint, select Body Paint Body Tight 01, then click it again to remove it. Expect the bright green body paint on exposed body areas, then the ordinary skin/outfit restored. This body paint intentionally leaves the face and hands uncovered.
- [ ] **6. Ordinary outfit and reload.** Click Facewear and select Asian Mask; expect the mask to appear. Then reopen the PR's original prepared outfit link in a new tab and refresh it. Expect the original outfit from step 1 to return, including Chain Gold earrings and without the added mask; camera dragging should remain usable.

Reply with the passing numbers, or the first failing number and what happened. The agent can guide one step at a time. Detailed game fidelity, other bodies, jiggle and exhaustive outfit fitting are outside these basic checks.

## Recorded human result

- Tested revision/build: pending.
- User reported at: pending.
- Passed/failed checks: none reported; 1–6 untested.
- Explicit waivers: none.
- Merge readiness: pending human results.
- Publication authorization: user requested publication on 12 September; the separate functional gate remains open.
