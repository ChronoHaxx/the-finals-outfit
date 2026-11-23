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


def write_glb(file, name, scale=1.0, bind=None):
    """A one-triangle skinned GLB like the extraction writes: source package, material slot, skin, joint nodes.
    `bind` scales the vertices instead of `scale` (a reshaped class mesh)."""
    pos = (POSITIONS * (scale if bind is None else bind)).astype(np.float32)
    uv = np.array([[0, 0], [1, 0], [0, 1]], dtype=np.float32)
    idx = np.array([0, 1, 2], dtype=np.uint16)
    ibm = np.stack([np.eye(4, dtype=np.float32) for _ in JOINTS])
    for m, p in zip(ibm, JOINTS.values()):
        m[:3, 3] = -scale * np.array(p)
    chunks = [pos.tobytes(), uv.tobytes(), idx.tobytes() + b'\0\0', ibm.transpose(0, 2, 1).tobytes()]
    views, offset = [], 0
    for c in chunks:
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(c)})
        offset += len(c)
    j = {
        'asset': {'version': '2.0'},
        'extras': {'source': tool.package_of(path(name))},
        'buffers': [{'byteLength': offset}],
        'bufferViews': views,
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3'},
            {'bufferView': 1, 'componentType': 5126, 'count': 3, 'type': 'VEC2'},
            {'bufferView': 2, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'},
            {'bufferView': 3, 'componentType': 5126, 'count': len(JOINTS), 'type': 'MAT4'},
        ],
        'materials': [{'extras': {'sourceSlot': {'MaterialSlotName': 'Main'}, 'sourceMaterial': 'MI_Main'}}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'indices': 2, 'material': 0}]}],
        'nodes': [{'name': 'root', 'translation': [0.0, 0.0, 0.0], 'children': [1]},
                  {'name': 'spine', 'translation': [0.0, 0.5 * scale, 0.0]},
                  {'name': name, 'mesh': 0, 'skin': 0}],
        'skins': [{'joints': [0, 1], 'inverseBindMatrices': 3}],
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

        self.out = tmp / 'out'
        printed = io.StringIO()
        with mock.patch.object(sys, 'argv', ['build', '--models', str(models), '--out', str(self.out)]), \
                contextlib.redirect_stdout(printed):
            tool.main()
        self.printed = printed.getvalue()
        self.report = json.loads((self.out / 'report.json').read_text(encoding='utf-8'))
        self.result = json.loads((self.out / 'assets.json').read_text(encoding='utf-8'))

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

    def test_the_active_index_is_only_added_to(self):
        for key, value in self.assets['meshes'].items():
            self.assertEqual(self.result['meshes'][key], value)


if __name__ == '__main__':
    unittest.main()
