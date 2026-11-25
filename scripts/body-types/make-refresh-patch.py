"""Refresh patch for batch C (Season 12 item refresh, 25 Nov 2026): repoint garment meshes, their body masks and the
material instances they draw, pinned to the active index, for apply-merge-patch.py --garments-only.

  python -X utf8 -I scripts/body-types/make-refresh-patch.py ACTIVE_DIR SPEC_JSON OUT_PATCH_JSON

SPEC_JSON names only the targets; every "from" value and every sha256 is read here:

  {"note": "...",
   "meshes": {"/Game/.../SK_X_M.SK_X_M": {"toUrl": "../folder/SK_X_M.glb",
                                          "bodyMask": {"toUrl": "../folder/SK_X_M.bodymask.png"}}},
   "materials": {"/Game/.../MI_X.MI_X": {"toUrl": "../folder/x.json"}},
   "reboundMaterialsFrom": "public/models/<batch>-preview-v1/preview.json"}

"reboundMaterialsFrom" takes every material an attached batch rebound (prepare-attached-batch.py index with
rebindKeptMaterials: preview.json "reboundMaterials"), each of whose "from" must be the live entry; its "to" is resolved
from the preview folder. URLs resolve from ACTIVE_DIR, as the index's own do, and every target file must already be
there: stage the new files first.

Refused: an unknown spec key; the body; a mesh or material the index does not hold (a refresh never adds one); a target
that is the live URL or that any live entry already references (a refresh target is always a new file); a GLB whose
material slots differ from the live entry's (the apply keeps the entry's slots); a material instance with parameter
variants (as apply-merge-patch.py refuses it); a material whose shader or texture files are missing.

Writes three files and refuses an existing one; the inputs are only read:
- OUT_PATCH_JSON: the patch;
- <stem>.expected.json: the sha256 apply-merge-patch.py --garments-only will write, from the same code path (its apply()
  run here in memory), with the counts;
- <stem>.publish.txt: every file the patched index newly references (GLBs, masks, and each material's JSON, shader,
  coverage shader and textures, as ReconstructedMaterial.ts loads them), relative to the working directory.
"""
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location('apply_merge_patch', Path(__file__).resolve().parent / 'apply-merge-patch.py')
applier = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(applier)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def target(active_dir, url, what):
    path = active_dir / url
    if not path.is_file():
        raise SystemExit(f'{what}: {path} is not in place')
    return sha(path)


def glb_slots(path):
    """The GLB's material slots as the index records them (prepare-accessory-defaults.py glb_slots)."""
    data = Path(path).read_bytes()
    size = int.from_bytes(data[12:16], 'little')
    return [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
            for m in json.loads(data[20:20 + size])['materials']]


def live_references(assets):
    """Every URL the live index names (meshes, masks, materials, variants, the attachment body)."""
    urls = {m['url'] for m in assets['meshes'].values()} | {m['bodyMaskUrl'] for m in assets['meshes'].values() if 'bodyMaskUrl' in m}
    urls |= set(assets.get('materials', {}).values()) | set(assets.get('materialVariants', {}).values())
    if 'attachmentBody' in assets:
        urls.add(assets['attachmentBody']['url'])
    return urls


def material_files(path):
    """A material manifest and the files ReconstructedMaterial.ts fetches beside it: shader, coverageShader, textures."""
    manifest = json.loads(path.read_text(encoding='utf-8'))
    files = [path] + [path.parent / manifest[k] for k in ('shader', 'coverageShader') if manifest.get(k)]
    files += [path.parent / t['file'] for t in manifest.get('textures', [])]
    missing = [str(f) for f in files if not f.is_file()]
    if missing:
        raise SystemExit(f'{path}: its files are not in place: {missing}')
    return files


def shown(path):
    """A publish-list line: relative to the working directory, or absolute when it is on another drive."""
    try:
        return Path(os.path.relpath(path.resolve(), Path.cwd().resolve())).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def rebound(active_dir, preview_json, live):
    """{source: toUrl} from an attached batch's preview.json, each "from" checked against the live entry. The runner
    records "from" as the active index's own URL and "to" relative to the preview folder (stage_index)."""
    preview_json = Path(preview_json)
    rows = json.loads(preview_json.read_text(encoding='utf-8')).get('reboundMaterials')
    if not rows:
        raise SystemExit(f'{preview_json} rebound no material')
    out = {}
    for source, row in rows.items():
        if live.get(source) is None or live[source] != row['from']:
            raise SystemExit(f'{source}: the batch rebound it from {row["from"]}, not from the live entry {live.get(source)}')
        out[source] = {'toUrl': Path(os.path.relpath((preview_json.parent / row['to']).resolve(), active_dir.resolve())).as_posix()}
    return out


