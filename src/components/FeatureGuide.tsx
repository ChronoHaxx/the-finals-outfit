import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FEATURES, FEATURE_GROUPS, POINTER_SHORTCUTS, TOUCH_SHORTCUTS, TOUR, TOUR_TEXT, type Feature, type GuideCondition,
  type GuideShortcut,
} from "../data/feature-guide";
import { featureUsed, useDiscovery, useMarked, useTour } from "../lib/discovery";
import { chinalsAvailable } from "../lib/site-mode";
import { SHARE_PREVIEW_BASE } from "../lib/share-preview";
import { isTypingTarget } from "../lib/viewer-chrome";
import { useGuideStore } from "../store/useGuideStore";
import { canShowFeature, Keys, showFeature, startTour } from "./Discovery";
import { CheckIcon, GuideIcon, ViewfinderIcon } from "./Icons";
import { PanelHeader } from "./ViewerPanel";
import { usePrivacyStore } from "../store/usePrivacyStore";

// The Guide (22 Nov 2026; before, "What you can do"): a compact sheet from the top bar's Guide button or the ? key. It
// does not describe where things are; it points at them. Three parts:
// - the tour (start, resume from where it stopped, or replay);
// - an index of the builder's controls, one line each, grouped by what you are doing. Pressing one closes the sheet and
//   frames that control on screen ("Show me"). A tick marks the ones this browser has used;
// - the keys and gestures, the one thing worth reading as a list.
// The words are in src/data/feature-guide.ts. A modal dialog over the builder, so opening it never reloads anything.

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
  return open ? <GuideSheet onClose={hide} /> : null;
}

const GUIDE_ID = "feature-guide";

