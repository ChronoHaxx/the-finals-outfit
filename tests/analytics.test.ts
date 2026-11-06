import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsAllowed, type AnalyticsContext } from "../src/lib/analytics";
import { DEVELOPER_CATALOG_PATH } from "../src/lib/catalog-mode";

const production: AnalyticsContext = {
  hostname: "chronohaxx.github.io", pathname: "/the-finals-outfit/", baseUrl: "/the-finals-outfit/",
};

test("the production app reports, including shared-outfit and roadmap visits", () => {
  assert.equal(analyticsAllowed(production), true);
  assert.equal(analyticsAllowed({ ...production, pathname: "/the-finals-outfit/index.html" }), true);
  assert.equal(analyticsAllowed({ ...production, doNotTrack: "0", globalPrivacyControl: false, webdriver: false }), true);
});

test("local previews, forks and other builds never report", () => {
  for (const hostname of ["localhost", "127.0.0.1", "someone-else.github.io", "chronohaxx.github.io.evil.example"])
    assert.equal(analyticsAllowed({ ...production, hostname }), false, hostname);
  assert.equal(analyticsAllowed({ ...production, pathname: "/other-repo/" }), false);
  // A UI preview built into a sub-path of the same site.
  assert.equal(analyticsAllowed({ ...production, pathname: "/the-finals-outfit/new-ui-test/",
    baseUrl: "/the-finals-outfit/new-ui-test/" }), false);
  assert.equal(analyticsAllowed({ ...production, pathname: `/the-finals-outfit/${DEVELOPER_CATALOG_PATH}/` }), false);
});

test("visitors asking not to be tracked, and automated browsers, never report", () => {
  assert.equal(analyticsAllowed({ ...production, globalPrivacyControl: true }), false);
  assert.equal(analyticsAllowed({ ...production, doNotTrack: "1" }), false);
  assert.equal(analyticsAllowed({ ...production, webdriver: true }), false);
});