def main(active_dir, spec_json, out_json):
    active_dir, out = Path(active_dir), Path(out_json)
    expected_path, publish_path = out.with_suffix('.expected.json'), out.with_suffix('.publish.txt')
    for path in (out, expected_path, publish_path):
        if path.exists():
            raise SystemExit(f'Preserve existing {path}')
    assets_path = active_dir / 'assets.json'
    assets = json.loads(assets_path.read_text(encoding='utf-8'))
    spec = json.loads(Path(spec_json).read_text(encoding='utf-8'))
    unknown = set(spec) - {'note', 'meshes', 'materials', 'reboundMaterialsFrom'}
    if unknown:
        raise SystemExit(f'Unknown spec keys {sorted(unknown)}')
    live = assets.get('materials', {})
    wanted_materials = dict(spec.get('materials', {}))
    if spec.get('reboundMaterialsFrom'):
        imported = rebound(active_dir, spec['reboundMaterialsFrom'], live)
        both = sorted(set(imported) & set(wanted_materials))
        if both:
            raise SystemExit(f'Named twice (materials and reboundMaterialsFrom): {both}')
        wanted_materials.update(imported)
    taken = live_references(assets)

    def new_target(url, what):
        if url in taken:
            raise SystemExit(f'{what}: {url} is already referenced by a live entry; a refresh target is a new file')
        return target(active_dir, url, what)

    body = assets['attachmentBody']
    meshes, publish = {}, []
    for source, want in sorted(spec.get('meshes', {}).items()):
        entry = assets['meshes'].get(source)
        if entry is None:
            raise SystemExit(f'{source}: not in the active index (a refresh never adds a mesh)')
        if source == body['source']:
            raise SystemExit('The body is never part of a garment refresh')
        if want['toUrl'] == entry['url']:
            raise SystemExit(f'{source}: toUrl is the live URL; never overwrite a live file')
        change = {'fromUrl': entry['url'], 'toUrl': want['toUrl'], 'fromSha256': entry['sha256'],
                  'toSha256': new_target(want['toUrl'], source)}
        if 'slots' in entry and glb_slots(active_dir / want['toUrl']) != entry['slots']:
            raise SystemExit(f'{source}: the new GLB\'s material slots differ from the live entry\'s')
        publish.append(active_dir / want['toUrl'])
        if 'bodyMask' in want:
            if not entry.get('bodyMaskUrl'):
                raise SystemExit(f'{source}: has no body mask to repoint')
            change['bodyMask'] = {'fromUrl': entry['bodyMaskUrl'], 'toUrl': want['bodyMask']['toUrl'],
                                  'toSha256': new_target(want['bodyMask']['toUrl'], source + ' mask')}
            publish.append(active_dir / want['bodyMask']['toUrl'])
        meshes[source] = change
    variant_recipients = {json.loads(k)[0] for k in assets.get('materialVariants', {})}
    materials = {}
    for source, want in sorted(wanted_materials.items()):
        if live.get(source) is None:
            raise SystemExit(f'{source}: no live material (a refresh never adds one)')
        if source in variant_recipients:
            raise SystemExit(f'{source}: has material variants, which a refresh does not rebuild')
        if want['toUrl'] == live[source]:
            raise SystemExit(f'{source}: toUrl is the live URL')
        materials[source] = {'fromUrl': live[source], 'toUrl': want['toUrl'],
                             'toSha256': new_target(want['toUrl'], source)}
        publish += material_files(active_dir / want['toUrl'])
    patch = {
        'note': spec.get('note', '') + ' Apply with scripts/body-types/apply-merge-patch.py --garments-only, only to '
                'the active index whose sha256 is activeIndexSha256.',
        'activeIndexSha256': sha(assets_path),
        'activeSkinPairsSha256': sha(active_dir / 'skin-pairs.json'),
        'body': {'source': body['source'], 'url': body['url'], 'fromSha256': body['sha256'], 'toSha256': body['sha256']},
        'meshes': meshes,
        'materials': materials}
    # The expected result comes from the apply itself, in memory, so it is exactly what the apply will write.
    assets_bytes, pairs_bytes, counts = applier.apply(patch, active_dir)
    files = sorted({shown(p) for p in publish})
    expected = {'patch': out.name, 'patchSha256': None, 'activeIndexSha256': patch['activeIndexSha256'],
                'expectedAssetsSha256': hashlib.sha256(assets_bytes).hexdigest(),
                'skinPairsSha256': hashlib.sha256(pairs_bytes).hexdigest(), **counts,
                'publishList': publish_path.name, 'publishFiles': len(files),
                'publishBytes': sum(Path(f).stat().st_size for f in files)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(patch, indent=1) + '\n', encoding='utf-8')
    expected['patchSha256'] = sha(out)
    expected_path.write_text(json.dumps(expected, indent=1) + '\n', encoding='utf-8')
    publish_path.write_text(''.join(f + '\n' for f in files), encoding='utf-8')
    print(json.dumps({'meshes': len(meshes), 'bodyMasks': sum('bodyMask' in m for m in meshes.values()),
                      'materials': len(materials), 'expectedAssetsSha256': expected['expectedAssetsSha256'],
                      'publishFiles': len(files), 'publishBytes': expected['publishBytes'], 'out': str(out)}))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:4])
