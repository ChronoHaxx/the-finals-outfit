"""Synthetic contracts for the opt-in activeComponentReuse policy exact-active-component-tag-delta-v1; no game assets,
GPU or browser.

Reuses the literal fixtures of tests/test_multipart_active_reuse.py (a declared reused sock component with the real
preflight, pinned family checks and Node freeze module). The originating report here recorded the eight BaseTankTop
jacket tags and today's manifest applies the four HoodieZipup tags of reference/first-mask-probe.json. Expected pins
are hashed here from literal fixture bytes; real extraction, conversion, coverage derivation and indexing are Astra's.

  python -B tests/test_multipart_tag_reuse.py -v
"""
import hashlib
import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tests' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


t = _load('multipart_tag_reuse_fixtures', 'test_multipart_active_reuse.py')
tm = _load('multipart_tag_reuse_material_fixtures', 'test_multipart_material_reuse.py')
mp, mar, NODE, FIELD = t.mp, t.mar, t.NODE, t.mar.FIELD
P, S = 'Customization.Shape.PushInsideClothes.', 'Customization.Shape.ShrinkWrap.'
OLD = [P + 'push_full_jacket', S + 'shrink_under_jacket', S + 'shrink_skirt_in', S + 'shrink_skirt_shorts_in',
       S + 'shrink_gloves_under_jacket', P + 'push_hair_in_back', P + 'push_hair_in_front', S + 'shrink_under_collar']
NEW = [P + 'push_full_jacket', P + 'push_hair_in_back', S + 'shrink_half_skirt_in', S + 'shrink_skirt_shorts_in']
DELTA = {'removed': [S + 'shrink_under_jacket', S + 'shrink_skirt_in', S + 'shrink_gloves_under_jacket', P + 'push_hair_in_front',
                     S + 'shrink_under_collar'], 'added': [S + 'shrink_half_skirt_in']}
