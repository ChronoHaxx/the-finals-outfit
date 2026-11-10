import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG, type ChangelogEntry } from "../src/data/changelog";
import { lintPublicText, parseDenylist } from "../src/lib/public-text";
import {
  fillRoadmapText, loadRoadmap, parseRoadmap, patchNoteProblems, RoadmapError, roadmapStaleness, roadmapTokenValues,
  ROADMAP_EVIDENCE,
} from "../src/lib/roadmap";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

// Six lines, so the line numbers asserted below count from line 7.
const HEAD = "# Roadmap\nLast reviewed: 2026-11-05\nReviewed after patch note: note-1\n\nIntro.\n\n";
const problems = (source: string) => {
  try { parseRoadmap(source); } catch (error) {
    assert.ok(error instanceof RoadmapError);
    return error.problems;
  }
  assert.fail("expected the roadmap to be refused");
};

test("the repository's ROADMAP.md loads as the build loads it, and every placeholder fills", () => {
  const roadmap = loadRoadmap(read("ROADMAP.md"));
  assert.equal(roadmap.reviewedAfter, CHANGELOG[0].id);
  assert.ok(roadmap.sections.find(section => section.stage === "Current focus")?.items.length);
  const values = roadmapTokenValues(3255, { untouched: 209, polish: 3036, issue: 10, accepted: 1 }, true);
  const texts = [...roadmap.intro, ...roadmap.sections.flatMap(section => section.items.flatMap(item =>
    [item.title, ...item.description, ...item.tasks, item.doneWhen ?? ""]))];
  for (const text of texts) assert.doesNotMatch(fillRoadmapText(text, values), /[{}]/, text);
});

test("the page renders ROADMAP.md and no second copy of the roadmap exists", () => {
  assert.equal(existsSync(resolve(root, "src/data/roadmap.ts")), false, "the old hand-written roadmap array is back");
  const page = read("src/pages/Roadmap.tsx");
  assert.match(page, /import \{ ROADMAP \} from "virtual:roadmap";/);
  assert.match(read("vite.config.ts"), /roadmap\(\)/, "the roadmap plugin is not registered");
  assert.match(read("README.md"), /\[ROADMAP\.md\]\(ROADMAP\.md\)/, "README should point to ROADMAP.md");
});

test("wrapped paragraphs and bullets, comments and Done when parse into one item", () => {
  const roadmap = parseRoadmap(`<!-- a maintainer note
spanning lines -->
${HEAD}## Current focus

### Rebuild {red} items
<!-- id: red-items -->
First line
continues here.

- A task
  that wraps.
- Second task.

Done when: all done.

## Done

### Shipped
<!--   id:   shipped   -->
Thing.
`);
  assert.deepEqual(roadmap, {
    reviewed: "2026-11-05", reviewedAfter: "note-1", intro: ["Intro."],
    sections: [
      { stage: "Current focus", items: [{ id: "red-items", title: "Rebuild {red} items", description: ["First line continues here."],
        tasks: ["A task that wraps.", "Second task."], doneWhen: "all done." }] },
      { stage: "Done", items: [{ id: "shipped", title: "Shipped", description: ["Thing."], tasks: [] }] },
    ],
  });
});

