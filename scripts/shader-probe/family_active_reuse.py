"""Opt-in reuse of one already-active ordinary mesh entry for NEW material variants (see family-runner.md).

A schemaVersion 1 manifest may carry "activeMeshReuse"; without it nothing here runs and every v1 stage, receipt and
gate is unchanged (schemaVersion 2 rejects the field). A request names only the policy; preflight adds the pins: the
canonical hash of the active assets.json entry of mesh.source and the bytes of the GLB and body mask it references.
The pins are taken before any extraction and saved with frozen-baseline.json; after the conversion the current
entry, GLB and mask must still equal them. Reuse is proven, never inferred by name: the fresh conversion must be
byte-identical to the active GLB, the source slot and default material must equal the entry's, and a fresh
derivation of the family's own coverage policy must reproduce the active mask bytes and UV tiles. The active entry
is kept whole, unknown fields included. Only materials and choices that are not active yet may be added. Nothing
here writes. Standard library only.
"""
import hashlib
import json
import math
import posixpath
import re
import sys
from pathlib import Path

FIELD = 'activeMeshReuse'
POLICY = 'exact-active-entry-v1'
PINS = ('entrySha256', 'glbSha256', 'maskSha256')
# Only policies whose fresh derivation can be compared with an existing mask; none/fitted reuse is deferred.
COVERAGE_MODES = ('derived', 'conservative-shared-uv')
MASK_KEYS = ('bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource')
INDEX_FILES = ('assets.json', 'skin-pairs.json', 'supported-items.json')


def fail(message):
    raise SystemExit(f'{FIELD}: {message}')


def sha_bytes(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# Number.MAX_SAFE_INTEGER: beyond it JSON.parse may already have rounded an integer, so neither side can hash it.
MAX_SAFE = 2 ** 53 - 1
LONE_SURROGATE = re.compile('[\ud800-\udfff]')


def _number(value, at):
    """JSON.stringify of a finite double (ECMAScript Number::toString) from Python's shortest round-trip repr."""
    if not math.isfinite(value) or (value.is_integer() and abs(value) > MAX_SAFE):
        fail(f'the active entry number at {at} is non-finite or beyond +-(2**53-1); JavaScript cannot hash it identically')
    if value.is_integer():
        return str(int(value))  # 1.0 -> 1, -0.0 -> 0
    if sys.float_repr_style != 'short':
        fail('this Python has no shortest float repr; entry hashes would differ from freeze-family.mjs')
    mantissa, _, exponent = repr(abs(value)).partition('e')
    whole, _, fraction = mantissa.partition('.')
    digits = (whole + fraction).lstrip('0')
    s = digits.rstrip('0')  # value = s * 10**(n - k), s without leading or trailing zeros
    k, n = len(s), len(digits) + int(exponent or 0) - len(fraction)
    if 0 < n <= 21:
        text = s[:n] + '.' + s[n:] if k > n else s + '0' * (n - k)
    elif -6 < n <= 0:
        text = '0.' + '0' * -n + s
    else:
        text = s[0] + ('.' + s[1:] if k > 1 else '') + f'e{"+" if n > 0 else "-"}{abs(n - 1)}'
    return '-' + text if value < 0 else text


def canonical(value, at='entry'):
    """freeze-family.mjs entryCanonical: sorted keys (UTF-16 order), no spaces, JSON.stringify strings and numbers.

    For integers, strings, booleans, null, arrays and BMP keys this is exactly the earlier json.dumps(sort_keys=True)
    text, so accepted integer-only pins are unchanged; decimals now hash as JavaScript prints them (1.0 as 1, -0.0 as
    0, 1e-07 as 1e-7). Values the two parsers cannot share are refused, never rounded or dropped."""
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, str):
        if LONE_SURROGATE.search(value):
            fail(f'the active entry string at {at} holds a lone surrogate; it has no UTF-8 hash')
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        if abs(value) > MAX_SAFE:
            fail(f'the active entry integer at {at} is beyond +-(2**53-1); JavaScript cannot hash it identically')
        return str(value)
    if isinstance(value, float):
        return _number(value, at)
    if isinstance(value, list):
        return '[' + ','.join(canonical(v, f'{at}[{i}]') for i, v in enumerate(value)) + ']'
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        keys = {key: canonical(key, f'{at} key {key!r}') for key in value}
        return '{' + ','.join(f'{keys[key]}:{canonical(value[key], f"{at}.{key}")}'
                              for key in sorted(value, key=lambda key: key.encode('utf-16-be'))) + '}'
    fail(f'the active entry value at {at} is not JSON data: {type(value).__name__}')


