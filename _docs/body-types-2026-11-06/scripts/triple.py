import sys,collections
from pathlib import Path
import numpy as np
sys.path.insert(0,'.')
from glbcmp import load
D=Path(sys.argv[1])
names=sorted(p.name[:-6] for p in D.glob('*_M.glb'))
stats=collections.Counter(); rows=[]
for n in names:
    fl,fm,fh=D/f'{n}_L.glb',D/f'{n}_M.glb',D/f'{n}_H.glb'
    if not (fl.exists() and fh.exists()): stats['no L/H']+=1; continue
    try:
        _,pm=load(fm); _,pl=load(fl); _,ph=load(fh)
    except Exception as e: stats['err']+=1; continue
    def cmp(pa,pb):
        if len(pa)!=len(pb) or any(len(a['pos'])!=len(b['pos']) for a,b in zip(pa,pb)): return ('topology differs',None,None)
        uv=all(a['uv'] is None or np.abs(a['uv']-b['uv']).max()<1e-4 for a,b in zip(pa,pb))
        A=np.concatenate([a['pos'] for a in pa]); B=np.concatenate([b['pos'] for b in pb])
        s=float((A*B).sum()/(B*B).sum()); r=np.linalg.norm(A-s*B,axis=1)
        return ('same topo' + ('' if uv else ', UV differs'), s, float(np.percentile(r,99)*100))
    cl=cmp(pl,pm); ch=cmp(ph,pm)
    key=(cl[0], 'pure0.85' if cl[1] and abs(cl[1]-.85)<.002 and cl[2]<0.05 else 'reshaped' if cl[1] else '-',
         ch[0], 'pure1.15' if ch[1] and abs(ch[1]-1.15)<.002 and ch[2]<0.05 else 'reshaped' if ch[1] else '-')
    stats[key]+=1; rows.append((n,cl,ch))
for k,v in stats.most_common(): print(v,k)
print()
for n,cl,ch in rows[:400:12]: print(f'{n:45s} L {cl[0]:22s} s={cl[1] and round(cl[1],3)} p99res={cl[2] and round(cl[2],2)}cm | H {ch[0]:22s} s={ch[1] and round(ch[1],3)} p99res={ch[2] and round(ch[2],2)}cm')
