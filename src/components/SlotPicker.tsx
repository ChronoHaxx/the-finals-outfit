import { useMemo, useState } from "react";
import { SLOTS, SLOT_LABELS, type Slot } from "../lib/slots";
import { getItemsBySlot } from "../lib/catalog";
import { useBuildStore } from "../store/useBuildStore";
import { assetUrl } from "../lib/assets";

// Slots that actually have items (skips empty ones like bodyType/emote for now).
const NON_EMPTY: Slot[] = SLOTS.filter((s) => getItemsBySlot(s).length > 0);

// An item previews in the 3D viewer if it has a mesh (model) or a body decal (tattoo/makeup/…).
const isRenderable = (i: { model?: unknown; decal?: unknown }) => !!(i.model || i.decal);

export default function SlotPicker() {
  const [slot, setSlot] = useState<Slot>(NON_EMPTY[0] ?? "upperBody");
  const [query, setQuery] = useState("");
  const [only3d, setOnly3d] = useState(false);
  const build = useBuildStore((s) => s.build);
  const toggle = useBuildStore((s) => s.toggle);

  const items = useMemo(() => {
    const all = getItemsBySlot(slot);
    const q = query.trim().toLowerCase();
    const byQuery = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
    return only3d ? byQuery.filter(isRenderable) : byQuery;
  }, [slot, query, only3d]);

  const modelCount = useMemo(() => getItemsBySlot(slot).filter(isRenderable).length, [slot]);

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

      <div className="flex shrink-0 items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${SLOT_LABELS[slot]}…`}
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        <button
          onClick={() => setOnly3d((v) => !v)}
          title="Show only items with a 3D model"
          className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition ${
            only3d
              ? "bg-emerald-400 text-neutral-900"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          3D only{modelCount ? ` (${modelCount})` : ""}
        </button>
      </div>

      <div aria-label="Cosmetic results" tabIndex={0} className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-4 md:grid-cols-5">
        {items.map((item, i) => {
          const equipped = build[item.slot] === item.id;
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
                {isRenderable(item) && (
                  <span className="absolute left-1 top-1 rounded bg-emerald-400 px-1 py-px text-[8px] font-bold leading-none text-neutral-900">
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

      <p className="shrink-0 text-xs text-neutral-500">{items.length} items</p>
    </div>
  );
}
