import json,struct,gzip,sys
import numpy as np
from pathlib import Path
def load(p):
    b=Path(p).read_bytes()
    if b[:2]==b'\x1f\x8b': b=gzip.decompress(b)
    jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); bin_=b[20+jl+8:]
    def acc(i):
        a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        off=v.get('byteOffset',0)+a.get('byteOffset',0)
        return np.frombuffer(bin_,dtype=dt,count=a['count']*n,offset=off).reshape(a['count'],n)
    prims=[]
    for m in j['meshes']:
        for pr in m['primitives']:
            at=pr['attributes']
            prims.append({'mat':j['materials'][pr['material']]['name'] if 'material' in pr else None,
                'pos':acc(at['POSITION']),'uv':acc(at['TEXCOORD_0']) if 'TEXCOORD_0' in at else None,
                'idx':acc(pr['indices']).ravel() if 'indices' in pr else None,'targets':m.get('extras',{}).get('targetNames',[])})
    return j,prims
def summary(p):
    j,pr=load(p)
    return [(q['mat'],len(q['pos']),len(q['idx']) if q['idx'] is not None else 0) for q in pr], pr
if __name__=='__main__':
    files=sys.argv[1:]
    S=[summary(f) for f in files]
    for f,(s,_) in zip(files,S): print(Path(f).name, s)
    base=S[1][1] if len(S)>2 else S[0][1]
    for f,(s,pr) in zip(files,S):
        for a,b in zip(pr,base):
            if len(a['pos'])==len(b['pos']):
                uv_same = a['uv'] is not None and np.abs(a['uv']-b['uv']).max()<1e-4
                idx_same = a['idx'] is not None and np.array_equal(a['idx'],b['idx'])
                # best uniform scale about origin
                s_=float((a['pos']*b['pos']).sum()/(b['pos']*b['pos']).sum())
                res=np.linalg.norm(a['pos']-s_*b['pos'],axis=1)
                print(f'  {Path(f).name} vs base: same topo idx={idx_same} uv={uv_same} uniformScale={s_:.4f} residual mean {res.mean()*100:.2f} cm p99 {np.percentile(res,99)*100:.2f} cm max {res.max()*100:.2f} cm')
            else: print(f'  {Path(f).name}: vertex count differs {len(a["pos"])} vs {len(b["pos"])}')
