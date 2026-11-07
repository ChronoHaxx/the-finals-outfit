import { useMemo, useState } from "react";
import { SLOTS, SLOT_LABELS, type Slot } from "../lib/slots";
import { getBrowseItem as getItemById, getBrowseItemsBySlot } from "../lib/browse-catalog";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import { useBuildStore } from "../store/useBuildStore";
import { assetUrl } from "../lib/assets";
import { buildShareUrl } from "../lib/share-url";
import { randomizeBuild } from "../lib/randomize";
import { issueUrl, type IssueItem } from "../lib/issue-report";
import { getReconstructionReview, REVIEW_LABELS } from "../lib/reconstruction-status";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { REPOSITORY_URL } from "./ProjectLinks";
import ShareBuild from "./ShareBuild";
import { OutfitNotices, OutfitSwitcher, OutfitToast } from "./SavedOutfits";
import { DiceIcon, FlagIcon, LockIcon, ResetIcon } from "./Icons";
import { randomiseOutfit, resetOutfit } from "../store/useSavedOutfits";
import { hideBroken } from "../lib/hide-broken";

const ghost = "flex h-8 items-center gap-1.5 px-2 hud text-fg-muted transition-colors hover:text-fg";

// The equipped pieces and everything you do to the outfit as a whole.
export default function OutfitBar() {
  const build = useBuildStore((s) => s.build);
  const unequip = useBuildStore((s) => s.unequip);
  const { workedOn, state } = useReconstructionProgress();
  const [locked, setLocked] = useState<ReadonlySet<Slot>>(new Set());
  const [includeUntouched, setIncludeUntouched] = useState(false);

  const equipped = SLOTS.map((slot) => ({
    slot,
    item: build[slot] ? getItemById(build[slot]!) : undefined,
  })).filter((e): e is { slot: Slot; item: NonNullable<typeof e.item> } => !!e.item);

  const statusOf = (item: NonNullable<ReturnType<typeof getItemById>>) =>
    getReconstructionReview(item, workedOn, state).status;
  const toggleLock = (slot: Slot) => setLocked(current => {
    const next = new Set(current);
    if (!next.delete(slot)) next.add(slot);
    return next;
  });
  const randomize = () => {
    const next = randomizeBuild({ build, locked, candidates: slot => getBrowseItemsBySlot(slot)
      // Only pieces the preview can draw; by default only ones with reconstruction work.
      .filter(item => (item.model || item.decal || workedOn.has(item.id))
        && (includeUntouched || statusOf(item) !== "untouched"))
      .map(item => item.id) });
    // A hand-made outfit is kept: the roll goes into an outfit of its own (src/store/useSavedOutfits.ts).
    randomiseOutfit(Object.fromEntries(Object.entries(next).filter(([, id]) => id)) as Partial<Record<Slot, string>>);
  };
  // Issue links encode the whole outfit, so build them once per outfit change, not on every render.
  const reports = useMemo(() => {
    const items: IssueItem[] = equipped.map(({ slot, item }) =>
      ({ slot, id: item.id, name: item.name, status: REVIEW_LABELS[statusOf(item)] }));
    let shareUrl = window.location.href; // an item without a stable share ID cannot be encoded
    try { shareUrl = buildShareUrl(window.location.href, build); } catch { /* keep the current address */ }
    const report = (focus?: IssueItem) => issueUrl({ repositoryUrl: REPOSITORY_URL, shareUrl,
      items, focus, catalog: DEVELOPER_CATALOG ? "developer" : "public", userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio } });
    return { all: report(), bySlot: new Map(items.map(item => [item.slot, report(item)])) };
  }, [build, workedOn, state]); // equipped and statusOf are derived from exactly these

  return (
    <div className="relative flex flex-col gap-3 border-b border-line bg-ink-950 px-3 py-3 lg:h-full lg:border lg:bg-ink-900 lg:px-4">
      <OutfitToast />
      <div className="relative flex items-center gap-2">
        <OutfitSwitcher />
        <span className="hud mt-1 hidden tabular-nums text-fg-dim sm:inline">{equipped.length} {equipped.length === 1 ? "piece" : "pieces"}</span>
        <div className="-mr-2 ml-auto flex shrink-0 items-center">
          <a href={reports.all} target="_blank" rel="noreferrer" className={ghost}
            title="Opens a prefilled GitHub issue for you to review; nothing is sent automatically">
            <FlagIcon size={13} /><span className="hidden min-[400px]:inline">Report issue</span><span className="min-[400px]:hidden">Report</span>
          </a>
          <button type="button" onClick={resetOutfit} className={ghost}
            title="Back to the starting outfit. An outfit you made yourself is kept; this starts a new one">
            <ResetIcon size={13} />Reset
          </button>
        </div>
      </div>

      {equipped.length === 0 ? (
        <p className="flex h-14 items-center border border-dashed border-line px-3 text-sm text-fg-dim">
          Nothing equipped. Pick a slot and tap a cosmetic to put it on.
        </p>
      ) : (
        <ul className="-mx-3 flex gap-1.5 overflow-x-auto overscroll-x-contain px-3 [scrollbar-width:none] lg:mx-0 lg:grid lg:max-h-[7.25rem] lg:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] lg:overflow-y-auto lg:px-0 lg:[scrollbar-width:thin]">
          {equipped.map(({ slot, item }) => {
            const isLocked = locked.has(slot);
            return <li key={slot} className={`flex h-14 w-52 shrink-0 items-stretch border bg-ink-850 lg:w-auto ${isLocked ? "border-kept/50" : "border-line"}`}>
              <button type="button" onClick={() => unequip(slot)} title={`Remove ${item.name}`}
                className="flex min-w-0 flex-1 items-center gap-2 pl-1 pr-2 text-left transition-colors hover:bg-ink-800">
                <span className="size-12 shrink-0 bg-ink-800">
                  <img src={assetUrl(item.imageUrl)} alt="" width={96} height={96} decoding="async" onError={hideBroken}
                    className="size-full object-contain" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold uppercase leading-tight tracking-[0.02em] [font-stretch:87.5%]">{item.name}</span>
                  <span className="hud mt-0.5 block text-[9px] text-fg-dim">{SLOT_LABELS[slot]}</span>
                </span>
              </button>
              <span className="flex w-8 shrink-0 flex-col border-l border-line">
                <button type="button" onClick={() => toggleLock(slot)} aria-pressed={isLocked}
                  aria-label={isLocked ? `Unlock ${SLOT_LABELS[slot]}` : `Lock ${SLOT_LABELS[slot]}`}
                  title={isLocked ? `Unlock ${SLOT_LABELS[slot]} for Randomise` : `Keep ${SLOT_LABELS[slot]} when randomising`}
                  className={`grid flex-1 place-items-center transition-colors ${isLocked ? "bg-kept/10 text-kept" : "text-fg-dim hover:text-fg"}`}>
                  <LockIcon closed={isLocked} size={12} />
                </button>
                <a href={reports.bySlot.get(slot)} target="_blank" rel="noreferrer" aria-label={`Report a problem with ${item.name}`}
                  title={`Report a problem with ${item.name} (opens a prefilled GitHub issue)`}
                  className="grid flex-1 place-items-center border-t border-line text-fg-dim transition-colors hover:text-fg">
                  <FlagIcon size={11} />
                </a>
              </span>
            </li>;
          })}
        </ul>
      )}

      <OutfitNotices />

      <div className="flex items-center gap-2.5 sm:gap-3">
        <button type="button" onClick={randomize} title="Random outfit (rules-based); locked pieces are kept"
          className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border border-ink-600 px-3 text-[17px] sm:px-4 font-bold uppercase tracking-[0.02em] [font-stretch:70%] transition-colors hover:border-fg hover:bg-ink-800">
          <DiceIcon size={16} />Randomise
        </button>
        <label className="hud flex items-center gap-1.5 whitespace-nowrap text-fg-dim" title="Also pick items that have no reconstruction yet (red)">
          <input type="checkbox" checked={includeUntouched} onChange={e => setIncludeUntouched(e.target.checked)}
            className="size-3.5 accent-finals" />
          Include red
        </label>
        <div className="ml-auto"><ShareBuild /></div>
      </div>
    </div>
  );
}
