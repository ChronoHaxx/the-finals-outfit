import type { Item } from "./item";
import { getReconstructionReview, type ReviewStatus } from "./reconstruction-status";

export type ProgressState = "loading" | "ready" | "unavailable";
export const PROGRESS_ORDER: readonly ReviewStatus[] = ["untouched", "polish", "issue", "accepted", "unknown"];

export function summarizeReconstruction(items: readonly Item[], workedOn: ReadonlySet<string>, state: ProgressState) {
  const counts: Record<ReviewStatus, number> = { untouched: 0, polish: 0, issue: 0, accepted: 0, unknown: 0 };
  for (const item of items) counts[getReconstructionReview(item, workedOn, state).status]++;
  return { total: items.length, counts };
}

export function formatProgressPercent(count: number, total: number): string {
  if (!total || !count) return "0%";
  const percent = count / total * 100;
  return percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
}
