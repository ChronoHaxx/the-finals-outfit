import { isDeveloperCatalogPath } from "./catalog-mode";

// Cloudflare Web Analytics: anonymous visit counts and page-load timings for the public site, nothing else.
// The beacon sets no cookies and keeps nothing in the browser. What it sends is listed in README.md
// ("Monitoring and visitor analytics"). Blocking it changes nothing in the app.

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
}

/** Only the production app reports: not local previews, forks, UI previews, the developer catalogue or automated
 *  browsers, and not visitors who ask sites not to track them (Global Privacy Control or Do Not Track). */
export function analyticsAllowed(context: AnalyticsContext): boolean {
  return context.hostname === PRODUCTION_HOST && context.baseUrl === PRODUCTION_BASE
    && context.pathname.startsWith(PRODUCTION_BASE) && !isDeveloperCatalogPath(context.pathname)
    && context.doNotTrack !== "1" && context.globalPrivacyControl !== true && context.webdriver !== true;
}

export function startAnalytics(): void {
  if (document.querySelector("script[data-cf-beacon]")) return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const allowed = analyticsAllowed({
    hostname: location.hostname, pathname: location.pathname, baseUrl: import.meta.env.BASE_URL,
    doNotTrack: nav.doNotTrack ?? (window as { doNotTrack?: string }).doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl, webdriver: nav.webdriver,
  });
  if (!allowed) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  // spa: false. The app routes in the URL hash, which the beacon leaves out, so its route-change reports were
  // extra page views of the same path (checked 6 Nov 2026). Now one page load is one page view.
  script.dataset.cfBeacon = JSON.stringify({ token: BEACON_TOKEN, spa: false });
  document.head.append(script);
}
