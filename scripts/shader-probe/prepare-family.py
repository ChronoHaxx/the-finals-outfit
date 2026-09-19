"""Stage one ordinary single-mesh reconstruction family from a JSON manifest (see family-runner.md).

The Large Sneakers stages (planner, effective slots, fresh material/parent/texture extraction, compile,
independent CPU/GPU checks, surface audit, additive preview) run unchanged behind one configuration boundary:
a private module instance per manifest, every path and hook bound once and rechecked before each stage. This
file holds the guards once, configured by the manifest: pinned mesh conversion, original UV sets, skinning and
morphs, the frozen cohort with its exact fitting tags, source build pairing, fresh GPU evidence, the frozen
active baseline by id, and the manifest hash in every evidence file. The active index and catalog are only
read. Run from the repository root:

  python scripts/shader-probe/prepare-family.py --manifest M mesh      # validate the pinned preflight conversion
  node --import tsx scripts/shader-probe/freeze-family.mjs --manifest M  # definitions/tags/baseline, once
  python scripts/shader-probe/prepare-family.py --manifest M source    # exact materials, parents, textures
  python scripts/shader-probe/prepare-family.py --manifest M build     # compile, CPU check, surface/UV audit
  python scripts/shader-probe/prepare-family.py --manifest M gpu       # fresh uniquely archived check-webgl run
  python scripts/shader-probe/prepare-family.py --manifest M index     # runtime staging, additive preview
  python scripts/shader-probe/prepare-family.py --manifest M coverage  # manifest coverage policy, then index
  python scripts/shader-probe/prepare-family.py --manifest M verify    # read-only replay of saved evidence

Coverage mode fitted-conservative-shared-uv runs the existing fitted-occlusion generator with the manifest's shape
tags, pins its completed report and PNG hashes in progress.json before indexing, and replays them afterwards.
"""
import argparse
import hashlib
import importlib.util
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
# Ordinary families are resolved on the viewer's Medium rig, as loadSourceOutfit does.
CONTEXT = 'Customization.Archetype.Medium'
INDEX_FILES = ('assets.json', 'skin-pairs.json', 'supported-items.json')
STAGES = ('mesh', 'source', 'build', 'gpu', 'index', 'coverage', 'verify')
FITTED_MODE = 'fitted-conservative-shared-uv'
COVERAGE_MODES = ('derived', 'conservative-shared-uv', 'none', FITTED_MODE)
MASK_KEYS = ('bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource')
# The existing generator and the helper it loads as a sibling, run from the repository root.
GENERATOR = Path('scripts/shader-probe/build-companion-masks.mjs')
HELPER = GENERATOR.with_name('coverage-projection.mjs')
# The only tag groups build-companion-masks.mjs --fitted-occlusion accepts; matched as the full string.
FITTED_TAG = r'Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch)\.[A-Za-z0-9_]+'
# The Medium body the generator projects onto with --all (a file under public/).
FITTED_BODY = 'models/reconstructed-meshes-v2/SK_Body_M.glb'
# Required and optional fields of each manifest object; anything else is rejected, never ignored.
FIELDS = {'manifest': ({'id', 'schemaVersion', 'paths', 'mesh', 'fittingTags', 'coverage'}, {'marker', 'activeMeshReuse'}),
          'paths': ({'docs', 'work', 'runtime', 'preview', 'active', 'sourceIndex', 'catalog', 'resolver', 'refresh',
                     'appUrl'}, set()),
          'mesh': ({'source', 'slot', 'itemSlot', 'sha256', 'facts', 'morphNames'}, set()),
          'mesh.facts': ({'vertices', 'triangles', 'uvSets', 'bones', 'materialSections'}, set())}
# Outputs stay inside the existing pipeline's roots; inputs are only read and must not overlap any output.
OUTPUT_ROOTS = {'docs': '_docs/', 'work': 'scripts/generated/shader-probe/', 'runtime': 'public/models/',
                'preview': 'public/models/'}
INPUTS = ('active', 'sourceIndex', 'catalog', 'resolver', 'refresh')
SEGMENT = r'[A-Za-z0-9_.@-]+'
# The opt-in activeMeshReuse contract (standard library only); absent from a manifest, none of it runs.
_reuse_spec = importlib.util.spec_from_file_location('family_active_reuse', HERE / 'family_active_reuse.py')
reuse = importlib.util.module_from_spec(_reuse_spec)
_reuse_spec.loader.exec_module(reuse)


