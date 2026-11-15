import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { formatProgressPercent, PROGRESS_ORDER } from "../lib/reconstruction-progress";
import { REVIEW_COLOURS, REVIEW_LABELS, REVIEW_MEANINGS, REVIEW_STYLES } from "../lib/reconstruction-status";

const itemCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;

// Compact: one strip that doubles as the colour legend for the 3D tags in the picker.
export default function CatalogProgress({ compact = false }: { compact?: boolean }) {
  const { summary: { total, counts }, state, retry } = useReconstructionProgress();
  const statuses = PROGRESS_ORDER.filter(status => status !== "unknown" || counts.unknown > 0);
  const bar = <div role="img" aria-label={`Item status proportions: ${statuses.map(status => `${REVIEW_LABELS[status]}, ${itemCount(counts[status])}`).join("; ")}`}
    className={`flex overflow-hidden bg-ink-700 ${compact ? "h-1.5 w-full lg:w-32 lg:shrink-0" : "h-2.5"}`}>
    {statuses.map(status => <span key={status} aria-hidden="true"
      className={`${REVIEW_STYLES[status]} transition-[width] duration-500`} style={{ width: `${total ? counts[status] / total * 100 : 0}%` }} />)}
  </div>;
  const note = state !== "ready" && <p role="status" className={compact ? "hud shrink-0 whitespace-nowrap text-fg-dim" : "text-xs text-fg-muted"}>
    {state === "loading" ? (compact ? "Checking…" : "Checking item progress…") : (compact ? "Some statuses unavailable" : "Some item statuses couldn’t be loaded.")}
    {state === "unavailable" && <button type="button" onClick={retry} className="ml-2 underline underline-offset-2 hover:text-fg">{compact ? "Retry" : "Retry status check"}</button>}
  </p>;

  if (compact) return (
    <section aria-label="Catalog progress" data-progress-state={state} className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-1.5">
      <h2 className="hud shrink-0 text-fg-muted">3D progress <span className="text-fg-dim">· {total.toLocaleString()}</span></h2>
      {bar}
      <ul aria-label="Status percentages" className="flex flex-wrap gap-x-3 gap-y-1">
        {statuses.map(status => <li key={status} data-progress-status={status} data-count={counts[status]}
          title={`${REVIEW_LABELS[status]} · ${itemCount(counts[status])}`}
          className="hud flex items-center gap-1.5 whitespace-nowrap text-fg-dim">
          <span aria-hidden="true" className={`inline-block size-2 shrink-0 ${REVIEW_STYLES[status]}`} />
          <span>{REVIEW_COLOURS[status]}</span>
          <span className="tabular-nums text-fg-muted">{formatProgressPercent(counts[status], total)}</span>
        </li>)}
      </ul>
      {note}
    </section>
  );

  return (
    <section aria-label="Catalog progress" data-progress-state={state} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h2 className="display text-[28px]">3D preview progress</h2>
        <span className="hud text-fg-dim">All {itemCount(total)}</span>
      </div>
      {bar}
      <ul aria-label="Status percentages" className="grid gap-px bg-line sm:grid-cols-2">
        {statuses.map(status => <li key={status} data-progress-status={status} data-count={counts[status]}
          title={`${REVIEW_LABELS[status]} · ${itemCount(counts[status])}`} className="bg-ink-900 p-4 sm:last:odd:col-span-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 ${REVIEW_STYLES[status]}`} />
            <span>{REVIEW_LABELS[status]}</span>
            <span className="display ml-auto text-[26px] tabular-nums">{formatProgressPercent(counts[status], total)}</span>
          </span>
          <p className="mt-1 text-sm tabular-nums text-fg-muted">{itemCount(counts[status])}</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-dim">{REVIEW_MEANINGS[status]}</p>
        </li>)}
      </ul>
      {note}
    </section>
  );
}
