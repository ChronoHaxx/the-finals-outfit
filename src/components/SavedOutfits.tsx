import { useEffect, useRef, useState } from "react";
import { SLOT_LABELS, type Slot } from "../lib/slots";
import { getBrowseItem } from "../lib/browse-catalog";
import { assetUrl } from "../lib/assets";
import { hideBroken } from "../lib/hide-broken";
import type { LibrarySnapshot, OutfitRecord } from "../lib/outfit-library";
import { NAME_MAX } from "../lib/outfit-library";
import type { MissingPiece } from "../lib/saved-outfit-pieces";
import {
  deleteOutfit, dismissNotice, dismissToast, duplicateOutfit, forgetMissing, newOutfit, renameOutfit, saveDraft,
  selectOutfit, useSavedOutfits,
} from "../store/useSavedOutfits";
import { ChevronIcon, CloseIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "./Icons";

const iconButton = "grid size-9 shrink-0 place-items-center text-fg-dim transition-colors hover:text-fg disabled:opacity-35 disabled:hover:text-fg-dim";
const notice = "flex items-start gap-2 border px-3 py-2 text-xs leading-snug";
const amber = "border-kept/25 bg-kept/10 text-kept";

function ago(time: number, now: number): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(time).toLocaleDateString();
}

function currentName(library: LibrarySnapshot | null): string {
  const current = library?.current;
  if (!current) return "Outfit";
  if (current.kind === "draft") return current.draft.name;
  return library.outfits.find(record => record.id === current.id)?.name ?? "Outfit";
}

/** Status beside the outfit name: quiet when all is well, amber when the visitor should know something. */
function SaveState({ library }: { library: LibrarySnapshot | null }) {
  if (!library) return null;
  const draft = library.current?.kind === "draft";
  const [label, warn, title] =
    library.status === "off" ? ["Saving off", true, "This browser does not let the site store anything (private window or blocked site data). Outfits last until you close the tab."]
    : draft ? ["Not saved", true, "This outfit is not one of your saved outfits yet"]
    : library.status === "error" ? ["Save failed", true, `Your browser refused to save: ${library.error ?? "unknown error"}. Your changes are kept on this page and saving retries on your next change.`]
    : library.status === "saving" ? ["Saving…", false, "Saving in this browser"]
    : ["Saved", false, "Saved in this browser"];
  return <span title={title} className={`hud mt-1 whitespace-nowrap ${warn ? "text-kept" : "text-fg-dim"}`}>{label}</span>;
}

function OutfitRow({ record, current, now }: { record: OutfitRecord; current: boolean; now: number }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(record.name);
  const input = useRef<HTMLInputElement>(null);
  // Escape unmounts the field, and a blur on the way out must not save what was typed.
  const settled = useRef(false);
  useEffect(() => { if (editing) { settled.current = false; input.current?.select(); } }, [editing]);
  const pieces = Object.values(record.slots);
  const icons = pieces.map(id => getBrowseItem(id)).filter(item => !!item).slice(0, 5);
  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    renameOutfit(record.id, name);
  };
  const cancel = () => { settled.current = true; setName(record.name); setEditing(false); };
  return <li className={`relative flex items-stretch border-b border-line ${current ? "bg-ink-800" : ""}`}>
    {current && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-finals" />}
    {editing
      ? <form className="flex min-w-0 flex-1 items-center px-3 py-2" onSubmit={event => { event.preventDefault(); commit(); }}>
          <input ref={input} value={name} maxLength={NAME_MAX} aria-label="Outfit name" onChange={event => setName(event.target.value)}
            onBlur={commit} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } }}
            className="h-9 min-w-0 flex-1 border border-ink-600 bg-ink-950 px-2 text-sm text-fg outline-none focus:border-fg" />
        </form>
      : <button type="button" onClick={() => selectOutfit(record.id)} aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 flex-col gap-1 py-2 pl-3 pr-1 text-left transition-colors hover:bg-ink-800">
          <span className="block truncate text-[13px] font-semibold uppercase leading-tight tracking-[0.02em] [font-stretch:87.5%]">{record.name}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="flex shrink-0 gap-0.5">
              {icons.map(item => <span key={item.id} className="size-5 bg-ink-700">
                <img src={assetUrl(item.imageUrl)} alt="" width={40} height={40} loading="lazy" decoding="async" onError={hideBroken}
                  className="size-full object-contain" />
              </span>)}
            </span>
            <span className="hud min-w-0 truncate text-[9px] text-fg-dim">
              {pieces.length} {pieces.length === 1 ? "piece" : "pieces"} · {ago(record.updatedAt, now)}
            </span>
          </span>
        </button>}
    {!editing && <span className="flex items-center pr-1">
      <button type="button" className={iconButton} onClick={() => { setName(record.name); setEditing(true); }}
        aria-label={`Rename ${record.name}`} title="Rename"><PencilIcon /></button>
      <button type="button" className={iconButton} onClick={() => duplicateOutfit(record.id)}
        aria-label={`Duplicate ${record.name}`} title="Duplicate"><CopyIcon /></button>
      <button type="button" className={iconButton} onClick={() => deleteOutfit(record.id)}
        aria-label={`Delete ${record.name}`} title="Delete (can be undone)"><TrashIcon /></button>
    </span>}
  </li>;
}

