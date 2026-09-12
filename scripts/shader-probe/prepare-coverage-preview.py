"""Build a sibling preview index that keeps the active one intact and adds staged materials.

The preview index is a rebase of the current runtime index plus the validated Stage A
material set. Preparing a preview index is not a build, a fitting check or any visual
acceptance: it only states which exact preserved files each binding would resolve to.
"""
import argparse
import copy
import hashlib
import json
import os
import stat
from pathlib import Path
from material_inputs import read_json

# Every file this preparer writes. A directory holding anything else is not ours.
OWNED = {'assets.json', 'skin-pairs.json', 'supported-items.json', 'preview.json'}
# Reserved names alone prove nothing: an unrelated index also has an assets.json. A rerun
# must find this preparer's own marker, naming the same inputs, or use an empty directory.
MARKER = 'shader-probe/prepare-coverage-preview'
PUBLIC = Path('public').resolve()


def object_path(package):
    path = package.removeprefix('Discovery/Content/').removesuffix('.uasset')
    return '/Game/' + path + '.' + path.split('/')[-1]


def identity(base, materials):
    return {'marker': MARKER, 'base': base.as_posix(), 'materialSets': [m.as_posix() for m in materials]}


def linked_path(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    # Python versions before Path.is_junction() do not classify Windows junctions
    # as symlinks. Check their reparse attribute without following the destination.
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400))


def guard_output(output, base, materials):
    # Walk the requested path exactly as given: resolve() would follow a link out of the
    # workspace first and report only the destination it landed on.
    literal = output.absolute()
    for parent in [literal, *literal.parents]:
        if linked_path(parent):
            raise ValueError(f'Output path or ancestor is a symbolic link or junction: {parent}')
    resolved = output.resolve()
    if not resolved.is_relative_to(PUBLIC / 'models'):
        raise ValueError(f'Preview index must stay in public/models: {resolved}')
    if resolved == base.resolve():
        raise ValueError('Refusing to overwrite the index this preview is derived from')
    for parent in [resolved, *resolved.parents]:
        if linked_path(parent):
            raise ValueError(f'Output ancestor is a symbolic link or junction: {parent}')
        if parent == PUBLIC: break
    if not resolved.exists() or not any(resolved.iterdir()): return
    marker = resolved / 'preview.json'
    unowned = sorted(p.name for p in resolved.iterdir() if p.name not in OWNED)
    if unowned:
        raise ValueError(f'Output directory holds files this preparer does not write: {unowned}')
    if not marker.is_file():
        raise ValueError(f'Output directory is nonempty and carries no preparer marker: {resolved}')
    try:
        previous = read_json(marker)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError(f'Unreadable preparer marker, refusing to overwrite: {marker} ({error})') from None
    expected = identity(base, materials)
    found = {key: previous.get(key) for key in expected}
    if found != expected:
        raise ValueError(f'Output directory was prepared from different inputs; use a new directory. '
                         f'Found {found}, expected {expected}')


class Rebaser:
    """Rewrite index-relative URLs for a sibling folder and prove nothing was missed."""

    def __init__(self, base, output):
        self.base, self.output = base.resolve(), output.resolve()
        self.moved, self.missing = {}, []

    def __call__(self, url):
        if url is None: return None
        if url.startswith(('http://', 'https://', 'data:', '/')):
            return url  # absolute references do not depend on the index folder
        target = (self.base / url).resolve()
        if not target.is_relative_to(PUBLIC):
            raise ValueError(f'Runtime dependency escapes public/: {url}')
        if not target.exists():
            self.missing.append(url)
        rebased = Path(os.path.relpath(target, self.output)).as_posix()
        if rebased != url: self.moved[url] = rebased
        return rebased

    def unrebased(self, document):
        """Any surviving string that names a file next to the old index is a dropped rebase."""
        found = []

        def walk(value, trail):
            if isinstance(value, str):
                if value.startswith(('/Game/', 'Discovery/')) or '\n' in value: return
                old, new = (self.base / value), (self.output / value)
                try:
                    if old.is_file() and not new.is_file(): found.append((trail, value))
                except OSError:
                    return
            elif isinstance(value, list):
                for i, item in enumerate(value): walk(item, f'{trail}[{i}]')
            elif isinstance(value, dict):
                for key, item in value.items(): walk(item, f'{trail}.{key}')
        walk(document, '')
        return found


