"""Opt-in reuse of already-active MATERIAL bindings ("activeMaterialReuse"; see multipart-family.md).

Only a schemaVersion 2 manifest that already carries activeComponentReuse (a proper subset of reused components) may
carry the field; without it nothing here runs and every gate is unchanged. A request names the policy and the reused
material sources. Before any extraction, preflight pins per material the canonical hash of the WHOLE active binding
(today only the documented URL string is accepted), the bytes and the canonical JSON of the material manifest it
points to (unknown fields, samplers, mips, colour space and texture provenance included) and the bytes of the GLSL and
of EVERY referenced texture file; the receipt is saved once in frozen-baseline.json and a resumed preflight compares,
never repins. The manifest texture "sha256" describes decoded texels, not the compressed file, so only real file bytes
are compared here. Reuse is identity-preserving index reuse, not a cache: every material is still extracted, built,
CPU/GPU checked and geometry checked; after the build the FRESH staged bundle must have the pinned canonical manifest and
byte-identical shader and texture files, and only then does the shared index keep the exact active binding instead of
refusing it. Nothing here writes. Standard library only.
"""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

_spec = importlib.util.spec_from_file_location('multipart_active_reuse_for_materials', Path(__file__).resolve().parent / 'multipart_active_reuse.py')
mar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mar)
v1, fold = mar.v1, mar.fold

