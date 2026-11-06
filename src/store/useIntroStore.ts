import { create } from "zustand";

// Whether the welcome / patch-notes dialog is open. A store rather than component state so
// the top bar on any route can reopen it, and the dialog itself renders once at the root.
export const useIntroStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
