import { useEffect } from "react";
import PreviewPane from "../components/PreviewPane";
import SlotPicker from "../components/SlotPicker";
import { decodeOutfit } from "../lib/outfit";
import { getItemById } from "../lib/catalog";
import { useBuildStore } from "../store/useBuildStore";
import type { Slot } from "../lib/slots";

export default function Builder() {
  // Hydrate the build from a share link (?outfit=…) once on mount. Ids that no longer
  // exist in the catalog are dropped silently; a corrupt code leaves the empty build.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("outfit");
    if (!code) return;
    try {
      const outfit = decodeOutfit(code);
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
    <main className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-5 py-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          the-finals-outfit
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          Cosmetic outfit builder
        </h1>
        <p className="max-w-prose text-sm text-neutral-400">
          Compose a look from THE FINALS cosmetic catalog, then share it by URL.
          Fan-made, unaffiliated with Embark Studios.
        </p>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <PreviewPane />
        </section>
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <SlotPicker />
        </section>
      </div>

      <footer className="pt-4 text-xs text-neutral-500">
        Fan-made project. THE FINALS is a trademark of Embark Studios AB.
      </footer>
    </main>
  );
}
