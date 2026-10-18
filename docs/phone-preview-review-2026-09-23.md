# Phone preview review

This release brings the accepted hair/face work, visible outfit loading feedback,
and hash-verified shader/texture byte reuse into one hosted production preview.
It also separates reconstruction assets from base models so each static asset
deployment stays within Cloudflare Pages Free limits.

- Open: [prepared five-item outfit](https://e5b1129f.the-finals-outfit-assets.pages.dev/the-finals-outfit/#/?o=2.36w.1n0.81ql.a17f.cct).
- Build: `assets/index-ugAEkCMk.js`, SHA-256 `6ca900c232fdd5317f7c4c49d40a11ede0d16961f37dcb42138d15e3d03731a6`.
- Branch: `codex/loading-phone-preview`.
- Prerequisites: a current phone browser with WebGL and internet access; no sign-in or PC connection required.
- Allow around three minutes of interaction, plus the first asset download.
- User checks: **PENDING**. Desktop automation at a phone-sized viewport is not physical-phone acceptance.

## Try it

- [ ] **1. Start:** Open the link. The face, double-bun hair, shirt, jeans and shoes appear; there is no shader-error banner or sideways page scrolling.
- [ ] **2. Loading and repeats:** In **Upper Body**, choose two shirts in turn. During a noticeable load, “Loading outfit…” appears and the previous outfit remains visible. After completion the pill disappears and the selected shirt is visible. Switch back once.
- [ ] **3. Touch controls:** Scroll back to the model, drag to rotate it and pinch to zoom. The loading overlay does not capture your touch. Change **Studio/Lobby** once; the model remains usable.
- [ ] **4. Persistence:** Tap **Share outfit**, open the generated link in a new tab, then reload it. The selected outfit returns. The preview URL is an online preview; the public GitHub Pages site changes only after the release is approved and merged.

Report “1–4 pass”, or the step number and what failed. Keep failures attached to
this exact build; a later app patch requires the affected checks again.

## Agent evidence

- Typecheck and production build passed. The existing large catalog bundle warning remains.
- Application/helper tests: 389 passed, one existing external-reference test skipped because `reference/` is absent.
- Additional pipeline contract command: 109 passed, the same reference-dependent check skipped.
- All 2,866 permanent share IDs passed compatibility validation.
- All three real asset manifests and 52 HTTP spot checks passed. The new reconstruction
  package has 16,183 asset files, including eleven duplicated relative body-mask dependencies.
- Every one of the 9,215 reused base-model/companion files matched the previous staged release byte-for-byte.
- The production app passed eleven browser checks on the final HTTPS deployment:
  body failure/retry, loading completion, nonblocking live status, ordinary item switching,
  mobile layout, the three actual asset hosts and no uncaught browser errors.

These checks establish hosted browser behavior, not phone GPU memory or real touch
acceptance. The byte cache may retain up to 128 MiB of additional CPU data; a phone
tab reloading itself or becoming unresponsive is a failed device check to investigate.

## Release state

The preview and reconstruction assets are published. The GitHub Pages release has
not been merged or promoted, and physical-phone acceptance remains pending.
The release uses existing free static hosting; no paid service or account setting was enabled.
