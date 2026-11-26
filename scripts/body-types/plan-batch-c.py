"""Batch C plan (Season 12 item refresh, tier 2 onward, 24 Nov 2026): which meshes to read and rebuild, in what order,
and what each wave unlocks under the item rule.

Batch C is the meshes whose Season 12 rebuild changed the texture layout (UVs changed, UV sets differ, UV1 changed,
UV0 tile shifts, a new material slot, or geometry moved too far to judge), so the live textures no longer fit: each
item showing one needs its 17 Nov material instances and textures read and rebuilt as well as the mesh swapped. The
plan also covers the meshes that hold the 37-mesh shared-item cluster (stale 6 Nov packages, meshes never read for
Season 12) because a fresh 17 Nov read is now possible (patched usmap v1, f36b7c4f).

It mirrors build-preview-index.py on the active index: the same sets (admitted, stale packages, kept, unchanged), the
same item rule (`settle`), checked against a builder run's recorded `effective` set. A wave's meshes are assumed to
pass every proof and review, so its unlock counts are upper bounds.

  python -X utf8 -I scripts/body-types/plan-batch-c.py --active ASSETS_JSON --custom CUSTOMIZATION_JSON \
      --census MORPH_CENSUS_JSON --morph MORPH_ONLY_PROOF_JSON --surface SURFACE_PROOF_JSON \
      --builder BUILDER_INDEX_JSON --mask-proof MASK_PROOF_JSON[,...] --view-lanes VIEW_LAYOUT_JSON [--followups LIGHT_FOLLOWUPS_TSV] \
      [--nov17-proof PROOF1_PRIME_TSV] [--hold NAME=REASON ...] --out OUT_DIR

Writes OUT_DIR/plan.json, rows.tsv (one row per planned mesh) and items.tsv (each item, the wave that makes it
Season 12 throughout, and the wave that also makes it current with the 17 Nov build). Wave U lists the stale packages
the item rule counts as Season 12 that no 17 Nov read has proven current (--nov17-proof: 'pass' rows).
Read-only on every input; refuses an existing OUT_DIR.
"""
import argparse
import collections
import csv
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_preview_index', HERE / 'build-preview-index.py')
bpi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bpi)

BATCH_C = ('reworked: UVs changed', 'reworked: UV sets differ', 'reworked: UV1+', 'reworked: UV0 tile',
           'reworked: geometry moved too far')
FIRST = 'SK_Casual_BasicTshirt_M'   # the starting outfit's T-shirt (coordinator, 23 Nov: first)
LAYERED_ROOTS = ('M_Character_8Layers_Master', 'M_Character_Layered', 'M_Character_8Layers_AnimatedPattern_Master',
                 'M_CharacterLayered_TeamColor_01', 'M_Character_LeopardPrint')
# View constant-buffer lanes the 17 Nov layout (C838D617) does not requalify (scripts/shader-probe/view_layout.py):
# a material whose registry contract pins one is refused until it is requalified.
VIEW_PIN = re.compile(r'cb0\[(\d+)\]')
WAVE_MIS = 100   # material instances per read wave after the first two


def name_of(source):
    return source.rsplit('/', 1)[-1].split('.')[0]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def component(seeds, by_item, effective, body):
    """Every mesh outside the effective set linked to the seeds through items that show both (the shared-item
    cluster): the meshes that must all be Season 12 before any seed can be repointed."""
    users = collections.defaultdict(set)
    for item, meshes in by_item.items():
        for m in meshes:
            users[m].add(item)
    seen, todo = set(seeds), list(seeds)
    while todo:
        m = todo.pop()
        for item in users.get(m, ()):
            for other in by_item[item]:
                if other not in effective and other != body and other not in seen:
                    seen.add(other)
                    todo.append(other)
    return seen


def current_items(s12_items, by_item, unproven):
    """Season 12 items that show no mesh changed by the 17 Nov update and not yet proven current."""
    return {i for i in s12_items if not (by_item[i] & unproven)}