def fail(message):
    raise SystemExit(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def manifest_sha(raw):
    return hashlib.sha256(canonical(raw).encode('utf-8')).hexdigest()


def read_manifest(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        fail(f'Cannot read manifest {path}: {error}')


def _fields(value, key):
    required, optional = FIELDS[key]
    if not isinstance(value, dict):
        fail(f'manifest {key} must be an object')
    missing, unknown = required - set(value), set(value) - required - optional
    if missing or unknown:
        fail(f'manifest {key}: missing {sorted(missing)}, unsupported {sorted(unknown)}')


def _text(value, label, pattern=None):
    if not isinstance(value, str) or not value or value != value.strip() or \
            (pattern is not None and not re.fullmatch(pattern, value)):
        fail(f'manifest {label} is not valid: {value!r}')
    return value


def _unique_texts(value, label):
    if not isinstance(value, list) or not all(isinstance(v, str) and v and v == v.strip() for v in value) \
            or len(set(value)) != len(value):
        fail(f'manifest {label} must be a list of unique nonempty strings')


def fitted_tags(tags):
    """The manifest's source tags the fitted generator can apply, in manifest order; never guessed or widened."""
    applied = [tag for tag in tags if re.fullmatch(FITTED_TAG, tag)]
    if not applied:
        fail(f'coverage.mode {FITTED_MODE} needs a Customization.Shape.(PushInsideClothes|ShrinkWrap|HeadNeckMatch) '
             f'fitting tag; the manifest has {tags}')
    return applied


def _overlaps(a, b):
    return a == b or a.startswith(b + '/') or b.startswith(a + '/')


def _app_url(value):
    _text(value, 'paths.appUrl')
    try:
        parts = urlsplit(value)
        port, host = parts.port, parts.hostname
        loopback = host == 'localhost' or (host is not None and ipaddress.ip_address(host).is_loopback)
    except ValueError:
        loopback = False
    if not loopback or parts.scheme != 'http' or parts.username is not None or parts.password is not None \
            or parts.query or parts.fragment or '#' in value or '?' in value or port == 0:
        fail(f'manifest paths.appUrl must be a plain HTTP loopback URL: {value!r}')


def validate_manifest(doc):
    """Exact schemaVersion 1 fields and types; returns the document unchanged."""
    _fields(doc, 'manifest')
    _text(doc['id'], 'id', r'[a-z0-9]+(?:-[a-z0-9]+)*')
    if type(doc['schemaVersion']) is not int or doc['schemaVersion'] != 1:
        fail('manifest schemaVersion must be 1')
    if 'marker' in doc and any(part in ('.', '..') for part in _text(doc['marker'], 'marker', rf'{SEGMENT}(?:/{SEGMENT})*').split('/')):
        fail('manifest marker must not contain . or .. segments')
    paths = doc['paths']
    _fields(paths, 'paths')
    for key in sorted(set(FIELDS['paths'][0]) - {'appUrl'}):
        value = _text(paths[key], f'paths.{key}', rf'{SEGMENT}(?:/{SEGMENT})*')
        if any(part in ('.', '..') for part in value.split('/')):
            fail(f'manifest paths.{key} must be an explicit repository-relative path: {value!r}')
    _app_url(paths['appUrl'])
    for key, root in OUTPUT_ROOTS.items():
        if not paths[key].startswith(root):
            fail(f'manifest paths.{key} must be an isolated folder under {root}')
    if not paths['active'].startswith('public/models/'):
        fail('manifest paths.active must be an index folder under public/models/')
    if not paths['catalog'].endswith('.json') or paths['resolver'].split('/')[-1] != 'SourceAssembly.ts':
        fail('manifest paths.catalog must be a JSON catalog and paths.resolver the product SourceAssembly.ts')
    outputs = list(OUTPUT_ROOTS)
    for i, key in enumerate(outputs):
        for other in outputs[i + 1:] + list(INPUTS):
            if _overlaps(paths[key], paths[other]):
                fail(f'manifest paths.{key} overlaps paths.{other}; outputs must be separate folders')
    mesh = doc['mesh']
    _fields(mesh, 'mesh')
    _text(mesh['source'], 'mesh.source', r'/Game/(?:[A-Za-z0-9_-]+/)+([A-Za-z0-9_-]+)\.\1')
    _text(mesh['slot'], 'mesh.slot')
    _text(mesh['itemSlot'], 'mesh.itemSlot', r'[A-Za-z][A-Za-z0-9]*')
    _text(mesh['sha256'], 'mesh.sha256', r'[0-9a-f]{64}')
    facts = mesh['facts']
    _fields(facts, 'mesh.facts')
    for key, value in facts.items():
        if type(value) is not int or value < 1:
            fail(f'manifest mesh.facts.{key} must be a positive integer')
    if facts['materialSections'] != 1:
        fail('manifest mesh.facts.materialSections must be 1: one material per mesh')
    _unique_texts(mesh['morphNames'], 'mesh.morphNames')
    _unique_texts(doc['fittingTags'], 'fittingTags')
    coverage = doc['coverage']
    if not isinstance(coverage, dict) or coverage.get('mode') not in COVERAGE_MODES:
        fail(f'manifest coverage.mode must be one of {list(COVERAGE_MODES)}')
    expected = {'mode', 'reason'} if coverage['mode'] == 'none' else {'mode'}
    if set(coverage) != expected:
        fail(f'manifest coverage for mode {coverage["mode"]} takes exactly {sorted(expected)}')
    if coverage['mode'] == 'none':
        _text(coverage['reason'], 'coverage.reason')
    if coverage['mode'] == FITTED_MODE:
        fitted_tags(doc['fittingTags'])
    if reuse.FIELD in doc:
        reuse.validate(doc)
    return doc


def load_legacy(tag):
    """A private instance of the Large Sneakers stages and their accessory-default helpers for one manifest."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    name = 'prepare_large_sneakers__' + re.sub(r'\W', '_', tag)
    spec = importlib.util.spec_from_file_location(name, HERE / 'prepare-large-sneakers.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tree_state(roots):
    state = {}
    for root in roots:
        root = Path(root)
        if root.is_file():
            state[root.as_posix()] = (root.stat().st_size, root.stat().st_mtime_ns)
        for folder, _, files in os.walk(root):
            for name in files:
                path = Path(folder) / name
                state[path.as_posix()] = (path.stat().st_size, path.stat().st_mtime_ns)
    return state


class Family:
    REUSE = None  # the opt-in activeMeshReuse pins; subclasses that never set it keep the default duplicate refusal

    def __init__(self, manifest_path, legacy=load_legacy):
        self.manifest_path = Path(manifest_path)
        raw = read_manifest(self.manifest_path)
        self.m, self.sha = validate_manifest(raw), manifest_sha(raw)
        paths, mesh = self.m['paths'], self.m['mesh']
        self.DOCS, self.WORK, self.RUNTIME, self.PREVIEW = (Path(paths[k]) for k in ('docs', 'work', 'runtime', 'preview'))
        self.ACTIVE, self.SOURCE_INDEX, self.CATALOG = (Path(paths[k]) for k in ('active', 'sourceIndex', 'catalog'))
        self.RESOLVER = Path(paths['resolver'])
        self.MESH_REPORT = self.DOCS / 'mesh-report.json'
        self.MARKER = self.m.get('marker') or f'shader-probe/prepare-family/{self.m["id"]}'
        self.SOURCE_MESH, self.MATERIAL_SLOT, self.ITEM_SLOT = mesh['source'], mesh['slot'], mesh['itemSlot']
        self.GLB_SHA256, self.MESH_FACTS, self.MORPH_NAMES = mesh['sha256'], mesh['facts'], mesh['morphNames']
        self.FITTING_TAGS, self.COVERAGE, self.APP_URL = self.m['fittingTags'], self.m['coverage'], paths['appUrl']
        self.read_only = False
        s = self.s = legacy(self.m['id'])
        d = self.d = s.d
        self._surface_blocked = s.audit_blocked
        self._hooks = {'progress': self.progress, 'audit_blocked': self.geometry_blocked}
        self.REUSE = self.m.get(reuse.FIELD)
        if self.REUSE:
            # Opt-in only: the shared index stage keeps exactly this pinned active entry instead of refusing it.
            self._hooks['ACTIVE_MESH_REUSE'] = reuse.index_hook(self.SOURCE_MESH, self.REUSE)
        self._d_globals = {'BATCH': self.DOCS / 'batch.json', 'WORK': self.WORK, 'SOURCE': self.WORK / 'source',
                           'RUNTIME': self.RUNTIME, 'PREVIEW': self.PREVIEW, 'MARKER': self.MARKER, 'REUSE_EXPORTS': [],
                           'REUSE_TEXTURES': [], 'MESH_EVIDENCE': [], 'ACTIVE': self.ACTIVE, 'CATALOG': self.CATALOG,
                           'SOURCE_INDEX': self.SOURCE_INDEX, 'RESOLVER': self.RESOLVER}
        self._s_globals = {'DOCS': self.DOCS, 'WORK': self.WORK, 'RUNTIME': self.RUNTIME, 'PREVIEW': self.PREVIEW,
                           'MESH_REPORT': self.MESH_REPORT}
        # Bound once; no earlier extraction or mesh evidence is trusted, source/parents/textures are fresh.
        d.configure(self.DOCS / 'batch.json', self.WORK, self.RUNTIME, self.PREVIEW)
        for name, value in self._d_globals.items():
            setattr(d, name, list(value) if isinstance(value, list) else value)
        for name, value in {**self._s_globals, **self._hooks}.items():
            setattr(s, name, value)
        d.extract, d.plan = s.extract, s.plan

    # ------------------------------------------------------------------------------------ configuration
    def _require_configuration(self):
        """Refuse to run on a changed manifest or with any shared global or hook pointing at another family."""
        if not self.manifest_path.is_file() or manifest_sha(read_manifest(self.manifest_path)) != self.sha:
            fail('The manifest changed since this run was configured; preserve evidence and inspect the drift')
        d, s = self.d, self.s
        stale = [name for name, value in self._d_globals.items() if getattr(d, name, None) != value]
        stale += ['s.' + name for name, value in self._s_globals.items() if getattr(s, name, None) != value]
        if any(getattr(s, name, None) is not hook for name, hook in self._hooks.items()) \
                or d.extract is not s.extract or d.plan is not s.plan \
                or (not self.REUSE and getattr(s, 'ACTIVE_MESH_REUSE', None) is not None):
            stale.append('stage hooks')
        if stale:
            fail(f'Shared stage globals are not configured for this manifest: {stale}')

    def _require_manifest_hash(self, value, label):
        if value != self.sha:
            fail(f'{label} was recorded for a different manifest; preserve it and inspect the configuration drift')

    def progress(self, milestone, **fields):
        """Family-local milestone log carrying the manifest hash; verify never writes it."""
        if self.read_only:
            fail('verify is a read-only replay; refusing to write progress')
        path = self.WORK / 'progress.json'
        doc = self.d.read_json(path) if path.is_file() else {}
        if doc:
            self._require_manifest_hash(doc.get('manifestSha256'), 'progress.json')
        record = {'at': self.d.now(), 'milestone': milestone, 'manifestSha256': self.sha, **fields}
        self.d.write(path, {**doc, **record, 'marker': self.MARKER, 'history': doc.get('history', []) + [record]})

    # ------------------------------------------------------------------------------------------- mesh
    def _is_source_mesh(self, value):
        if not isinstance(value, str) or not value:
            return False
        return value == self.SOURCE_MESH or self.d.assembly_index.object_path(value) == self.SOURCE_MESH

    def _is_fitting_tags(self, tags):
        """Exactly the manifest tags in any order; an absent list is the empty set, duplicates and extras are drift."""
        return isinstance(tags, list) and all(isinstance(t, str) for t in tags) and sorted(tags) == sorted(self.FITTING_TAGS)

    def _require_cohort(self):
        cohort = self.d.read_json(self.DOCS / 'cohort.json')
        items = cohort.get('items') if isinstance(cohort.get('items'), list) else []
        ids = [item.get('id') for item in items]
        if cohort.get('meshes') != [self.SOURCE_MESH] or cohort.get('attached'):
            fail('The cohort must name exactly the one unattached manifest skeletal mesh')
        if not items or cohort.get('count') != len(items) or not all(isinstance(i, str) and i for i in ids) \
                or len(set(ids)) != len(ids):
            fail('The cohort must name a nonempty counted set of unique choices')
        if any(item.get('slot') != self.ITEM_SLOT or not isinstance(item.get('materials'), list)
               or len(item['materials']) != 1 for item in items):
            fail(f'Every choice must be in the {self.ITEM_SLOT} slot with one {self.MATERIAL_SLOT} material')
        if sorted({m for item in items for m in item['materials']}) != sorted(cohort.get('materials') or []):
            fail('The cohort material list differs from its choices')
        return cohort

    def _require_mesh_request(self):
        d = self.d
        folder = d.SOURCE / 'meshes-01'
        if not folder.is_dir() or not any(folder.iterdir()):
            return False
        manifest, run = d.SOURCE / 'meshes-01.requests.json', d.SOURCE / 'meshes-01.run.json'
        if not manifest.is_file() or d.read_json(manifest) != [d.package_of(self.SOURCE_MESH)]:
            fail('meshes-01 was not extracted for exactly the manifest mesh request; use a new folder')
        if not run.is_file() or d.read_json(run).get('exitCode') != 0:
            fail('meshes-01 has no successful extraction run record')
        return True

    def _dto_morph_names(self, dto):
        lods = dto.get('lods') or []
        if not lods or not isinstance(lods[0], dict):
            fail('The exported DTO has no LOD0')
        names = [m.get('name') if isinstance(m, dict) else None for m in lods[0].get('morphs') or []]
        if not all(isinstance(n, str) and n for n in names) or len(set(names)) != len(names):
            fail(f'The exported DTO morph names are missing or not unique: {names}')
        if names != self.MORPH_NAMES:
            fail(f'The exported DTO morphs {names} are not the original {self.MORPH_NAMES}')
        return names

    def _require_glb_geometry(self, report, dto):
        """Facts, original UV sets, skinning and named inactive morphs survive conversion exactly."""
        wrong = {}
        for key, expected in self.MESH_FACTS.items():
            value = report.get(key)
            value = len(value) if key in ('bones', 'materialSections') and isinstance(value, list) else value
            if type(value) is not int or value != expected:
                wrong[key] = value
        if wrong:
            fail(f'The mesh report {wrong} differs from the manifest mesh facts {self.MESH_FACTS}')
        names = self._dto_morph_names(dto)
        recorded = report.get('morphs')
        if isinstance(recorded, list):
            if [m.get('name') if isinstance(m, dict) else m for m in recorded] != names:
                fail(f'The mesh report morphs differ from the source DTO morphs {names}')
        elif type(recorded) is not int or recorded != len(names):
            fail(f'The mesh report morph count {recorded!r} differs from the {len(names)} source DTO morphs')
        data = Path(report['glb']).read_bytes()
        size = int.from_bytes(data[12:16], 'little') if len(data) >= 20 else 0
        if data[:4] != b'glTF' or data[16:20] != b'JSON' or not size or 20 + size > len(data):
            fail(f'Not a binary glTF with a JSON chunk: {report["glb"]}')
        doc = json.loads(data[20:20 + size])
        expected = {f'TEXCOORD_{i}' for i in range(report['uvSets'])}
        meshes = [mesh for mesh in doc.get('meshes', []) if mesh.get('primitives')]
        if not meshes:
            fail('The converted GLB has no mesh primitives')
        for mesh in meshes:
            if ((mesh.get('extras') or {}).get('targetNames') or []) != names:
                fail(f'GLB morph target names differ from the source DTO morphs {names}')
            for primitive in mesh['primitives']:
                attributes = set(primitive.get('attributes', {}))
                if {a for a in attributes if a.startswith('TEXCOORD_')} != expected:
                    fail(f'GLB UV channels differ from the {report["uvSets"]} original source UV sets')
                if not {'JOINTS_0', 'WEIGHTS_0'} <= attributes:
                    fail('A converted GLB primitive is not skinned')
                targets = primitive.get('targets') or []
                if len(targets) != len(names) or not all('POSITION' in t for t in targets):
                    fail(f'A converted GLB primitive has {len(targets)} position morph targets; the DTO has {len(names)}')
        if any(w != 0 for owner in (*meshes, *doc.get('nodes', [])) for w in owner.get('weights') or []):
            fail('The converted GLB activates morph targets by default; fitting rules must drive them')
        skins = doc.get('skins') or []
        if not skins or not all(skin.get('joints') and 'inverseBindMatrices' in skin for skin in skins):
            fail('The converted GLB lacks rest-bone joints and inverse bind matrices')

    def _require_mesh_contract(self):
        """Hash-current pinned report, exact skeletal source identity/package, one manifest slot, geometry."""
        d = self.d
        if not self.MESH_REPORT.is_file():
            fail('mesh-report.json is missing; restore the pinned preflight conversion')
        report = d.read_json(self.MESH_REPORT)
        missing = [k for k in ('glb', 'meshJson', 'file', 'sha256', 'sourceDtoSha256', 'sourcePackageSha256') if not report.get(k)]
        if missing:
            fail(f'The mesh report lacks {missing}')
        if d.file_sha(report['glb']) != report['sha256'] or d.file_sha(report['meshJson']) != report['sourceDtoSha256']:
            fail('The mesh report no longer matches its GLB/DTO; preserve evidence and inspect the drift')
        if report['sha256'] != self.GLB_SHA256:
            fail('The mesh report GLB hash is not the manifest pinned conversion; do not reconvert')
        if Path(report['glb']).resolve() != (self.WORK / 'meshes' / report['file']).resolve():
            fail("The mesh report GLB is not this family's converted mesh")
        if not (report.get('verification') or {}).get('passed'):
            fail('The recorded mesh attribute verification did not pass')
        if not self._require_mesh_request():
            fail('The exact mesh extraction folder is missing')
        records = d.read_json(d.SOURCE / 'meshes-01' / 'assets.json')
        if len(records) != 1 or records[0].get('error'):
            fail('Expected one successful mesh export')
        record, = records
        types = [e.get('type') for e in record.get('exports', [])]
        if types.count('SkeletalMesh') != 1 or 'StaticMesh' in types:
            fail('Expected exactly one SkeletalMesh export')
        if not self._is_source_mesh(record.get('path')) or not self._is_source_mesh(report.get('source')):
            fail('Missing or different mesh source identity')
        if record.get('sha256') != report.get('sourcePackageSha256'):
            fail('Mesh package hash differs from the converted report')
        dto_path = d.SOURCE / 'meshes-01' / record['meshFile']
        if Path(report['meshJson']).resolve() != dto_path.resolve():
            fail('Report refers to a different exported DTO')
        dto = d.read_json(dto_path)
        parsed = dto.get('objectPath')
        if not self._is_source_mesh(dto.get('source')) or (isinstance(parsed, str) and parsed.startswith(
                ('/Game/', 'Discovery/Content/')) and not self._is_source_mesh(parsed)):
            fail('DTO source identity differs from the requested mesh')
        slots = d.dto_slots(d.SOURCE / 'meshes-01', record)
        if [slot['slot'] for slot in slots] != [self.MATERIAL_SLOT]:
            fail(f'The exported mesh must carry exactly the {self.MATERIAL_SLOT} material slot')
        if d.glb_slots(report['glb']) != slots:
            fail('The converted GLB material slots differ from the source DTO')
        self._require_glb_geometry(report, dto)
        if self.REUSE:
            self._require_active_reuse(slots)
        return report, slots

    # ------------------------------------------------------------------------ opt-in active mesh reuse
    def _reuse_snapshot(self):
        """The active index files the shared index stage copied, which must be the frozen baseline."""
        d, snapshot, hashes = self.d, self.WORK / 'active-before', self._baseline()['hashes']
        for name in INDEX_FILES:
            if not (snapshot / name).is_file() or d.file_sha(snapshot / name) != hashes[(self.ACTIVE / name).as_posix()]:
                fail(f'The saved active snapshot {name} is not the frozen baseline')
        return [d.read_json(snapshot / name) for name in INDEX_FILES]

    def _require_active_reuse(self, slots):
        """Pinned entry, GLB and mask bytes, source slot/default and new identities; verify reads the snapshot."""
        snapshot = self.read_only and (self.WORK / 'active-before' / 'assets.json').is_file()
        docs = self._reuse_snapshot() if snapshot else [self.d.read_json(self.ACTIVE / n) for n in INDEX_FILES]
        entry = reuse.require_pin(self.REUSE, docs[0], self.ACTIVE, self.SOURCE_MESH)
        reuse.require_source_slots(entry, slots)
        reuse.require_new(self._require_cohort(), *docs)
        return entry

    def _reuse_coverage_evidence(self, provenance):
        body = Path('public') / FITTED_BODY
        entry = self._reuse_snapshot()[0]['meshes'][self.SOURCE_MESH]
        evidence = reuse.coverage_evidence(self.RUNTIME / 'coverage', self.PREVIEW, self.SOURCE_MESH, self.REUSE, entry,
                                           FITTED_BODY, self.d.file_sha(body) if body.is_file() else None, self.d.file_sha)
        return {**evidence, 'generator': GENERATOR.as_posix(), 'helper': HELPER.as_posix(), **provenance}

    def _require_reuse_coverage(self, preview=None):
        """Replay the pinned active-mask comparison; unpinned coverage never reaches or passes an index."""
        pin, target = self._fitted_pin('reuseCoverage'), self.RUNTIME / 'coverage'
        if pin is None:
            if target.exists() or (preview or {}).get('coverageReady'):
                fail('Coverage exists without the pinned active-mask comparison; preserve it and inspect')
            return None
        pinned = pin['reuseCoverage']
        provenance = {k: pinned.get(k) for k in ('generatorSha256', 'helperSha256')}
        if not self.read_only and self._coverage_provenance() != provenance:
            fail('The coverage generator or helper changed since the pinned comparison; use a new runtime folder')
        if self._reuse_coverage_evidence(provenance) != pinned:
            fail('The fresh coverage report or mask differs from the pinned comparison; preserve it and inspect')
        if preview is not None and (not preview.get('coverageReady') or
                                    (pin.get('coverage') or {}).get('command') != self._coverage_command(preview['implemented'])):
            fail('The preview does not index the pinned comparison of its implemented choices')
        return pinned

    def _require_reuse_preview(self, preview):
        """The reused entry and every prior entry equal the frozen snapshot after rebasing; only new materials added."""
        old, new = self._reuse_snapshot(), [self.d.read_json(self.PREVIEW / n) for n in INDEX_FILES]
        reuse.require_pin(self.REUSE, old[0], self.ACTIVE, self.SOURCE_MESH)
        implemented = preview['implemented']
        materials = {m for row in self._require_cohort()['items'] if row['id'] in implemented for m in row['materials']}
        reuse.require_preserved(old, new, self.ACTIVE, self.PREVIEW, implemented, materials, self.d.preview_tools.resolved_shape)
        if preview.get('reusedActiveMeshes') != [self.SOURCE_MESH]:
            fail('The preview does not record keeping the reused active mesh entry')
        if preview.get('coverageReady'):
            self._require_reuse_coverage(preview)

    def _reuse_coverage(self):
        """Derive the family policy fresh, require the pinned active mask bytes, only then index; else fail closed."""
        self._require_downstream()
        baseline = self._require_frozen_baseline()
        self._require_gpu_evidence()
        preview = self._require_preview(baseline)
        self._require_reuse_preview(preview)
        target = self.RUNTIME / 'coverage'
        if preview.get('coverageReady') or target.exists() or self._fitted_pin('reuseCoverage') is not None:
            fail(f'Reuse coverage is compared once in a new {target}; preserve it and use a new runtime folder')
        self._require_app()
        command, provenance = self._coverage_command(preview['implemented']), self._coverage_provenance()
        self._run_generator(command)
        if self._coverage_provenance() != provenance:
            fail('The coverage generator or helper changed during derivation; preserve evidence and inspect')
        evidence = self._reuse_coverage_evidence(provenance)
        self.progress('coverage-derived', coverage={'mode': self.COVERAGE['mode'], 'command': command, 'appUrl': self.APP_URL},
                      reuseCoverage=evidence)
        self.s.index()
        self._require_downstream()
        self._require_gpu_evidence()
        preview = self._require_preview(baseline)
        if not preview.get('coverageReady'):
            fail('Coverage derivation produced no derived coverage for this mesh')
        self._require_reuse_preview(preview)

    # ------------------------------------------------------------------------------ frozen evidence
    def _require_frozen_cohort(self, report, slots):
        d, cohort = self.d, self._require_cohort()
        path, batch_path = self.DOCS / 'resolved-cohort.json', self.DOCS / 'batch.json'
        if not path.is_file() or not batch_path.is_file():
            fail('Run freeze-family.mjs first: resolved-cohort.json/batch.json are missing')
        frozen, batch = d.read_json(path), d.read_json(batch_path)
        self._require_manifest_hash(batch.get('manifestSha256'), 'batch.json')
        self._require_manifest_hash(frozen.get('manifestSha256'), 'resolved-cohort.json')
        ids = [item['id'] for item in cohort['items']]
        if batch.get('cohort') != path.as_posix() or batch.get('ids') != ids or [r.get('id') for r in frozen.get('items', [])] != ids:
            fail('The frozen batch/cohort ids differ from cohort.json')
        if frozen.get('meshes') != [self.SOURCE_MESH] or frozen.get('meshReport') != report or frozen.get('sourceSlots') != slots:
            fail('The frozen cohort refers to a different mesh report or source slots')
        if frozen.get('context') != CONTEXT:
            fail(f'The frozen cohort was not resolved for {CONTEXT}')
        for row, item in zip(frozen['items'], cohort['items']):
            if any(row.get(key) != item[key] for key in ('id', 'name', 'slot', 'materials')):
                fail(f'Frozen choice differs from cohort.json: {item["id"]}')
            parts = row.get('effectiveParts') or []
            if len(parts) != 1 or parts[0].get('mesh') != self.SOURCE_MESH or \
                    parts[0].get('slots') != [{'slot': self.MATERIAL_SLOT, 'material': item['materials'][0]}]:
                fail(f'Frozen choice is not one {self.MATERIAL_SLOT} part on the manifest mesh: {item["id"]}')
            properties = (row.get('definition') or {}).get('properties') or {}
            if not self._is_fitting_tags(properties.get('ActivatesTags', [])) or not self._is_fitting_tags(row.get('fittingTags')):
                fail(f'Frozen choice does not activate exactly {self.FITTING_TAGS}: {item["id"]}')
            if d.file_sha(d.SOURCE_INDEX / 'items' / (item['id'] + '.json')) != row.get('definitionFileSha256'):
                fail(f'Source definition changed since the freeze: {item["id"]}')
        return frozen

    def _require_source_build(self):
        d = self.d
        working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
        if d.build_identity(d.SOURCE / 'meshes-01') != working:
            fail('Mesh and material sources come from different game builds')
        ready = d.read_json(self.WORK / 'source-ready.json')
        if ready.get('buildIdentity') != working or ready.get('batch') != (self.DOCS / 'batch.json').as_posix() \
                or ready.get('marker') != self.MARKER + '/source':
            fail('source-ready.json does not belong to this family and build')

    def _require_downstream(self):
        self._require_configuration()
        report, slots = self._require_mesh_contract()
        self._require_frozen_cohort(report, slots)
        self._require_source_build()
        return report

    # ------------------------------------------------------------------------------------- baseline
    def _active_hashes(self):
        return {p.as_posix(): self.d.file_sha(p) for p in [self.ACTIVE / n for n in INDEX_FILES] + [self.CATALOG]}

    def _indexed(self, index):
        """Catalog ids, advertised ids and catalog choices with an assembly or skin pair, as the loader counts them."""
        catalog = {item['id'] for item in self.d.read_json(self.CATALOG)}
        advertised = set(self.d.read_json(index / 'supported-items.json')['items'])
        pairs = set(self.d.read_json(index / 'skin-pairs.json')['items'])
        return catalog, advertised, (advertised | pairs) & catalog

    def _baseline(self):
        """freeze-family.mjs derived this once; its counts are history, not today's active index."""
        path = self.DOCS / 'adapter-baseline.json'
        if not path.is_file():
            fail('Run freeze-family.mjs first: adapter-baseline.json is missing')
        baseline = self.d.read_json(path)
        self._require_manifest_hash(baseline.get('manifestSha256'), 'adapter-baseline.json')
        counts, unadvertised = baseline.get('counts') or {}, baseline.get('unadvertisedStructurallyReady')
        if set(baseline.get('hashes') or {}) != set(self._active_hashes_keys()) or \
                any(type(counts.get(k)) is not int for k in ('advertised', 'indexed', 'catalog', 'structural')) or \
                not isinstance(unadvertised, list) or len(set(unadvertised)) != len(unadvertised):
            fail('adapter-baseline.json does not have the frozen baseline shape')
        if baseline.get(reuse.FIELD) != self.REUSE:
            fail('adapter-baseline.json was not frozen with exactly this manifest activeMeshReuse pin')
        return baseline

    def _active_hashes_keys(self):
        return [(self.ACTIVE / n).as_posix() for n in INDEX_FILES] + [self.CATALOG.as_posix()]

    def _require_frozen_baseline(self):
        """Mutating stages run only on exactly the active index and catalog the freeze derived its baseline from."""
        baseline = self._baseline()
        if baseline['hashes'] != self._active_hashes():
            fail('The active index or catalog differs from adapter-baseline.json; inspect before continuing')
        catalog, advertised, indexed = self._indexed(self.ACTIVE)
        counts = baseline['counts']
        if (len(advertised), len(indexed), len(catalog)) != (counts['advertised'], counts['indexed'], counts['catalog']):
            fail(f'The active index is not the frozen baseline {counts}; inspect before continuing')
        return baseline

    def _require_preview(self, baseline, replay=False):
        """The preview adds only this family and keeps every originally unadvertised ready entry by id."""
        d, cohort = self.d, self._require_cohort()
        preview = d.read_json(self.PREVIEW / 'preview.json')
        implemented = set(preview.get('implemented') or [])
        if preview.get('marker') != self.MARKER or preview.get('activeUnchanged') is not True \
                or not implemented <= {item['id'] for item in cohort['items']}:
            fail('The preview is not an additive preview of this cohort')
        by_material = {r['source']: d.job_id(r['instance']) for r in d.read_json(d.SOURCE / 'material-resolution.json')}
        uv_blocked = {r['itemId'] for r in d.read_json(self.WORK / 'geometry-contracts.json') if r['blockers']}
        leaked = [item['id'] for item in cohort['items'] if item['id'] in implemented
                  and any(by_material.get(m) in uv_blocked for m in item['materials'])]
        if leaked:
            fail(f'Preview advertises choices whose shader needs absent UV sets: {leaked}')
        counts, unadvertised = baseline['counts'], sorted(baseline['unadvertisedStructurallyReady'])
        if (preview.get('previousAdvertised'), preview.get('previousAssemblies')) != (counts['advertised'], counts['structural']) \
                or sorted(preview.get('unadvertisedStructurallyReady') or []) != unadvertised:
            fail(f'The preview was not built on the frozen baseline {counts} with unadvertised ready {unadvertised}')
        if (preview.get('previewAdvertised'), preview.get('previewAssemblies')) != (
                counts['advertised'] + len(implemented), counts['structural'] + len(implemented)):
            fail('The preview changed advertising or readiness outside this family')
        advertised = set(d.read_json(self.PREVIEW / 'supported-items.json')['items'])
        before, after = (self.WORK / 'resolver' / name for name in ('before.json', 'after.json'))
        if not before.is_file() or not after.is_file():
            fail('The preview resolver results are missing')
        old, new = ({row['id'] for row in d.read_json(path)['ready']} for path in (before, after))
        if len(advertised) != counts['advertised'] + len(implemented) or len(old) != counts['structural'] \
                or sorted(old - (advertised - implemented)) != unadvertised or sorted(new - advertised) != unadvertised:
            fail(f'The originally unadvertised structurally ready entries were not preserved by id: {unadvertised}')
        if not replay:
            if self._indexed(self.PREVIEW)[2] != self._indexed(self.ACTIVE)[2] | implemented:
                fail(f'The preview changed catalog progress outside this family (baseline {counts})')
            self._require_unrelated_masks()
        return preview

    def _require_unrelated_masks(self):
        """Coverage of every mesh outside this family is inherited exactly (URLs are rebased, so presence counts)."""
        active, preview = (self.d.read_json(index / 'assets.json')['meshes'] for index in (self.ACTIVE, self.PREVIEW))
        shape = lambda entry: (bool(entry.get('bodyMaskUrl')), entry.get('bodyMaskUvTiles'), entry.get('coverageSource'))
        changed = [mesh for mesh, entry in active.items() if mesh != self.SOURCE_MESH
                   and (mesh not in preview or shape(preview[mesh]) != shape(entry))]
        if changed:
            fail(f'The preview changed body coverage of unrelated meshes: {changed[:5]}')

    # ---------------------------------------------------------------------------------- geometry/GPU
    def geometry_records(self):
        """A shader passing fixtures must still be compatible with the actual source mesh UV sets."""
        d = self.d
        available = set(range(self._require_mesh_contract()[0]['uvSets']))
        records = []
        for job in d.read_json(self.WORK / 'validation' / 'passed.requests.json'):
            required = d.read_json(self.RUNTIME / 'staging' / (job['id'] + '.json')).get('requiredUvSets', [0, 1])
            missing = sorted(set(required) - available)
            records.append({'itemId': job['id'], 'availableUvSets': sorted(available), 'requiredUvSets': required,
                            'blockers': [f'Source mesh lacks original UV sets {missing}; shader requires {required}'] if missing else []})
        return records

    def geometry_blocked(self):
        blocked = self._surface_blocked()
        records = self.geometry_records()
        for record in records:
            if record['blockers']:
                blocked.setdefault(record['itemId'], []).extend(record['blockers'])
        self.d.write(self.WORK / 'geometry-contracts.json', records)
        return blocked

    def _build_hashes(self):
        files = [self.RUNTIME / 'staging' / 'build-report.json', self.WORK / 'requests.json',
                 self.WORK / 'validation' / 'passed.requests.json', self.WORK / 'surface-audit.json']
        return {p.as_posix(): self.d.file_sha(p) if p.is_file() else None for p in files}

    def _preserve_gpu_run(self, path):
        """Keep every GPU result under a unique content-addressed name; never replace differing evidence."""
        d = self.d
        run, digest = d.read_json(path), d.file_sha(path)
        stamp = re.sub(r'[^0-9A-Za-z]', '', str(run.get('at', ''))) or 'undated'
        target = self.WORK / 'validation' / 'gpu-runs' / f'webgl-run-{stamp}-{digest[:16]}.json'
        if target.exists():
            if d.file_sha(target) != digest:
                fail(f'Preserve existing GPU evidence: {target}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        return target

    def _require_gpu_evidence(self):
        """webgl-run.json must be the fresh run the gpu stage archived for this manifest and this exact build."""
        d, path = self.d, self.WORK / 'progress.json'
        history = d.read_json(path).get('history', []) if path.is_file() else []
        runs = [r for r in history if r.get('milestone') == 'gpu']
        if not runs:
            fail('No GPU evidence was recorded for this family; run the gpu stage')
        gpu = runs[-1]
        self._require_manifest_hash(gpu.get('manifestSha256'), 'The GPU evidence record')
        evidence, digest = Path(gpu.get('evidence') or ''), gpu.get('evidenceSha256') or ''
        archive = self.WORK / 'validation' / 'gpu-runs'
        if evidence.parent != archive or not evidence.is_file() or d.file_sha(evidence) != digest \
                or not evidence.name.endswith(f'-{digest[:16]}.json'):
            fail('The archived GPU evidence is missing or changed')
        if [d.file_sha(p) for p in archive.glob('*.json')].count(digest) != 1:
            fail('The archived GPU evidence is not unique')
        run_file = self.WORK / 'validation' / 'webgl-run.json'
        if not run_file.is_file() or d.file_sha(run_file) != digest:
            fail('webgl-run.json is not the recorded fresh GPU run')
        if gpu.get('build') != self._build_hashes():
            fail('The build changed after the recorded GPU run; rerun the gpu stage')
        return gpu

    # ------------------------------------------------------------------------------ fitted coverage
    def _coverage_command(self, implemented):
        mode, target = self.COVERAGE['mode'], self.RUNTIME / 'coverage'
        command = ['node', GENERATOR.as_posix(), '--all', '--items', ','.join(implemented),
                   '--index', self.PREVIEW.as_posix(), '--output', target.as_posix()]
        if mode in ('conservative-shared-uv', FITTED_MODE):
            command.append('--conservative-shared-uv')
        if mode == FITTED_MODE:
            command += ['--fitted-occlusion', '--fitting-tags', ','.join(fitted_tags(self.FITTING_TAGS))]
        return command

    def _coverage_provenance(self):
        return {'generatorSha256': self.d.file_sha(GENERATOR), 'helperSha256': self.d.file_sha(HELPER)}

    def _fitted_evidence(self, provenance):
        """The completed fitted report and its files, checked against this manifest; returns what gets pinned."""
        d, target = self.d, self.RUNTIME / 'coverage'
        path, applied = target / 'derived-coverage.json', fitted_tags(self.FITTING_TAGS)
        if not path.is_file():
            fail('The fitted coverage report is missing; preserve the coverage folder and inspect')
        report = d.read_json(path)
        policy = report.get('occlusionPolicy') if isinstance(report.get('occlusionPolicy'), dict) else {}
        if policy.get('name') != 'fitted-occlusion' or report.get('sharedUvPolicy') != 'all-surfaces-covered':
            fail('The coverage report is not a completed fitted-occlusion, all-surfaces-covered shared-UV report')
        if policy.get('fittingTags') != applied:
            fail(f'The fitted report applied {policy.get("fittingTags")}, not the manifest shape tags {applied}')
        if policy.get('helper') != HELPER.as_posix() or \
                {k: policy.get(k) for k in ('generatorSha256', 'helperSha256')} != provenance:
            fail(f'The fitted report provenance differs from the generator/helper that ran: {provenance}')
        if report.get('formatVersion') != 1 or report.get('geometryMode') != 'source' \
                or report.get('indexFolder') != self.PREVIEW.as_posix():
            fail('The fitted report was not derived from this family preview')
        body = Path('public') / FITTED_BODY
        if report.get('bodyFile') != FITTED_BODY or not body.is_file() or d.file_sha(body) != report.get('bodySha256'):
            fail(f'The fitted report body is not the current {FITTED_BODY}')
        records = report.get('records') if isinstance(report.get('records'), list) else []
        record = records[0] if len(records) == 1 and isinstance(records[0], dict) else {}
        stem = self.SOURCE_MESH.rsplit('.', 1)[1]
        mask, diagnostic = stem + '.bodymask.png', stem + '.fitted-occlusion-diagnostic.png'
        if record.get('source') != self.SOURCE_MESH or record.get('meshSha256') != self.GLB_SHA256 \
                or (record.get('file'), record.get('diagnosticFile')) != (mask, diagnostic):
            fail('The fitted report must hold exactly one record for the pinned manifest mesh')
        poses = record.get('poseCounts') if isinstance(record.get('poseCounts'), list) else []
        if [p.get('pose') for p in poses if isinstance(p, dict)] != ['a', 'idle'] or not all(
                'sharedUvRemovedPixels' in p and (p.get('fittedOcclusion') or {}).get('fittingMorphs') for p in poses):
            fail('The fitted report lacks shared-UV and fitted-occlusion counts for the A and idle poses')
        covered = record.get('coveredPixels')
        if type(covered) is not int or covered < 1 or (record.get('restoration') or {}).get('candidatePixels') != covered \
                or not re.fullmatch(r'[0-9a-f]{64}', str((record.get('previousPolicy') or {}).get('sha256'))):
            fail('The fitted report mask is not the recorded fitted candidate of a recorded previous-policy mask')
        entries = list(target.iterdir())
        files = {p.name: d.file_sha(p) for p in entries if p.is_file()}
        if len(files) != len(entries) or set(files) != {path.name, mask, diagnostic}:
            fail(f'The fitted coverage folder must hold exactly {sorted({path.name, mask, diagnostic})}')
        if files[mask] != record.get('sha256') or files[diagnostic] != record.get('diagnosticSha256'):
            fail('The fitted mask or diagnostic PNG differs from its report')
        return {'report': path.as_posix(), 'files': files, 'mask': mask, 'uvTiles': record.get('uvTiles'),
                'meshSha256': record['meshSha256'], 'bodyFile': FITTED_BODY, 'bodySha256': report['bodySha256'],
                'policy': policy['name'], 'sharedUvPolicy': report['sharedUvPolicy'], 'sourceFittingTags': self.FITTING_TAGS,
                'appliedFittingTags': applied, 'generator': GENERATOR.as_posix(), 'helper': HELPER.as_posix(), **provenance}

    def _fitted_pin(self, key='fittedCoverage'):
        """The one coverage-derived record of this family, or None before derivation."""
        path = self.WORK / 'progress.json'
        history = self.d.read_json(path).get('history', []) if path.is_file() else []
        runs = [r for r in history if r.get('milestone') == 'coverage-derived']
        if not runs:
            return None
        if len(runs) != 1 or not isinstance(runs[0].get(key), dict):
            fail('progress.json must pin exactly one fitted coverage derivation; preserve evidence and inspect')
        self._require_manifest_hash(runs[0].get('manifestSha256'), 'The fitted coverage record')
        return runs[0]

    def _require_fitted_coverage(self, preview=None):
        """Replay the pinned fitted evidence; with a preview, also its implemented ids and indexed mask binding."""
        pin, target = self._fitted_pin(), self.RUNTIME / 'coverage'
        if pin is None:
            if target.exists() or (preview or {}).get('coverageReady'):
                fail('Fitted coverage exists without pinned evidence; preserve it and inspect')
            return None
        pinned = pin['fittedCoverage']
        provenance = {k: pinned.get(k) for k in ('generatorSha256', 'helperSha256')}
        if self._fitted_evidence(provenance) != pinned:
            fail('The fitted coverage report or PNGs differ from the pinned evidence; preserve them and inspect')
        if preview is None:
            return pinned
        if not preview.get('coverageReady') or (pin.get('coverage') or {}).get('command') != self._coverage_command(preview['implemented']):
            fail('The preview does not index the pinned fitted derivation of its implemented choices')
        entry = self.d.read_json(self.PREVIEW / 'assets.json')['meshes'].get(self.SOURCE_MESH) or {}
        url = entry.get('bodyMaskUrl')
        mask = (self.PREVIEW / url) if isinstance(url, str) and url else None
        if mask is None or not mask.is_file() or self.d.file_sha(mask) != pinned['files'][pinned['mask']] \
                or entry.get('bodyMaskUvTiles') != pinned['uvTiles']:
            fail('The preview mask of this mesh is not the pinned fitted mask')
        return pinned

    # ----------------------------------------------------------------------------------------- stages
    def mesh(self):
        """Validate and reuse the pinned conversion; extraction/conversion stays in the shared s.mesh API."""
        self._require_configuration()
        self._require_cohort()
        if (self.DOCS / 'adapter-baseline.json').is_file():
            self._require_frozen_baseline()
        report, slots = self._require_mesh_contract()
        if not self.d.mesh_verifier.verify(Path(report['meshJson']), Path(report['glb'])).get('passed'):
            fail('The pinned GLB attributes no longer verify against the source DTO')
        if (self.DOCS / 'resolved-cohort.json').exists():
            self._require_frozen_cohort(report, slots)
        self.progress('mesh', mesh={'source': self.SOURCE_MESH, 'reusedConversion': True, 'glbSha256': report['sha256'],
                                    'slots': slots, 'morphNames': self.MORPH_NAMES,
                                    **{k: report.get(k) for k in ('vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'materialSections')}})
        print(f'Mesh: {self.SOURCE_MESH} -> {report["file"]} (slot {self.MATERIAL_SLOT}; morphs {self.MORPH_NAMES})', flush=True)

    def source(self):
        self._require_configuration()
        self._require_frozen_baseline()
        self._require_frozen_cohort(*self._require_mesh_contract())
        self.d.stage_source(argparse.Namespace(fresh_sources=True))
        self._require_downstream()
        resolution = self.d.read_json(self.d.SOURCE / 'material-resolution.json')
        roots = {}
        for row in resolution:
            roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
        self.progress('source', source={'materials': len(resolution), 'errors': [r['instance'] for r in resolution if r.get('error')],
                                        'roots': {k: len(v) for k, v in roots.items()},
                                        'unexpectedRoots': sorted(set(roots) - set(self._require_cohort().get('roots') or []) - {'error'}),
                                        'meshBuildIdentityMatches': True})

    def build(self):
        self._require_downstream()
        self._require_frozen_baseline()
        self.s.build()
        self._require_downstream()
        self.geometry_blocked()
        records = self.d.read_json(self.WORK / 'geometry-contracts.json')
        self.progress('build-geometry', geometry={'checked': len(records),
                                                  'uvBlockers': {r['itemId']: r['blockers'] for r in records if r['blockers']}})

    def gpu(self):
        self._require_downstream()
        self._require_frozen_baseline()
        run_file = self.WORK / 'validation' / 'webgl-run.json'
        previous = self._preserve_gpu_run(run_file) if run_file.is_file() else None
        self.d.stage_gpu(argparse.Namespace())
        self._require_downstream()
        if not run_file.is_file():
            fail('The GPU stage recorded no run')
        archived = self._preserve_gpu_run(run_file)
        if archived == previous:
            fail('The GPU stage did not record a fresh run')
        run = self.d.read_json(run_file)
        self.progress('gpu', gpu={k: run.get(k) for k in ('at', 'result', 'exitCode', 'materials', 'failed')},
                      evidence=archived.as_posix(), evidenceSha256=self.d.file_sha(archived), build=self._build_hashes())

    def index(self):
        self._require_downstream()
        baseline = self._require_frozen_baseline()
        self._require_gpu_evidence()
        fitted = self.COVERAGE['mode'] == FITTED_MODE
        if fitted:
            # The shared index stage indexes any runtime/coverage report; only pinned fitted evidence may reach it.
            self._require_fitted_coverage()
        if self.REUSE:
            self._require_reuse_coverage()
        self.s.index()
        self._require_downstream()
        self._require_gpu_evidence()
        preview = self._require_preview(baseline)
        if fitted:
            self._require_fitted_coverage(preview)
        if self.REUSE:
            self._require_reuse_preview(preview)

    def _require_app(self):
        """Derivation renders through the canonical app named by the manifest, never an assumed port."""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(self.APP_URL, timeout=15) as response:
                if response.status >= 400:
                    raise OSError(f'HTTP {response.status}')
        except OSError as error:
            fail(f'The manifest appUrl {self.APP_URL} is not serving the app: {error}')

    def _run_generator(self, command):
        log = self.WORK / 'coverage.log'
        with log.open('w', encoding='utf-8') as out:
            code = subprocess.call(command, stdout=out, stderr=subprocess.STDOUT,
                                   env={**os.environ, 'APP_URL': self.APP_URL, 'APP_ROOT': str(self.RESOLVER.parents[2])})
        if code:
            fail(f'Coverage derivation failed (exit {code}); see {log}')

    def coverage(self):
        if self.REUSE:
            return self._reuse_coverage()
        d = self.d
        self._require_downstream()
        baseline = self._require_frozen_baseline()
        self._require_gpu_evidence()
        preview = self._require_preview(baseline)
        mode, target = self.COVERAGE['mode'], self.RUNTIME / 'coverage'
        if mode == 'none':
            # Deliberately no derivation: the preview keeps no mask for this mesh and every unrelated mask as inherited.
            meshes = d.read_json(self.PREVIEW / 'assets.json')['meshes']
            if preview.get('coverageReady') or target.exists() or any(meshes.get(self.SOURCE_MESH, {}).get(k) for k in MASK_KEYS):
                fail('coverage.mode is none but this family has body coverage; preserve it and inspect')
            self.progress('coverage-skipped', coverage={'mode': mode, 'reason': self.COVERAGE['reason']})
            print(f'Coverage skipped by manifest: {self.COVERAGE["reason"]}', flush=True)
            return
        if preview.get('coverageReady'):
            fail('Coverage already derived; preserve it')
        fitted = mode == FITTED_MODE
        if fitted and (target.exists() or self._fitted_pin() is not None):
            # As the generator itself: never write into an existing path, even an empty folder.
            fail(f'Fitted coverage never reuses {target}; preserve it and use a new runtime folder')
        if target.exists() and any(target.iterdir()):
            fail('Preserve existing coverage folder')
        self._require_app()
        command = self._coverage_command(preview['implemented'])
        provenance = self._coverage_provenance() if fitted else None
        self._run_generator(command)
        coverage = {'mode': mode, 'command': command, 'appUrl': self.APP_URL}
        if fitted:
            # Checked and pinned before the shared index stage can turn it into an indexed preview.
            if self._coverage_provenance() != provenance:
                fail('The coverage generator or helper changed during derivation; preserve evidence and inspect')
            evidence = self._fitted_evidence(provenance)
            self.progress('coverage-derived', coverage={**coverage, 'sourceFittingTags': self.FITTING_TAGS,
                                                        'appliedFittingTags': evidence['appliedFittingTags']},
                          fittedCoverage=evidence)
        else:
            self.progress('coverage-derived', coverage=coverage)
        self.s.index()
        self._require_downstream()
        self._require_gpu_evidence()
        preview = self._require_preview(baseline)
        if not preview.get('coverageReady'):
            fail('Coverage derivation produced no derived coverage for this mesh')
        if fitted:
            self._require_fitted_coverage(preview)

    def verify(self):
        """Read-only replay: mesh/DTO/package/build, frozen cohort, geometry, GPU evidence and saved preview.

        The active index may already contain the accepted family; historical baseline counts are compared with
        the saved preview evidence, not with today's active index. Nothing is written.
        """
        d = self.d
        roots = [self.manifest_path, self.DOCS, self.WORK, self.RUNTIME, self.PREVIEW, self.ACTIVE, self.CATALOG]
        before, write = tree_state(roots), d.write
        self.read_only = True

        def refuse(path, value):
            fail(f'verify is a read-only replay; refusing to write {path}')
        d.write = refuse
        try:
            self._require_configuration()
            report, slots = self._require_mesh_contract()
            if not d.mesh_verifier.verify(Path(report['meshJson']), Path(report['glb'])).get('passed'):
                fail('The pinned GLB attributes no longer verify against the source DTO')
            self._require_frozen_cohort(report, slots)
            self._require_source_build()
            baseline = self._baseline()
            saved = self.WORK / 'geometry-contracts.json'
            if not saved.is_file() or d.read_json(saved) != self.geometry_records():
                fail('Saved geometry contracts differ from a replay against the source mesh')
            self._require_gpu_evidence()
            preview = self._require_preview(baseline, replay=True) if (self.PREVIEW / 'preview.json').is_file() else None
            if self.COVERAGE['mode'] == FITTED_MODE:
                if not self._require_fitted_coverage(preview) or not preview:
                    fail('Verification requires completed fitted coverage and its indexed preview; run the coverage stage')
            if self.REUSE:
                # As fitted mode: the structural preview is only input to the active-mask comparison.
                if not preview or not preview.get('coverageReady'):
                    fail('Verification of activeMeshReuse requires the coverage-complete preview; run the coverage stage')
                self._require_reuse_preview(preview)
        finally:
            d.write, self.read_only = write, False
        if tree_state(roots) != before:
            fail('verify changed files under its evidence folders; it must be read-only')
        print(json.dumps({'verified': self.m['id'], 'manifestSha256': self.sha, 'baseline': baseline['counts'],
                          'implemented': (preview or {}).get('implemented')}), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('stage', choices=STAGES)
    args = parser.parse_args(argv)
    family = Family(args.manifest)
    if args.stage == 'verify':
        return family.verify()
    before = family._active_hashes()
    getattr(family, args.stage)()
    if family._active_hashes() != before:
        fail('The active index or catalog changed during this stage; inspect before continuing')


if __name__ == '__main__':
    main()
