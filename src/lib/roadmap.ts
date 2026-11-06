import { CATALOG_UPDATE } from "../data/catalog-update";
import { CHANGELOG } from "../data/changelog";

// ROADMAP.md at the repository root is the roadmap's only source. The `roadmap` plugin in
// vite.config.ts parses and checks it with this module at build time and hands the page the
// result, so the page cannot drift from the file, and a malformed or stale file fails the build.
// The parser is deliberately strict: any line it does not understand is an error, never dropped.

export const ROADMAP_STAGES = ["Current focus", "Next", "Waiting on a decision", "Later", "Done"] as const;
export type RoadmapStage = (typeof ROADMAP_STAGES)[number];

// Live figures the page fills in, so the file never carries a hand-typed count.
export const ROADMAP_TOKENS = ["total", "blue", "red", "purple", "green", "latestSeason"] as const;
export type RoadmapToken = (typeof ROADMAP_TOKENS)[number];

export interface RoadmapItem {
  title: string;
  description: readonly string[];
  tasks: readonly string[];
  doneWhen?: string;
}
export interface RoadmapSection { stage: RoadmapStage; items: readonly RoadmapItem[] }
export interface Roadmap {
  /** ISO date of the last full read-through of the file. */
  reviewed: string;
  /** Id of the newest patch note (src/data/changelog.ts) at that read-through. A date alone cannot tell
   *  whether a patch note from the same day was written before or after the review. */
  reviewedAfter: string;
  intro: readonly string[];
  sections: readonly RoadmapSection[];
}

export class RoadmapError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`ROADMAP.md is not valid:\n${problems.map(problem => `  - ${problem}`).join("\n")}`);
    this.name = "RoadmapError";
  }
}

