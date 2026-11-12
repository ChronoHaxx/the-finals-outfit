import { memo, useDeferredValue, useMemo, useRef, useState } from "react";
import { SLOTS, SLOT_LABELS, type Slot } from "../lib/slots";
import { getBrowseItem, getBrowseItemsBySlot as getItemsBySlot } from "../lib/browse-catalog";
import { derivedFromCatalog } from "../lib/catalog";
import type { Item } from "../lib/item";
import { useBuildStore } from "../store/useBuildStore";
import { assetUrl } from "../lib/assets";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { getReconstructionReview, REVIEW_LABELS, REVIEW_STYLES, type ReviewStatus } from "../lib/reconstruction-status";
import { CheckIcon, HangerIcon, SearchIcon } from "./Icons";
import { hideBroken } from "../lib/hide-broken";
import PresetOutfits from "./PresetOutfits";

// Wardrobe order, head to toe. A slot missing from these lists still appears, under "More".
const GROUPS: { label: string; slots: readonly Slot[] }[] = [
  { label: "Head", slots: ["hair", "facialHair", "face", "eyes", "headwear", "facewear", "eyewear", "earrings"] },
  { label: "Body", slots: ["upperBody", "outerwear", "lowerBody", "hands", "feet"] },
  { label: "Gear", slots: ["upperBack", "lowerBack", "wrist"] },
  { label: "Skin", slots: ["nailPolish", "blush", "tattoo", "bodyPaint"] },
];
const grouped = new Set(GROUPS.flatMap(group => group.slots));

// Slots that actually have items (skips empty ones like bodyType/emote for now), their item
// counts, and the grouped rail. Computed on first use: the catalog loads after modules evaluate.
const wardrobe = derivedFromCatalog(() => {
  const nonEmpty: Slot[] = SLOTS.filter((s) => getItemsBySlot(s).length > 0);
  const counts = Object.fromEntries(nonEmpty.map(s => [s, getItemsBySlot(s).length])) as Record<Slot, number>;
  const rail = [...GROUPS, { label: "More", slots: nonEmpty.filter(slot => !grouped.has(slot)) }]
    .map(group => ({ ...group, slots: group.slots.filter(slot => nonEmpty.includes(slot)) }))
    .filter(group => group.slots.length > 0);
  return { counts, rail };
});

// Source assemblies can render without a legacy catalog mesh (for example Knight Pants No Skirt).
const isRenderable = (i: { id: string; model?: unknown; decal?: unknown }, sourceItems: ReadonlySet<string>) =>
  !!(i.model || i.decal || sourceItems.has(i.id));

// Phone layout: the 3D stage is sticky at the top of the page (see Builder), so the slot strip
// sticks just below it. Desktop: everything lives in fixed panes with their own scrolling.
const PHONE = "(max-width: 1023px)";

const railButton = (active: boolean) => `group relative flex h-9 shrink-0 items-center gap-2 border px-2.5 text-[13px] font-semibold transition-colors [font-stretch:87.5%]
  lg:h-10 lg:w-full lg:border-0 lg:px-4 lg:text-sm
  ${active
    ? "border-fg bg-fg text-ink-950 lg:bg-ink-800 lg:text-fg"
    : "border-line bg-ink-900 text-fg-muted hover:text-fg lg:bg-transparent lg:hover:bg-ink-850"}`;

type View = { kind: "slot"; slot: Slot } | { kind: "outfits" };

