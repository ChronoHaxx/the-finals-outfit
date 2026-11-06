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
    if (/^#{1,3} /.test(content) || content.startsWith("- ") || content.startsWith("Last reviewed:")) flush();

    if (content.startsWith("# ")) {
      if (title || reviewed || intro.length || sections.length) problems.push(`line ${line}: "# " title must come first, once`);
      else if (content !== "# Roadmap") problems.push(`line ${line}: the title must be "# Roadmap"`);
      title = true;
    } else if (content.startsWith("Last reviewed:")) {
      const date = content.slice("Last reviewed:".length).trim();
      if (reviewed || sections.length) problems.push(`line ${line}: "Last reviewed:" must appear once, before the first section`);
      else if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) problems.push(`line ${line}: "Last reviewed:" needs an ISO date such as 2026-11-05`);
      else reviewed = date;
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
  if (!reviewed) problems.push('missing "Last reviewed: YYYY-MM-DD"');
  if (!sections.some(existing => existing.stage === "Current focus")) problems.push('missing the "## Current focus" section');
  for (const { stage, line, items } of sections) {
    if (!items.length) problems.push(`line ${line}: section "${stage}" has no items`);
    for (const entry of items) if (!entry.description.length) problems.push(`line ${entry.line}: item "${entry.title}" needs a description paragraph`);
  }
  if (problems.length) throw new RoadmapError(problems);
  return {
    reviewed, intro,
    sections: sections.map(({ stage, items }) => ({ stage, items: items.map(({ title, description, tasks, doneWhen }) =>
      ({ title, description, tasks, ...(doneWhen ? { doneWhen } : {}) })) })),
  };
}

export interface RoadmapEvidence { label: string; date: string }

// Things that ship without touching the roadmap. Each one is a moment the roadmap may have gone stale.
export const ROADMAP_EVIDENCE: readonly RoadmapEvidence[] = [
  ...CHANGELOG.map(entry => ({ label: `patch note "${entry.title}" (src/data/changelog.ts)`, date: entry.date })),
  { label: "catalog update (src/data/catalog-update.ts)", date: CATALOG_UPDATE.updatedAt },
];

/** Problems for every shipped change dated after the roadmap's last review. */
export function roadmapStaleness(reviewed: string, evidence: readonly RoadmapEvidence[] = ROADMAP_EVIDENCE): string[] {
  return evidence.filter(({ date }) => date > reviewed).map(({ label, date }) =>
    `"Last reviewed: ${reviewed}" is older than the ${label}, dated ${date}. Re-read ROADMAP.md, update what changed, then set "Last reviewed:" to today.`);
}

/** Parse and check freshness: what the build runs. */
export function loadRoadmap(source: string, evidence: readonly RoadmapEvidence[] = ROADMAP_EVIDENCE): Roadmap {
  const roadmap = parseRoadmap(source);
  const stale = roadmapStaleness(roadmap.reviewed, evidence);
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
