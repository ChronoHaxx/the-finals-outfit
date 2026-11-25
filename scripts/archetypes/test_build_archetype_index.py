"""The archetype builder must account for every class mesh the item definitions name: added, refused or skipped with a
reason, never dropped silently.

The real risk is an apply that quietly loses rows: on 23 Nov the S12 batch A apply repointed 15 Medium meshes, and the
re-planned Light list shrank by 15 with nothing in report.json saying why. These checks drive build-archetype-index.py
on a synthetic models folder (a few tiny skinned GLBs, an index, item definitions), one mesh per skip reason, so no game
data or server is needed. (Run: python -I scripts/archetypes/test_build_archetype_index.py)
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_archetype_index', HERE / 'build-archetype-index.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

STAGING = 'season11-staging-20261018'
SCALES = {'L': 0.85, 'H': 1.15}
JOINTS = {'root': [0.0, 0.0, 0.0], 'spine': [0.0, 0.5, 0.0]}   # world positions; spine's parent is root
POSITIONS = np.array([[0, 0, 0], [0.1, 0.4, 0], [0, 0.6, 0.1]], dtype=np.float32)


def path(name):
    return f'/Game/Discovery/Characters/T/{name}.{name}'


def write_glb(file, name, scale=1.0, bind=None, tag=None, shift=0.0, spine=0.5, slots=('Main',), swap_joints=False,
              ibm_noise=0.0, morph=None):
    """A skinned GLB like the extraction writes (one triangle per material slot): source package, material slots, skin,
    joint nodes, NORMAL, JOINTS_0/WEIGHTS_0, optional morph target. `bind` scales the vertices instead of `scale` (a
    reshaped class mesh); `tag` changes only the bytes (another read or rebuild of the same mesh); `shift` moves a
    vertex (the game changed the mesh); `spine` is vertex 1's spine weight (a reweight); `slots` names the primitives'
    material slots in order; `swap_joints` lists the skin's joints in the other order (indices remapped, same mesh);
    `ibm_noise` adds float noise to the inverse binds (a re-convert); `morph` (name, dz) adds one morph target."""
    pos = (POSITIONS * (scale if bind is None else bind)).astype(np.float32)
    pos[2, 0] += shift
    uv = np.array([[0, 0], [1, 0], [0, 1]], dtype=np.float32)
    normals = np.array([[0, 0, 1]] * 3, dtype=np.float32)
    idx = np.array([0, 1, 2], dtype=np.uint16)
    ibm = np.stack([np.eye(4, dtype=np.float32) for _ in JOINTS])
    for m, p in zip(ibm, JOINTS.values()):
        m[:3, 3] = -scale * np.array(p)
        m[0, 1] += ibm_noise
    joints = np.array([[0, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 0]], dtype=np.uint8)
    weights = np.array([[1, 0, 0, 0], [1 - spine, spine, 0, 0], [1, 0, 0, 0]], dtype=np.float32)
    order = [0, 1]
    if swap_joints:
        order = [1, 0]
        ibm = ibm[::-1].copy()
        joints = np.where(weights > 0, 1 - joints, 0).astype(np.uint8)
    deltas = np.zeros((3, 3), dtype=np.float32)
    if morph:
        deltas[:, 2] = morph[1]
    chunks = [pos.tobytes(), uv.tobytes(), idx.tobytes() + b'\0\0', ibm.transpose(0, 2, 1).tobytes(),
              joints.tobytes(), weights.tobytes(), normals.tobytes(), deltas.tobytes()]
    views, offset = [], 0
    for c in chunks:
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(c)})
        offset += len(c)
    j = {
        'asset': {'version': '2.0'},
        'extras': {'source': tool.package_of(path(name)), **({'read': tag} if tag else {})},
        'buffers': [{'byteLength': offset}],
        'bufferViews': views,
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3'},
            {'bufferView': 1, 'componentType': 5126, 'count': 3, 'type': 'VEC2'},
            {'bufferView': 2, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'},
            {'bufferView': 3, 'componentType': 5126, 'count': len(JOINTS), 'type': 'MAT4'},
            {'bufferView': 4, 'componentType': 5121, 'count': 3, 'type': 'VEC4'},
            {'bufferView': 5, 'componentType': 5126, 'count': 3, 'type': 'VEC4'},
            {'bufferView': 6, 'componentType': 5126, 'count': 3, 'type': 'VEC3'},
            {'bufferView': 7, 'componentType': 5126, 'count': 3, 'type': 'VEC3'},
        ],
        'materials': [{'extras': {'sourceSlot': {'MaterialSlotName': s}, 'sourceMaterial': f'MI_{s}'}} for s in slots],
        'meshes': [{'extras': {'targetNames': [morph[0]]} if morph else {}, 'primitives': [
            {'attributes': {'POSITION': 0, 'NORMAL': 6, 'TEXCOORD_0': 1, 'JOINTS_0': 4, 'WEIGHTS_0': 5},
             'indices': 2, 'material': i, **({'targets': [{'POSITION': 7}]} if morph else {})}
            for i in range(len(slots))]}],
        'nodes': [{'name': 'root', 'translation': [0.0, 0.0, 0.0], 'children': [1]},
                  {'name': 'spine', 'translation': [0.0, 0.5 * scale, 0.0]},
                  {'name': name, 'mesh': 0, 'skin': 0}],
        'skins': [{'joints': order, 'inverseBindMatrices': 3}],
    }
    js = json.dumps(j).encode()
    js += b' ' * (-len(js) % 4)
    body = b''.join(chunks)
    out = (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(body))
           + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(body)) + b'BIN\0' + body)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(out)
    return hashlib.sha256(out).hexdigest()


class EveryClassMeshAccounted(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        models = tmp / 'models'
        staged = models / STAGING / 'source-glb'
        meshes, parts = {}, []

        def medium(name, swaps, kind='skeletal', sha=None, stage=True, index=True):
            """One Medium mesh: staged (a real GLB) or not, in the index or not, and its class swaps {L|H: target}."""
            live = write_glb(staged / f'{name}.glb', name) if stage else 'not-staged'
            if index:
                meshes[path(name)] = {'kind': kind, 'url': f'../live/{name}.glb', 'sha256': sha or live,
                                      'slots': [{'slot': 'Main'}]}
            parts.append({'SkeletalMesh': {'AssetPathName': path(name)}, 'TagOverrides': [
                {'MatchingTags': [f'Customization.Archetype.{"Light" if c == "L" else "Heavy"}'], 'bOverrideMesh': True,
                 'ReplacementSkeletalMesh': {'AssetPathName': path(t)}} for c, t in swaps]})

        def stage(name, cls, **kw):
            write_glb(staged / f'{name}.glb', name, scale=SCALES[cls], **kw)

        # The bodies: Light proven; Heavy named but never staged, so its class cannot be built.
        medium('SK_Body_M', [('L', 'SK_Body_L'), ('H', 'SK_Body_H')])
        stage('SK_Body_L', 'L')
        # Proven on both classes: Light joins, Heavy is skipped with its class.
        medium('SK_Good_M', [('L', 'SK_Good_L'), ('H', 'SK_Good_H')])
        stage('SK_Good_L', 'L')
        stage('SK_Good_H', 'H')
        # Refused: class mesh not staged; class mesh reshaped (not a pure scale of Medium).
        medium('SK_Lonely_M', [('L', 'SK_Lonely_L')])
        medium('SK_Reshaped_M', [('L', 'SK_Reshaped_L')])
        stage('SK_Reshaped_L', 'L', bind=0.9)
        # Skipped, one per reason.
        medium('SK_Repointed_M', [('L', 'SK_Repointed_L')], sha='s12-refresh-build')   # live serves another build
        stage('SK_Repointed_L', 'L')
        medium('SK_Unstaged_M', [('L', 'SK_Unstaged_L')], stage=False)
        medium('SK_Gone_M', [('L', 'SK_Gone_L')], index=False)
        medium('SK_Static_M', [('L', 'SK_Static_L')], kind='static')
        medium('SK_Twice_M', [('L', 'SK_Twice_L'), ('L', 'SK_TwiceAlt_L'), ('H', 'SK_Twice_H')])
        medium('SK_Known_M', [('L', 'SK_Known_L')])
        meshes[path('SK_Known_L')] = {'kind': 'skeletal', 'url': '../live/SK_Known_L.glb', 'sha256': 'x',
                                      'slots': [{'slot': 'Main'}]}

        index = models / 'reconstructed-assemblies-v1'
        index.mkdir(parents=True)
        self.assets = {'attachmentBody': {'source': path('SK_Body_M')}, 'meshes': meshes,
                       'itemBodyMasks': {'Item_Good': {path('SK_Good_M'): '../coverage/good.png'}}}
        (index / 'assets.json').write_text(json.dumps(self.assets), encoding='utf-8')
        pairs = {'items': {'Face_1': {'body': {'sourceMesh': path('SK_Body_M'), 'boundsOrigin': [0.0, 0.0, 1.0]}}}}
        (index / 'skin-pairs.json').write_text(json.dumps(pairs), encoding='utf-8')
        items = models / 'reconstructed-assembly-v2' / 'items'
        items.mkdir(parents=True)
        (items / 'DA_Test.json').write_text(json.dumps({'properties': {'VisualParts': parts}}), encoding='utf-8')
        self.named = {t for p in parts for o in p['TagOverrides'] for t in [o['ReplacementSkeletalMesh']['AssetPathName']]}

        self.models, self.staged, self.tmp = models, staged, tmp
        self.out = tmp / 'out'
        self.printed, self.report, self.result = self.run_builder(self.out)

    def run_builder(self, out):
        printed = io.StringIO()
        with mock.patch.object(sys, 'argv', ['build', '--models', str(self.models), '--out', str(out)]), \
                contextlib.redirect_stdout(printed):
            tool.main()
        return (printed.getvalue(), json.loads((out / 'report.json').read_text(encoding='utf-8')),
                json.loads((out / 'assets.json').read_text(encoding='utf-8')))

    def apply_and_add_late_mesh(self):
        """Make the first run's index the active one (the apply), then stage one more Medium/Light pair."""
        index = self.models / 'reconstructed-assemblies-v1'
        active = dict(self.result)
        active['meshes'] = dict(active['meshes'])
        active['meshes'][path('SK_Late_M')] = {'kind': 'skeletal', 'url': '../live/SK_Late_M.glb',
                                               'sha256': write_glb(self.staged / 'SK_Late_M.glb', 'SK_Late_M'),
                                               'slots': [{'slot': 'Main'}]}
        write_glb(self.staged / 'SK_Late_L.glb', 'SK_Late_L', scale=SCALES['L'])
        (index / 'assets.json').write_text(json.dumps(active), encoding='utf-8')
        late = {'SkeletalMesh': {'AssetPathName': path('SK_Late_M')}, 'TagOverrides': [
            {'MatchingTags': ['Customization.Archetype.Light'], 'bOverrideMesh': True,
             'ReplacementSkeletalMesh': {'AssetPathName': path('SK_Late_L')}}]}
        items = self.models / 'reconstructed-assembly-v2' / 'items'
        (items / 'DA_Late.json').write_text(json.dumps({'properties': {'VisualParts': [late]}}), encoding='utf-8')
        return active

    def reasons(self, name):
        return [r['reason'] for r in self.report['skipped'][path(name)]['reasons']]

    def test_every_named_class_mesh_is_added_refused_or_skipped_exactly_once(self):
        added = {k for v in self.report['added'].values() for k in v}
        refused, skipped = set(self.report['refused']), set(self.report['skipped'])
        self.assertEqual(added | refused | skipped, self.named)
        self.assertFalse(added & refused or added & skipped or refused & skipped)

    def test_proven_light_meshes_join_and_heavy_drops_with_its_body(self):
        self.assertEqual(self.report['added'], {'light': [path('SK_Body_L'), path('SK_Good_L')], 'heavy': []})
        self.assertEqual(sorted(self.result['archetypes']), ['light'])
        self.assertEqual(self.report['classes']['heavy'], {'refused': 'class body not proven'})
        self.assertEqual(self.reasons('SK_Good_H'), ['class body not proven'])
        self.assertEqual(self.result['itemBodyMasks']['Item_Good'][path('SK_Good_L')], '../coverage/good.png')
        self.assertNotIn(path('SK_Good_H'), self.result['meshes'])

    def test_proof_failures_are_refusals_not_skips(self):
        self.assertEqual(self.report['refused'][path('SK_Lonely_L')], ['not staged beside its Medium sibling'])
        self.assertEqual(self.report['refused'][path('SK_Body_H')], ['not staged beside its Medium sibling'])
        self.assertIn('bind is not a pure x0.85 scale', self.report['refused'][path('SK_Reshaped_L')][0])

    def test_each_skip_names_its_reason_and_medium(self):
        self.assertEqual(self.reasons('SK_Repointed_L'), ['medium sibling repointed'])
        row = self.report['skipped'][path('SK_Repointed_L')]['reasons'][0]
        self.assertEqual((row['medium'], row['liveSha256'], row['liveUrl']),
                         (path('SK_Repointed_M'), 's12-refresh-build', '../live/SK_Repointed_M.glb'))
        self.assertEqual(self.reasons('SK_Unstaged_L'), ['medium sibling not staged'])
        self.assertEqual(self.reasons('SK_Gone_L'), ['medium not in the active index'])
        self.assertEqual(self.reasons('SK_Static_L'), ['medium not skeletal in the active index'])
        self.assertEqual(self.reasons('SK_Known_L'), ['already in the active index'])
        for name in ('SK_Twice_L', 'SK_TwiceAlt_L', 'SK_Twice_H'):
            self.assertEqual(self.reasons(name), ['swap conflict'])
        self.assertEqual(self.report['skipped'][path('SK_Twice_H')]['reasons'][0]['candidates'],
                         {'light': [path('SK_TwiceAlt_L'), path('SK_Twice_L')], 'heavy': [path('SK_Twice_H')]})

    def test_skips_are_counted_listed_and_printed(self):
        self.assertEqual(self.report['skippedCounts']['light'], {
            'already in the active index': 1, 'medium not in the active index': 1,
            'medium not skeletal in the active index': 1, 'medium sibling not staged': 1,
            'medium sibling repointed': 1, 'swap conflict': 2})
        self.assertEqual(self.report['skippedCounts']['heavy'], {'class body not proven': 1, 'swap conflict': 1})
        rows = [line.split('\t') for line in (self.out / 'skipped.tsv').read_text(encoding='utf-8').splitlines()]
        self.assertEqual(len(rows), len(self.report['skipped']))
        self.assertIn([path('SK_Repointed_L'), 'light', 'medium sibling repointed', path('SK_Repointed_M')], rows)
        self.assertIn(f'{len(self.report["skipped"])} skipped;', self.printed)
        self.assertIn('skipped light: 1 medium sibling repointed', self.printed)

    def test_a_later_run_on_the_applied_index_keeps_the_class_and_adds_new_meshes(self):
        # 23 Nov 2026: on the index with Light applied, SK_Body_L is "already in the active index"; the class must
        # still build (re-proven against the staged Medium body), or every new Light mesh would drop with it.
        active = self.apply_and_add_late_mesh()
        _, report, result = self.run_builder(self.tmp / 'out2')
        self.assertEqual(report['added'], {'light': [path('SK_Late_L')], 'heavy': []})
        self.assertTrue(report['classes']['light']['alreadyApplied'])
        self.assertEqual(result['archetypes'], self.result['archetypes'])
        self.assertEqual(self.reasons_in(report, 'SK_Good_L'), ['already in the active index'])
        for key, value in active['meshes'].items():
            self.assertEqual(result['meshes'][key], value)

    def test_a_repointed_medium_body_drops_new_meshes_but_keeps_the_applied_record(self):
        active = self.apply_and_add_late_mesh()
        active['meshes'][path('SK_Body_M')] = dict(active['meshes'][path('SK_Body_M')], sha256='s12-body')
        (self.models / 'reconstructed-assemblies-v1' / 'assets.json').write_text(json.dumps(active), encoding='utf-8')
        _, report, result = self.run_builder(self.tmp / 'out3')
        self.assertEqual(report['added'], {'light': [], 'heavy': []})
        self.assertEqual(report['classes']['light'], {'refused': 'class body not proven'})
        self.assertEqual(self.reasons_in(report, 'SK_Late_L'), ['class body not proven'])
        self.assertEqual(result['archetypes'], self.result['archetypes'])

    @staticmethod
    def reasons_in(report, name):
        return [r['reason'] for r in report['skipped'][path(name)]['reasons']]

    def test_the_active_index_is_only_added_to(self):
        for key, value in self.assets['meshes'].items():
            self.assertEqual(self.result['meshes'][key], value)


