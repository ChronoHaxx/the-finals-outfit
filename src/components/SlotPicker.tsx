import { useEffect, useMemo, useState } from "react";
import { SLOTS, SLOT_LABELS, type Slot } from "../lib/slots";
import { getBrowseItemsBySlot as getItemsBySlot } from "../lib/browse-catalog";
import { useBuildStore } from "../store/useBuildStore";
import { assetUrl, modelUrl } from "../lib/assets";
import { loadSourceReconstructionItems } from "../rig/SourceAssembly";
import { getReconstructionReview, REVIEW_LABELS, REVIEW_STYLES, type ReviewStatus } from "../lib/reconstruction-status";

// Slots that actually have items (skips empty ones like bodyType/emote for now).
const NON_EMPTY: Slot[] = SLOTS.filter((s) => getItemsBySlot(s).length > 0);

// Source assemblies can render without a legacy catalog mesh (for example Knight Pants No Skirt).
const isRenderable = (i: { id: string; model?: unknown; decal?: unknown }, sourceItems: ReadonlySet<string>) =>
  !!(i.model || i.decal || sourceItems.has(i.id));

export default function SlotPicker() {
  const [slot, setSlot] = useState<Slot>(NON_EMPTY[0] ?? "upperBody");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [workedOn, setWorkedOn] = useState<Set<string>>(new Set());
  const [progressState, setProgressState] = useState<"loading" | "ready" | "unavailable">("loading");
  const build = useBuildStore((s) => s.build);
  const toggle = useBuildStore((s) => s.toggle);

  useEffect(() => {
    let cancelled = false;
    loadSourceReconstructionItems(modelUrl("models/reconstructed-assemblies-v1")).then(ids => {
      if (!cancelled) { setWorkedOn(ids); setProgressState("ready"); }
    }).catch(() => { if (!cancelled) setProgressState("unavailable"); });
    return () => { cancelled = true; };
  }, []);

  const items = useMemo(() => {
    const all = getItemsBySlot(slot);
    const q = query.trim().toLowerCase();
    const byQuery = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
    return byQuery.filter(i => statusFilter === "all" || (isRenderable(i, workedOn)
      && getReconstructionReview(i, workedOn, progressState).status === statusFilter));
  }, [slot, query, workedOn, statusFilter, progressState]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex max-h-20 shrink-0 flex-wrap gap-1.5 overflow-y-auto overscroll-contain lg:max-h-40">
        {NON_EMPTY.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSlot(s);
              setQuery("");
            }}
            className={`rounded-full px-3 py-1 text-xs transition ${
              s === slot
                ? "bg-neutral-100 text-neutral-900"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {SLOT_LABELS[s]}
            <span className="ml-1 opacity-60">{getItemsBySlot(s).length}</span>
          </button>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${SLOT_LABELS[slot]}…`}
          aria-label={`Search ${SLOT_LABELS[slot]}`}
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        <select aria-label="3D status" value={statusFilter}
          onChange={event => setStatusFilter(event.target.value as ReviewStatus | "all")}
          className="w-full shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-neutral-300 sm:w-auto">
          <option value="all">All 3D statuses</option>
          {(Object.keys(REVIEW_LABELS) as ReviewStatus[]).map(status =>
            <option key={status} value={status}>{REVIEW_LABELS[status]}</option>)}
        </select>
      </div>

      <div aria-label="Cosmetic results" tabIndex={0} className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-4 md:grid-cols-5">
        {items.length === 0 && <p className="col-span-full p-4 text-sm text-neutral-400">No items match these filters.</p>}
        {items.map((item, i) => {
          const equipped = build[item.slot] === item.id;
          const { status, note: progress } = getReconstructionReview(item, workedOn, progressState);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item)}
              title={item.name}
              aria-pressed={equipped}
              className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition ${
                equipped
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
              }`}
            >
              <div className="relative w-full">
                <img
                  src={assetUrl(item.imageUrl)}
                  alt={item.name}
                  // Everything above the fold loads eagerly. Lazy-loading the whole
                  // grid meant a visitor's first sight of the site was rows of empty
                  // tiles for several seconds, which reads as broken rather than
                  // loading. 20 covers the first viewport at every column count.
                  loading={i < 20 ? "eager" : "lazy"}
                  decoding="async"
                  // The tile keeps a visible surface while the image is in flight, and
                  // keeps it if the image never arrives — a grey square is honest about
                  // "not here", where a transparent one is indistinguishable from a
                  // broken page.
                  className="aspect-square w-full rounded bg-neutral-800/60 object-contain"
                />
                {isRenderable(item, workedOn) && (
                  <span title={progress} aria-label={`3D preview: ${progress}`}
                    data-reconstruction-status={status}
                    className={`absolute left-1 top-1 rounded px-1 py-px text-[8px] font-bold leading-none ${REVIEW_STYLES[status]}`}>
                    3D
                  </span>
                )}
              </div>
              <span className="line-clamp-2 text-[10px] leading-tight text-neutral-400">
                {item.name}
              </span>
            </button>
          );
        })}
      </div>

      <p className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span>{items.length} items</span>
        <span><span className="text-red-400">Red 3D</span>: awaiting work</span>
        <span><span className="text-blue-400">Blue 3D</span>: needs polish</span>
        <span><span className="text-purple-400">Purple 3D</span>: known issue</span>
        <span><span className="text-emerald-400">Green 3D</span>: looks good</span>
      </p>
    </div>
  );
}
