import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";
import { NUDGES, TOUR, TOUR_TEXT, featureById, type Feature, type FeatureId } from "../data/feature-guide";
import { AUTOMATED } from "../lib/automation";
import { featureUsed, markSeen, markUsed, setTour, tourState, useTour } from "../lib/discovery";
import { inflate, isControlSized, nearest, place, type Box, type Placement, type Side } from "../lib/discovery-layout";
import { dismissHint, hintDismissed, type HintId } from "../lib/hints";
import { isTypingTarget, requestDrawerOpen } from "../lib/viewer-chrome";
import { ArrowIcon, CloseIcon } from "./Icons";

// The discovery layer (22 Nov 2026): the builder explains itself where its controls are, instead of in a page of text.
//
// - Callouts. Bring the pointer near a control you have not pressed yet and, after a beat, a one-line callout names it,
//   says what it does and shows its key. Once you have used it, it waits for a direct hover, like a tooltip. A keyboard
//   focus shows it at once (and describes the control to screen readers). Esc dismisses it; it can be hovered.
// - The tour. Viewfinder brackets frame each control in turn (the one orchestrated motion: they glide from control to
//   control), with a card that says what it does. Nothing is blocked: the dimmed page still works. Esc or End tour stops
//   it where it is; it resumes from that stop.
// - Show me. The Guide sheet's index frames one control the same way, for a moment.
// - Nudges. Two one-time callouts tied to an action (pausing an emote, a first emote), each shown once per browser.
//
// Touch screens have no hover, so they get the tour and Show me. Nothing here shows to automated browsers, under the
// hidden UI (H), or while a modal dialog is open. The words are all in src/data/feature-guide.ts; what a visitor has
// found is in lib/discovery.ts.

// ---------------------------------------------------------------------------------------------------------------------
// What the layer is doing right now (this page only).

const useLayer = create<{ show: FeatureId | null; nudge: HintId | null; direction: 1 | -1 }>(() => ({ show: null, nudge: null, direction: 1 }));

/** Frames one control for a moment (the Guide sheet's "Show me"). */
export function showFeature(id: FeatureId): void {
  if (AUTOMATED) return;
  // Asking for one control mid-tour stops the tour where it is (it resumes from there).
  if (tourState().status === "running") endTour("paused");
  useLayer.setState({ show: id });
}

/** A one-time nudge, if this browser has not had it. One at a time: an earlier entry in NUDGES takes over from a later
 *  one (pausing an emote outranks the keys tip); otherwise the second waits for another moment. */
export function nudge(id: HintId): void {
  if (AUTOMATED || hintDismissed(id)) return;
  const showing = useLayer.getState().nudge;
  const order = Object.keys(NUDGES);
  if (showing && order.indexOf(showing) <= order.indexOf(id)) return;
  useLayer.setState({ nudge: id });
}

let focusBeforeTour: Element | null = null;

/** Starts the tour: from where it was left ("resume", the default) or from the first stop. */
export function startTour(from: "resume" | "start" = "resume"): void {
  if (AUTOMATED) return;
  const tour = tourState();
  focusBeforeTour = document.activeElement;
  useLayer.setState({ direction: 1, show: null });
  const resumable = (tour.status === "paused" || tour.status === "running") && tour.stop;
  setTour({ status: "running", stop: from === "resume" && resumable ? tour.stop : TOUR[0] });
}

function endTour(status: "paused" | "done") {
  const tour = tourState();
  setTour({ status, stop: status === "done" ? null : tour.stop });
  const back = focusBeforeTour;
  focusBeforeTour = null;
  if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
}

