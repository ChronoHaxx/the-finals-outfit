import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyBodyCoverage } from '../src/rig/LegacyBodyCoverage';

test('derived singlet coverage preserves deployment host and query while retaining both UV tiles', () => {
  for (const base of ['models', '/models', '/the-finals-outfit/models', 'https://assets.example/v4-reconstruction/models']) {
    const result = resolveLegacyBodyCoverage(`${base}/cosmetics/streetwear-tight-singlet.glb?v=abc`,
      `${base}/reconstructed-meshes-v2/SK_Body_M.glb?v=abc`);
    assert.deepEqual(result, { url: `${base}/reconstructed-coverage-legacy-singlet-v1/streetwear-tight-singlet.bodymask.png?v=abc`, uvTiles: [2, 1] });
  }
});

test('other garments and body geometries retain their prior coverage', () => {
  const garment = '/models/cosmetics/streetwear-tight-singlet.glb';
  const medium = '/models/reconstructed-meshes-v2/SK_Body_M.glb';
  assert.equal(resolveLegacyBodyCoverage(garment, undefined), undefined);
  assert.equal(resolveLegacyBodyCoverage(garment, '/models/body/SK_Body_M.glb'), undefined);
  assert.equal(resolveLegacyBodyCoverage(garment, '/models/reconstructed-meshes-v2/SK_Body_H.glb'), undefined);
  assert.equal(resolveLegacyBodyCoverage('/models/cosmetics/streetwear-tight-singlet-sport-event.glb', medium), undefined);
  assert.equal(resolveLegacyBodyCoverage(garment + '.other', medium), undefined);
});
