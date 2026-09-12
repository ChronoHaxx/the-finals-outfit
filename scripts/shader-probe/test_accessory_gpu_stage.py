"""The accessory GPU stage must never present a setup failure, or an earlier run's report, as a pass.

Repeated preparation is the real risk: the browser check writes a report, a later run fails to launch
or navigate, and the previous report is still on disk. These checks drive stage_gpu with a stand-in
child process, so no browser or dev server is needed.
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prepare_accessories', HERE / 'prepare-accessories.py')
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)

ROWS = [{'itemId': 'mi-a', 'cases': 2, 'maxAbsoluteError': 0.0}, {'itemId': 'mi-b', 'cases': 2, 'maxAbsoluteError': 0.0}]
CPU = [{'itemId': 'mi-a', 'material': 'MI_A', 'cases': 2, 'maxAbsoluteError': 0.0},
       {'itemId': 'mi-b', 'material': 'MI_B', 'cases': 2, 'maxAbsoluteError': 0.0}]


def child(rows, code):
    """Stand in for check-webgl.mjs: write the rows it was asked for (or nothing) and exit with code."""
    def call(command, stdout=None, stderr=None):
        if rows is not None: Path(command[4]).write_text(json.dumps(rows), encoding='utf-8')
        return code
    return call


class AccessoryGpuStage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.validation = self.work / 'validation'
        self.validation.mkdir(parents=True)
        self.fixtures = self.validation / 'translation-fixtures.json'
        (self.validation / 'translation-checks.json').write_text(json.dumps(CPU), encoding='utf-8')
        self.fixtures.write_text(json.dumps([{'itemId': 'mi-a'}, {'itemId': 'mi-b'}]), encoding='utf-8')
        self.previous_work, prepare.WORK = prepare.WORK, self.work
        self.previous_call = prepare.subprocess.call
        self.addCleanup(self.restore)

    def restore(self):
        prepare.WORK, prepare.subprocess.call = self.previous_work, self.previous_call

    def run_stage(self, rows, code):
        prepare.subprocess.call = child(rows, code)
        prepare.stage_gpu(None)

    def test_a_failed_run_cannot_reuse_the_previous_report(self):
        self.run_stage(ROWS, 0)
        self.assertEqual(prepare.accepted_ids(), {'mi-a', 'mi-b'})
        promoted = (self.validation / 'webgl-checks.json').read_bytes()
        # The browser never starts: the child writes nothing and fails. The stage must stop, so an
        # `all` run cannot reach indexing, and the earlier report must not be re-promoted as this run's.
        with self.assertRaises(SystemExit): self.run_stage(None, 1)
        self.assertEqual((self.validation / 'webgl-checks.json').read_bytes(), promoted)
        self.assertEqual(prepare.read_json(self.validation / 'webgl-run.json')['exitCode'], 0)
        # A rebuild changes the fixtures, so the promoted result no longer describes what is on disk.
        self.fixtures.write_text(json.dumps([{'itemId': 'mi-a'}, {'itemId': 'mi-b'}, {'itemId': 'mi-c'}]), encoding='utf-8')
        with self.assertRaises(SystemExit): prepare.accepted_ids()

    def test_an_incomplete_run_is_a_setup_failure(self):
        with self.assertRaises(SystemExit): self.run_stage(ROWS[:1], 0)
        self.assertFalse((self.validation / 'webgl-checks.json').exists())

    def test_material_failures_are_quarantined_rather_than_fatal(self):
        # The checker exits nonzero for per-material failures too; those are recorded and excluded.
        self.run_stage([ROWS[0], {**ROWS[1], 'cases': 0, 'error': 'shader mismatch'}], 1)
        self.assertEqual(prepare.accepted_ids(), {'mi-a'})
        self.assertEqual(prepare.read_json(self.validation / 'webgl-run.json')['failed'], ['mi-b'])

    def test_every_run_keeps_its_own_evidence(self):
        self.run_stage(ROWS, 0)
        with self.assertRaises(SystemExit): self.run_stage(None, 1)
        self.assertGreaterEqual(len(list((self.validation / 'webgl-runs').glob('*.log'))), 2)

    def test_a_hand_written_report_is_not_accepted(self):
        self.run_stage(ROWS, 0)
        # Same materials, different bytes: the promoted report no longer matches what the run recorded.
        (self.validation / 'webgl-checks.json').write_text(json.dumps(ROWS) + ' ', encoding='utf-8')
        with self.assertRaises(SystemExit): prepare.accepted_ids()


if __name__ == '__main__':
    unittest.main()
