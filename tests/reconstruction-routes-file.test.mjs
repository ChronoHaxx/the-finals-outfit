// The reconstruction host map is committed as a file (87% release, 27 Oct 2026): at 547 prefixes it no longer fits a
// Windows environment variable (32,767 characters). CI and the build read it through *_ROUTES_FILE; these checks keep
// the workflow, the file and the runtime parser in agreement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseReconstructionRoutes } from '../src/lib/asset-routing.mjs';

const FILE = 'src/data/reconstruction-routes.json';
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const named = workflow.match(/^\s*RECONSTRUCTION_ROUTES_FILE:\s*(\S+)\s*$/m)?.[1];

test('the deploy workflow names the routes file for validation and build, never inline JSON', () => {
  assert.ok(!/^\s*RECONSTRUCTION_ROUTES:/m.test(workflow), 'inline RECONSTRUCTION_ROUTES');
  assert.ok(!/^\s*VITE_RECONSTRUCTION_ROUTES:/m.test(workflow), 'inline VITE_RECONSTRUCTION_ROUTES');
  if (!named) return; // a release with one reconstruction host has no routes
  assert.equal(named, FILE);
  assert.match(workflow, /^\s*VITE_RECONSTRUCTION_ROUTES_FILE:\s*\$\{\{ env\.RECONSTRUCTION_ROUTES_FILE \}\}\s*$/m);
});

test('the committed routes file parses and names only immutable asset deployments', { skip: !existsSync(FILE) }, () => {
  const text = readFileSync(FILE, 'utf8');
  const routes = parseReconstructionRoutes(text.trim());
  assert.ok(Object.keys(routes).length > 0);
  for (const base of new Set(Object.values(routes)))
    assert.match(base, /^https:\/\/[0-9a-f]{8}\.the-finals-outfit-assets\.pages\.dev\/$/, base);
  const base = workflow.match(/^\s*RECONSTRUCTION_BASE:\s*(\S+)\s*$/m)?.[1];
  assert.ok(base && !Object.values(routes).includes(base), 'the control host is RECONSTRUCTION_BASE, not a route');
});
