import { useEffect, useRef } from "react";
import ShareBuild from "./ShareBuild";
import CatalogUpdateNote from "./CatalogUpdateNote";
import StatusLegend from "./StatusLegend";
import CatalogProgress from "./CatalogProgress";
import ProjectLinks from "./ProjectLinks";

// The phone's menu: sharing, the catalogue note, the 3D status legend, progress and links, which the desktop
// header and footer show all the time. Closes on the backdrop, the close button or Escape.
export default function MobileMenu({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Share and about" tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className="max-h-[85dvh] space-y-5 overflow-y-auto rounded-b-2xl border-b border-neutral-800 bg-neutral-950 px-4 pb-5 pt-[max(1rem,env(safe-area-inset-top))] outline-none">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Share &amp; about</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-neutral-400 hover:text-neutral-100">Close</button>
        </div>
        <ShareBuild />
        <CatalogUpdateNote />
        <StatusLegend />
        <CatalogProgress compact />
        <ProjectLinks />
        <p className="text-[10px] text-neutral-500">Fan-made project. THE FINALS is a trademark of Embark Studios AB.
          {" "}<a href="https://www.thefinals.wiki/wiki/All_Cosmetics" target="_blank" rel="noreferrer" className="underline">Cosmetic names: THE FINALS Wiki</a>.
        </p>
      </div>
    </div>
  );
}
