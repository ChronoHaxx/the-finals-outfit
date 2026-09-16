"""Numerical regression checks for the bounded SM5 translator.

An independent, forward register-machine interpreter runs the original assembly
with synthetic constant texture samples. Compare that with the dependency-sliced
expressions. This checks translation, not fidelity of the viewer's lighting.
"""
import argparse
import importlib.util
import json
import re
import struct
from pathlib import Path

import numpy as np
from sm5_slice import Slice, split_operands
from quad_translation import forward_quad, evaluate_quad

spec=importlib.util.spec_from_file_location('build_materials',Path(__file__).with_name('build-materials.py'))
builder=importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)


def forward(assembly, constants, textures, uv, view_tangent=None, basis=None):
    registers={}; result={}; branches=[]; active=True
    def write(name, values, typ='f'):
        if name=='null': return
        name,_,mask=name.partition('.'); mask=mask or 'xyzw'
        bits=np.asarray(values,dtype={'f':np.float32,'i':np.int32,'u':np.uint32}[typ]).view(np.uint32)
        old=registers.setdefault(name,np.zeros(4,np.uint32))
        for c in mask: old['xyzw'.index(c)]=bits['xyzw'.index(c)]
    def read(source,typ='f'):
        negative=source.startswith('-'); source=source.removeprefix('-')
        absolute=source.startswith('|'); source=source.strip('|')
        if source.startswith('l('):
            vals=split_operands(source[2:-1]); raw=[]
            for v in vals:
                raw.append(struct.unpack('<I',struct.pack('<f',float(v)))[0] if '.' in v else int(v,0)&0xffffffff)
            bits=np.array(raw if len(raw)==4 else raw*4,np.uint32)
        else:
            name,_,mask=source.partition('.'); mask=mask or 'xyzw'
            if len(mask)==1: mask*=4
            bits=registers.get(name,np.zeros(4,np.uint32))[["xyzw".index(c) for c in mask]].copy()
        values=bits.view({'f':np.float32,'i':np.int32,'u':np.uint32}[typ])
        if absolute: values=np.abs(values)
        if negative: values=-values
        return values
    for i in range(0,len(constants),4): write(f'cb3[{i//4}]',constants[i:i+4])
    # UV0 is wherever the input signature places TEXCOORD0 (a colour interpolant may precede it).
    texcoord0=re.search(r'// TEXCOORD\s+0\s+xyzw\s+(\d+)\s+NONE',assembly)
    write('v0',[1,0,0,0]);write('v1',[0,0,1,1]);write(f'v{texcoord0[1] if texcoord0 else 2}',uv);write('v6',[.5,.5,.5,1])
    for i in range(4): write(f'cb0[{44+i}]',np.eye(4)[i])
    write('cb0[122]',[0,0,5,0]);write('cb0[159]',[0,0,0,1]);write('cb0[160]',[0,1,0,1])
    if view_tangent is not None:
        frame = np.eye(3) if basis is None else basis
        write('v0', [*frame[:,0], 0]); write('v1', [*frame[:,2], 1])
        write('cb0[122]', [*(frame @ np.asarray(view_tangent) + [.5,.5,.5]), 0])
    f0=None; f0_check=None; f0_anchor=None  # folded Specular: see sm5_slice.Slice.track_folded_f0
    def near(source,value,lanes):
        return source.startswith('l(') and np.allclose(read(source)[lanes],value,rtol=0,atol=5e-7)
    for text in assembly.splitlines():
        line=re.sub(r'\s*\[precise(?:\([^]]*\))?\]','',text.strip())
        match=re.match(r'(\w+)((?:\([^)]*\))*)\s*(.*)',line)
        if not match or line.startswith('//'): continue
        op,qualifiers,tail=match.groups(); a=split_operands(tail)
        if op.startswith('dcl_') or op=='ps_5_0': continue
        if op in ('if_z','if_nz'):
            condition=bool(read(a[0],'u')[0]) if active else False
            if op=='if_z': condition=not condition
            branches.append((active,condition));active=active and condition;continue
        if op=='else': active=branches[-1][0] and not branches[-1][1];continue
        if op=='endif': active=branches.pop()[0];continue
        if not active or op in ('ret','discard_nz'): continue
        mask=a[0].split('.')[-1] if '.' in a[0] else 'xyzw'; lanes=['xyzw'.index(c) for c in mask]
        if op=='mul' and 'cb0[159]' in line:
            # An unconnected Normal is folded into the operand that is not the view override.
            material=a[2] if 'cb0[159]' in a[1] and 'cb0[159]' not in a[2] else a[1]
            result['normal']=read(material)[lanes].copy()
        if op=='mad' and a[0]=='o2.z': result['roughness']=read(a[1])[[2]].copy()
        if op=='mad_sat' and 'cb0[160].w' in line: result['ao']=read(a[1])[[lanes[0]]].copy()
        if op=='add_sat' and a[1:]==['cb0[160].z','cb0[160].w']: result['ao']=np.ones(1,np.float32)
        if op=='mul' and 'l(0.080000)' in line: result['specular']=read(a[1])[[0]].copy()
        # Record the folded F0 inputs from the executed registers, then check the result numerically.
        state,f0=f0,None
        register=a[0].split('.')[0]
        if op=='add' and len(a)==3 and near(a[2],-.04,lanes) and a[1].lstrip('-').split('.')[0]!=register:
            f0={'stage':1,'dst':a[0],'base':read(a[1])[lanes].copy()}
        elif state and state['dst']==a[0] and state['stage']==1 and op=='mul':
            weight=[x for x in a[1:3] if x.split('.')[0]!=register]
            if len(weight)==1: f0={**state,'stage':2,'metal':float(read(weight[0])[0])}
        elif state and state['dst']==a[0] and state['stage']==2 and op=='add' and near(a[2],.04,lanes):
            f0_check=state
        saturated=op.endswith('_sat');op=op.removesuffix('_sat'); typ='f'
        if op=='mov': value=read(a[1],'u');typ='u'
        elif op=='movc': value=np.where(read(a[1],'u')!=0,read(a[2],'u'),read(a[3],'u'));typ='u'
        elif op.startswith('sample'):
            slot,swizzle=a[2].split('.'); sample=textures(slot,read(a[1]),False)
            value=np.asarray(sample,np.float32)[['xyzw'.index(c) for c in swizzle]]
        elif op=='resinfo_indexable':
            slot,swizzle=a[2].split('.');value=np.asarray(textures(slot,read(a[1]),True),np.float32)[['xyzw'.index(c) for c in swizzle]]
        elif op=='sincos':
            # Both results read the original operand, even when a destination
            # aliases it. Register writes must not change the cosine input.
            angle=read(a[2])
            write(a[0],np.sin(angle));write(a[1],np.cos(angle));continue
        elif op=='imul':
            write(a[0],[0]*4,'u');write(a[1],[0]*4,'u');continue
        elif op.startswith('ld_'): value=np.ones(4,np.float32)
        elif op.startswith('deriv_'): value=np.zeros(4,np.float32)
        elif op.startswith('dp'):
            n=int(op[-1]); products=read(a[1])[:n]*read(a[2])[:n]
            value=np.full(4,np.sum(products,dtype=np.float32),np.float32)
        elif op in ('ftou','ftoi','utof','itof'):
            typ={'ftou':'u','ftoi':'i','utof':'f','itof':'f'}[op]
            value=read(a[1],{'ftou':'f','ftoi':'f','utof':'u','itof':'i'}[op]).astype({'f':np.float32,'i':np.int32,'u':np.uint32}[typ])
        elif op in ('and','or','ishl','umin','iadd','imad'):
            typ='i' if op.startswith('i') and op!='ishl' else 'u'; x,y=read(a[1],typ),read(a[2],typ)
            if op=='and':value=x&y
            elif op=='or':value=x|y
            elif op=='ishl':value=x<<(y&31)
            elif op=='umin':value=np.minimum(x,y)
            elif op=='iadd':value=x+y
            else:value=x*y+read(a[3],typ)
        else:
            x=read(a[1]);y=read(a[2]) if len(a)>2 else None
            if op in ('lt','ge','ne','eq'):
                fn={'lt':np.less,'ge':np.greater_equal,'ne':np.not_equal,'eq':np.equal}[op]
                value=np.where(fn(x,y),np.uint32(0xffffffff),np.uint32(0));typ='u'
            elif op=='add':value=x+y
            elif op=='mul':value=x*y
            elif op=='div':value=x/y
            elif op=='mad':value=x*y+read(a[3])
            elif op=='min':value=np.minimum(x,y)
            elif op=='max':value=np.maximum(x,y)
            elif op=='sqrt':value=np.sqrt(x)
            elif op=='rsq':value=1/np.sqrt(x)
            elif op=='rcp':value=1/x
            elif op=='frc':value=x-np.floor(x)
            elif op=='round_ni':value=np.floor(x)
            elif op=='round_pi':value=np.ceil(x)
            elif op=='log':value=np.log2(x)  # D3D log: base 2, NaN below zero, -inf at zero
            elif op=='exp':value=np.exp2(x)
            else:raise ValueError(f'Unknown reference opcode {op}')
        if saturated:
            if typ!='f': value=value.view(np.float32)
            value=np.clip(value,0,1);typ='f'
        write(a[0],value,typ)
        if f0_check:
            base,metal=f0_check['base'],f0_check['metal']
            if not np.allclose(read(a[0]),(base-.04)*metal+.04,rtol=0,atol=1e-6):
                raise AssertionError('Folded F0 sequence is not lerp(0.04, base colour, metalness)')
            if 'specular' in result: raise AssertionError('Ambiguous specular anchor')
            result['specular']=np.full(1,.04/.08,np.float32); f0_anchor=(base,metal); f0_check=None
    result['baseColor']=read('o3.xyzx')[:3];result['metalness']=read('o2.x')[:1]
    if f0_anchor is not None and not (np.allclose(f0_anchor[0],result['baseColor'],rtol=0,atol=1e-6)
                                      and np.isclose(f0_anchor[1],result['metalness'][0],rtol=0,atol=1e-6)):
        raise AssertionError('Folded F0 does not read the emitted base colour and metalness')
    return result


