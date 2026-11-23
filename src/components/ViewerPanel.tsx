import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { CloseIcon } from "./Icons";

// The viewer's panels (22 Nov 2026): Lighting, Camera, Capture and Graphics are one kind of thing, so they are built
// from one shell. Before, each copied the same button, box and close rules with small differences; now they share:
//
// - the trigger: icon, name, chevron. A chevron means "opens a panel"; a square icon button with no chevron (Hide
//   controls, Full screen) acts at once. On a narrow 3D view the names give way and the icons stay.
// - the panel: anchored to the whole top row (so it opens inside the screen whichever button it belongs to), a header
//   naming it with a close button for touch screens, the same surface and the same short drop as it opens.
// - closing: a press outside, Escape (focus goes back to the button), the close button, or the trigger again. A panel
//   that is watched while the 3D view moves (Lighting with its bulbs shown, Camera) stays open for presses on the view.

export interface Panel {
  open: boolean;
  setOpen(open: boolean): void;
  root: RefObject<HTMLDivElement | null>;
  button: RefObject<HTMLButtonElement | null>;
  panelId: string;
  /** The 3D view's size when the panel opened (0 before): the panel scrolls inside it. */
  viewer: { width: number; height: number };
}

export function usePanel(keepOpenFor?: (target: Element) => boolean): Panel {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const keepOpen = useRef(keepOpenFor);
  keepOpen.current = keepOpenFor;

  useEffect(() => {
    if (!open) return;
    const element = root.current?.closest("[data-viewer]");
    if (element) setViewer({ width: element.clientWidth, height: element.clientHeight });
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || root.current?.contains(target)) return;
      if (keepOpen.current?.(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return { open, setOpen, root, button, panelId, viewer };
}

/** True for a press on the 3D view itself (its canvas), the one place some panels stay open for. */
export const onViewerCanvas = (target: Element) => target instanceof HTMLCanvasElement && !!target.closest("[data-viewer]");

/** The look every viewer button shares (the emote and animation buttons use it too). */
export const VIEWER_BUTTON = "hud flex h-8 items-center gap-2 bg-ink-950/80 px-2.5 text-fg transition-colors hover:bg-ink-950 disabled:opacity-50";

export function Chevron({ open }: { open: boolean }) {
  return <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
    <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

/**
 * A panel's button. `name` collapses to the icon below `collapse` (a container query on the viewer's overlay), unless
 * `always` keeps it, as the Lighting button keeps the look's name. Extra props (data-feature, aria-label) pass through.
 */
export function PanelTrigger({ panel, icon, name, collapse = "@2xl:inline", always, detail, className = "", ...props }: {
  panel: Panel; icon: ReactNode; name: ReactNode; collapse?: string; always?: boolean; detail?: ReactNode; className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "name">) {
  return (
    <button ref={panel.button} type="button" onClick={() => panel.setOpen(!panel.open)} aria-expanded={panel.open}
      aria-controls={panel.panelId} {...props}
      className={`${VIEWER_BUTTON} aria-expanded:bg-ink-950 ${className}`}>
      {icon}
      <span className={always ? "whitespace-nowrap" : `hidden whitespace-nowrap ${collapse}`}>{name}</span>
      {detail}
      <Chevron open={panel.open} />
    </button>
  );
}

/**
 * The panel itself, mounted only while open. `label` is its accessible name (kept stable: test scripts find panels by
 * it); `title` is the short name in its header, the same word as its button.
 */
export function PanelSheet({ panel, label, title, icon, width = "w-80", children }: {
  panel: Panel; label: string; title: string; icon: ReactNode; width?: string; children: ReactNode;
}) {
  if (!panel.open) return null;
  return (
    <div id={panel.panelId} role="group" aria-label={label}
      style={panel.viewer.height ? { maxHeight: panel.viewer.height - 56 } : undefined}
      className={`panel absolute right-0 top-9 z-30 flex ${width} max-w-[calc(100vw-1.5rem)] animate-drop flex-col overflow-y-auto overscroll-contain text-sm text-fg motion-reduce:animate-none`}>
      <PanelHeader title={title} icon={icon} onClose={() => { panel.setOpen(false); panel.button.current?.focus(); }} sticky />
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </div>
  );
}

/** One header for every panel and sheet: icon, name, close. */
export function PanelHeader({ title, icon, onClose, closeLabel = `Close ${title.toLowerCase()}`, sticky, children }: {
  title: string; icon?: ReactNode; onClose(): void; closeLabel?: string; sticky?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`flex h-9 shrink-0 items-center gap-2 border-b border-line bg-ink-900 pl-3 pr-1 ${sticky ? "sticky top-0 z-10" : ""}`}>
      <span aria-hidden="true" className="h-3 w-[3px] shrink-0 bg-finals" />
      {icon && <span aria-hidden="true" className="text-fg-muted">{icon}</span>}
      <span className="hud text-fg">{title}</span>
      {children}
      <button type="button" onClick={onClose} aria-label={closeLabel}
        className="ml-auto grid size-8 shrink-0 place-items-center text-fg-dim transition-colors hover:text-fg">
        <CloseIcon size={13} />
      </button>
    </div>
  );
}
