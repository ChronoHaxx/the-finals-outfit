import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import PreviewPane from "../components/PreviewPane";
import SlotPicker from "../components/SlotPicker";
import BuildList from "../components/BuildList";
import MobileSheet from "../components/MobileSheet";
import MobileMenu from "../components/MobileMenu";
import { useMediaQuery } from "../lib/use-media-query";
import { readOutfitLink } from "../lib/share-url";
import { migrateOutfit } from "../lib/outfit-slots";
import { filterBrowseBuild, PUBLIC_CATALOG_COUNT } from "../lib/browse-catalog";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import ShareBuild from "../components/ShareBuild";
import CatalogProgress from "../components/CatalogProgress";
import ProjectLinks from "../components/ProjectLinks";
import StatusLegend from "../components/StatusLegend";
import CatalogUpdateNote from "../components/CatalogUpdateNote";
import { useBuildStore } from "../store/useBuildStore";

export default function Builder() {
  const [omittedItems, setOmittedItems] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  // Wide screens browse beside the preview; phones and portrait tablets browse in a bottom sheet under a
  // full-width character. Only one item browser is mounted, so its icons are requested once.
  const wide = useMediaQuery("(min-width: 1024px)");
  const routerLocation = useLocation();
  // Support legacy query links and compact hash navigation without a page reload.
  // Migrate historical slots before filtering availability; report omissions or
  // malformed codes instead of presenting a different outfit without explanation.
  useEffect(() => {
    try {
      const decoded = readOutfitLink(window.location.href);
      setLinkError(false);
      if (!decoded) {
        useBuildStore.getState().reset();
        setOmittedItems(false);
        return;
      }
      const outfit = migrateOutfit(decoded);
      const valid = filterBrowseBuild(outfit.slots);
      setOmittedItems(Object.keys(valid).length < Object.keys(outfit.slots).length);
      useBuildStore.getState().load(valid);
    } catch (e) {
      setLinkError(true);
      setOmittedItems(false);
      console.warn("[outfit] ignoring invalid share code", e);
    }
  }, [routerLocation.search]);
  const notices = <>
    {omittedItems && <p role="status" className="text-xs text-amber-300">Some items in this link aren’t available in this catalog and were left out.</p>}
    {linkError && <p role="alert" className="text-xs text-amber-300">This outfit link could not be read. Your current selection has been kept.</p>}
  </>;
  return (
    <main className="flex h-dvh flex-col overflow-hidden lg:mx-auto lg:max-w-6xl lg:gap-6 lg:px-5 lg:py-6">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-neutral-900 px-3 pt-[env(safe-area-inset-top)] lg:hidden">
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[10px] uppercase tracking-widest text-neutral-500">the-finals-outfit</p>
          <h1 className="truncate text-sm font-semibold">{DEVELOPER_CATALOG ? "Developer catalog" : "Outfit builder"}</h1>
        </div>
        <button onClick={() => setMenuOpen(true)} aria-haspopup="dialog"
          className="shrink-0 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700">
          Share · About
        </button>
      </div>
      {!wide && (omittedItems || linkError) && <div className="shrink-0 px-3 py-1">{notices}</div>}
      {menuOpen && !wide && <MobileMenu onClose={closeMenu} />}
      <header className="hidden shrink-0 gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
        <div className="min-w-0 space-y-1">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          the-finals-outfit
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {DEVELOPER_CATALOG ? "Developer cosmetic catalog" : "Cosmetic outfit builder"}
        </h1>
        <p className="hidden max-w-prose text-sm text-neutral-400 lg:block">
          Compose a look from THE FINALS cosmetic catalog, then share it by URL.
          Fan-made, unaffiliated with Embark Studios.
        </p>
        {DEVELOPER_CATALOG
          ? <p className="text-xs text-amber-300">Full extracted catalog · internal names · may include unreleased items. Unlisted, publicly accessible.</p>
          : <p className="text-xs text-neutral-500">{PUBLIC_CATALOG_COUNT} cosmetics. Names and previews are being improved.</p>}
        <ShareBuild />
        {wide && notices}
        </div>
        <div className="space-y-3 lg:justify-self-end lg:self-center">
          <CatalogUpdateNote />
          <StatusLegend />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6">
        {/* The viewer keeps its place in the tree at every width, so a rotation never reloads the character. */}
        <section aria-label="3D outfit preview" className="min-h-0 min-w-0 flex-1 overflow-hidden lg:rounded-2xl lg:border lg:border-neutral-800 lg:bg-neutral-900/40 lg:p-4">
          <PreviewPane />
        </section>
        {wide ? (
          <section aria-label="Cosmetic browser" className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <SlotPicker />
          </section>
        ) : (
          <MobileSheet>
            <BuildList variant="strip" />
            <section aria-label="Cosmetic browser" className="flex min-h-0 flex-1 flex-col">
              <SlotPicker />
            </section>
          </MobileSheet>
        )}
      </div>

      <footer className="hidden shrink-0 gap-3 text-[10px] text-neutral-500 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end lg:gap-6 lg:text-xs">
        <p>Fan-made project. THE FINALS is a trademark of Embark Studios AB.
          {" "}<a href="https://www.thefinals.wiki/wiki/All_Cosmetics" target="_blank" rel="noreferrer" className="underline">Cosmetic names: THE FINALS Wiki</a>.
        </p>
        <div className="space-y-2">
          <CatalogProgress compact />
          <ProjectLinks />
        </div>
      </footer>
    </main>
  );
}
