import { SLOT_LABELS, type Slot } from "./slots";

// Builds a prefilled GitHub "new issue" link. Nothing is submitted: the person reviews the text on
// GitHub and decides whether to file it. No backend or token is involved.

export interface IssueItem { slot: Slot; id: string; name: string; status: string }
export interface IssueContext {
  repositoryUrl: string;      // https://github.com/<owner>/<repo>
  shareUrl: string;           // stable outfit link that reproduces the build
  items: readonly IssueItem[];
  focus?: IssueItem;          // the item the report is about, when one was chosen
  body?: string;              // body type label; only Medium is supported today
  userAgent?: string;
  viewport?: { width: number; height: number; pixelRatio: number };
  catalog?: "public" | "developer";
}

// GitHub rejects very long query strings; keep well under the common ~8 KB URL limit.
export const MAX_ISSUE_URL = 7000;

export function issueTitle(context: IssueContext): string {
  const subject = context.focus ? `${context.focus.name} (${SLOT_LABELS[context.focus.slot]})` : "Outfit preview";
  return `Preview issue: ${subject}`;
}

export function issueBody(context: IssueContext): string {
  const lines = [
    "## What looks wrong",
    "<!-- Describe what you see and what you expected (the in-game icon or look). Screenshots help. -->",
    "",
    "## Steps to reproduce",
    `1. Open ${context.shareUrl}`,
    "2. Rotate or zoom to the problem area.",
    "",
    "## Outfit",
    ...context.items.map(item =>
      `- ${SLOT_LABELS[item.slot]}: ${item.name} \`${item.id}\` (${item.status})${item.id === context.focus?.id ? " **← reported item**" : ""}`),
    "",
    "## Context",
    `- Body: ${context.body ?? "Medium"}`,
    ...(context.catalog ? [`- Catalog: ${context.catalog}`] : []),
    ...(context.viewport ? [`- Viewport: ${context.viewport.width}×${context.viewport.height} @${context.viewport.pixelRatio}x`] : []),
    ...(context.userAgent ? [`- Browser: ${context.userAgent}`] : []),
  ];
  return lines.join("\n");
}

export function issueUrl(context: IssueContext): string {
  const base = `${context.repositoryUrl.replace(/\/+$/, "")}/issues/new`;
  const make = (body: string) => `${base}?${new URLSearchParams({ title: issueTitle(context), body, labels: "preview" })}`;
  let url = make(issueBody(context));
  if (url.length > MAX_ISSUE_URL) {
    // Drop the per-item list first; the share link still reproduces the full outfit.
    url = make(issueBody({ ...context, items: context.focus ? [context.focus] : [] }));
  }
  if (url.length > MAX_ISSUE_URL) url = make(issueBody({ ...context, items: [], userAgent: undefined }));
  return url;
}
