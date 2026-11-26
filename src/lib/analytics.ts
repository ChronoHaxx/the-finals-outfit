import { isDeveloperCatalogPath } from "./catalog-mode";

// Cloudflare Web Analytics: anonymous visit counts and page-load timings for the public site, nothing else.
// The beacon sets no cookies and keeps nothing in the browser. What it sends is listed in README.md
// ("Monitoring and visitor analytics"). Blocking it changes nothing in the app.
//
// This file also holds the gate both analytics share (the page-view beacon here, product events in track.ts), and the
// visitor's opt-out: the one value analytics ever store.

/** Cloudflare's public beacon identifier for the chronohaxx.github.io property; it is in every visitor's page
 *  source by design and is not a credential. */
const BEACON_TOKEN = "6a2a3a43ff454685a6a0c76a18b2e139";
const PRODUCTION_HOST = "chronohaxx.github.io";
const PRODUCTION_BASE = "/the-finals-outfit/";

export interface AnalyticsContext {
  hostname: string;
  pathname: string;
  /** The build's base path (import.meta.env.BASE_URL): a UI preview built into a sub-path has its own. */
  baseUrl: string;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  /** Browser automation: the release scenarios and visual harnesses also load the live site. */
  webdriver?: boolean;
  /** The visitor switched analytics off in the privacy note (OPT_OUT_KEY). */
  optedOut?: boolean;
}

/** The one thing analytics keep in the browser: the visitor's own "don't count me" choice. It holds "off" or nothing,
 *  the same for everyone who chose it, so it identifies no one. */
export const OPT_OUT_KEY = "finals-outfit.analytics";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function analyticsOptedOut(store: StorageLike | null = browserStorage()): boolean {
  try { return store?.getItem(OPT_OUT_KEY) === "off"; } catch { return false; }
}

/** Records the choice. False when storage refused it: then it lasts until the page closes (the caller re-reads the
 *  gate either way). */
export function setAnalyticsOptOut(off: boolean, store: StorageLike | null = browserStorage()): boolean {
  try {
    if (off) store?.setItem(OPT_OUT_KEY, "off"); else store?.removeItem(OPT_OUT_KEY);
    return !!store;
  } catch { return false; }
}

/** Only the production app reports: not local previews, forks, UI previews, the developer catalogue or automated
 *  browsers, and not visitors who ask sites not to track them (Global Privacy Control, Do Not Track, or the opt-out). */
export function analyticsAllowed(context: AnalyticsContext): boolean {
  return context.hostname === PRODUCTION_HOST && context.baseUrl === PRODUCTION_BASE
    && context.pathname.startsWith(PRODUCTION_BASE) && !isDeveloperCatalogPath(context.pathname)
    && context.doNotTrack !== "1" && context.globalPrivacyControl !== true && context.webdriver !== true
    && context.optedOut !== true;
}

/** This page's context, read from the browser. */
export function browserAnalyticsContext(): AnalyticsContext {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    hostname: location.hostname, pathname: location.pathname, baseUrl: import.meta.env?.BASE_URL ?? "/",
    doNotTrack: nav.doNotTrack ?? (window as { doNotTrack?: string }).doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl, webdriver: nav.webdriver, optedOut: analyticsOptedOut(),
  };
}

export function startAnalytics(): void {
  if (document.querySelector("script[data-cf-beacon]")) return;
  if (!analyticsAllowed(browserAnalyticsContext())) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  // spa: false. The app routes in the URL hash, which the beacon leaves out, so its route-change reports were
  // extra page views of the same path (checked 6 Nov 2026). Now one page load is one page view.
  script.dataset.cfBeacon = JSON.stringify({ token: BEACON_TOKEN, spa: false });
  document.head.append(script);
}
