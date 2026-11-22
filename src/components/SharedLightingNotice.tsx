import { MAX_LOOKS, useLightingStore } from "../lib/lighting-store";
import { CloseIcon, SunIcon } from "./Icons";

/**
 * The lighting a share link brought (22 Nov 2026, lib/share-lighting.ts). While the link's look is on screen it stands in
 * for the viewer's own, which nothing has changed: this bar says so and offers the two ways out, Keep this lighting (it
 * becomes theirs and is added to their saved looks) and Use my lighting (theirs comes back). After a keep it says where
 * the look went and offers Undo; for a link whose lighting this version cannot show, it says theirs stayed.
 * The lighting panel repeats the two choices (LightingPanel.tsx).
 */
export function SharedLightingNotice() {
  const shared = useLightingStore(state => state.shared);
  const outcome = useLightingStore(state => state.sharedOutcome);
  const previous = useLightingStore(state => state.previous);
  const { keepShared, leaveShared, dismissSharedOutcome, undo } = useLightingStore.getState();
  const bar = "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-ink-900 px-4 py-2 text-xs text-fg";

  if (shared) return <div role="status" aria-label="Lighting from this link" className={bar}>
    <SunIcon size={14} />
    <p className="min-w-[12rem] flex-1">
      You’re seeing the lighting from this link{shared.label ? ` (${shared.label})` : ""}. Your own lighting is kept until you choose.
    </p>
    <span className="flex gap-1.5">
      <button type="button" onClick={keepShared} className="h-7 bg-fg px-2.5 text-ink-950 hover:bg-white">Keep this lighting</button>
      <button type="button" onClick={leaveShared} className="h-7 border border-line px-2.5 hover:bg-ink-800">Use my lighting</button>
    </span>
  </div>;

  if (!outcome) return null;
  const text = outcome.kind === "unavailable"
    ? "This link’s lighting can’t be shown on this version of the site, so your own lighting is used."
    : `This lighting is yours now${outcome.savedAs === null
      ? `. Your saved looks are full (${MAX_LOOKS}), so it was not added to them.`
      : outcome.added ? ` and is saved as “${outcome.savedAs}” in the lighting menu.` : `; it is already saved as “${outcome.savedAs}”.`}`;
  return <div role="status" className={bar}>
    <SunIcon size={14} />
    <p className="min-w-[12rem] flex-1">{text}</p>
    {outcome.kind === "kept" && previous && <button type="button" onClick={() => { undo(); dismissSharedOutcome(); }}
      title="Back to the lighting you had before" className="h-7 border border-line px-2.5 hover:bg-ink-800">Undo</button>}
    <button type="button" onClick={dismissSharedOutcome} aria-label="Dismiss" className="grid size-6 place-items-center text-fg-muted hover:text-fg">
      <CloseIcon size={12} />
    </button>
  </div>;
}
