# Proxy check on the June dump: does SK_X_L / SK_X_H have M's vertex count and 0.85/1.15 x M's bounds?
import json,sys,collections
from pathlib import Path
DUMP=Path(r'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\Exports\Discovery\Content')
need=json.load(open(sys.argv[1]))['needForActive']
pairs=json.load(open(sys.argv[1]))['pairs']
base_of={p[3]:p[2] for p in pairs}
def info(gp):
    f=DUMP/(gp.split('.')[0].replace('/Game/','')+'.json')
    if not f.exists(): return None
    for o in json.load(open(f,encoding='utf-8')):
        if o.get('Type') in ('SkeletalMesh','StaticMesh'):
            b=o.get('ImportedBounds') or {}
            lod=(o.get('LODModels') or [{}])[0]
            return (lod.get('NumVertices'), b.get('Origin'), b.get('BoxExtent'), len(o.get('SkeletalMaterials') or []))
    return None
c=collections.Counter(); odd=[]
for r in need:
    b=base_of[r]; ir=info(r); ib=info(b)
    arch='L' if r.endswith(('_L','_l','Small')) or r.split('.')[-1].endswith(('_L','_l')) else 'H'
    if ir is None or ib is None or ir[2] is None or ib[2] is None: c[(arch,'not in June dump')]+=1; continue
    s=0.85 if arch=='L' else 1.15
    same_v = ir[0]==ib[0]
    ok_b = all(abs(ir[2][k]-s*ib[2][k])<0.02*max(1,abs(ib[2][k])) for k in 'XYZ') and all(abs(ir[1][k]-s*ib[1][k])<0.5 for k in 'XYZ')
    key=(arch, 'same verts' if same_v else 'verts differ', 'bounds=scale' if ok_b else 'bounds differ')
    c[key]+=1
    if not (same_v and ok_b): odd.append((r.split('.')[-1],ir[0],ib[0]))
for k,v in sorted(c.items()): print(v,k)
print('examples of non-scale:',odd[:30])
