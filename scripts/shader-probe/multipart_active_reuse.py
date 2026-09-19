"""Opt-in reuse of already-active multipart COMPONENTS ("activeComponentReuse"; see multipart-family.md).

A schemaVersion 2 manifest may carry the field; without it nothing here runs and every v2 stage, receipt and gate is
unchanged (schemaVersion 1 never accepts it). A request names the policy and, per reused component, its source and
the repository path of the fitted derived-coverage.json that produced the active mask. Before any extraction,
preflight pins per component the canonical hash of the WHOLE active assets.json entry (unknown fields included), its
GLB and mask bytes and the bytes of that originating report, and saves them once in frozen-baseline.json; a resumed
preflight compares, never repins. Reuse is proven, never inferred from a name: the originating report must describe
this source, GLB, mask and UV tiles under today's body, helper, generator, applied fitting tags and fitted shared-UV
policy; the fresh conversion must be byte-identical to the active GLB with the entry's slot and default material;
and this family's own fresh fitted derivation must reproduce the active mask bytes, UV tiles and settings exactly.
The kept entry is never rewritten. At least one component and every material stay new. Nothing here writes.

A second, separately named policy (TAG_POLICY) differs in one rule only: the originating report may have applied other
fitting tags than today's manifest. Its own recorded tags must be a valid nonempty unique list of supported shape tags
that differs from today's; the receipt pins both ordered lists and their delta, re-derived from the report bytes and
the manifest on every replay; and the fresh derivation must run today's pinned tags. Everything else is unchanged.
Standard library only; the canonical entry hash, URL resolution and pinned reads are family_active_reuse's, unchanged.
"""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path

_spec = importlib.util.spec_from_file_location('family_active_reuse_for_components', Path(__file__).resolve().parent / 'family_active_reuse.py')
v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v1)

FIELD = 'activeComponentReuse'
POLICY = 'exact-active-component-v1'
TAG_POLICY = 'exact-active-component-tag-delta-v1'  # explicit opt-in; POLICY keeps its applied-tag equality
POLICIES = (POLICY, TAG_POLICY)
TAG_PINS = ('originFittingTags', 'appliedFittingTags', 'fittingTagDelta')
# prepare-family.FITTED_TAG: the shape tags the fitted generator can apply.
FITTED_TAG = re.compile(r'Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch)\.[A-Za-z0-9_]+')
MATERIAL_FIELD = 'activeMaterialReuse'  # the opt-in material slice on top of this one (multipart_material_reuse.py)
FITTED_MODE = 'fitted-conservative-shared-uv'
PINS = ('entrySha256', 'glbSha256', 'maskSha256', 'originReportSha256')
REQUEST_KEYS = ('source', 'originReport')
PATH = re.compile(r'[A-Za-z0-9_.@-]+(?:/[A-Za-z0-9_.@-]+)*')
HEX = re.compile(r'[0-9a-f]{64}')
# A fresh derivation must reproduce these exactly; settings holds the tilts, azimuths and surface tolerance.
SAME_REPORT = ('formatVersion', 'geometryMode', 'sharedUvPolicy', 'bodyFile', 'bodySha256')
SAME_POLICY = ('name', 'settings', 'fittingTags', 'helper', 'helperSha256', 'generatorSha256')


def fail(message):
    raise SystemExit(f'{FIELD}: {message}')


def fold(text):
    """ASCII-only case folding, as the existing identity safeguards; non-ASCII letters stay distinct."""
    return text.encode('utf-8').lower().decode('utf-8')


def _overlaps(a, b):
    a, b = fold(a), fold(b)
    return a == b or a.startswith(b + '/') or b.startswith(a + '/')


def policy_of(receipt):
    """The receipt's policy, which must be one of POLICIES; every policy-dependent rule dispatches on this."""
    policy = receipt.get('policy') if isinstance(receipt, dict) else None
    if policy not in POLICIES:
        fail(f'unsupported policy {policy!r}; only {list(POLICIES)}')
    return policy


def shape_tags(tags):
    """A nonempty list of unique strings that are each a supported fitted shape tag, or None."""
    ok = isinstance(tags, list) and tags and all(isinstance(t, str) and FITTED_TAG.fullmatch(t) for t in tags) \
        and len(set(tags)) == len(tags)
    return list(tags) if ok else None


