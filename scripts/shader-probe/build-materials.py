"""Build local, generated WebGL material slices and losslessly packed cooked mipmaps.

Requires Pillow for its BC1/3/4/5/7 decoder. No image fitting, roughness floors or
normal-strength tuning is performed here. The source files remain ignored assets.
"""
import argparse
import base64
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path

from PIL import Image
from sm5_slice import Slice, f32
from material_inputs import material_inputs, texture_paths, neck_fade_inputs


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def evaluate_preshader(data, parameters):
    cursor,stack=0,[]
    def read(fmt):
        nonlocal cursor
        value=struct.unpack_from(fmt,data,cursor); cursor+=struct.calcsize(fmt)
        return value
    unary={13:math.sin,14:math.cos,22:math.sqrt,23:lambda x:1/x if x else math.inf,
           26:lambda x:max(0,min(1,x)),27:abs,28:math.floor,29:math.ceil,47:lambda x:-x}
    binary={4:lambda a,b:a+b,5:lambda a,b:a-b,6:lambda a,b:a*b,
            7:lambda a,b:a/b if b else math.inf,8:math.fmod,10:min,11:max}
    while cursor<len(data):
        op,=read('<B')
        if op==3:
            idx,=read('<H'); stack.append(parameters[idx])
        elif op==2:
            kind,=read('<B'); width=(kind-1)%4+1
            if not 1<=kind<=4: raise ValueError(f'Unsupported numeric preshader constant {kind}')
            stack.append(list(read('<'+'f'*width)))
        elif op==37:
            count,*swizzle=read('<5B'); value=stack.pop(); stack.append([value[i] for i in swizzle[:count]])
        elif op==38:
            b,a=stack.pop(),stack.pop(); stack.append(a+b)
        elif op in unary:
            stack.append([f32(unary[op](x)) for x in stack.pop()])
        elif op in binary:
            b,a=stack.pop(),stack.pop(); width=max(len(a),len(b))
            if len(a) not in (1,width) or len(b) not in (1,width): raise ValueError('Preshader width mismatch')
            stack.append([f32(binary[op](a[i%len(a)],b[i%len(b)])) for i in range(width)])
        else: raise ValueError(f'Unsupported numeric preshader opcode {op}')
    if cursor!=len(data) or len(stack)!=1: raise ValueError('Invalid numeric preshader stack/span')
    return stack[0]


def material_constants(uniforms, chain):
    overrides={}
    for material in chain:
        for group in ('ScalarParameterValues','VectorParameterValues'):
            for entry in material['Properties'].get(group,[]):
                info=entry['ParameterInfo']
                if info['Index']!=-1 or 'GlobalParameter' not in info['Association']:
                    raise ValueError('Only global parameters are supported')
                overrides[info['Name']]=entry['ParameterValue']
    values,parameter_report=[],{}
    for parameter in uniforms['UniformNumericParameters']:
        name=parameter['ParameterInfo']['Name']; value=overrides.get(name,parameter['Value'])
        components=[value[k] for k in 'RGBA'] if isinstance(value,dict) else [value]
        values.append([f32(v) for v in components]); parameter_report[name]=components
    # Emissive engine paths are outside this surface slice. Cloth instances pass
    # the camera vector through to their original view-dependent specular inputs.
    for name,value in parameter_report.items():
        if 'EmissiveStrength' in name and any(value):
            raise ValueError(f'This surface slice does not support active {name}')
    data=base64.b64decode(uniforms['UniformPreshaderData']['Data'],validate=True)
    result=[0.]*(uniforms['UniformPreshaderBufferSize']*4)
    occupied=set()
    for p in uniforms['UniformPreshaders']:
        start,size=p['OpcodeOffset'],p['OpcodeSize']; expression=evaluate_preshader(data[start:start+size],values)
        for field in uniforms['UniformPreshaderFields'][p['FieldIndex']:p['FieldIndex']+p['NumFields']]:
            width=int(field['Type'][-1]); start=field['BufferOffset']; component=field['ComponentIndex']
            if not field['Type'].startswith('Float') or component+width>len(expression): raise ValueError('Invalid numeric field')
            for i in range(width):
                if start+i in occupied: raise ValueError('Overlapping numeric field')
                result[start+i]=expression[component+i]; occupied.add(start+i)
    return result,parameter_report


