import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHANGELOG, LATEST_CHANGELOG_ID } from "../data/changelog";
import { CATALOG_UPDATE } from "../data/catalog-update";
import { getBrowseItems, getBrowseItemsBySlot } from "../lib/browse-catalog";
import { derivedFromCatalog } from "../lib/catalog";
import { SLOTS } from "../lib/slots";
import { PROGRESS_ORDER } from "../lib/reconstruction-progress";
import { REVIEW_COLOURS, REVIEW_MEANINGS, REVIEW_STYLES } from "../lib/reconstruction-status";
import { readOutfitLink } from "../lib/share-url";
import { AUTOMATED } from "../lib/automation";
import { useIntroStore } from "../store/useIntroStore";
import PatchNotes from "./PatchNotes";
import { ArrowIcon, CloseIcon } from "./Icons";

const SEEN_KEY = "tfo:patch-notes-seen";
// Storage can be missing or throw (private windows, blocked site data); the dialog then simply
// shows on each visit, which is the honest fallback for "we can't tell if you've seen this".
function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function writeSeen(id: string) {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* see readSeen */ }
}

// Computed on first use: the catalog loads after modules evaluate (src/main.tsx).
const catalogStats = derivedFromCatalog(() => ({
  items: getBrowseItems().length,
  slots: SLOTS.filter(slot => getBrowseItemsBySlot(slot).length > 0).length,
}));

// Opens by itself once per changelog entry: on a first visit, and again when a newer entry ships.
// Never under automation, where it would sit over every harness screenshot.
export default function IntroDialog() {
  const open = useIntroStore(s => s.open);
  const show = useIntroStore(s => s.show);
  // Read before the dialog writes it, so the panel can flag every entry that is new to this visitor.
  const [seenAtLoad] = useState(readSeen);
  useEffect(() => {
    if (!AUTOMATED && seenAtLoad !== LATEST_CHANGELOG_ID) show();
  }, [show, seenAtLoad]);
  const seenIndex = CHANGELOG.findIndex(entry => entry.id === seenAtLoad);
  return open ? <IntroContent fresh={seenIndex > 0 ? seenIndex : 1} /> : null;
}

