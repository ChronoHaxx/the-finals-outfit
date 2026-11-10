import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CharacterViewer from "../components/CharacterViewer";
import SlotPicker from "../components/SlotPicker";
import OutfitBar from "../components/OutfitBar";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import CatalogProgress from "../components/CatalogProgress";
import TopBar from "../components/ProjectLinks";
import CatalogUpdateNote from "../components/CatalogUpdateNote";
import { CloseIcon } from "../components/Icons";
import { setUrlCleaner } from "../store/useSavedOutfits";
import { openLink } from "../store/open-link";
import { useImmersiveMode } from "../lib/immersive-mode";

export default function Builder() {
  // Full screen (lib/immersive-mode): the stage becomes a fixed full-viewport layer and everything else is hidden
  // with display:none, never unmounted, so the picker keeps its slot, search and filters, and the 3D viewer is the
  // same element throughout (moving it in the tree would reload the character).
  const mode = useImmersiveMode();
  const immersive = mode.immersive;
  // Hiding the page collapses its height, so a phone deep in the item grid would come back at the top. Remember the
  // scroll when the button enters, put it back once the page is laid out again, however the mode was left.
  const scrollBefore = useRef<number | null>(null);
  const immersiveMode = { ...mode, toggle: () => { if (!immersive) scrollBefore.current = window.scrollY; mode.toggle(); } };
  useLayoutEffect(() => {
    if (immersive || scrollBefore.current === null) return;
    window.scrollTo(0, scrollBefore.current);
    scrollBefore.current = null;
  }, [immersive]);
  const away = immersive ? "hidden" : "";
  const [omittedItems, setOmittedItems] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // Once a share link has done its job it leaves the address bar, through the router so it notices.
  useEffect(() => {
    setUrlCleaner(() => navigate({ pathname: "/", search: "" }, { replace: true }));
    return () => setUrlCleaner(undefined);
  }, [navigate]);
  // Support legacy query links and compact hash navigation without a page reload. A link opens as an
  // unsaved draft beside the saved outfits (src/store/useSavedOutfits.ts); no link shows the saved outfit
  // you were last on. Report omissions or malformed codes instead of a different outfit without explanation.
  // A link can also carry a pose (an emote frame): store/open-link.ts hands it to the viewer.
  useEffect(() => {
    const result = openLink(window.location.href);
    setLinkError(result.error);
    setOmittedItems(result.omitted);
  }, [routerLocation.search]);
  const dismissNotice = () => { setOmittedItems(false); setLinkError(false); };

  // Phone: the page scrolls; the stage is sticky at the top and the slot strip sticks under it,
  // so the outfit stays in view while you browse. Desktop (lg): a fixed-height three-pane layout
  // where only the grid and the slot rail scroll.
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* display:contents keeps the header's layout exactly as it was outside immersive mode. */}
      <div className={immersive ? "hidden" : "contents"}>
        <TopBar page="builder" />
        {DEVELOPER_CATALOG && <p className="border-b border-kept/25 bg-kept/10 px-4 py-2 text-xs text-kept">
          Full extracted catalog · internal names · may include unreleased items. Unlisted, publicly accessible.
        </p>}
        {(omittedItems || linkError) && <div role={linkError ? "alert" : "status"}
          className="flex items-center gap-3 border-b border-kept/25 bg-kept/10 px-4 py-2 text-xs text-kept">
          <p className="flex-1">{linkError
            ? "This outfit link could not be read. Your current selection has been kept."
            : "Some items in this link aren’t available in this catalog and were left out."}</p>
          <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="grid size-6 place-items-center hover:text-fg">
            <CloseIcon size={12} />
          </button>
        </div>}
      </div>

      <main className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-3 lg:p-3">
        {/* Immersive: one fixed layer over the whole viewport (inset-0 follows the dynamic viewport; nothing else is
            left to scroll, so the phone's bars stay put). z-30 keeps the phone emote sheet (z-40) above it. */}
        <section aria-label="3D outfit preview"
          className={immersive ? "fixed inset-0 z-30 overflow-hidden bg-ink-900"
            : "sticky top-0 z-20 h-(--stage-h) overflow-hidden bg-ink-900 lg:static lg:h-auto lg:min-h-0 lg:border lg:border-line"}>
          <CharacterViewer immersive={immersiveMode} />
        </section>
        <section aria-label="Your outfit" className={`min-w-0 lg:col-start-1 lg:row-start-2 ${away}`}>
          <OutfitBar />
        </section>
        <section aria-label="Cosmetic browser"
          className={`min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-hidden lg:border lg:border-line lg:bg-ink-950 ${away}`}>
          <SlotPicker />
        </section>
      </main>

      <footer className={immersive ? "hidden" : "flex flex-col gap-3 border-t border-line px-3 py-4 lg:h-11 lg:shrink-0 lg:flex-row lg:items-center lg:gap-6 lg:px-4 lg:py-0"}>
        <div className="xl:hidden"><CatalogUpdateNote /></div>
        <div className="lg:shrink-0"><CatalogProgress compact /></div>
        <p className="text-[11px] leading-relaxed text-fg-dim lg:ml-auto lg:min-w-0 lg:truncate lg:text-right"
          title="Fan-made, not affiliated with Embark Studios. THE FINALS is a trademark of Embark Studios AB.">
          Fan-made · THE FINALS is a trademark of Embark Studios AB ·
          {" "}<a href="https://www.thefinals.wiki/wiki/All_Cosmetics" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">Names: THE FINALS Wiki</a>
        </p>
      </footer>
    </div>
  );
}