def decode_mip(raw, width, height, depth, fmt):
    if fmt in ('PF_B8G8R8A8','PF_G8'):
        channels=4 if fmt=='PF_B8G8R8A8' else 1
        if len(raw)!=width*height*depth*channels: raise ValueError('Invalid uncompressed mip byte count')
        if channels==4:
            return Image.frombytes('RGBA',(width,height*depth),raw,'raw','BGRA').tobytes()
        g=Image.frombytes('L',(width,height*depth),raw); one=Image.new('L',g.size,255)
        return Image.merge('RGBA',(g,g,g,one)).tobytes()
    codecs={'PF_DXT1':(1,'DXT1','RGBA',8),'PF_DXT5':(3,'DXT5','RGBA',16),
            'PF_BC4':(4,'BC4','L',8),'PF_BC5':(5,'BC5','RGB',16),'PF_BC7':(7,'BC7','RGBA',16)}
    number,name,mode,block_bytes=codecs[fmt]
    size=max(1,(width+3)//4)*max(1,(height+3)//4)*block_bytes
    if len(raw)!=size*depth: raise ValueError(f'Invalid {fmt} mip byte count {len(raw)} != {size*depth}')
    decoded=[]
    for z in range(depth):
        im=Image.frombytes(mode,(width,height),raw[z*size:(z+1)*size],'bcn',(number,name))
        if fmt=='PF_BC4':
            zero=Image.new('L',im.size,0); one=Image.new('L',im.size,255)
            im=Image.merge('RGBA',(im,zero,zero,one))
        else: im=im.convert('RGBA')
        decoded.append(im.tobytes())
    return b''.join(decoded)


def pack_texture(info, texture_root, output):
    chunks,levels,offset=[],[],0
    for m in info['mips']:
        raw=(texture_root/m['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest().upper()!=m['sha256']: raise ValueError('Cooked mip hash mismatch')
        if info['format']=='PF_BC6H':
            import numpy as np
            hdr=m.get('decoded')
            if not hdr or hdr['format']!='RGBA16F': raise ValueError('BC6H requires the preserved half-float decode; re-export textures')
            decoded=(texture_root/hdr['file']).read_bytes()
            if hashlib.sha256(decoded).hexdigest().upper()!=hdr['sha256']: raise ValueError('HDR mip hash mismatch')
            if len(decoded)!=m['width']*m['height']*info['slices']*8: raise ValueError('HDR mip byte count mismatch')
            if not np.isfinite(np.frombuffer(decoded,dtype='<f2')).all(): raise ValueError('Nonfinite HDR mip')
        else:
            decoded=decode_mip(raw,m['width'],m['height'],info['slices'],info['format'])
        chunks.append(decoded); levels.append({'width':m['width'],'height':m['height'],'offset':offset,'bytes':len(decoded)})
        offset+=len(decoded)
    # A .gz suffix makes Vite advertise Content-Encoding:gzip, so fetch would
    # decompress it before our explicit decoder. Use an opaque payload suffix.
    data=b''.join(chunks); name=info['id']+'.rgba.gz.bin'
    (output/name).write_bytes(gzip.compress(data,compresslevel=6,mtime=0))
    return {'id':info['id'],'file':name,'array':info['type']=='UTexture2DArray','depth':info['slices'],
            **({'cube':True} if info['type']=='UTextureCube' else {}),
            **({'componentType':'float16'} if info['format']=='PF_BC6H' else {}),
            'srgb':info['srgb'],'wrapS':info['wrapS'],'wrapT':info['wrapT'],'mips':levels,
            'sha256':hashlib.sha256(data).hexdigest(),'source':info['path'],'sourceFormat':info['format']}


def build(exports, textures, output, requests=None, keep_going=False):
    output.mkdir(parents=True,exist_ok=True)
    tex_info={t['path']:t for t in read_json(textures/'textures.json')}; packed={}
    reports=[]; errors=[]
    def build_one(item_id,instance,owner,chain):
        stem=owner+'.SP_PCD3D_SM5'
        uniforms=read_json(exports/(stem+'.uniforms.json'))
        bindings=read_json(exports/'bindings'/(stem+'.basepass-pixel.bindings.json'))
        constants,parameters=material_constants(uniforms,chain)
        slots={}
        for slot,path in texture_paths(chain,bindings):
            if path in tex_info:
                t=tex_info[path]; first=t['mips'][0]
                slots[slot]={'path':path,'width':first['width'],'height':first['height'],
                                 'depth':t['slices'],'mipCount':len(t['mips']),'array':t['type']=='UTexture2DArray','cube':t['type']=='UTextureCube'}
        assembly_path=exports/'shaders'/(stem+'.basepass-pixel.dxbc.asm')
        cloth=any(any(value) for name,value in parameters.items() if name.endswith('_ShadeAsCloth'))
        geometry=chain[0]['Name']=='M_Character_8Layers_Master'
        skin=chain[0]['Name'] in ('M_Skin', 'M_Face')
        kind={'M_EyeRefractive_2':'eye','M_Teeth':'teeth','M_EyelashMaster':'eyelash','M_Hair_Metahuman_01':'hair'}.get(chain[0]['Name'])
        sliced=Slice(assembly_path.read_text(),constants,slots,view_dependent=cloth,geometry_dependent=geometry,skin_surface=skin,
                     surface_kind=kind,material_buffer=bindings['materialBufferIndex'],neck_fade=neck_fade_inputs(chain,bindings,constants))
        shader,used,report=sliced.emit()
        entries=[]
        for slot in used:
            path=slots[slot]['path']
            if path not in packed: packed[path]=pack_texture(tex_info[path],textures,output)
            entries.append({'slot':slot,**packed[path]})
        shader_name=item_id+'.glsl'; (output/shader_name).write_bytes(shader.encode('utf8'))
        manifest={'formatVersion':1,'itemId':item_id,'shader':shader_name,'textures':entries,
                  'sourceInstance':instance,'sourceShaderOwner':owner,'sourceRoot':chain[0]['Name'],'shaderSha256':hashlib.sha256(shader.encode()).hexdigest(),
                  'assemblySha256':hashlib.sha256(assembly_path.read_bytes()).hexdigest(),
                  'scope':'Static face/hair material inputs; engine effects, temporal rendering and Unreal lighting excluded' if kind else 'Static skin surface channels; native opacity, pixel depth offset, engine effects and subsurface lighting excluded' if skin else 'Static opaque clothing surface; engine effects and Unreal lighting excluded',**report}
        overlays = [m['Package'] + '.' + m['Name'] for m in chain if m.get('_parameterOverride')]
        if overlays: manifest['parameterOverrides'] = overlays
        if kind:
            two_sided=chain[0]['Properties'].get('TwoSided',False)
            for material in chain[1:]:
                override=material['Properties'].get('BasePropertyOverrides',{})
                if override.get('bOverride_TwoSided'): two_sided=override['TwoSided']
            manifest['twoSided']=two_sided
        if kind in ('eyelash','hair') or sliced.neck_fade:
            coverage,_,coverage_report=sliced.emit(['opacity'])
            coverage_name=item_id+'.coverage.glsl'
            (output/coverage_name).write_bytes(coverage.encode('utf8'))
            manifest.update({'coverageShader':coverage_name,'coverageShaderSha256':hashlib.sha256(coverage.encode()).hexdigest(),
                             'coverageGeometryFields':coverage_report['requiredGeometryFields']})
        (output/(item_id+'.json')).write_text(json.dumps(manifest,indent=2),encoding='utf8')
        reports.append({'itemId':item_id,'textures':len(used),**report})
        print(f'{item_id}: {report["scalarNodes"]} live nodes, {len(used)} textures')
    for job in material_inputs(exports,requests):
        try:
            build_one(*job)
        except Exception as error:
            if not keep_going: raise
            errors.append({'itemId':job[0],'instance':job[1],'error':str(error)})
            print(f'UNSUPPORTED {job[0]}: {error}')
    (output/'build-report.json').write_text(json.dumps(reports,indent=2),encoding='utf8')
    (output/'build-errors.json').write_text(json.dumps(errors,indent=2),encoding='utf8')
    return not errors


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--exports',type=Path,required=True)
    parser.add_argument('--requests',type=Path)
    parser.add_argument('--keep-going',action='store_true',help='Record unsupported instances and continue the batch; exit nonzero if any fail')
    parser.add_argument('--textures',type=Path,required=True); parser.add_argument('--output',type=Path,required=True)
    a=parser.parse_args()
    if 'public/models' not in a.output.resolve().as_posix() and 'scripts/generated' not in a.output.resolve().as_posix():
        raise ValueError('Generated game assets must stay in an ignored asset directory')
    if not build(a.exports,a.textures,a.output,a.requests,a.keep_going): raise SystemExit(1)
