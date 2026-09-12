import { useEffect } from "react";
import PreviewPane from "../components/PreviewPane";
import SlotPicker from "../components/SlotPicker";
import { decodeOutfit } from "../lib/outfit";
import { migrateOutfit } from "../lib/outfit-slots";
import { getItemById } from "../lib/catalog";
import { useBuildStore } from "../store/useBuildStore";
import type { Slot } from "../lib/slots";

export default function Builder() {
  // Hydrate the build from a share link (?outfit=…) once on mount. Ids that no longer
  // exist in the catalog are dropped silently; a corrupt code leaves the empty build.
  // The slot filter below is what keeps a stale link honest, so a link minted before a
  // catalog slot correction has to be migrated FIRST or its garment would look stale and
  // be dropped (src/lib/outfit-slots.ts).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("outfit");
    if (!code) return;
    try {
      const outfit = migrateOutfit(decodeOutfit(code));
      const valid = Object.fromEntries(
        Object.entries(outfit.slots).filter(([slot, id]) => {
          const item = id ? getItemById(id) : undefined;
          return item && item.slot === slot;
        }),
      ) as Partial<Record<Slot, string>>;
      if (Object.keys(valid).length) useBuildStore.getState().load(valid);
    } catch (e) {
      console.warn("[outfit] ignoring invalid share code", e);
    }
  }, []);
  return (
    <main className="mx-auto flex h-dvh max-w-6xl flex-col gap-3 overflow-hidden px-3 py-3 sm:px-5 lg:gap-6 lg:py-6">
      <header className="shrink-0 space-y-1">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          the-finals-outfit
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          Cosmetic outfit builder
        </h1>
        <p className="hidden max-w-prose text-sm text-neutral-400 lg:block">
          Compose a look from THE FINALS cosmetic catalog, then share it by URL.
          Fan-made, unaffiliated with Embark Studios.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6">
        <section aria-label="3D outfit preview" className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 lg:p-4">
          <PreviewPane />
        </section>
        <section aria-label="Cosmetic browser" className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 lg:p-4">
          <SlotPicker />
        </section>
      </div>

      <footer className="shrink-0 text-[10px] text-neutral-500 lg:text-xs">
        Fan-made project. THE FINALS is a trademark of Embark Studios AB.
      </footer>
    </main>
  );
}