FAMILY, BASELINE = t.DOCS / 'family.json', t.DOCS / 'frozen-baseline.json'
MASK = Path(t.DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def tag_fixture(policy=mar.TAG_POLICY, origin=lambda p: p.update(fittingTags=OLD), tags=NEW, doc=None):
    """The origin report records its own tags; the request applies today's tags under the named policy."""
    t.edit(t.REPORT, lambda d: origin(d['occlusionPolicy']))
    doc = doc or t.request()
    doc['fittingTags'] = tags
    doc[FIELD]['policy'] = policy
    t.write('manifests/request.json', doc)


def expected():
    entry = read('public/models/active/assets.json')['meshes'][t.SOCK]
    return {'policy': mar.TAG_POLICY, 'components': [{
        'source': t.SOCK, 'originReport': t.REPORT, 'entrySha256': mar.v1.entry_sha(entry), 'glbSha256': hashlib.sha256(t.SOCK_GLB).hexdigest(),
        'maskSha256': hashlib.sha256(t.SOCK_MASK).hexdigest(), 'originReportSha256': t.sha(t.REPORT),
        'originFittingTags': OLD, 'appliedFittingTags': NEW, 'fittingTagDelta': DELTA}]}


def node(script, cfg):
    """Runs script with cfg = familyConfig(cfg JSON) and the freeze/reuse modules imported; returns its JSON output."""
    t.write('cfg.json', cfg)
    urls = [(ROOT / 'scripts' / 'shader-probe' / f).as_uri() for f in ('freeze-multipart-family.mjs', 'multipart-active-reuse.mjs')]
    code = (f"import fs from 'node:fs'; import {{familyConfig, validateManifest}} from '{urls[0]}';"
            f"import {{assertComponentReuse}} from '{urls[1]}'; const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));"
            "const raw = read('cfg.json'); const cohort = read('_docs/kit/cohort.json');" + script)
    result = subprocess.run([NODE, '--input-type=module', '-e', code], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    return json.loads(result.stdout)


NODE_RECEIPT = "console.log(JSON.stringify(assertComponentReuse(familyConfig(raw), cohort).receipt));"
NODE_VALID = "const ok = pinned => { try { validateManifest(raw, pinned); return true; } catch { return false; } }; console.log(JSON.stringify([ok(false), ok(true)]));"


def fresh(fam, tags=NEW, **policy):
    report = t.origin_report(indexFolder=fam.PREVIEW.as_posix())
    report['occlusionPolicy'].update(fittingTags=tags, **policy)
    return report


class Fixture(t.Fixture):
    def setUp(self):
        super().setUp()
        tag_fixture()

    def reset(self, **changes):
        t.reset(self)
        tag_fixture(**changes)

    def family(self):
        fam, preview = t.Stages.family(self)
        c = fam.COMPONENT_REUSE['components'][0]
        return fam, preview, [{'source': t.SOCK, 'meshSha256': c['glbSha256'], 'maskSha256': c['maskSha256'], 'uvTiles': [2, 1]}]


class Accepted(Fixture):
    def test_literal_tags_are_pinned_before_extraction_and_replayed_through_freeze_fresh_and_read_only(self):
        seen = []

        def extract(kind, name, packages):
            seen.append(read(BASELINE)[FIELD])
            t.default_extract(kind, name, packages)
        t.preflight(t.legacy_with(extract))
        manifest = read(FAMILY)
        self.assertEqual((seen, manifest[FIELD]), ([expected()], expected()))
        self.assertIs(mp.validate_manifest(manifest), manifest)
        t.preflight()  # a resumed preflight re-derives and compares, never repins
        if NODE:  # the independent Node freeze re-derives the same pins from the same files
            self.assertEqual(node(NODE_RECEIPT, manifest), expected())
            self.assertEqual(node(NODE_VALID, manifest), [False, True])
        fam, preview, good = self.family()
        fam._baseline()
        fam._require_preserved_entries(preview)
        fam._require_unrelated_masks()
        mar.require_fresh(fam.COMPONENT_REUSE, fam._reused_entries(), fresh(fam), good)
        before = {p: Path(p).read_bytes() for p in (BASELINE, t.DOCS / 'adapter-baseline.json', 'public/models/active/assets.json', t.REPORT)}
        replay = mp.MultipartFamily(FAMILY, legacy=t.legacy_with())
        replay._baseline()
        replay._require_preserved_entries(preview)
        self.assertEqual({p: Path(p).read_bytes() for p in before}, before)  # read-only replay keeps receipts and entries

    def test_declared_material_reuse_coexists(self):
        tm.fixture()
        tag_fixture(origin=lambda p: None, doc=read('manifests/request.json'))
        t.preflight()
        manifest = read(FAMILY)
        self.assertEqual((manifest[FIELD], manifest[tm.mmr.FIELD]), (expected(), {'policy': tm.mmr.POLICY, 'materials': [tm.expected_pin()]}))
        fam = mp.MultipartFamily(FAMILY, legacy=t.legacy_with())
        self.assertEqual((fam.REUSED, fam.KEPT_MATERIALS), ([t.SOCK], [tm.WOOL]))
        if NODE:
            self.assertEqual(node(NODE_RECEIPT, manifest), expected())


class Rejected(Fixture):
    def test_strict_policy_rejects_the_same_tag_delta(self):
        self.reset(policy=mar.POLICY)
        extract = mock.Mock()
        with self.assertRaisesRegex(SystemExit, "'applied fitting tags'"):
            t.preflight(t.legacy_with(extract))
        extract.assert_not_called()
        self.reset()
        fam, _, good = self.family()
        strict = {'policy': mar.POLICY, 'components': [{k: v for k, v in c.items() if k not in mar.TAG_PINS}
                                                       for c in fam.COMPONENT_REUSE['components']]}
        with self.assertRaisesRegex(SystemExit, 'occlusionPolicy.fittingTags'):
            mar.require_fresh(strict, fam._reused_entries(), fresh(fam), good)

    def test_invalid_or_identical_origin_tags_fail_before_extraction(self):
        cases = {
            'missing': lambda p: p.pop('fittingTags'), 'empty': lambda p: p.update(fittingTags=[]),
            'duplicate': lambda p: p.update(fittingTags=OLD + OLD[:1]), 'not a list': lambda p: p.update(fittingTags=OLD[0]),
            'not a string': lambda p: p.update(fittingTags=[*OLD, 7]), 'unsupported tag': lambda p: p.update(fittingTags=[*OLD, 'Customization.Other.x']),
            'padded tag': lambda p: p.update(fittingTags=[' ' + OLD[0]]), 'identical to today': lambda p: p.update(fittingTags=NEW),
            'not fitted': lambda p: p.update(name='conservative'), 'no settings': lambda p: p.update(settings={}),
        }
        for name, origin in cases.items():
            with self.subTest(name):
                self.reset(origin=origin)
                extract = mock.Mock()
                with self.assertRaisesRegex(SystemExit, 'does not prove its active mask'):
                    t.preflight(t.legacy_with(extract))
                extract.assert_not_called()
                self.assertFalse(FAMILY.exists())

    def test_fresh_derivation_must_reproduce_the_mask_under_the_intended_tags(self):
        fam, _, good = self.family()
        receipt, entries = fam.COMPONENT_REUSE, fam._reused_entries()
        cases = {
            'one mask byte': (fresh(fam), [{**good[0], 'maskSha256': hashlib.sha256(t.SOCK_MASK + b'\x01').hexdigest()}], 'pinned active mask'),
            'uv tiles': (fresh(fam), [{**good[0], 'uvTiles': [2]}], 'UV tiles'),
            'missing record': (fresh(fam), [], 'pinned active mask'),
            'settings': (fresh(fam, settings={'azimuths': 4}), good, 'settings'),
            'helper': (fresh(fam, helperSha256='0' * 64), good, 'helperSha256'),
            'generator': (fresh(fam, generatorSha256='0' * 64), good, 'generatorSha256'),
            'body': ({**fresh(fam), 'bodySha256': '0' * 64}, good, 'bodySha256'),
            'format': ({**fresh(fam), 'formatVersion': 2}, good, 'formatVersion'),
            'origin tags': (fresh(fam, OLD), good, 'fittingTags'),
            'other valid tags': (fresh(fam, NEW[:2]), good, 'fittingTags'),
            'no tags': (fresh(fam, None), good, 'fittingTags'),
        }
        for name, (report, components, message) in cases.items():
            with self.subTest(name), self.assertRaisesRegex(SystemExit, message):
                mar.require_fresh(receipt, entries, report, components)
        for name, change, message in (
                ('current helper', lambda: t.pf.HELPER.write_text('// other helper\n'), "'helper'"),
                ('current generator', lambda: t.pf.GENERATOR.write_text('// other generator\n'), "'generator'"),
                ('current body', lambda: (Path('public') / t.pf.FITTED_BODY).write_text('// other body\n'), "'body'"),
                ('origin report', lambda: t.edit(t.REPORT, lambda d: d.update(note=1)), 'originReportSha256'),
                ('accepted mask', lambda: MASK.write_bytes(t.SOCK_MASK + b'!'), 'accepted files changed')):
            with self.subTest(name):
                fam, _, good = (self.reset(), self.family())[1]
                change()
                with self.assertRaisesRegex(SystemExit, message):
                    mar.require_fresh(fam.COMPONENT_REUSE, fam._reused_entries(), fresh(fam), good)

    def test_changes_after_the_early_pin_fail(self):
        t.preflight()
        for name, change, message in (
                ('manifest tags', lambda: t.edit('manifests/request.json', lambda d: d.update(fittingTags=NEW[:3])), 'never repinned'),
                ('origin report bytes', lambda: Path(t.REPORT).write_bytes(Path(t.REPORT).read_bytes() + b'\n'), 'never repinned'),
                ('saved receipt tags', lambda: t.edit(BASELINE, lambda d: d[FIELD]['components'][0].update(originFittingTags=OLD[::-1])), 'never repinned')):
            with self.subTest(name):
                self.reset()
                t.preflight()
                change()
                with self.assertRaisesRegex(SystemExit, message):
                    t.preflight()
        for name, change, message in (
                ('frozen receipt delta', lambda fam: t.edit(BASELINE, lambda d: d[FIELD]['components'][0]['fittingTagDelta'].update(added=[])), 'early receipt'),
                ('active binding', lambda fam: t.edit(fam.WORK / 'active-before' / 'assets.json', lambda d: d['meshes'][t.SOCK].update(y=1)), 'not the frozen')):
            with self.subTest(name):
                self.reset()
                fam, preview, _ = self.family()
                change(fam)
                with self.assertRaisesRegex(SystemExit, message):
                    fam._baseline()
                    fam._require_preserved_entries(preview)
        # A self-consistent forged pin (other valid origin tags and their delta) passes the shape check, then fails
        # the replay that re-derives it from the report bytes and today's manifest, in Python and in Node.
        self.reset()
        t.preflight()
        forged = read(FAMILY)
        forged[FIELD]['components'][0].update(mar.tag_receipt(OLD[:3], NEW))
        self.assertIs(mp.validate_manifest(forged), forged)
        t.write(FAMILY, forged)
        with self.assertRaisesRegex(SystemExit, 'pinned fitting tags'):
            mp.MultipartFamily(FAMILY, legacy=t.legacy_with())._reused_entries()
        if NODE:
            with self.assertRaisesRegex(AssertionError, 'differs from the manifest'):
                node(NODE_RECEIPT, forged)

    def test_forged_fields_and_unknown_policies_fail_in_python_and_node(self):
        pinned = expected()['components'][0]
        request = read('manifests/request.json')

        def variant(change, doc=request):
            doc = json.loads(json.dumps(doc))
            change(doc[FIELD])
            return doc
        requests = {
            'receipt fields in a request': variant(lambda f: f['components'][0].update({k: pinned[k] for k in mar.TAG_PINS})),
            'bypass boolean': variant(lambda f: f.update(allowTagDelta=True)),
            'component bypass': variant(lambda f: f['components'][0].update(ignoreFittingTags=True)),
            **{f'policy {p!r}': variant(lambda f, p=p: f.update(policy=p)) for p in
               ('exact-active-component-v2', 'exact-active-component-tag-delta-v2', 'EXACT-ACTIVE-COMPONENT-TAG-DELTA-V1', '', None, [mar.TAG_POLICY])},
        }
        t.preflight()
        manifest = read(FAMILY)
        manifests = {
            'inconsistent delta': variant(lambda f: f['components'][0]['fittingTagDelta'].update(removed=[]), manifest),
            'reordered applied': variant(lambda f: f['components'][0].update(appliedFittingTags=NEW[::-1]), manifest),
            'missing tag pin': variant(lambda f: f['components'][0].pop('originFittingTags'), manifest),
            'origin equals applied': variant(lambda f: f['components'][0].update(mar.tag_receipt(NEW, NEW)), manifest),
            'strict with tag pins': variant(lambda f: f.update(policy=mar.POLICY), manifest),
        }
        for name, doc in {**requests, **manifests}.items():
            with self.subTest(name), self.assertRaises(SystemExit):
                mp.validate_manifest(doc, pinned=name not in requests)
            if NODE:
                self.assertEqual(node(NODE_VALID, doc), [False, False], name)
        for call in (lambda: mar.policy_of({'policy': 'x'}), lambda: mar.origin({}, {}, None, {}, {}, 'x'),
                     lambda: mar.require_fresh({'policy': 'x', 'components': []}, {}, {}, [])):
            with self.assertRaisesRegex(SystemExit, 'unsupported policy'):
                call()


class Unchanged(Fixture):
    def test_strict_receipt_shape_and_absent_field_are_unchanged(self):
        t.reset(self)  # the old fixture: equal tags under exact-active-component-v1
        t.preflight()
        receipt = read(FAMILY)[FIELD]
        self.assertEqual((receipt['policy'], set(receipt['components'][0])), (mar.POLICY, {'source', 'originReport', *mar.PINS}))
        t.reset(self)
        t.write('manifests/request.json', t.request(None))
        with self.assertRaisesRegex(SystemExit, 'Already-active mesh/material reuse'):
            t.preflight(t.legacy_with(mock.Mock()))
        self.assertEqual(read(BASELINE).keys(), {'hashes'})


if __name__ == '__main__':
    unittest.main()
