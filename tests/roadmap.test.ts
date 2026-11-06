import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG } from "../src/data/changelog";
import {
  fillRoadmapText, loadRoadmap, parseRoadmap, RoadmapError, roadmapStaleness, roadmapTokenValues, ROADMAP_EVIDENCE,
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
First line
continues here.

- A task
  that wraps.
- Second task.

Done when: all done.

## Done

### Shipped
Thing.
`);
  assert.deepEqual(roadmap, {
    reviewed: "2026-11-05", reviewedAfter: "note-1", intro: ["Intro."],
    sections: [
      { stage: "Current focus", items: [{ title: "Rebuild {red} items", description: ["First line continues here."],
        tasks: ["A task that wraps.", "Second task."], doneWhen: "all done." }] },
      { stage: "Done", items: [{ title: "Shipped", description: ["Thing."], tasks: [] }] },
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
  assert.equal(problems(`${HEAD}## Current focus\n\n### A\nOnly 209 and {x}.\n`).length, 2);
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
