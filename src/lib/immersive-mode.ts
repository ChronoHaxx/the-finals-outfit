import { useMemo, useState, useSyncExternalStore } from "react";

// Immersive mode (6 Nov 2026): the 3D stage fills the viewport and the rest of the builder is hidden.
//
// Two layers, so it works everywhere:
// - The layout itself is CSS (Builder swaps the stage to a fixed full-viewport layer and hides the rest). This is
//   all iPhone Safari gets: it has no element fullscreen outside <video>.
// - Where the Fullscreen API exists, the whole document goes fullscreen as well, hiding the browser's own bars.
//   The document, not the stage: the phone emote sheet renders at <body>, and only the fullscreen element's subtree
//   is painted.
//
// Leaving fullscreen through the browser (Esc, the back gesture, the system bar) ends immersive mode too, so the
// layout never stays stripped down inside a normal window. Esc also leaves the CSS-only mode.

/** The parts of `document` this uses, standard and WebKit-prefixed (Safari before 16.4, iPadOS). */
export interface FullscreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
  documentElement: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ImmersiveSnapshot {
  /** The stripped-down layout is on. */
  immersive: boolean;
  /** The browser is in fullscreen because we asked; false in the CSS-only mode. */
  fullscreen: boolean;
}

export interface ImmersiveController {
  getSnapshot(): ImmersiveSnapshot;
  subscribe(listener: () => void): () => void;
  enter(): void;
  exit(): void;
  toggle(): void;
}

const CHANGE_EVENTS = ["fullscreenchange", "webkitfullscreenchange"];
const ERROR_EVENTS = ["fullscreenerror", "webkitfullscreenerror"]; // the prefixed request has no promise to reject
export const INACTIVE: ImmersiveSnapshot = { immersive: false, fullscreen: false };

export function createImmersiveController(doc: FullscreenDocument): ImmersiveController {
  let snapshot = INACTIVE;
  // We asked for fullscreen and have not seen it end (pending or active). Only a fullscreen we asked for is ours to
  // end: a video someone made fullscreen is left alone.
  let requested = false;
  const listeners = new Set<() => void>();

  const fullscreenElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  const publish = (next: ImmersiveSnapshot) => {
    if (next.immersive === snapshot.immersive && next.fullscreen === snapshot.fullscreen) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  const leaveFullscreen = () => {
    try {
      if (doc.exitFullscreen) doc.exitFullscreen().catch(() => { /* already gone */ });
      else doc.webkitExitFullscreen?.();
    } catch { /* already gone */ }
  };

  const enter = () => {
    if (snapshot.immersive) return;
    publish({ immersive: true, fullscreen: false });
    // Must run inside the click that asked for it (user activation), so nothing above may await.
    const root = doc.documentElement;
    if (fullscreenElement() || !(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled)) return;
    requested = true;
    try {
      if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).catch(() => { requested = false; });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else requested = false;
    } catch {
      requested = false; // refused: the CSS layout alone stays on
    }
  };

  const exit = () => {
    if (!snapshot.immersive) return;
    const wasFullscreen = snapshot.fullscreen;
    publish(INACTIVE);
    if (wasFullscreen) { requested = false; leaveFullscreen(); }
    // A request still pending stays `requested`: onChange undoes it when it lands.
  };

  const onChange = () => {
    if (fullscreenElement()) {
      if (!requested) return;
      if (!snapshot.immersive) { requested = false; leaveFullscreen(); return; } // left before the request landed
      publish({ immersive: true, fullscreen: true });
    } else {
      const left = snapshot.fullscreen;
      requested = false;
      // Left through the browser: restore the layout too. (The CSS-only mode never had fullscreen to lose.)
      if (left) publish(INACTIVE);
    }
  };

  const onError = () => { if (!fullscreenElement()) requested = false; };

  // Esc in the CSS-only mode. (In real fullscreen the browser takes Esc itself and onChange follows.) A panel that
  // handles Esc first, such as the emote picker, stops it before it reaches the document.
  const onKey = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Escape" && snapshot.immersive && !event.defaultPrevented) exit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (listeners.size === 0) {
        CHANGE_EVENTS.forEach(type => doc.addEventListener(type, onChange));
        ERROR_EVENTS.forEach(type => doc.addEventListener(type, onError));
        doc.addEventListener("keydown", onKey);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        CHANGE_EVENTS.forEach(type => doc.removeEventListener(type, onChange));
        ERROR_EVENTS.forEach(type => doc.removeEventListener(type, onError));
        doc.removeEventListener("keydown", onKey);
        exit(); // nobody shows the layout any more (the builder unmounted): do not leave the browser fullscreen
      };
    },
    enter,
    exit,
    toggle: () => (snapshot.immersive ? exit() : enter()),
  };
}

export interface ImmersiveMode extends ImmersiveSnapshot {
  enter(): void;
  exit(): void;
  toggle(): void;
}

/** Immersive mode for one page: the component that owns the layout calls this and passes it down. */
export function useImmersiveMode(): ImmersiveMode {
  const [controller] = useState(() => createImmersiveController(document as unknown as FullscreenDocument));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => INACTIVE);
  return useMemo(() => ({ ...snapshot, enter: controller.enter, exit: controller.exit, toggle: controller.toggle }),
    [snapshot, controller]);
}
