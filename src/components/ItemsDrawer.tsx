import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ChromeLayout } from "../lib/viewer-chrome";
import { ChevronIcon } from "./Icons";

const PANEL_ID = "items-drawer-panel";
/** px a press on the sheet handle must travel to count as a swipe (open upwards, close downwards) rather than a tap. */
const SWIPE_PX = 40;

/**
 * The item picker as a drawer (12 Nov 2026). Side layout: a column at the left whose edge tab opens and closes it; the
 * 3D stage takes the rest of the window. Sheet layout (phones held upright): a panel under the stage whose handle opens
 * and closes it (tap, or swipe up and down); closed, only the handle is left and the stage fills the screen.
 *
 * The panel stays mounted when closed, so the picker keeps its slot, search, filters and scroll. Closed, it is `inert`
 * (out of the tab order and the accessibility tree) and hidden, and the toggle stays reachable.
 */
export function ItemsDrawer({ layout, open, onOpenChange, pieces, children }: {
  layout: ChromeLayout; open: boolean; onOpenChange(open: boolean): void; pieces: number; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The sheet's panel is its own scroller and leaves the page when closed (display: none), which some browsers answer by
  // resetting its scroll. Keep the position across a close and an open.
  const scroll = useRef(0);
  useLayoutEffect(() => {
    if (layout !== "sheet") return;
    const element = panel.current;
    if (open && element) element.scrollTop = scroll.current;
  }, [open, layout]);
  const setOpen = (next: boolean) => {
    if (!next && panel.current) scroll.current = panel.current.scrollTop;
    onOpenChange(next);
  };

  // A swipe on the handle: pointer capture keeps the gesture ours past the handle's edge; the click that follows a
  // swipe is swallowed so it does not toggle back.
  const press = useRef<{ id: number; y: number } | null>(null);
  const swiped = useRef(false);
  const handleGesture = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary) return;
      press.current = { id: event.pointerId, y: event.clientY };
      swiped.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      const start = press.current;
      press.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) < SWIPE_PX) return;
      swiped.current = true;
      setOpen(dy < 0);
    },
    onPointerCancel: () => { press.current = null; },
    onClick: () => {
      if (swiped.current) { swiped.current = false; return; }
      setOpen(!open);
    },
  };

  const label = open ? "Hide items" : "Show items";
  const sheet = layout === "sheet";

  // One tree for both layouts, toggle first and panel second, so turning a phone between upright (sheet) and sideways
  // (side) only changes classes: the picker inside is never remounted and keeps its slot, search and scroll.
  // Side: the aside holds the column's width only while open and the panel is positioned in it, so closing changes no
  // size inside (the picker's own scrollers keep their place). Sheet: the panel is the scroller; closed, only the
  // handle is left.
  return (
    <aside aria-label="Items" style={sheet ? undefined : { width: open ? "var(--drawer-w)" : 0 }}
      className={sheet ? `relative z-20 flex flex-col border-t border-line bg-ink-950 ${open ? "min-h-0 flex-1" : "shrink-0 pb-[env(safe-area-inset-bottom)]"}`
        : "relative z-20 shrink-0"}>
      {sheet ? (
        <button type="button" {...handleGesture} aria-expanded={open} aria-controls={PANEL_ID} aria-label={label}
          title={`${label} (or swipe ${open ? "down" : "up"})`}
          className={`relative flex h-11 w-full shrink-0 touch-none select-none items-center gap-2.5 px-3 text-left ${open ? "border-b border-line" : ""}`}>
          <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 bg-ink-600" />
          <ChevronIcon size={14} className={`text-fg-muted transition-transform ${open ? "" : "rotate-180"}`} />
          <span className="hud text-fg">Items</span>
          <span className="hud tabular-nums text-fg-dim">{pieces} {pieces === 1 ? "piece" : "pieces"} on</span>
          <span className="hud ml-auto text-fg-dim">{open ? "Hide" : "Show"}</span>
        </button>
      ) : (
        // The edge tab: rides on the panel's right edge, over the stage's top-left corner.
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={PANEL_ID} aria-label={label}
          title={label}
          className="absolute left-full top-3 z-10 flex h-20 w-7 flex-col items-center justify-center gap-2 border border-l-0 border-line bg-ink-950/90 text-fg-muted transition-colors hover:bg-ink-950 hover:text-fg">
          <ChevronIcon size={13} className={open ? "rotate-90" : "-rotate-90"} />
          <span aria-hidden="true" className="hud [writing-mode:vertical-rl]">Items</span>
        </button>
      )}
      <div ref={panel} id={PANEL_ID} inert={!open} data-drawer-scroll=""
        className={sheet
          ? (open ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]" : "hidden")
          : `absolute inset-y-0 left-0 flex w-(--drawer-w) flex-col border-r border-line bg-ink-950 max-lg:overflow-y-auto max-lg:overscroll-contain ${open ? "" : "invisible -translate-x-full"}`}>
        {children}
      </div>
    </aside>
  );
}
