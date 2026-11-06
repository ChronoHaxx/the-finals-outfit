import json,struct,gzip,sys
import numpy as np
from pathlib import Path
def load_targets(p):
    b=Path(p).read_bytes()
    if b[:2]==b'\x1f\x8b': b=gzip.decompress(b)
    jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); bin_=b[20+jl+8:]
    def acc(i):
        a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}[a['componentType']]
        if 'sparse' in a: raise SystemExit('sparse')
        return np.frombuffer(bin_,dtype=dt,count=a['count']*n,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],n).astype(np.float64)
    m=j['meshes'][0]; pr=m['primitives'][0]; names=m.get('extras',{}).get('targetNames',[])
    pos=acc(pr['attributes']['POSITION'])
    T={n:acc(t['POSITION']) for n,t in zip(names,pr.get('targets',[]))}
    return pos,T
S=Path(sys.argv[1]); M=Path(sys.argv[2])
pl,tl=load_targets(S/'SK_Body_L.glb'); pm,tm=load_targets(M/'SK_Body_M.glb'); ph,th=load_targets(S/'SK_Body_H.glb')
def mag(d): return np.linalg.norm(d,axis=1)
for n,d in [('medium_male',tm['medium_male']),('medium_female',tm['medium_female']),('light_male',tl['light_male']),('light_female',tl['light_female']),('heavy_male',th['heavy_male']),('heavy_female',th['heavy_female']),('heavy_male_muscular',th['heavy_male_muscular']),('heavy_female_muscular',th['heavy_female_muscular'])]:
    print(f'{n:22s} moved verts {int((mag(d)>1e-4).sum()):6d}  mean {mag(d).mean()*100:.2f} cm  max {mag(d).max()*100:.2f} cm')
# is light_male == 0.85 * medium_male ?
for a,b,s in [('light_male','medium_male',.85),('light_female','medium_female',.85),('heavy_male','medium_male',1.15),('heavy_female','medium_female',1.15)]:
    src=tl if a.startswith('light') else th
    r=mag(src[a]-s*tm[b]); print(f'{a} vs {s}*{b}: residual mean {r.mean()*100:.2f} cm p99 {np.percentile(r,99)*100:.2f} cm max {r.max()*100:.2f} cm')
# push_* morphs equal up to scale?
for n in ['push_torso','push_full_pants','head_neck_match']:
    r=mag(tl[n]-.85*tm[n]); print(f'{n}: L vs .85 M residual max {r.max()*100:.3f} cm')
# height after morph
for lab,p,t,n in [('M male',pm,tm,'medium_male'),('M female',pm,tm,'medium_female'),('L male',pl,tl,'light_male'),('L female',pl,tl,'light_female'),('H male',ph,th,'heavy_male'),('H female',ph,th,'heavy_female'),('H male musc',ph,th,'heavy_male_muscular')]:
    q=p+t[n]; ext=q.max(0)-q.min(0); print(f'{lab:12s} extents (x,y,z) cm {np.round(ext*100,1)}')
