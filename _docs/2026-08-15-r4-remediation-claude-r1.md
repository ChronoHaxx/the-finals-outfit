# Fidelity review — `84aaedb..343915c`

**Reviewer: Claude, who wrote the brief.** This is a fidelity check — does the
diff do what `2026-08-15-r4-remediation.md` asked — and a bounded check for
adjacent disturbance. **It is not an independent audit of the brief's intent**,
and cannot be: I cannot review my own brief and call the result independent.
`AGENTS.md` Gate 2 wants both parties on a Medium fix; this round had one, by the
human's call. Recorded here so the gap is visible rather than assumed away.

Scope: `66c2738..343915c`, two commits. Nothing else on the branch was read.

## Verification performed by me

Not taken from Codex's report — re-run here.

- `npm test`: **45/45 pass** (43 before, +2 new).
- **Falsification of the regression test.** Reverted `src/rig/CharacterRig.ts` to
  `66c2738`, re-ran `npm test`: the new test fails with an `AssertionError`
  (44 pass / 1 fail); restored, clean. The test genuinely fails against the bug.
  DONE WHEN 1 is met in the strong sense, not the "it passes" sense.
- `npm run typecheck`: passes.
- `npm run build`: passes, 2m51s. Pre-existing large-chunk warning only.
- Scan determinism: two consecutive runs are byte-identical. DONE WHEN 5 met.
- `git status`: no artwork tracked or modified; `scripts/discord-export/` still
  untracked and unmodified.
- **Nothing pushed.** Branch is `[ahead 10]` of `origin/codex/material-root-cause`
  and `git branch -r --contains 84aaedb` returns empty.
- The "no current catalog icon exists" claims: **true.** No
  `medieval-elf-skirt-belt` or `traditional-lunar-bolero-short-sleeve` icon
  exists under `public/items/` (the `bolero` hits are `mexico-bolerohat`, an
  unrelated item).

## Goal 1 — inspector isolation: closed

`setMeshSide` (`src/rig/CharacterRig.ts:1314`) now copies a material only when
`isMaterialSharedOutsideMesh` finds another mesh pointing at it, and mutates in
place otherwise. I traced the state machine across repeated toggles and the
multi-sharer case: with three meshes sharing one material, the first two toggles
clone and the third correctly mutates in place because no other mesh still
references the source. `overrides.has(source)` prevents a second copy per mesh.

The texture cloning in `cloneMaterialForInspector` is **justified, and I checked
why.** `disposeMaterial` (`src/rig/dispose.ts:17-27`) disposes every texture on a
material and in its `userData`. A clone sharing texture objects with its source
would, on `unequip`, tear down textures still live on a sibling in another scene.
The `userData` re-copy is also load-bearing: three's `Material.copy()` JSON
round-trips `userData`, which would destroy the `ColorMask` texture reference the
tint path stashes there.

Cost, accepted not overlooked: `Texture.clone()` gets its own GPU upload, so a
toggle on a shared material duplicates its textures in VRAM. Dev-gated, one mesh
at a time — fine.

Lifecycle is coherent: `forgetInspectorOverrides` runs on both `unequip` and
`dispose`, clones stay attached to their mesh so `disposeObject3D` releases them,
and the test asserts the clone's `dispose` event actually fires.

Nice touch not asked for: the first test asserts the **fixture premise** — that
`attachments-ski-blade.glb` really does reuse one material across two nodes — so
the regression can't quietly stop testing what it claims to test.

## Finding — Medium: the review ledger cannot go stale

`scripts/scan-white-patches.mjs:29-52, 76-78`.

`REVIEW_RULES` maps a **path prefix** to a verdict, and `reviewFor` resolves it
with `path.startsWith(prefix)`. Nothing binds a verdict to the content it
reviewed. So the summary line

```
Icon review: 40/40 flagged items are confirmed legitimate ...
```

is a count of hardcoded strings, not a measurement. If a future bake genuinely
breaks `casual-tall-sneakers.canvas`, its path still matches its prefix and the
scan still prints `legitimate` — the report certifies the regression as fine.
The measurement half is honest and deterministic; the judgement half never
re-derives.

**This repo already solved this, two days ago, and the fix is one directory
away.** `scripts/lib/verification/queue.mjs` binds every mark to
`inputHash(item, aspect, root)` and derives `stale` the moment the hash moves.
Its opening comment states the principle outright: *"The queue is DERIVED, never
maintained — which is what stops it rotting the way a hand-kept list does."*
`scan-white-patches.mjs` is a hand-kept list.

Fix: key each verdict by the albedo's content hash (or record its near-white %
at review time and re-flag on material movement) so changed content falls back
to the `unreviewed` branch that already exists at `:125`.

## Finding — Low: four verdicts rest on absence of evidence

Four flagged files are annotated `legitimate` with the note *"no current catalog
icon exists for this legacy asset"*:

- `medieval-elf-skirt-belt.leather.albedo.webp` and `.leather_black`
- `traditional-lunar-bolero-short-sleeve.dark.albedo.webp` and `.pastelgreen`

I confirmed no such icons exist. That makes these items **unverifiable**, not
confirmed — the brief asked for "confirmed legitimately white *against its icon*,
or named as still broken", and "no icon" is neither. The summary should read
**36/40 confirmed against icons, 4 unverifiable**, which is also the more useful
number: it names what a human still owes a decision on.

The project has a word for this state already — `needs-human` — and the
verification matrix keeps exactly this class of judgement in a standing section
rather than folding it into a pass count.

## Notes, not findings

- **Test runner changed:** `package.json` `test` went `node --test` →
  `tsx --test`, needed for the first `.ts` test file. `tsx` is a declared
  devDependency (`^4.19.2`) and all 45 tests pass, so this is safe — but it
  changes how the verification-matrix tests reviewed clean in r3 now execute,
  and it wasn't in the brief's scope. Flagged so it's a decision, not drift.
- **34 vs 40 unreconciled:** `_docs/2026-08-14-white-patches.md` reports 34
  flagged after the re-bake; today's scan reports 40 of 2,474, and r4 spoke of
  1,968 albedos. Different globs and thresholds, presumably — but nothing says
  so, and the older doc now silently contradicts the newer one.
- **Provenance handled well.** The output states plainly that the ignored
  outputs "cannot be attributed to a particular commit range without bake
  metadata." That is DONE WHEN 7 answered honestly rather than papered over, and
  it is the right call.
- **Outside this diff:** `git remote -v` still lists `old-origin` pointing at
  `Muhammad-Hazimi-Yusri/the-finals-outfit` — the real-surname repo the project
  note records as deleted. A stray push there would fail, but it is a loaded
  gun in the config of a project that has already paid once for this.

## Verdict

**Goal 1 is closed and well built.** Goal 2's measurement is closed; its
judgement layer reintroduces a defect pattern this repo has already rejected in
writing.

`66c2738..343915c` — **not safe to push** until the Medium is closed. The Low
should ride along with it; it is one summary line and four annotations.

Both findings are in the new file only. Neither touches the inspector fix, so
Goal 1 does not need re-review after they are fixed.
