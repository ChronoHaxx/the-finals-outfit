# Emote picker: a more in-game feel (proposal, 15 Nov 2026)

Your report: "clicking emotes the emoted list show up not at the button, either fix that or make it better/more
diegetic idk". The hotfix (this PR) puts the list back under the Emotes button. These are the ways to go further. None
is built; pick one (or none).

| | Idea | What you'd see | Effort | Trade-off |
|---|---|---|---|---|
| A | **Keep the hotfix** | The list opens under the Emotes button, over the right side of the 3D view | done | On a narrow window (drawer open, ~1024 px) it covers part of the character |
| B | **Locker panel** (recommended) | Emotes slide in as a full-height panel on the 3D view's right edge, and the camera re-centres the character in the space left, like the game's customisation screen. Nothing ever covers the character | ~1 day | Camera framing changes while the panel is open (the harness captures are unaffected: they never open it) |
| C | **Emote wheel** | Press E (or hold the Emotes button) for a wheel of 8 emotes around the character: your recent and starred ones. "All emotes" in the middle opens the full list | ~1-2 days | Only 8 at a glance, so it adds to the list rather than replacing it; needs a starred-emotes list saved in the browser |
| D | **Hotbar strip** | A row of emote icons along the bottom of the 3D view, above the timeline; scroll it sideways, the search icon opens the full list | ~0.5-1 day | Small icons; on phones it competes with the timeline for the bottom edge |

Recommendation: **B** now, as it fixes the one thing A leaves (covering the character) and reads most like the
game's own screens. **C** is a good later addition for quick replays once there is a starred list.

Built in the site's own style, not copying the game's assets.