class Rule:
    """build-preview-index.py's sets and item rule on one index, for any set of meshes a wave adds."""

    def __init__(self, proof, admitted, stale, users, body, by_item, held=frozenset()):
        self.morph_only = {r['source'] for r in proof.values() if r.get('status') == 'morph-only'}
        self.unchanged = {r['source'] for r in proof.values()
                          if r.get('status') == 'morph-only' and not r['morphsChanged']}
        self.kept = {r['source'] for r in proof.values() if r.get('status') == 'refused' and not r['morphsChanged']
                     and not any(bpi.GEOMETRY_PROBLEM.match(p) for p in r['problems'])}
        # A held mesh (--hold) is never admitted, even when an admission list names it (a review-admitted mesh held
        # after a later review, 26 Nov): it stays live, and the item rule holds every item that shows it.
        self.held = set(held)
        self.admitted, self.stale, self.users, self.body, self.by_item = (set(admitted) - self.held, set(stale), users,
                                                                          body, by_item)

    def settle(self, added=frozenset()):
        """(effective, held) when the meshes in `added` are read fresh and pass (a stale package re-read is current)."""
        admitted = self.admitted | (set(added) - self.held)
        stale = self.stale - set(added)
        admitted -= stale
        proven = (self.morph_only | admitted) - stale
        kept = (self.kept - admitted) | (stale & self.unchanged)
        return bpi.settle(proven, kept, self.unchanged, self.users, self.body)

    def items(self, added=frozenset()):
        effective, _ = self.settle(added)
        return {item for item, meshes in self.by_item.items() if meshes <= effective}


def material_scope(supported_ready, models_dir, meshes, requalified):
    """Per mesh name: items (ready parts), material instances, garment textures (shared library textures excluded),
    material roots and View-lane flags, from the live material JSONs."""
    out = {n: {'items': set(), 'mis': set(), 'textures': set(), 'roots': collections.Counter(), 'view': set()}
           for n in meshes}
    cache = {}
    for item in supported_ready:
        for part in item.get('parts', []):
            n = name_of(part.get('sourceMesh', ''))
            if n not in out:
                continue
            row = out[n]
            row['items'].add(item['id'])
            for material in (part.get('materials') or {}).values():
                row['mis'].add(material.get('source'))
                url = material.get('url')
                if not url:
                    row['roots']['(no material file)'] += 1
                    continue
                f = os.path.normpath(models_dir / url)
                if f not in cache:
                    cache[f] = json.loads(Path(f).read_text(encoding='utf-8')) if os.path.exists(f) else {}
                j = cache[f]
                # Files from the first material waves (reconstructed-materials-batch-01, -assembly-02) record no root.
                row['roots'][j.get('sourceRoot') or j.get('genericRoot') and 'generic' or '(no root recorded)'] += 1
                for t in j.get('textures', []):
                    s = t.get('source', '')
                    if '/Global/' not in s and 'MaterialLibrary' not in s:
                        row['textures'].add(s)
                pinned = {int(x) for k, v in j.items() if k.startswith('attachment') for x in VIEW_PIN.findall(json.dumps(v))}
                if pinned - requalified:
                    row['view'].add('pins a View lane C838D617 does not requalify: ' + ','.join(map(str, sorted(pinned - requalified))))
                elif j.get('requiredViewFields') or j.get('viewPolicy') or j.get('hologramProgram'):
                    row['view'].add('reads View fields: check against the gate')
                elif not j.get('sourceRoot'):
                    row['view'].add('no root recorded (older material file): the rebuild decides')
                elif j['sourceRoot'] not in LAYERED_ROOTS:
                    row['view'].add('non-layered root: check against the gate')
    return out


def view_verdict(flags):
    """A forecast only: the pipeline's own gate (scripts/shader-probe/view_layout.py) decides on the 17 Nov program."""
    for v in ('pins a View lane C838D617 does not requalify', 'reads View fields: check against the gate',
              'non-layered root: check against the gate', 'no root recorded (older material file)'):
        hit = sorted(f for f in flags if f.startswith(v))
        if hit:
            return hit[0]
    return 'layered only: passes (layered View reads are requalified or dead)'


