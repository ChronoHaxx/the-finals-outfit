"""Independent negative-path checks for the Tactical Gloves adapter and freeze.

These use only the Python standard library plus the Node binary already present. There are no game
assets, packages or a real browser here, so this exercises the contract boundaries with tiny synthetic
data: the freeze's pure validators (wrong source mesh/type/slot, changed source build, preserved frozen
output) and the adapter's required configuration. It does not and cannot claim extraction, shader, GPU,
preview, outfit or human acceptance.
"""
import json
import py_compile
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-tactical-gloves.py'
FREEZE = ROOT / '_docs' / 'tactical-gloves-2026-09-13' / 'freeze.mjs'
RESOLVER = ROOT / 'src' / 'rig' / 'SourceAssembly.ts'


def node_available():
    try:
        return subprocess.run(['node', '--version'], capture_output=True, text=True).returncode == 0
    except OSError:
        return False


DRIVER = r"""
import * as F from '__URL__';
const MESH = F.SOURCE_MESH;
const MAT = '/Game/Discovery/Characters/Military/Assets/TacticalGloves/Skins/Test/MI_Test.MI_Test';
const out = {};
const ok = (name, fn) => { try { fn(); out[name] = 'ok'; } catch { out[name] = 'throw'; } };
const item = {id: 'glove-0', name: 'glove', slot: 'hands', materials: [MAT]};
const definition = {formatVersion: 1, id: 'glove-0', source: 'Pkg', sourceSha256: 'abc', properties: {}};
const current = {status: 'ok', package: {sha256: 'abc'}, exports: [{type: 'CharacterCustomizationItem', properties: {}}]};
const slots = [{slot: F.MATERIAL_SLOT, material: 'DEFAULT'}];
const part = () => ({sourceIndex: 0, staticMesh: '', skeletalMesh: MESH, effect: '', hidden: false, rules: [],
  unresolved: [], materials: {[F.MATERIAL_SLOT]: MAT},
  definition: {LocalPosition: {X: 0, Y: 0, Z: 0}, LocalRotation: {Pitch: 0, Yaw: 0, Roll: 0}, LocalScale: {X: 1, Y: 1, Z: 1}}});
const resolved = () => ({parts: [part()], materialParameters: []});
const cohort = n => ({meshes: [MESH], items: Array.from({length: n},
  (_, i) => ({id: `glove-${i}`, name: `g${i}`, slot: 'hands', materials: [`${MAT}.${i}`]}))});

ok('cohort_ok', () => F.assertCohort(cohort(20)));
ok('cohort_count', () => F.assertCohort(cohort(19)));
ok('cohort_duplicate', () => { const c = cohort(20); c.items[1].id = c.items[0].id; F.assertCohort(c); });
ok('cohort_slot', () => { const c = cohort(20); c.items[3].slot = 'head'; F.assertCohort(c); });
ok('cohort_mesh', () => { const c = cohort(20); c.meshes = [MESH, MESH]; F.assertCohort(c); });
ok('cohort_wrong_mesh', () => { const c = cohort(20); c.meshes = ['/Game/Other.Other']; F.assertCohort(c); });

ok('dto_ok', () => F.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: F.MATERIAL_SLOT}], materials: [{path: MAT}]}));
ok('dto_wrong_slot', () => F.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'Head'}], materials: [{path: MAT}]}));
ok('dto_extra_slot', () => F.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: F.MATERIAL_SLOT}, {MaterialSlotName: 'Head'}],
  materials: [{path: MAT}, {path: MAT}]}));
ok('dto_incomplete', () => F.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: F.MATERIAL_SLOT}], materials: []}));

ok('current_ok', () => F.assertCurrentDefinition(item, definition, current));
ok('current_mismatch', () => { const c = structuredClone(current); c.package.sha256 = 'zzz'; F.assertCurrentDefinition(item, definition, c); });
ok('current_missing', () => F.assertCurrentDefinition(item, definition, undefined));
ok('current_properties', () => { const c = structuredClone(current); c.exports[0].properties = {VisualParts: [1]}; F.assertCurrentDefinition(item, definition, c); });

ok('resolved_ok', () => F.assertResolved(item, definition, resolved(), slots));
ok('resolved_wrong_mesh', () => { const r = resolved(); r.parts[0].skeletalMesh = '/Game/Other.Other'; F.assertResolved(item, definition, r, slots); });
ok('resolved_static', () => { const r = resolved(); r.parts[0].staticMesh = '/Game/S.S'; F.assertResolved(item, definition, r, slots); });
ok('resolved_effect', () => { const r = resolved(); r.parts[0].effect = '/Game/E.E'; F.assertResolved(item, definition, r, slots); });
ok('resolved_unresolved', () => { const r = resolved(); r.parts[0].unresolved = ['x']; F.assertResolved(item, definition, r, slots); });
ok('resolved_hidden', () => { const r = resolved(); r.parts[0].hidden = true; F.assertResolved(item, definition, r, slots); });
ok('resolved_attached', () => { const r = resolved(); r.parts[0].definition.bIsAttached = true; F.assertResolved(item, definition, r, slots); });
ok('resolved_transform', () => { const r = resolved(); r.parts[0].definition.LocalPosition = {X: 1, Y: 0, Z: 0}; F.assertResolved(item, definition, r, slots); });
ok('resolved_material', () => { const i = structuredClone(item); i.materials = [`${MAT}.other`]; F.assertResolved(i, definition, resolved(), slots); });
ok('resolved_absent_slot', () => { const r = resolved(); r.parts[0].materials = {Head: MAT}; F.assertResolved(item, definition, r, slots); });
ok('resolved_param', () => { const r = resolved(); r.materialParameters = [{itemId: 'x'}]; F.assertResolved(item, definition, r, slots); });

const report = {glb: 'g', meshJson: 'm', sha256: 'h', sourceDtoSha256: 'd', source: 'Pkg'};
const shaFn = p => (p === 'g' ? 'h' : 'd');
ok('mesh_report_ok', () => F.assertMeshReport(report, new Set(['Pkg']), shaFn));
ok('mesh_report_inventory', () => F.assertMeshReport(report, new Set(), shaFn));
ok('mesh_report_glb', () => F.assertMeshReport({...report, sha256: 'x'}, new Set(['Pkg']), shaFn));

// Exercise the actual public resolver when this Node can import the TypeScript source (Node >= 23);
// otherwise the pure-validator contracts above still stand.
let resolver = null;
try { resolver = (await import('__TSURL__')).resolveSourceOutfit; } catch { resolver = null; }
out['resolver_available'] = resolver ? 'ok' : 'skip';
if (resolver) {
  const sourceDefinition = {formatVersion: 1, id: 'glove-0', source: 'Pkg', sourceSha256: 'abc', properties: {
    Slots: ['hands'],
    VisualParts: [{StaticMesh: {AssetPathName: ''}, SkeletalMesh: {AssetPathName: MESH}, Effect: {AssetPathName: ''},
      TagOverrides: [], OptionalAttachmentMesh: {AssetPathName: ''}}],
    MaterialOverrides: [{Key: F.MATERIAL_SLOT, Value: {AssetPathName: MAT}}]}};
  ok('resolver_ok', () => F.assertResolved(item, sourceDefinition,
    resolver([sourceDefinition], [F.CONTEXT]).items['glove-0'], slots));
  const wrong = structuredClone(sourceDefinition);
  wrong.properties.VisualParts[0].SkeletalMesh = {AssetPathName: '/Game/Other.Other'};
  ok('resolver_wrong_mesh', () => F.assertResolved(item, wrong,
    resolver([wrong], [F.CONTEXT]).items['glove-0'], slots));
}

import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gloves-freeze-'));
const frozen = nodePath.join(dir, 'resolved.json');
out['frozen_first'] = F.writeFrozen(frozen, {a: 1}) === true ? 'ok' : 'throw';
ok('frozen_identical', () => F.writeFrozen(frozen, {a: 1}));
ok('frozen_differs', () => F.writeFrozen(frozen, {a: 2}));

console.log(JSON.stringify(out));
"""