function moveTour(from: FeatureId, direction: 1 | -1) {
  const index = TOUR.indexOf(from) + direction;
  useLayer.setState({ direction });
  if (index >= TOUR.length) endTour("done");
  else if (index < 0) setTour({ status: "running", stop: TOUR[0] });
  else setTour({ status: "running", stop: TOUR[index] });
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding controls.

const selector = (id: string) => `[data-feature="${CSS.escape(id)}"]`;

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** On screen and usable: laid out, not hidden, not inside an inert part of the page (a closed drawer, the hidden UI). */
function visible(element: Element): boolean {
  if (element.closest("[inert]")) return false;
  const box = boxOf(element);
  if (box.width < 1 || box.height < 1) return false;
  const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  return check ? check.call(element, { visibilityProperty: true }) : true;
}

export const findFeature = (id: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>(selector(id))].find(visible) ?? null;

/** Present on this page, even if inside the closed drawer (which "Show me" and the tour can open). */
export function canShowFeature(id: string): boolean {
  return [...document.querySelectorAll<HTMLElement>(selector(id))]
    .some(element => visible(element) || !!element.closest("[data-drawer-scroll]"));
}

/** A modal dialog over the page, or the hidden UI: the layer stays out of the way. */
function blockedNow(): boolean {
  if (document.documentElement.classList.contains("ui-hidden")) return true;
  try { return !!document.querySelector("dialog:modal"); } catch { return !!document.querySelector("dialog[open]"); }
}

function useBlocked(): boolean {
  const [blocked, setBlocked] = useState(blockedNow);
  useEffect(() => {
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setBlocked(blockedNow()); }); };
    const root = new MutationObserver(schedule);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const body = new MutationObserver(schedule);
    body.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => { root.disconnect(); body.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return blocked;
}

/** The element's box, followed every frame while shown (drawers slide, sheets scroll, the timeline appears). */
function useTrackedBox(element: Element | null): Box | null {
  const [box, setBox] = useState<Box | null>(() => element ? boxOf(element) : null);
  useEffect(() => {
    if (!element) { setBox(null); return; }
    let frame = 0, last = "";
    const tick = () => {
      const next = boxOf(element), key = `${Math.round(next.left)},${Math.round(next.top)},${Math.round(next.width)},${Math.round(next.height)}`;
      if (key !== last) { last = key; setBox(next); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [element]);
  return box;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------------------------------------------------
// Using a control counts: a press, a change, or its key.

const KEY_FEATURES: Record<string, FeatureId> = { h: "hide-ui", H: "hide-ui", ",": "timeline", ".": "timeline", "<": "emote-speed", ">": "emote-speed", "?": "guide" };

function useUsageTracking() {
  useEffect(() => {
    const use = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>("[data-feature]") : null;
      if (element?.dataset.feature) markUsed(element.dataset.feature);
    };
    const onClick = (event: MouseEvent) => use(event.target);
    const onInput = (event: Event) => use(event.target);
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || isTypingTarget(event.target)) return;
      const id = KEY_FEATURES[event.key];
      if (id && document.querySelector(selector(id))) markUsed(id);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pointer and focus callouts.

/** How near (px) the pointer must come to a control not yet used, how long it rests first, and the polite delay. */
const RADIUS = 28, EAGER_MS = 180, POLITE_MS = 550, GRACE_MS = 160, WARM_MS = 500;
/** Somewhere the pointer is busy with something else: no neighbouring control is called over from here. */
const INTERACTIVE = "button, a[href], input, select, textarea, label, summary, [role=dialog], [role=group], [role=tooltip], [role=slider]";
/** A screen that can hover at all (a mouse, a trackpad, a pen); a phone or tablet alone gets the tour and Show me. */
const canHover = () => window.matchMedia("(any-hover: hover)").matches;

interface Target { id: FeatureId; element: HTMLElement; source: "pointer" | "focus" }

const CALLOUT_ID = "discovery-callout";

function eligible(element: HTMLElement): boolean {
  return element.getAttribute("aria-expanded") !== "true" && !element.matches(":disabled") && visible(element);
}

function usePointerCallout(active: boolean, overCallout: { current: boolean }): [Target | null, () => void] {
  const [target, setTarget] = useState<Target | null>(null);
  const hideRef = useRef(() => {});
  useEffect(() => {
    if (!active) { setTarget(null); return; }
    let timer = 0, x = -1, y = -1, pressed = false, inside = true;
    let pending: HTMLElement | null = null, pendingTimer = 0, graceTimer = 0, shown: HTMLElement | null = null, lastHidden = -Infinity;
    const clear = () => { window.clearTimeout(pendingTimer); pending = null; };
    const hide = () => {
      window.clearTimeout(graceTimer); graceTimer = 0; clear();
      if (shown) lastHidden = performance.now();
      shown = null;
      setTarget(null);
    };
    hideRef.current = hide;
    const show = (element: HTMLElement) => {
      window.clearTimeout(graceTimer); graceTimer = 0;
      shown = element;
      setTarget({ id: element.dataset.feature as FeatureId, element, source: "pointer" });
    };
    const evaluate = () => {
      timer = 0;
      if (pressed || !inside) { hide(); return; }
      // Only open ground calls a neighbour over: on a control (or in a panel), only that control itself may answer.
      const under = document.elementFromPoint(x, y);
      if (under?.closest(`#${CALLOUT_ID}`)) return;
      const own = under?.closest<HTMLElement>("[data-feature]") ?? null;
      const busy = !own && !!under?.closest(INTERACTIVE);
      const candidates = (own ? [own] : busy ? [] : [...document.querySelectorAll<HTMLElement>("[data-feature]")]).flatMap(element => {
        const box = boxOf(element);
        if (!isControlSized(box) || !eligible(element)) return [];
        return [{ element, box, radius: featureUsed(element.dataset.feature!) ? 0 : RADIUS }];
      });
      const hit = nearest(x, y, candidates)?.element ?? null;
      if (hit && hit === shown) { window.clearTimeout(graceTimer); graceTimer = 0; clear(); return; }
      if (!hit) {
        clear();
        // A moment's grace, so a pointer crossing to the callout itself (to read it) does not lose it.
        if (shown && !graceTimer && !overCallout.current) {
          graceTimer = window.setTimeout(() => { graceTimer = 0; if (!overCallout.current) hide(); }, GRACE_MS);
        }
        return;
      }
      if (hit === pending) return;
      clear();
      pending = hit;
      const warm = !!shown || performance.now() - lastHidden < WARM_MS;
      const delay = warm ? 0 : featureUsed(hit.dataset.feature!) ? POLITE_MS : EAGER_MS;
      pendingTimer = window.setTimeout(() => { if (pending === hit) { pending = null; show(hit); } }, delay);
    };
    // Measured at most every 50 ms while the pointer moves, not every frame: while an emote plays the page changes every
    // frame, and each measurement would force a layout.
    const schedule = () => { if (!timer) timer = window.setTimeout(evaluate, 50); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      x = event.clientX; y = event.clientY; pressed = event.buttons !== 0; inside = true;
      schedule();
    };
    const down = (event: PointerEvent) => { if (event.pointerType !== "touch") { pressed = true; hide(); } };
    const up = () => { pressed = false; };
    const leave = () => { inside = false; schedule(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("keydown", key);
    return () => {
      hide();
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("keydown", key);
    };
  }, [active, overCallout]);
  return [target, () => hideRef.current()];
}

function useFocusCallout(active: boolean): Target | null {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    if (!active) { setTarget(null); return; }
    const focusIn = (event: FocusEvent) => {
      const focused = event.target instanceof HTMLElement ? event.target : null;
      const element = focused?.closest<HTMLElement>("[data-feature]");
      if (!focused || !element || !focused.matches(":focus-visible") || !isControlSized(boxOf(element))) { setTarget(null); return; }
      setTarget({ id: element.dataset.feature as FeatureId, element: focused, source: "focus" });
    };
    const focusOut = () => setTarget(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setTarget(null); };
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      window.removeEventListener("keydown", key);
    };
  }, [active]);
  return target;
}

// ---------------------------------------------------------------------------------------------------------------------
// The layer.

export default function Discovery() {
  return AUTOMATED ? null : <DiscoveryLayer />;
}

function DiscoveryLayer() {
  useUsageTracking();
  const tour = useTour();
  const show = useLayer(state => state.show);
  const nudgeId = useLayer(state => state.nudge);
  const blocked = useBlocked();
  const touring = tour.status === "running" && !!tour.stop;
  const overCallout = useRef(false);
  const [hover] = useState(canHover);
  const [pointerTarget, hidePointer] = usePointerCallout(!blocked && !touring && !show && hover, overCallout);
  const focusTarget = useFocusCallout(!blocked && !touring && !show);
  if (blocked) return null;
  if (touring) return <TourStop stop={tour.stop!} />;
  if (show) return <ShowMe id={show} />;
  // A nudge (anchored to the timeline) and a control's own callout can show together: a keyboard focus left on a button
  // must not keep a one-time nudge from being seen.
  const callout = focusTarget ?? pointerTarget;
  return <>
    {nudgeId && <Nudge key={nudgeId} id={nudgeId} />}
    {callout && <FeatureCallout key={`${callout.source}-${callout.id}`} target={callout}
      onHover={callout.source === "pointer" ? over => { overCallout.current = over; if (!over) hidePointer(); } : undefined} />}
  </>;
}

/** Callout side preference: the viewer's right-hand column wants its callouts to the left (data-callout-side). */
function preferredSides(element: Element, box: Box): Side[] {
  const side = element.closest<HTMLElement>("[data-callout-side]")?.dataset.calloutSide as Side | undefined;
  const vertical: Side[] = box.top + box.height / 2 < window.innerHeight / 2 ? ["below", "above"] : ["above", "below"];
  return side ? [side, ...vertical, "left", "right"].filter((s, i, all) => all.indexOf(s as Side) === i) as Side[] : [...vertical, "left", "right"];
}

/** Places `content` beside `element`, following it. */
function Anchored({ element, children, className = "", role, id, onHover, gap }: {
  element: HTMLElement; children: (placement: Placement | null) => ReactNode; className?: string; role?: string; id?: string;
  onHover?: (over: boolean) => void; gap?: number;
}) {
  const box = useTrackedBox(element);
  const self = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const node = self.current;
    if (!node || !box) return;
    const target = inflate(box, 2);
    setPlacement(place(target, { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }, { order: preferredSides(element, target), gap }));
  }, [box, element, gap]);
  return (
    <div ref={self} role={role} id={id} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}
      // Off screen and see-through until measured and placed, never `visibility: hidden`: the tour moves focus into its
      // card in the same commit, and a hidden element cannot take focus.
      style={{ left: placement?.left ?? -9999, top: placement?.top ?? -9999, opacity: placement ? undefined : 0 }}
      className={`fixed z-[60] ${className}`}>
      {children(placement)}
    </div>
  );
}

function Notch({ placement }: { placement: Placement | null }) {
  if (!placement || placement.side.startsWith("dock")) return null;
  const at = `${placement.notch - 4}px`;
  const style: CSSProperties = placement.side === "below" ? { top: -4, left: at } : placement.side === "above" ? { bottom: -4, left: at }
    : placement.side === "left" ? { right: -4, top: at } : { left: -4, top: at };
  return <span aria-hidden="true" style={style} className="absolute size-2 rotate-45 bg-ink-950" />;
}

export function Keys({ keys, className = "" }: { keys: readonly string[]; className?: string }) {
  return <span className={`flex shrink-0 gap-1 ${className}`}>
    {keys.map(key => <kbd key={key} className="inline-grid h-5 min-w-5 place-items-center border border-ink-600 bg-ink-850 px-1 font-sans text-[10px] font-semibold leading-none text-fg">{key}</kbd>)}
  </span>;
}

/** The callout's face: the control's name, its key, and one line. Shared by every kind of callout. */
function CalloutBody({ feature, title, text, action }: { feature: Feature; title?: string; text?: string; action?: ReactNode }) {
  return <>
    <span className="flex items-center gap-2">
      <span className="hud text-fg">{title ?? feature.name}</span>
      {!title && feature.keys && <Keys keys={feature.keys} />}
      {action}
    </span>
    <span className="mt-1 block text-xs leading-snug text-fg-muted">{withKeys(text ?? feature.hint)}</span>
  </>;
}

/** `{,}` in a line of hint text is a key cap, drawn as the shortcut lists draw them. */
function withKeys(text: string): ReactNode {
  const parts = text.split(/\{([^}]+)\}/);
  return parts.length === 1 ? text : parts.map((part, i) => i % 2
    ? <kbd key={i} className="mx-px inline-grid h-[18px] min-w-[18px] place-items-center border border-ink-600 bg-ink-850 px-1 align-[1px] font-sans text-[10px] font-semibold leading-none text-fg">{part}</kbd>
    : part);
}

const CALLOUT = "w-max max-w-[min(18rem,calc(100vw-1.5rem))] animate-drop border-l-2 border-finals bg-ink-950 py-2 pl-3 pr-3 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)] motion-reduce:animate-none";

/** Shown long enough to have been read: the control loses its "not tried yet" corner. */
const SEEN_MS = 700;

function FeatureCallout({ target, onHover }: { target: Target; onHover?: (over: boolean) => void }) {
  const feature = featureById(target.id);
  useEffect(() => {
    const timer = window.setTimeout(() => markSeen(target.id), SEEN_MS);
    return () => window.clearTimeout(timer);
  }, [target.id]);
  // A focused control is described by its callout, as a tooltip is (and only while it shows).
  useEffect(() => {
    if (target.source !== "focus" || target.element.hasAttribute("aria-describedby")) return;
    target.element.setAttribute("aria-describedby", CALLOUT_ID);
    return () => target.element.removeAttribute("aria-describedby");
  }, [target]);
  if (!feature) return null;
  return <Anchored element={target.element} role="tooltip" id={CALLOUT_ID} onHover={onHover}
    className={`${CALLOUT} ${onHover ? "" : "pointer-events-none"}`}>
    {placement => <><Notch placement={placement} /><CalloutBody feature={feature} /></>}
  </Anchored>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The spotlight: viewfinder brackets round a control, the rest of the page dimmed. It takes no pointer events.

function Spotlight({ element }: { element: HTMLElement }) {
  const box = useTrackedBox(element);
  if (!box) return null;
  const frame = inflate(box, 6);
  return <div aria-hidden="true"
    style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height, "--b": "var(--color-fg)", "--l": "12px",
      boxShadow: "0 0 0 200vmax rgb(9 9 11 / 0.5)" } as CSSProperties}
    className="brackets pointer-events-none fixed z-[55] transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]" />;
}

