# Credits and scope

This is an unofficial fan project. It is not affiliated with, endorsed by, or
connected to Embark Studios AB.

## What belongs to whom

THE FINALS, its cosmetics, and every mesh, texture and icon depicting them are
the property of **Embark Studios AB**. Nothing in this repository grants any
right to them.

The application code here is original work. The cosmetic catalog in
`src/data/items.json` is metadata — item identifiers, display names and
equipment slots, including internal entries found in the extracted catalog.
These are game metadata of the same kind
catalogued publicly by [thefinals.wiki](https://thefinals.wiki) and
[the-finals.fandom.com](https://the-finals.fandom.com), and they are kept here
so the builder has something to build with. The artwork the catalog *points at*
is not kept here, and never has been.

Public display names and catalog matching in `src/data/wiki-catalog.json` use
[THE FINALS Wiki](https://www.thefinals.wiki/wiki/All_Cosmetics), retrieved on
12 September 2026, together with the game's localization table. Each match
records its wiki page and revision. Wiki descriptions and artwork are not
included. See `_docs/public-catalog-2026-09-12.md` for matching rules and limits.

## What is deliberately not in this repository

Extracted game assets — item icons, character and cosmetic meshes, skin and
material textures, and anything baked or rendered from them.

This is a decision, not an oversight. Git history cannot be un-published: a
commit that ships Embark's artwork stays shipped even after a later delete, and
a private repository that is made public publishes its entire history in one
act. So the raw material stays on the machine that generated it, and only the
curated layer is committed.

Almost none of the extraction technique in `scripts/` is original work here. It
was worked out in public, over months, by the people in the FModel Discord's
`#the-finals` and `#arc-raiders` threads — packed texture channel layouts, the
bone-binding and rig discoveries, decal placement maths, and the independent
`.ucas` extractor that made any of it possible.

## What the deployed site serves

The repository holds no artwork, but a deployed build points `VITE_ASSETS_BASE`
at a host that serves it, so the running site does display Embark's item icons
and meshes.

Those files were **extracted from the game's own package files** with the
community tooling described above. They did not come from thefinals.wiki, from
the Fandom wiki, or from any other third party, and no licence from those
sources applies to them — the catalog *metadata* overlaps with what those wikis
publish; the artwork does not. Saying otherwise would misdescribe both the files
and the wikis.

Keeping the artwork out of git rather than off the internet is a deliberate and
limited distinction: a host can be emptied, and git history cannot.

## Corrections and removals

If you hold rights to something reproduced here and want it changed or taken
down, that request will be honoured without argument. Open an issue.
