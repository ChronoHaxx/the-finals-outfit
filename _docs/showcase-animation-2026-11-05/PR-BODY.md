## Showcase animation: the outfit-screen idle, 229 emotes with their props, and the game's joint rig

The 3D character now plays THE FINALS' outfit-screen idle by default, and all 229 emotes in the Season 12 game files can be picked from
the game's own icons. Every equipped cosmetic follows the body. Emotes show their props: cups, swords, wings, flags,
and the hologram partner in two-person emotes. Twisted wrists and bent elbows keep their shape, because this branch
ports the game's deformation Control Rig. One click goes back to the old still pose, and that choice is remembered.

- **Clips, icons and props** are decoded offline from the game's own files (`scripts/anim-export`). They are hosted
  like the models, not committed: `ANIMATIONS_BASE` in `deploy.yml` points at the immutable deployment
  `__ANIM_HOST__.the-finals-outfit-assets.pages.dev`. It holds 569 files, 103 MB: 191 clips, 201 icons, 174 prop
  GLBs, the manifest and `props.json`. A deployment without that host hides the animation controls.
- **Accumulator:** while the pose moves, the still view's accumulation switches to a motion mode, a clamped running
  average with a motion-specific alpha-hash pattern. Paused frames converge exactly as before. `?temporal=0` still
  works.
- **Still pose:** the share card and Export 3D render the still pose.
- **Performance:** clips and props load on demand. The prop GLBs have a median size of 231 KB and a maximum of 1.8 MB.

Evidence, decisions and commands: `_docs/showcase-animation-2026-11-05/README.md`.

### Checks

- **User:** the 7-step functional checklist PASSED on the dev build, 6 Nov 2026
  (`_docs/showcase-animation-2026-11-05/functional-checklist.md`). The user asked to publish as is.
- **Agent:**
  - captures reviewed by eye at full size (props, joints, picker on desktop and phone, moving and paused);
  - typecheck clean; full test suite 664/677 (the 8 failures are pre-existing asset-fixture tests unrelated to this
    branch; 5 skipped);
  - production build checked against the hosted animation deployment (__PROD_CHECK__).

### Known gaps (shipping as is, by the user's choice)

- **Props that are wrong:**
  - Valkyria's Embrace wings look wrong (the mesh or its effect);
  - the Jetpack emote's prop is far too big;
  - the Death emote's wings are rotated 90°;
  - others are unreviewed.
- **Not shown:** effects (Niagara) and sound. 46 prop materials are approximations.
- **Pre-existing, not caused by this branch:** the still view flickers while a drag slows down, and for about three
  frames after a window resize. The idle (now the default) mostly hides it. The planned fix is to use the motion
  average whenever the camera moves, then fade into the converged still result.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