class FreshReadsAndLiveEqualMedium(unittest.TestCase):
    """The bulk extraction (23 Nov 2026): a fresh read is never byte-identical to the live Medium, so proof 1' compares
    what the class mesh inherits; and a fresh read's currency is its own clean run, while an S11 read still needs the
    17 Nov proof. Light is already applied here, as on the live index."""

    def setUp(self):
        self.tmp = tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        self.models = models = tmp / 'models'
        s11, live, self.run_dir = models / STAGING / 'source-glb', models / 'live', tmp / 'run'
        meshes, parts = {}, []

        def medium(name, live_kw=None, stage_kw=None, where=s11):
            """A Medium the index serves from live/ (written with live_kw), and a staged read (stage_kw) with its
            Light sibling beside it."""
            meshes[path(name)] = {'kind': 'skeletal', 'url': f'../live/{name}.glb', 'slots': [{'slot': 'Main'}],
                                  'sha256': write_glb(live / f'{name}.glb', name, **(live_kw or {'tag': 'live'}))}
            write_glb(where / f'{name}.glb', name, **(stage_kw or {}))
            light = name[:-2] + '_L'
            write_glb(where / f'{light}.glb', light, scale=SCALES['L'])
            parts.append({'SkeletalMesh': {'AssetPathName': path(name)}, 'TagOverrides': [
                {'MatchingTags': ['Customization.Archetype.Light'], 'bOverrideMesh': True,
                 'ReplacementSkeletalMesh': {'AssetPathName': path(light)}}]})

        # Light applied: both bodies indexed, the staged S11 bodies byte-identical to them.
        body_m = write_glb(s11 / 'SK_Body_M.glb', 'SK_Body_M')
        body_l = write_glb(s11 / 'SK_Body_L.glb', 'SK_Body_L', scale=SCALES['L'])
        for name, sha in (('SK_Body_M', body_m), ('SK_Body_L', body_l)):
            meshes[path(name)] = {'kind': 'skeletal', 'url': f'../{STAGING}/source-glb/{name}.glb', 'sha256': sha,
                                  'slots': [{'slot': 'Main'}]}
        parts.append({'SkeletalMesh': {'AssetPathName': path('SK_Body_M')}, 'TagOverrides': [
            {'MatchingTags': ['Customization.Archetype.Light'], 'bOverrideMesh': True,
             'ReplacementSkeletalMesh': {'AssetPathName': path('SK_Body_L')}}]})
        medium('SK_Same_M')                                   # the live GLB is another build of the same mesh
        medium('SK_Moved_M', live_kw={'shift': 0.01})         # the game changed the mesh since the staged read
        medium('SK_Reweighted_M', live_kw={'spine': 0.3})     # our own rework changed the live weights
        medium('SK_Fresh_M', stage_kw={'tag': 'fresh'}, where=self.run_dir / 'source-glb')   # read today

        index = models / 'reconstructed-assemblies-v1'
        index.mkdir(parents=True)
        self.assets = {'attachmentBody': {'source': path('SK_Body_M')}, 'meshes': meshes,
                       'archetypes': {'light': {'body': path('SK_Body_L'), 'skeletonScale': 0.85,
                                                'boundsOrigin': [0.0, 0.0, 0.85]}}}
        (index / 'assets.json').write_text(json.dumps(self.assets), encoding='utf-8')
        pairs = {'items': {'Face_1': {'body': {'sourceMesh': path('SK_Body_M'), 'boundsOrigin': [0.0, 0.0, 1.0]}}}}
        (index / 'skin-pairs.json').write_text(json.dumps(pairs), encoding='utf-8')
        items = models / 'reconstructed-assembly-v2' / 'items'
        items.mkdir(parents=True)
        (items / 'DA_Test.json').write_text(json.dumps({'properties': {'VisualParts': parts}}), encoding='utf-8')
        self.write_run({'b01': {'guard': {'exitCode': 0}, 'mappingSha256': 'F36B', 'missing': [], 'glb': {'exit': 0}}})

    def write_run(self, batches, control_ok=True):
        record = {'policy': 'archetypes-light-bulk-run-v1', 'usmapSha256': 'f36b', 'control': {'ok': control_ok},
                  'batches': batches}
        (self.run_dir / 'run.json').write_text(json.dumps(record), encoding='utf-8')

    def build(self, *flags):
        out = self.tmp / f'out-{len(list(self.tmp.glob("out-*")))}'
        with mock.patch.object(sys, 'argv', ['build', '--models', str(self.models), '--out', str(out), *flags]), \
                contextlib.redirect_stdout(io.StringIO()):
            tool.main()
        return json.loads((out / 'report.json').read_text(encoding='utf-8'))

    @staticmethod
    def reasons(report, name):
        return [r['reason'] for r in report['skipped'][path(name)]['reasons']]

    def test_without_proof_1_prime_a_rebuilt_live_medium_is_only_repointed(self):
        report = self.build()
        self.assertEqual(report['added']['light'], [])
        self.assertEqual(self.reasons(report, 'SK_Same_L'), ['medium sibling repointed'])

    def test_proof_1_prime_admits_the_same_mesh_and_names_what_differs_otherwise(self):
        report = self.build('--live-equal-medium')
        self.assertEqual(report['classes']['light']['alreadyApplied'], True)
        self.assertIn(path('SK_Same_L'), report['added']['light'])
        self.assertEqual(report['meshes'][path('SK_Same_L')]['proof1'], 'live-equal')
        self.assertEqual(self.reasons(report, 'SK_Moved_L'), ['medium changed in the game'])
        self.assertEqual(report['skipped'][path('SK_Moved_L')]['reasons'][0]['differs'], 'positions')
        self.assertEqual(self.reasons(report, 'SK_Reweighted_L'), ['live Medium reweighted'])
        self.assertEqual(report['skipped'][path('SK_Reweighted_L')]['reasons'][0]['maxU16Steps'], round(0.2 * 65535))
        # Every comparison is recorded, passing or not, for the row table.
        self.assertEqual(report['proof1Prime'][path('SK_Same_M')]['verdict'], 'pass')
        self.assertEqual(report['proof1Prime'][path('SK_Moved_M')]['verdict'], 'medium changed in the game')

    def test_a_fresh_read_needs_its_clean_run_and_an_s11_read_still_needs_the_17_nov_proof(self):
        report = self.build('--live-equal-medium', '--staging', str(self.run_dir))
        self.assertEqual(report['added']['light'], [path('SK_Fresh_L')])
        self.assertEqual(report['meshes'][path('SK_Fresh_L')]['currency'], "read from today's containers (stagingRuns)")
        self.assertEqual(report['refused'][path('SK_Same_L')],
                         ['read before the 17 Nov update, and no --proven proof given'])
        self.assertEqual(report['stagingRuns'][0]['batches'], ['b01'])

    def test_a_run_with_a_guard_refusal_or_a_missing_package_is_not_used(self):
        for bad in ({'guard': {'exitCode': 1}, 'mappingSha256': 'f36b', 'missing': []},
                    {'guard': {'exitCode': 0}, 'mappingSha256': 'e5b2', 'missing': []},
                    {'guard': {'exitCode': 0}, 'mappingSha256': 'f36b', 'missing': ['X.uasset']},
                    {'guard': {'exitCode': 0}, 'mappingSha256': 'f36b', 'missing': [], 'glb': 'pending'}):
            self.write_run({'b01': bad})
            with self.assertRaises(SystemExit):
                self.build('--live-equal-medium', '--staging', str(self.run_dir))
        self.write_run({'b01': {'guard': {'exitCode': 0}, 'mappingSha256': 'f36b', 'missing': [], 'glb': {'exit': 0}}}, control_ok=False)
        with self.assertRaises(SystemExit):
            self.build('--live-equal-medium', '--staging', str(self.run_dir))


