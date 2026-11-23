"""Preview index for the Season 12 body-type review (6 Nov 2026).

Copies the active index (public/models/reconstructed-assemblies-v1/assets.json) and points the meshes that
morph-only-proof.py proved identical except for their morphs at the Season 12 rebuilds. Every other field and mesh
stays exactly as it is in the active index. The active index itself is only read.

  python -I scripts/body-types/build-preview-index.py ACTIVE_ASSETS_JSON PROOF_JSON REBUILT_DIR OUT_ASSETS_JSON \
      [CUSTOMIZATION_JSON] [--census MORPH_CENSUS_JSON] [--changed-only] \
      [--admit SKIN_PROOF_JSON [--admit-only NAME,...] [--admit-reviewed NAME,...]]

--changed-only repoints only the meshes whose morphs changed (and the body); a proven mesh with identical morphs keeps
its live URL, since the two GLBs are equal in everything the proof compares. That is the merge candidate.

--admit (S12 item refresh tier 1, 12 Nov 2026) adds refused meshes that skin-by-name-proof.py judged: the "re-encoded"
ones (the rig renders them like a morph-only swap), or only those in --admit-only, plus any other tier-1 class named in
--admit-reviewed after a review. An admitted mesh counts as proven, so the item rule and its fixpoint run unchanged and
the morph-only meshes it was holding cascade in. It is always repointed (never skipped by --changed-only), and the
index records its class and hashes.

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


def glb_slots(path):
    """Source slot names of a GLB's materials (gzip-wrapped or plain). A file that is not a GLB has none."""
    import gzip
    import struct
    b = Path(path).read_bytes()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    if len(b) < 20 or struct.unpack('<I', b[:4])[0] != 0x46546C67:
        return set()
    doc = json.loads(b[20:20 + struct.unpack('<I', b[12:16])[0]])
    return {(m.get('extras', {}).get('sourceSlot') or {}).get('MaterialSlotName') for m in doc.get('materials', [])} - {None}


def carries_masks(assets, source):
    """Does the index name geometry-derived masks for this mesh (a body mask, or an item mask naming it)?"""
    entry = assets['meshes'][source]
    return bool(entry.get('bodyMaskUrl') or entry.get('bodyMaskUvTiles')) or any(
        source in meshes for meshes in assets.get('itemBodyMasks', {}).values())


def load_mask_proof(mask_json):
    """{name: row} from one or more mask-proof.py outputs (comma-separated)."""
    rows = {}
    for f in mask_json.split(','):
        for name, row in json.loads(Path(f).read_text(encoding='utf-8'))['meshes'].items():
            if name in rows:
                raise SystemExit(f'{name}: in two mask proofs')
            rows[name] = row
    return rows