function IntroContent({ fresh }: { fresh: number }) {
  const hide = useIntroStore(s => s.hide);
  const dialog = useRef<HTMLDialogElement>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const shared = useMemo(() => { try { return !!readOutfitLink(window.location.href); } catch { return false; } }, []);
  const stats = catalogStats();

  // showModal() gives the real modal behaviour: the page behind becomes inert, focus is held
  // inside, Escape fires `cancel`, and focus returns to the opener on close.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    cta.current?.focus();
    return () => element.close();
  }, []);

  const close = () => {
    if (closing) return;
    writeSeen(LATEST_CHANGELOG_ID);
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(hide, reduced ? 0 : 160);
  };

  return (
    // `cancel` (Escape) is intercepted to animate out. Chrome may still close a dialog natively on a
    // repeated Escape without firing it; `onClose` keeps the store in step so it can reopen.
    <dialog ref={dialog} aria-labelledby="intro-title" onCancel={event => { event.preventDefault(); close(); }}
      // The event is queued, so it can arrive after a remount has reopened the dialog: act only if
      // the dialog really is closed now.
      onClose={() => { if (!closing && !dialog.current?.open) { writeSeen(LATEST_CHANGELOG_ID); hide(); } }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-ink-950 p-0 text-fg transition-opacity duration-150
        ${closing ? "opacity-0" : "animate-fade"}`}>
      {/* Set dressing: hatching and one red key light. Static, so it costs nothing per frame. */}
      <div aria-hidden="true" className="stripes pointer-events-none fixed inset-0" />
      <div aria-hidden="true" className="pointer-events-none fixed -right-[20vmax] -top-[30vmax] size-[80vmax] bg-[radial-gradient(closest-side,rgb(210_31_60/0.16),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-y-0 left-0 w-1 bg-finals" />

      <div className="relative flex min-h-full flex-col">
        {/* Broadcast ticker */}
        <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-ink-950/95 pl-5 pr-2 sm:pl-8">
          <span className="hud flex shrink-0 items-center gap-1.5 text-finals">
            <span aria-hidden="true" className="size-1.5 animate-blink rounded-full bg-finals" />On air
          </span>
          <span className="hud truncate text-fg-dim">
            Catalog seasons 1–{CATALOG_UPDATE.throughSeason} · Updated {CATALOG_UPDATE.updatedLabel} · Season {CATALOG_UPDATE.nextSeason} in progress
          </span>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto grid size-9 shrink-0 place-items-center text-fg-muted hover:text-fg">
            <CloseIcon />
          </button>
        </div>

        <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-14 lg:py-14">
          <div className="min-w-0">
            <p className="hud flex animate-rise items-center gap-2 text-fg-muted">
              <span aria-hidden="true" className="h-3 w-1 bg-finals" />Fan-made for THE FINALS
            </p>
            <h1 id="intro-title" className="display mt-4 animate-rise text-[clamp(76px,14vw,168px)] [animation-delay:50ms]">
              Outfit<br /><span className="text-finals">Builder</span>
            </h1>
            <p className="mt-6 max-w-md animate-rise text-[17px] leading-relaxed text-fg-muted [animation-delay:100ms]">
              Put a contestant together from the cosmetic catalog, look at it from every side in 3D, and share the look as a link.
            </p>

            <dl className="mt-8 grid max-w-md animate-rise grid-cols-3 divide-x divide-line border-y border-line [animation-delay:150ms]">
              {[[stats.items.toLocaleString("en"), "Cosmetics"], [String(stats.slots), "Slots"], [`S1–${CATALOG_UPDATE.throughSeason}`, "Seasons"]]
                .map(([value, label]) => <div key={label} className="flex flex-col-reverse gap-1 px-4 py-3 first:pl-0">
                  <dt className="hud text-fg-dim">{label}</dt>
                  <dd className="display text-[36px] tabular-nums">{value}</dd>
                </div>)}
            </dl>

            <div className="mt-8 flex animate-rise flex-wrap items-center gap-x-5 gap-y-3 [animation-delay:200ms]">
              <button ref={cta} type="button" onClick={close}
                className="chamfer group flex h-14 items-center gap-3 bg-finals pl-6 pr-8 text-[26px] font-extrabold uppercase tracking-[0.01em] text-white transition-colors [--cut:14px] [font-stretch:62.5%] hover:bg-finals-hi">
                {shared ? "View shared outfit" : "Enter builder"}
                <ArrowIcon size={20} className="transition-transform duration-200 group-hover:translate-x-1" />
              </button>
              <span className="hud hidden text-fg-dim sm:block">or press Esc</span>
            </div>

            <section aria-labelledby="intro-tags" className="mt-12 max-w-lg animate-rise [animation-delay:250ms]">
              <h2 id="intro-tags" className="hud text-fg-muted">Reading the 3D tags</h2>
              <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {PROGRESS_ORDER.filter(status => status !== "unknown").map(status => <li key={status} className="flex gap-2.5">
                  <span aria-hidden="true" className={`mt-0.5 h-fit shrink-0 px-1 py-[3px] text-[8px] font-bold leading-none ${REVIEW_STYLES[status]}`}>3D</span>
                  <span className="text-xs leading-relaxed text-fg-dim"><span className="font-semibold text-fg-muted">{REVIEW_COLOURS[status]}.</span> {REVIEW_MEANINGS[status]}</span>
                </li>)}
              </ul>
            </section>
          </div>

          <section aria-label="Patch notes" className="min-w-0 animate-rise [animation-delay:120ms]">
            <PatchNotes headingId="intro-notes" fresh={fresh} className="lg:max-h-[min(72vh,44rem)]" />
          </section>
        </div>

        <p className="mx-auto w-full max-w-6xl px-5 pb-6 text-xs leading-relaxed text-fg-dim sm:px-8">
          Fan project. Not affiliated with or endorsed by Embark Studios. THE FINALS is a trademark of Embark Studios AB.
        </p>
      </div>
    </dialog>
  );
}