/** Waits (up to half a second) for a control to come on screen, opening the drawer if it is inside it. */
function useRevealed(id: FeatureId, onMissing: () => void): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const missing = useRef(onMissing);
  missing.current = onMissing;
  useEffect(() => {
    let frame = 0, tries = 0, cancelled = false;
    setElement(null);
    const attempt = () => {
      if (cancelled) return;
      const found = findFeature(id);
      if (found) {
        found.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
        setElement(found);
        markSeen(id);
        return;
      }
      const hidden = document.querySelector(selector(id));
      if (hidden?.closest("[data-drawer-scroll]") && tries === 0) requestDrawerOpen();
      if (hidden && tries++ < 30) { frame = requestAnimationFrame(attempt); return; }
      missing.current();
    };
    attempt();
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [id]);
  return element;
}

function ShowMe({ id }: { id: FeatureId }) {
  const feature = featureById(id);
  const close = () => useLayer.setState({ show: null });
  const element = useRevealed(id, close);
  useEffect(() => {
    if (!element) return;
    const timer = window.setTimeout(close, 4500);
    // Any press or key afterwards means "got it" (the press still does what it does).
    const done = () => close();
    const arm = window.setTimeout(() => {
      window.addEventListener("pointerdown", done, true);
      window.addEventListener("keydown", done, true);
    }, 250);
    return () => {
      window.clearTimeout(timer); window.clearTimeout(arm);
      window.removeEventListener("pointerdown", done, true);
      window.removeEventListener("keydown", done, true);
    };
  }, [element]);
  if (!element || !feature) return null;
  return <>
    <Spotlight element={element} />
    <Anchored element={element} role="status" className={`${CALLOUT} pointer-events-none`} gap={14}>
      {placement => <><Notch placement={placement} /><CalloutBody feature={feature} /></>}
    </Anchored>
  </>;
}

