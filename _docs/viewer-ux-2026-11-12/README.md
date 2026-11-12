# Viewer UX: items drawer, hide UI (H), transparent screenshots (12 Nov 2026)

Community feedback (Shocka, Discord), three features, studio.warfarin.wiki as the look to aim for (looked at only).
Stacked on PR #40 (`claude/studio-light-options-2026-11-11`, f98e97e), which changes the same viewer files.

## What changed

| Piece | Where | Notes |
|---|---|---|
| Layout: stage fills the window, picker is a drawer | `src/pages/Builder.tsx`, `src/components/ItemsDrawer.tsx` | side drawer from `lg` and on a phone held sideways; sheet under the stage on an upright phone |
| Drawer open state, layout switch, H logic | `src/lib/viewer-chrome.ts` | key `finals-outfit.drawer`, read-modify-write; automated browsers ignore it |
| Hide UI (H, eye button) | `useHideUi` in `viewer-chrome.ts`, `CharacterViewer.tsx` | hint "Press H to show UI" / "Double-tap to show UI"; cursor hidden via `html.ui-hidden` |
| Screenshot (PNG, backdrop or transparent) | `src/components/ScreenshotPanel.tsx`, `src/rig/ViewerScreenshot.ts` | camera button in the viewer's top row; 1x-3x of the stage, capped by GPU memory |
| Straight-alpha output for a caller's target | `StableFrameAccumulator.straightAlpha` (`STRAIGHT_OUTPUT`) | the canvas program is unchanged (test: token-identical) |
| Target viewport fix | `StableFrameAccumulator.render` | with a destination target, the canvas viewport/scissor are no longer written over it |
| Async PNG (Paeth rows, native `CompressionStream`) | `src/lib/png-encode.ts` `encodePngAsync` | the exact `encodePng` used by the source export is untouched |
| Backdrop as numbers | `stage-lighting.ts` `backdropPaint`, `THEME_GRADIENT` | test: equals `backdropCss` for every choice in both themes |
| Small fixes for the new layout | `SlotPicker` (sticky strip in the drawer, container query header), `OutfitBar`, `CatalogProgress` (wraps), `ShareBuild` (opens downwards on phones), `EmotePicker` (docks left of the stage over the drawer; phone sheet top follows the stage) | |

## Decisions (why it is built this way)

- **The drawer pushes the stage; it does not overlay it.** The harnesses (visual-diff, audit, anim-export) clip
  screenshots to the canvas box. With an overlay the drawer would sit inside that box. Pushed, the default phone layout
  keeps exactly the old stage box (760x1100: 760x484 at y = 56, before and after). Toggling the drawer resizes the
  canvas once, as full screen already did.
- **Nothing unmounts.** Full screen and hidden UI lift the stage to a fixed full-window layer; the rest stays laid out
  but `invisible` and `inert`. A closed side drawer is positioned out of the flow, `invisible` and `inert`; the phone
  sheet saves and restores its scroll. So the picker keeps its slot, search, filters and scroll, and the 3D viewer is
  never moved in the tree (moving it reloads the character). DOM order is fixed (stage, then drawer); the side layout
  uses `row-reverse`, so rotating a phone moves nothing.
- **Never touches the outfit.** These are view states. Test: the equipped list and every non-view localStorage key are
  identical before and after all toggles.
- **H**: ignored in text fields and selects (typeahead), with Ctrl/Alt/Meta, on key repeat, during IME composition and
  while a modal dialog is open. Esc brings the UI back first; with full screen on, the first Esc restores the UI and the
  second leaves full screen (window capture listener, `preventDefault`). Never persisted: a reload shows the UI.
- **Screenshot lighting = screen lighting.** The capture draws the live scene from the live camera's position through
  its own still-view accumulator (the pipeline the canvas shows): same lights, environment, shadow map, tone mapping and
  exposure. 32 jittered samples, drawn synchronously, so a playing emote is caught at the frame on screen without grain.
