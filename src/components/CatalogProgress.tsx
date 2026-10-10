import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { formatProgressPercent, PROGRESS_ORDER } from "../lib/reconstruction-progress";
import { REVIEW_LABELS, REVIEW_STYLES, type ReviewStatus } from "../lib/reconstruction-status";

const COLOURS: Record<ReviewStatus, string> = {
  untouched: "Red", polish: "Blue", issue: "Purple", accepted: "Green", unknown: "Unknown",
};
const MEANINGS: Record<ReviewStatus, string> = {
  untouched: "Awaiting reconstruction work. An existing preview may still render.",
  polish: "A first pass is in place; appearance or fitting still needs polish.",
  issue: "A visible problem has been recorded and needs a fix.",
  accepted: "Looks good in the reviewed outfit and body type.",
  unknown: "Status could not yet be checked. Saved reviews still apply.",
};
const itemCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;

export default function CatalogProgress({ compact = false }: { compact?: boolean }) {
  const { summary: { total, counts }, state, retry } = useReconstructionProgress();
  const statuses = PROGRESS_ORDER.filter(status => status !== "unknown" || counts.unknown > 0);
  return (
    <section aria-label="Catalog progress" data-progress-state={state} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <h2 className={compact ? "font-medium text-neutral-300" : "text-lg font-medium text-neutral-100"}>3D preview progress</h2>
        <span className="text-neutral-500">All {itemCount(total)}</span>
      </div>
      <div role="img" aria-label={`Item status proportions: ${statuses.map(status => `${REVIEW_LABELS[status]}, ${itemCount(counts[status])}`).join("; ")}`}
        className={`flex overflow-hidden rounded-full bg-neutral-800 ${compact ? "h-2" : "h-3"}`}>
        {statuses.map(status => <span key={status} aria-hidden="true"
          className={REVIEW_STYLES[status]} style={{ width: `${total ? counts[status] / total * 100 : 0}%` }} />)}
      </div>
      <ul aria-label="Status percentages" className={compact
        ? "grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4"
        : "grid gap-3 pt-2 sm:grid-cols-2"}>
        {statuses.map(status => <li key={status} data-progress-status={status} data-count={counts[status]}
          title={`${REVIEW_LABELS[status]} · ${itemCount(counts[status])}`}
          className={compact ? "flex items-center gap-1.5 text-neutral-400" : "rounded-lg border border-neutral-800 p-3"}>
          <span className={compact ? "contents" : "flex items-center gap-2 text-sm"}>
            <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${REVIEW_STYLES[status]}`} />
            <span>{compact ? COLOURS[status] : REVIEW_LABELS[status]}</span>
            <span className={`tabular-nums ${compact ? "text-neutral-200" : "ml-auto text-neutral-100"}`}>
              {formatProgressPercent(counts[status], total)}
            </span>
          </span>
          {!compact && <>
            <p className="mt-2 text-sm tabular-nums text-neutral-300">{itemCount(counts[status])}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">{MEANINGS[status]}</p>
          </>}
        </li>)}
      </ul>
      {state !== "ready" && <p role="status" className="text-xs text-neutral-400">
        {state === "loading" ? "Checking item progress…" : "Some item statuses couldn’t be loaded."}
        {state === "unavailable" && <button onClick={retry} className="ml-2 underline hover:text-white">Retry status check</button>}
      </p>}
    </section>
  );
}
