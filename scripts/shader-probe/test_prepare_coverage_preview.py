"""A preview rerun must prove it owns its output directory, not just recognise file names."""
import copy
import errno
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import importlib.util

spec = importlib.util.spec_from_file_location('prepare_coverage_preview',
                                              Path(__file__).with_name('prepare-coverage-preview.py'))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class OutputGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.models = self.root / 'public' / 'models'
        self.models.mkdir(parents=True)
        patch = mock.patch.object(preview, 'PUBLIC', self.root / 'public')
        patch.start()
        self.addCleanup(patch.stop)
        self.base = self.models / 'active-index'
        self.base.mkdir()
        self.materials = [self.models / 'staged-materials']
        self.output = self.models / 'preview-index'

    def guard(self, output=None, materials=None):
        preview.guard_output(output or self.output, self.base, materials or self.materials)

    def marker(self, **overrides):
        self.output.mkdir(exist_ok=True)
        record = {'formatVersion': 1, **preview.identity(self.base, self.materials), **overrides}
        (self.output / 'preview.json').write_text(json.dumps(record))

    def test_accepts_a_new_or_empty_directory(self):
        self.guard()
        self.output.mkdir()
        self.guard()

    def test_accepts_its_own_previous_run(self):
        self.marker()
        (self.output / 'assets.json').write_text('{}')
        self.guard()

    def test_rejects_an_unowned_index_using_reserved_names(self):
        self.output.mkdir()
        sentinel = self.output / 'assets.json'
        sentinel.write_text('preserve-this-existing-index')
        with self.assertRaises(ValueError):
            self.guard()
        self.assertEqual(sentinel.read_text(), 'preserve-this-existing-index')

    def test_rejects_a_marker_from_different_inputs(self):
        self.marker(materialSets=[(self.models / 'other-materials').as_posix()])
        with self.assertRaises(ValueError):
            self.guard()
        self.marker(base=(self.models / 'other-index').as_posix())
        with self.assertRaises(ValueError):
            self.guard()
        self.marker(marker='something-else')
        with self.assertRaises(ValueError):
            self.guard()

    def test_rejects_extra_files_even_with_a_valid_marker(self):
        self.marker()
        (self.output / 'unrelated.bin').write_bytes(b'game data')
        with self.assertRaises(ValueError):
            self.guard()

    def test_rejects_an_unreadable_marker(self):
        self.output.mkdir()
        (self.output / 'preview.json').write_text('not json')
        with self.assertRaises(ValueError):
            self.guard()

    def test_rejects_output_outside_public_models(self):
        with self.assertRaises(ValueError):
            self.guard(output=self.root / 'elsewhere')
        with self.assertRaises(ValueError):
            self.guard(output=self.base)

    @unittest.skipUnless(hasattr(Path, 'symlink_to'), 'symlinks unavailable')
    def test_rejects_a_linked_output_path(self):
        target = self.root / 'outside'
        target.mkdir()
        link = self.models / 'linked-preview'
        try:
            link.symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('creating symlinks is not permitted here')
        with self.assertRaises(ValueError) as raised:
            self.guard(output=link)
        self.assertIn('symbolic link', str(raised.exception))


def unmemoised_shape(document, folder):
    """resolved_shape as it was before the per-call memo: the semantics to preserve."""
    def convert(value):
        if isinstance(value, str):
            try:
                target = (folder / value).resolve()
                if not target.is_file(): return value
            except OSError:
                return value
            return 'resolved:' + os.path.relpath(target, preview.PUBLIC).replace('\\', '/')
        if isinstance(value, list): return [convert(v) for v in value]
        if isinstance(value, dict): return {k: convert(v) for k, v in value.items()}
        return value
    return convert(document)


def strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, list):
        for item in value: yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values(): yield from strings(item)


def containers(value):
    if isinstance(value, (list, dict)):
        yield value
        for item in (value.values() if isinstance(value, dict) else value): yield from containers(item)


