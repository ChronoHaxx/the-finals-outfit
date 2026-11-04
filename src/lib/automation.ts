// Browser automation (Playwright: the visual-diff, shader-probe and production checks) sets
// navigator.webdriver. Those harnesses clip screenshots to the canvas box and compare them with
// stored baselines, and they drive the page without expecting a welcome dialog. So under
// automation the intro stays closed and purely decorative stage chrome is not drawn.
// Everything functional (controls, status, errors) renders the same either way.
export const AUTOMATED = typeof navigator !== "undefined" && navigator.webdriver === true;
