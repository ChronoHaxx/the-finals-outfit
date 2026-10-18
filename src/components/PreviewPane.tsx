import { useState } from "react";
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
import CharacterViewer from "./CharacterViewer";

// Stroke icon in currentColor, so the locked state reads from its colour as well as its shape.
function LockIcon({ closed }: { closed: boolean }) {
  return <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill={closed ? "currentColor" : "none"} />
    <path d={closed ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.8-1"} />
  </svg>;
}

export default function PreviewPane() {
  const build = useBuildStore((s) => s.build);
  const unequip = useBuildStore((s) => s.unequip);
  const reset = useBuildStore((s) => s.reset);
  const load = useBuildStore((s) => s.load);
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
    load(Object.fromEntries(Object.entries(next).filter(([, id]) => id)) as Partial<Record<Slot, string>>);
  };
  const report = (focus?: IssueItem) => {
    const items: IssueItem[] = equipped.map(({ slot, item }) =>
      ({ slot, id: item.id, name: item.name, status: REVIEW_LABELS[statusOf(item)] }));
    let shareUrl = window.location.href; // an item without a stable share ID cannot be encoded
    try { shareUrl = buildShareUrl(window.location.href, build); } catch { /* keep the current address */ }
    return issueUrl({ repositoryUrl: REPOSITORY_URL, shareUrl,
      items, focus: focus ?? undefined, catalog: DEVELOPER_CATALOG ? "developer" : "public", userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
        <CharacterViewer />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-300">
          Your build <span className="text-neutral-500">({equipped.length})</span>
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-neutral-500" title="Also pick items that have no reconstruction yet">
            <input type="checkbox" checked={includeUntouched} onChange={e => setIncludeUntouched(e.target.checked)} />
            Any status
          </label>
          <button onClick={randomize} className="text-neutral-300 hover:text-neutral-100"
            title="Random outfit (rules-based); locked pieces are kept">
            Randomise
          </button>
          <a href={report()} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-neutral-200"
            title="Opens a prefilled GitHub issue for you to review; nothing is sent automatically">
            Report issue
          </a>
          {equipped.length > 0 && (
            <button onClick={reset} className="text-neutral-400 hover:text-neutral-200">Reset</button>
          )}
        </div>
      </div>

      {equipped.length === 0 ? (
        <p className="hidden shrink-0 text-sm text-neutral-500 lg:block">
          Pick cosmetics from the slots on the right to build a look.
        </p>
      ) : (
        <ul className="grid max-h-16 shrink-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-3 lg:max-h-32">
          {equipped.map(({ slot, item }) => (
            <li key={slot} className="flex items-stretch gap-1">
              <button
                onClick={() => unequip(slot)}
                title={`Remove ${item.name}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-left hover:border-neutral-600"
              >
                <img src={assetUrl(item.imageUrl)} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-neutral-200">{item.name}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-neutral-500">{SLOT_LABELS[slot]}</span>
                </span>
              </button>
              <span className="flex w-5 shrink-0 flex-col items-center justify-center gap-1 text-xs leading-none">
                <button onClick={() => toggleLock(slot)} aria-pressed={locked.has(slot)}
                  aria-label={locked.has(slot) ? `Unlock ${SLOT_LABELS[slot]}` : `Lock ${SLOT_LABELS[slot]}`}
                  title={locked.has(slot) ? `Unlock ${SLOT_LABELS[slot]} for Randomise` : `Keep ${SLOT_LABELS[slot]} when randomising`}
                  className={locked.has(slot) ? "text-amber-300" : "text-neutral-600 hover:text-neutral-300"}>
                  <LockIcon closed={locked.has(slot)} />
                </button>
                <a href={report({ slot, id: item.id, name: item.name, status: REVIEW_LABELS[statusOf(item)] })}
                  target="_blank" rel="noreferrer" aria-label={`Report a problem with ${item.name}`}
                  title={`Report a problem with ${item.name} (opens a prefilled GitHub issue)`}
                  className="text-neutral-600 hover:text-neutral-300">{"⚑"}</a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