def evaluate_nodes(sliced,textures,uv,view_tangent=None):
    uv=np.asarray(uv,np.float32)
    if view_tangent is not None: view_tangent=np.asarray(view_tangent,np.float32)
    cache={}
    def evaluate(n):
        if n in cache:return cache[n]
        if n.op=='const':return n.value
        if n.op=='input':
            return view_tangent['xyz'.index(n.value[-1])] if n.value.startswith('viewTangent.') else uv[int(n.value[2])*2+'xy'.index(n.value[-1])]
        if n.op=='select':
            value=evaluate(n.args[1] if evaluate(n.args[0]) else n.args[2]);cache[n]=value;return value
        a=[evaluate(x) for x in n.args];op=n.op
        if op=='sample': value=np.array(textures(n.value[0],a,False),np.float32)
        elif op=='component':value=a[0][n.value]
        elif op in ('dfdx','dfdy'):value=0
        elif op=='cast':
            raw=struct.pack('<f',a[0]) if n.args[0].type=='f' else struct.pack('<I',int(a[0])&0xffffffff)
            value=struct.unpack({'f':'<f','u':'<I','i':'<i'}[n.type],raw)[0]
        elif op=='convert':value=float(a[0]) if n.type=='f' else int(a[0])
        else:
            functions={'add':lambda:a[0]+a[1],'mul':lambda:a[0]*a[1],'div':lambda:a[0]/a[1],
                       'min':lambda:min(a),'max':lambda:max(a),'neg':lambda:-a[0],'abs':lambda:abs(a[0]),
                       'floor':lambda:np.floor(a[0]),'ceil':lambda:np.ceil(a[0]),'fract':lambda:a[0]-np.floor(a[0]),
                       'sin':lambda:np.sin(a[0]),'cos':lambda:np.cos(a[0]),'sqrt':lambda:np.sqrt(a[0]),
                       'log2':lambda:np.log2(a[0]),'exp2':lambda:np.exp2(a[0]),
                       'rsq':lambda:1/np.sqrt(a[0]),'rcp':lambda:1/a[0],
                       'and':lambda:int(a[0])&int(a[1]),'or':lambda:int(a[0])|int(a[1]),'shl':lambda:(int(a[0])<<(int(a[1])&31))&0xffffffff,
                       'lt':lambda:0xffffffff if a[0]<a[1] else 0,'ge':lambda:0xffffffff if a[0]>=a[1] else 0,
                       'eq':lambda:0xffffffff if a[0]==a[1] else 0,'ne':lambda:0xffffffff if a[0]!=a[1] else 0}
            value=functions[op]()
        if n.type=='f': value=np.float32(value)
        cache[n]=value;return value
    return {name:np.array([evaluate(n) for n in nodes],np.float32) for name,nodes in sliced.outputs.items()}


