import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CharacterViewer from "../components/CharacterViewer";
import SlotPicker from "../components/SlotPicker";
import OutfitBar from "../components/OutfitBar";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import CatalogProgress from "../components/CatalogProgress";
import TopBar from "../components/ProjectLinks";
import CatalogUpdateNote from "../components/CatalogUpdateNote";
import { CloseIcon } from "../components/Icons";
import { ItemsDrawer } from "../components/ItemsDrawer";
import { setUrlCleaner } from "../store/useSavedOutfits";
import { openLink } from "../store/open-link";
import { useBuildStore } from "../store/useBuildStore";
import { useImmersiveMode } from "../lib/immersive-mode";
import { useChromeLayout, useDrawerOpen, useHideUi } from "../lib/viewer-chrome";
import { SLOTS } from "../lib/slots";
import { probeWebGL2 } from "../lib/webgl-support";
import { ViewerUnavailable } from "../components/ViewerUnavailable";
import { SlowScriptNotice } from "../components/SlowScriptNotice";

export default function Builder() {
  // Full screen (lib/immersive-mode) and hidden UI (H, lib/viewer-chrome) both leave the stage alone on screen: it becomes
  // a fixed full-window layer and everything else is hidden and inert, never unmounted, so the picker keeps its slot,
  // search, filters and scroll, and the 3D viewer is the same element throughout (moving it would reload the character).
  const immersive = useImmersiveMode();
  const hideUi = useHideUi();
  const stageAlone = immersive.immersive || hideUi.hidden;
  // The stage fills the window; the picker is a drawer beside it (side) or a sheet under it (sheet). Open by default,
  // remembered in this browser.
  const layout = useChromeLayout();
  const [drawerOpen, setDrawerOpen] = useDrawerOpen();
  const pieces = useBuildStore(s => SLOTS.filter(slot => s.build[slot]).length);

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
  // No WebGL 2 (LibreWolf's default, some privacy setups): say so in place of the 3D view instead of a blank box; the
  // viewer is not mounted at all, so it downloads nothing (lib/webgl-support).
  const [webgl] = useState(probeWebGL2);

  const sheetOpen = layout === "sheet" && drawerOpen;
  // The page never scrolls: the stage and the drawer share the window, and the drawer scrolls inside.
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* display:contents keeps the header's layout; hidden with the rest while the stage is alone. */}
      <div className={stageAlone ? "invisible contents" : "contents"} inert={stageAlone}>
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
        {webgl.ok && <SlowScriptNotice />}
      </div>

      {/* DOM order is fixed (stage, then drawer) so a rotation that switches layouts moves nothing in the tree; the
          side layout shows the drawer on the left with row-reverse. */}
      <main className={`relative flex min-h-0 flex-1 ${layout === "side" ? "flex-row-reverse" : "flex-col"}`}>
        {/* Alone: one fixed layer over the whole viewport (inset-0 follows the dynamic viewport). z-30 keeps the phone
            emote sheet (z-40) above it. Sheet open: the stage keeps the height the phone layout always gave it. Sheet
            layout: its own compositing layer, as the sticky stage of the old phone layout had: the backdrop gradient's
            dither follows the layer's raster tiles, so this keeps automated captures of the default view unchanged. */}
        <section aria-label="3D outfit preview"
          className={stageAlone ? "fixed inset-0 z-30 overflow-hidden bg-ink-900"
            : `min-w-0 overflow-hidden bg-ink-900 ${layout === "sheet" ? "relative z-20 will-change-transform" : "relative"} ${sheetOpen ? "h-(--stage-h) shrink-0" : "min-h-0 flex-1"}`}>
          {webgl.ok ? <CharacterViewer immersive={immersive} hideUi={hideUi} /> : <ViewerUnavailable support={webgl} />}
        </section>
        <div className={stageAlone ? "invisible contents" : "contents"} inert={stageAlone}>
          <ItemsDrawer layout={layout} open={drawerOpen} onOpenChange={setDrawerOpen} pieces={pieces}>
            {/* Phone and sheet: outfit first, then the slot strip (sticky inside the drawer's scroll) and the grid.
                Desktop: the picker fills the column and the outfit sits at its foot. */}
            <section aria-label="Your outfit" className="min-w-0 shrink-0 lg:order-2">
              <OutfitBar />
            </section>
            <section aria-label="Cosmetic browser" className="min-w-0 lg:order-1 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
              <SlotPicker />
            </section>
            <footer className="flex flex-col gap-3 border-t border-line px-3 py-4 lg:order-3 lg:shrink-0 lg:gap-1.5 lg:px-4 lg:py-2.5">
              <div className="xl:hidden"><CatalogUpdateNote /></div>
              <CatalogProgress compact />
              <p className="text-[11px] leading-relaxed text-fg-dim lg:truncate"
                title="Fan-made, not affiliated with Embark Studios. THE FINALS is a trademark of Embark Studios AB.">
                Fan-made · THE FINALS is a trademark of Embark Studios AB ·
                {" "}<a href="https://www.thefinals.wiki/wiki/All_Cosmetics" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">Names: THE FINALS Wiki</a>
              </p>
            </footer>
          </ItemsDrawer>
        </div>
      </main>

      {/* The way back, said once when the UI goes (and to screen readers). Not part of any capture: it is page text. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] z-50 flex justify-center">
        {hideUi.hint && <span className="hud animate-hint bg-ink-950/85 px-3.5 py-2.5 text-fg motion-reduce:animate-none">
          {window.matchMedia("(hover: none)").matches ? "Double-tap to show UI" : "Press H to show UI"}
        </span>}
      </div>
    </div>
  );
}
