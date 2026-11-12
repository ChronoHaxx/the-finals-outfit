import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SLOT_LABELS } from "../lib/slots";
import { assetUrl } from "../lib/assets";
import { hideBroken } from "../lib/hide-broken";
import { useBuildStore } from "../store/useBuildStore";
import { openPreset } from "../store/useSavedOutfits";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { getReconstructionReview, REVIEW_STYLES } from "../lib/reconstruction-status";
import {
  loadPresetOutfits, presetCoverage, presetPieces, presetSlots,
  type PieceState, type PresetOutfit,
} from "../lib/preset-outfits";
import type { Item } from "../lib/item";
import { CloseIcon, HangerIcon, SearchIcon } from "./Icons";

// The game's own outfits, as one tap each. Putting one on opens it as an unsaved draft beside your saved outfits
// (store/useSavedOutfits openPreset): nothing saved changes until you edit it or press Save.

type Load = { state: "loading" } | { state: "ready"; outfits: PresetOutfit[] } | { state: "failed" };

/** The outfit list, loaded when the view first opens (it is not part of the start-up download). */
function usePresetOutfits(): Load & { retry: () => void } {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    loadPresetOutfits().then(data => { if (live) setLoad({ state: "ready", outfits: data.outfits }); })
      .catch(error => { console.error("[outfits] could not load the outfit list", error); if (live) setLoad({ state: "failed" }); });
    return () => { live = false; };
  }, [attempt]);
  return { ...load, retry: () => setAttempt(n => n + 1) };
}

const isRenderable = (item: Item, sourceItems: ReadonlySet<string>) => !!(item.model || item.decal || sourceItems.has(item.id));