class ResolvedShape(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        patch = mock.patch.object(preview, 'PUBLIC', self.root / 'public')
        patch.start()
        self.addCleanup(patch.stop)
        self.index = self.root / 'public' / 'models' / 'index'
        self.other = self.root / 'public' / 'models' / 'other-index'
        for file in (self.index / 'mesh.glb', self.index / 'masks' / 'body.png', self.other / 'mesh.glb',
                     self.root / 'public' / 'models' / 'shared' / 'tex.bin', self.root / 'outside.bin'):
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'synthetic')

    def document(self):
        return {
            'formatVersion': 2,
            'meshes': {
                'a': {'url': 'mesh.glb', 'bodyMaskUrl': 'masks/body.png', 'scale': 1.5, 'hidden': False,
                      'slots': [{'material': '/Game/Shared/M.M'}]},
                'b': {'url': 'mesh.glb', 'slots': [{'material': '/Game/Shared/M.M'}, {'material': 'missing.glb'}]},
            },
            'materials': {'/Game/Shared/M.M': '../shared/tex.bin', 'mesh.glb': 'https://cdn.example.test/mesh.glb'},
            'unknownField': {'nested': [['mesh.glb', 'missing.glb', 3, None, True, 0.0],
                                        {'deep': 'masks/body.png', 'url': 'data:image/png;base64,AAAA'}],
                             'empty': [], 'blank': {}, 'text': '', 'escape': '../../../outside.bin'},
            'labels': ['masks', 'mesh.glb', '../shared/tex.bin', 'https://cdn.example.test/mesh.glb', '.',
                       'line\nbreak', 'mesh.glb'],
        }

    def test_repeated_mixed_strings_resolve_exactly_as_before(self):
        document = self.document()
        result = preview.resolved_shape(document, self.index)
        # repr also pins key order and primitive types (True is not 1, 0.0 is not 0).
        self.assertEqual(repr(result), repr(unmemoised_shape(document, self.index)))
        mesh = 'resolved:models/index/mesh.glb'
        self.assertEqual(result['meshes']['a']['url'], mesh)
        self.assertEqual(result['meshes']['b']['url'], mesh)
        self.assertEqual(result['meshes']['a']['bodyMaskUrl'], 'resolved:models/index/masks/body.png')
        self.assertEqual(result['materials'], {'/Game/Shared/M.M': 'resolved:models/shared/tex.bin',
                                               'mesh.glb': 'https://cdn.example.test/mesh.glb'})
        self.assertEqual(result['unknownField']['nested'][0], [mesh, 'missing.glb', 3, None, True, 0.0])
        self.assertEqual(result['unknownField']['nested'][1]['deep'], 'resolved:models/index/masks/body.png')
        self.assertEqual(result['unknownField']['escape'], 'resolved:../outside.bin')
        self.assertEqual(result['labels'], ['masks', mesh, 'resolved:models/shared/tex.bin',
                                            'https://cdn.example.test/mesh.glb', '.', 'line\nbreak', mesh])

    def test_looks_up_each_distinct_string_once_per_call(self):
        document = self.document()
        values = list(strings(document))
        unique = set(values)
        self.assertGreater(len(values), len(unique))
        resolve, is_file = Path.resolve, Path.is_file
        with mock.patch.object(Path, 'resolve', autospec=True, side_effect=resolve) as resolved, \
                mock.patch.object(Path, 'is_file', autospec=True, side_effect=is_file) as checked:
            first = preview.resolved_shape(document, self.index)
            self.assertEqual(sorted(str(c.args[0]) for c in resolved.call_args_list),
                             sorted(str(self.index / value) for value in unique))
            self.assertEqual(checked.call_count, len(unique))
            second = preview.resolved_shape(document, self.index)
            self.assertEqual(resolved.call_count, 2 * len(unique))
            self.assertEqual(checked.call_count, 2 * len(unique))
        self.assertEqual(repr(first), repr(second))

    def test_rebuilds_every_container_without_touching_the_input(self):
        shared = {'url': 'mesh.glb', 'tags': ['masks', 'mesh.glb']}
        twin_a, twin_b = ''.join(['miss', 'ing.glb']), ''.join(['miss', 'ing.glb'])
        self.assertIsNot(twin_a, twin_b)
        document = {'first': shared, 'second': shared, 'twins': [['mesh.glb'], ['mesh.glb']],
                    'pair': [twin_a, twin_b], 'flag': True, 'count': 1, 'ratio': 1.0, 'none': None}
        snapshot = copy.deepcopy(document)
        result = preview.resolved_shape(document, self.index)

        self.assertEqual(repr(document), repr(snapshot))
        self.assertIs(document['first'], document['second'])
        inputs = {id(c) for c in containers(document)}
        outputs = [id(c) for c in containers(result)]
        self.assertEqual(len(outputs), len(set(outputs)), 'an output container is shared')
        self.assertFalse(inputs & set(outputs), 'an input container leaked into the output')
        result['first']['tags'].append('extra')
        result['twins'][0].append('extra')
        self.assertEqual(result['second']['tags'], ['masks', 'resolved:models/index/mesh.glb'])
        self.assertEqual(result['twins'][1], ['resolved:models/index/mesh.glb'])
        self.assertEqual(repr(document), repr(snapshot))
        # Non-files come back as the very objects given, not an equal string from the memo.
        self.assertIs(result['pair'][0], twin_a)
        self.assertIs(result['pair'][1], twin_b)
        self.assertIs(result['flag'], True)
        self.assertIs(type(result['count']), int)
        self.assertIs(type(result['ratio']), float)
        self.assertIsNone(result['none'])

    def test_each_call_sees_current_files_and_its_own_folder(self):
        document = {'late': 'late.bin', 'gone': 'mesh.glb', 'swapped': 'masks/body.png',
                    'again': ['late.bin', 'mesh.glb', 'masks/body.png']}
        before = preview.resolved_shape(document, self.index)
        self.assertEqual(before, {'late': 'late.bin', 'gone': 'resolved:models/index/mesh.glb',
                                  'swapped': 'resolved:models/index/masks/body.png',
                                  'again': ['late.bin', 'resolved:models/index/mesh.glb',
                                            'resolved:models/index/masks/body.png']})

        (self.index / 'late.bin').write_bytes(b'synthetic')
        (self.index / 'mesh.glb').unlink()
        (self.index / 'masks' / 'body.png').unlink()
        (self.index / 'masks' / 'body.png').mkdir()  # same path, no longer a file
        after = preview.resolved_shape(document, self.index)
        self.assertEqual(after, {'late': 'resolved:models/index/late.bin', 'gone': 'mesh.glb',
                                 'swapped': 'masks/body.png',
                                 'again': ['resolved:models/index/late.bin', 'mesh.glb', 'masks/body.png']})
        self.assertEqual(repr(after), repr(unmemoised_shape(document, self.index)))

        elsewhere = preview.resolved_shape(document, self.other)
        self.assertEqual(elsewhere, {'late': 'late.bin', 'gone': 'resolved:models/other-index/mesh.glb',
                                     'swapped': 'masks/body.png',
                                     'again': ['late.bin', 'resolved:models/other-index/mesh.glb',
                                               'masks/body.png']})

    def test_os_errors_leave_the_string_as_given_for_this_call_only(self):
        (self.index / 'denied.bin').write_bytes(b'synthetic')
        document = {'a': 'denied.bin', 'b': ['denied.bin', 'mesh.glb', 'locked.bin'], 'c': 'locked.bin'}
        (self.index / 'locked.bin').write_bytes(b'synthetic')
        resolve, is_file = Path.resolve, Path.is_file

        def failing_resolve(path, *args, **kwargs):
            if path.name == 'denied.bin': raise PermissionError(errno.EACCES, 'denied', str(path))
            return resolve(path, *args, **kwargs)

        def failing_is_file(path):
            if path.name == 'locked.bin': raise OSError(errno.EIO, 'unreadable', str(path))
            return is_file(path)

        with mock.patch.object(Path, 'resolve', autospec=True, side_effect=failing_resolve) as resolved, \
                mock.patch.object(Path, 'is_file', autospec=True, side_effect=failing_is_file):
            result = preview.resolved_shape(document, self.index)
            denied = [c for c in resolved.call_args_list if c.args[0].name == 'denied.bin']
            self.assertEqual(repr(result), repr(unmemoised_shape(document, self.index)))
        self.assertEqual(result, {'a': 'denied.bin', 'b': ['denied.bin', 'resolved:models/index/mesh.glb', 'locked.bin'],
                                  'c': 'locked.bin'})
        self.assertEqual(len(denied), 1, 'a failed lookup is not retried within the call')
        # The fallback is not remembered: once the error clears, the files resolve.
        self.assertEqual(preview.resolved_shape(document, self.index),
                         {'a': 'resolved:models/index/denied.bin',
                          'b': ['resolved:models/index/denied.bin', 'resolved:models/index/mesh.glb',
                                'resolved:models/index/locked.bin'],
                          'c': 'resolved:models/index/locked.bin'})

    def test_other_errors_propagate_unchanged(self):
        document = {'url': 'mesh.glb', 'bad': ['mesh.glb', 'nul\0byte']}
        for shape in (unmemoised_shape, preview.resolved_shape):
            with self.assertRaisesRegex(ValueError, 'embedded null'):
                shape(document, self.index)
        # An error while making the path public-relative was never a silent fallback.
        with mock.patch('os.path.relpath', side_effect=OSError(errno.EIO, 'relpath failed')):
            for shape in (unmemoised_shape, preview.resolved_shape):
                with self.assertRaisesRegex(OSError, 'relpath failed'):
                    shape({'url': 'mesh.glb'}, self.index)
        self.assertEqual(preview.resolved_shape({'url': 'mesh.glb'}, self.index),
                         {'url': 'resolved:models/index/mesh.glb'})


if __name__ == '__main__':
    unittest.main()
