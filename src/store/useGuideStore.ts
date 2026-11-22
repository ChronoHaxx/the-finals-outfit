import { create } from "zustand";

// Whether the Guide sheet is open (FeatureGuide.tsx). A store, like the welcome dialog's, so the top bar on any route
// and the ? key can open the one sheet rendered at the root.
export const useGuideStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