def entry_sha(entry):
    """The whole-entry pin; freeze-family.mjs activeReusePin derives the same hash."""
    return hashlib.sha256(canonical(entry).encode('utf-8')).hexdigest()


def validate(doc, request=False):
    """The field of a validated manifest; request=True is preflight's input, which names only the policy."""
    value = doc.get(FIELD)
    expected = {'policy'} if request else {'policy', *PINS}
    if not isinstance(value, dict) or set(value) != expected:
        fail(f'must be an object with exactly {sorted(expected)}')
    if value['policy'] != POLICY:
        fail(f'unsupported policy {value["policy"]!r}; only {POLICY}')
    if not request:
        if not all(isinstance(value[k], str) and re.fullmatch(r'[0-9a-f]{64}', value[k]) for k in PINS):
            fail(f'{list(PINS)} must be lowercase sha256 hex')
        if value['glbSha256'] != doc['mesh']['sha256']:
            fail('glbSha256 must equal mesh.sha256: the fresh conversion is the active GLB')
    mode = (doc.get('coverage') or {}).get('mode')
    if mode not in COVERAGE_MODES:
        fail(f'coverage.mode {mode!r} is deferred; only {list(COVERAGE_MODES)} can be compared with the active mask')
    return value


def resolve(root, url, label):
    """The repository file of an index-relative URL; absolute, scheme, query or escaping URLs are refused."""
    if not isinstance(url, str) or not url or url != url.strip() or url.startswith('/') or any(c in url for c in ':\\?#'):
        fail(f'the active entry {label} is not an index-relative URL: {url!r}')
    path = posixpath.normpath(posixpath.join(Path(root).as_posix(), url))
    if not path.startswith('public/'):
        fail(f'the active entry {label} resolves outside public/: {path}')
    return Path(path)


def derive_pin(assets, root, source):
    """Pins of the entry of source in an assets.json document whose URLs are relative to root."""
    meshes = assets.get('meshes') if isinstance(assets, dict) else None
    entry = meshes.get(source) if isinstance(meshes, dict) else None
    if not isinstance(entry, dict):
        fail(f'{source} has no active assets.json entry to reuse')
    if entry.get('kind') != 'skeletal' or not isinstance(entry.get('slots'), list) or len(entry['slots']) != 1:
        fail('the active entry must be one skeletal mesh with exactly one slot')
    if not all(entry.get(key) for key in MASK_KEYS):
        fail(f'the active entry lacks complete body coverage {list(MASK_KEYS)}; defer it')
    glb, mask = resolve(root, entry.get('url'), 'url'), resolve(root, entry['bodyMaskUrl'], 'bodyMaskUrl')
    if not glb.is_file() or not mask.is_file():
        fail(f'the active GLB or mask is missing: {glb.as_posix()}, {mask.as_posix()}')
    glb_sha = sha_bytes(glb)
    if entry.get('sha256') != glb_sha:
        fail('the active entry sha256 does not describe its GLB bytes')
    return {'policy': POLICY, 'entrySha256': entry_sha(entry), 'glbSha256': glb_sha, 'maskSha256': sha_bytes(mask)}


def require_pin(pin, assets, root, source):
    """The pinned entry, still byte-identical with its GLB and mask; returns the entry."""
    current = derive_pin(assets, root, source)
    changed = [key for key in PINS if current[key] != pin[key]]
    if changed:
        fail(f'the active entry, GLB or mask changed since preflight ({changed}); preserve evidence and inspect')
    return assets['meshes'][source]


def require_source_slots(entry, slots):
    if entry['slots'] != slots:
        fail(f'the fresh source slot/default {slots} is not the active entry slots {entry["slots"]}')


