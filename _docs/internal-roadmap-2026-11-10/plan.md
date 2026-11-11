# Public and internal roadmap

10 Nov 2026. **Status:** steps 1 and 2 below are built and tested. Nothing is committed or deployed.
Every deploy, Access setup and Cloudflare or GitHub account change is the owner's decision.

The pattern comes from a reference board the owner had built earlier the same day for another project:

- one data source feeds a public page and an internal board;
- a lint refuses public text that leaks;
- the internal board is its own Worker behind Cloudflare Access, checks the Access token itself, and
  answers 503 "Locked" until Access is configured.

**This repository is public.** Anything committed here, including this file, can be read by anyone
until the repo goes private. The reference keeps public and internal items in one file because its
repo is local-only. That cannot work here: the internal board's content has to live outside this repo
for now. For the same reason this file names no internal plans and no private terms.

## 1. How ROADMAP.md maps onto public and internal items (built)

ROADMAP.md stays the only source of public roadmap text. Its strict parser (`src/lib/roadmap.ts`) and
build checks (the `roadmap` plugin in `vite.config.ts`) now also do the following:

- **Stable ids.** Every `###` item has a comment line directly under its title holding `id: kebab-id`.
  GitHub and the page both hide it. The parser reads it before blanking the other comments. A missing,
  malformed, misplaced or duplicate id fails the build. Ids are never changed or reused.
  - Trap: a maintainer comment must not contain a literal `-->`, which ends the comment early.
- **Patch notes link to items.** `ChangelogEntry.items` (optional) lists the ids a patch note advanced.
  An id that ROADMAP.md does not contain fails the build.
- **Public-text lint** on ROADMAP.md and the patch notes (section 4).

The internal side keys everything off those ids:

| ROADMAP.md section | Board stages allowed | Default |
|---|---|---|
| Current focus | `active`, `review` | `active` |
| Next | `next` | `next` |
| Waiting on a decision | `unapproved` | `unapproved` |
| Later | `open`, `parked` | `open` |
| Done | `done` | `done` |
| never public | every stage, including `dropped` | |

The internal file adds two things:

- **Annotations** on public items, keyed by id: stage within the section, area, updated, where, next,
  waiting on, notes and refs.
- **Internal-only items**, which may not reuse a public id.

Moving an item between public sections happens in ROADMAP.md; the board refuses a stage that does
not fit the section.

**Later, once the repo is private:** the two could fold into one file with `public` fields, as in the
reference. Decide then. Two files keep one useful property: the public file can be read on its own and
checked for leaks.

## 2. Where the internal board and its Worker live (built locally)

The board is a separate local repository, `E:\Coding\finals-outfit-internal`, with no remote.

- It reads ROADMAP.md, the patch notes and the lint rules **through this repo's own modules**, loaded
  with this repo's installed `tsx`. There is one parser, and the board cannot disagree with the build.
- The build fails if internal wording (12 characters or more) appears in ROADMAP.md or a patch note.
- It runs on localhost (`npm run dev`), so it is useful with no deploy at all.
- Its gate Worker is the reference's, unchanged in behaviour:
  - no static assets;
  - fails closed (503) while the Access team domain or AUD is empty;
  - verifies the Access JWT (RS256 signature, `aud`, `iss`, `exp`, `nbf`) on every request;
  - `private, no-store`, `noindex`, a CSP that blocks every outside request, GET/HEAD on `/` only.
- The Worker name is a placeholder until the owner picks one. The admin pages are meant to join the same
  Worker later, so there is one Access application and one AUD tag.

Cloudflare's current docs recommend the `Cf-Access-Jwt-Assertion` header over the `CF_Authorization`
cookie. The gate checks the header first and falls back to the cookie.

## 3. Steps, and what waits for the Cloudflare migration

| Step | Depends on the migration? | State |
|---|---|---|
| 1. Public side: ids, patch-note links, the lint | No | Built, uncommitted. Ships through a normal PR |
| 2. Internal board on localhost, with its gate and tests | No | Built, local repo, uncommitted |
| 3. Deploy the board behind Access | Not technically: its own `workers.dev` host, no site bindings | Owner's decision |
| 4. Admin pages (analytics, report inbox, moderation, health) | Yes: they bind the site Worker's storage and analytics, which exist only after the move | Later |
| 5. Merge the two sources into one file in this repo | Yes: the repo can only go private once the app has left GitHub Pages | Later |

