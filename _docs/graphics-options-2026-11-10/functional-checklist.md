# Guided functional review — graphics options, no smeared print on Low, WebGL fallback

## What you are checking

Garment print (text, logos) should stay crisp while the idle plays on every Graphics setting, including Low. The Graphics
button now opens a panel with Quality, Anti-aliasing (TAA / MSAA / Off), Resolution and an FPS counter, all remembered.
A browser without WebGL shows a message instead of a blank box. This catches smeared or ghosting print, a setting that
does nothing or is forgotten, a panel that does not fit a phone, and a blank viewer in LibreWolf.

- PR / originating issue: FModel Discord feedback relayed by the user on 10 Nov 2026 (blur, Low ghosting, Edge, LibreWolf, requests)
- Test this revision: branch `claude/graphics-options-2026-11-10`, commit `<filled in at push>`
- Open: http://127.0.0.1:5182/?reconstructed=1 (dev server in the session's "dev 5182" terminal tab)
- Prerequisites: none to download. Microsoft Edge (installed with Windows) for step 6. Firefox for step 7 is optional.
- Approximate hands-on time: 8 minutes
- Agent checks: see README "Checks" in this folder
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

If the 5182 server is running, reload the page (Ctrl+R). Otherwise, in **PowerShell**, working directory
`E:\Coding\the-finals-outfit\.claude\worktrees\friendly-sanderson-4b3b98`:

```powershell
node _docs/graphics-options-2026-11-10/serve-5182.mjs
```

Stop it with Ctrl+C in that tab.

## Try it yourself

- [ ] **1. The panel:** click **Graphics** (top right of the 3D view). Expected: a panel with Quality, Anti-aliasing
  (TAA highlighted), Resolution ("Auto (from Quality)" with a pixel size) and "Show FPS counter". Esc or a click outside
  closes it.
- [ ] **2. Print on Low:** search Upper Body for `punktuator` and wear the **Punktuator Jacket** (or the red jacket from the
  Discord report). Scroll in on the chest. Set Quality to **Low** and let the idle play for ~10 s. Expected: the chest
  print, the pocket patch's stripes and the sleeve text stay sharp while the body sways, with no doubled or trailing
  letters. Compare with the live site on Low, where they smear.
- [ ] **3. Anti-aliasing:** with the idle playing, switch **MSAA**, then **Off**, then back to **TAA**. Expected: MSAA and
  Off look sharper while moving, with stair-stepped edges on Off; long hair or lace looks dotted while moving on both and
  smooths within a second of pausing. TAA is smooth everywhere. Nothing flashes or goes black when switching.
- [ ] **4. Resolution and FPS:** tick **Show FPS counter**, then set Resolution to **50%**. Expected: a counter at the
  bottom left (fps, ms, size); the picture gets softer and the size in the counter halves. Set Resolution back to
  **Auto**.
- [ ] **5. Remembered:** set Anti-aliasing to **Off**, reload the page. Expected: Off is still selected, and the FPS
  counter is still on. Put TAA back and untick the FPS counter.
- [ ] **6. Edge:** open the same address in **Microsoft Edge**. Expected: it loads and plays like Chrome. If the address
  bar shows "Added security", a notice under the top bar explains that Edge's enhanced security slows this site and how
  to turn it off for this site.
- [ ] **7. No WebGL (optional):** in Firefox, open `about:config`, set `webgl.disabled` to `true`, open the address.
  Expected: the 3D area says "3D preview unavailable" with the LibreWolf fix; the item picker still works. Set
  `webgl.disabled` back to `false` afterwards.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual step
numbers), or e.g. "2 fails: the sleeve text still trails on Low".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
