import json,collections,re,os,sys
from pathlib import Path
c=json.load(open('customization.json',encoding='utf-8'))
d=c['definitions']
DUMP=Path(r'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\Exports\Discovery\Content')
def nm(p): return p['AssetPathName'] if p and p.get('AssetPathName') else ''
def f(gp):  # /Game/Discovery/Characters/X/SK_Y.SK_Y -> dump uemodel
    p=gp.split('.')[0].replace('/Game/','')
    return DUMP/(p+'.uemodel')
pairs=[]  # (def, arch, base, repl)
for name,v in d.items():
    seas=[t for t in v.get('properties',{}).get('AssetTags',[]) if t.startswith('Online.Season')]
    for part in v.get('properties',{}).get('VisualParts',[]) or []:
        base=nm(part.get('SkeletalMesh')) or nm(part.get('StaticMesh'))
        for o in part.get('TagOverrides',[]) or []:
            tags=o.get('MatchingTags',[])
            a=[t.split('.')[-1] for t in tags if t.startswith('Customization.Archetype')]
            if a and o.get('bOverrideMesh'):
                r=nm(o.get('ReplacementSkeletalMesh')) or nm(o.get('ReplacementStaticMesh'))
                if r: pairs.append((name,a[0],base,r,seas[0] if seas else ''))
repl=sorted({p[3] for p in pairs}); base=sorted({p[2] for p in pairs})
ex=collections.Counter(); miss=[]
for r in repl:
    if f(r).exists(): ex['exists']+=1
    else: ex['missing']+=1; miss.append(r)
print('replacement meshes',len(repl),dict(ex))
bm=collections.Counter(f(b).exists() for b in base); print('base meshes',len(base),'exist in June dump',bm)
ms=collections.Counter(p[4] for p in pairs if p[3] in set(miss)); print('missing by season', ms.most_common())
print('sample missing', miss[:8])
# active index coverage: how many active-index meshes have L/H counterparts
assets=json.load(open('../reconstructed-assemblies-v1/assets.json',encoding='utf-8'))['meshes']
act=set(assets)
need=sorted({p[3] for p in pairs if p[2] in act})
print('active-index base meshes with archetype replacements -> distinct L/H meshes needed', len(need), 'of which already indexed', sum(1 for r in need if r in act), 'exist in June dump', sum(1 for r in need if f(r).exists()))
json.dump({'pairs':pairs,'missing':miss,'needForActive':need},open(sys.argv[1],'w'),indent=0)
