// Public text is what visitors read: ROADMAP.md and the patch notes (src/data/changelog.ts). These
// rules catch the usual ways internal detail slips into it. They are a guard, not a reviewer: whether
// wording reads as written for players is still a judgement at review.
//
// Only generic patterns and words that already appear elsewhere in this public repository belong
// here, because this file is public too. Names that must not be published at all (people, other
// projects, unannounced plans) go in the private denylist instead: the PUBLIC_TEXT_DENYLIST
// environment variable, which CI reads from a repository secret and the internal board reads from its
// own local copy. A match against it is reported by number, never by the term itself, because build
// logs are public.

export interface PublicTextRule { re: RegExp; why: string }

export const PUBLIC_TEXT_RULES: readonly PublicTextRule[] = [
  { re: /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i, why: "looks like a commit hash" },
  { re: /(?:^|[\s(])(?:\.{1,2}\/|[A-Za-z]:\\|~\/)|\b(?:src|scripts|tests|workers|_docs|dist|public|node_modules)\/|\\\\|\.(?:md|mjs|ts|tsx|json|glb|gltf|uasset|uexp|uemodel|ubulk|pak|usmap|ucas|utoc|ktx2)\b/i, why: "looks like a file path" },
  { re: /\b(?:claude|codex|release|feature|fix|hotfix)\/[\w-]/i, why: "looks like a branch name" },
  { re: /\bPR\s*#?\d+|\bpull request\s*#?\d+|(?:^|[\s(])#\d+\b/i, why: "names a pull request or issue number" },
  { re: /\b(?:M|MI|MF|MPC|MSM|T|TA|SK|SKM|SM|ABP|AM|AS|BP|DA|DT|NS|PA|PHYS|CT)_[A-Za-z0-9]/, why: "looks like a game asset name" },
  { re: /\bcb\d+\[|\bUV[0-3]\b|\bOCM\b|ShadeAsCloth|HeadMaster|BaseColorOverlay|\bLOCAL_VF\b/, why: "names a shader internal; describe what a visitor sees" },
  { re: /\bFModel\b|CUE4Parse|\busmap\b|IoStore|pakchunk|\bpaks?\b|\bAES\b|Oodle|\bdump(?:s|ed|ing)?\b|\bextract(?:s|ed|ing|ion|or)?\b|\brip(?:s|ped|ping)?\b|decompil|disassembl|compiled shader|reverse[- ]engineer/i, why: "describes how game data is read; keep that off the public page" },
  { re: /\binject(?:s|ed|ing|ion|or)?\b|anti-?cheat|live game read/i, why: "mentions touching the running game" },
  { re: /\bCloudflare\b|workers\.dev|pages\.dev|GitHub Pages|\bKV\b|rate[- ]limit|\bbans?\b|\bbanned\b|lockdown|asset protection|private repo|repository access|\badmin\b|analytics|dashboard|\b3D export\b|\bexport 3D\b|source zip|dev catalog|dev mode/i, why: "names internal work (hosting, asset protection, admin or developer-only tools), which stays off the public roadmap" },
  { re: /\bclaude\b|\bcodex\b|\bfable\b|\bagents?\b|\bsub-?agents?\b|\bsessions?\b|worktree/i, why: "names the tooling behind the project" },
  { re: /\bw\d{2,3}\b|\bwave \d+|\bred pool\b|\bcensus\b/i, why: "uses an internal batch name; describe what changed for visitors" },
];

/** Splits the PUBLIC_TEXT_DENYLIST value (one term per line, or comma-separated) into terms. */
export function parseDenylist(raw: string | undefined): string[] {
  return (raw ?? "").split(/[\n,]/).map(term => normaliseWords(term)).filter(term => term.length > 0);
}

// Lower-case words separated by single spaces, so "Some-Name" matches "some name" in prose.
function normaliseWords(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Problems with one piece of public text; `where` prefixes each message. */
export function lintPublicText(text: string, where: string, privateTerms: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const rule of PUBLIC_TEXT_RULES) {
    const match = text.match(rule.re);
    if (match) problems.push(`${where}: public text ${rule.why} ("${match[0].trim()}")`);
  }
  const words = ` ${normaliseWords(text)} `;
  privateTerms.forEach((term, index) => {
    if (words.includes(` ${term} `))
      problems.push(`${where}: public text matches private denylist term ${index + 1}; reword it (the term is not printed, because build logs are public)`);
  });
  return problems;
}
