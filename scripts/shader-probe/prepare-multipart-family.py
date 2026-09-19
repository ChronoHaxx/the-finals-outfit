"""Stage one ordinary multipart Medium family from a schemaVersion 2 manifest (see multipart-family.md).

An opt-in sibling of prepare-family.py (schemaVersion 1, unchanged). The v1 Family supplies configuration
isolation, the frozen active baseline, source-build pairing, fresh GPU evidence, the additive preview checks and
fitted-coverage pinning; this module overrides only what assumes one mesh: the manifest, the pinned per-component
conversions, the frozen multipart cohort, the plan handed to the shared source stage, per-component UV geometry,
per-component coverage records and the read-only replay. Run from the repository root:

  python scripts/shader-probe/prepare-multipart-family.py --request R preflight [--reuse-probe WORK]
  python scripts/shader-probe/prepare-multipart-family.py --manifest M mesh|source|build|gpu|index|coverage|verify
  node --import tsx scripts/shader-probe/freeze-multipart-family.mjs --manifest M [--verify-only]
  python scripts/shader-probe/prepare-multipart-family.py --manifest M run [--stages mesh,freeze,...]
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Both are dependency-light at import (standard library only); their behavior is reused, never changed.
pf = _load('prepare_family_v1_for_multipart', 'prepare-family.py')
fail, manifest_sha, read_manifest = pf.fail, pf.manifest_sha, pf.read_manifest
CONTEXT, INDEX_FILES, FITTED_MODE, MASK_KEYS = pf.CONTEXT, pf.INDEX_FILES, pf.FITTED_MODE, pf.MASK_KEYS
# The opt-in activeComponentReuse contract (standard library only); absent from a manifest, none of it runs.
mar = _load('multipart_active_reuse', 'multipart_active_reuse.py')
# The opt-in activeMaterialReuse contract on top of it; absent from a manifest, none of it runs.
mmr = _load('multipart_material_reuse', 'multipart_material_reuse.py')
COMPOSITION = 'per-component-union'
FACT_KEYS = ('vertices', 'triangles', 'uvSets', 'bones', 'materialSections', 'maxInfluences')
STAGES = ('mesh', 'source', 'build', 'gpu', 'index', 'coverage', 'verify')
RUN_STAGES = ('mesh', 'freeze', 'source', 'build', 'gpu', 'index', 'coverage', 'verify', 'freeze-verify')
FREEZE = Path('scripts/shader-probe/freeze-multipart-family.mjs')
MESH_SOURCE = r'/Game/(?:[A-Za-z0-9_-]+/)+([A-Za-z0-9_-]+)\.\1'
FIELDS = {'manifest': ({'id', 'schemaVersion', 'paths', 'itemSlot', 'components', 'fittingTags', 'coverage'}, {'marker', mar.FIELD, mmr.FIELD}),
          'paths': (set(pf.FIELDS['paths'][0]) | {'metadata'}, set()),
          'request component': ({'sourceIndex', 'source', 'slot'}, set()),
          'component': ({'sourceIndex', 'source', 'slot', 'sha256', 'sourcePackageSha256', 'sourceDtoSha256', 'facts',
                         'morphNames'}, set()),
          'facts': (set(FACT_KEYS), set())}


def short(path):
    return path.rsplit('.', 1)[-1]


def _fields(value, key, label):
    required, optional = FIELDS[key]
    if not isinstance(value, dict):
        fail(f'manifest {label} must be an object')
    missing, unknown = required - set(value), set(value) - required - optional
    if missing or unknown:
        fail(f'manifest {label}: missing {sorted(missing)}, unsupported {sorted(unknown)}')


def _path(value, label):
    pf._text(value, label, rf'{pf.SEGMENT}(?:/{pf.SEGMENT})*')
    if any(part in ('.', '..') for part in value.split('/')):
        fail(f'manifest {label} must be an explicit repository-relative path: {value!r}')
    return value


def validate_manifest(doc, pinned=True):
    """Exact schemaVersion 2 fields; a request (pinned=False) omits the per-component pins preflight derives."""
    _fields(doc, 'manifest', 'manifest')
    pf._text(doc['id'], 'id', r'[a-z0-9]+(?:-[a-z0-9]+)*')
    if type(doc['schemaVersion']) is not int or doc['schemaVersion'] != 2:
        fail('manifest schemaVersion must be 2 (multipart); one-mesh families use prepare-family.py')
    if 'marker' in doc:
        _path(doc['marker'], 'marker')
    paths = doc['paths']
    _fields(paths, 'paths', 'paths')
    for key in sorted(set(pf.FIELDS['paths'][0]) - {'appUrl'}):
        _path(paths[key], f'paths.{key}')
    pf._app_url(paths['appUrl'])
    for key, root in pf.OUTPUT_ROOTS.items():
        if not paths[key].startswith(root):
            fail(f'manifest paths.{key} must be an isolated folder under {root}')
    if not paths['active'].startswith('public/models/'):
        fail('manifest paths.active must be an index folder under public/models/')
    if not paths['catalog'].endswith('.json') or paths['resolver'].split('/')[-1] != 'SourceAssembly.ts':
        fail('manifest paths.catalog must be a JSON catalog and paths.resolver the product SourceAssembly.ts')
    metadata = paths['metadata']
    pf._unique_texts(metadata, 'paths.metadata')
    for i, value in enumerate(metadata):
        if not _path(value, f'paths.metadata[{i}]').endswith('.json') or value == paths['catalog']:
            fail(f'manifest paths.metadata[{i}] must be a catalog metadata JSON file other than the catalog')
    outputs, inputs = list(pf.OUTPUT_ROOTS), [paths[k] for k in pf.INPUTS] + metadata
    for i, key in enumerate(outputs):
        for other in [paths[k] for k in outputs[i + 1:]] + inputs:
            if pf._overlaps(paths[key], other):
                fail(f'manifest paths.{key} overlaps {other}; outputs must be separate folders')
    pf._text(doc['itemSlot'], 'itemSlot', r'[A-Za-z][A-Za-z0-9]*')
    components = doc['components']
    if not isinstance(components, list) or len(components) < 2:
        fail('manifest components must list at least two source mesh components; one mesh is schemaVersion 1')
    for i, component in enumerate(components):
        label = f'components[{i}]'
        _fields(component, 'component' if pinned else 'request component', label)
        index = component['sourceIndex']
        if type(index) is not int or index < 0:
            fail(f'manifest {label}.sourceIndex must be a source part index')
        if i and index == components[i - 1]['sourceIndex']:
            fail(f'manifest {label} duplicates sourceIndex {index}')
        if i and index < components[i - 1]['sourceIndex']:
            fail(f'manifest components must be listed in ascending source part order: {label}')
        pf._text(component['source'], f'{label}.source', MESH_SOURCE)
        pf._text(component['slot'], f'{label}.slot')
        if pinned:
            pf._text(component['sha256'], f'{label}.sha256', r'[0-9a-f]{64}')
            pf._text(component['sourcePackageSha256'], f'{label}.sourcePackageSha256', r'[0-9A-F]{64}|[0-9a-f]{64}')
            pf._text(component['sourceDtoSha256'], f'{label}.sourceDtoSha256', r'[0-9a-f]{64}')
            _fields(component['facts'], 'facts', f'{label}.facts')
            for key, value in component['facts'].items():
                if type(value) is not int or value < 1:
                    fail(f'manifest {label}.facts.{key} must be a positive integer')
            if component['facts']['materialSections'] != 1:
                fail(f'manifest {label}.facts.materialSections must be 1: one material slot per component')
            pf._unique_texts(component['morphNames'], f'{label}.morphNames')
    for key, fold in (('source', str), ('source', lambda s: short(s).lower()), ('slot', str)):
        values = [fold(c[key]) for c in components]
        if len(set(values)) != len(values):
            fail(f'manifest components repeat a {key} ({"file stem" if fold is not str else "value"}); '
                 'item-level overrides and per-component files must be unambiguous')
    pf._unique_texts(doc['fittingTags'], 'fittingTags')
    coverage = doc['coverage']
    if not isinstance(coverage, dict) or coverage.get('mode') not in pf.COVERAGE_MODES:
        fail(f'manifest coverage.mode must be one of {list(pf.COVERAGE_MODES)}')
    expected = {'mode', 'reason'} if coverage['mode'] == 'none' else {'mode', 'composition'}
    if set(coverage) != expected:
        fail(f'manifest coverage for mode {coverage["mode"]} takes exactly {sorted(expected)}')
    if coverage['mode'] == 'none':
        pf._text(coverage['reason'], 'coverage.reason')
    elif coverage['composition'] != COMPOSITION:
        fail(f'manifest coverage.composition must be {COMPOSITION!r}: one mask per component, unioned by the runtime')
    if coverage['mode'] == FITTED_MODE:
        pf.fitted_tags(doc['fittingTags'])
    if mar.FIELD in doc:
        mar.validate(doc, request=not pinned)
    if mmr.FIELD in doc:
        mmr.validate(doc, request=not pinned)
    return doc


class _ComponentView:
    """One component seen through v1's single-mesh geometry checks (facts, UV sets, skinning, morphs)."""
    _dto_morph_names = pf.Family._dto_morph_names
    _require_glb_geometry = pf.Family._require_glb_geometry

    def __init__(self, component):
        self.MESH_FACTS, self.MORPH_NAMES = component['facts'], component['morphNames']


