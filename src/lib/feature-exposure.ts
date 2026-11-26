import { trackOnce, trackingEnabled } from "./track";

// Feature exposure against use (23 Nov 2026; docs/analytics-tracking-plan.md, "Discovery"). For each builder control
// (anything with data-feature, from src/data/feature-guide.ts) it reports, at most once per page load:
//
// - feature_exposed: the control had a chance to be noticed. "screen" when it sat in view for EXPOSED_MS and was usable then,
//   "guided" when its callout, a tour stop or "Show me" pointed at it, "used" when it was used (a key can be used
//   without its button ever being on screen, and a use with no exposure would make the use rate meaningless).
// - feature_used: it was pressed, changed, or its key was used.
//
// Exposure rate (exposed ÷ page loads) shows what people never reach. Use rate (used ÷ exposed) shows what they reach
// but leave alone. This is separate from the guide's own "seen" record (lib/discovery.ts), which remembers across
// visits for the hints' sake: nothing here reads or writes storage, so every page load starts from nothing.

/** In view and usable this long counts as on screen: long enough to have been passed over, not just scrolled past. */
export const EXPOSED_MS = 1000;

export function reportFeatureExposure(feature: string, via: "screen" | "guided" | "used"): void {
  trackOnce(`exposed:${feature}`, "feature_exposed", { feature, via });
}

export function reportFeatureUse(feature: string): void {
  reportFeatureExposure(feature, "used");
  trackOnce(`used:${feature}`, "feature_used", { feature });
}

/** On screen and usable: in the viewport, laid out, not inert (a closed drawer), not under the hidden UI, and not
 *  behind a modal dialog (the welcome screen or the Guide sheet covers the builder; a control inside one counts). */
export function usable(element: Element): boolean {
  if (!element.isConnected || element.closest("[inert]") || document.documentElement.classList.contains("ui-hidden"))
    return false;
  let modal: Element | null = null;
  try { modal = document.querySelector("dialog:modal"); } catch { modal = document.querySelector("dialog[open]"); }
  if (modal && !modal.contains(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.right <= 0
    || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  return check ? check.call(element, { visibilityProperty: true, opacityProperty: true }) : true;
}

let started = false;

/** Watches every data-feature control for EXPOSED_MS in view. Cheap: one IntersectionObserver, a debounced scan for
 *  controls added later (drawers, the timeline), and nothing at all once every feature has been reported or when
 *  analytics are off. */
export function startFeatureExposure(): void {
  if (started || typeof window === "undefined" || typeof IntersectionObserver === "undefined" || !trackingEnabled()) return;
  started = true;
  const reported = new Set<string>();
  const timers = new Map<Element, number>();
  const inView = new Set<Element>();
  const watched = new WeakSet<Element>();

  const settle = (element: Element) => {
    timers.delete(element);
    const id = (element as HTMLElement).dataset.feature;
    if (!id || reported.has(id)) return;
    // Usable once the wait is over: a drawer that closed or a dialog that opened meanwhile does not count. Still in view
    // but covered (a dialog over it): look again later, as the observer reports only changes of intersection.
    if (!usable(element)) {
      if (inView.has(element)) timers.set(element, window.setTimeout(() => settle(element), EXPOSED_MS));
      return;
    }
    reported.add(id);
    inView.delete(element);
    reportFeatureExposure(id, "screen");
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.feature;
      if (!id || reported.has(id)) { observer.unobserve(entry.target); continue; }
      const pending = timers.get(entry.target);
      if (entry.isIntersecting) inView.add(entry.target); else inView.delete(entry.target);
      if (entry.isIntersecting && pending === undefined)
        timers.set(entry.target, window.setTimeout(() => settle(entry.target), EXPOSED_MS));
      else if (!entry.isIntersecting && pending !== undefined) { window.clearTimeout(pending); timers.delete(entry.target); }
    }
  }, { threshold: 0.5 });

  const scan = () => {
    for (const element of document.querySelectorAll<HTMLElement>("[data-feature]")) {
      if (watched.has(element) || reported.has(element.dataset.feature ?? "")) continue;
      watched.add(element);
      observer.observe(element);
    }
  };
  let queued = 0;
  const mutations = new MutationObserver(() => {
    if (!queued) queued = window.setTimeout(() => { queued = 0; scan(); }, 250);
  });
  mutations.observe(document.body, { subtree: true, childList: true });
  scan();
}