function GuideSheet({ onClose }: { onClose: () => void }) {
  const showPrivacy = usePrivacyStore(state => state.show);
  const dialog = useRef<HTMLDialogElement>(null);
  const tourButton = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const tour = useTour();
  // On a touch screen the gestures come first.
  const touch = useMemo(() => window.matchMedia("(hover: none)").matches, []);
  const features = useMemo(() => (FEATURES as readonly Feature[]).filter(feature => shown(feature.only)), []);
  // What can be framed right now: read once as the sheet opens (the builder behind it does not change meanwhile).
  const showable = useMemo(() => new Set(features.filter(feature => canShowFeature(feature.id)).map(feature => feature.id)), [features]);
  const used = useDiscovery(() => features.filter(feature => featureUsed(feature.id)).map(feature => feature.id).join(","));
  const marked = useMarked();
  const usedSet = new Set(used ? used.split(",") : []);
  const stops = TOUR.filter(id => showable.has(id)).length;

  // showModal(): the page behind goes inert, focus stays inside, Escape fires `cancel`, and focus returns to the
  // control that opened it.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    tourButton.current?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  // `then` runs once the sheet has gone, so what it starts (the tour, a framed control) is on an unblocked page.
  const close = (then?: () => void) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => { onClose(); if (then) window.setTimeout(then, 30); },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120);
  };

  // A tour under way (paused, or running behind this sheet) resumes from its stop.
  const resumable = (tour.status === "paused" || tour.status === "running") && !!tour.stop;
  const tourLabel = resumable ? TOUR_TEXT.resume : tour.status === "done" ? TOUR_TEXT.replay : TOUR_TEXT.start;
  const tourDetail = resumable ? `Stop ${TOUR.indexOf(tour.stop!) + 1} of ${TOUR.length}` : `${stops} stops`;

  return (
    <dialog ref={dialog} id={GUIDE_ID} aria-labelledby="guide-title"
      onCancel={event => { event.preventDefault(); close(); }}
      // A native close (a repeated Escape in Chrome) skips `cancel`: keep the store in step.
      onClose={() => { if (!closing && !dialog.current?.open) onClose(); }}
      className={`fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-fg transition-opacity duration-150
        ${closing ? "opacity-0" : ""}`}>
      {/* The builder stays in view behind a light dim: what the guide points at is right there. A press on it closes. */}
      <div className="flex size-full justify-end bg-ink-950/45 sm:items-start sm:pr-3 sm:pt-[3.75rem]"
        onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="panel flex h-full w-full animate-drop flex-col overflow-hidden motion-reduce:animate-none sm:h-auto sm:max-h-[calc(100dvh-4.5rem)] sm:w-[26rem]">
          <PanelHeader title="Guide" icon={<GuideIcon size={13} />} onClose={() => close()} closeLabel="Close the guide">
            <h2 id="guide-title" className="sr-only">Guide</h2>
            <span className="hud ml-1 tabular-nums text-fg-dim">Tried {usedSet.size} of {features.length}</span>
          </PanelHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="border-b border-line p-3">
              <button ref={tourButton} type="button" disabled={stops === 0}
                onClick={() => close(() => startTour(resumable ? "resume" : "start", "guide"))}
                className="chamfer flex h-12 w-full items-center justify-between gap-3 bg-finals pl-4 pr-5 text-white transition-colors [--cut:12px] hover:bg-finals-hi disabled:bg-ink-700 disabled:text-fg-muted">
                <span className="text-[22px] font-extrabold uppercase tracking-[0.01em] [font-stretch:62.5%]">{tourLabel}</span>
                <span className="hud text-white/75">{tourDetail}</span>
              </button>
            </div>

            {FEATURE_GROUPS.map(group => {
              const items = features.filter(feature => feature.group === group.id);
              if (!items.length) return null;
              return <section key={group.id} aria-labelledby={`guide-${group.id}`} className="pt-3">
                <h3 id={`guide-${group.id}`} className="hud px-3 pb-1 text-fg-dim">{group.title}</h3>
                <ul>{items.map(feature => <li key={feature.id}>
                  <GuideRow feature={feature} used={usedSet.has(feature.id)} marked={marked.has(feature.id)} available={showable.has(feature.id)}
                    onShow={() => close(() => showFeature(feature.id as Parameters<typeof showFeature>[0]))} />
                </li>)}</ul>
              </section>;
            })}

            <section aria-labelledby="guide-keys" className="mt-3 border-t border-line p-3">
              <h3 id="guide-keys" className="hud text-fg-dim">Keys and gestures</h3>
              <div className="mt-2 grid gap-4">
                {(touch ? [TOUCH_LIST, POINTER_LIST] : [POINTER_LIST, TOUCH_LIST]).map(list =>
                  <ShortcutList key={list.title} title={list.title} shortcuts={list.shortcuts} />)}
              </div>
            </section>

            <div className="border-t border-line p-3">
              <button type="button" onClick={showPrivacy}
                className="text-xs text-fg-muted underline underline-offset-2 transition-colors hover:text-fg">
                Privacy: what this site counts, and how to opt out
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

const POINTER_LIST = { title: "Mouse and keyboard", shortcuts: POINTER_SHORTCUTS };
const TOUCH_LIST = { title: "Touch", shortcuts: TOUCH_SHORTCUTS };

function GuideRow({ feature, used, marked, available, onShow }: {
  feature: Feature; used: boolean; marked: boolean; available: boolean; onShow(): void;
}) {
  const body = <>
    {/* Tried here: a tick. Not yet: a hollow square, with the red cut corner on the few the controls themselves wear. */}
    <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center">
      {used ? <CheckIcon size={11} className="text-fg-muted" />
        : <span className={`size-2.5 border border-ink-600 ${marked ? "bg-[linear-gradient(225deg,var(--color-finals)_0_5px,transparent_5px)]" : ""}`} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-semibold uppercase leading-tight tracking-[0.02em] [font-stretch:87.5%]">{feature.name}</span>
        <span className="sr-only">{used ? "(tried)" : "(not tried yet)"}</span>
        {feature.keys && <Keys keys={feature.keys} />}
      </span>
      <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{feature.hint}</span>
      {!available && feature.needs && <span className="mt-0.5 block text-[11px] leading-snug text-fg-dim">{feature.needs} to see it.</span>}
    </span>
  </>;
  if (!available) return <div className="flex items-start gap-2.5 px-3 py-2">{body}</div>;
  return <button type="button" onClick={onShow} aria-label={`Show me ${feature.name}: ${feature.hint}`}
    className="group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink-850 focus-visible:bg-ink-850">
    {body}
    <span aria-hidden="true" className="hud mt-0.5 flex shrink-0 items-center gap-1 text-fg-dim transition-colors group-hover:text-fg">
      <ViewfinderIcon size={12} />Show
    </span>
  </button>;
}

function ShortcutList({ title, shortcuts }: { title: string; shortcuts: readonly GuideShortcut[] }) {
  return <div>
    <h4 className="text-xs text-fg-muted">{title}</h4>
    <dl className="mt-1.5 divide-y divide-line border-y border-line">
      {shortcuts.map(shortcut => <div key={shortcut.action} className="flex items-center gap-3 py-1.5">
        <dt className="flex w-32 shrink-0 flex-wrap gap-1"><Keys keys={shortcut.keys} /></dt>
        <dd className="text-xs text-fg-muted">{shortcut.action}</dd>
      </div>)}
    </dl>
  </div>;
}
