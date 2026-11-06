"""Preview index for the Season 12 body-type review (6 Nov 2026).

Copies the active index (public/models/reconstructed-assemblies-v1/assets.json) and points the meshes that
morph-only-proof.py proved identical except for their morphs at the Season 12 rebuilds. Every other field and mesh
stays exactly as it is in the active index. The active index itself is only read.

  python -I scripts/body-types/build-preview-index.py ACTIVE_ASSETS_JSON PROOF_JSON REBUILT_DIR OUT_ASSETS_JSON \
      [CUSTOMIZATION_JSON] [--census MORPH_CENSUS_JSON] [--changed-only]

--changed-only repoints only the meshes whose morphs changed (and the body); a proven mesh with identical morphs keeps
its live URL, since the two GLBs are equal in everything the proof compares. That is the merge candidate.

With CUSTOMIZATION_JSON (reconstructed-assembly-v2/customization.json) a mesh is swapped only when every supported
item that can show it is proven whole (see item consistency below); without it, every proven mesh is swapped.

With --census (morph-census.mjs over the same active index; whole-catalogue refresh, 6 Nov 2026) the item rule looks
only at body-type meshes: the meshes that carry medium_male or medium_female. A mesh without either morph (statics,
most hairs) has the same shape in every Medium body type, and a mesh the active index does not hold is never shown, so
neither can make an item mixed. Without --census every mesh an item can show must be proven (stage 1 behaviour).

URLs are written relative to the directory the app requests the index from (models/reconstructed-assemblies-v1), since
the preview server answers that path with OUT_ASSETS_JSON. Refuses an existing output.

The source body keeps its live URL. The rig accepts a skin pair only on the preserved fitted body path
(models/reconstructed-meshes-v2/SK_Body_M.glb, LegacyBodyCoverage.ts), so the preview server answers that path with the
Season 12 body instead (serve-preview.mjs).
"""
import hashlib
import json
import os
import re
import sys
from pathlib import Path


OTHER_ARCHETYPES = ('Customization.Archetype.Light', 'Customization.Archetype.Heavy')


def item_meshes(definitions, catalog, supported):
    """Every mesh object path a supported item can show on Medium: its VisualParts meshes and the replacements of
    every TagOverride that can match there. Overrides that need the Light or Heavy archetype never apply on Medium."""
    result = {}
    path = lambda ref: (ref or {}).get('AssetPathName') or None
    for item in supported:
        found = set()
        for part in definitions.get(catalog.get(item, ''), {}).get('properties', {}).get('VisualParts', []) or []:
            found |= {p for p in (path(part.get('SkeletalMesh')), path(part.get('StaticMesh'))) if p}
            for override in part.get('TagOverrides', []) or []:
                if any(tag in OTHER_ARCHETYPES for tag in override.get('MatchingTags', [])):
                    continue
                found |= {p for p in (path(override.get('ReplacementSkeletalMesh')),
                                      path(override.get('ReplacementStaticMesh'))) if p}
        result[item] = found
    return result


BODY_TYPE_MORPHS = {'medium_male', 'medium_female'}
# Proof problems that break vertex correspondence between the live GLB and the S12 rebuild.
GEOMETRY_PROBLEM = re.compile(r'^(POSITION differs|primitive \d+ (indices differ|vertex count differs)'
                              r'|primitive count differs|morph names differ|not a single-mesh GLB)')


def body_type_meshes(census_json, index_meshes):
    """Object paths of the indexed meshes that carry a Medium body-type morph, from morph-census.mjs output. The census
    must describe exactly this index: the same meshes at the same URLs (a mesh merged or rebuilt since would otherwise
    be judged by another file's morphs)."""
    census = json.loads(Path(census_json).read_text(encoding='utf-8'))
    if any(row.get('missing') for row in census.values()):
        raise SystemExit('The census lists meshes whose files were missing; rerun it on a complete index')
    stale = sorted(k for k in set(census) | set(index_meshes)
                   if k not in census or k not in index_meshes or census[k]['url'] != index_meshes[k]['url'])
    if stale:
        raise SystemExit(f'The census does not describe this index ({len(stale)} meshes differ, e.g. {stale[:3]}); '
                         'rerun morph-census.mjs on it')
    return {source for source, row in census.items() if BODY_TYPE_MORPHS & set(row.get('morphs', []))}


