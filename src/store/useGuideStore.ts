import { create } from "zustand";
import { dismissHint } from "../lib/hints";

// Whether the "What you can do" guide is open (FeatureGuide.tsx). A store, like the welcome dialog's, so the welcome
// screen, the top bar on any route, a hint and the ? key can all open the one dialog rendered at the root. Opening it
// retires the hint that points at it: the visitor has found it.
export const useGuideStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => { dismissHint("guide"); set({ open: true }); },
  hide: () => set({ open: false }),
}));