def admitted_meshes(admit_json, admit_only, admit_reviewed, proof, assets, served_from, rebuilt_dir, surface_json=None,
                    admit_rework=None, mask_rows=None, ship_masks=None):
    """{source: admission} from skin-by-name-proof.py output (S12 item refresh tier 1, 12 Nov 2026).

    Every admissible ("re-encoded") mesh is admitted, or only those named in admit_only. A mesh of any other tier-1
    class (weights, normals, morph set, extension bones) is admitted only when named in admit_reviewed, after a review;
    a surface or loader refusal never is. The live GLB and the rebuild must still be the files the skin proof judged.

    With surface_json (surface-match-proof.py output, tier 2, 22 Nov 2026), a "surface differs" mesh the surface proof
    judged "permuted" (the same triangles in another vertex order, nothing else changed) is admissible too, and a
    permuted mesh with tier-1 kinds (permuted+weights, ...) only by name after review. A reworked surface never is:
    its geometry-derived data (body mask, item masks) would be stale."""
    if not admit_json:
        if admit_only or admit_reviewed or surface_json or admit_rework:
            raise SystemExit('--admit-only/--admit-reviewed/--admit-surface/--admit-rework need --admit SKIN_PROOF_JSON')
        return {}
    if admit_rework and not surface_json:
        raise SystemExit('--admit-rework needs --admit-surface SURFACE_PROOF_JSON')
    skin = json.loads(Path(admit_json).read_text(encoding='utf-8'))['meshes']
    surface = json.loads(Path(surface_json).read_text(encoding='utf-8'))['meshes'] if surface_json else {}
    for name, r in surface.items():
        s = skin.get(name)
        if s is None or s['class'] != 'surface differs':
            raise SystemExit(f'{name}: the surface proof judged it, but the skin proof does not call it "surface differs"')
        if s['liveSha256'] != r['liveSha256'] or s['s12Sha256'] != r['s12Sha256'] or s['source'] != r['source']:
            raise SystemExit(f'{name}: the surface proof and the skin proof judged different files')
        if r['class'].startswith('permuted'):
            # The surface proof's verdict replaces "surface differs"; the rest of the row (hashes, source) is the same.
            skin[name] = {**s, **{k: v for k, v in r.items() if k not in ('notPermuted',)}, 'surfaceProof': True}
    for name in sorted(admit_rework or []):
        # A reworked surface whose live textures still fit (surface proof "same UVs") and that carries NO geometry-derived
        # data: no per-mesh body mask and no item mask naming it. Then only the GLB changes, as for a permuted mesh, and
        # the change is reviewed by eye. Anything with a mask needs the masks re-derived first (batch B).
        r = surface.get(name)
        if r is None or not r['class'].startswith('reworked: same UVs'):
            raise SystemExit(f'{name}: --admit-rework needs a surface-proof "reworked: same UVs" row, not '
                             f'{r["class"] if r else "none"}')
        if carries_masks(assets, r['source']) and mask_rows is None:
            # Without a mask proof, anything with a mask needs the masks re-derived first (batch B).
            raise SystemExit(f'{name}: it carries a body mask or an item mask; re-derive them before admitting it')
        skin[name] = {**skin[name], **{k: v for k, v in r.items() if k not in ('notPermuted',)}, 'surfaceProof': True,
                      'class': r['class'], 'admissible': False}
    reviewed = set(admit_reviewed or []) | set(admit_rework or [])
    names = (set(admit_only) if admit_only is not None
             else {n for n, r in skin.items() if r.get('admissible')}) | reviewed
    admitted = {}
    for name in sorted(names):
        r = skin.get(name)
        if r is None:
            raise SystemExit(f'{name}: not in the skin proof')
        if r['class'] in ('surface differs', 'loader refuses') or (r['class'].startswith('reworked')
                                                                  and name not in set(admit_rework or [])):
            raise SystemExit(f'{name}: {r["class"]}; it is not a GLB swap')
        if not r.get('admissible') and name not in reviewed:
            raise SystemExit(f'{name} is "{r["class"]}": admit it only by name after review (--admit-reviewed)')
        if proof.get(name, {}).get('status') != 'refused' or proof[name]['source'] != r['source']:
            raise SystemExit(f'{name}: the morph-only proof does not list it as refused')
        entry = assets['meshes'][r['source']]
        if entry['url'] != r['liveUrl'] or hashlib.sha256((served_from / entry['url']).read_bytes()).hexdigest() != r['liveSha256']:
            raise SystemExit(f'{name}: the live mesh changed since the skin proof')
        if hashlib.sha256((Path(rebuilt_dir) / f'{name}.glb').read_bytes()).hexdigest() != r['s12Sha256']:
            raise SystemExit(f'{name}: the rebuild changed since the skin proof')
        unbound = glb_slots(Path(rebuilt_dir) / f'{name}.glb') - {s.get('slot') for s in entry.get('slots', [])}
        if unbound:
            # The viewer binds materials by slot name and throws on a slot the index does not list (22 Nov 2026,
            # SK_Military_CombatPants_M's new "CombatPants_Cloth").
            raise SystemExit(f'{name}: the rebuild has material slots the index does not bind: {sorted(unbound)}')
        if mask_rows is not None and not r.get('admissible') and carries_masks(assets, r['source']):
            # Tier 2, 23 Nov 2026: changed weights, normals or surface can change a mask derived in the idle pose. With a
            # mask proof, a reviewed mesh that carries masks is admitted only when every one of them regenerates
            # unchanged from the S12 mesh, or only its body mask changed and the S12 one ships (--ship-s12-masks).
            m = mask_rows.get(name)
            if m is None or m['source'] != r['source']:
                raise SystemExit(f'{name}: it carries masks and the mask proof does not judge it')
            if (m['liveSha256'], m['s12Sha256']) != (r['liveSha256'], r['s12Sha256']):
                raise SystemExit(f'{name}: the mask proof regenerated other files than the skin proof judged')
            if not (m['status'] == 'unchanged' or (m['status'] == 'body-changed' and name in (ship_masks or {}))):
                raise SystemExit(f"{name}: mask proof says {m['status']}: {'; '.join(m.get('reasons', []))}")
        admitted[r['source']] = {'name': name, 'class': r['class'], 'by': 'proof' if r.get('admissible') else 'review',
                                 **({'proof': 'surface-match'} if r.get('surfaceProof') else {}),
                                 **({'masks': mask_rows[name]['status']} if mask_rows and name in mask_rows
                                    and carries_masks(assets, r['source']) else {}),
                                 'liveSha256': r['liveSha256'], 's12Sha256': r['s12Sha256'],
                                 'morphsChanged': r.get('morphsChanged', {}),
                                 **{k: r[k] for k in ('morphsAdded', 'morphsRemoved') if k in r}}
    return admitted