def main(active_json, proof_json, rebuilt_dir, out_json, customization_json=None, census_json=None, changed_only=False):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active = Path(active_json)
    assets = json.loads(active.read_text(encoding='utf-8'))
    proof = json.loads(Path(proof_json).read_text(encoding='utf-8'))
    served_from = active.parent
    swapped, held = {}, {}
    proven = {row['source'] for row in proof.values() if row.get('status') == 'morph-only'}
    body = assets.get('attachmentBody', {}).get('source')
    # Item consistency (review-v1 short dress, 6 Nov 2026): a Season 12 undershirt under the dress's pre-S12 shell grew
    # its fuller S12 chest straight through the dress. So a garment mesh is swapped only when every supported item that
    # can show it has all its other meshes proven too. The body is exempt: every outfit stands on it, the preview server
    # always answers it with the Season 12 body, and the body under a garment is hidden by that garment's body mask.
    users = {}
    shaped = body_type_meshes(census_json, assets['meshes']) if census_json else None
    if customization_json:
        custom = json.loads(Path(customization_json).read_text(encoding='utf-8'))
        supported = json.loads((active.parent / 'supported-items.json').read_text(encoding='utf-8'))['items']
        for item, meshes in item_meshes(custom['definitions'], custom['catalog'], supported).items():
            if shaped is not None:
                meshes = meshes & shaped
            for mesh in meshes:
                users.setdefault(mesh, []).append((item, meshes))
    # What the preview shows as Season 12: the swapped meshes, plus proven meshes whose S12 morphs equal the live ones
    # (holding those changes nothing). A held mesh with changed morphs stays pre-S12, so holding it can make another
    # item mixed; iterate to the fixpoint.
    unchanged = {row['source'] for row in proof.values() if row.get('status') == 'morph-only' and not row['morphsChanged']}
    # A refused mesh always keeps its live GLB. When it keeps the same vertices (same positions, indices and morph names)
    # and none of its morph deltas changed in Season 12, the live GLB already carries the S12 body-type shape, so it
    # cannot make an item mixed. Season 12 changed something else about it (weights, UVs, bones), which the item refresh
    # route handles; that is not a body-type inconsistency. (Every multi-primitive mesh, live and rebuilt, shares one
    # vertex buffer and one set of morph targets, so the proof's primitive-0 morph comparison covers all primitives.)
    kept = {row['source'] for row in proof.values() if row.get('status') == 'refused' and not row['morphsChanged']
            and not any(GEOMETRY_PROBLEM.match(p) for p in row['problems'])}
    effective = set(proven) | kept
    while True:
        held = {}
        for source in sorted(proven - {body}):
            # Only OTHER meshes count: once held, a mesh is itself pre-S12, and counting it would make every item that
            # shows it "mixed" and name those as the reason (6 Nov 2026, loose jeans). The swap set is the same either
            # way, since the effective set only shrinks; the recorded reasons are the root ones.
            mixed = sorted({item for item, meshes in users.get(source, [])
                            if any(m not in effective and m != body and m != source for m in meshes)})
            if mixed:
                held[source] = {'reason': 'an item that shows it also shows a mesh the preview keeps pre-S12',
                                'items': mixed[:20], 'itemCount': len(mixed)}
        settled = (proven - {s for s in held if s not in unchanged}) | kept
        if settled == effective:
            break
        effective = settled
    for name, row in sorted(proof.items()):
        if row.get('status') != 'morph-only' or row['source'] in held:
            continue
        if changed_only and not row['morphsChanged'] and row['source'] != body:
            # Identical to the live GLB in everything the proof compares, morphs included: repointing it changes
            # nothing on screen and only adds files to publish. (It still counts as Season 12 above.)
            continue
        entry = assets['meshes'][row['source']]
        if entry['url'] != row['liveUrl']:
            raise SystemExit(f'{name}: the active index moved since the proof ({entry["url"]} vs {row["liveUrl"]})')
        glb = Path(rebuilt_dir) / f'{name}.glb'
        sha = hashlib.sha256(glb.read_bytes()).hexdigest()
        if assets.get('attachmentBody', {}).get('source') == row['source']:
            # Same URL; the preview server answers it with the rebuilt body.
            swapped[row['source']] = {'from': entry['url'], 'to': entry['url'], 'servedFrom': glb.as_posix(),
                                      'morphsChanged': row['morphsChanged']}
            entry['sha256'] = assets['attachmentBody']['sha256'] = sha
            continue
        url = Path(os.path.relpath(glb, served_from)).as_posix()
        swapped[row['source']] = {'from': entry['url'], 'to': url, 'morphsChanged': row['morphsChanged']}
        entry['url'], entry['sha256'] = url, sha
    assets['s12BodyTypePreview'] = {
        'note': 'Preview only: meshes proven morph-only against the active index, rebuilt from the Season 12 paks.',
        'activeIndexSha256': hashlib.sha256(active.read_bytes()).hexdigest(),
        'itemConsistency': bool(customization_json),
        **({'bodyTypeMeshesOnly': True, 'censusSha256': hashlib.sha256(Path(census_json).read_bytes()).hexdigest()}
           if census_json else {}),
        'changedOnly': changed_only,
        'swapped': swapped, 'held': held,
        'keptUnchanged': sorted(kept),
        'effective': sorted(effective)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(assets, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'swapped': len(swapped), 'held': {k.rsplit('.', 1)[-1]: v['itemCount'] for k, v in held.items()},
                      'out': str(out)}))


if __name__ == '__main__':
    argv = sys.argv[1:]
    census = None
    if '--census' in argv:
        i = argv.index('--census')
        census = argv[i + 1]
        del argv[i:i + 2]
    changed = '--changed-only' in argv
    if changed:
        argv.remove('--changed-only')
    main(*argv[:5], census_json=census, changed_only=changed)
