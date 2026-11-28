// The archetypes the picker offers (lib/archetype.ts): Medium always; another class only when this visitor's access allows
// it (Light by default since 28 Nov 2026, Heavy in the preview) AND the index the site loads carries that class's body
// (rig/Archetype.ts indexClass). An index from before archetypes, or one that fails to load, offers Medium only, so the
// picker never offers a body the viewer cannot build.
import { useEffect, useState } from "react";
import { ARCHETYPE_IDS, archetypeAccess, archetypesFor, type ArchetypeId } from "../lib/archetype";
import { loadSourceAssemblyAssets } from "../rig/SourceAssembly";
import { modelUrl } from "../lib/assets";

const ALLOWED = archetypesFor(archetypeAccess());
const MEDIUM_ONLY: readonly ArchetypeId[] = ["medium"];

export function useArchetypeChoices(): readonly ArchetypeId[] {
  const [choices, setChoices] = useState<readonly ArchetypeId[]>(MEDIUM_ONLY);
  useEffect(() => {
    if (ALLOWED.length < 2) return;
    let live = true;
    loadSourceAssemblyAssets(modelUrl("models/reconstructed-assemblies-v1"))
      .then(assets => {
        if (live) setChoices(ARCHETYPE_IDS.filter(id =>
          id === "medium" || (ALLOWED.includes(id) && assets.archetypes?.[id] !== undefined)));
      })
      .catch(() => { /* Medium only */ });
    return () => { live = false; };
  }, []);
  return choices;
}