class MultipartFamily(pf.Family):
    def __init__(self, manifest_path, legacy=pf.load_legacy, pinned=True):
        # The v1 constructor validates schemaVersion 1; this binds the same globals and hooks for schemaVersion 2.
        self.manifest_path = Path(manifest_path)
        raw = read_manifest(self.manifest_path)
        self.m, self.sha, self.pinned = validate_manifest(raw, pinned), manifest_sha(raw), pinned
        paths = self.m['paths']
        self.DOCS, self.WORK, self.RUNTIME, self.PREVIEW = (Path(paths[k]) for k in ('docs', 'work', 'runtime', 'preview'))
        self.ACTIVE, self.SOURCE_INDEX, self.CATALOG = (Path(paths[k]) for k in ('active', 'sourceIndex', 'catalog'))
        self.RESOLVER, self.METADATA = Path(paths['resolver']), [Path(p) for p in paths['metadata']]
        self.MESH_REPORT = self.DOCS / 'mesh-report.json'
        self.MARKER = self.m.get('marker') or f'shader-probe/prepare-multipart-family/{self.m["id"]}'
        self.COMPONENTS, self.ITEM_SLOT = self.m['components'], self.m['itemSlot']
        self.SOURCES = [c['source'] for c in self.COMPONENTS]
        # The opt-in component receipt (None keeps every v2 gate); only the other components are new.
        self.COMPONENT_REUSE = self.m.get(mar.FIELD)
        self.REUSED = [c['source'] for c in (self.COMPONENT_REUSE or {}).get('components', [])]
        self.NEW_SOURCES = [source for source in self.SOURCES if source not in self.REUSED]
        # The opt-in material receipt (None keeps every gate); only these exact active bindings may be kept.
        self.MATERIAL_REUSE = self.m.get(mmr.FIELD)
        self.KEPT_MATERIALS = [m['source'] for m in (self.MATERIAL_REUSE or {}).get('materials', [])]
        self.FITTING_TAGS, self.COVERAGE, self.APP_URL = self.m['fittingTags'], self.m['coverage'], paths['appUrl']
        self.read_only = False
        s = self.s = legacy(self.m['id'])
        d = self.d = s.d
        self._surface_blocked = s.audit_blocked
        self._plan = self.plan  # one bound object, so the identity check below can recognise it
        self._hooks = {'progress': self.progress, 'audit_blocked': self.geometry_blocked, 'plan': self._plan}
        if self.COMPONENT_REUSE and pinned:
            # The shared index stage keeps exactly the pinned active entries instead of refusing them.
            self._hooks['ACTIVE_MESH_REUSE'] = mar.index_hook(self.SOURCES, self.COMPONENT_REUSE)
        if self.MATERIAL_REUSE and pinned:
            # ... and exactly the pinned material bindings whose fresh staged bundles are byte-identical.
            self._hooks['ACTIVE_MATERIAL_REUSE'] = mmr.index_hook(self.MATERIAL_REUSE, self.PREVIEW)
        self._d_globals = {'BATCH': self.DOCS / 'batch.json', 'WORK': self.WORK, 'SOURCE': self.WORK / 'source',
                           'RUNTIME': self.RUNTIME, 'PREVIEW': self.PREVIEW, 'MARKER': self.MARKER, 'REUSE_EXPORTS': [],
                           'REUSE_TEXTURES': [], 'MESH_EVIDENCE': [], 'ACTIVE': self.ACTIVE, 'CATALOG': self.CATALOG,
                           'SOURCE_INDEX': self.SOURCE_INDEX, 'RESOLVER': self.RESOLVER}
        self._s_globals = {'DOCS': self.DOCS, 'WORK': self.WORK, 'RUNTIME': self.RUNTIME, 'PREVIEW': self.PREVIEW,
                           'MESH_REPORT': self.MESH_REPORT}
        d.configure(self.DOCS / 'batch.json', self.WORK, self.RUNTIME, self.PREVIEW)
        for name, value in self._d_globals.items():
            setattr(d, name, list(value) if isinstance(value, list) else value)
        for name, value in {**self._s_globals, **self._hooks}.items():
            setattr(s, name, value)
        d.extract, d.plan = s.extract, s.plan

    def _require_configuration(self):
        if not self.pinned:
            fail('A request only runs preflight; later stages need the pinned manifest preflight wrote')
        if not self.MATERIAL_REUSE and getattr(self.s, 'ACTIVE_MATERIAL_REUSE', None) is not None:
            # prepare-family.py (v1, unchanged) does not know this hook; each family gets a private stage module and a
            # leaked hook refuses any other preview itself. A leak into a v2 family without the field fails here first.
            fail('Shared stage globals are not configured for this manifest: stage hooks (a leaked ACTIVE_MATERIAL_REUSE)')
        if not self.COMPONENT_REUSE:
            return super()._require_configuration()
        # v1 refuses any installed ACTIVE_MESH_REUSE hook unless its one-mesh REUSE is set. Here the installed hook
        # is this receipt's (the v1 hook identity check still runs); REUSE is set only for this one call.
        self.REUSE = self.COMPONENT_REUSE
        try:
            super()._require_configuration()
        finally:
            del self.REUSE

    def _current_inputs(self):
        """Today's coverage implementation inputs an originating report must name."""
        body = Path('public') / pf.FITTED_BODY
        sha = lambda path: self.d.file_sha(path) if path.is_file() else None
        return {'appliedFittingTags': pf.fitted_tags(self.FITTING_TAGS), 'helper': pf.HELPER.as_posix(),
                'helperSha256': sha(pf.HELPER), 'generatorSha256': sha(pf.GENERATOR), 'bodyFile': pf.FITTED_BODY,
                'bodySha256': sha(body)}

    def _reused_entries(self):
        """The pinned whole entries from the hash-pinned active snapshot (or, before the first index, the pinned
        active file); their GLB, mask and originating report must still be the receipt bytes."""
        hashes = self.d.read_json(self.DOCS / 'frozen-baseline.json').get('hashes') or {}
        snapshot = self.WORK / 'active-before' / 'assets.json'
        path = snapshot if snapshot.is_file() else self.ACTIVE / 'assets.json'
        data = path.read_bytes()
        if mar.v1.hashlib.sha256(data).hexdigest() != hashes.get((self.ACTIVE / 'assets.json').as_posix()):
            fail(f'{path.as_posix()} is not the frozen active assets.json')
        return mar.require_pinned(self.COMPONENT_REUSE, json.loads(data.decode('utf-8')), self.ACTIVE, self._current_inputs())

    def _reused_materials(self):
        """The pinned bindings in the hash-pinned active snapshot (or the active file before the first index); their
        manifest, shader and texture bytes must still be the receipt: a frozen snapshot is no proof of mutated files."""
        hashes = self.d.read_json(self.DOCS / 'frozen-baseline.json').get('hashes') or {}
        snapshot = self.WORK / 'active-before' / 'assets.json'
        path = snapshot if snapshot.is_file() else self.ACTIVE / 'assets.json'
        data = path.read_bytes()
        if mar.v1.hashlib.sha256(data).hexdigest() != hashes.get((self.ACTIVE / 'assets.json').as_posix()):
            fail(f'{path.as_posix()} is not the frozen active assets.json')
        mmr.require_pinned(self.MATERIAL_REUSE, json.loads(data.decode('utf-8')), self.ACTIVE)

    def _material_proof(self):
        """Today's fresh staged bundles of the declared materials against their pins (computed, never trusted)."""
        d = self.d
        return mmr.fresh_proof(self.MATERIAL_REUSE, self.RUNTIME / 'staging', d.read_json(d.SOURCE / 'material-resolution.json'), d.job_id)

    def _require_material_proof(self):
        """The saved compiled identity proof replays exactly from today's staging and the pinned old bundle bytes."""
        self._reused_materials()
        path, proof = self.WORK / mmr.PROOF, self._material_proof()
        if not path.is_file() or self.d.read_json(path) != proof:
            fail(f'{path.as_posix()} does not replay from the current fresh staged bundles; preserve evidence and inspect')
        mmr.require_identical(proof)

    def _build_hashes(self):
        # With the opt-in, the compiled identity proof is build evidence the GPU record binds; absent, unchanged.
        hashes = super()._build_hashes()
        if self.MATERIAL_REUSE:
            path = self.WORK / mmr.PROOF
            hashes[path.as_posix()] = self.d.file_sha(path) if path.is_file() else None
        return hashes

    # ------------------------------------------------------------------------------------ baseline
    def _baseline_files(self):
        return [self.ACTIVE / n for n in INDEX_FILES] + [self.CATALOG, *self.METADATA, self.RESOLVER]

    def _active_hashes(self):
        return {p.as_posix(): self.d.file_sha(p) for p in self._baseline_files()}

    def _active_hashes_keys(self):
        return [p.as_posix() for p in self._baseline_files()]

    def _require_frozen_baseline(self):
        baseline = super()._require_frozen_baseline()
        pinned = self.d.read_json(self.DOCS / 'frozen-baseline.json').get('hashes')
        if pinned != baseline['hashes']:
            fail('frozen-baseline.json (preflight) and adapter-baseline.json (freeze) pin different active files')
        return baseline

    def _baseline(self):
        baseline = super()._baseline()
        if baseline.get(mar.FIELD) != self.COMPONENT_REUSE:
            fail(f'adapter-baseline.json was not frozen with exactly this manifest {mar.FIELD} receipt')
        if self.COMPONENT_REUSE:
            mar.require_receipt(self.d.read_json(self.DOCS / 'frozen-baseline.json'), self.COMPONENT_REUSE)
        if baseline.get(mmr.FIELD) != self.MATERIAL_REUSE:
            fail(f'adapter-baseline.json was not frozen with exactly this manifest {mmr.FIELD} receipt')
        if self.MATERIAL_REUSE:
            mmr.require_receipt(self.d.read_json(self.DOCS / 'frozen-baseline.json'), self.MATERIAL_REUSE)
        return baseline

    def _require_unrelated_masks(self):
        # Only new components are exempt: a reused component keeps its active coverage exactly.
        active, preview = (self.d.read_json(index / 'assets.json')['meshes'] for index in (self.ACTIVE, self.PREVIEW))
        shape = lambda entry: (bool(entry.get('bodyMaskUrl')), entry.get('bodyMaskUvTiles'), entry.get('coverageSource'))
        changed = [mesh for mesh, entry in active.items() if mesh not in self.NEW_SOURCES
                   and (mesh not in preview or shape(preview[mesh]) != shape(entry))]
        if changed:
            fail(f'The preview changed body coverage of unrelated meshes: {changed[:5]}')

    def _require_preserved_entries(self, preview):
        """Replayable: every pre-existing entry equals the pinned active snapshot; only this cohort is added."""
        d, snapshot = self.d, self.WORK / 'active-before'
        pinned = self._baseline()['hashes']
        docs = {}
        for name in INDEX_FILES:
            if d.file_sha(snapshot / name) != pinned[(self.ACTIVE / name).as_posix()]:
                fail(f'The saved active snapshot {name} is not the frozen baseline')
            docs[name] = (d.read_json(snapshot / name), d.read_json(self.PREVIEW / name))
        shape = d.preview_tools.resolved_shape
        (old_assets, assets), (old_pairs, pairs), (old_supported, supported) = (docs[n] for n in INDEX_FILES)
        implemented = preview['implemented']
        materials = {m for row in self._require_cohort()['items'] if row['id'] in implemented for m in row['materials']}
        # Exactly the implemented materials minus the declared kept bindings are new; kept ones must already be active.
        kept = set(self.KEPT_MATERIALS)
        if set(assets['meshes']) != set(old_assets['meshes']) | set(self.SOURCES) or set(old_assets['meshes']) & set(self.NEW_SOURCES) \
                or not set(self.REUSED) <= set(old_assets['meshes']) or set(assets['materials']) != set(old_assets['materials']) | materials \
                or set(old_assets['materials']) & (materials - kept) or not kept <= materials & set(old_assets['materials']) \
                or assets.get('materialVariants', {}).keys() != old_assets.get('materialVariants', {}).keys():
            fail('The preview does not add exactly the implemented components and materials to the frozen assets')
        for field in ('meshes', 'materials', 'materialVariants'):
            kept = {k: v for k, v in assets.get(field, {}).items() if k in old_assets.get(field, {})}
            if shape(kept, self.PREVIEW) != shape(old_assets.get(field, {}), self.ACTIVE):
                fail(f'The preview changed pre-existing {field} entries')
        if shape(pairs, self.PREVIEW) != shape(old_pairs, self.ACTIVE):
            fail('The preview changed skin pairs')
        old_ready = {r['id']: r for r in old_supported['ready']}
        new_ready = {r['id']: r for r in supported['ready']}
        if supported['items'] != old_supported['items'] + implemented or set(new_ready) != set(old_ready) | set(implemented) \
                or any(shape(new_ready[i], self.PREVIEW) != shape(r, self.ACTIVE) for i, r in old_ready.items()) \
                or supported.get('exceptions') != [r for r in old_supported.get('exceptions', []) if r['id'] not in implemented]:
            fail('The preview changed advertised items, readiness or exclusions outside this cohort')
        if self.COMPONENT_REUSE:
            # The kept entries are the pinned whole snapshot entries, whose accepted files are still the receipt bytes.
            self._reused_entries()
            mar.require_kept(self.COMPONENT_REUSE, old_assets, assets, self.ACTIVE, self.PREVIEW, shape)
            if self.MATERIAL_REUSE:
                # Kept bindings are the pinned snapshot bindings (shape-compared above) whose bundles are still the pins.
                self._reused_materials()
            others = sorted((set(supported) | set(old_supported)) - {'items', 'ready', 'exceptions'})
            if any(shape(supported.get(k), self.PREVIEW) != shape(old_supported.get(k), self.ACTIVE) for k in others):
                fail(f'The preview changed supported-items metadata {others}')

    # --------------------------------------------------------------------------------- mesh contract
    def _require_cohort(self):
        cohort = self.d.read_json(self.DOCS / 'cohort.json')
        items = cohort.get('items') if isinstance(cohort.get('items'), list) else []
        ids = [item.get('id') for item in items]
        if cohort.get('meshes') != self.SOURCES or cohort.get('attached'):
            fail('The cohort must name exactly the unattached manifest components in source part order')
        if not items or cohort.get('count') != len(items) or not all(isinstance(i, str) and i for i in ids) \
                or len(set(ids)) != len(ids):
            fail('The cohort must name a nonempty counted set of unique choices')
        for item in items:
            materials = item.get('materials')
            if item.get('slot') != self.ITEM_SLOT or not isinstance(materials, list) or len(materials) != len(self.COMPONENTS) \
                    or not all(isinstance(m, str) and m for m in materials):
                fail(f'Choice {item.get("id")} must be in {self.ITEM_SLOT} with one material per component, in component order')
        if sorted({m for item in items for m in item['materials']}) != sorted(cohort.get('materials') or []):
            fail('The cohort material list differs from its choices')
        return cohort

    def _packages(self):
        return [self.d.package_of(source) for source in self.SOURCES]

    def _require_mesh_request(self):
        d = self.d
        folder = d.SOURCE / 'meshes-01'
        if not folder.is_dir() or not any(folder.iterdir()):
            return False
        requests, run = d.SOURCE / 'meshes-01.requests.json', d.SOURCE / 'meshes-01.run.json'
        listed = d.read_json(requests) if requests.is_file() else None
        if not isinstance(listed, list) or len(set(listed)) != len(listed) or sorted(listed) != sorted(self._packages()):
            fail('meshes-01 was not extracted for exactly the manifest component packages; use a new folder')
        if not run.is_file() or d.read_json(run).get('exitCode') != 0:
            fail('meshes-01 has no successful extraction run record')
        return True

    def _require_mesh_contract(self):
        """Every component: hash-current pinned report, exact package/DTO, its one slot, v1 geometry checks."""
        d = self.d
        if not self.MESH_REPORT.is_file():
            fail('mesh-report.json is missing; run preflight')
        doc = d.read_json(self.MESH_REPORT)
        reports = doc.get('components') if doc.get('formatVersion') == 2 else None
        if not isinstance(reports, list) or len(reports) != len(self.COMPONENTS):
            fail('mesh-report.json must hold one report per manifest component')
        if not self._require_mesh_request():
            fail('The exact mesh extraction folder is missing')
        records = {}
        for record in d.read_json(d.SOURCE / 'meshes-01' / 'assets.json'):
            key = d.assembly_index.object_path(record.get('path') or '')
            if record.get('error') or key in records:
                fail(f'The mesh export has an error or a repeated package: {record.get("path")}')
            records[key] = record
        if sorted(records) != sorted(self.SOURCES):
            fail(f'The mesh export holds {sorted(records)}, not exactly the manifest components')
        all_slots = []
        for component, report in zip(self.COMPONENTS, reports):
            label = f'component {component["sourceIndex"]} {short(component["source"])}'
            missing = [k for k in ('glb', 'meshJson', 'file', 'sha256', 'sourceDtoSha256', 'sourcePackageSha256') if not report.get(k)]
            if missing:
                fail(f'{label}: the mesh report lacks {missing}')
            if d.file_sha(report['glb']) != report['sha256'] or d.file_sha(report['meshJson']) != report['sourceDtoSha256']:
                fail(f'{label}: the mesh report no longer matches its GLB/DTO; preserve evidence and inspect the drift')
            if (report['sha256'], report['sourceDtoSha256'], report['sourcePackageSha256']) != \
                    (component['sha256'], component['sourceDtoSha256'], component['sourcePackageSha256']):
                fail(f'{label}: the mesh report is not the manifest pinned conversion/source; do not reconvert')
            if Path(report['glb']).resolve() != (self.WORK / 'meshes' / report['file']).resolve():
                fail(f"{label}: the mesh report GLB is not this family's converted mesh")
            if not (report.get('verification') or {}).get('passed'):
                fail(f'{label}: the recorded mesh attribute verification did not pass')
            record = records[component['source']]
            types = [e.get('type') for e in record.get('exports', [])]
            if types.count('SkeletalMesh') != 1 or 'StaticMesh' in types:
                fail(f'{label}: expected exactly one SkeletalMesh export')
            if d.assembly_index.object_path(report.get('source') or '') != component['source'] and report.get('source') != component['source']:
                fail(f'{label}: the mesh report names a different source')
            if record.get('sha256') != report['sourcePackageSha256']:
                fail(f'{label}: mesh package hash differs from the converted report')
            dto_path = d.SOURCE / 'meshes-01' / record['meshFile']
            if Path(report['meshJson']).resolve() != dto_path.resolve():
                fail(f'{label}: the report refers to a different exported DTO')
            dto = d.read_json(dto_path)
            if d.assembly_index.object_path(dto.get('source') or '') != component['source']:
                fail(f'{label}: DTO source identity differs from the component')
            slots = d.dto_slots(d.SOURCE / 'meshes-01', record)
            if [slot['slot'] for slot in slots] != [component['slot']]:
                fail(f'{label}: the exported mesh must carry exactly the {component["slot"]} material slot')
            if d.glb_slots(report['glb']) != slots:
                fail(f'{label}: the converted GLB material slots differ from the source DTO')
            _ComponentView(component)._require_glb_geometry(report, dto)
            all_slots.append(slots)
        return reports, all_slots

    def _verify_components(self, reports):
        verification = []
        for report in reports:
            result = self.d.mesh_verifier.verify(Path(report['meshJson']), Path(report['glb']))
            if not result.get('passed'):
                fail(f'The pinned GLB attributes of {report["file"]} no longer verify against the source DTO')
            verification.append(result)
        return verification

    def _require_frozen_cohort(self, reports, slots):
        d, cohort = self.d, self._require_cohort()
        path, batch_path = self.DOCS / 'resolved-cohort.json', self.DOCS / 'batch.json'
        if not path.is_file() or not batch_path.is_file():
            fail('Run freeze-multipart-family.mjs first: resolved-cohort.json/batch.json are missing')
        frozen, batch = d.read_json(path), d.read_json(batch_path)
        self._require_manifest_hash(batch.get('manifestSha256'), 'batch.json')
        self._require_manifest_hash(frozen.get('manifestSha256'), 'resolved-cohort.json')
        ids = [item['id'] for item in cohort['items']]
        if batch.get('cohort') != path.as_posix() or batch.get('ids') != ids or [r.get('id') for r in frozen.get('items', [])] != ids:
            fail('The frozen batch/cohort ids differ from cohort.json')
        if frozen.get('meshes') != self.SOURCES or frozen.get('meshReports') != reports or frozen.get('sourceSlots') != slots:
            fail('The frozen cohort refers to different components, mesh reports or source slots')
        if frozen.get('context') != CONTEXT:
            fail(f'The frozen cohort was not resolved for {CONTEXT}')
        for row, item in zip(frozen['items'], cohort['items']):
            if any(row.get(key) != item[key] for key in ('id', 'name', 'slot', 'materials')):
                fail(f'Frozen choice differs from cohort.json: {item["id"]}')
            expected = [{'sourceIndex': c['sourceIndex'], 'mesh': c['source'], 'binding': 'explicit-override',
                         'slots': [{'slot': c['slot'], 'material': material}]}
                        for c, material in zip(self.COMPONENTS, item['materials'])]
            if row.get('effectiveParts') != expected:
                fail(f'Frozen choice does not bind every component, in order, by explicit override: {item["id"]}')
            properties = (row.get('definition') or {}).get('properties') or {}
            if not self._is_fitting_tags(properties.get('ActivatesTags', [])) or not self._is_fitting_tags(row.get('fittingTags')):
                fail(f'Frozen choice does not activate exactly {self.FITTING_TAGS}: {item["id"]}')
            if d.file_sha(d.SOURCE_INDEX / 'items' / (item['id'] + '.json')) != row.get('definitionFileSha256'):
                fail(f'Source definition changed since the freeze: {item["id"]}')
        return frozen

    def plan(self):
        """prepare-large-sneakers.plan for several parts (it requires one); the shared source stage consumes it."""
        d = self.d
        batch, rows = d.load_batch()
        expected = [(c['sourceIndex'], c['source']) for c in self.COMPONENTS]
        items = []
        for row in rows:
            definition = d.read_json(d.SOURCE_INDEX / 'items' / (row['id'] + '.json'))
            if definition != row['definition']:
                raise ValueError('Frozen definition changed: ' + row['id'])
            if row['resolved'].get('materialParameters'):
                raise ValueError('Unexpected per-item material parameters: ' + row['id'])
            parts = row['resolved']['parts']
            if [(p['sourceIndex'], p['skeletalMesh']) for p in parts] != expected or any(p['hidden'] for p in parts) \
                    or [(p['sourceIndex'], p['mesh']) for p in row['effectiveParts']] != expected:
                raise ValueError('Resolved parts are not exactly the manifest components: ' + row['id'])
            if any(p['unresolved'] or p['effect'] or p['staticMesh'] for p in parts):
                raise ValueError('Incomplete source part: ' + row['id'])
            items.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                          'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                          'parameterBlockers': [], 'parts': [{'sourceIndex': p['sourceIndex'], 'mesh': p['mesh'], 'slots': p['slots'],
                                                              'effect': None, 'unresolved': []} for p in row['effectiveParts']]})
        return batch, items, []

    # ---------------------------------------------------------------------------------- geometry/build
    def geometry_records(self):
        """Each validated material against the UV sets of every component it is bound to."""
        d = self.d
        reports, _ = self._require_mesh_contract()
        uv_sets = {c['source']: r['uvSets'] for c, r in zip(self.COMPONENTS, reports)}
        bound = {}
        for row in d.read_json(self.DOCS / 'resolved-cohort.json')['items']:
            for part in row['effectiveParts']:
                for slot in part['slots']:
                    bound.setdefault(slot['material'], set()).add(part['mesh'])
        sources = {d.job_id(r['instance']): r['source'] for r in d.read_json(d.SOURCE / 'material-resolution.json') if not r.get('error')}
        records = []
        for job in d.read_json(self.WORK / 'validation' / 'passed.requests.json'):
            required = d.read_json(self.RUNTIME / 'staging' / (job['id'] + '.json')).get('requiredUvSets', [0, 1])
            meshes = sorted(bound.get(sources.get(job['id']), ()))
            blockers = [] if meshes else ['The material is bound to no manifest component']
            for mesh in meshes:
                missing = sorted(set(required) - set(range(uv_sets[mesh])))
                if missing:
                    blockers.append(f'{short(mesh)} lacks original UV sets {missing}; shader requires {required}')
            records.append({'itemId': job['id'], 'meshes': meshes, 'availableUvSets': {m: list(range(uv_sets[m])) for m in meshes},
                            'requiredUvSets': required, 'blockers': blockers})
        return records

    def _mesh_entries(self, reports):
        return [{k: v for k, v in r.items() if k not in ('verification', 'sourceRun', 'dtoKeys')} for r in reports]

    def _require_build_record(self):
        """The last completed build must describe today's build outputs; a partial or edited build is not ready."""
        path = self.WORK / 'progress.json'
        builds = [r for r in (self.d.read_json(path).get('history', []) if path.is_file() else []) if r.get('milestone') == 'build']
        if not builds or builds[-1].get('buildHashes') != self._build_hashes():
            fail('No completed build record matches the current build outputs; rerun the build stage')
        meshes = self.WORK / 'meshes' / 'meshes.json'
        if not meshes.is_file() or self.d.read_json(meshes) != self._mesh_entries(self._require_mesh_contract()[0]):
            fail('meshes.json does not list exactly the pinned components in source part order')

    def build(self):
        """prepare-large-sneakers.build composed from the same helpers; its one-report mesh tail is per component.

        The eight lines of material-job/copy glue are repeated because that function hard-codes one mesh report.
        """
        d, s = self.d, self.s
        self._require_downstream()
        self._require_frozen_baseline()
        d.ready_source()
        resolution = d.read_json(d.SOURCE / 'material-resolution.json')
        jobs = [{'id': d.job_id(r['instance']), 'instance': r['instance']} for r in resolution if not r.get('error')]
        d.write(self.WORK / 'requests.json', jobs)
        d.materials_builder.build(d.SOURCE / 'working-01', d.SOURCE / 'textures-01', self.RUNTIME / 'staging', jobs, keep_going=True)
        s.cpu.check(d.SOURCE / 'working-01', self.RUNTIME / 'staging', self.WORK / 'requests.json')
        for name in ('translation-checks.json', 'translation-fixtures.json', 'translation-errors.json', 'passed.requests.json'):
            (self.WORK / 'validation').mkdir(parents=True, exist_ok=True)
            shutil.copyfile(d.SOURCE / 'working-01' / name, self.WORK / 'validation' / name)
        d.write(self.WORK / 'surface-audit.json', s.surface_audit(d.SOURCE / 'working-01', jobs))
        reports, _ = self._require_mesh_contract()
        d.write(self.WORK / 'mesh-verification.json', self._verify_components(reports))
        d.write(self.WORK / 'meshes' / 'meshes.json', self._mesh_entries(reports))
        if self.MATERIAL_REUSE:
            # Saved first so a differing fresh bundle stays evidence; the build record is then never written.
            self._reused_materials()
            proof = self._material_proof()
            d.write(self.WORK / mmr.PROOF, proof)
            mmr.require_identical(proof)
        self._require_downstream()
        blocked = self.geometry_blocked()
        self.progress('build', buildHashes=self._build_hashes(), build={
            'built': len(d.read_json(self.RUNTIME / 'staging' / 'build-report.json')),
            'cpuPassed': len(d.read_json(self.WORK / 'validation' / 'passed.requests.json')), 'blocked': blocked})

    def gpu(self):
        self._require_build_record()
        super().gpu()

    # ------------------------------------------------------------------------------------- coverage
    def _require_report_records(self, report):
        records = report.get('records') if isinstance(report.get('records'), list) else []
        if [r.get('source') if isinstance(r, dict) else None for r in records] != self.SOURCES:
            fail('The coverage report must hold exactly one record per component, in source part order')
        for component, record in zip(self.COMPONENTS, records):
            if record.get('meshSha256') != component['sha256'] or record.get('file') != short(component['source']) + '.bodymask.png':
                fail(f'The coverage record of {short(component["source"])} is not for its pinned mesh')
        return records

    def _fitted_evidence(self, provenance):
        """v1's report-level checks, then one completed fitted record per component (v1 accepts exactly one)."""
        d, target = self.d, self.RUNTIME / 'coverage'
        path, applied = target / 'derived-coverage.json', pf.fitted_tags(self.FITTING_TAGS)
        if not path.is_file():
            fail('The fitted coverage report is missing; preserve the coverage folder and inspect')
        report = d.read_json(path)
        policy = report.get('occlusionPolicy') if isinstance(report.get('occlusionPolicy'), dict) else {}
        if policy.get('name') != 'fitted-occlusion' or report.get('sharedUvPolicy') != 'all-surfaces-covered' \
                or policy.get('fittingTags') != applied:
            fail(f'The coverage report is not a completed fitted-occlusion, all-surfaces-covered report for {applied}')
        if policy.get('helper') != pf.HELPER.as_posix() or {k: policy.get(k) for k in ('generatorSha256', 'helperSha256')} != provenance:
            fail(f'The fitted report provenance differs from the generator/helper that ran: {provenance}')
        if report.get('formatVersion') != 1 or report.get('geometryMode') != 'source' or report.get('indexFolder') != self.PREVIEW.as_posix():
            fail('The fitted report was not derived from this family preview')
        body = Path('public') / pf.FITTED_BODY
        if report.get('bodyFile') != pf.FITTED_BODY or not body.is_file() or d.file_sha(body) != report.get('bodySha256'):
            fail(f'The fitted report body is not the current {pf.FITTED_BODY}')
        components, names = [], {path.name}
        for record in self._require_report_records(report):
            diagnostic = record['file'].replace('.bodymask.png', '.fitted-occlusion-diagnostic.png')
            poses = record.get('poseCounts') if isinstance(record.get('poseCounts'), list) else []
            covered = record.get('coveredPixels')
            if record.get('diagnosticFile') != diagnostic or [p.get('pose') for p in poses if isinstance(p, dict)] != ['a', 'idle'] \
                    or not all('sharedUvRemovedPixels' in p and (p.get('fittedOcclusion') or {}).get('fittingMorphs') for p in poses) \
                    or type(covered) is not int or covered < 1 or (record.get('restoration') or {}).get('candidatePixels') != covered \
                    or not re.fullmatch(r'[0-9a-f]{64}', str((record.get('previousPolicy') or {}).get('sha256'))):
                fail(f'The fitted record of {record["source"]} lacks completed A/idle fitted counts or its previous-policy mask')
            names |= {record['file'], diagnostic}
            components.append({'source': record['source'], 'mask': record['file'], 'diagnostic': diagnostic,
                               'maskSha256': record.get('sha256'), 'diagnosticSha256': record.get('diagnosticSha256'),
                               'uvTiles': record.get('uvTiles'), 'meshSha256': record['meshSha256']})
        entries = list(target.iterdir())
        files = {p.name: d.file_sha(p) for p in entries if p.is_file()}
        if len(files) != len(entries) or set(files) != names:
            fail(f'The fitted coverage folder must hold exactly {sorted(names)}')
        if any(files[c['mask']] != c['maskSha256'] or files[c['diagnostic']] != c['diagnosticSha256'] for c in components):
            fail('A fitted mask or diagnostic PNG differs from its report')
        if self.COMPONENT_REUSE:
            # Before the shared index turns this report into a coverage-complete preview: every reused mask is reproduced.
            mar.require_fresh(self.COMPONENT_REUSE, self._reused_entries(), report, components)
        return {'report': path.as_posix(), 'files': files, 'components': components, 'bodyFile': pf.FITTED_BODY,
                'bodySha256': report['bodySha256'], 'policy': policy['name'], 'sharedUvPolicy': report['sharedUvPolicy'],
                'composition': COMPOSITION, 'sourceFittingTags': self.FITTING_TAGS, 'appliedFittingTags': applied,
                'generator': pf.GENERATOR.as_posix(), 'helper': pf.HELPER.as_posix(), **provenance}

    def _require_component_masks(self, components, files):
        """Each component's preview entry indexes its own derived mask; the runtime unions them per item slot."""
        meshes = self.d.read_json(self.PREVIEW / 'assets.json')['meshes']
        for component in components:
            entry = meshes.get(component['source']) or {}
            url = entry.get('bodyMaskUrl')
            mask = (self.PREVIEW / url) if isinstance(url, str) and url else None
            if mask is None or not mask.is_file() or self.d.file_sha(mask) != files[component['mask']] \
                    or entry.get('bodyMaskUvTiles') != component['uvTiles'] or entry.get('coverageSource') != 'derived-projection':
                fail(f'The preview mask of {short(component["source"])} is not its derived component mask')

    def _require_fitted_coverage(self, preview=None):
        pin, target = self._fitted_pin(), self.RUNTIME / 'coverage'
        if pin is None:
            if target.exists() or (preview or {}).get('coverageReady'):
                fail('Fitted coverage exists without pinned evidence; preserve it and inspect')
            return None
        pinned = pin['fittedCoverage']
        if self._fitted_evidence({k: pinned.get(k) for k in ('generatorSha256', 'helperSha256')}) != pinned:
            fail('The fitted coverage report or PNGs differ from the pinned evidence; preserve them and inspect')
        if preview is None:
            return pinned
        if not preview.get('coverageReady') or (pin.get('coverage') or {}).get('command') != self._coverage_command(preview['implemented']):
            fail('The preview does not index the pinned fitted derivation of its implemented choices')
        self._require_component_masks(pinned['components'], pinned['files'])
        return pinned

    def _require_derived_coverage(self, preview):
        """derived/conservative modes: a completed per-component report whose masks the preview indexes."""
        path = self.RUNTIME / 'coverage' / 'derived-coverage.json'
        if not preview.get('coverageReady') or not path.is_file():
            fail('Verification requires completed derived coverage and its indexed preview; run the coverage stage')
        report = self.d.read_json(path)
        if report.get('indexFolder') != self.PREVIEW.as_posix() or (self.COVERAGE['mode'] == 'conservative-shared-uv') != \
                (report.get('sharedUvPolicy') == 'all-surfaces-covered') or 'occlusionPolicy' in report:
            fail(f'The coverage report was not derived from this preview with mode {self.COVERAGE["mode"]}')
        records = self._require_report_records(report)
        files = {r['file']: self.d.file_sha(self.RUNTIME / 'coverage' / r['file']) for r in records}
        if any(files[r['file']] != r.get('sha256') for r in records):
            fail('A derived mask differs from its report')
        self._require_component_masks([{'source': r['source'], 'mask': r['file'], 'uvTiles': r.get('uvTiles')} for r in records], files)

    def _require_no_masks(self, preview):
        meshes = self.d.read_json(self.PREVIEW / 'assets.json')['meshes']
        if preview.get('coverageReady') or (self.RUNTIME / 'coverage').exists() \
                or any(meshes.get(source, {}).get(k) for source in self.SOURCES for k in MASK_KEYS):
            fail('coverage.mode is none but this family has body coverage; preserve it and inspect')

    def index(self):
        self._require_build_record()
        if self.COMPONENT_REUSE:
            self._reused_entries()
        if self.MATERIAL_REUSE:
            self._require_material_proof()
        mode, report = self.COVERAGE['mode'], self.RUNTIME / 'coverage' / 'derived-coverage.json'
        if mode in ('derived', 'conservative-shared-uv') and report.exists():
            # The shared index stage checks only the first record of a report; every component is checked first.
            self._require_report_records(self.d.read_json(report))
        super().index()
        preview = self.d.read_json(self.PREVIEW / 'preview.json')
        self._require_preserved_entries(preview)
        if mode in ('derived', 'conservative-shared-uv') and preview.get('coverageReady'):
            self._require_derived_coverage(preview)

    def coverage(self):
        self._require_build_record()
        if self.COVERAGE['mode'] == 'none':
            self._require_downstream()
            baseline = self._require_frozen_baseline()
            self._require_gpu_evidence()
            self._require_no_masks(self._require_preview(baseline))
            self.progress('coverage-skipped', coverage={'mode': 'none', 'reason': self.COVERAGE['reason']})
            return
        super().coverage()
        preview = self.d.read_json(self.PREVIEW / 'preview.json')
        self._require_preserved_entries(preview)
        if self.COVERAGE['mode'] != FITTED_MODE:
            self._require_derived_coverage(preview)

    # ---------------------------------------------------------------------------------------- stages
    def mesh(self):
        """Validate and reuse the pinned per-component conversions; preflight is the only converter."""
        self._require_configuration()
        self._require_cohort()
        if (self.DOCS / 'adapter-baseline.json').is_file():
            self._require_frozen_baseline()
        reports, slots = self._require_mesh_contract()
        self._verify_components(reports)
        if (self.DOCS / 'resolved-cohort.json').exists():
            self._require_frozen_cohort(reports, slots)
        self.progress('mesh', components=[{'sourceIndex': c['sourceIndex'], 'source': c['source'], 'glbSha256': r['sha256'],
                                           'slots': s, 'morphNames': c['morphNames'], 'facts': c['facts']}
                                          for c, r, s in zip(self.COMPONENTS, reports, slots)])
        print(f'Mesh: {len(reports)} components verified: {[r["file"] for r in reports]}', flush=True)

    def verify(self):
        """Read-only replay of mesh, cohort, build, geometry, GPU, preserved preview entries and coverage."""
        d = self.d
        roots = [self.manifest_path, self.DOCS, self.WORK, self.RUNTIME, self.PREVIEW, self.ACTIVE, self.CATALOG, *self.METADATA]
        before, write = pf.tree_state(roots), d.write
        self.read_only = True

        def refuse(path, value):
            fail(f'verify is a read-only replay; refusing to write {path}')
        d.write = refuse
        try:
            self._require_configuration()
            reports, slots = self._require_mesh_contract()
            self._verify_components(reports)
            self._require_frozen_cohort(reports, slots)
            self._require_source_build()
            baseline = self._baseline()
            if d.read_json(self.DOCS / 'frozen-baseline.json').get('hashes') != baseline['hashes']:
                fail('frozen-baseline.json and adapter-baseline.json pin different active files')
            self._require_build_record()
            if self.MATERIAL_REUSE:
                self._require_material_proof()
            saved = self.WORK / 'geometry-contracts.json'
            if not saved.is_file() or d.read_json(saved) != self.geometry_records():
                fail('Saved geometry contracts differ from a replay against the component meshes')
            self._require_gpu_evidence()
            if not (self.PREVIEW / 'preview.json').is_file():
                fail('Verification requires the indexed preview; run the index and coverage stages')
            preview = self._require_preview(baseline, replay=True)
            self._require_preserved_entries(preview)
            mode = self.COVERAGE['mode']
            if mode == FITTED_MODE and not self._require_fitted_coverage(preview):
                fail('Verification requires completed fitted coverage and its indexed preview; run the coverage stage')
            if mode in ('derived', 'conservative-shared-uv'):
                self._require_derived_coverage(preview)
            if mode == 'none':
                self._require_no_masks(preview)
        finally:
            d.write, self.read_only = write, False
        if pf.tree_state(roots) != before:
            fail('verify changed files under its evidence folders; it must be read-only')
        print(json.dumps({'verified': self.m['id'], 'manifestSha256': self.sha, 'baseline': baseline['counts'],
                          'implemented': preview.get('implemented')}), flush=True)