def main():
    ap = argparse.ArgumentParser()
    for flag in ('active', 'custom', 'census', 'morph', 'surface', 'builder', 'mask-proof', 'view-lanes', 'out'):
        ap.add_argument('--' + flag, required=True)
    ap.add_argument('--followups')
    ap.add_argument('--nov17-proof', help='TSV (medium, verdict, differs): 17 Nov Medium reads vs the live Medium; '
                    "'pass' proves a stale mesh the item rule counts as Season 12 current")
    ap.add_argument('--hold', action='append', default=[], help='NAME=REASON: a mesh no wave may admit')
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active = Path(a.active)
    assets = json.loads(active.read_text(encoding='utf-8'))
    custom = json.loads(Path(a.custom).read_text(encoding='utf-8'))
    supported = json.loads((active.parent / 'supported-items.json').read_text(encoding='utf-8'))
    proof = json.loads(Path(a.morph).read_text(encoding='utf-8'))
    surface = json.loads(Path(a.surface).read_text(encoding='utf-8'))['meshes']
    meta = json.loads(Path(a.builder).read_text(encoding='utf-8'))['s12BodyTypePreview']
    if meta['activeIndexSha256'] != sha(active):
        raise SystemExit('The builder run was made on another index; rerun replan.sh first')
    holds = dict(h.split('=', 1) for h in a.hold)

    body = assets.get('attachmentBody', {}).get('source')
    shaped = bpi.body_type_meshes(a.census, assets['meshes'])
    items_all = bpi.item_meshes(custom['definitions'], custom['catalog'], supported['items'])
    users = {}
    for item, meshes in items_all.items():
        for m in meshes & shaped:
            users.setdefault(m, []).append((item, meshes & shaped))
    by_item = {i: (m & shaped) - {body} for i, m in items_all.items() if (m & shaped) - {body}}
    stale = set(meta.get('stalePackages', []))
    by_name = {name_of(s): s for s in assets['meshes']}
    held_sources = {by_name[n] for n in holds if n in by_name}
    if set(meta['effective']) & held_sources:
        raise SystemExit('A held mesh is already Season 12 in the builder run: '
                         + ', '.join(sorted(name_of(s) for s in set(meta['effective']) & held_sources)))
    rule = Rule(proof, set(meta['admitted']), stale, users, body, by_item, held=held_sources)
    effective0, held0 = rule.settle()
    if effective0 != set(meta['effective']):
        raise SystemExit(f'Item rule mismatch with the builder run: {len(effective0 ^ set(meta["effective"]))} meshes')
    base_items = rule.items()

    proof_sources = {r['source'] for r in proof.values()}
    shown = set().union(*by_item.values())
    c_sources = {r['source'] for n, r in surface.items()
                 if (r['class'].startswith(BATCH_C) or 'material slots' in r['class']) and r['source'] not in effective0}
    no_read = shown - proof_sources - effective0
    stale_held = ((stale - effective0) - c_sources) & shown   # the package proof also lists meshes no item shows
    other_held = (shown - effective0) - c_sources - no_read - stale_held
    # Stale packages the item rule still counts as Season 12: their live file matches the 6 Nov (12.00) read, but the
    # 17 Nov update changed the package. Only a 17 Nov read proves them current (wave U).
    nov17 = {}
    if a.nov17_proof:
        with open(a.nov17_proof, encoding='utf-8') as f:
            nov17 = {r['medium']: (r['verdict'], r.get('differs', '')) for r in csv.DictReader(f, delimiter='\t')}
    stale_counted = (stale & effective0) & shown
    unproven = {s for s in stale_counted if nov17.get(s, ('',))[0] != 'pass'}
    base_current = current_items(base_items, by_item, unproven)

    masks = bpi.load_mask_proof(a.mask_proof)
    seeds = {r['source'] for r in masks.values()} - effective0
    cluster = component(seeds, by_item, effective0, body)

    def group(s):
        if s in held_sources:
            return 'held'
        if s in c_sources:
            return 'batch C'
        if s in stale_held:
            return 'stale package'
        if s in no_read:
            return 'never read for S12'
        if s in stale_counted:
            return 'changed on 17 Nov, counted S12'
        if s in set(meta['admitted']) or s in held0:
            return 'admitted, held by the item rule'
        return 'refused, other route'

    # Waves. C0: the T-shirt alone. C1: the cluster (everything in it a fresh read can fix). C2+: the rest of batch C,
    # most items first, about WAVE_MIS material instances each. R: stale and never-read meshes outside the cluster
    # (mesh reads only, no textures).
    t_shirt = by_name[FIRST]
    waves = [('C0', {t_shirt})]
    # Only what a fresh read fixes: batch C, stale or never-read meshes, and admitted meshes the rule holds (they
    # release once the rest pass). A cluster member refused on another route stays out and shows as a blocker.
    fixable = c_sources | stale_held | no_read | set(meta['admitted']) | set(held0)
    c1 = {s for s in cluster if s in fixable and s not in held_sources and s != t_shirt}
    waves.append(('C1', c1))
    requalified = set(json.loads(Path(a.view_lanes).read_text(encoding='utf-8'))['admittedOffsets'])
    scope = collections.defaultdict(lambda: {'items': set(), 'mis': set(), 'textures': set(),
                                             'roots': collections.Counter(), 'view': set()})
    scope.update(material_scope(supported['ready'], active.parent, {name_of(s) for s in (shown - effective0) | unproven}, requalified))
    rest_c = sorted(c_sources - c1 - {t_shirt} - held_sources,
                    key=lambda s: (-len(scope[name_of(s)]['items']), name_of(s)))
    k, chunk, mis = 2, set(), 0
    for s in rest_c:
        n = len(scope[name_of(s)]['mis'])
        if chunk and mis + n > WAVE_MIS:
            waves.append((f'C{k}', chunk))
            k, chunk, mis = k + 1, set(), 0
        chunk.add(s)
        mis += n
    if chunk:
        waves.append((f'C{k}', chunk))
    r_wave = (stale_held | no_read) - c1 - held_sources
    waves.append(('R', r_wave))
    waves.append(('U', unproven - held_sources))

    followups = {}
    if a.followups:
        with open(a.followups, encoding='utf-8') as f:
            for row in csv.DictReader(f, delimiter='\t'):
                followups[row['medium']] = row

    def uv_changed(s):
        return 'UVs' in nov17.get(s, ('', ''))[1]

    def needs_materials(s):
        return s in c_sources or (s in unproven and uv_changed(s))

    added, wave_rows, rows, item_wave, item_current = set(), [], [], {}, {}
    prev, prev_current = base_items, base_current
    for wave, meshes in waves:
        added |= meshes
        now = rule.items(added)
        for item in now - prev:
            item_wave[item] = wave
        now_current = current_items(now, by_item, unproven - added)
        for item in now_current - prev_current:
            item_current[item] = wave
        wave_rows.append({
            'wave': wave, 'meshes': len(meshes), 's12ItemsAfter': len(now), 'unlocks': len(now - prev),
            'currentItemsAfter': len(now_current),
            'needsMaterialRead': sum(1 for s in meshes if needs_materials(s)),
            'needsMeshRead': sum(1 for s in meshes if s in stale or s in no_read),
            'materialInstances': len(set().union(*[scope[name_of(s)]['mis'] for s in meshes if needs_materials(s)] or [set()])),
            'garmentTextures': len(set().union(*[scope[name_of(s)]['textures'] for s in meshes if needs_materials(s)] or [set()])),
            'itemsShowing': len(set().union(*[scope[name_of(s)]['items'] for s in meshes] or [set()]))})
        for s in sorted(meshes, key=lambda s: (-len(scope[name_of(s)]['items']), name_of(s))):
            n = name_of(s)
            sc = scope[n]
            light = n[:-2] + '_L' if n.endswith('_M') else None
            light_entry = assets['meshes'].get(by_name.get(light, ''), {}) if light else {}
            fu = followups.get(n, {})
            rows.append({
                'wave': wave, 'mesh': n, 'group': group(s), 'surfaceClass': (surface.get(n) or {}).get('class', ''),
                'package17Nov': 'changed' if s in stale else ('no S12 read' if s in no_read else 'identical'),
                'inCluster': 'yes' if s in cluster else '',
                'items': len(sc['items']), 'materialInstances': len(sc['mis']), 'garmentTextures': len(sc['textures']),
                'roots': ' '.join(f'{r}:{c}' for r, c in sc['roots'].most_common()),
                'viewGate': view_verdict(sc['view']) if needs_materials(s) else '',
                'lightSiblingInIndex': (light_entry.get('url') or 'yes (no url)') if light_entry else '',
                'lightFollowup': f"{fu['reason']} ({fu['differs']}; live {fu['liveFolder']})" if fu else '',
                'nov17Proof': ' '.join(x for x in nov17[s] if x) if s in nov17 else ''})
        prev, prev_current = now, now_current
    for n, reason in holds.items():
        s = by_name.get(n)
        if s and s not in effective0:
            rows.append({'wave': 'held', 'mesh': n, 'group': 'held', 'surfaceClass': (surface.get(n) or {}).get('class', ''),
                         'package17Nov': 'changed' if s in stale else 'identical', 'inCluster': 'yes' if s in cluster else '',
                         'items': len(scope.get(n, {'items': ()})['items']), 'materialInstances': '', 'garmentTextures': '',
                         'roots': '', 'viewGate': '', 'lightSiblingInIndex': '', 'lightFollowup': reason,
                         'nov17Proof': ' '.join(x for x in nov17[s] if x) if s in nov17 else ''})
    final = rule.items(added)
    still = {i: sorted(name_of(m) for m in by_item[i] - rule.settle(added)[0]) for i in by_item if i not in final}
    blockers = collections.Counter(m for ms in still.values() for m in ms)

    out.mkdir(parents=True)
    plan = {
        'note': 'Upper bounds: every planned mesh is assumed to pass its proofs and review.',
        'inputs': {k: sha(v) for k, v in (('active', a.active), ('morph', a.morph), ('surface', a.surface),
                                           ('census', a.census), ('builder', a.builder))},
        'itemsWithBodyTypeMeshes': len(by_item), 's12ItemsNow': len(base_items), 'currentItemsNow': len(base_current),
        'staleCountedS12': {'meshes': len(stale_counted), 'byNov17Verdict': dict(collections.Counter(
            ' '.join(x for x in nov17[s] if x) if s in nov17 else 'no 17 Nov read' for s in stale_counted))},
        'groups': {'batchC': len(c_sources), 'stalePackagesOutsideC': len(stale_held), 'neverRead': len(no_read),
                   'otherRefused': len(other_held), 'cluster': len(cluster), 'clusterSeeds': sorted(map(name_of, seeds))},
        'clusterByGroup': dict(collections.Counter(group(s) for s in cluster)),
        'waves': wave_rows, 'holds': holds,
        'itemsStillMixed': len(still), 'topBlockersAfterAllWaves': blockers.most_common(25)}
    (out / 'plan.json').write_text(json.dumps(plan, indent=1) + '\n', encoding='utf-8')
    with open(out / 'rows.tsv', 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter='\t', lineterminator='\n')
        w.writeheader()
        w.writerows(rows)
    with open(out / 'items.tsv', 'w', encoding='utf-8', newline='') as f:
        f.write('item\twave\tcurrentAfter\tblockedBy\n')
        for i in sorted(by_item):
            f.write(f"{i}\t{'now' if i in base_items else item_wave.get(i, 'not planned')}\t"
                    f"{'now' if i in base_current else item_current.get(i, 'not planned')}\t{' '.join(still.get(i, []))}\n")
    print(json.dumps({k: plan[k] for k in ('s12ItemsNow', 'currentItemsNow', 'staleCountedS12', 'groups',
                                           'clusterByGroup', 'waves', 'itemsStillMixed')}, indent=1))


if __name__ == '__main__':
    main()