def check_exports(exports,requests=None,materials=None):
    report=[]; fixtures=[]
    for item_id,name,owner,chain in builder.material_inputs(exports,requests):
        stem=owner+'.SP_PCD3D_SM5'
        constants,params=builder.material_constants(builder.read_json(exports/(stem+'.uniforms.json')),chain)
        cloth=any(any(value) for key,value in params.items() if key.endswith('_ShadeAsCloth'))
        geometry_dependent=chain[0]['Name']=='M_Character_8Layers_Master'
        skin=chain[0]['Name'] in ('M_Skin','M_Face')
        surface_kind={'M_EyeRefractive_2':'eye','M_Teeth':'teeth','M_EyelashMaster':'eyelash',
                      'M_Hair_Metahuman_01':'hair'}.get(chain[0]['Name'])
        world_surface=skin or surface_kind is not None
        assembly=(exports/'shaders'/(stem+'.basepass-pixel.dxbc.asm')).read_text()
        binding_info=builder.read_json(exports/'bindings'/(stem+'.basepass-pixel.bindings.json'))
        bindings=binding_info['textureBindings']
        material_buffer=binding_info['materialBufferIndex']
        by_slot={b['slot']:b['parameter'] for b in bindings}
        info={slot:{'width':1024,'height':1024,'depth':5,'mipCount':11,'array':param.startswith('TextureArray')} for slot,param in by_slot.items()}
        manifest=None
        if materials is not None:
            manifest=builder.read_json(materials/(item_id+'.json'))
            for texture in manifest['textures']:
                info[texture['slot']]={'width':texture['mips'][0]['width'],'height':texture['mips'][0]['height'],
                                      'depth':texture['depth'],'mipCount':len(texture['mips']),'array':texture['array'],
                                      'cube':texture.get('cube',False)}
        sliced=Slice(assembly,constants,info,view_dependent=cloth,geometry_dependent=geometry_dependent,
                     skin_surface=skin,surface_kind=surface_kind,material_buffer=material_buffer,
                     neck_fade=builder.neck_fade_inputs(chain,binding_info,constants) if manifest and manifest.get('skinCoverage') else None); sliced.emit()
        max_error=0.;cases=0
        layers=range(1,5) if world_surface else range(1,1+sum(key.endswith('_ShadeAsCloth') for key in params)) if requests else (1,2)
        for layer in layers:
            def texture(slot,coords,dimensions):
                dimensions_info=info.get(slot,{'width':1024,'height':1024,'depth':5,'mipCount':11})
                if dimensions:return [dimensions_info[key] for key in ('width','height','depth','mipCount')]
                parameter=by_slot.get(slot,'')
                if dimensions_info.get('cube'):
                    axis=int(np.argmax(np.abs(coords[:3])))
                    face=axis*2+int(coords[axis]<0)
                    return [.07+.08*face,.15+.1*layer,.43-.04*face,1]
                if world_surface:
                    if any(key in parameter.lower() for key in ('normal','microdetail')): return [.52+.025*layer,.43, .7, .32+.12*layer]
                    if any(key in parameter.lower() for key in ('mask','occlusion','cavity')):return [.13*layer,.18*layer,.14*layer,.21*layer]
                    return [.18+.08*layer,.15+.06*layer,.12+.04*layer,.3+.12*layer]
                if parameter=='OcclusionCurvatureMaterialID':return [.83,.42,layer/8,1]
                if parameter=='Normal' or 'Normals' in parameter or 'DecalData' in parameter:return [.56,.43,0,1]
                if 'Masks' in parameter:
                    # Flat masks (including ComplexDecal_Masks) have UV only.
                    # A parameter name does not establish an array layer axis.
                    layer_index=max(0,min(dimensions_info['depth']-1,int(np.floor(float(coords[2])+.5)))) if dimensions_info.get('array') else 0
                    return [.22+min(4,layer_index)*.09,0,0,1]
                if parameter=='ColorMask':return [1,.2,.1,1]
                if 'DecalColor' in parameter:return [.6,.3,.2,.7]
                return [.38,.49,.61,1]
            for case,uv in enumerate(([.1,.2,.7,.3],[.43,.24,.71,.36],[1.4,.25,1.7,-.3],[-.4,.2,-.7,.4],[2.4,.8,2.5,2.1],[3.4,.2,.1,.5])):
                view=([0,0,3],[3,0,.1],[.5,2,-.3])[case%3] if cloth else None
                # The reference runs the original world-space instructions in
                # multiple rotated frames; the slice uses tangent-space inputs.
                angle=case*.63; c,s=np.cos(angle),np.sin(angle)
                basis=np.array([[c,0,s],[0,1,0],[-s,0,c]])
                geometry=None
                if geometry_dependent or world_surface:
                    center=np.array([.5,.5,165.5] if world_surface else [.5,.5,.5],np.float32)
                    camera=center+basis@np.array(([4,15,6],[20,-.2,-8],[-3,7,20])[case%3] if world_surface else view if view is not None else [.5,.5,4])
                    geometry=[]
                    for x,y in [(0,0),(1,0),(0,1),(1,1)]:
                        position=center+basis@np.array([x*.15,y*.15,0])
                        geometry.append({'position':position.tolist(),'tangent':basis[:,0].tolist(),
                            'normal':(basis@np.array([x*.025,y*-.018,1])).tolist(),
                            'handedness':1 if case%2==0 else -1,'view':(camera-position).tolist(),
                            **({'objectPosition':(center+np.array([.1,-.3,-5.8])).tolist()} if world_surface else {}),
                            **({'color':[.12+.12*case,.18+.2*x,.4+.1*y,.8]} if surface_kind=='hair' else {})})
                with np.errstate(all='ignore'):
                    if geometry_dependent or world_surface:
                        expected=forward_quad(assembly,constants,texture,uv,geometry,camera,skin_surface=skin,
                                              surface_kind=surface_kind,material_buffer=material_buffer,neck_fade=sliced.neck_fade)
                        actual=evaluate_quad(sliced,texture,uv,geometry)
                    else:
                        expected=forward(assembly,constants,texture,uv,view,basis);actual=evaluate_nodes(sliced,texture,uv,view)
                for key in expected:
                    if not np.isfinite(expected[key]).all() or not np.isfinite(actual[key]).all(): raise AssertionError(f'{name}/{key}: nonfinite result')
                    error=float(np.max(np.abs(expected[key]-actual[key])));max_error=max(max_error,error)
                    if error>2e-5:raise AssertionError(f'{name}/{key}: {expected[key]} != {actual[key]} ({error})')
                fixtures.append({'itemId':item_id, 'uv':list(uv), 'viewTangent':view,
                                 **({'geometry':geometry} if geometry is not None else {}),
                                 'textures':{slot:[texture(slot,coords,False) for coords in
                                     ([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] if info[slot].get('cube') else
                                      [[0,0,z] for z in range(info[slot]['depth'] if info[slot]['array'] else 1)])] for slot in by_slot},
                                 **({'shaderSha256':manifest['shaderSha256']} if manifest else {}),
                                 **({'coverageShaderSha256':manifest['coverageShaderSha256']} if manifest and 'coverageShaderSha256' in manifest else {}),
                                 'expected':{key:value.tolist() for key,value in expected.items()}})
                cases+=1
        report.append({'itemId':item_id,'material':name,'cases':cases,'maxAbsoluteError':max_error})
        print(f'{name}: {cases} forward/sliced comparisons passed; max error {max_error:.3g}')
    (exports/'translation-fixtures.json').write_text(json.dumps(fixtures,indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--exports',type=Path,required=True);parser.add_argument('--requests',type=Path)
    parser.add_argument('--materials',type=Path,help='Use built texture dimensions and bind fixtures to the emitted shader hash')
    a=parser.parse_args()
    report=check_exports(a.exports,a.requests,a.materials)
    (a.exports/'translation-checks.json').write_text(json.dumps(report,indent=2))
