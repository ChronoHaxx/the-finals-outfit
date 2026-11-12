# Guided functional review: viewer UX (items drawer, hide UI, transparent screenshots)

## What you are checking

The 3D view now fills the window with the item picker as a drawer, H hides every control for a clean look, and the
new camera button saves a PNG (on the backdrop or transparent); this catches a layout that loses picker or outfit
state, an H that fires while typing, and a transparent PNG whose lighting or edges differ from the screen.

- PR / originating issue: community feedback (Shocka, Discord); PR link in the PR itself (stacked on PR #40)
- Test this revision: branch `claude/viewer-ux-drawer-hide-ui-2026-11-12`, the commit named in the PR
- Open: a local production build (commands below), desktop browser at full width; then a phone on the same Wi-Fi
- Prerequisites: Node and this worktree's `node_modules`; nothing else. No secrets.
- Approximate hands-on time: 10 minutes
- Agent checks: see `README.md` in this folder (headless Chrome, desktop 1440x900, phone 390x844, landscape 844x390)
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\recursing-jennings-bbf9ae`:

```powershell
$env:VITE_BASE="/"; $env:VITE_ASSETS_BASE="https://f4a8e069.the-finals-outfit-assets.pages.dev/"; $env:VITE_MODELS_BASE="https://a029b249.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_BASE="https://c062af24.the-finals-outfit-assets.pages.dev/"; $env:VITE_ANIMATIONS_BASE="https://cd858839.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_ROUTES_FILE="src/data/reconstruction-routes.json"; npx vite build
```

```powershell
npx vite preview --base / --port 5215 --strictPort --host
```

Open the `Local:` address on the computer (http://localhost:5215/) and the `Network:` address on the phone. Stop with
Ctrl+C. Your saved outfits live in each browser's own storage; nothing here edits them.

## Try it yourself

- [ ] **1. Start (desktop):** open the page. Expected: the 3D view fills the window under the header; the picker
      (slots, items, your outfit) is a column on the left with an "Items" tab on its right edge.
- [ ] **2. Drawer:** pick a slot, type a search, scroll the grid a little, then click the Items tab. Expected: the
      drawer closes and the character re-centres in the full width. Click the tab again: same slot, search and scroll.
      Close it, reload the page: it stays closed. Tab to the Items button and press Enter: it opens.
- [ ] **3. Hide UI:** click on the 3D view, press H. Expected: every control and the mouse cursor disappear and
      "Press H to show UI" shows for about two seconds; dragging still turns the camera. H (or Esc, or a double-click)
      brings everything back. Click the search box and type "h": it types, nothing hides.
- [ ] **4. Transparent screenshot:** camera button, Transparent, Save PNG. Expected: a `...-transparent.png` downloads.
      Open it in an image editor (or paste it into Discord on a dark and a light background): only the character,
      same colours and lighting as on screen, no grey box, no floor, no dark or white fringe on the edges.
- [ ] **5. Backdrop screenshot at 2x:** camera button, Backdrop, Size 2x, Save PNG. Expected: the PNG looks like the
      view (backdrop included), twice the size; try it once in Lobby too.
- [ ] **6. Phone:** open the Network address. Expected: the character on top, an "Items" sheet below; tap its handle
      (or swipe it down) to hide the sheet and get a full-screen character, swipe up to bring it back. The eye button
      hides all UI ("Double-tap to show UI"); a double tap brings it back. Turn the phone sideways: the items move to a
      side column.
- [ ] **7. Nothing lost:** after all of the above, open the outfit menu (top of the outfit panel). Expected: the same
      outfits and pieces as before you started.

If something fails, stop at that step and report its number and what happened.
Reply "1-7 pass" (using the actual step numbers), or e.g. "4 fails: white outline round the hair".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
