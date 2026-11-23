// The archetypes the picker offers (22 Nov 2026, lib/archetype.ts): Medium always; Light and Heavy only while the
// archetype preview is on AND the index the site loads carries that class's body (rig/Archetype.ts indexClass). An index
// from before archetypes, or one that fails to load, offers Medium only, so the picker never offers a body the viewer
// cannot build.
import { useEffect, useState } from "react";
import { ARCHETYPE_IDS, archetypePreviewEnabled, type ArchetypeId } from "../lib/archetype";
import { loadSourceAssemblyAssets } from "../rig/SourceAssembly";
import { modelUrl } from "../lib/assets";

const ENABLED = archetypePreviewEnabled();
const MEDIUM_ONLY: readonly ArchetypeId[] = ["medium"];

export function useArchetypeChoices(): readonly ArchetypeId[] {
  const [choices, setChoices] = useState<readonly ArchetypeId[]>(MEDIUM_ONLY);
  useEffect(() => {
    if (!ENABLED) return;
    let live = true;
    loadSourceAssemblyAssets(modelUrl("models/reconstructed-assemblies-v1"))
      .then(assets => {
        if (live) setChoices(ARCHETYPE_IDS.filter(id => id === "medium" || assets.archetypes?.[id] !== undefined));
      })
      .catch(() => { /* Medium only */ });
    return () => { live = false; };
  }, []);
  return choices;
}