# ------------------------------------------------------------------------------------------ preflight
def preflight(request_path, reuse_probe=None, legacy=pf.load_legacy):
    """Pin the baseline, extract (or reuse with full provenance) and convert every component, write the manifest."""
    pre = _load('preflight_family_v1_for_multipart', 'preflight-family.py')
    fam = MultipartFamily(request_path, legacy, pinned=False)
    d, s = fam.d, fam.s
    cohort = fam._require_cohort()
    receipt, frozen_path = None, fam.DOCS / 'frozen-baseline.json'
    if not fam.COMPONENT_REUSE:
        pre.frozen(frozen_path, {'hashes': fam._active_hashes()})
        active = d.read_json(fam.ACTIVE / 'assets.json')
        reused = sorted(set(fam.SOURCES) & set(active['meshes'])) + sorted(set(cohort['materials']) & set(active['materials']))
        if reused:
            # Provenance of already-active entries is not proven by this slice; never replace or silently share them.
            fail(f'Already-active mesh/material reuse is not supported by schemaVersion 2: {reused}')
    else:
        # The one early receipt, before any extraction; a resumed preflight compares it and never repins.
        hashes, folder = fam._active_hashes(), d.SOURCE / 'meshes-01'
        converted = fam.MESH_REPORT.exists() or (fam.WORK / 'meshes').exists() or (folder.exists() and any(folder.iterdir()))
        saved = d.read_json(frozen_path) if frozen_path.is_file() else None
        if saved is not None and saved.get('hashes') != hashes:
            fail('The active files changed since frozen-baseline.json was pinned; preserve evidence and inspect')
        receipt = mar.early_pins(fam.m, hashes, fam._current_inputs(), cohort, saved, converted)
        materials = mmr.early_pins(fam.m, hashes, cohort, saved, converted) if fam.MATERIAL_REUSE else None
        pre.frozen(frozen_path, {'hashes': hashes, mar.FIELD: receipt, **({mmr.FIELD: materials} if materials else {})})
    folder, packages = d.SOURCE / 'meshes-01', fam._packages()
    if not fam.MESH_REPORT.is_file():
        if folder.exists() and any(folder.iterdir()):
            fail(f'Preserve the earlier partial extraction {folder}; use a new work folder')
        probe_glbs = _reuse_probe(fam, Path(reuse_probe), packages) if reuse_probe else None
        if probe_glbs is None:
            s.extract('assets', 'meshes-01', packages)
        records = {d.assembly_index.object_path(r['path']): r for r in d.read_json(folder / 'assets.json') if not r.get('error')}
        if sorted(records) != sorted(fam.SOURCES):
            fail(f'The mesh export does not hold exactly the requested components: {sorted(records)}')
        reports = []
        for source in fam.SOURCES:
            record = records[source]
            dto = folder / record['meshFile']
            output = fam.WORK / 'meshes' / (dto.name.removesuffix('.mesh.json') + '.glb')
            if output.exists():
                fail(f'Preserve converted mesh: {output}')
            report = d.meshes_builder.build(dto, output)
            if probe_glbs is not None and d.file_sha(output) != d.file_sha(probe_glbs[output.name]):
                fail(f'A fresh conversion of the reused DTO differs from the probe GLB {output.name}; do not reuse it')
            verification = d.mesh_verifier.verify(dto, output)
            if not verification.get('passed'):
                fail(f'Converted mesh attributes differ from the source DTO: {output.name}')
            run = folder / 'source-run.json'
            reports.append({**report, 'glb': output.as_posix(), 'meshJson': dto.as_posix(), 'sourceDtoSha256': d.file_sha(dto),
                            'sourcePackageSha256': record['sha256'], 'sourceRun': d.read_json(run) if run.is_file() else None,
                            'dtoKeys': sorted(d.read_json(dto)), 'verification': verification})
        pre.frozen(fam.MESH_REPORT, {'formatVersion': 2, 'components': reports})
    reports = d.read_json(fam.MESH_REPORT)['components']
    if receipt is not None:
        # After the fresh extraction/conversion: the receipt still describes today's bytes, and each reused
        # component's conversion is the active GLB with the entry's source slot and default material.
        hashes = d.read_json(frozen_path)['hashes']
        mar.early_pins(fam.m, hashes, fam._current_inputs(), cohort, {mar.FIELD: receipt})
        if materials is not None:
            mmr.early_pins(fam.m, hashes, cohort, {mmr.FIELD: materials})
        records = {d.assembly_index.object_path(r['path']): r for r in d.read_json(folder / 'assets.json') if not r.get('error')}
        if len(reports) != len(fam.SOURCES) or sorted(records) != sorted(fam.SOURCES):
            fail('The mesh export/report does not hold exactly the requested components')
        entries = mar.v1.pinned_json(fam.ACTIVE / 'assets.json', hashes)['meshes']
        mar.require_conversion(receipt, dict(zip(fam.SOURCES, reports)),
                               {source: d.dto_slots(folder, records[source]) for source in fam.REUSED}, entries)
    counted = lambda value: len(value) if isinstance(value, list) else value
    manifest = {**fam.m, 'components': [{**c, 'sha256': r['sha256'], 'sourcePackageSha256': r['sourcePackageSha256'],
                                         'sourceDtoSha256': r['sourceDtoSha256'],
                                         'facts': {k: counted(r.get(k)) for k in FACT_KEYS},
                                         'morphNames': [m.get('name') if isinstance(m, dict) else m for m in r['morphs']]}
                                        for c, r in zip(fam.COMPONENTS, reports)]}
    if receipt is not None:
        manifest[mar.FIELD] = receipt
        if materials is not None:
            manifest[mmr.FIELD] = materials
    validate_manifest(manifest)
    target = fam.DOCS / 'family.json'
    pre.frozen(target, manifest)
    MultipartFamily(target, legacy).mesh()
    return {'manifest': target.as_posix(), 'components': [{k: c[k] for k in ('source', 'slot', 'sha256', 'facts')}
                                                           for c in manifest['components']]}


