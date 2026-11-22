import { useEffect, type ReactNode } from "react";
import { dismissHint, type HintId } from "../lib/hints";
import { CloseIcon } from "./Icons";

// A one-time tip (lib/hints.ts), in the viewer's lower-third style. It never takes focus or blocks anything: it may sit
// over the view for a moment, and goes for good in this browser when it is closed, when its action is used, or after
// `autoHideMs` on screen, so it is seen once and does not come back to nag. The countdown only runs while the tab is
// visible.
export function HintTag({ id, children, action, autoHideMs, className = "" }: {
  id: HintId;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  autoHideMs: number;
  className?: string;
}) {
  useEffect(() => {
    let left = autoHideMs, started = 0, timer = 0;
    const run = () => { started = performance.now(); timer = window.setTimeout(() => dismissHint(id), left); };
    const pause = () => { window.clearTimeout(timer); left -= performance.now() - started; };
    const visibility = () => { if (document.hidden) pause(); else run(); };
    if (!document.hidden) run();
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [id, autoHideMs]);

  return <div role="status" className={`pointer-events-auto flex animate-rise items-start gap-2.5 border-l-2 border-finals bg-ink-950/95 py-2 pl-3 pr-1 text-xs leading-snug text-fg shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)] motion-reduce:animate-none ${className}`}>
    <span className="hud mt-px shrink-0 text-finals">Tip</span>
    <span className="min-w-0 flex-1 text-fg-muted">
      {children}
      {action && <button type="button" onClick={() => { dismissHint(id); action.onClick(); }}
        className="hud mt-2 flex h-7 items-center bg-fg px-2.5 text-ink-950 hover:bg-white">{action.label}</button>}
    </span>
    <button type="button" onClick={() => dismissHint(id)} aria-label="Dismiss tip" title="Don't show this tip again"
      className="-my-1 grid size-7 shrink-0 place-items-center text-fg-dim hover:text-fg">
      <CloseIcon size={11} />
    </button>
  </div>;
}