class LiveEqualMediumRule(unittest.TestCase):
    """Proof 1' as the coordinator approved it (23 Nov 2026): same mesh up to float noise passes, with any morph
    differences recorded; a different surface, a changed joint order, a weight change beyond u16 quantization or a
    swapped material slot fails, with its reason."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def compare(self, staged, live):
        a, b = self.tmp / 'staged' / 'SK_X_M.glb', self.tmp / 'live' / 'SK_X_M.glb'
        write_glb(a, 'SK_X_M', **staged)
        write_glb(b, 'SK_X_M', tag='live', **live)
        return tool.live_equal(a, b)

    def test_the_same_mesh_up_to_float_noise_passes(self):
        # (0.25: away from a u16 rounding boundary; at one, float noise can flip a weight by one step and fail.)
        for staged, live in (({}, {}), ({}, {'ibm_noise': 1e-9}), ({'spine': 0.25}, {'spine': 0.25 + 1e-6}),
                             ({'slots': ('Main', 'Trim')}, {'slots': ('Main', 'Trim')})):
            ok, why, detail = self.compare(staged, live)
            self.assertTrue(ok, (staged, live, why, detail))

    def test_morph_differences_pass_but_are_recorded(self):
        ok, _, detail = self.compare({'morph': ('medium_female', 0.01)}, {'morph': ('medium_female', 0.02)})
        self.assertTrue(ok)
        self.assertEqual(detail['morphs']['changedCm'], {'medium_female': 1.0})
        ok, _, detail = self.compare({'morph': ('medium_male', 0.01)}, {})
        self.assertTrue(ok)
        self.assertEqual(detail['morphs']['onlyStaged'], ['medium_male'])

    def test_a_different_surface_fails(self):
        self.assertEqual(self.compare({}, {'shift': 0.01})[1:], ('medium changed in the game', {'differs': 'positions',
                         'primitive': 0, 'maxM': unittest.mock.ANY}))

    def test_a_changed_joint_order_fails(self):
        ok, why, detail = self.compare({}, {'swap_joints': True})
        self.assertEqual((ok, why, detail['differs']), (False, 'medium changed in the game', 'skin joint names or order'))

    def test_inverse_binds_beyond_epsilon_fail(self):
        ok, why, detail = self.compare({}, {'ibm_noise': 1e-3})
        self.assertEqual((ok, detail['differs']), (False, 'inverse-bind matrices'))

    def test_a_weight_change_beyond_quantization_fails(self):
        ok, why, detail = self.compare({}, {'spine': 0.51})
        self.assertEqual((ok, why, detail['differs'], detail['vertices']), (False, 'live Medium reweighted', 'weights', 1))

    def test_a_swapped_material_slot_fails(self):
        ok, why, detail = self.compare({'slots': ('Main', 'Trim')}, {'slots': ('Trim', 'Main')})
        self.assertEqual((ok, why, detail['differs']), (False, 'medium changed in the game', 'material slots'))


REAL = Path('E:/Coding/the-finals-outfit')
OCT_READ = REAL / 'scripts/generated/shader-probe/season11-staging-20261018/meshes-raw'
OCT_GLB = REAL / 'public/models/season11-staging-20261018/source-glb/SK_Casual_LowWedgeHeels_M.glb'
CONVERTER = REAL / 'scripts/shader-probe/stage-season-assets.py'


@unittest.skipUnless(OCT_READ.is_dir() and OCT_GLB.is_file() and CONVERTER.is_file(),
                     'needs the local 18 Oct read and the root checkout converter')
class LiveEqualOnARealReconvert(unittest.TestCase):
    def test_the_18_oct_read_against_its_reconvert_passes(self):
        # A re-convert of the same read is not byte-identical (last-digit joint rotation noise, 23 Nov 2026); proof 1'
        # must still pass it, with no morph differences.
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        job = None
        for f in sorted(OCT_READ.glob('chunk-*/assets.json')):
            for r in json.loads(f.read_text(encoding='utf-8-sig')):
                if (r.get('meshFile') or '').endswith('SK_Casual_LowWedgeHeels_M.mesh.json'):
                    job = {'name': r['path'], 'meshJson': str(f.parent / r['meshFile']),
                           'glbOut': str(tmp / 'SK_Casual_LowWedgeHeels_M.glb'), 'previous': None}
        self.assertIsNotNone(job)
        (tmp / 'jobs.json').write_text(json.dumps([job]), encoding='utf-8')
        import subprocess
        subprocess.run([sys.executable, '-I', str(CONVERTER), 'build-glbs', '--jobs', str(tmp / 'jobs.json'),
                        '--report', str(tmp / 'report.json')], check=True, capture_output=True)
        reconvert = tmp / 'SK_Casual_LowWedgeHeels_M.glb'
        self.assertNotEqual(reconvert.read_bytes(), OCT_GLB.read_bytes())
        ok, why, detail = tool.live_equal(reconvert, OCT_GLB)
        self.assertTrue(ok, (why, detail))
        self.assertEqual(detail['morphs'], {'changedCm': {}, 'onlyStaged': [], 'onlyLive': []})


if __name__ == '__main__':
    unittest.main()