function SlotRail({ view, onSelect, onOutfits }: { view: View; onSelect: (slot: Slot) => void; onOutfits: () => void }) {
  const build = useBuildStore((s) => s.build);
  const { counts, rail } = wardrobe();
  const outfits = view.kind === "outfits";
  return <nav aria-label="Cosmetic slots"
    className="sticky top-(--stage-h) z-20 flex h-14 shrink-0 items-center gap-4 overflow-x-auto overscroll-x-contain border-y border-line bg-ink-950 px-3 [scrollbar-width:none] lg:static lg:block lg:h-auto lg:w-52 lg:overflow-y-auto lg:border-y-0 lg:border-r lg:bg-ink-900 lg:px-0 lg:pb-3">
    {/* The game's own outfits come first: one tap dresses the whole character. */}
    <div className="flex shrink-0 items-center gap-1.5 lg:block">
      <p aria-hidden="true" className="hud pr-0.5 text-[9px] text-fg-dim lg:px-4 lg:pb-1.5 lg:pt-4 lg:text-[10px]">In game</p>
      <button type="button" onClick={onOutfits} aria-current={outfits ? "true" : undefined} className={railButton(outfits)}>
        {outfits && <span aria-hidden="true" className="absolute inset-y-1 left-0 hidden w-[3px] bg-finals lg:block" />}
        <span aria-hidden="true" className="hidden size-6 shrink-0 place-items-center lg:grid"><HangerIcon size={15} /></span>
        <span className="whitespace-nowrap">Outfits</span>
      </button>
    </div>
    {rail.map(group => <div key={group.label} className="flex shrink-0 items-center gap-1.5 lg:block">
      <p aria-hidden="true" className="hud pr-0.5 text-[9px] text-fg-dim lg:px-4 lg:pb-1.5 lg:pt-4 lg:text-[10px]">{group.label}</p>
      {group.slots.map(s => {
        const active = view.kind === "slot" && s === view.slot;
        const worn = build[s] ? getBrowseItem(build[s]!) : undefined;
        // Accessible name stays "<Label> <count>": the harness scripts select slots by it.
        return <button key={s} type="button" onClick={() => onSelect(s)} aria-current={active ? "true" : undefined}
          title={worn ? `Wearing ${worn.name}` : undefined} className={railButton(active)}>
          {active && <span aria-hidden="true" className="absolute inset-y-1 left-0 hidden w-[3px] bg-finals lg:block" />}
          <span aria-hidden="true" className={`size-6 shrink-0 overflow-hidden ${worn ? "bg-ink-700" : "hidden bg-ink-800 lg:block"}`}>
            {worn && <img src={assetUrl(worn.imageUrl)} alt="" width={48} height={48} decoding="async" onError={hideBroken} className="size-full object-contain" />}
          </span>
          <span className="whitespace-nowrap">{SLOT_LABELS[s]}</span>
          <span className={`ml-auto pl-1 text-[11px] tabular-nums ${active ? "opacity-60 lg:text-fg-muted lg:opacity-100" : "text-fg-dim"}`}>{counts[s]}</span>
        </button>;
      })}
    </div>)}
  </nav>;
}

type TileProps = {
  item: Item; equipped: boolean; status: ReviewStatus; note: string; renderable: boolean; eager: boolean;
  onToggle: (item: Item) => void;
};

