import { create } from "zustand";

// Whether the privacy note is open (PrivacyNote.tsx). A store, like the Guide's, so the welcome screen and the Guide
// sheet can both open the one note rendered at the root. It opens over them; closing it returns to them.
export const usePrivacyStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
