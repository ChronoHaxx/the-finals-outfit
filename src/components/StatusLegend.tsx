import { PROGRESS_ORDER } from "../lib/reconstruction-progress";
import { REVIEW_LABELS, REVIEW_STYLES } from "../lib/reconstruction-status";

export default function StatusLegend() {
  return <aside aria-label="3D status legend" className="space-y-2 lg:justify-self-end lg:self-center">
    <h2 className="text-xs font-medium text-neutral-300">3D item labels</h2>
    <ul className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-neutral-400">
      {PROGRESS_ORDER.filter(status => status !== "unknown").map(status => <li key={status} className="flex items-center gap-2">
        <span aria-hidden="true" className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${REVIEW_STYLES[status]}`}>3D</span>
        <span>{REVIEW_LABELS[status]}</span>
      </li>)}
    </ul>
  </aside>;
}
