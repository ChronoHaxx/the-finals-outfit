import type { Item } from "./item";
import { resolveLegacyBodyCoverage } from "../rig/LegacyBodyCoverage";
import reviewRecords from "../data/reconstruction-reviews.json";

export type ReviewStatus = "untouched" | "polish" | "issue" | "accepted" | "unknown";
export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  untouched: "Red · awaiting work", polish: "Blue · needs polish",
  issue: "Purple · known issue", accepted: "Green · looks good", unknown: "Status unavailable",
};
export const REVIEW_STYLES: Record<ReviewStatus, string> = {
  untouched: "bg-red-500 text-white", polish: "bg-blue-500 text-white",
  issue: "bg-purple-500 text-white", accepted: "bg-emerald-400 text-neutral-900",
  unknown: "bg-neutral-600 text-white",
};
const REVIEWS = reviewRecords as Record<string, { status: Exclude<ReviewStatus, "unknown">; note: string }>;

export function getReconstructionReview(item: Item, workedOn: ReadonlySet<string>,
  state: "loading" | "ready" | "unavailable"): { status: ReviewStatus; note: string } {
  if (REVIEWS[item.id]) return REVIEWS[item.id];
  if (item.model && resolveLegacyBodyCoverage(item.model.gltfPath, "models/reconstructed-meshes-v2/SK_Body_M.glb")) {
    return { status: "issue", note: "Known visual errors: coverage repaired; materials and prints still need work" };
  }
  if (workedOn.has(item.id) || item.decal?.layers.some(l => l.uvLayout === "sourceBodyPaint" && l.uvScale)) {
    return { status: "polish", note: "Needs visual polish · Medium reconstruction in progress" };
  }
  return state === "ready" ? { status: "untouched", note: "Awaiting reconstruction" }
    : { status: "unknown", note: state === "loading" ? "Checking reconstruction status" : "Reconstruction status unavailable" };
}