def require_new(cohort, assets, pairs, supported):
    """New identities only: no already-active material (compared case-insensitively), no indexed candidate."""
    active = {key.casefold() for key in assets.get('materials') or {}}
    materials = sorted({m for item in cohort['items'] for m in item['materials']})
    reused = [m for m in materials if m.casefold() in active]
    if reused:
        fail(f'material reuse is out of scope; already active: {reused}')
    taken = sorted({item['id'] for item in cohort['items']} & (set(supported.get('items') or []) | set(pairs.get('items') or {})))
    if taken:
        fail(f'candidates are already advertised or skin-paired: {taken}')


def pinned_json(path, pinned_hashes):
    """The index document parsed from exactly the bytes frozen-baseline.json hashes."""
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != pinned_hashes.get(Path(path).as_posix()):
        fail(f'{Path(path).as_posix()} changed since frozen-baseline.json was pinned before extraction')
    return json.loads(data.decode('utf-8'))


def early_pin(request, pinned_hashes, saved=None, converted=False):
    """Before any extraction: the pins of the active entry in the hashed assets.json, saved with frozen-baseline.json.

    saved is the frozen-baseline.json a resumed preflight already wrote; its pin is compared, never re-taken.
    converted says the docs folder already holds a conversion, which a new early pin could no longer precede."""
    validate(request, request=True)
    active, source = Path(request['paths']['active']), request['mesh']['source']
    pin = {**derive_pin(pinned_json(active / 'assets.json', pinned_hashes), active, source), 'source': source}
    if saved is not None:
        if not isinstance(saved, dict) or FIELD not in saved:
            fail('frozen-baseline.json was saved without the early pin; it is never taken after the fact. '
                 'Preserve the evidence and use a new docs folder')
        old = saved[FIELD] if isinstance(saved[FIELD], dict) else {}
        changed = sorted(key for key in set(pin) | set(old) if pin.get(key) != old.get(key))
        if changed:
            fail(f'the active entry, GLB or mask changed since the early pin ({changed}); a resumed preflight is never '
                 'repinned. Preserve evidence and inspect')
    elif converted:
        fail('the docs folder already holds a conversion without an early pin; preserve it and use a new docs folder')
    return pin


def preflight_pin(request, report, slots, cohort, baseline):
    """After the fresh conversion: the early pin of frozen-baseline.json, still the current entry, GLB and mask bytes,
    and byte-identical to the conversion. Returns the manifest pins."""
    validate(request, request=True)
    active, source = Path(request['paths']['active']), request['mesh']['source']
    early = baseline.get(FIELD) if isinstance(baseline, dict) else None
    if not isinstance(early, dict) or early.get('policy') != POLICY or early.get('source') != source:
        fail(f'frozen-baseline.json holds no early pin of {source} taken before extraction; a new preflight never '
             'pins after extraction')
    docs = [pinned_json(active / name, baseline.get('hashes') or {}) for name in INDEX_FILES]
    current = derive_pin(docs[0], active, source)
    changed = [key for key in PINS if current[key] != early.get(key)]
    if changed:
        fail(f'the active entry, GLB or mask changed during extraction ({changed}) although the index files did not; '
             'preserve evidence and inspect')
    if report.get('sha256') != early['glbSha256'] or sha_bytes(report['glb']) != early['glbSha256']:
        fail('the fresh conversion is not byte-identical to the active GLB; nothing is reused')
    require_source_slots(docs[0]['meshes'][source], slots)
    require_new(cohort, *docs)
    return {'policy': POLICY, **{key: early[key] for key in PINS}}


def index_hook(source, pin):
    """prepare-large-sneakers.ACTIVE_MESH_REUSE for one manifest: keep exactly the pinned active entry, add no mesh."""
    def keep(added, active):
        if set(added) != {source} or source not in active:
            fail(f'the shared index must stage exactly {source}, already active')
        old, new = active[source], added[source]
        if not new.get('sha256') == old.get('sha256') == pin['glbSha256'] or new.get('slots') != old.get('slots') \
                or new.get('kind') != old.get('kind'):
            fail('the staged fresh mesh is not the pinned active GLB, slots and kind')
        return {source}
    return keep