def tag_receipt(origin_tags, applied):
    """TAG_POLICY pins: both ordered applied tag lists and the delta (each side in its own list order)."""
    return {'originFittingTags': list(origin_tags), 'appliedFittingTags': list(applied),
            'fittingTagDelta': {'removed': [t for t in origin_tags if t not in applied],
                                'added': [t for t in applied if t not in origin_tags]}}


def validate(doc, request=False):
    """The field of an otherwise valid schemaVersion 2 manifest; a request omits the pins preflight adds."""
    value = doc[FIELD]
    if not isinstance(value, dict) or set(value) != {'policy', 'components'}:
        fail("must be an object with exactly ['components', 'policy']")
    tagged = policy_of(value) == TAG_POLICY
    if doc['coverage'].get('mode') != FITTED_MODE:
        fail(f'only {FITTED_MODE} coverage is compared with an active fitted mask in this slice')
    listed, components = value['components'], {c['source']: c for c in doc['components']}
    if not isinstance(listed, list) or not listed:
        fail('components must name at least one reused component')
    keys = set(REQUEST_KEYS) | (set() if request else set(PINS) | (set(TAG_PINS) if tagged else set()))
    paths, applied = doc['paths'], [t for t in doc['fittingTags'] if isinstance(t, str) and FITTED_TAG.fullmatch(t)]
    for i, c in enumerate(listed):
        if not isinstance(c, dict) or set(c) != keys:
            fail(f'components[{i}] must have exactly {sorted(keys)}')
        if not isinstance(c['source'], str) or c['source'] not in components:
            fail(f'components[{i}].source {c["source"]!r} is not exactly a manifest component')
        report = c['originReport']
        if not isinstance(report, str) or not PATH.fullmatch(report) or any(p in ('.', '..') for p in report.split('/')) \
                or not report.startswith('public/models/') or not report.endswith('/derived-coverage.json'):
            fail(f'components[{i}].originReport must be an explicit public/models/.../derived-coverage.json path: {report!r}')
        if any(_overlaps(report, paths[k]) for k in ('docs', 'work', 'runtime', 'preview')):
            fail(f'components[{i}].originReport lies inside this family output folders')
        if not request:
            if not all(isinstance(c[k], str) and HEX.fullmatch(c[k]) for k in PINS):
                fail(f'components[{i}] pins {list(PINS)} must be lowercase sha256 hex')
            if c['glbSha256'] != components[c['source']].get('sha256'):
                fail(f'components[{i}].glbSha256 must equal the component sha256: the fresh conversion is the active GLB')
            if tagged and (shape_tags(c['originFittingTags']) is None or c['originFittingTags'] == applied
                           or {k: c[k] for k in TAG_PINS} != tag_receipt(c['originFittingTags'], applied)):
                fail(f"components[{i}] tag pins must be distinct valid shape tags, today's applied tags and their exact delta")
    named = [c['source'] for c in listed]
    if len({fold(s) for s in named}) != len(named):
        fail('components repeat a source (compared ASCII case-insensitively)')
    if named != [s for s in components if s in named]:
        fail('components must be listed in manifest component order')
    if len(named) >= len(components):
        fail('every component would be reused; at least one component must stay new in this slice')
    return value


def exact_file(path):
    """The file spelled with exactly its on-disk case: a case-insensitive filesystem alias is not its identity."""
    path, parent = Path(path), Path('.')
    for part in path.parts:
        if not parent.is_dir() or part not in os.listdir(parent):
            fail(f'{path.as_posix()} is missing or not spelled with its exact on-disk case')
        parent = parent / part
    if not path.is_file():
        fail(f'{path.as_posix()} is not a file')
    return path


def component_pin(assets, root, source):
    """(entry, glb, mask, pins) of source in an assets.json document whose URLs are relative to root."""
    meshes = assets.get('meshes') if isinstance(assets, dict) else None
    entry = meshes.get(source) if isinstance(meshes, dict) else None
    if not isinstance(entry, dict):
        fail(f'{source} has no active assets.json entry to reuse')
    variants = sorted(k for k in meshes if fold(k) == fold(source))
    if variants != [source]:
        fail(f'the active index holds case variants of {source}: {variants}; the entry is ambiguous')
    if entry.get('kind') != 'skeletal' or not isinstance(entry.get('slots'), list) or len(entry['slots']) != 1:
        fail(f'the active entry of {source} must be one skeletal mesh with exactly one slot')
    if not all(entry.get(key) for key in v1.MASK_KEYS) or entry['coverageSource'] != 'derived-projection':
        fail(f'the active entry of {source} lacks complete derived body coverage {list(v1.MASK_KEYS)}')
    glb = exact_file(v1.resolve(root, entry.get('url'), 'url'))
    mask = exact_file(v1.resolve(root, entry['bodyMaskUrl'], 'bodyMaskUrl'))
    glb_sha = v1.sha_bytes(glb)
    if entry.get('sha256') != glb_sha:
        fail(f'the active entry sha256 of {source} does not describe its GLB bytes')
    return entry, glb, mask, {'entrySha256': v1.entry_sha(entry), 'glbSha256': glb_sha, 'maskSha256': v1.sha_bytes(mask)}