FIELD = mar.MATERIAL_FIELD
POLICY = 'exact-active-material-v1'
PINS = ('entrySha256', 'manifestSha256', 'canonicalSha256', 'files')
MATERIAL = re.compile(r'/Game/(?:[A-Za-z0-9_-]+/)+([A-Za-z0-9_-]+)\.\1')
# A bundle file is one plain name beside its manifest: no folders, so nothing can escape or alias another folder.
NAME = re.compile(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+')
# The one documented bundle format; anything else is an unknown format, never guessed.
FORMAT, SHADER, TEXTURE = 1, '.glsl', '.rgba.gz.bin'
PROOF = 'material-reuse-proof.json'


def fail(message):
    raise SystemExit(f'{FIELD}: {message}')


def validate(doc, request=False):
    """The field of an otherwise valid schemaVersion 2 manifest; a request omits the pins preflight adds."""
    if mar.FIELD not in doc:
        fail(f'only an {mar.FIELD} family (a proper subset of reused components) may reuse active materials')
    value = doc[FIELD]
    if not isinstance(value, dict) or set(value) != {'policy', 'materials'}:
        fail("must be an object with exactly ['materials', 'policy']")
    if value['policy'] != POLICY:
        fail(f'unsupported policy {value["policy"]!r}; only {POLICY}')
    listed = value['materials']
    if not isinstance(listed, list) or not listed:
        fail('materials must name at least one reused material')
    keys = {'source'} | (set() if request else set(PINS))
    for i, m in enumerate(listed):
        if not isinstance(m, dict) or set(m) != keys:
            fail(f'materials[{i}] must have exactly {sorted(keys)}')
        if not isinstance(m['source'], str) or not MATERIAL.fullmatch(m['source']):
            fail(f'materials[{i}].source is not a material object path: {m["source"]!r}')
        if request:
            continue
        if not all(isinstance(m[k], str) and mar.HEX.fullmatch(m[k]) for k in PINS[:3]):
            fail(f'materials[{i}] pins {list(PINS[:3])} must be lowercase sha256 hex')
        files = m['files']
        if not isinstance(files, dict) or not files or not all(isinstance(k, str) and NAME.fullmatch(k) and isinstance(h, str)
                                                                and mar.HEX.fullmatch(h) for k, h in files.items()):
            fail(f'materials[{i}].files must map plain bundle file names to sha256 hex')
    named = [m['source'] for m in listed]
    if len({fold(s) for s in named}) != len(named) or named != sorted(named):
        fail('materials must be unique (ASCII case-insensitively) and sorted')
    return value


def require_cohort(value, cohort):
    """Declared materials are cohort materials, and at least one cohort material stays new."""
    materials, named = set(cohort['materials']), {m['source'] for m in value['materials']}
    if not named <= materials:
        fail(f'declared materials are not cohort materials: {sorted(named - materials)}')
    if not materials - named:
        fail('every material would be reused; at least one material must stay new in this slice')


def bundle(path):
    """(manifest, pins) of one material bundle: its manifest and every file it references, by real bytes."""
    path = mar.exact_file(path)
    data = path.read_bytes()
    try:
        manifest = json.loads(data.decode('utf-8'))
    except ValueError:
        fail(f'{path.as_posix()} is not a JSON material manifest')
    textures = manifest.get('textures') if isinstance(manifest, dict) else None
    if not path.name.endswith('.json') or type(manifest.get('formatVersion')) is not int or manifest['formatVersion'] != FORMAT \
            or not isinstance(textures, list) or not all(isinstance(t, dict) for t in textures):
        fail(f'{path.as_posix()} is not a formatVersion {FORMAT} material manifest; unknown formats are never reused')
    refs = [manifest.get('shader')] + [t.get('file') for t in textures]
    if not all(isinstance(n, str) and NAME.fullmatch(n) for n in refs) or not refs[0].endswith(SHADER) \
            or not all(n.endswith(TEXTURE) for n in refs[1:]):
        fail(f'{path.as_posix()} references a file outside its bundle folder or of an unknown format: {refs}')
    names = sorted({path.name, *refs})
    if len({fold(n) for n in names}) != len(names):
        fail(f'{path.as_posix()} references files that differ only by case; ambiguous')
    files = {n: v1.sha_bytes(mar.exact_file(path.parent / n)) for n in names}
    return manifest, {'manifestSha256': hashlib.sha256(data).hexdigest(), 'canonicalSha256': v1.entry_sha(manifest), 'files': files}


def material_pin(assets, root, source):
    """The pins of source in an assets.json document whose URLs are relative to root."""
    materials = assets.get('materials') if isinstance(assets, dict) else None
    entry = materials.get(source) if isinstance(materials, dict) else None
    if not isinstance(entry, str):
        fail(f'{source} has no active URL-string binding; only the documented URL-string binding is reusable')
    variants = sorted(k for k in materials if fold(k) == fold(source))
    if variants != [source]:
        fail(f'the active index holds case variants of {source}: {variants}; the binding is ambiguous')
    _, pins = bundle(v1.resolve(root, entry, 'material url'))
    return {'source': source, 'entrySha256': v1.entry_sha(entry), **pins}


def _receipt(value, assets, root):
    return {'policy': POLICY, 'materials': [material_pin(assets, root, m['source']) for m in value['materials']]}


def early_pins(doc, hashes, cohort, saved=None, converted=False):
    """Before any extraction: the receipt from the hash-pinned active assets.json; resumes compare, never repin."""
    value = validate(doc, request=True)
    require_cohort(value, cohort)
    active = Path(doc['paths']['active'])
    receipt = _receipt(value, v1.pinned_json(active / 'assets.json', hashes), active)
    if saved is not None:
        old = saved.get(FIELD) if isinstance(saved, dict) else None
        if old is None:
            fail('frozen-baseline.json was saved without the early material receipt; it is never taken after the fact. '
                 'Preserve the evidence and use a new docs folder')
        if old != receipt:
            fail('an active material binding, manifest, shader or texture changed since the early receipt; a resumed '
                 'preflight is never repinned. Preserve evidence and inspect')
    elif converted:
        fail('the family already holds an extraction or conversion without an early material receipt; use new folders')
    return receipt


def require_receipt(saved, receipt):
    if not isinstance(saved, dict) or saved.get(FIELD) != receipt:
        fail('frozen-baseline.json does not hold exactly this manifest early material receipt; preserve evidence and inspect')


def require_pinned(receipt, snapshot, root):
    """Replay: the frozen snapshot bindings and today's bundle bytes are still exactly the receipt."""
    for m in receipt['materials']:
        if material_pin(snapshot, root, m['source']) != m:
            fail(f'the reused binding of {m["source"]} or its accepted bundle files changed; preserve evidence and inspect')


def _differences(pin, got):
    """What of a fresh bundle differs from the pinned one; the manifest file name itself may differ."""
    names = lambda files: {k: v for k, v in files.items() if k.endswith((SHADER, TEXTURE))}
    wrong = ['canonical manifest'] if got['canonicalSha256'] != pin['canonicalSha256'] else []
    old, new = names(pin['files']), names(got['files'])
    return wrong + sorted(k for k in set(old) | set(new) if old.get(k) != new.get(k))


def fresh_proof(receipt, staging, resolution, job_id):
    """The compiled identity of every declared material's FRESH staged bundle, compared with its pins (no writes)."""
    materials = []
    for m in receipt['materials']:
        rows = [r for r in resolution if r.get('source') == m['source'] and not r.get('error')]
        if len(rows) != 1:
            fail(f'{m["source"]} was not freshly resolved exactly once from source')
        job = job_id(rows[0]['instance'])
        path = Path(staging) / (job + '.json')
        if not path.is_file():
            materials.append({'source': m['source'], 'job': job, 'manifest': path.as_posix(), 'differs': ['not built']})
            continue
        _, got = bundle(path)
        materials.append({'source': m['source'], 'job': job, 'manifest': path.as_posix(), **got, 'differs': _differences(m, got)})
    return {'policy': POLICY, 'materials': materials}


def require_identical(proof):
    wrong = {m['source']: m['differs'] for m in proof['materials'] if m['differs']}
    if wrong:
        fail(f'the fresh compiled bundles differ from the pinned active ones {wrong}; nothing is reused, fresh outputs are kept')


def index_hook(receipt, preview):
    """prepare-large-sneakers.ACTIVE_MATERIAL_REUSE: keep exactly the pinned bindings whose fresh bundles are identical."""
    pins, preview = {m['source']: m for m in receipt['materials']}, Path(preview)

    def keep(added, active, root):
        if Path(root) != preview:
            fail(f'the material reuse hook of {preview.as_posix()} was called for {Path(root).as_posix()}; a leaked hook')
        missing = sorted(set(pins) - set(added))
        if missing:
            fail(f'declared materials were not freshly validated for an implemented choice: {missing}; nothing is reused')
        for key in sorted(added):
            found = [k for k in active if fold(k) == fold(key)]
            if key not in pins:
                if found:
                    fail(f'the new material {key} collides with active {found}; undeclared active overlap')
                continue
            if found != [key] or not isinstance(active[key], str) or not isinstance(added[key], str):
                fail(f'the declared material {key} is not exactly one URL-string active binding: {found}')
            _, old = bundle(v1.resolve(preview, active[key], 'active material url'))
            if {k: old[k] for k in PINS[1:]} != {k: pins[key][k] for k in PINS[1:]}:
                fail(f'the active bundle of {key} changed since it was pinned')
            _, new = bundle(v1.resolve(preview, added[key], 'fresh material url'))
            if _differences(pins[key], new):
                fail(f'the staged fresh bundle of {key} differs from the pinned active one: {_differences(pins[key], new)}')
        return set(pins)
    return keep