def rebase_assets(assets, rebase):
    out = copy.deepcopy(assets)
    for mesh in out.get('meshes', {}).values():
        mesh['url'] = rebase(mesh['url'])
        if 'bodyMaskUrl' in mesh: mesh['bodyMaskUrl'] = rebase(mesh['bodyMaskUrl'])
    for field in ('materials', 'materialVariants'):
        out[field] = {key: rebase(url) for key, url in out.get(field, {}).items()} if field in out else out.get(field)
        if out.get(field) is None: out.pop(field, None)
    if 'attachmentBody' in out: out['attachmentBody']['url'] = rebase(out['attachmentBody']['url'])
    return out


def rebase_skin_pairs(pairs, rebase):
    out = copy.deepcopy(pairs)
    for pair in out.get('items', {}).values():
        for side in ('head', 'body'):
            part = pair.get(side)
            if not part: continue
            part['url'] = rebase(part['url'])
            for binding in part.get('materials', {}).values():
                if binding.get('url'): binding['url'] = rebase(binding['url'])
    return out


def resolved_shape(document, folder):
    """Normalise every URL to a public-relative path so preservation can be compared exactly."""
    def convert(value):
        if isinstance(value, str):
            try:
                target = (folder / value).resolve()
                if not target.is_file(): return value
            except OSError:
                return value
            return 'resolved:' + os.path.relpath(target, PUBLIC).replace('\\', '/')
        if isinstance(value, list): return [convert(v) for v in value]
        if isinstance(value, dict): return {k: convert(v) for k, v in value.items()}
        return value
    return convert(document)


def referenced_materials(definitions_file, assets):
    """Every material object path the definitions and preserved mesh slots actually ask for."""
    refs = set()

    def walk(value):
        if isinstance(value, list):
            for item in value: walk(item)
        elif isinstance(value, dict):
            name = value.get('AssetPathName')
            if isinstance(name, str) and name.startswith('/Game/'): refs.add(name)
            for item in value.values(): walk(item)
    if definitions_file and definitions_file.exists(): walk(read_json(definitions_file))
    for mesh in assets.get('meshes', {}).values():
        for slot in mesh.get('slots', []): refs.add(slot['material'])
    return refs


def case_aliases(keys, refs, index_keys):
    """Preserved package folders can differ in case from the reference the game data uses.

    Unreal resolves those references case-insensitively, so an exactly-once case-only match
    is the same asset. Anything ambiguous stays unresolved rather than being guessed.
    """
    by_case = {}
    for ref in refs: by_case.setdefault(ref.lower(), set()).add(ref)
    aliases = {}
    for key in keys:
        if key in refs: continue
        spellings = by_case.get(key.lower(), set()) - {key}
        if len(spellings) != 1: continue
        alias = next(iter(spellings))
        if alias in index_keys or alias in aliases:
            raise ValueError(f'Case alias collides with an existing binding: {alias}')
        aliases[alias] = key
    return aliases