def require_preserved(old, new, old_root, new_root, implemented, materials, shape):
    """Every pre-existing entry equals the snapshot after URL rebasing; only these materials and ids are added."""
    (old_assets, old_pairs, old_supported), (assets, pairs, supported) = old, new
    if set(assets.get('meshes') or {}) != set(old_assets.get('meshes') or {}):
        fail('the preview added or removed a mesh; reuse adds none')
    old_materials, new_materials = old_assets.get('materials') or {}, assets.get('materials') or {}
    if set(new_materials) != set(old_materials) | materials or set(old_materials) & materials:
        fail('the preview does not add exactly the new implemented materials')
    for key in sorted(set(old_assets) | set(assets)):
        value = {k: v for k, v in new_materials.items() if k in old_materials} if key == 'materials' else assets.get(key)
        if shape(value, new_root) != shape(old_assets.get(key), old_root):
            fail(f'the preview changed pre-existing assets.json {key}')
    if shape(pairs, new_root) != shape(old_pairs, old_root):
        fail('the preview changed skin pairs')
    old_ready = {r['id']: r for r in old_supported.get('ready') or []}
    new_ready = {r['id']: r for r in supported.get('ready') or []}
    if supported.get('items') != (old_supported.get('items') or []) + list(implemented) \
            or set(new_ready) != set(old_ready) | set(implemented) \
            or any(shape(new_ready[i], new_root) != shape(r, old_root) for i, r in old_ready.items()) \
            or supported.get('exceptions') != [r for r in old_supported.get('exceptions') or [] if r['id'] not in implemented]:
        fail('the preview changed advertised items, readiness or exclusions outside this cohort')
    others = sorted((set(supported) | set(old_supported)) - {'items', 'ready', 'exceptions'})
    if any(shape(supported.get(k), new_root) != shape(old_supported.get(k), old_root) for k in others):
        fail(f'the preview changed supported-items metadata {others}')


def coverage_evidence(target, preview_dir, source, pin, entry, body_file, body_sha, file_sha):
    """The fresh unfitted derivation of the family policy, which must reproduce the pinned active mask."""
    target = Path(target)
    path = target / 'derived-coverage.json'
    if not path.is_file():
        fail('the fresh coverage report is missing; preserve the coverage folder and inspect')
    report = json.loads(path.read_text(encoding='utf-8'))
    records = report.get('records') if isinstance(report.get('records'), list) else []
    record = records[0] if len(records) == 1 and isinstance(records[0], dict) else {}
    if record.get('source') != source or record.get('meshSha256') != pin['glbSha256']:
        fail('the fresh report must hold exactly one record for the pinned active GLB')
    if report.get('formatVersion') != 1 or report.get('geometryMode') != 'source' or 'occlusionPolicy' in report \
            or report.get('indexFolder') != Path(preview_dir).as_posix():
        fail('the fresh report is not an unfitted source derivation from this family preview')
    if not body_sha or report.get('bodyFile') != body_file or report.get('bodySha256') != body_sha:
        fail(f'the fresh report body is not the current {body_file}')
    entries = list(target.iterdir())
    files = {p.name: file_sha(p) for p in entries if p.is_file()}
    if len(files) != len(entries) or record.get('file') not in files or files[record['file']] != record.get('sha256'):
        fail('the fresh coverage folder or mask differs from its report')
    if files[record['file']] != pin['maskSha256']:
        fail('the fresh derivation differs from the pinned active mask; fail closed and keep this family out')
    if record.get('uvTiles') != entry.get('bodyMaskUvTiles'):
        fail(f'the fresh UV tiles {record.get("uvTiles")} differ from the active {entry.get("bodyMaskUvTiles")}')
    return {'report': path.as_posix(), 'files': files, 'mask': record['file'], 'uvTiles': record['uvTiles'],
            'meshSha256': record['meshSha256'], 'bodyFile': body_file, 'bodySha256': body_sha,
            'activeMaskSha256': pin['maskSha256'], 'entrySha256': pin['entrySha256']}