export default function PresetOutfits() {
  const load = usePresetOutfits();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [season, setSeason] = useState<number | "all">("all");
  const [open, setOpen] = useState<PresetOutfit | null>(null);
  const outfits = load.state === "ready" ? load.outfits : [];
  const seasons = useMemo(() => [...new Set(outfits.map(o => o.season))].sort((a, b) => b - a), [outfits]);
  // Pieces are checked against the catalogue once per list, not on every keystroke.
  const coverage = useMemo(() => new Map(outfits.map(o => [o.id, presetCoverage(presetPieces(o))])), [outfits]);
  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return outfits.filter(o => (season === "all" || o.season === season) && (!q || o.name.toLowerCase().includes(q)));
  }, [outfits, deferredQuery, season]);

  return <>
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 lg:gap-3 lg:px-4 lg:py-3">
      <div className="mr-auto hidden min-w-0 lg:block">
        <h2 className="display truncate text-[30px]">Outfits</h2>
        <p className="hud mt-1 text-fg-dim">{load.state === "ready" ? `${shown.length} in-game ${shown.length === 1 ? "outfit" : "outfits"}` : "In-game outfits"}</p>
      </div>
      <label className="relative min-w-0 flex-1 lg:max-w-72">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search outfits…" aria-label="Search outfits"
          type="search" enterKeyHint="search"
          className="h-10 w-full border border-line bg-ink-900 pl-9 pr-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-ink-600 focus-visible:outline-none" />
      </label>
      <select aria-label="Season" value={season} onChange={e => setSeason(e.target.value === "all" ? "all" : Number(e.target.value))}
        className="select-plain h-10 w-32 shrink-0 border border-line bg-ink-900 pl-3 text-xs font-medium text-fg-muted sm:w-40">
        <option value="all">All seasons</option>
        {seasons.map(s => <option key={s} value={s}>Season {s}</option>)}
      </select>
    </div>

    <div aria-label="Outfit results" tabIndex={0}
      className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(112px,1fr))] content-start gap-1.5 p-3 outline-none focus-visible:outline-offset-[-2px] lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-4">
      {load.state === "loading" && <p className="col-span-full py-10 text-sm text-fg-muted">Loading the game’s outfits…</p>}
      {load.state === "failed" && <div className="col-span-full flex flex-col items-start gap-3 py-10">
        <p className="text-sm text-fg-muted">The outfit list couldn’t be loaded.</p>
        <button type="button" onClick={load.retry} className="hud border border-line px-3 py-2 text-fg hover:border-fg-dim">Try again</button>
      </div>}
      {load.state === "ready" && shown.length === 0 && <div className="col-span-full flex flex-col items-start gap-3 py-10">
        <p className="text-sm text-fg-muted">No outfits match these filters.</p>
        <button type="button" onClick={() => { setQuery(""); setSeason("all"); }}
          className="hud border border-line px-3 py-2 text-fg hover:border-fg-dim">Clear filters</button>
      </div>}
      {shown.map((outfit, i) => {
        const { worn, wearable } = coverage.get(outfit.id)!;
        const complete = worn === wearable;
        return <button key={outfit.id} type="button" onClick={() => setOpen(outfit)} title={outfit.name}
          className="group relative flex flex-col bg-ink-900 text-left transition-colors hover:bg-ink-800 [contain-intrinsic-size:auto_170px] [content-visibility:auto]">
          <span className="relative block aspect-[4/5] overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,#24242b,#111114_70%)]">
            <img src={assetUrl(outfit.icon)} alt="" width={256} height={256} loading={i < 20 ? "eager" : "lazy"} decoding="async"
              onError={hideBroken} className="size-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.04]" />
            <span className="hud absolute left-1 top-1 bg-ink-950/80 px-1 py-[3px] text-[8px] leading-none text-fg-muted">S{outfit.season}</span>
            <span title={complete ? "Every piece is on the site" : `${worn} of ${wearable} pieces are on the site`}
              className={`absolute right-1 top-1 px-1 py-[3px] text-[8px] font-bold leading-none tabular-nums ${complete ? "bg-fg text-ink-950" : "bg-kept/90 text-ink-950"}`}>
              {worn}/{wearable}
            </span>
          </span>
          <span className="block px-1.5 pb-1.5 pt-1">
            <span className="line-clamp-2 min-h-[2.4em] text-[10.5px] font-semibold uppercase leading-[1.2] tracking-[0.02em] text-fg-muted [font-stretch:87.5%] group-hover:text-fg">{outfit.name}</span>
          </span>
        </button>;
      })}
    </div>
    {load.state === "ready" && <p className="hud shrink-0 px-3 pb-4 text-fg-dim lg:hidden">{shown.length} in-game {shown.length === 1 ? "outfit" : "outfits"}</p>}
    {open && <OutfitDetail outfit={open} onClose={() => setOpen(null)} />}
  </>;
}

