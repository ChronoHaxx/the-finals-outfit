"""Class-morph census (22 Nov 2026): for every Light/Medium/Heavy triple in a source-glb folder, is the Light/Heavy mesh
   the Medium one scaled, bind and morphs included? Reads only.

  python scripts/archetypes/class-morph-census.py <source-glb dir> <out.json>

Answer on season11-staging-20261018 (207 triples; _docs/archetypes-2026-11-22/class-morph-census-s11-20261018.json):
binds and fitting morphs yes (pure x0.85 / x1.15 on 195 / 192), class morphs no. Worst vertex per mesh:
light_male vs 0.85 x medium_male median 1.4 cm (0.1 to 4.3 cm); heavy_male vs 1.15 x medium_male median 4.7 cm (up to 21 cm).
"""
import json,struct,gzip,sys,collections
import numpy as np
from pathlib import Path
def load(p):
    b=Path(p).read_bytes()
    if b[:2]==b'\x1f\x8b': b=gzip.decompress(b)
    jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); bin_=b[20+jl+8:]
    def acc(i):
        a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}[a['componentType']]
        return np.frombuffer(bin_,dtype=dt,count=a['count']*n,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],n).astype(np.float64)
    pos=[];T=collections.defaultdict(list);names=None;uv=[]
    for m in j['meshes']:
        nm=m.get('extras',{}).get('targetNames',[])
        for pr in m['primitives']:
            pos.append(acc(pr['attributes']['POSITION']))
            uv.append(acc(pr['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in pr['attributes'] else None)
            ts=pr.get('targets',[])
            for n,t in zip(nm,ts): T[n].append(acc(t['POSITION']))
            for n in nm[len(ts):]: pass
    P=np.concatenate(pos); N=len(P)
    TT={n:np.concatenate(v) for n,v in T.items() if sum(len(x) for x in v)==N}
    return P,TT,[len(p) for p in pos]
D=Path(sys.argv[1]); out=collections.Counter(); rows=[]
mag=lambda d: np.linalg.norm(d,axis=1)
for fm in sorted(D.glob('*_M.glb')):
    n=fm.name[:-6]; fl,fh=D/f'{n}_L.glb',D/f'{n}_H.glb'
    if not (fl.exists() and fh.exists()): continue
    try: pm,tm,sm=load(fm); pl,tl,sl=load(fl); ph,th,sh=load(fh)
    except Exception as e: out['err']+=1; continue
    r={'name':n}
    for lab,p,t,s,k,cls in (('L',pl,tl,sl,.85,'light'),('H',ph,th,sh,1.15,'heavy')):
        if s!=sm: r[lab]='topology'; continue
        bind=float(np.percentile(mag(p-k*pm),99)*100)
        r[lab+'_bind_p99cm']=round(bind,3)
        for sex in ('male','female'):
            a=t.get(f'{cls}_{sex}'); b=tm.get(f'medium_{sex}')
            if a is None or b is None: r[f'{lab}_{sex}']='missing'; continue
            res=mag(a-k*b); r[f'{lab}_{sex}_max_cm']=round(float(res.max()*100),2); r[f'{lab}_{sex}_p99_cm']=round(float(np.percentile(res,99)*100),2)
            r[f'{lab}_{sex}_mag_max_cm']=round(float(mag(a).max()*100),2)
        push=[x for x in tm if x.startswith('push_') or x.startswith('shrink_')]
        pr=[float(mag(t[x]-k*tm[x]).max()*100) for x in push if x in t]
        r[lab+'_fitting_max_cm']=round(max(pr),3) if pr else None
        r[lab+'_fitting_missing']=[x for x in push if x not in t]
    rows.append(r)
json.dump(rows,open(sys.argv[2],'w'),indent=1)
def bucket(v):
    return 'missing' if v is None else '<0.05' if v<0.05 else '<0.5' if v<0.5 else '<1' if v<1 else '<2' if v<2 else '>=2'
for lab in ('L','H'):
    for sex in ('male',):
        c=collections.Counter(bucket(r.get(f'{lab}_{sex}_max_cm')) if r.get(lab)!='topology' else 'topology' for r in rows)
        print(lab,sex,'class morph vs scaled medium (max cm):',dict(c))
    c=collections.Counter(bucket(r.get(lab+'_bind_p99cm')) if r.get(lab)!='topology' else 'topology' for r in rows); print(lab,'bind p99 vs scaled M:',dict(c))
    c=collections.Counter(bucket(r.get(lab+'_fitting_max_cm')) if r.get(lab)!='topology' else 'topology' for r in rows); print(lab,'fitting morphs vs scaled:',dict(c))
print(len(rows),'triples')
