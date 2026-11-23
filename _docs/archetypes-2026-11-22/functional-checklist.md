# Guided functional review: Light contestants (behind a flag)

## What you are checking

Two things:
- **Production:** behind the archetype flag, nothing changes. The live index has no classes, so no Class picker
  appears. A Light link falls back to Medium with a notice, and the outfit keeps its class.
- **Preview index:** visitors can pick Light. The contestant is the game's Light body, with the shared head scaled
  with it. Items without a current Light mesh are left off and named.

This catches:
- a picker showing in production, or a class lost from a saved outfit or a link;
- a Light body with a floating neck shell, a misplaced hat or glasses, or an item silently swapped for a Medium one.

- PR: this branch's PR. Record: `README.md` beside this file.
- Test this revision: branch `claude/jovial-fermat-65dc6d`, at `{{REV}}`.
- **Open, part A (production build):**
  - Built and served by `node _docs/archetypes-2026-11-22/prod-steps.mjs` at
    http://127.0.0.1:4363/the-finals-outfit/.
  - Uses deploy.yml's hosts; models come from the live asset hosts.
- **Open, part B (dev server with the preview index):**
  - Served by `node scripts/body-types/serve-preview.mjs --port 5197 --preview scripts/generated/archetypes/preview-v2 --live-body --animations-base https://fd946744.the-finals-outfit-assets.pages.dev/`.
  - Opened at http://127.0.0.1:5197/.
  - It needs the root checkout's `public/models`.
- Prerequisites: the worktree's `node_modules`; Chrome or Edge.
- Approximate hands-on time: 8 minutes.
- Agent checks: see Recorded result.
- User checks: waived by the owner for all PRs (22 Nov). The agent ran them; agent results do not tick the boxes.

## Get it running

In PowerShell, in this worktree's root:

```powershell
node _docs/archetypes-2026-11-22/prod-steps.mjs
```

It builds, serves, runs part A and prints PASS or FAIL per step. Press Ctrl+C to stop the server it leaves running
for hands-on checks.

## Try it yourself

**Part A: the production build**

- [ ] **1. Start:** open http://127.0.0.1:4363/the-finals-outfit/ and wait for the character. Expected: the outfit bar
  shows Body type but no **Class** row. The status line reads "Medium · N pieces". No errors.
- [ ] **2. Flag on, no classes:** open `…/the-finals-outfit/?archetypes=on#/`. Expected: still no Class row, because
  the live index carries no class.
- [ ] **3. A Light link:** open the same outfit with `&ar=l` on its link, flag on. Expected: a Medium character and the
  notice "Light contestants aren't available here yet; showing Medium." After a reload, the same notice: the outfit
  kept Light.
- [ ] **4. Medium links unchanged:** with the flag off, open Share and copy the link. Expected: the link has no `ar=`.

**Part B: the preview index (dev server)**

- [ ] **5. Picker:** open http://127.0.0.1:5197/. Expected: the **Class** row shows Light and Medium. There is no Heavy,
  because its body isn't proven current.
- [ ] **6. Light:** choose Light with a hoodie and a cap. Expected:
  - a smaller contestant, head in proportion;
  - the neck meets the collar with no shell or step;
  - the cap sits on the head;
  - the status line reads "Light · N pieces".
- [ ] **7. Left-off item and links:** add the Departure Day skirt. Expected:
  - the notice names it, and it is not drawn;
  - after a reload the class is still Light;
  - Share's link carries `ar=l`, and opening it shows Light.

If something fails, stop at that step and report its number and what happened.

## Recorded result

{{RESULT}}