/** The outfit's name, which opens the list of saved outfits. */
export function OutfitSwitcher() {
  const library = useSavedOutfits(state => state.library);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const name = currentName(library);
  const current = library?.current;
  const atCap = !!library && library.outfits.length >= library.cap;
  return <div ref={root} className="flex min-w-0 items-center gap-2">
    <h2 className="min-w-0">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Saved outfits: ${name}`} title="Your saved outfits"
        className="group flex min-w-0 max-w-full items-center gap-1.5 text-left">
        <span className="display truncate text-[24px] group-hover:text-white">{name}</span>
        <ChevronIcon size={12} className={`mb-0.5 shrink-0 text-fg-dim transition-transform group-hover:text-fg ${open ? "rotate-180" : ""}`} />
      </button>
    </h2>
    <SaveState library={library} />
    {open && library && <div role="dialog" aria-label="Saved outfits"
      className="absolute inset-x-0 top-[calc(100%+6px)] z-40 flex max-h-[min(70dvh,30rem)] animate-rise flex-col border border-ink-600 bg-ink-850 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)] lg:top-auto lg:bottom-[calc(100%+6px)] lg:right-auto lg:w-[24rem]">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        <p className="hud text-fg">Saved outfits</p>
        <p className="hud tabular-nums text-fg-dim" title={`This browser keeps up to ${library.cap} outfits`}>{library.outfits.length} / {library.cap}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close saved outfits" className="-mr-1 ml-auto grid size-7 place-items-center text-fg-dim hover:text-fg">
          <CloseIcon size={14} />
        </button>
      </div>
      {library.status === "off"
        ? <p className={`${notice} ${amber} m-3 mb-0`}>Saving is off: this browser isn’t letting the site store anything (a private window, or site data is blocked). Your outfits last until you close this tab.</p>
        : <p className="px-3 pt-2.5 text-[11px] leading-snug text-fg-dim">Changes save as you go, in this browser only. Private windows forget them when closed, and Safari can clear them after a week without a visit. Share a link to keep an outfit anywhere.</p>}
      {current?.kind === "draft" && <div className={`${notice} ${amber} mx-3 mt-2.5 items-center`}>
        <p className="flex-1">{atCap || current.draft.reason === "cap"
          ? <><b>{current.draft.name}</b> isn’t saved: you have {library.cap} saved outfits. Delete one, then save.</>
          : current.draft.reason === "preset"
            ? <><b>{current.draft.name}</b> is an in-game outfit you haven’t saved. Changing anything saves it.</>
            : <><b>{current.draft.name}</b> is a shared outfit you haven’t saved. Changing anything saves it.</>}</p>
        <button type="button" onClick={() => { if (saveDraft()) setOpen(false); }} disabled={atCap}
          className="hud h-8 shrink-0 bg-fg px-3 text-ink-950 hover:bg-white disabled:opacity-40">Save</button>
      </div>}
      <ul className="mt-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line [scrollbar-width:thin]">
        {library.outfits.map(record => <OutfitRow key={record.id} record={record} now={now}
          current={current?.kind === "record" && current.id === record.id} />)}
        {library.outfits.length === 0 && <li className="px-3 py-4 text-sm text-fg-dim">No saved outfits yet.</li>}
      </ul>
      <div className="border-t border-line p-2">
        <button type="button" onClick={() => { if (newOutfit()) setOpen(false); }} disabled={atCap}
          title={atCap ? `You have ${library.cap} saved outfits. Delete one to make room.` : "Start a new outfit from the starting look"}
          className="flex h-10 w-full items-center justify-center gap-2 border border-ink-600 text-[15px] font-bold uppercase tracking-[0.02em] [font-stretch:70%] transition-colors hover:border-fg hover:bg-ink-800 disabled:opacity-40 disabled:hover:border-ink-600 disabled:hover:bg-transparent">
          <PlusIcon size={13} />New outfit
        </button>
      </div>
    </div>}
  </div>;
}

function missingText(piece: MissingPiece): string {
  const name = piece.name ?? piece.id;
  const slot = SLOT_LABELS[piece.slot as Slot] ?? piece.slot;
  if (piece.reason === "moved" && piece.nowIn) return `${name} (${slot}; now a ${SLOT_LABELS[piece.nowIn]} item)`;
  if (piece.reason === "clash") return `${name} (${slot}; can’t be worn with another piece)`;
  return `${name} (${slot}; not in the catalogue now)`;
}

/** Messages about the outfit on screen that stay until dealt with: pieces that can't be shown, and what the
 * library did on its own (an outfit kept as a copy, a recovery). */
export function OutfitNotices() {
  const library = useSavedOutfits(state => state.library);
  const missing = useSavedOutfits(state => state.missing);
  const onRecord = library?.current?.kind === "record";
  if (!missing.length && !library?.notice) return null;
  return <div className="flex flex-col gap-1.5">
    {missing.length > 0 && <div role="status" className={`${notice} ${amber}`}>
      <p className="flex-1">
        {missing.length === 1 ? "1 saved piece isn’t shown" : `${missing.length} saved pieces aren’t shown`}: {missing.map(missingText).join(", ")}.
        {onRecord && (missing.length === 1
          ? " It stays in this outfit until you put something else in that slot."
          : " They stay in this outfit until you put something else in those slots.")}
      </p>
      {onRecord && <button type="button" onClick={forgetMissing} className="hud shrink-0 underline underline-offset-2 hover:text-fg">Remove</button>}
    </div>}
    {library?.notice && <div role="status" className={`${notice} ${amber}`}>
      <p className="flex-1">{library.notice}</p>
      <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="grid size-5 shrink-0 place-items-center hover:text-fg"><CloseIcon size={11} /></button>
    </div>}
  </div>;
}

/** The result of the last action, with Undo. It floats (a snackbar on phones, over the foot of the 3D view on
 * desktop) so showing it never resizes the viewer. Undo is offered for a while; nothing is lost when it goes. */
export function OutfitToast() {
  const toast = useSavedOutfits(state => state.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      if (useSavedOutfits.getState().toast?.id === toast.id) dismissToast();
    }, toast.undo ? 12_000 : 8_000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return <div role="status" aria-live="polite"
    className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 lg:absolute lg:inset-x-0 lg:bottom-[calc(100%+8px)]">
    {toast && <div key={toast.id} className="pointer-events-auto flex animate-rise items-center gap-2 border border-ink-600 bg-ink-850 py-1.5 pl-3 pr-1.5 text-xs leading-snug text-fg shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]">
      <p className="flex-1">{toast.message}</p>
      {toast.undo && <button type="button" onClick={toast.undo} className="hud h-8 shrink-0 bg-fg px-3 text-ink-950 hover:bg-white">Undo</button>}
      <button type="button" onClick={dismissToast} aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center text-fg-dim hover:text-fg"><CloseIcon size={12} /></button>
    </div>}
  </div>;
}
