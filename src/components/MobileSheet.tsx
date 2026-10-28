import { useRef, useState, type ReactNode } from "react";

// The phone's item browser: a sheet along the bottom that snaps between a peek, which keeps most of the character in
// view, and nearly full height for browsing. Tap the handle to switch, or drag it. The sheet takes its height out
// of the layout rather than covering the viewer, so the canvas shrinks with it and the character stays whole.
const SNAPS = { peek: 0.46, full: 0.84 } as const;
type Snap = keyof typeof SNAPS;
const TAP_SLOP_PX = 6;

export default function MobileSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snap>("peek");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  const viewport = () => window.innerHeight;
  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, height: sheet.current?.getBoundingClientRect().height ?? 0, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dy = start.y - event.clientY;
    if (!start.moved && Math.abs(dy) < TAP_SLOP_PX) return;
    start.moved = true;
    const height = Math.min(viewport() * 0.92, Math.max(viewport() * 0.25, start.height + dy));
    setDragHeight(height);
  };
  const onPointerUp = () => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    if (!start.moved) setSnap(current => (current === "peek" ? "full" : "peek"));
    else if (dragHeight !== null) {
      const fraction = dragHeight / viewport();
      setSnap(Math.abs(fraction - SNAPS.peek) <= Math.abs(fraction - SNAPS.full) ? "peek" : "full");
    }
    setDragHeight(null);
  };

  return (
    <div ref={sheet} aria-label="Item browser"
      className="relative z-10 flex shrink-0 flex-col rounded-t-2xl border-t border-neutral-800 bg-neutral-950 shadow-[0_-12px_32px_rgba(0,0,0,0.45)]"
      style={{
        height: dragHeight !== null ? `${dragHeight}px` : `${SNAPS[snap] * 100}dvh`,
        transition: dragHeight !== null ? "none" : "height 280ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}>
      <button type="button" aria-expanded={snap === "full"}
        aria-label={snap === "full" ? "Show more of the character" : "Show more items"}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        // Keyboard activation only (detail 0): a pointer tap is already handled on pointer up.
        onClick={event => { if (event.detail === 0) setSnap(current => (current === "peek" ? "full" : "peek")); }}
        className="flex h-6 w-full shrink-0 touch-none items-center justify-center">
        <span className="h-1 w-10 rounded-full bg-neutral-600" />
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