@unittest.skipUnless(node_available(), 'node is required for the freeze validator checks')
class TacticalGlovesFreezeTest(unittest.TestCase):
    def test_freeze_negative_contracts(self):
        code = (DRIVER.replace('__URL__', FREEZE.as_uri())
                      .replace('__TSURL__', RESOLVER.as_uri()))
        result = subprocess.run(['node', '--input-type=module', '-e', code],
                                capture_output=True, text=True, cwd=str(ROOT))
        self.assertEqual(result.returncode, 0, result.stderr)
        outcomes = json.loads(result.stdout.strip().splitlines()[-1])
        expected_throw = {
            'cohort_count', 'cohort_duplicate', 'cohort_slot', 'cohort_mesh', 'cohort_wrong_mesh',
            'dto_wrong_slot', 'dto_extra_slot', 'dto_incomplete',
            'current_mismatch', 'current_missing', 'current_properties',
            'resolved_wrong_mesh', 'resolved_static', 'resolved_effect', 'resolved_unresolved',
            'resolved_hidden', 'resolved_attached', 'resolved_transform', 'resolved_material',
            'resolved_absent_slot', 'resolved_param',
            'mesh_report_inventory', 'mesh_report_glb', 'frozen_differs',
        }
        expected_ok = {'cohort_ok', 'dto_ok', 'current_ok', 'resolved_ok', 'mesh_report_ok',
                       'frozen_first', 'frozen_identical'}
        self.assertIn(outcomes.get('resolver_available'), ('ok', 'skip'))
        if outcomes.get('resolver_available') == 'ok':
            expected_ok |= {'resolver_ok'}
            expected_throw |= {'resolver_wrong_mesh'}
        for name in expected_ok:
            self.assertEqual(outcomes.get(name), 'ok', f'{name}: {outcomes.get(name)}')
        for name in expected_throw:
            self.assertEqual(outcomes.get(name), 'throw', f'{name}: {outcomes.get(name)}')
        self.assertEqual(set(outcomes), expected_ok | expected_throw | {'resolver_available'})