def stage_materials(folders, export_folders, rebase_to, verify_payloads):
    """Index each staged material manifest by the exact source instance it was built from."""
    packages = {}
    for folder in export_folders:
        for record in read_json(folder / 'probe-summary.json')['results']:
            if packages.setdefault(record['name'], record['path']) != record['path']:
                raise ValueError(f'Ambiguous source material: {record["name"]}')
    staged, dependencies = {}, []
    for folder in folders:
        for report in read_json(folder / 'build-report.json'):
            file = folder / (report['itemId'] + '.json')
            manifest = read_json(file)
            if manifest['sourceInstance'] not in packages:
                raise ValueError(f'Staged material has no exported source package: {manifest["sourceInstance"]}')
            source = object_path(packages[manifest['sourceInstance']])
            overlays = manifest.get('parameterOverrides')
            key = json.dumps([source, *overlays], separators=(',', ':')) if overlays else source
            variant = bool(overlays)
            if key in staged: raise ValueError(f'Duplicate staged source material: {key}')
            shader = (folder / manifest['shader']).read_bytes()
            if hashlib.sha256(shader).hexdigest() != manifest['shaderSha256']:
                raise ValueError(f'Shader hash mismatch: {manifest["shader"]}')
            files = [file, folder / manifest['shader']]
            if manifest.get('coverageShader'): files.append(folder / manifest['coverageShader'])
            for texture in manifest['textures']:
                payload = folder / texture['file']
                files.append(payload)
                if verify_payloads:
                    import gzip
                    if hashlib.sha256(gzip.decompress(payload.read_bytes())).hexdigest() != texture['sha256']:
                        raise ValueError(f'Texture hash mismatch: {texture["file"]}')
            missing = [str(p) for p in files if not p.is_file()]
            if missing: raise ValueError(f'Staged material is incomplete: {missing}')
            dependencies.extend(files)
            staged[key] = {'variant': variant, 'url': rebase_to(file), 'itemId': report['itemId'],
                           'sourceInstance': manifest['sourceInstance'], 'source': source}
    return staged, dependencies