def _stem(source):
    return source.rsplit('.', 1)[-1]


def _completed(record, source):
    poses = record.get('poseCounts') if isinstance(record.get('poseCounts'), list) else []
    covered = record.get('coveredPixels')
    return (record.get('file'), record.get('diagnosticFile')) == (_stem(source) + '.bodymask.png', _stem(source) + '.fitted-occlusion-diagnostic.png') \
        and [p.get('pose') for p in poses if isinstance(p, dict)] == ['a', 'idle'] \
        and all('sharedUvRemovedPixels' in p and (p.get('fittedOcclusion') or {}).get('fittingMorphs') for p in poses) \
        and type(covered) is int and covered >= 1 and (record.get('restoration') or {}).get('candidatePixels') == covered \
        and bool(HEX.fullmatch(str((record.get('previousPolicy') or {}).get('sha256'))))


def origin(component, entry, mask, pins, current, policy=POLICY):
    """The pinned originating report, checked against today's implementation inputs; returns (report, record).

    Under TAG_POLICY only, the applied-tag equality becomes: the report's own recorded tags are valid shape tags
    that differ from today's (identical tags belong to POLICY)."""
    tagged = policy_of({'policy': policy}) == TAG_POLICY
    path, source = exact_file(component['originReport']), component['source']
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != pins['originReportSha256']:
        fail(f'the originating coverage report of {source} changed since it was pinned; preserve evidence and inspect')
    report = json.loads(data.decode('utf-8'))
    policy = report.get('occlusionPolicy') if isinstance(report.get('occlusionPolicy'), dict) else {}
    tags = shape_tags(policy.get('fittingTags'))
    records = [r for r in report.get('records') or [] if isinstance(r, dict) and r.get('source') == source]
    record = records[0] if len(records) == 1 else {}
    checks = {
        'one record of the source': len(records) == 1,
        'the active mask file': isinstance(record.get('file'), str) and mask == path.parent / record['file'],
        'mesh/mask/uvTiles': (record.get('meshSha256'), record.get('sha256'), record.get('uvTiles')) ==
                             (pins['glbSha256'], pins['maskSha256'], entry.get('bodyMaskUvTiles')),
        'source geometry fitted shared-UV report': (report.get('formatVersion'), report.get('geometryMode'), report.get('sharedUvPolicy'),
                                                    policy.get('name')) == (1, 'source', 'all-surfaces-covered', 'fitted-occlusion'),
        'derivation settings': isinstance(policy.get('settings'), dict) and bool(policy['settings']),
        **({'recorded valid unique shape fitting tags': tags is not None and shape_tags(current['appliedFittingTags']) is not None,
            f'a fitting tag delta (identical tags use {POLICY})': tags != current['appliedFittingTags']} if tagged else
           {'applied fitting tags': policy.get('fittingTags') == current['appliedFittingTags']}),
        'helper': (policy.get('helper'), policy.get('helperSha256')) == (current['helper'], current['helperSha256']),
        'generator': policy.get('generatorSha256') == current['generatorSha256'],
        'body': (report.get('bodyFile'), report.get('bodySha256')) == (current['bodyFile'], current['bodySha256']),
        'completed A/idle fitted record': _completed(record, source),
    }
    wrong = [name for name, ok in checks.items() if not ok]
    if wrong:
        fail(f'the originating report of {source} does not prove its active mask under the current inputs: {wrong}')
    return report, record


