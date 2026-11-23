# Bulk Light/Heavy extraction plan (draft, 22 Nov 2026)

**Need:** the definitions name about 997 Light and 996 Heavy class meshes.
- 191 are staged in S11 (18 Oct). 173 of those pass the index proofs; the 17 Nov proof is pending.
- 810 are in the June dump, which is a different build and needs the user's build-mixing sign-off.
- The union is about 928, so the rest need a fresh read.

**Fresh reads:** these need the 17 Nov usmap, or a per-package proof like `prove-nov17.py`. Mesh geometry doesn't
depend on the usmap; properties do. Extract the L/H siblings in the same runs as the S12 tier-2 session
(local_685cd100), so each package is read once.

**Per mesh, still to build:**
- Reshaped class meshes (different topology or UVs; 11 so far) need their own body-hide masks.
- Proxy-transfer meshes need class transfers.
- Offset-rule items (49 Heavy, 7 Light) need the offset semantics before they can show on a class.
- Squads need to carry the class.
