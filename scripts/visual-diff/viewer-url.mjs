// viewer-url.mjs: every viewer URL this harness opens carries an explicit route switch (25 Nov 2026).
//
// src/lib/viewer-dev-params.ts picks the outfit route by build:
// - a production build draws the reconstructed source-assembly route unless the URL says ?reconstructed=0;
// - a dev server (what this harness usually drives) draws it only with ?reconstructed=1.
// Before 25 Nov 2026 no script here passed the switch, so their dev-server runs from 9 Sep (04a0e3b) to 25 Nov
// scored the older cosmetics route, not what the site shows (README.md, "The route trap"). An explicit value
// draws the same route on either build.
//
// VDIFF_ROUTE picks the route:
// - "reconstructed" (the default): the route the site draws, ?reconstructed=1;
// - "cosmetics": the older route, ?reconstructed=0, for a deliberate legacy comparison only.
// VDIFF_QUERY adds further viewer switches (for example "bodyType=feminine"). It may repeat the route switch
// only with the same value; to change the route, set VDIFF_ROUTE.

export const ROUTE_SWITCH = "reconstructed";
export const ROUTES = Object.freeze({ reconstructed: "1", cosmetics: "0" });

// The reconstructed route runs the temporal accumulator (CharacterViewer's STABLE_PREVIEW), so a capture waits
// longer after window.__rigIdle for it to converge; scripts/body-types/capture-review.mjs waits 2.5 s.
export const SETTLE_MS = Object.freeze({ reconstructed: 2500, cosmetics: 700 });

/** A script's own settle wait on the cosmetics route; at least SETTLE_MS.reconstructed on the reconstructed one. */
export function settleMs(ms, route = routeFromEnv()) {
  return route === "reconstructed" ? Math.max(ms, SETTLE_MS.reconstructed) : ms;
}

export function routeFromEnv(env = process.env) {
  const raw = env.VDIFF_ROUTE?.trim();
  const route = raw || "reconstructed";
  if (!Object.hasOwn(ROUTES, route))
    throw new Error(`VDIFF_ROUTE must be "reconstructed" or "cosmetics", not "${raw}"`);
  return route;
}

/** Throws unless the URL carries the route switch exactly once, as reconstructed=1 or reconstructed=0. */
export function assertRouteSwitch(url) {
  const values = new URL(url).searchParams.getAll(ROUTE_SWITCH);
  if (values.length !== 1 || !Object.values(ROUTES).includes(values[0]))
    throw new Error(`viewer URL lacks one explicit route switch (${ROUTE_SWITCH}=1 or ${ROUTE_SWITCH}=0): ${url}`);
  return url;
}

let announced = false;

/**
 * `${base}/?${query}` plus the route switch and any VDIFF_QUERY switches, checked by assertRouteSwitch.
 * `query` is the hand-built viewer query without a leading "?", e.g. "outfit=1.xx&cam=0,1,3,0,1,0&fov=30&pose=a".
 * The query's characters are kept as they are (commas stay commas), so URLs read the same as before.
 */
export function viewerUrl(base, query, { env = process.env } = {}) {
  const route = routeFromEnv(env);
  const value = ROUTES[route];
  if (new URLSearchParams(query).has(ROUTE_SWITCH))
    throw new Error(`pass the route through VDIFF_ROUTE, not in the query: ${query}`);
  const extra = (env.VDIFF_QUERY ?? "").trim().replace(/^[?&]+/, "");
  const kept = extra.split("&").filter((pair) => {
    if (!pair) return false;
    const [key, v = ""] = pair.split("=");
    if (key !== ROUTE_SWITCH) return true;
    if (v !== value)
      throw new Error(`VDIFF_QUERY says ${pair} but the route is ${route} (${ROUTE_SWITCH}=${value}); set VDIFF_ROUTE instead`);
    return false; // the same switch again: drop the duplicate
  });
  const url = `${base.replace(/\/+$/, "")}/?${query}&${ROUTE_SWITCH}=${value}${kept.length ? `&${kept.join("&")}` : ""}`;
  if (!announced && env === process.env) {
    announced = true;
    console.log(`visual-diff route: ${route} (${ROUTE_SWITCH}=${value})${route === "cosmetics" ? " - NOT the route the site draws" : ""}`);
  }
  return assertRouteSwitch(url);
}
