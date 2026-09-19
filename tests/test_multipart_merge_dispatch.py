"""Scoped merger dispatch tests with fake families: no assets, GPU, network or index writes."""
import importlib.util, json, os, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'shader-probe' / 'merge-family-previews.py'
spec = importlib.util.spec_from_file_location('merge_family_previews', SCRIPT)
merger = importlib.util.module_from_spec(spec); spec.loader.exec_module(merger)
ACTIVE = Path('public/models/active')


class FakeD:
    def __init__(self, docs): self.docs = docs
    def read_json(self, path): return self.docs[Path(path).as_posix()]
    def file_sha(self, path): return 'sha:' + Path(path).as_posix()


class FakeFamily:
    def __init__(self, path, version, d, baseline):
        stem = Path(path).stem
        self.m = {'id': stem, 'schemaVersion': version}
        self.ACTIVE, self.PREVIEW, self.DOCS, self.d = ACTIVE, Path('public/models/' + stem), Path('_docs/' + stem), d
        self.baseline, self.calls = baseline, []
    def verify(self): self.calls.append('verify')
    def _require_frozen_baseline(self): self.calls.append('frozen')
    def _baseline(self): return {'hashes': self.baseline}


class Dispatch(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd(); self.tmp = tempfile.TemporaryDirectory(); os.chdir(self.tmp.name)
        self.saved = dict(merger.LOADERS), merger.coverage_preview, merger.family.Family, merger._multipart

    def tearDown(self):
        merger.LOADERS.clear(); merger.LOADERS.update(self.saved[0])
        merger.coverage_preview, merger.family.Family, merger._multipart = self.saved[1:]
        os.chdir(self.cwd); self.tmp.cleanup()

    def manifest(self, name, doc):
        Path(name).write_text(json.dumps(doc), encoding='utf-8'); return name

    def fakes(self, baselines, amendments=None):
        """Patch the loaders with fakes over one shared fake helper, and write an acceptance record."""
        docs = {'acceptance.json': {'sourceAccepted': True, 'visualAccepted': True, 'outfitsAccepted': True,
                                    'humanAcceptance': 'pending', 'evidenceHashes': {}, 'acceptedIds': []}}
        if amendments:
            docs['acceptance.json'].update(coveragePreviews=amendments,
                activeBaselineHashes={(ACTIVE / f).as_posix(): 'sha:' + (ACTIVE / f).as_posix() for f in merger.FILES})
        d, built = FakeD(docs), []
        for version in (1, 2):
            def load(path, version=version):
                family = FakeFamily(path, version, d, baselines[Path(path).stem]); built.append(family); return family
            merger.LOADERS[version] = load
        for stem in baselines: docs[f'_docs/{stem}/adapter-baseline.json'] = {'hashes': baselines[stem]}
        return built

    def test_schema_1_and_2_dispatch_in_order(self):
        calls = []
        loaders = {1: lambda p: calls.append(('v1', p)) or 'family', 2: lambda p: calls.append(('v2', p)) or 'multipart'}
        paths = [self.manifest('a.json', {'schemaVersion': 2}), self.manifest('b.json', {'schemaVersion': 1})]
        self.assertEqual(merger.load_families(paths, loaders), ['multipart', 'family'])
        self.assertEqual(calls, [('v2', 'a.json'), ('v1', 'b.json')])

    def test_default_loaders_are_family_and_multipart_family(self):
        seen = []
        merger.family.Family = lambda path: seen.append(('Family', path)) or 'v1'
        merger._multipart = type('M', (), {'MultipartFamily': staticmethod(lambda path: seen.append(('MultipartFamily', path)) or 'v2')})
        paths = [self.manifest('one.json', {'schemaVersion': 1}), self.manifest('two.json', {'schemaVersion': 2})]
        self.assertEqual(merger.load_families(paths), ['v1', 'v2'])
        self.assertEqual(seen, [('Family', 'one.json'), ('MultipartFamily', 'two.json')])

    def test_unknown_schema_fails_before_any_family_or_write(self):
        called = []
        loaders = {1: called.append, 2: called.append}
        good = self.manifest('good.json', {'schemaVersion': 2})
        for doc in ({'schemaVersion': 3}, {'schemaVersion': '2'}, {'schemaVersion': True}, {'schemaVersion': 2.0}, {}, [2]):
            with self.assertRaisesRegex(ValueError, 'Unsupported manifest schemaVersion'):
                merger.load_families([good, self.manifest('bad.json', doc)], loaders)
        self.assertEqual(called, [])
        self.fakes({'good': {'x': '1'}})
        with self.assertRaisesRegex(ValueError, 'Unsupported manifest schemaVersion 3'):
            merger.merge([good, self.manifest('bad.json', {'schemaVersion': 3})], 'acceptance.json', 'public/models/combined')
        self.assertFalse(Path('public').exists())

    def test_v2_coverage_amendments_are_rejected_before_mask_checks(self):
        merger.coverage_preview = lambda *a: self.fail('coverage_preview must not run for schemaVersion 2')
        paths = [self.manifest('one.json', {'schemaVersion': 1}), self.manifest('two.json', {'schemaVersion': 2})]
        built = self.fakes({'one': {}, 'two': {}}, amendments={'one': {}, 'two': {}})
        with self.assertRaisesRegex(ValueError, 'not supported for schemaVersion 2'):
            merger.merge(paths, 'acceptance.json', 'public/models/combined')
        self.assertEqual([f.calls for f in built], [[], []])
        self.assertFalse(Path('public').exists())

    def test_v1_coverage_amendments_still_reach_the_unchanged_mask_checks(self):
        class Reached(Exception): pass
        def reached(m, amendment): raise Reached(m.m['id'])
        merger.coverage_preview = reached
        built = self.fakes({'one': {}}, amendments={'one': {}})
        with self.assertRaises(Reached):
            merger.merge([self.manifest('one.json', {'schemaVersion': 1})], 'acceptance.json', 'public/models/combined')
        self.assertEqual(built[0].calls, ['verify'])

    def test_mixed_v1_v2_baselines_must_still_be_equal(self):
        paths = [self.manifest('one.json', {'schemaVersion': 1}), self.manifest('two.json', {'schemaVersion': 2})]
        built = self.fakes({'one': {'a': '1'}, 'two': {'a': '2'}})
        with self.assertRaisesRegex(ValueError, 'Previews have different baselines'):
            merger.merge(paths, 'acceptance.json', 'public/models/combined')
        self.assertEqual([f.calls for f in built], [['frozen'], ['frozen']])
        self.assertFalse(Path('public').exists())

    def test_acceptance_must_not_claim_human_acceptance_for_v2(self):
        built = self.fakes({'two': {}})
        built_docs = merger.LOADERS[2]  # keep the fake; flip the acceptance claim
        path = self.manifest('two.json', {'schemaVersion': 2})
        family = built_docs(path); family.d.docs['acceptance.json']['humanAcceptance'] = 'accepted'
        with self.assertRaisesRegex(ValueError, 'must not claim human acceptance'):
            merger.merge([path], 'acceptance.json', 'public/models/combined')


if __name__ == '__main__':
    unittest.main()