def _reuse_probe(fam, probe, packages):
    """Copy a probe's exact extraction byte-for-byte when its request, run and records match; GLBs are reconverted."""
    d, source = fam.d, probe / 'source'
    requests, run = source / 'meshes-01.requests.json', source / 'meshes-01.run.json'
    listed = d.read_json(requests) if requests.is_file() else None
    if not isinstance(listed, list) or len(set(listed)) != len(listed) or sorted(listed) != sorted(packages) \
            or not run.is_file() or d.read_json(run).get('exitCode') != 0:
        fail(f'{probe} was not one successful extraction of exactly {packages}; extract fresh instead')
    files = {}
    for path in sorted(p for p in (source / 'meshes-01').rglob('*') if p.is_file()):
        rel = path.relative_to(source / 'meshes-01').as_posix()
        target = d.SOURCE / 'meshes-01' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        files[rel] = d.file_sha(path)
        if d.file_sha(target) != files[rel]:
            fail(f'Copy changed bytes: {rel}')
    for path in (requests, run):
        shutil.copyfile(path, d.SOURCE / path.name)
    d.write(d.SOURCE / 'meshes-01.reused.json', {'from': probe.as_posix(), 'files': files,
                                                 'requestsSha256': d.file_sha(requests), 'runSha256': d.file_sha(run)})
    return {p.name: p for p in (probe / 'meshes').glob('*.glb')}


