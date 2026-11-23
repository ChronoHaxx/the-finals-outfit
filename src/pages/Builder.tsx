import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { useChromeLayout, useDrawerOpen, useDrawerRequests, useHideUi } from "../lib/viewer-chrome";
import { SLOTS } from "../lib/slots";
import { probeWebGL2 } from "../lib/webgl-support";
import { ViewerUnavailable } from "../components/ViewerUnavailable";
import { SlowScriptNotice } from "../components/SlowScriptNotice";
import { SharedLightingNotice } from "../components/SharedLightingNotice";
import { ChinalsBanner } from "../components/ChinalsBanner";
import { pendingPose, subscribePendingPose, takePendingPose } from "../lib/share-pose";
import { builderPath, chinalsAvailable, CHINALS_PATH, hashSearch, isChinalsClip, modeOfPath, type SiteMode } from "../lib/site-mode";

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
  // The tour and the Guide's "Show me" open the drawer when the control they point at is inside it.
  useDrawerRequests(() => setDrawerOpen(true));
  const pieces = useBuildStore(s => SLOTS.filter(slot => s.build[slot]).length);

  const [omittedItems, setOmittedItems] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // Global or Chinals (lib/site-mode.ts): the route says which. A Chinals address on a deployment without the mode keeps
  // its address and shows the global builder with a notice.
  const routeMode = modeOfPath(routerLocation.pathname);
  const available = chinalsAvailable();
  const siteMode: SiteMode = routeMode === "chinals" && available ? "chinals" : "global";
  const routeModeNow = useRef(routeMode);
  routeModeNow.current = routeMode;
  // Once a share link has done its job it leaves the address bar, through the router so it notices. It stays in the
  // mode it was opened in.
  useEffect(() => {
    setUrlCleaner(() => navigate({ pathname: builderPath(routeModeNow.current), search: "" }, { replace: true }));
    return () => setUrlCleaner(undefined);
  }, [navigate]);
  // A link whose pose names a Chinals emote (cn-…) opens Chinals mode: share links, and the share Worker's page, always
  // use the global route. The pose waits in share-pose.ts until the Chinals emotes have loaded (AnimationControls
  // leaves it there meanwhile). The query is read live: a tidy-up may have rewritten the address already. Without the
  // mode on this deployment the pose is dropped and the notice says why; the outfit itself still opens.
  const waitingPose = useSyncExternalStore(subscribePendingPose, pendingPose);
  const [chinalsPoseRefused, setChinalsPoseRefused] = useState(false);
  const [chinalsNoticeDismissed, setChinalsNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!waitingPose || !isChinalsClip(waitingPose.clip) || routeMode === "chinals" && available) return;
    if (!available) { takePendingPose(); setChinalsPoseRefused(true); setChinalsNoticeDismissed(false); return; }
    navigate({ pathname: CHINALS_PATH, search: hashSearch(window.location.hash) }, { replace: true });
  }, [waitingPose, routeMode, available, navigate]);
  const chinalsUnavailable = !available && !chinalsNoticeDismissed && (routeMode === "chinals" || chinalsPoseRefused);
  // Support legacy query links and compact hash navigation without a page reload. A link opens as an
  // unsaved draft beside the saved outfits (src/store/useSavedOutfits.ts); no link shows the saved outfit
  // you were last on. Report omissions or malformed codes instead of a different outfit without explanation.
  // A link can also carry a pose (an emote frame): store/open-link.ts hands it to the viewer.
  useEffect(() => {
    const result = openLink(window.location.href);
    setLinkError(result.error);
    setOmittedItems(result.omitted);
  }, [routerLocation.search]);
  const dismissNotice = () => { setOmittedItems(false); setLinkError(false); setChinalsPoseRefused(false); setChinalsNoticeDismissed(true); };
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
        {siteMode === "chinals" && <ChinalsBanner />}
        {(omittedItems || linkError || chinalsUnavailable) && <div role={linkError ? "alert" : "status"}
          className="flex items-center gap-3 border-b border-kept/25 bg-kept/10 px-4 py-2 text-xs text-kept">
          <p className="flex-1">{[
            linkError ? "This outfit link could not be read. Your current selection has been kept."
              : omittedItems ? "Some items in this link aren’t available in this catalog and were left out." : null,
            chinalsUnavailable ? "Chinals mode isn’t available on this site right now, so its emotes can’t be shown. The outfit opens as usual." : null,
          ].filter(Boolean).join(" ")}</p>
          <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="grid size-6 place-items-center hover:text-fg">
            <CloseIcon size={12} />
          </button>
        </div>}
        {webgl.ok && <SharedLightingNotice />}
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
          {webgl.ok ? <CharacterViewer immersive={immersive} hideUi={hideUi} mode={siteMode} /> : <ViewerUnavailable support={webgl} />}
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
