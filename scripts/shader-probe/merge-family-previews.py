"""Combine reviewed family previews; optionally activate locally.

Preparation never writes the active index. Activation consumes the same reviewed combined
documents, rechecks their hashes and the pinned baseline, and preserves a rollback copy.
An explicit coverage-only amendment can use a newer pinned active baseline without rewriting
the original frozen source/material/GPU evidence. Existing index entries must remain identical.
"""
import argparse, copy, importlib.util, json, os, sys
from pathlib import Path
from datetime import datetime, timezone

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('family',HERE/'prepare-family.py')
family=importlib.util.module_from_spec(spec);spec.loader.exec_module(family)
FILES=('assets.json','skin-pairs.json','supported-items.json')
_multipart=None


def multipart_family(path):
    """The opt-in schemaVersion 2 MultipartFamily, loaded only when a multipart manifest is selected."""
    global _multipart
    if _multipart is None:
        spec=importlib.util.spec_from_file_location('multipart_family',HERE/'prepare-multipart-family.py')
        _multipart=importlib.util.module_from_spec(spec);spec.loader.exec_module(_multipart)
    return _multipart.MultipartFamily(path)


# schemaVersion 1 keeps the existing Family; anything unknown fails before a family is built or a file written.
LOADERS={1:lambda path:family.Family(path),2:multipart_family}


def load_families(manifests,loaders=None):
    loaders=LOADERS if loaders is None else loaders
    versions=[]
    for path in manifests:
        raw=family.read_manifest(path);version=raw.get('schemaVersion') if isinstance(raw,dict) else None
        if type(version) is not int or version not in loaders:
            raise ValueError(f'Unsupported manifest schemaVersion {version!r}: {path}')
        versions.append(version)
    return [loaders[version](path) for version,path in zip(versions,manifests)]


def coverage_preview(m, amendment):
    """Validate a mask-only amendment without changing the frozen family evidence."""
    import numpy as np
    from PIL import Image
    d=m.d;preview=Path(amendment['preview']);report_file=Path(amendment['coverageReport'])
    if preview.is_absolute() or '..' in preview.parts or not preview.as_posix().startswith('public/models/'):
        raise ValueError('Coverage amendment must be a local sibling preview')
    if preview.resolve().parent!=m.PREVIEW.resolve().parent or preview.resolve() in (m.PREVIEW.resolve(),m.ACTIVE.resolve()):
        raise ValueError('Coverage amendment must preserve original and active directories')
    old={f:d.read_json(m.PREVIEW/f) for f in (*FILES,'preview.json')}
    new={f:d.read_json(preview/f) for f in (*FILES,'preview.json')}
    before=old['assets.json']['meshes'][m.SOURCE_MESH]
    after=new['assets.json']['meshes'][m.SOURCE_MESH]
    # Once these three fields are restored, every JSON document must equal the frozen preview.
    normalized=copy.deepcopy(new)
    normalized['assets.json']['meshes'][m.SOURCE_MESH]=dict(after)
    for field in family.MASK_KEYS:
        normalized['assets.json']['meshes'][m.SOURCE_MESH].pop(field,None)
        if field in before:normalized['assets.json']['meshes'][m.SOURCE_MESH][field]=before[field]
    old_rows={r['id']:r for r in old['supported-items.json']['ready']}
    for row in normalized['supported-items.json']['ready']:
        for index,part in enumerate(row.get('parts',[])):
            if part.get('sourceMesh')==m.SOURCE_MESH:
                original=old_rows[row['id']]['parts'][index]
                for field in family.MASK_KEYS:
                    part.pop(field,None)
                    if field in original:part[field]=original[field]
    if normalized!=old:raise ValueError('Coverage amendment changed geometry, material or unrelated index data')
    report=d.read_json(report_file)
    records=[r for r in report['records'] if r['source']==m.SOURCE_MESH]
    if len(records)!=1:raise ValueError('Coverage amendment requires one exact source record')
    record=records[0];new_mask=(preview/after['bodyMaskUrl']).resolve()
    if new_mask!=(report_file.parent/record['file']).resolve() or d.file_sha(new_mask)!=record['sha256']:
        raise ValueError('Coverage mask does not match its evidence')
    if record['meshSha256']!=m.GLB_SHA256 or d.file_sha(preview/after['url'])!=m.GLB_SHA256:
        raise ValueError('Coverage geometry differs from frozen family')
    if d.file_sha(Path('public')/report['bodyFile'])!=report['bodySha256']:
        raise ValueError('Coverage body geometry changed')
    previous=np.asarray(Image.open(m.PREVIEW/before['bodyMaskUrl']).convert('RGBA'))
    candidate=np.asarray(Image.open(new_mask).convert('RGBA'))
    if previous.shape!=candidate.shape or not np.array_equal(previous[:,:,3],candidate[:,:,3]):
        raise ValueError('Coverage image layout changed')
    if after.get('bodyMaskUvTiles')!=before.get('bodyMaskUvTiles') or np.any(candidate[:,:,:3]>previous[:,:,:3]):
        raise ValueError('Coverage amendment hides new texels or changes UV layout')
    if not np.any(candidate[:,:,0]) or np.array_equal(candidate,previous):
        raise ValueError('Coverage amendment must retain coverage and restore some skin')
    return preview