function OutfitDetail({ outfit, onClose }: { outfit: PresetOutfit; onClose: () => void }) {
  const { workedOn, state } = useReconstructionProgress();
  const pieces = useMemo(() => presetPieces(outfit), [outfit]);
  const { worn, wearable } = presetCoverage(pieces);
  const [already, setAlready] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // showModal(): the page behind goes inert, focus stays inside, Escape closes, and focus returns to the tile.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);

  const wear = () => {
    // One build change, made by the store: computing the slots here and equipping piece by piece would save each step
    // into the outfit on screen.
    const result = openPreset(outfit.name, presetSlots(outfit, useBuildStore.getState().build));
    if (result === "same") setAlready(true);
    else if (result !== "declined") onClose();
  };

  // A click on the backdrop lands on the <dialog> itself; clicks on the content land on its children. The close event
  // is queued, so it can arrive after a remount (StrictMode) has reopened the dialog: act only if it really is closed.
  return <dialog ref={dialog} aria-label={outfit.name} onClose={() => { if (!dialog.current?.open) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    className="mx-auto mb-0 mt-auto max-h-[88dvh] w-full max-w-none animate-rise border border-ink-600 bg-ink-850 p-0 text-fg shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)] backdrop:bg-black/60 lg:m-auto lg:max-h-[80dvh] lg:w-[40rem]">
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-[26px] uppercase">{outfit.name}</h3>
          <p className="hud mt-0.5 text-fg-dim">Season {outfit.season}{outfit.rarity ? ` · ${outfit.rarity}` : ""} · {worn} of {wearable} pieces on the site</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 grid size-8 place-items-center text-fg-dim hover:text-fg">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
        <img src={assetUrl(outfit.icon)} alt="" width={256} height={256} onError={hideBroken}
          className="hidden w-40 shrink-0 self-start object-contain sm:block" />
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
          {pieces.map((piece, i) => <PieceRow key={i} state={piece} workedOn={workedOn} progress={state} />)}
        </ul>
      </div>
      <div className="flex flex-col gap-2 border-t border-line p-3">
        <p className="text-[11px] leading-snug text-fg-dim">
          {already ? "You’re already wearing this outfit." : wearNote(outfit, pieces)}
        </p>
        <button type="button" onClick={wear}
          className="flex h-11 w-full items-center justify-center gap-2 bg-fg text-[17px] font-bold uppercase tracking-[0.02em] text-ink-950 [font-stretch:70%] hover:bg-white">
          <HangerIcon size={16} />Wear this outfit
        </button>
      </div>
    </div>
  </dialog>;
}

/** What putting the outfit on does to the contestant's own face, hair and skin (presetSlots keeps them unless replaced). */
function wearNote(outfit: PresetOutfit, pieces: readonly PieceState[]): string {
  const worn = new Set(pieces.flatMap(p => p.status === "worn" ? [p.item!.slot] : []));
  const hidesHair = !!outfit.hide?.length;
  const kept = [!worn.has("face") && "face", !worn.has("hair") && !hidesHair && "hair", "skin"].filter(Boolean) as string[];
  const list = kept.length > 1 ? `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}` : kept[0];
  return `Puts on every piece the site has${hidesHair ? " and takes off the hair it covers" : ""}. Your own ${list} ${kept.length > 1 ? "stay" : "stays"}. `
    + "It opens unsaved: your saved outfits don’t change.";
}

function PieceRow({ state, workedOn, progress }: { state: PieceState; workedOn: ReadonlySet<string>;
  progress: Parameters<typeof getReconstructionReview>[2] }) {
  const { item, status, piece } = state;
  const name = item?.name ?? piece.name ?? "Unnamed piece";
  let note: string, badge: { text: string; style: string } | undefined;
  if (item) {
    const review = getReconstructionReview(item, workedOn, progress);
    badge = { text: isRenderable(item, workedOn) ? "3D" : "ICON", style: REVIEW_STYLES[review.status] };
    note = status === "same-slot" && state.instead
      ? `${SLOT_LABELS[item.slot]} · not worn: ${state.instead.name} takes this slot here`
      : SLOT_LABELS[item.slot];
  } else {
    note = status === "effect" ? "Visual effect · not shown in this builder"
      : status === "voice" ? "Voice · not part of the look"
      : status === "pet" ? "Pet · not shown in this builder"
      : "Not on the site yet";
  }
  return <li className={`flex items-center gap-2 border border-line bg-ink-900 pr-2 ${item && status === "worn" ? "" : "opacity-70"}`}>
    <span className="relative size-12 shrink-0 bg-ink-800">
      {item && <img src={assetUrl(item.imageUrl)} alt="" width={96} height={96} decoding="async" onError={hideBroken} className="size-full object-contain" />}
      {badge && <span className={`absolute left-0.5 top-0.5 px-0.5 py-[2px] text-[7px] font-bold leading-none ${badge.style}`}>{badge.text}</span>}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-semibold uppercase leading-tight tracking-[0.02em] [font-stretch:87.5%]">{name}</span>
      <span className="hud mt-0.5 block text-[9px] text-fg-dim">{note}</span>
    </span>
  </li>;
}
