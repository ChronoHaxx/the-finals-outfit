# Guided functional review — share links keep the lighting (Shocka item 10)

## What you are checking

A share link now opens in its sender's lighting (look, lights, backdrop, scene), shown in place of the recipient's own
without changing it until they keep it or go back. This catches a link that opens in the wrong lighting, and, above all,
a link that overwrites the recipient's own lighting or saved looks.

- Feedback item: `_docs/feedback-shocka-2026-11/README.md`, item 10 (main folder)
- Test this revision: branch `claude/share-lighting-look-2026-11-22`, code at
  `39d8eb39815c9110d2256e45812d7cbd0d6c7fb9` (later commits on the branch are docs only)
- Open: a production build of that revision (`npm run build` with the asset bases of `.github/workflows/deploy.yml`
  on main, `VITE_SHARE_PREVIEW_BASE=http://127.0.0.1:8787`), served by `vite preview --base /the-finals-outfit/` on port
  4344, with the share Worker of the same revision under `wrangler dev` on port 8787 (local KV; nothing touches the
  account)
- Prerequisites: none beyond the worktree's `node_modules`
- Agent checks (22 Nov 2026):
  - PASS: typecheck and production build (its public-text checks included).
  - PASS: `npm test` 1,058 pass; the 8 failures need extracted assets this worktree does not have
    (`public/models/body/SK_Body_M.glb`, the ski-blade fixture) and touch nothing in this change. The new
    `tests/share-lighting.test.ts` (12) and `tests/shared-lighting-store.test.ts` (12), and the Worker test (18, 3 new),
    all pass. They run in `npm test`, not in the deploy workflow's contract step: this session's GitHub token cannot change workflow files, so `deploy.yml` is exactly as on main.
  - PASS: steps 1–8 below, in Playwright's Chromium (SwiftShader WebGL 2, `navigator.webdriver` masked), judged by
    looking at full-size 1280×800 captures and by comparing the stored `finals-outfit.lighting` value before and after.
  - NOT RUN: Safari, Firefox, a real phone (step 8 used a 390 px viewport), the published site's own preview upload
    (step 2 used the local Worker), and the live Worker (deployed after merge, with its own read-only checks).
- User checks: **waived** for all PRs (the user's standing waiver of 22 Nov); the agent ran the checklist below.

## Try it yourself

- [x] **1. Start:** open the app with no link and press Esc on the intro. Expected: the Studio look, no lighting bar.
- [x] **2. Share your lighting:** in the lighting menu pick **Season 12 menu**, turn the **Sun** slider, then **Share
      outfit**. Expected: the panel shows **Include lighting** · "Custom · 4 lights · sun 42° / 54° · Season 12 menu";
      the preview link ends in `&lt=1.e1000.ta.…_Under-fill`; with **Short link** the hash ends in the same `lt`, and
      unticking Include lighting removes it. With **Lobby** the link says `&lt=lobby`.
- [x] **3. Open someone's link:** with your own look set to a turned **Nighttime** and a saved **Look 1**, open the
      preview link from step 2. Expected: the Worker page sends you on to the builder, which shows the sender's Season 12
      menu stage with the key from the right; a bar says "You're seeing the lighting from this link"; the lighting button
      says **Link · Custom**. Your stored lighting is byte-for-byte unchanged.
- [x] **4. Go back:** open the lighting menu (it repeats the two choices, and Undo is hidden), then **Use my lighting**.
      Expected: your turned Nighttime look is back; the bar is gone; storage still unchanged.
- [x] **5. Keep it:** open the same link again in the same tab and press **Keep this lighting**. Expected: the bar says
      it is yours and saved as "Shared look"; the saved looks are Look 1 and Shared look (nothing replaced); **Undo** in
      the bar brings your Nighttime look back and leaves both saved looks.
- [x] **6. Change it:** open a link with `lt=cool` (the bar says "(Cool)") and nudge the Sun slider. Expected: the bar
      goes, Cool with the turned sun is now your stored look, and Undo in the lighting menu returns to yours.
- [x] **7. Links it cannot show:** open links with `lt=golden-hour` and `lt=1.e1000.tq`, then one with no `lt`.
      Expected: the first two say "This link's lighting can't be shown on this version of the site, so your own lighting
      is used" and keep yours; the third says nothing; storage unchanged throughout.
- [x] **8. Reload and phones:** open a link whose outfit you have not saved (`#/?o=2.36o.81qo&lt=warm`) and reload.
      Expected: the address keeps the link, the Warm look and its bar come back after the reload, and your stored look is
      unchanged. At 390 px wide the bar wraps above the 3D view with both buttons readable.

## Recorded result

- Tested revision/build: production build of the working tree that became `39d8eb3` (the app code is identical; an earlier local commit `3c19f3c` also listed the new tests in `deploy.yml`, dropped before the push), 22 Nov 2026, 17:58–18:05 London
- Agent result: 1–8 **PASS** under the user's standing waiver. A defect found and fixed during the run: opening the same
  link again in the same tab after "Use my lighting" did not offer it again (the once-per-address memory never forgot the
  address); fixed before the commit, covered by `tests/shared-lighting-store.test.ts`, and step 5 rerun on the fixed build.
- User reported at: not required (waiver)
- Explicitly waived checks: all user checks, by the user's standing instruction of 22 Nov
- Readiness: agent-verified; live Worker deploy and its read-only checks follow the merge
- Merge authorization: the task brief (merge on pass, CI green, CLEAN)