def stale_packages(package_json, proof):
    """Sources whose Season 12 package is not proven byte-identical on the installed build (tier 2, 23 Nov 2026).

    The rebuilds come from the 6 Nov read of the 12.00 build; the game updated on 17 Nov, and a fresh read needs a
    mapping for the new build. A package whose bytes are unchanged (`package-proof-*.json`, from the probe's
    `package-hashes` mode against the 6 Nov `assets` run) still describes today's game. Any other mesh, a mesh missing
    from the proof included, is never repointed (coordinator, 22 Nov). For the item rule it counts as Season 12 only
    when its live file already carries the 12.00 body-type shape (see `main`)."""
    rows = json.loads(Path(package_json).read_text(encoding='utf-8'))['all']
    identical = {row['mesh'] for row in rows if row.get('identical')}
    return {row['source'] for name, row in proof.items() if name not in identical}


def settle(proven, kept, unchanged, users, body):
    """The item rule to its fixpoint: (effective S12 set, held {source: reason}).

    A proven mesh is held when an item that shows it also shows a mesh outside the effective set; a held mesh with
    changed morphs leaves the effective set, which can hold others."""
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
            return effective, held
        effective = settled


def main(active_json, proof_json, rebuilt_dir, out_json, customization_json=None, census_json=None, changed_only=False,
         admit_json=None, admit_only=None, admit_reviewed=None, surface_json=None, admit_rework=None, package_json=None,
         mask_json=None, ship_masks=None):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active = Path(active_json)
    assets = json.loads(active.read_text(encoding='utf-8'))
    proof = json.loads(Path(proof_json).read_text(encoding='utf-8'))
    served_from = active.parent
    swapped, held, mask_repoints = {}, {}, {}
    mask_rows = load_mask_proof(mask_json) if mask_json else None
    ship_masks = dict(ship_masks or {})
    if ship_masks and mask_rows is None:
        raise SystemExit('--ship-s12-masks needs --mask-proof')
    admitted = admitted_meshes(admit_json, admit_only, admit_reviewed, proof, assets, served_from, rebuilt_dir,
                               surface_json, admit_rework, mask_rows, ship_masks)
    stale = stale_packages(package_json, proof) if package_json else set()
    admitted = {source: row for source, row in admitted.items() if source not in stale}
    proven = ({row['source'] for row in proof.values() if row.get('status') == 'morph-only'} | set(admitted)) - stale
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
    # An admitted mesh is always repointed when the item rule allows: it is never "kept" on its live GLB, and never
    # "unchanged" (a morph-set change leaves morphsChanged empty, so the morph proof cannot speak for it).
    kept -= set(admitted)
    # A stale package (changed since the 6 Nov read) is never repointed. Its live file already has the 12.00 body-type
    # shape when its morphs equal the read's, so it is as consistent with its item partners as before: keep it. With
    # changed morphs it is a pre-S12 mesh and holds them (tier 2, 23 Nov 2026).
    kept |= stale & unchanged
    assert not set(admitted) & unchanged
    effective, held = settle(proven, kept, unchanged, users, body)
    for name, row in sorted(proof.items()):
        admission = admitted.get(row.get('source'))
        if (row.get('status') != 'morph-only' and not admission) or row['source'] in held or row['source'] in stale:
            continue
        if changed_only and not admission and not row['morphsChanged'] and row['source'] != body:
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
        swapped[row['source']] = {'from': entry['url'], 'to': url,
                                  **({'morphsChanged': admission['morphsChanged'],
                                      'admitted': {k: admission[k] for k in ('class', 'by')}} if admission
                                     else {'morphsChanged': row['morphsChanged']})}
        entry['url'], entry['sha256'] = url, sha
        if name in ship_masks:
            m = mask_rows[name]
            if m['status'] != 'body-changed':
                raise SystemExit(f"{name}: --ship-s12-masks needs a mask proof 'body-changed' row, not {m['status']}")
            mask_repoints[row['source']] = {'from': entry['bodyMaskUrl'], 'to': ship_masks[name],
                                            'sha256': m['s12BodyMask']['sha256'], 'file': m['s12BodyMask']['file']}
            entry['bodyMaskUrl'] = ship_masks[name]
    # A mesh already on its S12 file (an earlier batch applied it) keeps its GLB; only its body mask moves, and only
    # when the mask proof regenerated the mask from exactly that file (tier 2, 23 Nov 2026: batch A went live first).
    for n in sorted(ship_masks):
        m = (mask_rows or {}).get(n)
        if m is None or m['source'] in mask_repoints:
            continue
        entry = assets['meshes'][m['source']]
        body = next((x for x in m.get('masks', []) if x['kind'] == 'body'), None)
        if m['status'] != 'body-changed' or entry.get('sha256') != m['s12Sha256'] or body is None \
                or entry.get('bodyMaskUrl') != body['url']:
            continue
        mask_repoints[m['source']] = {'from': entry['bodyMaskUrl'], 'to': ship_masks[n], 'sha256': m['s12BodyMask']['sha256'],
                                      'file': m['s12BodyMask']['file'], 'maskOnly': True, 'meshSha256': entry['sha256']}
        entry['bodyMaskUrl'] = ship_masks[n]
    unshipped = {n for n in ship_masks if mask_rows.get(n, {}).get('source') not in mask_repoints}
    if unshipped:
        raise SystemExit(f'--ship-s12-masks names meshes that are not repointed: {sorted(unshipped)}')
    assets['s12BodyTypePreview'] = {
        'note': 'Preview only: meshes proven morph-only against the active index, rebuilt from the Season 12 paks.',
        'activeIndexSha256': hashlib.sha256(active.read_bytes()).hexdigest(),
        'itemConsistency': bool(customization_json),
        **({'bodyTypeMeshesOnly': True, 'censusSha256': hashlib.sha256(Path(census_json).read_bytes()).hexdigest()}
           if census_json else {}),
        'changedOnly': changed_only,
        **({'admitted': admitted, 'skinProofSha256': hashlib.sha256(Path(admit_json).read_bytes()).hexdigest()}
           if admit_json else {}),
        **({'surfaceProofSha256': hashlib.sha256(Path(surface_json).read_bytes()).hexdigest()} if surface_json else {}),
        **({'packageProofSha256': hashlib.sha256(Path(package_json).read_bytes()).hexdigest(),
            'stalePackages': sorted(stale)} if package_json else {}),
        **({'maskProofSha256': {f: hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in mask_json.split(',')},
            'maskRepoints': mask_repoints} if mask_json else {}),
        'swapped': swapped, 'held': held,
        'keptUnchanged': sorted(kept),
        'effective': sorted(effective)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(assets, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'swapped': len(swapped), 'stale': len(stale), 'held': {k.rsplit('.', 1)[-1]: v['itemCount'] for k, v in held.items()},
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
    options = {}
    for flag, key, split in (('--admit', 'admit_json', False), ('--admit-only', 'admit_only', True),
                             ('--admit-reviewed', 'admit_reviewed', True), ('--admit-surface', 'surface_json', False),
                             ('--admit-rework', 'admit_rework', True), ('--package-proof', 'package_json', False),
                             ('--mask-proof', 'mask_json', False), ('--ship-s12-masks', 'ship_masks', True)):
        if flag in argv:
            i = argv.index(flag)
            options[key] = argv[i + 1].split(',') if split else argv[i + 1]
            del argv[i:i + 2]
    if 'ship_masks' in options:
        options['ship_masks'] = dict(pair.split('=', 1) for pair in options['ship_masks'])
    main(*argv[:5], census_json=census, changed_only=changed, **options)