def checked_baseline(active, hashes, file_sha):
    expected={(active/f).as_posix() for f in FILES}
    if set(hashes)!=expected:raise ValueError('Current baseline must pin exactly the three active index files')
    for p,digest in hashes.items():
        if file_sha(p)!=digest:raise ValueError(f'Current active baseline changed: {p}')
    return hashes

def merge(manifests, acceptance_file, output, activate=False):
    output=Path(output)
    if output.is_absolute() or '..' in output.parts or not output.as_posix().startswith('public/models/'):
        raise ValueError('Combined output must be a separate local public/models folder')
    families=load_families(manifests)
    first=families[0];d=first.d;active=first.ACTIVE
    if any(m.ACTIVE!=active or m.PREVIEW.resolve()==output.resolve() for m in families) or active.resolve()==output.resolve():
        raise ValueError('Families must share an active index and use separate output folders')
    accepted=d.read_json(Path(acceptance_file))
    if not accepted.get('sourceAccepted') or not accepted.get('visualAccepted') or not accepted.get('outfitsAccepted'):
        raise ValueError('Astra acceptance is incomplete')
    if accepted.get('humanAcceptance')!='pending':
        raise ValueError('This local activation must not claim human acceptance')
    for p,digest in accepted['evidenceHashes'].items():
        if d.file_sha(p)!=digest:raise ValueError(f'Accepted evidence changed: {p}')
    amendments=accepted.get('coveragePreviews',{})
    current_baseline=accepted.get('activeBaselineHashes')
    if bool(amendments)!=bool(current_baseline):raise ValueError('Coverage amendments require a pinned current baseline')
    if amendments and set(amendments)!={m.m['id'] for m in families}:raise ValueError('Coverage amendments must name every selected family exactly')
    if amendments and any(m.m['schemaVersion']!=1 for m in families):
        raise ValueError('Coverage amendments are not supported for schemaVersion 2 multipart families')
    baseline=checked_baseline(active,current_baseline,d.file_sha) if current_baseline else d.read_json(first.DOCS/'adapter-baseline.json')['hashes']
    previews={}
    for m in families:
        if amendments:
            m.verify() # Read-only validation of the unchanged original source/material/GPU evidence.
            previews[m.m['id']]=coverage_preview(m,amendments[m.m['id']])
        else:
            m._require_frozen_baseline()
            if m._baseline()['hashes']!=baseline:raise ValueError('Previews have different baselines')
            previews[m.m['id']]=m.PREVIEW
    old={f:d.read_json(active/f) for f in FILES}
    if activate:
        combined=d.read_json(output/'merge.json')
        if combined['acceptedIds']!=sorted(accepted['acceptedIds']):raise ValueError('Combined acceptance changed')
        for f,digest in combined['hashes'].items():
            if d.file_sha(output/f)!=digest:raise ValueError('Combined index changed')
        review=d.read_json(Path(accepted['combinedReview']))
        if not review.get('passed') or review.get('mode')!='preview' or Path(review['previewDir']).resolve()!=output.resolve():
            raise ValueError('Combined outfit preview has not passed')
        # Resolve from the prepared directory back into the active directory without changing asset contents.
        rb=d.preview_tools.Rebaser(output,active)
        docs={'assets.json':d.preview_tools.rebase_assets(d.read_json(output/'assets.json'),rb),
              'skin-pairs.json':d.preview_tools.rebase_skin_pairs(d.read_json(output/'skin-pairs.json'),rb),
              'supported-items.json':d.accessories.rebase_supported(d.read_json(output/'supported-items.json'),rb)}
        if rb.missing:raise ValueError('Combined assets missing')
        for f in FILES:
            if d.preview_tools.resolved_shape(docs[f],active)!=d.preview_tools.resolved_shape(d.read_json(output/f),output):
                raise ValueError('Activation rebase changed content')
        evidence=Path(acceptance_file).parent
        rollback=evidence/'activation-before'
        if rollback.exists() or (evidence/'activation.json').exists():raise ValueError('Preserve previous activation')
        rollback.mkdir()
        for f in FILES:(rollback/f).write_bytes((active/f).read_bytes())
        pending=[]
        for f in FILES:
            tmp=active/(f+'.family-pilot.tmp')
            with tmp.open('x',encoding='utf8') as stream:json.dump(docs[f],stream,indent=2);stream.write('\n')
            pending.append((tmp,active/f))
        for p,digest in baseline.items():
            if d.file_sha(p)!=digest:raise ValueError('Baseline changed before activation')
        try:
            for src,dest in pending:os.replace(src,dest)
        except BaseException:
            for f in FILES:
                recovery=active/(f+'.family-rollback.tmp');recovery.write_bytes((rollback/f).read_bytes());os.replace(recovery,active/f)
            raise
        record={'at':datetime.now(timezone.utc).isoformat(),'added':len(accepted['acceptedIds']),
          'advertisedBefore':len(old['supported-items.json']['items']),'advertised':len(docs['supported-items.json']['items']),
          'humanAcceptance':'pending','published':False,'hashes':{f:d.file_sha(active/f) for f in FILES}}
        d.write(evidence/'activation.json',record);print(json.dumps(record));return
    if output.exists():raise ValueError('Preserve existing combined preview')
    output.mkdir(parents=True)
    rb=d.preview_tools.Rebaser(active,output)
    docs={'assets.json':d.preview_tools.rebase_assets(old['assets.json'],rb),
          'skin-pairs.json':d.preview_tools.rebase_skin_pairs(old['skin-pairs.json'],rb),
          'supported-items.json':d.accessories.rebase_supported(old['supported-items.json'],rb)}
    ids=set();helper=d.shared_helpers()
    for m in families:
        if not amendments:m.verify()
        preview_dir=previews[m.m['id']]
        preview=d.read_json(preview_dir/'preview.json');new=set(preview['implemented'])
        if ids&new:raise ValueError('Duplicate item across families')
        ids|=new
        rebase=d.preview_tools.Rebaser(preview_dir,output)
        assets=d.preview_tools.rebase_assets(d.read_json(preview_dir/'assets.json'),rebase)
        for field in ('meshes','materials'):
            for key,value in assets[field].items():
                if key in docs['assets.json'][field] and docs['assets.json'][field][key]!=value:
                    raise ValueError(f'Conflicting {field} entry: {key}')
                docs['assets.json'][field][key]=value
        supported=d.accessories.rebase_supported(d.read_json(preview_dir/'supported-items.json'),rebase)
        if rebase.missing:raise ValueError('Family dependencies missing')
        docs['supported-items.json']['items'].extend(i for i in supported['items'] if i in new)
        docs['supported-items.json']['ready'].extend(r for r in supported['ready'] if r['id'] in new)
    if ids!=set(accepted['acceptedIds']):raise ValueError('Combined candidates differ from accepted IDs')
    docs['supported-items.json']['exceptions']=[r for r in docs['supported-items.json']['exceptions'] if r['id'] not in ids]
    if rb.missing:raise ValueError('Baseline dependencies missing')
    for f,doc in docs.items():d.write(output/f,doc)
    result=helper.resolve_items(output/'assets.json',Path(acceptance_file).parent/'combined-resolver.json')
    ready={r['id'] for r in result['ready']}
    advertised=set(docs['supported-items.json']['items'])
    if ready-advertised!=set(first._baseline()['unadvertisedStructurallyReady']) or advertised-ready:
        raise ValueError('Combined readiness changed outside the reviewed candidates')
    record={'at':datetime.now(timezone.utc).isoformat(),'acceptedIds':sorted(ids),'advertised':len(advertised),
      'structural':len(ready),'unadvertised':sorted(ready-advertised),'hashes':{f:d.file_sha(output/f) for f in FILES}}
    d.write(output/'merge.json',record);print(json.dumps({k:v for k,v in record.items() if k!='acceptedIds'}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifests',nargs='+',required=True);p.add_argument('--acceptance',required=True)
    p.add_argument('--output',required=True);p.add_argument('--activate',action='store_true');a=p.parse_args()
    merge(a.manifests,a.acceptance,a.output,a.activate)