class TacticalGlovesAdapterTest(unittest.TestCase):
    def test_adapter_compiles(self):
        py_compile.compile(str(ADAPTER), doraise=True)

    @unittest.skipUnless(node_available(), 'node is required for the freeze syntax check')
    def test_freeze_syntax(self):
        result = subprocess.run(['node', '--check', str(FREEZE)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_adapter_repoints_the_shared_batch(self):
        text = ADAPTER.read_text(encoding='utf-8')
        required = [
            "DOCS = Path('_docs/tactical-gloves-2026-09-13')",
            "WORK = Path('scripts/generated/shader-probe/tactical-gloves-v1')",
            "RUNTIME = Path('public/models/reconstructed-tactical-gloves-v1')",
            "PREVIEW = Path('public/models/reconstructed-tactical-gloves-preview-v1')",
            "MESH_REPORT = DOCS / 'mesh-report.json'",
            "d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)",
            'd.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []',
            "d.MARKER = MARKER",
            's.progress = progress',
            "path = WORK / 'progress.json'",
            '/Game/Discovery/Characters/Military/Assets/TacticalGloves/',
            "SK_Military_TacticalGloves_M",
            "'TacticalGloves'",
            's.mesh()',
            'def _require_current_mesh():',
            "if d.file_sha(report['glb']) != report['sha256']",
            "d.stage_source(argparse.Namespace(fresh_sources=True))",
            "d.build_identity(d.SOURCE / 'meshes-01') != working",
        ]
        for needle in required:
            self.assertIn(needle, text)
        # The hoodie reuse branch and the shared opus progress name must not leak into this batch.
        self.assertNotIn('STAGED_DTO', text)
        self.assertNotIn('opus-progress.json', text)
        self.assertNotIn('REUSE_EXPORTS = [Path(', text)


if __name__ == '__main__':
    unittest.main()