# ---------------------------------------------------------------------------------------------- runner
def run(manifest_path, stages, runner=subprocess.run, python=sys.executable):
    """Run stages sequentially with one log per stage and a never-overwritten receipt per attempt."""
    manifest = read_manifest(manifest_path)
    validate_manifest(manifest)
    unknown = [stage for stage in stages if stage not in RUN_STAGES]
    if unknown or not stages:
        fail(f'Unknown or empty stage list {unknown or stages}; choose from {list(RUN_STAGES)}')
    folder = Path(manifest['paths']['docs']) / 'runs'
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    at = next(stamp + suffix for suffix in ('', *(f'-{i}' for i in range(1, 1000))) if not (folder / (stamp + suffix + '.json')).exists())
    receipt = folder / (at + '.json')
    record = {'manifest': str(manifest_path), 'manifestSha256': manifest_sha(manifest), 'startedAt': at, 'stages': [], 'complete': False}

    def save():
        receipt.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    save()
    for stage in stages:
        if stage in ('freeze', 'freeze-verify'):
            command = ['node', '--import', 'tsx', FREEZE.as_posix(), '--manifest', str(manifest_path)] + \
                      (['--verify-only'] if stage == 'freeze-verify' else [])
        else:
            command = [python, '-B', 'scripts/shader-probe/prepare-multipart-family.py', '--manifest', str(manifest_path), stage]
        log = folder / f'{at}-{stage}.log'
        entry = {'stage': stage, 'command': command, 'startedAt': datetime.now(timezone.utc).isoformat(), 'log': log.as_posix(),
                 'complete': False}
        record['stages'].append(entry)
        save()
        started = time.monotonic()
        with log.open('wb') as stream:
            result = runner(command, stdout=stream, stderr=subprocess.STDOUT, env={**os.environ, 'APP_URL': manifest['paths']['appUrl']})
        entry.update(seconds=round(time.monotonic() - started, 3), exitCode=result.returncode, complete=True)
        save()
        print(json.dumps({'family': manifest['id'], **entry}), flush=True)
        if result.returncode:
            print(log.read_text(encoding='utf-8', errors='replace')[-3000:], flush=True)
            return result.returncode
    record.update(complete=True, finishedAt=datetime.now(timezone.utc).isoformat())
    save()
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--manifest')
    source.add_argument('--request')
    parser.add_argument('stage', choices=('preflight', 'run') + STAGES)
    parser.add_argument('--reuse-probe', help='preflight: a work folder whose exact mesh extraction may be reused')
    parser.add_argument('--stages', default=','.join(RUN_STAGES), help='run: comma-separated stages')
    args = parser.parse_args(argv)
    if (args.stage == 'preflight') != bool(args.request):
        fail('preflight takes --request; every other stage takes the pinned --manifest')
    if args.stage == 'preflight':
        print(json.dumps(preflight(args.request, args.reuse_probe)), flush=True)
        return 0
    if args.stage == 'run':
        return run(args.manifest, [s for s in args.stages.split(',') if s])
    family = MultipartFamily(args.manifest)
    if args.stage == 'verify':
        return family.verify()
    before = family._active_hashes()
    getattr(family, args.stage)()
    if family._active_hashes() != before:
        fail('The active index, catalog, metadata or resolver changed during this stage; inspect before continuing')


if __name__ == '__main__':
    raise SystemExit(main())
