import { CHANGELOG, formatPatchDate } from "../data/changelog";

// The changelog as a broadcast-style panel. `fresh` marks how many of the newest entries
// arrived since the visitor last looked; with no history only the latest is flagged.
export default function PatchNotes({ headingId, fresh = 1, className = "" }: { headingId: string; fresh?: number; className?: string }) {
  return <div className={`flex min-h-0 flex-col border border-line bg-ink-900 ${className}`}>
    <div className="flex shrink-0 items-end justify-between gap-3 border-b border-line px-4 py-3">
      <h2 id={headingId} className="display text-[28px]">Patch notes</h2>
      <span className="hud pb-0.5 text-fg-dim">{CHANGELOG.length} updates</span>
    </div>
    <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
      {CHANGELOG.map((entry, index) => <li key={entry.id} className="px-4 py-4">
        <div className="flex items-center gap-2">
          <time dateTime={entry.date} className="hud tabular-nums text-fg-dim">{formatPatchDate(entry.date)}</time>
          {index < fresh && <span className="hud bg-finals px-1.5 py-[3px] text-[9px] leading-none text-white">{index === 0 ? "Latest" : "New"}</span>}
        </div>
        <h3 className="mt-1.5 text-[19px] font-bold uppercase leading-tight tracking-[0.01em] [font-stretch:75%]">{entry.title}</h3>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-fg-muted">
          {entry.notes.map(note => <li key={note} className="relative pl-4">
            <span aria-hidden="true" className="absolute left-0 top-[0.7em] h-px w-2 bg-finals" />{note}
          </li>)}
        </ul>
      </li>)}
    </ol>
  </div>;
}
