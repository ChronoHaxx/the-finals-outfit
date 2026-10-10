import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getBrowseItems } from "../lib/browse-catalog";
import { modelUrl } from "../lib/assets";
import { summarizeReconstruction, type ProgressState } from "../lib/reconstruction-progress";
import { loadSourceReconstructionItems } from "../rig/SourceAssembly";

type Progress = {
  workedOn: ReadonlySet<string>;
  state: ProgressState;
  summary: ReturnType<typeof summarizeReconstruction>;
  retry: () => void;
};
const Context = createContext<Progress | null>(null);

// One status source for the picker, footer and roadmap, retained during navigation.
export function ReconstructionProgressProvider({ children }: { children: ReactNode }) {
  const [workedOn, setWorkedOn] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<ProgressState>("loading");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    loadSourceReconstructionItems(modelUrl("models/reconstructed-assemblies-v1")).then(ids => {
      if (!cancelled) { setWorkedOn(ids); setState("ready"); }
    }).catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, [attempt]);
  const value = useMemo(() => ({ workedOn, state, retry,
    summary: summarizeReconstruction(getBrowseItems(), workedOn, state),
  }), [workedOn, state, retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useReconstructionProgress() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing reconstruction progress provider");
  return value;
}