def require_new(doc, cohort, assets, pairs, supported):
    """Only declared components may be active; other components, every material and every id are new (ASCII-folded)."""
    reused = {c['source'] for c in doc[FIELD]['components']}
    active = {}
    for key in assets.get('meshes') or {}:
        active.setdefault(fold(key), []).append(key)
    for source in (c['source'] for c in doc['components']):
        found = active.get(fold(source), [])
        if source in reused and found != [source]:
            fail(f'the declared component {source} is not exactly one active entry: {found}')
        if source not in reused and found:
            fail(f'the new component {source} collides with active {found}; undeclared active overlap')
    materials = sorted({m for item in cohort['items'] for m in item['materials']})
    if len({fold(m) for m in materials}) != len(materials):
        fail('cohort materials differ only by case; ambiguous')
    # Only exactly the sources an activeMaterialReuse field declares may be active (multipart_material_reuse.py).
    kept = {m.get('source') for m in (doc.get(MATERIAL_FIELD) or {}).get('materials') or [] if isinstance(m, dict)}
    found = {}
    for key in assets.get('materials') or {}:
        found.setdefault(fold(key), []).append(key)
    wrong = [m for m in materials if m in kept and found.get(fold(m)) != [m]]
    if wrong:
        fail(f'declared materials are not exactly one active binding each (ASCII case-insensitive): {wrong}')
    taken = [m for m in materials if m not in kept and fold(m) in found]
    if taken:
        fail(f'active material reuse is out of this slice unless declared in {MATERIAL_FIELD}; already active '
             f'(ASCII case-insensitive): {taken}')
    ids = {fold(i) for i in (supported.get('items') or [])} | {fold(i) for i in (pairs.get('items') or {})}
    listed = sorted(item['id'] for item in cohort['items'] if fold(item['id']) in ids)
    if listed:
        fail(f'candidates are already advertised or skin-paired: {listed}')


def early_pins(doc, hashes, current, cohort, saved=None, converted=False):
    """Before any extraction: the receipt of every reused component from the hashed index files.

    saved is the frozen-baseline.json a resumed preflight already wrote: its receipt is compared, never re-taken.
    converted says the docs/work folders already hold a conversion, which a new receipt could no longer precede."""
    value = validate(doc, request=True)
    active = Path(doc['paths']['active'])
    docs = [v1.pinned_json(active / name, hashes) for name in v1.INDEX_FILES]
    require_new(doc, cohort, *docs)
    components, policy = [], policy_of(value)
    for c in value['components']:
        entry, _, mask, pins = component_pin(docs[0], active, c['source'])
        pins['originReportSha256'] = v1.sha_bytes(exact_file(c['originReport']))
        report, _ = origin(c, entry, mask, pins, current, policy)
        if policy == TAG_POLICY:
            pins.update(tag_receipt(report['occlusionPolicy']['fittingTags'], current['appliedFittingTags']))
        components.append({'source': c['source'], 'originReport': c['originReport'], **pins})
    receipt = {'policy': policy, 'components': components}
    if saved is not None:
        old = saved.get(FIELD) if isinstance(saved, dict) else None
        if old is None:
            fail('frozen-baseline.json was saved without the early receipt; it is never taken after the fact. '
                 'Preserve the evidence and use a new docs folder')
        if old != receipt:
            fail('an active entry, GLB, mask, originating report or pinned fitting tag changed since the early receipt; a '
                 'resumed preflight is never repinned. Preserve evidence and inspect')
    elif converted:
        fail('the family already holds an extraction or conversion without an early receipt; preserve it and use new folders')
    return receipt


def require_conversion(receipt, reports, slots, entries):
    """Each reused component's fresh conversion is byte-identical to the active GLB with the entry slot/default."""
    for c in receipt['components']:
        report = reports[c['source']]
        if report.get('sha256') != c['glbSha256'] or v1.sha_bytes(report['glb']) != c['glbSha256']:
            fail(f'the fresh conversion of {c["source"]} is not byte-identical to the active GLB; nothing is reused')
        v1.require_source_slots(entries[c['source']], slots[c['source']])


def require_receipt(saved, receipt):
    """frozen-baseline.json holds exactly the manifest receipt, taken before extraction."""
    if not isinstance(saved, dict) or saved.get(FIELD) != receipt:
        fail('frozen-baseline.json does not hold exactly this manifest early receipt; preserve evidence and inspect')


def require_pinned(receipt, snapshot, root, current):
    """Replay: the frozen snapshot entry is the pinned whole entry, and today's GLB, mask and report bytes the pins."""
    entries, policy = {}, policy_of(receipt)
    for c in receipt['components']:
        entry, _, mask, pins = component_pin(snapshot, root, c['source'])
        pins['originReportSha256'] = v1.sha_bytes(exact_file(c['originReport']))
        changed = [key for key in PINS if pins[key] != c[key]]
        if changed:
            fail(f'the reused entry of {c["source"]} or its accepted files changed ({changed}); preserve evidence and inspect')
        report, _ = origin(c, entry, mask, pins, current, policy)
        if policy == TAG_POLICY:
            # Re-derived from the pinned report bytes and today's manifest tags, never taken from the receipt.
            tags = tag_receipt(report['occlusionPolicy']['fittingTags'], current['appliedFittingTags'])
            changed = [key for key in TAG_PINS if c.get(key) != tags[key]]
            if changed:
                fail(f"the pinned fitting tags of {c['source']} differ from its report and today's manifest ({changed})")
        entries[c['source']] = entry
    return entries