// Memoised on primitive props: equipping re-renders the two tiles that changed, not the whole slot.
const Tile = memo(function Tile({ item, equipped, status, note, renderable, eager, onToggle }: TileProps) {
  return (
    <button type="button" onClick={() => onToggle(item)} title={item.name} aria-pressed={equipped}
      className={`group relative flex flex-col bg-ink-900 text-left transition-colors [contain-intrinsic-size:auto_150px] [content-visibility:auto]
        ${equipped ? "" : "hover:bg-ink-800"}`}>
      {/* The equipped frame is its own top layer: an outline on the button would be painted
          under the positioned image box. */}
      {equipped && <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 border-2 border-fg" />}
      <span className="relative block aspect-square overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,#24242b,#111114_70%)]">
        <img
          src={assetUrl(item.imageUrl)}
          // The name is already the button's text; an alt here would only be read twice (and
          // painted over the tile when an image fails).
          alt=""
          width={256}
          height={256}
          // Everything above the fold loads eagerly. Lazy-loading the whole grid meant a
          // visitor's first sight of the site was rows of empty tiles for several seconds,
          // which reads as broken rather than loading. 20 covers the first viewport.
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={hideBroken}
          className="size-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.05]"
        />
        {renderable ? (
          <span title={note} aria-label={`3D preview: ${note}`}
            data-reconstruction-status={status}
            className={`absolute left-1 top-1 px-1 py-[3px] text-[8px] font-bold leading-none ${REVIEW_STYLES[status]}`}>
            3D
          </span>
        ) : (
          // Icon-only items count as red in the progress bar too; without a label they read as unclassified.
          <span title="Icon only: no 3D preview yet" aria-label="Icon only: no 3D preview yet"
            data-reconstruction-status={status} data-icon-only=""
            className={`absolute left-1 top-1 px-1 py-[3px] text-[8px] font-bold leading-none ${REVIEW_STYLES[status]}`}>
            ICON
          </span>
        )}
        {equipped && <span aria-hidden="true" className="absolute right-1 top-1 grid size-4 place-items-center bg-fg text-ink-950"><CheckIcon size={10} /></span>}
      </span>
      {/* Padding lives on the wrapper: on the clamped element itself, the third line would
          show through the bottom padding. */}
      <span className="block px-1.5 pb-1.5 pt-1">
        <span className={`line-clamp-2 min-h-[2.4em] text-[10.5px] font-semibold uppercase leading-[1.2] tracking-[0.02em] [font-stretch:87.5%] ${equipped ? "text-fg" : "text-fg-muted group-hover:text-fg"}`}>
          {item.name}
        </span>
      </span>
    </button>
  );
});

export default function SlotPicker() {
  const [slot, setSlot] = useState<Slot>(() => wardrobe().rail[0]?.slots[0] ?? "upperBody");
  // The Outfits view replaces the slot grid; the slot is kept so leaving it returns to where you were.
  const [outfits, setOutfits] = useState(false);
  const [query, setQuery] = useState("");
  // Typing stays responsive: the input updates now, the filtered grid follows when React is free.
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const { workedOn, state: progressState } = useReconstructionProgress();
  const equippedId = useBuildStore((s) => s.build[slot]);
  const toggle = useBuildStore((s) => s.toggle);
  const section = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const all = getItemsBySlot(slot);
    const q = deferredQuery.trim().toLowerCase();
    const byQuery = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
    return byQuery.filter(i => statusFilter === "all" || (isRenderable(i, workedOn)
      && getReconstructionReview(i, workedOn, progressState).status === statusFilter));
  }, [slot, deferredQuery, workedOn, statusFilter, progressState]);

  // Start each view at its top. Desktop scrolls the grid pane; on phones the page scrolls, so bring
  // the strip back up under the sticky stage if the visitor is deep in a list.
  const toTop = () => {
    grid.current?.scrollTo({ top: 0 });
    const el = section.current;
    if (!el || !window.matchMedia(PHONE).matches) return;
    if (el.getBoundingClientRect().top < parseFloat(getComputedStyle(el).scrollMarginTop)) el.scrollIntoView({ block: "start" });
  };
  const selectSlot = (next: Slot) => {
    setSlot(next);
    setOutfits(false);
    setQuery("");
    toTop();
  };
  const selectOutfits = () => { setOutfits(true); toTop(); };

  return (
    <div ref={section} className="flex flex-col max-lg:scroll-mt-(--stage-h) lg:h-full lg:min-h-0 lg:flex-row">
      <SlotRail view={outfits ? { kind: "outfits" } : { kind: "slot", slot }} onSelect={selectSlot} onOutfits={selectOutfits} />

      {outfits ? <div className="flex min-w-0 flex-1 flex-col lg:min-h-0"><PresetOutfits /></div> :
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 lg:gap-3 lg:px-4 lg:py-3">
          <div className="mr-auto hidden min-w-0 lg:block">
            <h2 className="display truncate text-[30px]">{SLOT_LABELS[slot]}</h2>
            <p className="hud mt-1 text-fg-dim">{items.length} {items.length === 1 ? "item" : "items"}</p>
          </div>
          <label className="relative min-w-0 flex-1 lg:max-w-72">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${SLOT_LABELS[slot]}…`}
              aria-label={`Search ${SLOT_LABELS[slot]}`}
              type="search"
              enterKeyHint="search"
              className="h-10 w-full border border-line bg-ink-900 pl-9 pr-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-ink-600 focus-visible:outline-none"
            />
          </label>
          <select aria-label="3D status" value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as ReviewStatus | "all")}
            className="select-plain h-10 w-36 shrink-0 border border-line bg-ink-900 pl-3 text-xs font-medium text-fg-muted sm:w-44">
            <option value="all">All 3D statuses</option>
            {(Object.keys(REVIEW_LABELS) as ReviewStatus[]).map(status =>
              <option key={status} value={status}>{REVIEW_LABELS[status]}</option>)}
          </select>
        </div>

        <div ref={grid} aria-label="Cosmetic results" tabIndex={0}
          className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(104px,1fr))] content-start gap-1.5 p-3 outline-none focus-visible:outline-offset-[-2px] lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-4">
          {items.length === 0 && <div className="col-span-full flex flex-col items-start gap-3 py-10">
            <p className="text-sm text-fg-muted">No items match these filters.</p>
            <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); }}
              className="hud border border-line px-3 py-2 text-fg hover:border-fg-dim">Clear filters</button>
          </div>}
          {items.map((item, i) => {
            const { status, note } = getReconstructionReview(item, workedOn, progressState);
            return <Tile key={item.id} item={item} equipped={equippedId === item.id} status={status} note={note}
              renderable={isRenderable(item, workedOn)} eager={i < 20} onToggle={toggle} />;
          })}
        </div>
        <p className="hud shrink-0 px-3 pb-4 text-fg-dim lg:hidden">{items.length} {items.length === 1 ? "item" : "items"} in {SLOT_LABELS[slot]}</p>
      </div>}
    </div>
  );
}