const DONE_WHEN = "Done when: ";
const LAST_REVIEWED = "Last reviewed:";
const REVIEWED_AFTER = "Reviewed after patch note:";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Bold, italics, code, links and HTML would reach the page as raw characters.
const INLINE_MARKUP = /\*|__|`|\]\(|<[a-z/!]/i;
// A count or percentage typed by hand goes stale with the next release: 209, 3,036, 92.4%.
const HAND_TYPED_FIGURE = /\d[\d,.]*\s*%|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/;

function checkText(text: string, line: number, problems: string[]) {
  const at = `line ${line}`;
  if (INLINE_MARKUP.test(text)) problems.push(`${at}: plain text only; the page does not render bold, code, links or HTML`);
  for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(ROADMAP_TOKENS as readonly string[]).includes(name))
      problems.push(`${at}: unknown placeholder {${name}}; use one of ${ROADMAP_TOKENS.map(token => `{${token}}`).join(", ")}`);
  }
  const prose = text.replace(/\{[^{}]*\}/g, "");
  if (/[{}]/.test(prose)) problems.push(`${at}: unmatched brace`);
  const figure = prose.match(HAND_TYPED_FIGURE);
  if (figure) problems.push(`${at}: hand-typed figure "${figure[0]}"; use a placeholder such as {red} so the page shows the live count`);
}

/** Parses ROADMAP.md. Throws a RoadmapError listing every problem, with line numbers. */
export function parseRoadmap(source: string): Roadmap {
  const problems: string[] = [];
  // Blank out HTML comments (maintainer notes) while keeping the line numbering.
  const text = source.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ""));
  if (text.includes("<!--")) problems.push("an HTML comment is never closed");
  const lines = text.split("\n");

  let title = false;
  let reviewed = "";
  let reviewedAfter = "";
  const intro: string[] = [];
  type DraftItem = { title: string; line: number; description: string[]; tasks: string[]; doneWhen?: string };
  const sections: { stage: RoadmapStage; line: number; items: DraftItem[] }[] = [];
  let paragraph: { text: string; line: number } | null = null;
  let bullet: { text: string; line: number } | null = null;
  const section = () => sections.at(-1);
  const item = () => section()?.items.at(-1);

  const flush = () => {
    if (paragraph) {
      const { text, line } = paragraph;
      checkText(text, line, problems);
      const current = item();
      if (current) {
        if (!text.startsWith(DONE_WHEN)) current.description.push(text);
        else if (current.doneWhen) problems.push(`line ${line}: "${current.title}" already has a "${DONE_WHEN.trim()}" line`);
        else current.doneWhen = text.slice(DONE_WHEN.length);
      } else if (section()) problems.push(`line ${line}: text under "## ${section()!.stage}" must follow a "### " item title`);
      else intro.push(text);
    }
    if (bullet) {
      checkText(bullet.text, bullet.line, problems);
      const current = item();
      if (current) current.tasks.push(bullet.text);
      else problems.push(`line ${bullet.line}: a "- " bullet must belong to a "### " item`);
    }
    paragraph = bullet = null;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trimEnd();
    if (!content.trim()) return flush();
    if (bullet && /^ {2,}\S/.test(content)) { bullet.text += ` ${content.trim()}`; return; }
    if (/^#{1,3} /.test(content) || content.startsWith("- ") || content.startsWith(LAST_REVIEWED)
      || content.startsWith(REVIEWED_AFTER)) flush();

    if (content.startsWith("# ")) {
      if (title || reviewed || reviewedAfter || intro.length || sections.length) problems.push(`line ${line}: "# " title must come first, once`);
      else if (content !== "# Roadmap") problems.push(`line ${line}: the title must be "# Roadmap"`);
      title = true;
    } else if (content.startsWith(LAST_REVIEWED)) {
      const date = content.slice(LAST_REVIEWED.length).trim();
      if (reviewed || sections.length) problems.push(`line ${line}: "${LAST_REVIEWED}" must appear once, before the first section`);
      else if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) problems.push(`line ${line}: "${LAST_REVIEWED}" needs an ISO date such as 2026-11-05`);
      else reviewed = date;
    } else if (content.startsWith(REVIEWED_AFTER)) {
      const id = content.slice(REVIEWED_AFTER.length).trim();
      if (reviewedAfter || sections.length) problems.push(`line ${line}: "${REVIEWED_AFTER}" must appear once, before the first section`);
      else if (!/^\S+$/.test(id)) problems.push(`line ${line}: "${REVIEWED_AFTER}" needs the id of the newest patch note in src/data/changelog.ts, such as 2026-11-05-seasons-11-12`);
      else reviewedAfter = id;
    } else if (content.startsWith("## ")) {
      const stage = content.slice(3).trim() as RoadmapStage;
      if (!ROADMAP_STAGES.includes(stage)) problems.push(`line ${line}: unknown section "${stage}"; use one of ${ROADMAP_STAGES.join(", ")}`);
      else if (sections.some(existing => existing.stage === stage)) problems.push(`line ${line}: section "${stage}" appears twice`);
      else sections.push({ stage, line, items: [] });
    } else if (content.startsWith("### ")) {
      const itemTitle = content.slice(4).trim();
      checkText(itemTitle, line, problems);
      if (!section()) problems.push(`line ${line}: item "${itemTitle}" must be inside a "## " section`);
      else if (section()!.items.some(existing => existing.title === itemTitle)) problems.push(`line ${line}: item "${itemTitle}" appears twice in "${section()!.stage}"`);
      else section()!.items.push({ title: itemTitle, line, description: [], tasks: [] });
    } else if (content.startsWith("- ")) {
      bullet = { text: content.slice(2).trim(), line };
    } else if (/^(#|\s|[*+>|]|\d+[.)]\s)/.test(content)) {
      problems.push(`line ${line}: unsupported markdown "${content.trim().slice(0, 40)}"; use "## ", "### ", "- " bullets or plain paragraphs`);
    } else if (bullet) {
      problems.push(`line ${line}: indent a bullet's continuation by two spaces, or leave a blank line after the bullet`);
    } else if (paragraph) {
      paragraph.text += ` ${content.trim()}`;
    } else {
      paragraph = { text: content.trim(), line };
    }
  });
  flush();

  if (!title) problems.push('missing the "# Roadmap" title');
  if (!reviewed) problems.push(`missing "${LAST_REVIEWED} YYYY-MM-DD"`);
  if (!reviewedAfter) problems.push(`missing "${REVIEWED_AFTER} <id of the newest patch note in src/data/changelog.ts>"`);
  if (!sections.some(existing => existing.stage === "Current focus")) problems.push('missing the "## Current focus" section');
  for (const { stage, line, items } of sections) {
    if (!items.length) problems.push(`line ${line}: section "${stage}" has no items`);
    for (const entry of items) if (!entry.description.length) problems.push(`line ${entry.line}: item "${entry.title}" needs a description paragraph`);
  }
  if (problems.length) throw new RoadmapError(problems);
  return {
    reviewed, reviewedAfter, intro,
    sections: sections.map(({ stage, items }) => ({ stage, items: items.map(({ title, description, tasks, doneWhen }) =>
      ({ title, description, tasks, ...(doneWhen ? { doneWhen } : {}) })) })),
  };
}

