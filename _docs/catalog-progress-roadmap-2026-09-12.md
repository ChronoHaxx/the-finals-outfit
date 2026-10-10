# Catalog progress and roadmap

The builder footer now shows the catalog's red, blue, purple and green proportions, with links to the roadmap and GitHub. The roadmap explains the remaining work in eight expandable stages, including fitting, physics, themes, a randomiser, possible suggestions and community reports.

## Counts and meaning

The picker, footer and roadmap share one reconstruction-status source. Counts cover every item available in the current public or developer catalog, including colour variants and choices without an existing preview. Searching or filtering a slot does not change the global bar. Explicit review records retain priority over generic reconstruction support.

The active Cloudflare v5 checkpoint contains 2,605 red (90.9%), 239 blue (8.3%), 21 purple (0.7%) and one green (<0.1%) out of 2,866 items. Blue and purple indicate work applied, not acceptance of the 80% usable-Medium target. Missing status data appears as unknown while existing explicit reviews remain; the visitor can retry a failed status load.

The new route uses the existing hash router (`#/roadmap`) so it works on GitHub Pages without server changes. Entering from the footer includes the edited outfit's existing permanent share codes. Returning after a roadmap reload restores that selection. Public links do not reveal the unlisted developer path. That path keeps its existing initial noindex HTML.

Naming work from the preceding batch remains in this branch. No renderer, extracted assets, share-ID registry or hosting settings changed for the progress UI. Physics and discovery features are described as planned; this change does not implement them.

## Verification

- 189 tests passed, including three new tests for progress precedence, unavailable/empty state and tiny percentages.
- The 2,866-ID share compatibility check passed.
- TypeScript and the production build passed with the existing large-bundle warning.
- Isolated Edge workflows verified the real release counts, global scope through picker filtering, edited-outfit preservation through roadmap refresh/back/forward, and disclosure/navigation links.
- A simulated status-download failure kept unknown items grey and recovered through the retry control. No page errors were reported.
- Desktop, shorter desktop and mobile layouts were checked in the browser and visually inspected. The nearby 3D preview loaded without an alert.
- Test-harness repairs: whitespace normalization in the legend assertion and allowance for the back link's decorative arrow. The only visual copy repair was `1 items` to `1 item`; final captures rechecked it.

Private run records and screenshots: `E:\Coding\the-finals-outfit\_docs\catalog-progress-ui-2026-09-12\`. No additional Claude/model call was used for this small UI batch.

## User checks before a future PR merge

Current candidate: `codex/catalog-progress-roadmap`, main baseline `bbf9a6415a29ae961fddbc7f0ad38152d7674b7e` plus local changes. Final app asset after the legend follow-up: `index-B2lMTS-6.js`. The preview uses Cloudflare v5 assets and is available at <http://127.0.0.1:4321/the-finals-outfit/> while the local preview server is running. Nothing from this branch has been published yet.

- [ ] Open the builder. Confirm the top-right legend explains all four colours without hovering, and the bottom progress bar is understandable. On mobile the legend appears beneath the heading.
- [ ] Change one item. Open **Progress & roadmap**, expand **Physics and secondary motion**, then reload that page and use **Back to your outfit**. Confirm your chosen item remains equipped.
- [ ] On a narrow window or phone, reach both the bar and roadmap link without horizontal scrolling; verify the roadmap sections can be opened and read.

Agent checks pass. These user checks remain pending and are not implied by generic approval or the automated result.

## Follow-up from user feedback: visible legends

The user found removal of the old visible legend unintuitive and asked for it at the empty top right. Added a persistent four-colour legend there with the same badges and wording as the picker status filter. It stacks beneath the heading on mobile. The original automated results remain preserved; they did not establish that the hover-based explanation was intuitive.

This small presentation follow-up passed TypeScript/build and desktop/320px mobile visual inspection, with no horizontal overflow or browser page errors. No new unit tests or model delegation were needed. Evidence: `legend-desktop.png`, `legend-mobile.png` and `legend-observations.json` in the private run folder. User retest of the revised legend is pending.
