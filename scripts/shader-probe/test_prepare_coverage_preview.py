"""A preview rerun must prove it owns its output directory, not just recognise file names."""
import json
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


if __name__ == '__main__':
    unittest.main()
