# SEO basics refresh (6 Nov 2026)

PR #15 (`claude/seo-basics-2026-10-29`, opened 29 Oct at `840cc9b`) conflicted with `main` after the redesign
(#16), the 5 and 6 Nov releases (#19, #20), the showcase animation (#22) and the roadmap page (#23). The user asked
on 6 Nov to bring it up to date ("make the 2 stale unstale"). `main` was merged into the branch; nothing was
force-pushed. The 29 Oct record (untracked) is in the main checkout at `_docs/seo-2026-10-29/`.

## What changed on the branch

- **Merge of `main` (`af8a203`).** Only `index.html` conflicted. The redesign's shell, theme colour, boot status
  and loading bar are kept, and so are the branch's search and preview tags.
- **Title:** `THE FINALS Outfit Builder · Fan-made, try on cosmetics in 3D` (60 characters). The keywords come
  first, and "fan-made" is kept from the redesign's title (`Outfit Builder · fan-made for THE FINALS`). The old
  "Try Every Cosmetic in 3D" overclaimed, since some items are icon-only.
- **Shell:** the redesign's "Outfit Builder" heading is now the `<h1>`, with "THE FINALS" as a small kicker inside
  it (text "THE FINALS Outfit Builder"). The one-sentence description is set in the redesign's muted colour.
- **No counts** in `index.html`, the card or the sitemap. They change with every catalog update and live in one place
  in the app.
- **`public/og-card.jpg`:** recaptured from the redesigned app and laid out in its style: Saira, the near-black set
  with hatching, the crimson accent, chamfered stage panels with viewfinder brackets, and the welcome screen's own
  sentence. It has the same two looks (Sentinel set; pink track jacket with camo cargo pants), now in the
  outfit-screen idle that the app plays by default, held at 2 s.
- **`public/sitemap.xml`:** still one URL. The builder, the roadmap (`#/roadmap`) and outfit links (`#/o/...`) are
  hash routes, so crawlers see them as the root URL. The comment that said routes are "served by the SPA fallback"
  was wrong for hash routes and is corrected.
- **`vite.config.ts`:** the developer-catalog copy of the page is `noindex, nofollow`. It now also drops the
  canonical link, because a noindex page that names the production page as canonical sends conflicting signals.
  The build fails if the canonical cannot be found to strip.

## How the card was made

Run these from the worktree root in Git Bash.

1. Start a dev server of this branch that uses the production asset hosts, copying the `VITE_*_BASE` values from
   `.github/workflows/deploy.yml`. Port 5197 was used. The capture hooks are dev-only.
2. `MSYS_NO_PATHCONV=1 ANIM_TIMES=2 APP_URL=http://127.0.0.1:5197 node _docs/seo-2026-11-06/og-card-capture.mjs OUT`
3. `python -I -X utf8 _docs/seo-2026-11-06/og-card-panels.py OUT WORK`
4. `node _docs/seo-2026-11-06/og-card-compose.mjs WORK WORK/og-card.jpg`

Evidence, untracked because renders of extracted geometry are extracted material, is in the main checkout under
`_docs/seo-2026-10-29/`:

- `renders-v3/`: the first attempt. The redesign's sticky top bar and slot strip leaked into the canvas shots.
- `renders-v4/`: clean.
- `card-v3/`: the panels, `card.html` and the card.

The harness's `frameViewer` hides only the viewer's own overlays, so `og-card-capture.mjs` also hides every branch of
the page that does not contain the canvas. Other harness callers that use a viewport narrower than 1024 px may hit
the same leak.

## Checks (agent)

- `npm test`: in a bare worktree, 678 pass and 8 fail. The 8 are the asset-fixture tests that need
  `public/models`. With `public/models` junctioned in from the main checkout: 690 pass, 0 fail, 1 skipped. The
  junction was removed afterwards.
- `npm run typecheck`: pass.
- Production build with the deploy workflow's environment and `VITE_BASE=/the-finals-outfit/`: pass.
  - `check:catalog-split`: OK, 5 preloads on both pages.
  - `validate:share-links`: 3,331 permanent IDs.
  - `validate:catalog`: OK, with the 2 usual bare-checkout warnings: referenced assets are not present locally, and
    `ASSETS_BASE` is not set.
- Built heads, parsed:
  - The app page has the title, canonical, `og:image`, `summary_large_image`, valid JSON-LD (WebApplication), the
    h1 "THE FINALS Outfit Builder", `#boot-status` and 5 catalog preloads.
  - The developer catalog has `noindex, nofollow` and no canonical.
- `vite preview` at `/the-finals-outfit/`:
  - `og-card.jpg` is served as image/jpeg (115,935 bytes) and `sitemap.xml` as text/xml.
  - The builder boots with the new title, no failed requests and the welcome dialog.
  - `#/roadmap` renders under its own title.
  - The static shell fits a 375 px phone.
- Trap: in Git Bash, `VITE_BASE=/the-finals-outfit/` becomes `/Program Files/Git/the-finals-outfit/` unless
  `MSYS_NO_PATHCONV=1` is set. The first preview build was broken this way. `check:catalog-split` does not catch it.