- **Alpha and edges.** The accumulator already divides coverage out before tone mapping and premultiplies after, so
  the screen has no tone-mapped-coverage fringes. On the backdrop, the PNG keeps the premultiplied output and composites
  it over the same gradient as the browser does (`P + (1 - A) B`), so additive glows add exactly as on screen. For the
  transparent PNG the accumulator writes straight alpha (`STRAIGHT_OUTPUT`): colour and coverage apart, full 8-bit
  colour at soft edges. Floor shadow and contact shadow are left out unless "Keep ground shadow" is ticked.
- **Known limit:** additive glow over nothing (holograms) has no straight-alpha form; it is written as colour / peak at
  alpha = peak: exact over black, slightly darker over a light background. On the backdrop it is exact.
- **Fable 5.2 review** (thread acbfb2ca, about $2.04): premultiplied path for the backdrop file, the destination
  viewport bug, restore the render target, refuse when float targets are missing, async read-back and PNG encode.
  Not taken: running the capture inside the live state's side-flip bookkeeping (the live view restarts once after a
  capture instead; harmless).

## Agent checks (12 Nov 2026)

- `npx tsc -b --noEmit`: PASS.
- `npm test`: 817 tests, 804 pass, 8 fail, 5 skipped. The 8 are the known failures that need local
  `public/models/*.glb` fixtures a worktree lacks (as on PR #40). New: `tests/viewer-chrome.test.ts` (6),
  `tests/viewer-screenshot.test.ts` (5), and the STRAIGHT_OUTPUT case in `tests/rig/reconstructed-hologram.test.ts`.
- `viewer-ux-test.mjs`, headless Chrome (SwiftShader), production builds of this branch and of PR #40 (f98e97e):
  **54/54 checks pass, 0 page errors.** Full-size screenshots looked at (they stay local: renders of game assets).
  - Automation contract at the harnesses' 760x1100: canvas box identical (760x484 at y = 56). Pixels: 64 differ,
    all on the eyes/neckline (alpha-hashed); PR #40 against itself: 62 differ in the same box. Within its noise.
  - Desktop 1440x900: drawer default open, closing gives the stage the full width, closed drawer inert, state
    remembered after reload, slot + search + grid scroll survive close/open, Enter on the tab toggles.
  - Hide UI: H hides UI and cursor, stage fills the window, hint visible (also with reduced motion) and gone after
    ~2.6 s; H, Esc and double-click restore; H typed in search stays text; Ctrl+H ignored; eye button; with full
    screen the first Esc restores the UI and full screen stays. Equipped list and outfit storage unchanged after all.
  - Screenshots, Studio and Lobby at 1x: RGBA 8-bit; clear, solid and soft-edge pixels; the PNG backdrop equals the
    CSS gradient (max 1 level); the transparent PNG over the CSS backdrop equals the backdrop PNG (max 2); the
    backdrop PNG equals the screen (max 1). Floor shadow left out unless kept. 2x is 1728x1688 for an 864x844 stage.
    Edges looked at 4x enlarged, and the 2x file over near-black and near-white: no halo, no dark fringe.
  - Phone 390x844: sheet open by default with the old 44% stage, no sideways scroll, top row fits (Graphics summary
    hidden on a narrow stage), closed handle fits, swipe up opens, slot strip sticks to the sheet top, eye + double
    tap, Share panel opens inside the sheet, screenshot panel on screen, full-screen row fits.
  - Landscape 844x390: side drawer, row fits the stage, closed gives the full width; rotation to portrait and back
    keeps the picker's search and the same 3D canvas.
- **Not covered:** real phones (iOS Safari, Android back gesture, notch), Firefox/Safari, a real GPU's speed and memory
  for 2-3x captures, an additive hologram in a transparent PNG, the `?reconstructed=0` legacy view (no still-view
  accumulator on screen there, so a capture is smoother than that screen).
- Seen, not changed: on a narrow stage the Sun slider (PR #37) sits over the character's head.