def index_hook(sources, receipt):
    """prepare-large-sneakers.ACTIVE_MESH_REUSE: keep exactly the pinned active entries; the rest is added as new."""
    pins = {c['source']: c for c in receipt['components']}

    def keep(added, active):
        if set(added) != set(sources):
            fail('the shared index must stage exactly the manifest components')
        for source in sources:
            old, new = active.get(source), added[source]
            if source not in pins:
                if any(fold(key) == fold(source) for key in active):
                    fail(f'the new component {source} collides with an active entry')
            elif not isinstance(old, dict) or not new.get('sha256') == old.get('sha256') == pins[source]['glbSha256'] \
                    or new.get('slots') != old.get('slots') or new.get('kind') != old.get('kind'):
                fail(f'the staged fresh {source} is not the pinned active GLB, slots and kind')
        return set(pins)
    return keep


def require_kept(receipt, old_assets, assets, old_root, new_root, shape):
    """The preview keeps each pinned snapshot entry after URL rebasing, and every unknown top-level field."""
    meshes = assets.get('meshes') or {}
    for c in receipt['components']:
        old = (old_assets.get('meshes') or {}).get(c['source'])
        if not isinstance(old, dict) or v1.entry_sha(old) != c['entrySha256']:
            fail(f'the frozen active snapshot entry of {c["source"]} is not the pinned whole entry')
        if c['source'] not in meshes or shape(meshes[c['source']], new_root) != shape(old, old_root):
            fail(f'the preview rewrote the reused entry of {c["source"]}')
    others = sorted((set(assets) | set(old_assets)) - {'meshes', 'materials', 'materialVariants'})
    if any(shape(assets.get(k), new_root) != shape(old_assets.get(k), old_root) for k in others):
        fail(f'the preview changed assets.json fields {others}')


def require_fresh(receipt, entries, fresh_report, fresh_components):
    """This family's fresh fitted derivation reproduces every reused mask; the new files stay evidence only."""
    fresh, tagged = {c['source']: c for c in fresh_components}, policy_of(receipt) == TAG_POLICY
    policy = fresh_report.get('occlusionPolicy') if isinstance(fresh_report.get('occlusionPolicy'), dict) else {}
    # TAG_POLICY: fittingTags leave the equality, replaced by the exact pinned old and intended fresh tags below.
    same_policy = tuple(k for k in SAME_POLICY if k != 'fittingTags') if tagged else SAME_POLICY
    for c in receipt['components']:
        data = exact_file(c['originReport']).read_bytes()
        if hashlib.sha256(data).hexdigest() != c['originReportSha256']:
            fail(f'the originating coverage report of {c["source"]} changed since it was pinned')
        report = json.loads(data.decode('utf-8'))
        mine = fresh.get(c['source']) or {}
        if mine.get('meshSha256') != c['glbSha256'] or mine.get('maskSha256') != c['maskSha256']:
            fail(f'the fresh derivation of {c["source"]} differs from the pinned active mask; fail closed, no preview')
        if mine.get('uvTiles') != entries[c['source']].get('bodyMaskUvTiles'):
            fail(f'the fresh UV tiles of {c["source"]} {mine.get("uvTiles")} differ from the active entry')
        differ = [k for k in SAME_REPORT if fresh_report.get(k) != report.get(k)]
        differ += ['occlusionPolicy.' + k for k in same_policy if policy.get(k) != (report.get('occlusionPolicy') or {}).get(k)]
        if tagged:
            old, new = (report.get('occlusionPolicy') or {}).get('fittingTags'), policy.get('fittingTags')
            if shape_tags(old) is None or shape_tags(new) is None or old == new \
                    or {k: c.get(k) for k in TAG_PINS} != tag_receipt(old, new):
                differ.append('occlusionPolicy.fittingTags (not the pinned origin and intended fresh tags)')
        if differ:
            fail(f'the fresh derivation of {c["source"]} used other inputs or settings than its originating report: {differ}')
