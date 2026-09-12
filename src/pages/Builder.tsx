import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import PreviewPane from "../components/PreviewPane";
import SlotPicker from "../components/SlotPicker";
import { readOutfitLink } from "../lib/share-url";
import { migrateOutfit } from "../lib/outfit-slots";
import { filterBrowseBuild, PUBLIC_CATALOG_COUNT } from "../lib/browse-catalog";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import ShareBuild from "../components/ShareBuild";
import { useBuildStore } from "../store/useBuildStore";

export default function Builder() {
  const [omittedItems, setOmittedItems] = useState(false);
  const [linkError, setLinkError] = useState(false);
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
  return (
    <main className="mx-auto flex h-dvh max-w-6xl flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-5 lg:gap-6 lg:overflow-hidden lg:py-6">
      <header className="shrink-0 space-y-1">
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
        {omittedItems && <p role="status" className="text-xs text-amber-300">Some items in this link aren’t available in this catalog and were left out.</p>}
        {linkError && <p role="alert" className="text-xs text-amber-300">This outfit link could not be read. Your current selection has been kept.</p>}
      </header>

      <div className="grid min-h-[840px] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6">
        <section aria-label="3D outfit preview" className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 lg:p-4">
          <PreviewPane />
        </section>
        <section aria-label="Cosmetic browser" className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 lg:p-4">
          <SlotPicker />
        </section>
      </div>

      <footer className="shrink-0 text-[10px] text-neutral-500 lg:text-xs">
        Fan-made project. THE FINALS is a trademark of Embark Studios AB.
        {" "}<a href="https://www.thefinals.wiki/wiki/All_Cosmetics" target="_blank" rel="noreferrer" className="underline">Cosmetic names: THE FINALS Wiki</a>.
      </footer>
    </main>
  );
}
