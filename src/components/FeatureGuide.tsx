import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FEATURE_GUIDE, POINTER_SHORTCUTS, TOUCH_SHORTCUTS, type GuideCondition, type GuideSection, type GuideShortcut,
} from "../data/feature-guide";
import { chinalsAvailable } from "../lib/site-mode";
import { SHARE_PREVIEW_BASE } from "../lib/share-preview";
import { isTypingTarget } from "../lib/viewer-chrome";
import { useGuideStore } from "../store/useGuideStore";
import { CloseIcon } from "./Icons";

// "What you can do" (21 Nov 2026): every feature of the builder and where its control is, one tap or the ? key away.
// The content is src/data/feature-guide.ts. It opens only when asked: from the welcome screen, the top bar's Guide
// button, a one-time hint, or ?. A modal dialog over the builder rather than a page, so opening it never reloads the
// character or loses the picker's place.

const shown = (only: GuideCondition | undefined) =>
  only === undefined || (only === "chinals" ? chinalsAvailable() : SHARE_PREVIEW_BASE !== "");

/** ? opens the guide and closes it again; never while typing, with a modifier, or over another dialog. */
export function guideKeyAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "defaultPrevented" | "isComposing" | "target">,
  open: boolean, otherDialogOpen: boolean): "show" | "hide" | null {
  if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented
    || event.isComposing || isTypingTarget(event.target)) return null;
  if (open) return "hide";
  return otherDialogOpen ? null : "show";
}

export default function FeatureGuide() {
  const open = useGuideStore(state => state.open);
  const show = useGuideStore(state => state.show);
  const hide = useGuideStore(state => state.hide);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const others = [...document.querySelectorAll("dialog[open]")].some(dialog => dialog.id !== GUIDE_ID);
      const action = guideKeyAction(event, useGuideStore.getState().open, others);
      if (!action) return;
      event.preventDefault();
      if (action === "show") show(); else hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, hide]);
  return open ? <GuideDialog onClose={hide} /> : null;
}

const GUIDE_ID = "feature-guide";
const POINTER_LIST = { title: "Mouse and keyboard", shortcuts: POINTER_SHORTCUTS };
const TOUCH_LIST = { title: "Touch", shortcuts: TOUCH_SHORTCUTS };

function GuideDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  // On a touch screen the phone section and the touch gestures come first.
  const touch = useMemo(() => window.matchMedia("(hover: none)").matches, []);
  const sections = useMemo(() => {
    const visible = FEATURE_GUIDE.filter(section => shown(section.only))
      .map(section => ({ ...section, items: section.items.filter(item => shown(item.only)) }))
      .filter(section => section.items.length > 0);
    return touch ? [...visible.filter(s => s.id === "phone"), ...visible.filter(s => s.id !== "phone")] : visible;
  }, [touch]);

  // showModal(): the page behind goes inert, focus stays inside, Escape fires `cancel`, and focus returns to the
  // control that opened it.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduced ? 0 : 140);
  };

  return (
    <dialog ref={dialog} id={GUIDE_ID} aria-labelledby="guide-title" aria-describedby="guide-summary"
      onCancel={event => { event.preventDefault(); close(); }}
      // A native close (a repeated Escape in Chrome) skips `cancel`: keep the store in step.
      onClose={() => { if (!closing && !dialog.current?.open) onClose(); }}
      className={`fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-fg transition-opacity duration-150
        ${closing ? "opacity-0" : "animate-fade"}`}>
      {/* The dimmed builder behind: a press on it closes the guide. */}
      <div className="flex size-full items-stretch justify-center bg-ink-950/75 sm:items-center sm:p-6"
        onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="relative flex h-full w-full flex-col overflow-hidden border-line bg-ink-950 sm:h-auto sm:max-h-[min(92dvh,56rem)] sm:max-w-5xl sm:border">
          <div aria-hidden="true" className="stripes pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-finals" />

          <header className="relative flex shrink-0 items-start gap-4 border-b border-line py-4 pl-5 pr-2 sm:pl-8 sm:pt-6">
            <div className="min-w-0 flex-1">
              <p className="hud flex items-center gap-2 text-fg-muted"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Outfit Builder</p>
              <h2 id="guide-title" className="display mt-2 text-[clamp(40px,7vw,64px)]">What you can do</h2>
              <p id="guide-summary" className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
                Everything the builder already does, and where to find it.
                {touch ? <> Tap <Key>?</Key> at the top to open this again.</> : <> Press <Key>?</Key> to open this again.</>}
              </p>
            </div>
            <button ref={closeButton} type="button" onClick={close} aria-label="Close" title="Close (Esc)"
              className="grid size-10 shrink-0 place-items-center text-fg-muted hover:text-fg">
              <CloseIcon />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-6 sm:px-8">
            <div className="gap-x-12 lg:columns-2">
              {sections.map(section => <GuideSectionBlock key={section.id} section={section} />)}
            </div>

            <section aria-labelledby="guide-keys" className="mt-2 border-t border-line pt-6">
              <h3 id="guide-keys" className="hud flex items-center gap-2 text-fg"><span aria-hidden="true" className="h-px w-3 bg-finals" />Keys and gestures</h3>
              <div className="mt-4 grid gap-x-12 gap-y-6 md:grid-cols-2">
                {(touch ? [TOUCH_LIST, POINTER_LIST] : [POINTER_LIST, TOUCH_LIST]).map(list =>
                  <ShortcutList key={list.title} title={list.title} shortcuts={list.shortcuts} />)}
              </div>
            </section>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function GuideSectionBlock({ section }: { section: GuideSection }) {
  const headingId = `guide-${section.id}`;
  return <section aria-labelledby={headingId} className="mb-7 break-inside-avoid">
    <h3 id={headingId} className="hud flex items-center gap-2 text-fg"><span aria-hidden="true" className="h-px w-3 bg-finals" />{section.title}</h3>
    <ul className="mt-3 space-y-3.5">
      {section.items.map(item => <li key={item.id}>
        <p className="text-[15px] font-bold uppercase leading-tight tracking-[0.01em] [font-stretch:75%]">{item.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.text}</p>
        {item.where && <p className="hud mt-1.5 text-[11px] normal-case tracking-[0.04em] text-fg-dim">
          <span aria-hidden="true" className="mr-1.5 text-finals">›</span><span className="sr-only">Where: </span>{item.where}
        </p>}
      </li>)}
    </ul>
  </section>;
}

function ShortcutList({ title, shortcuts }: { title: string; shortcuts: readonly GuideShortcut[] }) {
  return <div>
    <h4 className="hud text-fg-muted">{title}</h4>
    <dl className="mt-2 divide-y divide-line border-y border-line">
      {shortcuts.map(shortcut => <div key={shortcut.action} className="flex items-center gap-4 py-2">
        <dt className="flex w-36 shrink-0 flex-wrap gap-1">{shortcut.keys.map(key => <Key key={key}>{key}</Key>)}</dt>
        <dd className="text-sm text-fg-muted">{shortcut.action}</dd>
      </div>)}
    </dl>
  </div>;
}

function Key({ children }: { children: string }) {
  return <kbd className="inline-grid h-6 min-w-6 place-items-center border border-ink-600 bg-ink-850 px-1.5 font-sans text-[11px] font-semibold leading-none text-fg">
    {children}
  </kbd>;
}