function Nudge({ id }: { id: HintId }) {
  const entry = NUDGES[id];
  const feature = featureById(entry.feature);
  const element = findFeature(entry.feature);
  const close = (record = true) => { if (record) dismissHint(id); useLayer.setState({ nudge: null }); };
  useEffect(() => {
    if (!element) { useLayer.setState({ nudge: null }); return; } // not now: it can come again at its next moment
    // Shown long enough to count as had; gone after a while, counting only time the tab is visible.
    const had = window.setTimeout(() => dismissHint(id), 1500);
    let left = 9000, started = 0, timer = 0;
    const run = () => { started = performance.now(); timer = window.setTimeout(() => close(), left); };
    const pause = () => { window.clearTimeout(timer); left -= performance.now() - started; };
    const visibility = () => { if (document.hidden) pause(); else run(); };
    if (!document.hidden) run();
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(had); window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [element, id]);
  if (!element || !feature) return null;
  return <Anchored element={element} role="status" className={CALLOUT}>
    {placement => <><Notch placement={placement} />
      <CalloutBody feature={feature} title={entry.title} text={entry.text} action={
        <button type="button" onClick={() => close()} aria-label="Dismiss tip" title="Don't show this tip again"
          className="-my-1 -mr-1.5 ml-auto grid size-6 shrink-0 place-items-center text-fg-dim hover:text-fg">
          <CloseIcon size={10} />
        </button>} />
    </>}
  </Anchored>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The tour.

function TourStop({ stop }: { stop: FeatureId }) {
  const direction = useLayer(state => state.direction);
  // The stops this page has, for "3 / 9". A page with none (another route) pauses the tour rather than ending it.
  const stops = TOUR.filter(id => featureById(id) && canShowFeature(id));
  const element = useRevealed(stop, () => {
    if (stops.length === 0) setTour({ status: "paused", stop });
    else moveTour(stop, direction);
  });
  const feature = featureById(stop);
  const index = stops.indexOf(stop);
  const last = index === stops.length - 1;
  const next = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => { if (element) next.current?.focus({ preventScroll: true }); }, [element]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); endTour("paused"); return; }
      const focus = document.activeElement;
      const ours = !focus || focus === document.body || !!card.current?.contains(focus);
      if (!ours || isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") { event.preventDefault(); moveTour(stop, 1); }
      if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); moveTour(stop, -1); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [stop, index]);

  if (!element || !feature || index < 0) return null;
  return <>
    <Spotlight element={element} />
    <Anchored element={element} gap={16}
      className="panel w-[min(21rem,calc(100vw-1.5rem))] animate-drop motion-reduce:animate-none">
      {() => <div ref={card} role="dialog" aria-modal="false" aria-labelledby="tour-name" aria-describedby="tour-hint">
        <div className="flex h-9 items-center gap-2 border-b border-line pl-3 pr-1">
          <span aria-hidden="true" className="h-3 w-[3px] bg-finals" />
          <span className="hud text-fg">Tour</span>
          <span className="hud tabular-nums text-fg-dim">{index + 1} / {stops.length}</span>
          <button type="button" onClick={() => endTour("paused")} aria-label={TOUR_TEXT.end} title={`${TOUR_TEXT.end} (Esc)`}
            className="ml-auto grid size-8 place-items-center text-fg-dim transition-colors hover:text-fg">
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="p-3 pt-2.5">
          <p className="flex items-center gap-2.5">
            <span id="tour-name" className="display text-[30px]">{feature.name}</span>
            {feature.keys && <Keys keys={feature.keys} />}
          </p>
          <p id="tour-hint" className="mt-1.5 text-sm leading-snug text-fg-muted">{feature.hint}</p>
          {/* Said again on each stop: focus stays on Next, so a screen reader would not hear the new stop otherwise. */}
          <p aria-live="polite" className="sr-only">{`Stop ${index + 1} of ${stops.length}: ${feature.name}. ${feature.hint}`}</p>
          <div className="mt-3.5 flex items-center gap-2">
            <span aria-hidden="true" className="flex min-w-0 flex-1 gap-[3px]">
              {stops.map((id, i) => <span key={id} className={`h-1 flex-1 ${i <= index ? "bg-finals" : "bg-ink-700"}`} />)}
            </span>
            {index > 0 && <button type="button" onClick={() => moveTour(stop, -1)}
              className="hud h-8 border border-ink-600 px-3 text-fg-muted transition-colors hover:border-fg hover:text-fg">{TOUR_TEXT.back}</button>}
            <button ref={next} type="button" onClick={() => last ? endTour("done") : moveTour(stop, 1)}
              className="hud flex h-8 items-center gap-1.5 bg-fg px-3 text-ink-950 transition-colors hover:bg-white">
              {last ? TOUR_TEXT.finish : TOUR_TEXT.next}{!last && <ArrowIcon size={12} />}
            </button>
          </div>
        </div>
      </div>}
    </Anchored>
  </>;
}