/** A shipped change the roadmap may have gone stale against. Patch notes carry their id; the first entry
 *  with an id is the newest patch note, as in src/data/changelog.ts. */
export interface RoadmapEvidence { label: string; date: string; id?: string }

// Things that ship without touching the roadmap. Each one is a moment the roadmap may have gone stale.
export const ROADMAP_EVIDENCE: readonly RoadmapEvidence[] = [
  ...CHANGELOG.map(entry => ({ id: entry.id, label: `patch note "${entry.title}" (src/data/changelog.ts)`, date: entry.date })),
  { label: "catalog update (src/data/catalog-update.ts)", date: CATALOG_UPDATE.updatedAt },
];

/** Problems for every shipped change the roadmap's last review did not see. Patch notes are matched by id,
 *  so a second patch note on the day of the review still counts. The catalog update has no id, so it is
 *  matched by date. */
export function roadmapStaleness({ reviewed, reviewedAfter }: Pick<Roadmap, "reviewed" | "reviewedAfter">,
  evidence: readonly RoadmapEvidence[] = ROADMAP_EVIDENCE): string[] {
  const redo = `Re-read ROADMAP.md, update what changed, then set "${REVIEWED_AFTER}" to the newest patch note's id and "${LAST_REVIEWED}" to today.`;
  const problems: string[] = [];
  const notes = evidence.filter(entry => entry.id);
  const newest = notes[0];
  const named = notes.find(entry => entry.id === reviewedAfter);
  if (newest && !named) {
    problems.push(`"${REVIEWED_AFTER} ${reviewedAfter}" names no patch note in src/data/changelog.ts; the newest is "${newest.id}".`);
  } else if (newest && named !== newest) {
    problems.push(`ROADMAP.md was reviewed after patch note "${reviewedAfter}", but a newer ${newest.label} has been added since, id "${newest.id}". ${redo}`);
  } else if (named && named.date > reviewed) {
    problems.push(`"${LAST_REVIEWED} ${reviewed}" is older than the ${named.label} it names, dated ${named.date}. ${redo}`);
  }
  for (const { id, label, date } of evidence) {
    if (!id && date > reviewed) problems.push(`"${LAST_REVIEWED} ${reviewed}" is older than the ${label}, dated ${date}. ${redo}`);
  }
  return problems;
}

/** Parse and check freshness: what the build runs. */
export function loadRoadmap(source: string, evidence: readonly RoadmapEvidence[] = ROADMAP_EVIDENCE): Roadmap {
  const roadmap = parseRoadmap(source);
  const stale = roadmapStaleness(roadmap, evidence);
  if (stale.length) throw new RoadmapError(stale);
  return roadmap;
}

type StatusCounts = { untouched: number; polish: number; issue: number; accepted: number };

/** Placeholder values from the same status summary as the progress panel. Status counts show an
 *  ellipsis until the reconstruction index has loaded, as they are incomplete before then. */
export function roadmapTokenValues(total: number, counts: StatusCounts, ready: boolean,
  latestSeason: number = CATALOG_UPDATE.throughSeason): Record<RoadmapToken, string> {
  const count = (value: number) => ready ? value.toLocaleString() : "…";
  return {
    total: total.toLocaleString(), latestSeason: String(latestSeason),
    blue: count(counts.polish), red: count(counts.untouched), purple: count(counts.issue), green: count(counts.accepted),
  };
}

export function fillRoadmapText(text: string, values: Readonly<Record<RoadmapToken, string>>): string {
  return text.replace(/\{([^{}]*)\}/g, (_, name: RoadmapToken) => values[name]);
}
