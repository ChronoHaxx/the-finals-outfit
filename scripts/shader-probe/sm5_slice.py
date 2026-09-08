"""Dependency slicing for Microsoft's SM5 disassembly, deliberately a bounded subset.

Register lanes retain their 32-bit types. Unsupported instructions and engine inputs
may be parsed but must be unreachable from the selected surface outputs. Generated
shader expressions belong with local extracted assets, never in the source tree.
"""
import math
import re
import struct
from dataclasses import dataclass


def f32(x):
    try:
        return struct.unpack('<f', struct.pack('<f', x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


@dataclass(eq=False)
class Node:
    op: str
    args: tuple = ()
    type: str = 'f'
    value: object = None
    line: int = 0


def const(value, kind='f'):
    return Node('const', type=kind, value=f32(value) if kind == 'f' else value)


def cast(n, kind):
    if n.type == kind:
        return n
    if n.op == 'const':
        bits = struct.unpack('<I', struct.pack('<f', n.value))[0] if n.type == 'f' else n.value & 0xffffffff
        value = struct.unpack('<f', struct.pack('<I', bits))[0] if kind == 'f' else bits
        if kind == 'i' and value >= 0x80000000:
            value -= 0x100000000
        return const(value, kind)
    return Node('cast', (n,), kind)


def operation(op, *args, kind='f', line=0):
    # Dead branches and neutral scalar factors are essential to exclude engine-only
    # paths. Surface inputs are finite; generated output rejects nonfinite constants.
    if op == 'select':
        if args[0].op == 'const':
            return args[1] if args[0].value != 0 else args[2]
        if args[1] is args[2]:
            return args[1]
    if op in ('add', 'mul'):
        for i in range(2):
            if args[i].op == 'const':
                if op == 'mul' and args[i].value == 0:
                    return const(0, kind)
                if args[i].value == (0 if op == 'add' else 1):
                    return args[1-i]
    if all(a.op == 'const' for a in args):
        v = [a.value for a in args]
        funcs = {
            'add': lambda: v[0]+v[1], 'mul': lambda: v[0]*v[1],
            'div': lambda: v[0]/v[1] if v[1] else math.copysign(math.inf, v[0]) if v[0] else math.nan,
            'min': lambda: min(v), 'max': lambda: max(v), 'neg': lambda: -v[0],
            'abs': lambda: abs(v[0]), 'sqrt': lambda: math.sqrt(v[0]),
            'rsq': lambda: 1/math.sqrt(v[0]), 'rcp': lambda: 1/v[0],
            'floor': lambda: math.floor(v[0]), 'ceil': lambda: math.ceil(v[0]),
            'fract': lambda: v[0]-math.floor(v[0]),
            'sin': lambda: math.sin(v[0]), 'cos': lambda: math.cos(v[0]),
            'lt': lambda: 0xffffffff if v[0]<v[1] else 0,
            'ge': lambda: 0xffffffff if v[0]>=v[1] else 0,
            'ne': lambda: 0xffffffff if v[0]!=v[1] else 0,
            'eq': lambda: 0xffffffff if v[0]==v[1] else 0,
            'and': lambda: v[0]&v[1], 'or': lambda: v[0]|v[1],
            'shl': lambda: (v[0] << (v[1]&31)) & 0xffffffff,
            'convert': lambda: float(v[0]) if kind=='f' else int(v[0]),
        }
        if op in funcs:
            try:
                val = funcs[op]()
                if kind == 'u': val &= 0xffffffff
                if kind == 'i': val = (val+0x80000000) % 0x100000000 - 0x80000000
                return const(val, kind)
            except (ValueError, ZeroDivisionError, OverflowError):
                pass
    return Node(op, args, kind, line=line)


def split_operands(s):
    result, start, depth = [], 0, 0
    for i,c in enumerate(s):
        if c in '([': depth += 1
        if c in ')]': depth -= 1
        if c == ',' and depth == 0:
            result.append(s[start:i].strip()); start=i+1
    result.append(s[start:].strip())
    return result


class Slice:
    def __init__(self, text, constants, texture_info, view_dependent=False, geometry_dependent=False, skin_surface=False,
                 surface_kind=None, material_buffer=3, neck_fade=None):
        self.registers, self.outputs, self.texture_info = {}, {}, texture_info
        self.instructions, self.snapshots, self.branches = [], {}, []
        self.view_dependent = view_dependent
        self.geometry_dependent = geometry_dependent
        self.skin_surface = skin_surface
        self.neck_fade = neck_fade
        if neck_fade and not skin_surface: raise ValueError('Neck fade requires a skin surface')
        neck_gate_count = 0
        if surface_kind not in (None, 'eye', 'teeth', 'eyelash', 'hair'): raise ValueError('Unsupported surface kind')
        self.surface_kind = surface_kind
        self.world_surface = skin_surface or surface_kind is not None
        uses_geometry = geometry_dependent or self.world_surface
        geometry_anchors = 0
        camera_anchors = 0
        skin_camera_anchors = 0
        if view_dependent:
            # Evaluate the cloth dot product in the local tangent frame. Dot
            # products are invariant under an orthonormal change of basis; the
            # runtime supplies the camera vector in that same frame.
            for register, values in [('v0', [1,0,0,0]), ('v1', [0,0,1,1])]:
                for c, value in zip('xyzw', values): self.registers[f'{register}.{c}'] = const(value)
        if uses_geometry:
            # This family differentiates a height-displaced surface in world
            # centimetres before projecting its normal into the tangent frame.
            # Preserve those inputs; a constant tangent frame loses curvature.
            for semantic, register in [(10, 0), (11, 1)]:
                if not re.search(rf'// TEXCOORD\s+{semantic}\s+xyzw\s+{register}\s+NONE', text):
                    raise ValueError('Unrecognized geometry tangent input signature')
            for register, field in [('v0', 'tangent'), ('v1', 'normal')]:
                for c in 'xyz': self.registers[f'{register}.{c}'] = Node('input', value=f'geometry.{field}.{c}')
            self.registers['v1.w'] = Node('input', value='geometry.handedness')
        for i,v in enumerate(constants):
            self.registers[f'cb{material_buffer}[{i//4}].{"xyzw"[i%4]}'] = const(v)
        if self.world_surface:
            # Explicit preview view settings: no engine normal override or global
            # mip bias. Preserve material-local sample biases in the emitted code.
            for c, value in zip('xyzw', [0, 0, 0, 1]): self.registers[f'cb0[159].{c}'] = const(value)
            self.registers['cb0[164].y'] = const(0)
            for c in 'xyz': self.registers[f'cb0[121].{c}'] = const(0)
            primitive = re.search(r'// PRIMITIVE_ID\s+0\s+x\s+(\d+)\s+NONE\s+uint', text)
            if not primitive: raise ValueError('Missing skin primitive input signature')
            self.registers[f'v{primitive[1]}.x'] = const(0, 'u')
        uv_register = 3 if surface_kind == 'hair' else 2
        if surface_kind == 'hair':
            if not re.search(r'// COLOR\s+0\s+xyzw\s+2\s+NONE', text): raise ValueError('Unknown hair colour input signature')
            if not re.search(r'// TEXCOORD\s+0\s+xyzw\s+3\s+NONE', text): raise ValueError('Unknown hair UV input signature')
            for c in 'xyzw': self.registers[f'v2.{c}'] = Node('input', value=f'geometry.color.{c}')
        for i,c in enumerate('xyzw'):
            self.registers[f'v{uv_register}.{c}'] = Node('input', value=f'uv{i//2}.{ "xy"[i%2]}')
        for line,text_line in enumerate(text.splitlines(),1):
            self.line = line
            clean = re.sub(r'\s*\[precise(?:\([^]]*\))?\]', '', text_line.strip())
            m = re.match(r'(\w+)((?:\([^)]*\))*)\s*(.*)', clean)
            if not m or clean.startswith('//'): continue
            op, qualifiers, operand_text = m.groups()
            if op.startswith('dcl_') or op == 'ps_5_0': continue
            operands = split_operands(operand_text)
            self.instructions.append((line,op,operands,clean))
            # Material-side values immediately before UE view overrides / G-buffer
            # packing. These anchors must be unique in every accepted permutation.
            if op == 'mul' and 'cb0[159]' in clean:
                mask = self.destination(operands[0])[1]
                self.capture('normal', [self.read(operands[1])[i] for i in mask])
            if op == 'mad' and operands[0] == 'o2.z':
                self.capture('roughness',[self.read(operands[1])[2]])
            if op == 'mad_sat' and 'cb0[160].w' in clean:
                self.capture('ao',[self.read(operands[1])[self.destination(operands[0])[1][0]]])
            if self.world_surface and op == 'add_sat' and operands[1:] == ['cb0[160].z', 'cb0[160].w']:
                self.capture('ao', [const(1)])
            if skin_surface and op == 'mad_sat' and 'cb0[157].wwww' in operands:
                self.capture('subsurfaceColor', [self.read(operands[1])[i] for i in self.destination(operands[0])[1]])
            if op == 'mul' and 'l(0.080000)' in clean:
                self.capture('specular',[self.read(operands[1])[0]])
            if surface_kind == 'eyelash' and op == 'mov' and operands == ['o2.y', 'l(0)']:
                self.capture('specular', [const(0)])
            self.execute(op,operands,qualifiers)
            previous = self.instructions[-2] if len(self.instructions) > 1 else None
            if neck_fade and op == 'mul_sat' and len(operands) == 3 and operands[2] == neck_fade['amount']:
                # Retain the exact sample and saturated gain, before the engine's
                # temporal noise is added. Do not mistake diffuse alpha for this mask.
                if (not previous or not previous[1].startswith('sample_b')
                        or previous[2][0] != operands[1]
                        or previous[2][2].split('.')[0] != neck_fade['texture']
                        or len(self.destination(operands[0])[1]) != 1):
                    raise ValueError('Unknown neck-fade sample/gain anchor')
                gain = self.read(operands[0], 'f')[0]
                enabled = self.read(neck_fade['enabled'], 'f')[0]
                # The source gates its dithered fade with 1 + enabled*(fade-1).
                # Apply that gate to the undithered coverage in this preview.
                self.capture('opacity', [operation('add', const(1), operation('mul', enabled,
                    operation('add', gain, const(-1))))])
            if neck_fade and op == 'mad' and len(operands) == 4 and operands[1] == neck_fade['enabled']:
                if operands[0] != operands[2] or operands[3] != 'l(1.000000)':
                    raise ValueError('Unknown neck-fade enable anchor')
                neck_gate_count += 1
            if (surface_kind in ('eyelash', 'hair') and op == 'movc' and len(operands) == 4
                    and operands[2] == 'l(0)' and operands[0] == operands[3] and previous
                    and previous[1] == 'mul' and previous[2][:2] == [operands[0], operands[0]]
                    and previous[2][2].startswith(f'cb{material_buffer}[')):
                # Material coverage after power/gain, before temporal dither and
                # engine dissolve/impact masks. Require a unique observed anchor.
                self.capture('opacity', [self.read(operands[0], 'f')[0]])
            if self.world_surface and op == 'movc' and len(operands) == 4 and operands[2] == '-cb0[73].xyzx':
                if self.destination(operands[0])[1] != [0, 1, 2]: raise ValueError('Invalid skin camera anchor')
                view = [Node('input', value=f'geometry.view.{c}') for c in 'xyz']
                squares = [operation('mul', n, n) for n in view]
                length_inverse = operation('rsq', operation('add', operation('add', squares[0], squares[1]), squares[2]))
                self.write(operands[0], [operation('mul', n, length_inverse) for n in view] + [const(0)])
                skin_camera_anchors += 1
            if uses_geometry and op == 'add' and len(operands) == 3:
                origin = re.fullmatch(r'-cb0\[124\]\.([xyzw]{4})', operands[2])
                if origin:
                    mask = self.destination(operands[0])[1]
                    if sorted(origin[1][i] for i in mask) != list('xyz'):
                        raise ValueError('Invalid geometry position anchor')
                    self.write(operands[0], [Node('input', value=f'geometry.position.{c}') if c in 'xyz' else const(0)
                                             for c in origin[1]])
                    geometry_anchors += 1
            if (view_dependent or self.world_surface) and op == 'add' and len(operands) == 3:
                camera = re.fullmatch(r'cb0\[122\]\.([xyzw]{4})', operands[2])
                position = re.fullmatch(r'-r\d+\.([xyzw]{4})', operands[1])
                if camera and position:
                    mask = self.destination(operands[0])[1]
                    if sorted(camera[1][i] for i in mask) != list('xyz') or len({position[1][i] for i in mask}) != 3:
                        raise ValueError('Invalid cloth camera anchor')
                    # The compiler can store XYZ in any three register lanes.
                    # Keep its destination mask and camera swizzle so later
                    # normalization and dot products see the same vector.
                    field = 'geometry.view' if uses_geometry else 'viewTangent'
                    self.write(operands[0], [Node('input', value=f'{field}.{c}') if c in 'xyz' else const(0)
                                             for c in camera[1]])
                    camera_anchors += 1
        if self.branches: raise ValueError('Unclosed control flow')
        if view_dependent and camera_anchors != 1: raise ValueError(f'Expected one cloth camera anchor, got {camera_anchors}')
        if uses_geometry and geometry_anchors != 1: raise ValueError(f'Expected one geometry position anchor, got {geometry_anchors}')
        if self.world_surface and skin_camera_anchors != 1: raise ValueError(f'Expected one skin camera anchor, got {skin_camera_anchors}')
        if neck_fade and neck_gate_count != 1: raise ValueError('Expected one neck-fade enable anchor')
        self.capture('baseColor',[self.registers[f'o3.{c}'] for c in 'xyz'])
        self.capture('metalness',[const(0) if surface_kind == 'hair' else self.registers['o2.x']])
        if surface_kind == 'hair': self.capture('scatter', [self.registers['o2.x']])
        required = {'normal','roughness','ao','specular','baseColor','metalness'}
        if skin_surface: required.add('subsurfaceColor')
        if neck_fade: required.add('opacity')
        if surface_kind in ('eyelash', 'hair'): required.add('opacity')
        if surface_kind == 'hair': required.add('scatter')
        if set(self.outputs) != required: raise ValueError(f'Missing surface anchors: {required-set(self.outputs)}')

    def capture(self,name,nodes):
        if name in self.outputs: raise ValueError(f'Ambiguous {name} anchor')
        self.outputs[name] = nodes

    @staticmethod
    def destination(s):
        m=re.fullmatch(r'([ro]\d+|oDepthLE|x\d+\[\d+\])(?:\.([xyzw]+))?',s)
        if not m: raise ValueError(f'Invalid destination {s}')
        return m[1], ['xyzw'.index(c) for c in (m[2] or 'xyzw')]

    def read(self,s,kind=None):
        neg=s.startswith('-')
        if neg: s=s[1:]
        absolute=s.startswith('|') and s.endswith('|')
        if absolute: s=s[1:-1]
        if s.startswith('l('):
            values=split_operands(s[2:-1]); nodes=[]
            for v in values:
                is_float='.' in v or ('e' in v.lower() and not v.startswith('0x'))
                nodes.append(const(float(v), 'f') if is_float else const(int(v,0), 'u'))
            if len(nodes)==1: nodes*=4
        else:
            m=re.fullmatch(r'((?:[rvo]\d+|(?:cb|x)\d+\[\d+\]))(?:\.([xyzw]+))?',s)
            indexed=re.fullmatch(r'(x\d+)\[(r\d+\.[xyzw]) \+ (\d+)\]\.([xyzw]+)',s)
            if indexed:
                # Keep dynamic array reads explicit. A live lookup is rejected until
                # its index semantics are supported; dead engine paths can be sliced.
                nodes=[Node('unsupported',value=f'indexable read:{s}',line=self.line)]*4
                if kind: nodes=[cast(n,kind) for n in nodes]
                return nodes
            if not m: raise ValueError(f'Invalid operand {s} at {self.line}')
            base,swizzle=m[1],m[2] or 'xyzw'
            if len(swizzle)==1: swizzle*=4
            if len(swizzle)!=4: raise ValueError(f'Invalid source swizzle {s}')
            nodes=[self.registers.get(f'{base}.{c}',Node('external',value=f'{base}.{c}',line=self.line)) for c in swizzle]
        if kind: nodes=[cast(n,kind) for n in nodes]
        if absolute: nodes=[operation('abs',n,kind=n.type,line=self.line) for n in nodes]
        if neg: nodes=[operation('neg',n,kind=n.type,line=self.line) for n in nodes]
        return nodes

    def write(self,destination,nodes,sat=False):
        if destination=='null': return
        base,mask=self.destination(destination)
        for i in mask:
            n=nodes[i]
            if sat: n=operation('min',operation('max',cast(n,'f'),const(0)),const(1))
            self.registers[f'{base}.{"xyzw"[i]}']=n

    def execute(self,op,a,q):
        mk=lambda name,*ns,kind='f': operation(name,*ns,kind=kind,line=self.line)
        if op in ('if_nz','if_z'):
            cond=self.read(a[0],'u')[0]
            if op=='if_z': cond=mk('eq',cond,const(0,'u'),kind='u')
            self.branches.append([cond,self.registers.copy(),None]); return
        if op=='else':
            self.branches[-1][2]=self.registers.copy()
            self.registers=self.branches[-1][1].copy(); return
        if op=='endif':
            cond,before,yes=self.branches.pop()
            yes,no=(yes,self.registers) if yes is not None else (self.registers,before)
            merged={}
            for key in yes.keys()|no.keys():
                y=yes.get(key,Node('external',value=f'uninitialized:{key}'))
                n=no.get(key,Node('external',value=f'uninitialized:{key}'))
                merged[key]=mk('select',cond,y,cast(n,y.type),kind=y.type)
            self.registers=merged; return
        if op in ('ret','discard_nz'): return
        sat=op.endswith('_sat'); op=op.removesuffix('_sat')
        if op.startswith('sample'):
            coord=self.read(a[1],'f'); slot,swiz=a[2].split('.')
            dim=3 if 'texture2darray' in q or 'texturecube' in q else 2
            if 'texturecube' in q and not self.texture_info.get(slot, {}).get('cube'): raise ValueError('Missing cube texture metadata')
            args=list(coord[:dim]); mode='implicit'
            if op=='sample_l_indexable': args+=self.read(a[4],'f')[:1]; mode='lod'
            elif op=='sample_b_indexable': args+=self.read(a[4],'f')[:1]; mode='bias'
            elif op=='sample_d_indexable': args+=self.read(a[4],'f')[:dim]+self.read(a[5],'f')[:dim]; mode='grad'
            elif op!='sample_indexable': raise ValueError(f'Unsupported sample {op}')
            sample=Node('sample',tuple(args),'v4',value=(slot,dim,mode,a[3]),line=self.line)
            self.write(a[0],[Node('component',(sample,),value='xyzw'.index(c),line=self.line) for c in swiz]); return
        if op=='resinfo_indexable':
            slot,swiz=a[2].split('.'); info=self.texture_info.get(slot)
            nodes=[const(info[k]) if info else Node('external',value=f'resinfo:{slot}') for k in ('width','height','depth','mipCount')]
            # resinfo defaults to float dimensions, not reciprocal dimensions.
            self.write(a[0],[nodes['xyzw'.index(c)] for c in swiz]); return
        if op=='sincos':
            src=self.read(a[2],'f'); sn=[mk('sin',n) for n in src]; cs=[mk('cos',n) for n in src]
            self.write(a[0],sn); self.write(a[1],cs); return
        if op=='imul':
            # Only engine setup uses high/low imul in this family; preserve a marker.
            for d in a[:2]: self.write(d,[Node('unsupported',value=op,line=self.line)]*4)
            return
        if op.startswith(('ld_','store_')):
            if self.world_surface and op == 'ld_structured_indexable' and a[3].startswith('t0.'):
                index, offset = self.read(a[1], 'u')[0], self.read(a[2], 'u')[0]
                if index.op == offset.op == 'const' and index.value in (18, 19):
                    # The selected primitive record's world bounds high/low vectors.
                    # The local viewer uses tile zero; unknown radius lanes stay errors.
                    values = [const(0) if index.value == 18 else Node('input', value=f'geometry.objectPosition.{c}') for c in 'xyz']
                    values.append(Node('external', value='primitive.boundsRadius', line=self.line))
                    swizzle = a[3].partition('.')[2]
                    nodes = [values[offset.value//4+'xyzw'.index(c)] if offset.value//4+'xyzw'.index(c)<4
                             else Node('unsupported', value='primitive bounds offset', line=self.line) for c in swizzle]
                    self.write(a[0], nodes); return
            self.write(a[0],[Node('unsupported',value=op,line=self.line)]*4); return
        int_ops={'iadd':'i','imad':'i','and':'u','or':'u','ishl':'u','umin':'u'}
        kind=int_ops.get(op,'f')
        if op=='mov': nodes=self.read(a[1])
        elif op=='movc':
            cond=self.read(a[1],'u'); y=self.read(a[2]); no=self.read(a[3])
            nodes=[mk('select',c,yy,cast(nn,yy.type),kind=yy.type) for c,yy,nn in zip(cond,y,no)]
        elif op in ('ftou','ftoi','utof','itof'):
            src_type={'ftou':'f','ftoi':'f','utof':'u','itof':'i'}[op]
            dst_type={'ftou':'u','ftoi':'i','utof':'f','itof':'f'}[op]
            nodes=[mk('convert',n,kind=dst_type) for n in self.read(a[1],src_type)]
        elif op.startswith('dp'):
            width=int(op[2]); x,y=self.read(a[1],'f'),self.read(a[2],'f')
            n=mk('mul',x[0],y[0])
            for i in range(1,width): n=mk('add',n,mk('mul',x[i],y[i]))
            nodes=[n]*4
        elif op == 'log': nodes=[mk('log2', mk('abs', n)) for n in self.read(a[1], 'f')]
        elif op == 'exp': nodes=[mk('exp2', n) for n in self.read(a[1], 'f')]
        else:
            names={'iadd':'add','imad':'mad','ishl':'shl','umin':'min','round_ni':'floor','round_pi':'ceil',
                   'frc':'fract','deriv_rtx_coarse':'dfdx','deriv_rty_coarse':'dfdy'}
            mapped=names.get(op,op)
            supported={'add','mul','div','mad','min','max','sqrt','rsq','rcp','floor','ceil','fract','lt','ge','ne','eq','and','or','shl','dfdx','dfdy'}
            if mapped not in supported:
                self.write(a[0],[Node('unsupported',value=op,line=self.line)]*4); return
            sources=[self.read(s,kind) for s in a[1:]]
            result_type='u' if mapped in ('lt','ge','ne','eq') else kind
            nodes=[]
            for i in range(4):
                values=[s[i] for s in sources]
                n=mk('add',mk('mul',*values[:2],kind=kind),values[2],kind=kind) if mapped=='mad' else mk(mapped,*values,kind=result_type)
                nodes.append(n)
        self.write(a[0],nodes,sat)

    def emit(self, output_names=None):
        names,lines,textures,source_lines,inputs={},[],set(),set(),set()
        def visit(n):
            if n.op=='const':
                if n.type=='f':
                    if not math.isfinite(n.value): raise ValueError('Nonfinite live shader constant')
                    s=format(n.value,'.9g'); return s if '.' in s or 'e' in s else s+'.0'
                return str(n.value)+('u' if n.type=='u' else '')
            if n.op=='input': inputs.add(n.value); return n.value
            if n.op in ('external','unsupported'): raise ValueError(f'Live {n.op} {n.value} at assembly line {n.line}')
            if n in names: return names[n]
            a=[visit(x) for x in n.args]; op=n.op
            if op=='cast':
                src=n.args[0].type
                fn=('uintBitsToFloat' if src=='u' else 'intBitsToFloat') if n.type=='f' else ('floatBitsToUint' if n.type=='u' else 'floatBitsToInt') if src=='f' else {'u':'uint','i':'int'}[n.type]
                expr=f'{fn}({a[0]})'
            elif op=='convert': expr=f'{ {"f":"float","u":"uint","i":"int"}[n.type]}({a[0]})'
            elif op in ('add','mul','div','and','or','shl'):
                symbol={'add':'+','mul':'*','div':'/','and':'&','or':'|','shl':'<<'}[op]
                right=f'({a[1]} & 31u)' if op=='shl' else a[1]
                expr=f'({a[0]} {symbol} {right})'
            elif op in ('lt','ge','ne','eq'):
                symbol={'lt':'<','ge':'>=','ne':'!=','eq':'=='}[op]
                expr=f'({a[0]} {symbol} {a[1]} ? 0xffffffffu : 0u)'
            elif op=='select': expr=f'({a[0]} != 0u ? {a[1]} : {a[2]})'
            elif op=='neg': expr=f'(-{a[0]})'
            elif op=='rcp': expr=f'(1.0 / {a[0]})'
            elif op=='component': expr=f'{a[0]}.{"xyzw"[n.value]}'
            elif op=='sample':
                slot,dim,mode,sampler=n.value; textures.add(slot)
                uv=f'vec{dim}({", ".join(a[:dim])})'
                if mode=='implicit': expr=f'texture(u_{slot}, {uv})'
                elif mode=='bias': expr=f'texture(u_{slot}, {uv}, {a[dim]})'
                elif mode=='lod': expr=f'textureLod(u_{slot}, {uv}, {a[dim]})'
                else:
                    dx=f'vec{dim}({", ".join(a[dim:2*dim])})'; dy=f'vec{dim}({", ".join(a[2*dim:])})'
                    expr=f'textureGrad(u_{slot}, {uv}, {dx}, {dy})'
            else:
                fn={'rsq':'inversesqrt','dfdx':'dFdx','dfdy':'dFdy'}.get(op,op)
                expr=f'{fn}({", ".join(a)})'
                if self.geometry_dependent and op == 'dfdy': expr=f'(-{expr})' # D3D screen Y points down.
            name=f'n{len(names)}'; names[n]=name
            gltype={'f':'float','u':'uint','i':'int','v4':'vec4'}[n.type]
            lines.append(f'  {gltype} {name} = {expr}; // asm:{n.line}')
            if n.line: source_lines.add(n.line)
            return name
        selected=self.outputs if output_names is None else {name:self.outputs[name] for name in output_names}
        outputs={k:[visit(cast(n,'f')) for n in nodes] for k,nodes in selected.items()}
        for key,components in outputs.items():
            expr=f'vec{len(components)}({", ".join(components)})' if len(components)>1 else components[0]
            lines.append(f'  surface.{key} = {expr};')
        prelude='\n'.join(f'uniform highp {"samplerCube" if self.texture_info[t].get("cube") else "sampler2DArray" if self.texture_info[t]["array"] else "sampler2D"} u_{t};' for t in sorted(textures))
        arguments='vec2 uv0, vec2 uv1' + (', vec3 viewTangent' if self.view_dependent else '')
        if self.geometry_dependent or self.world_surface:
            prelude += '\nstruct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness;'
            prelude += (' vec3 objectPosition;' if self.world_surface else '')
            prelude += (' vec4 color;' if self.surface_kind == 'hair' else '') + ' };'
            arguments += ', ReconstructedGeometry geometry'
        code=prelude+f'\nReconstructedSurface recoveredSurface({arguments}) {{\n  ReconstructedSurface surface;\n'+'\n'.join(lines)+'\n  return surface;\n}\n'
        report={'scalarNodes':len(names),'sourceLines':sorted(source_lines)}
        report['requiredUvSets'] = sorted({int(name[2]) for name in inputs if re.fullmatch(r'uv[01]\.[xy]', name)})
        if self.view_dependent: report['viewDependentCloth'] = True
        if self.geometry_dependent:
            report['geometryDependentNormals'] = True
            report['derivativePolicy'] = 'WebGL local differencing with D3D screen-Y sign; exact coarse-quad selection is not guaranteed by GLSL ES'
        if self.skin_surface:
            report['skinSurface'] = True
            report['geometryFrame'] = 'source-world'
            report['viewPolicy'] = 'Perspective camera; engine normal override disabled; global mip bias zero; material sample biases retained'
            report['excludedOutputs'] = ['native opacity/discard', 'pixel depth offset', 'engine effects', 'subsurface lighting']
            report['requiredGeometryFields'] = sorted({i.split('.')[1] for i in inputs if i.startswith('geometry.')})
            if self.neck_fade:
                report['skinCoverage'] = 'neck-fade'
                report['opacityPolicy'] = 'Source neck mask, saturated FadeAmount and NeckFadeEnabled; preview alpha hashing before native dither/discard and depth offset'
        if self.surface_kind:
            report['surfaceKind'] = self.surface_kind
            report['geometryFrame'] = 'source-world'
            report['worldSurface'] = True
            report['normalSpace'] = 'world' if self.surface_kind == 'eyelash' else 'strand-tangent' if self.surface_kind == 'hair' else 'tangent'
            report['requiresVertexColor'] = any(i.startswith('geometry.color.') for i in inputs)
            report['requiredGeometryFields'] = sorted({i.split('.')[1] for i in inputs if i.startswith('geometry.')})
            report['viewPolicy'] = 'Perspective camera; engine normal override disabled; global mip bias zero; material sample biases retained'
            report['excludedOutputs'] = ['engine effects', 'native temporal dithering', 'pixel depth offset', 'Unreal lighting']
            if self.surface_kind in ('eyelash', 'hair'):
                report['opacityPolicy'] = 'Material coverage before temporal dithering and engine effects'
        return code,sorted(textures),report