For step 3, from Cloudflare's docs (checked 10 Nov 2026):

- Turn Access on for **that Worker only**. The account-wide "protect all Workers" option would also put
  the public link-preview Worker behind a login, and share previews would stop working.
- A Cloudflare account has one Zero Trust team name. It shows in every Access login URL and is shared by
  every board on the account, so it should be neutral.

## 4. Leak rules (built)

Public text means ROADMAP.md outside comments, plus the patch-note titles and notes. The build fails
when public text contains any of these (`src/lib/public-text.ts`):

1. a commit hash, a file path or extension, a branch name, or a PR or issue number;
2. a game asset name (`M_`, `MI_`, `T_`, `SK_` … prefixes) or a shader internal;
3. game-data tooling or method ("extract", "rip", "dump", "decompile" and the like);
4. touching the running game (inject, anti-cheat);
5. internal work the owner ruled off the public roadmap on 6 Nov: hosting, asset protection, admin,
   analytics dashboards and developer-only tools;
6. the tooling behind the project;
7. internal batch names (`w152`, "wave 116", "census").

The figure rule (no hand-typed counts) still applies to ROADMAP.md only. Patch notes keep their dated
figures. Today's ROADMAP.md and patch notes pass, and ordinary cosmetic names such as "Dumpling" and
"Vapor Wave" are not flagged.

**The rules file is public, so it holds only generic patterns and words already in this repo.** Anything
that must not be published even as a rule, such as people, accounts, domains, other projects,
codenames or unannounced plans, goes in a **private denylist**:

- The build reads it from the `PUBLIC_TEXT_DENYLIST` environment variable. In CI that is a repository
  secret the owner adds; it is unset locally.
- The internal board reads its own gitignored copy, so the private terms are checked whenever the board
  builds, even before the secret exists.
- A match is reported by number ("private denylist term 2"), never by the term, because CI logs on a
  public repo are public. The variable has no `VITE_` prefix, so it never reaches the app bundle. Tests
  pin both.
- **Correction to the first draft of this plan:** it proposed storing the terms as hashes in this repo.
  That would have been an oracle: anyone with a guess at a name could hash it and confirm it.

Rules for the internal side:

- The internal file and the plain denylist never sit in this repo. The app build never imports them.
- The board carries no secrets, and no game data (no renders, textures or screenshots).
- The lint is a guard, not a reviewer. Whether wording reads as written for players stays a judgement.

## 5. Verification (10 Nov 2026)

**This repo** (worktree `heuristic-darwin-d076c9`):

- `tests/roadmap.test.ts`: 11 pass. The new tests cover ids, one leak per rule, plain text that must
  pass, patch-note links and lint, and the private denylist (caught by whole words, never printed).
- Full `npm test`: 747 pass, 8 fail, 5 skipped. The 8 need extracted game files that this worktree does
  not have (`SK_Body_M.glb`, a ski-blade fixture). None touches the roadmap.
- `npm run typecheck` and `npm run build` pass. The lint rules are tree-shaken out of the app bundle; the
  item ids ship.
- A build with a test denylist containing a phrase from ROADMAP.md fails on its line, as "private
  denylist term 2", without printing the phrase.

**The internal board:**

- 16 tests pass: the 8 ported gate tests and 8 board tests.
- Its build runs clean against this worktree with the private list applied.
- Viewed on localhost at desktop and phone width (no sideways scroll); search works.
- The real Worker under `wrangler dev`, with nothing sent to Cloudflare:
  - on localhost with the bypass, it serves the page with the expected headers;
  - under any other hostname, it answers `503 Locked`;
  - any other path gets 404.

Not verified: anything on Cloudflare (nothing is deployed), and CI with the secret set.

PowerShell, from `E:\Coding\the-finals-outfit` (once this branch is checked out there):

```powershell
npm test
```

```powershell
npm run build
```