def prepare(base, materials, exports, output, report_path, verify_payloads=False, definitions=None):
    guard_output(output, base, materials)
    rebase = Rebaser(base, output)
    assets = rebase_assets(read_json(base / 'assets.json'), rebase)
    pairs_file = base / 'skin-pairs.json'
    pairs = rebase_skin_pairs(read_json(pairs_file), rebase) if pairs_file.exists() else None
    if rebase.missing:
        raise ValueError(f'Current index references missing files: {sorted(set(rebase.missing))}')

    # Preservation is checked against the exact files the current index resolves to.
    original = read_json(base / 'assets.json')
    if resolved_shape(original, base) != resolved_shape(assets, output):
        raise ValueError('Rebased asset index does not resolve to the current index files')
    if pairs is not None and resolved_shape(read_json(pairs_file), base) != resolved_shape(pairs, output):
        raise ValueError('Rebased skin-pair index does not resolve to the current index files')
    for name, document in (('assets.json', assets), ('skin-pairs.json', pairs)):
        left = rebase.unrebased(document) if document is not None else []
        if left: raise ValueError(f'Unrebased index-relative references in {name}: {left}')

    def rebase_to(path):
        target = path.resolve()
        if not target.is_relative_to(PUBLIC): raise ValueError('Runtime assets must be in public')
        return Path(os.path.relpath(target, output.resolve())).as_posix()

    staged, dependencies = stage_materials(materials, exports, rebase_to, verify_payloads)
    assets.setdefault('materialVariants', {})  # an index without variants can still receive them
    conflicts = [key for key, entry in staged.items()
                 if key in assets['materialVariants' if entry['variant'] else 'materials']]
    if conflicts:
        raise ValueError(f'Staged materials would replace current bindings: {conflicts}')
    for key, entry in staged.items():
        assets['materialVariants' if entry['variant'] else 'materials'][key] = entry['url']
    aliases = case_aliases([key for key, entry in staged.items() if not entry['variant']],
                           referenced_materials(definitions, assets), set(assets['materials']))
    for alias, key in aliases.items(): assets['materials'][alias] = staged[key]['url']
    assets['materials'] = dict(sorted(assets['materials'].items()))
    assets['materialVariants'] = dict(sorted(assets['materialVariants'].items()))

    # Every local dependency the preview index can reach must exist before it is written.
    referenced = [mesh['url'] for mesh in assets['meshes'].values()]
    referenced += [mesh['bodyMaskUrl'] for mesh in assets['meshes'].values() if 'bodyMaskUrl' in mesh]
    referenced += list(assets['materials'].values()) + list(assets['materialVariants'].values())
    if 'attachmentBody' in assets: referenced.append(assets['attachmentBody']['url'])
    if pairs is not None:
        for pair in pairs['items'].values():
            for side in ('head', 'body'):
                referenced.append(pair[side]['url'])
                referenced += [b['url'] for b in pair[side]['materials'].values() if b.get('url')]
    absent = sorted({url for url in referenced if not (output / url).resolve().is_file()})
    if absent: raise ValueError(f'Preview index references missing files: {absent}')

    output.mkdir(parents=True, exist_ok=True)
    (output / 'assets.json').write_text(json.dumps(assets, indent=2) + '\n', encoding='utf-8')
    if pairs is not None:
        (output / 'skin-pairs.json').write_text(json.dumps(pairs, indent=2) + '\n', encoding='utf-8')
    summary = {
        'formatVersion': 1,
        **identity(base, materials),
        'meaning': 'Preview index only. Bindings resolve to preserved files; fitting, combination behaviour '
                   'and visual acceptance are decided elsewhere.',
        'output': output.as_posix(),
        'counts': {'meshes': len(assets['meshes']), 'materials': len(assets['materials']),
                   'materialVariants': len(assets['materialVariants']),
                   'baseMaterials': len(original['materials']),
                   'baseMaterialVariants': len(original.get('materialVariants', {})),
                   'addedMaterials': sum(1 for e in staged.values() if not e['variant']),
                   'addedVariants': sum(1 for e in staged.values() if e['variant']),
                   'coverageMasks': sum(1 for m in assets['meshes'].values() if 'bodyMaskUrl' in m),
                   'skinPairs': len(pairs['items']) if pairs else 0,
                   'attachmentRestBones': len(assets.get('attachmentBody', {}).get('restBones', {})),
                   'caseAliases': len(aliases),
                   'checkedDependencies': len(set(referenced)) + len({p.as_posix() for p in dependencies})},
        'caseAliases': [{'referenced': alias, 'preservedPackage': key} for alias, key in sorted(aliases.items())],
        'rebasedUrls': dict(sorted(rebase.moved.items())),
        'added': sorted(({'key': key, 'itemId': e['itemId'], 'sourceInstance': e['sourceInstance'], 'url': e['url']}
                         for key, e in staged.items()), key=lambda e: e['itemId']),
    }
    (output / 'preview.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    counts = summary['counts']
    print(f'Preview index: {counts["meshes"]} meshes, {counts["materials"]} materials '
          f'(+{counts["addedMaterials"]}), {counts["materialVariants"]} variants, '
          f'{counts["coverageMasks"]} coverage masks, {counts["skinPairs"]} skin pairs, '
          f'{len(summary["rebasedUrls"])} rebased urls, {counts["checkedDependencies"]} dependencies checked')
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, required=True, help='Current runtime index folder to preserve')
    p.add_argument('--materials', type=Path, nargs='+', required=True, help='Validated material sets to add')
    p.add_argument('--exports', type=Path, nargs='+', required=True, help='Export folders holding probe-summary.json')
    p.add_argument('--output', type=Path, required=True, help='New sibling preview index folder')
    p.add_argument('--report', type=Path, help='Also write the preparation summary here')
    p.add_argument('--verify-payloads', action='store_true', help='Re-hash staged texture payloads')
    p.add_argument('--definitions', type=Path, default=Path('public/models/reconstructed-assembly-v2/customization.json'),
                   help='Source definitions used to recover case-only package spellings')
    a = p.parse_args()
    prepare(a.base, a.materials, a.exports, a.output, a.report, a.verify_payloads, a.definitions)