test("the parser refuses what the page would drop or show wrongly, naming the line", () => {
  const cases: [string, RegExp][] = [
    [`${HEAD}## Current focus\n\n### A\nText.\n\n#### Deeper\n`, /line 12: unsupported markdown/],
    [`${HEAD}## Current focus\n\n1. Numbered\n`, /line 9: unsupported markdown/],
    [`${HEAD}## Current focus\n\nLoose text.\n\n### A\nText.\n`, /line 9: text under "## Current focus" must follow/],
    [`${HEAD}## Soon\n\n### A\nText.\n`, /line 7: unknown section "Soon"/],
    [`${HEAD}## Current focus\n\n### A\nText.\n\n## Current focus\n\n### B\nText.\n`, /appears twice/],
    [`${HEAD}## Current focus\n\n### A\nThere are {reds} left.\n`, /unknown placeholder \{reds\}/],
    [`${HEAD}## Current focus\n\n### A\nOnly 209 left.\n`, /hand-typed figure "209"/],
    [`${HEAD}## Current focus\n\n### A\nWe have 3,036 blue.\n`, /hand-typed figure "3,036"/],
    [`${HEAD}## Current focus\n\n### A\nNow at 92.4% blue.\n`, /hand-typed figure "92.4%"/],
    [`${HEAD}## Current focus\n\n### A\nSee **this** [link](x).\n`, /plain text only/],
    [`${HEAD}## Current focus\n\n### A\nText.\n- Bullet\nnot indented.\n`, /line 12: indent a bullet's continuation/],
    [`${HEAD}## Current focus\n\n### A\nText.\n\nDone when: one.\n\nDone when: two.\n`, /already has a "Done when:"/],
    [`${HEAD}## Current focus\n\n### A\n- Only a task.\n`, /item "A" needs a description/],
    [`${HEAD}## Current focus\n\n### A\nText.\n\n## Next\n`, /section "Next" has no items/],
    [`${HEAD}## Next\n\n### A\nText.\n`, /missing the "## Current focus" section/],
    [`# Roadmap\n\n## Current focus\n\n### A\nText.\n`, /missing "Last reviewed/],
    [`# Roadmap\n\n## Current focus\n\n### A\nText.\n`, /missing "Reviewed after patch note: <id of the newest patch note/],
    [`# Roadmap\n\nLast reviewed: 5 Nov 2026\n\n## Current focus\n\n### A\nText.\n`, /needs an ISO date/],
    [`${HEAD}## Current focus\n\nReviewed after patch note: note-2\n\n### A\nText.\n`, /line 9: "Reviewed after patch note:" must appear once, before the first section/],
    [`# Roadmap\nLast reviewed: 2026-11-05\nReviewed after patch note: Seasons 11 and 12\n\n## Current focus\n\n### A\nText.\n`, /line 3: "Reviewed after patch note:" needs the id/],
    [`${HEAD}## Current focus\n\n### A\nText. <!-- never closed\n`, /never closed/],
  ];
  for (const [source, expected] of cases) assert.match(problems(source).join("\n"), expected, source);
  // Every problem is reported at once, not only the first.
  assert.equal(problems(`${HEAD}## Current focus\n\n### A\n<!-- id: a -->\nOnly 209 and {x}.\n`).length, 2);
});

test("every item carries a stable id directly under its title", () => {
  const ids = loadRoadmap(read("ROADMAP.md")).sections.flatMap(section => section.items.map(item => item.id));
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, "ROADMAP.md ids are unique");
  const cases: [string, RegExp][] = [
    [`${HEAD}## Current focus\n\n### A\nText.\n`, /line 9: item "A" needs an "<!-- id: \.\.\. -->" line directly under its title/],
    [`${HEAD}## Current focus\n\n### A\n<!-- id: Not_Kebab -->\nText.\n`, /line 10: id "Not_Kebab" must be kebab-case/],
    [`${HEAD}## Current focus\n\n### A\n\n<!-- id: a -->\nText.\n`, /line 11: an "<!-- id: \.\.\. -->" line must come directly under its "### " item title/],
    [`${HEAD}<!-- id: early -->\n## Current focus\n\n### A\n<!-- id: a -->\nText.\n`, /line 7: an "<!-- id: \.\.\. -->" line must come directly under/],
    [`${HEAD}## Current focus\n\n### A\n<!-- id: same -->\nText.\n\n### B\n<!-- id: same -->\nText.\n`, /line 14: id "same" is already used by "A"/],
  ];
  for (const [source, expected] of cases) assert.match(problems(source).join("\n"), expected, source);
});

test("public-text rules catch the usual leaks and pass player-facing text", () => {
  const leaks: [string, RegExp][] = [
    ["Fixed in 0842b45.", /commit hash/],
    ["See src/lib/roadmap.ts for details.", /file path/],
    ["Merged from claude/stoic-ramanujan.", /branch name/],
    ["Shipped in PR #23.", /pull request or issue number/],
    ["The MI_Jacket_01 material now draws.", /game asset name/],
    ["ShadeAsCloth now feeds the sheen.", /shader internal/],
    ["Rebuilt with FModel.", /how game data is read/],
    ["Meshes were extracted again.", /how game data is read/],
    ["Nothing is injected into the game.", /running game/],
    ["Moved to Cloudflare.", /internal work/],
    ["A new admin page.", /internal work/],
    ["The 3D export is faster.", /internal work/],
    ["Codex reviewed it.", /tooling behind the project/],
    ["Done in w152.", /internal batch name/],
  ];
  for (const [text, why] of leaks) assert.match(lintPublicText(text, "t").join("\n"), why, text);
  const roadmap = loadRoadmap(read("ROADMAP.md"));
  const plain = [
    ...roadmap.intro, ...roadmap.sections.flatMap(section => section.items.flatMap(item => [item.title, ...item.description, ...item.tasks])),
    "The Dumpling Headwear and the Vapor Wave Glasses render in 3D.",
    "3,091 of the catalog's 3,332 cosmetics now have a first-pass 3D reconstruction.",
  ];
  for (const text of plain) assert.deepEqual(lintPublicText(text, "t"), [], text);
});

test("patch notes link to roadmap items by id and are checked as public text", () => {
  const source = `${HEAD}## Current focus\n\n### A\n<!-- id: a -->\nText.\n`;
  const evidence = [{ id: "note-1", label: "patch note one", date: "2026-11-05" }];
  const note = (extra: Partial<ChangelogEntry>): ChangelogEntry =>
    ({ id: "note-1", date: "2026-11-05", title: "Update", notes: ["3,091 of 3,332 cosmetics now render in 3D."], ...extra });
  // Dated figures are fine in a patch note, unlike in ROADMAP.md.
  assert.equal(loadRoadmap(source, evidence, { changelog: [note({ items: ["a"] })] }).sections[0].items[0].id, "a");
  assert.throws(() => loadRoadmap(source, evidence, { changelog: [note({ items: ["missing"] })] }),
    /patch note "note-1" \(src\/data\/changelog\.ts\): items names "missing", which is not an id in ROADMAP\.md/);
  assert.throws(() => loadRoadmap(source, evidence, { changelog: [note({ notes: ["Fine.", "Built in w152."] })] }),
    /patch note "note-1" \(src\/data\/changelog\.ts\) note 2: public text uses an internal batch name/);
  assert.throws(() => loadRoadmap(source, evidence, { changelog: [note({ title: "Rebuilt with FModel" })] }), /title: public text describes how game data is read/);
  // Every shipped patch note passes, and links only to ids that exist.
  assert.deepEqual(patchNoteProblems(CHANGELOG, loadRoadmap(read("ROADMAP.md"))), []);
});

test("private denylist terms are caught by whole words, and never printed", () => {
  const terms = parseDenylist("Secret Project\nsomeone-real, ,");
  assert.deepEqual(terms, ["secret project", "someone real"]);
  const found = lintPublicText("Thanks to Someone Real for the SECRET-project idea.", "line 3", terms);
  assert.equal(found.length, 2);
  assert.match(found[0], /^line 3: public text matches private denylist term 1;/);
  assert.match(found[1], /private denylist term 2;/);
  for (const problem of found) assert.doesNotMatch(problem, /secret|someone/i);
  assert.deepEqual(lintPublicText("A secretive project by someone really good.", "t", terms), []);
  assert.throws(() => parseRoadmap(`${HEAD}## Current focus\n\n### A\n<!-- id: a -->\nA secret project.\n`, { privateTerms: terms }),
    /line 11: public text matches private denylist term 1/);
  // The build reads the list from a plain environment variable: a VITE_ prefix would put it in the app bundle.
  assert.match(read("vite.config.ts"), /parseDenylist\(process\.env\.PUBLIC_TEXT_DENYLIST\)/);
  assert.match(read(".github/workflows/deploy.yml"), /^\s+PUBLIC_TEXT_DENYLIST: \$\{\{ secrets\.PUBLIC_TEXT_DENYLIST \}\}$/m);
  assert.doesNotMatch(read(".github/workflows/deploy.yml") + read("vite.config.ts"), /VITE_PUBLIC_TEXT_DENYLIST/);
});

test("the roadmap is stale once a patch note or catalog update is newer than its review", () => {
  const evidence = [{ id: "note-1", label: "patch note one", date: "2026-11-06" },
    { label: "catalog update", date: "2026-11-05" }];
  assert.deepEqual(roadmapStaleness({ reviewed: "2026-11-06", reviewedAfter: "note-1" }, evidence), []);
  // The id matches but the date was not moved.
  const stale = roadmapStaleness({ reviewed: "2026-11-05", reviewedAfter: "note-1" }, evidence);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /older than the patch note one it names, dated 2026-11-06/);
  // A catalog update has no id, so its date decides.
  assert.match(roadmapStaleness({ reviewed: "2026-11-04", reviewedAfter: "note-1" },
    [{ id: "note-1", label: "patch note one", date: "2026-11-04" }, { label: "catalog update", date: "2026-11-05" }]).join("\n"),
  /older than the catalog update, dated 2026-11-05/);
  assert.throws(() => loadRoadmap(`${HEAD}## Current focus\n\n### A\nText.\n`, evidence), RoadmapError);
  // The build checks against every shipped patch note, newest first and by id.
  assert.deepEqual(ROADMAP_EVIDENCE.find(entry => entry.id), {
    id: CHANGELOG[0].id, date: CHANGELOG[0].date, label: `patch note "${CHANGELOG[0].title}" (src/data/changelog.ts)` });
});

test("a second patch note on the day of the review still makes the roadmap stale", () => {
  // 6 Nov 2026: the roadmap was reviewed that morning, then a release added a patch note dated the same day.
  const evidence = [{ id: "2026-11-06-later", label: 'patch note "Later"', date: "2026-11-06" },
    { id: "2026-11-06-earlier", label: 'patch note "Earlier"', date: "2026-11-06" },
    { label: "catalog update", date: "2026-11-06" }];
  const stale = roadmapStaleness({ reviewed: "2026-11-06", reviewedAfter: "2026-11-06-earlier" }, evidence);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /reviewed after patch note "2026-11-06-earlier", but a newer patch note "Later" has been added since, id "2026-11-06-later"/);
  assert.deepEqual(roadmapStaleness({ reviewed: "2026-11-06", reviewedAfter: "2026-11-06-later" }, evidence), []);
  // An id that is not a patch note at all (a typo, or a note from another branch) is refused too.
  assert.match(roadmapStaleness({ reviewed: "2026-11-06", reviewedAfter: "2026-11-07-elsewhere" }, evidence)[0],
    /names no patch note in src\/data\/changelog\.ts; the newest is "2026-11-06-later"/);
});

test("live placeholders wait for the status index, while the catalog size is always known", () => {
  const counts = { untouched: 209, polish: 3036, issue: 10, accepted: 1 };
  const loading = roadmapTokenValues(3255, counts, false, 12);
  assert.equal(fillRoadmapText("{red} of {total}, Season {latestSeason}", loading), `… of ${(3255).toLocaleString()}, Season 12`);
  const ready = roadmapTokenValues(3255, counts, true, 12);
  assert.equal(fillRoadmapText("{blue} blue, {red} red, {purple} purple, {green} green", ready),
    `${(3036).toLocaleString()} blue, 209 red, 10 purple, 1 green`);
});
