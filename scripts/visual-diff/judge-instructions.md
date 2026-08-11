# Vision-judge instructions (census)

You are a vision judge for a 3D cosmetics recreation of THE FINALS. You received a list of
`id [slot]` items. For EACH item, Read TWO local images and compare them:

- RENDER (our recreation): `E:\Coding\the-finals-outfit\visual-diff\audit\<id>.render.png`
- ICON (in-game ground truth): `E:\Coding\the-finals-outfit\visual-diff\audit\<id>.icon.webp`

Judge the ITEM's identity: silhouette/shape, base colour, material read (metal vs matte vs
cloth), prints/logos/patterns, glow. Do NOT penalize lighting/pose/background/crop differences —
our render is a studio mannequin (pale realistic head when a head is shown), the icon's mannequin
is grey; judge the ITEM, not the mannequin.

Slot notes:
- blush = face makeup close-up: motif present, placed, correct colours/darkness.
- bodyPaint = paint/skin recolour on the body (torso+arms). Icons that are HAND close-ups our
  framing can't show → category `framing`. Body painted but head left unpainted while the icon
  paints the face too → `missing-part` (mention head).
- eyes = iris colour/pattern close-up. tattoo = ink on body; icon may be flat 2D art of the
  motif → judge presence+motif on the body; spine/back tattoos may be invisible from our front
  cam → `not-visible`.
- nailPolish = fingertip close-up; judge nail colour/design.
- earrings = right-ear close-up; icon shows the item larger; judge shape/colour/material.
- face = the render IS the equipped head item; judge the head itself vs its icon.
- facialHair = beard/moustache on the pale head: colour + shape + density.
- hair = hairstyle: colour + silhouette + strand read (not solid shards, not too sparse).
- garments/gear (headwear/eyewear/facewear/upperBody/lowerBody/outerwear/feet/hands/wrist/
  upperBack/lowerBack) = judge mesh identity, base colours, materials, prints.

Scoring: score 0-100 (100 = faithful, >=75 = pass).
category = ONE of: good | color-too-light | color-wrong | missing-print | wrong-print |
metal-grey | material-flat | wrong-mesh | missing-part | emissive-missing | artifact | framing |
not-visible | other.
issue = ONE concrete sentence (or "matches").
fixableInRepo = in-repo | blender | gated | none (decode/material/import/rig fix = in-repo;
needs mesh re-convert = blender; lighting/stripped-game-data = gated).

If a render or icon file is missing/unreadable: score -1, category other, issue "missing file".

Respond with ONLY a JSON array, no other text:
[{"id":"...","score":N,"category":"...","issue":"...","fixableInRepo":"..."}]
