"""Four-lane SM5 reference for geometry-dependent clothing surface validation.

Lanes are D3D top-left, top-right, bottom-left, bottom-right. The original
instructions run in lockstep, including coarse derivatives across the quad.
No game shader text is embedded here.
"""
import re
import struct
import numpy as np
from sm5_slice import split_operands


def derivative(values, axis):
    values = np.broadcast_to(values, (4,) + np.shape(values)[1:])
    return np.broadcast_to(values[1 if axis == 'x' else 2] - values[0], values.shape).copy()


def forward_quad(assembly, constants, textures, uv, geometry, camera, skin_surface=False,
                 surface_kind=None, material_buffer=3, neck_fade=None):
    registers, result, branches = {}, {}, []
    world_surface = skin_surface or surface_kind is not None
    previous = None
    active = np.ones(4, dtype=bool)
    types = {'f': np.float32, 'u': np.uint32, 'i': np.int32}

    def write(destination, values, typ='f'):
        if destination == 'null': return
        name, _, mask = destination.partition('.')
        bits = np.broadcast_to(np.asarray(values, dtype=types[typ]), (4, 4)).copy().view(np.uint32)
        old = registers.setdefault(name, np.zeros((4, 4), np.uint32))
        for c in mask or 'xyzw':
            i = 'xyzw'.index(c)
            old[:, i] = np.where(active, bits[:, i], old[:, i])

    def read(source, typ='f'):
        negative = source.startswith('-'); source = source.removeprefix('-')
        absolute = source.startswith('|'); source = source.strip('|')
        if source.startswith('l('):
            values = split_operands(source[2:-1])
            bits = [struct.unpack('<I', struct.pack('<f', float(v)))[0] if '.' in v
                    else int(v, 0) & 0xffffffff for v in values]
            bits = np.broadcast_to(np.array(bits if len(bits) == 4 else bits * 4, np.uint32), (4, 4))
        else:
            indexed = re.fullmatch(r'(x\d+)\[(r\d+\.[xyzw]) \+ (\d+)\]\.([xyzw]+)', source)
            if indexed:
                indices = read(indexed[2], 'i')[:, 0] + int(indexed[3])
                mask = indexed[4] if len(indexed[4]) == 4 else indexed[4] * 4
                bits = np.array([registers.get(f'{indexed[1]}[{index}]', np.zeros((4,4),np.uint32))[lane,
                    ['xyzw'.index(c) for c in mask]] for lane,index in enumerate(indices)])
            else:
                name, _, mask = source.partition('.'); mask = mask or 'xyzw'
                if len(mask) == 1: mask *= 4
                bits = registers.get(name, np.zeros((4, 4), np.uint32))[:, ['xyzw'.index(c) for c in mask]].copy()
        value = bits.view(types[typ])
        if absolute: value = np.abs(value)
        return -value if negative else value

    for i in range(0, len(constants), 4): write(f'cb{material_buffer}[{i//4}]', constants[i:i+4])
    write('v0', [[*g['tangent'], 0] for g in geometry])
    write('v1', [[*g['normal'], g['handedness']] for g in geometry])
    write('v3' if surface_kind == 'hair' else 'v2', uv)
    if surface_kind == 'hair': write('v2', [g['color'] for g in geometry])
    # Identity screen-to-translated-world matrix is a valid synthetic fixture.
    screen_register = re.search(r'// SV_Position\s+0\s+xyzw\s+(\d+)\s+POS', assembly)
    write(f'v{screen_register[1]}' if screen_register else 'v6', [[*(np.asarray(g['position']) - camera), 1] for g in geometry])
    for i in range(4): write(f'cb0[{44+i}]', np.eye(4)[i])
    write('cb0[122]', [*camera, 0]); write('cb0[124]', [*(-np.asarray(camera)), 0])
    write('cb0[159]', [0, 0, 0, 1]); write('cb0[160]', [0, 1, 0, 1])
    for text in assembly.splitlines():
        line = re.sub(r'\s*\[precise(?:\([^]]*\))?\]', '', text.strip())
        match = re.match(r'(\w+)((?:\([^)]*\))*)\s*(.*)', line)
        if not match or line.startswith('//'): continue
        op, qualifiers, tail = match.groups(); a = split_operands(tail)
        if op.startswith('dcl_') or op == 'ps_5_0': continue
        if op in ('if_z', 'if_nz'):
            condition = read(a[0], 'u')[:, 0] != 0
            if op == 'if_z': condition = ~condition
            branches.append((active.copy(), condition)); active &= condition; continue
        if op == 'else': active = branches[-1][0] & ~branches[-1][1]; continue
        if op == 'endif': active = branches.pop()[0]; continue
        if not active.any() or op in ('ret', 'discard_nz'): continue
        lanes = ['xyzw'.index(c) for c in a[0].partition('.')[2] or 'xyzw']
        if op == 'mul' and 'cb0[159]' in line: result['normal'] = read(a[1])[:, lanes].copy()
        if op == 'mad' and a[0] == 'o2.z': result['roughness'] = read(a[1])[:, [2]].copy()
        if op == 'mad_sat' and 'cb0[160].w' in line: result['ao'] = read(a[1])[:, [lanes[0]]].copy()
        if world_surface and op == 'add_sat' and a[1:] == ['cb0[160].z', 'cb0[160].w']: result['ao'] = np.ones((4,1),np.float32)
        if skin_surface and op == 'mad_sat' and 'cb0[157].wwww' in a: result['subsurfaceColor'] = read(a[1])[:, lanes].copy()
        if op == 'mul' and 'l(0.080000)' in line: result['specular'] = read(a[1])[:, [0]].copy()
        if surface_kind == 'eyelash' and op == 'mov' and a == ['o2.y', 'l(0)']: result['specular'] = np.zeros((4,1),np.float32)
        coverage = (surface_kind in ('hair', 'eyelash') and op == 'movc' and len(a) == 4
                    and a[2] == 'l(0)' and a[0] == a[3] and previous is not None
                    and previous[0] == 'mul' and previous[1][:2] == [a[0], a[0]]
                    and previous[1][2].startswith(f'cb{material_buffer}['))
        neck_coverage = neck_fade and op == 'mul_sat' and a[-1] == neck_fade['amount']
        previous = (op, a)
        saturated = op.endswith('_sat'); op = op.removesuffix('_sat'); typ = 'f'
        if op == 'mov': value = read(a[1], 'u'); typ = 'u'
        elif op == 'movc': value = np.where(read(a[1], 'u') != 0, read(a[2], 'u'), read(a[3], 'u')); typ = 'u'
        elif op.startswith('sample'):
            slot, swizzle = a[2].split('.')
            value = np.asarray([textures(slot, coords, False) for coords in read(a[1])], np.float32)[:, ['xyzw'.index(c) for c in swizzle]]
        elif op == 'resinfo_indexable':
            slot, swizzle = a[2].split('.')
            value = np.asarray(textures(slot, [0]*4, True), np.float32)[['xyzw'.index(c) for c in swizzle]]
        elif op == 'sincos':
            angle = read(a[2]); write(a[0], np.sin(angle)); write(a[1], np.cos(angle)); continue
        elif op == 'imul': write(a[0], [0]*4, 'u'); write(a[1], [0]*4, 'u'); continue
        elif op.startswith('ld_'):
            value = np.ones((4,4), np.float32)
            if world_surface and op == 'ld_structured_indexable' and a[3].startswith('t0.'):
                for lane, index in enumerate(read(a[1], 'u')[:,0]):
                    if index not in (18,19): continue
                    record = np.array([0,0,0,1] if index == 18 else [*geometry[lane]['objectPosition'],1],np.float32)
                    offset = int(read(a[2], 'u')[lane,0])//4
                    for c, swizzle in enumerate(a[3].partition('.')[2]): value[lane,c] = record[offset+'xyzw'.index(swizzle)]
        elif op.startswith('deriv_'): value = derivative(read(a[1]), 'x' if 'rtx' in op else 'y')
        elif op.startswith('dp'):
            n = int(op[-1]); value = np.repeat(np.sum(read(a[1])[:, :n] * read(a[2])[:, :n], axis=1, dtype=np.float32)[:, None], 4, axis=1)
        elif op in ('ftou', 'ftoi', 'utof', 'itof'):
            typ = {'ftou':'u','ftoi':'i','utof':'f','itof':'f'}[op]
            value = read(a[1], {'ftou':'f','ftoi':'f','utof':'u','itof':'i'}[op]).astype(types[typ])
        elif op in ('and', 'or', 'ishl', 'umin', 'iadd', 'imad'):
            typ = 'i' if op.startswith('i') and op != 'ishl' else 'u'
            x, y = read(a[1], typ), read(a[2], typ)
            if op == 'and': value = x & y
            elif op == 'or': value = x | y
            elif op == 'ishl': value = x << (y & 31)
            elif op == 'umin': value = np.minimum(x, y)
            elif op == 'iadd': value = x + y
            else: value = x * y + read(a[3], typ)
        elif op == 'udiv':
            x,y=read(a[2],'u'),read(a[3],'u')
            write(a[0],np.where(y!=0,x//np.maximum(y,1),0xffffffff),'u')
            write(a[1],np.where(y!=0,x%np.maximum(y,1),0xffffffff),'u'); continue
        else:
            x = read(a[1]); y = read(a[2]) if len(a) > 2 else None
            if op in ('lt','ge','ne','eq'):
                predicate = {'lt':np.less,'ge':np.greater_equal,'ne':np.not_equal,'eq':np.equal}[op]
                value = np.where(predicate(x,y), np.uint32(0xffffffff), np.uint32(0)); typ = 'u'
            elif op == 'add': value = x + y
            elif op == 'mul': value = x * y
            elif op == 'div': value = x / y
            elif op == 'mad': value = x * y + read(a[3])
            elif op == 'min': value = np.minimum(x,y)
            elif op == 'max': value = np.maximum(x,y)
            elif op == 'sqrt': value = np.sqrt(x)
            elif op == 'rsq': value = 1 / np.sqrt(x)
            elif op == 'rcp': value = 1 / x
            elif op == 'frc': value = x - np.floor(x)
            elif op == 'round_ni': value = np.floor(x)
            elif op == 'round_pi': value = np.ceil(x)
            elif op == 'round_ne': value = np.rint(x)
            elif op == 'log': value = np.log2(np.abs(x))
            elif op == 'exp': value = np.exp2(x)
            else: raise ValueError(f'Unknown quad reference opcode {op}')
        if saturated:
            if typ != 'f': value = value.view(np.float32)
            value = np.clip(value, 0, 1); typ = 'f'
        write(a[0], value, typ)
        if coverage:
            if 'opacity' in result: raise ValueError('Ambiguous coverage anchor in forward reference')
            result['opacity'] = read(a[0])[:, :1].copy()
        if neck_coverage:
            if 'opacity' in result: raise ValueError('Ambiguous neck-fade anchor in forward reference')
            gain = read(a[0])[:, :1].copy()
            enabled = read(neck_fade['enabled'])[:, :1]
            result['opacity'] = np.float32(1) + enabled * (gain - np.float32(1))
    result['baseColor'] = read('o3.xyzx')[:, :3]; result['metalness'] = read('o2.x')[:, :1]
    if surface_kind == 'hair':
        result['scatter'] = result['metalness'].copy()
        result['metalness'] = np.zeros((4,1),np.float32)
    return result


def evaluate_quad(sliced, textures, uv, geometry):
    cache = {}
    types = {'f': np.float32, 'i': np.int32, 'u': np.uint32}
    def evaluate(node):
        if node in cache: return cache[node]
        if node.op == 'const': return np.full(4, node.value, dtype=types[node.type])
        if node.op == 'input':
            if node.value.startswith('geometry.'):
                fields = node.value.split('.')[1:]
                return np.array([g[fields[0]] if len(fields) == 1 else g[fields[0]]['xyzw'.index(fields[1])] for g in geometry], np.float32)
            return np.full(4, uv[int(node.value[2])*2+'xy'.index(node.value[-1])], np.float32)
        a = [evaluate(arg) for arg in node.args]; op = node.op
        if op == 'sample': value = np.array([textures(node.value[0], coords, False) for coords in np.stack(a, axis=1)], np.float32)
        elif op == 'component': value = a[0][:, node.value]
        elif op in ('dfdx', 'dfdy'): value = derivative(a[0], 'x' if op == 'dfdx' else 'y')
        elif op == 'select': value = np.where(a[0] != 0, a[1], a[2])
        elif op == 'cast': value = np.asarray(a[0], dtype=types[node.args[0].type]).view(types[node.type])
        elif op == 'convert': value = a[0].astype(types[node.type])
        else:
            functions = {'add':lambda:a[0]+a[1], 'mul':lambda:a[0]*a[1], 'div':lambda:a[0]/a[1],
                'min':lambda:np.minimum(*a), 'max':lambda:np.maximum(*a), 'neg':lambda:-a[0], 'abs':lambda:np.abs(a[0]),
                'floor':lambda:np.floor(a[0]), 'ceil':lambda:np.ceil(a[0]), 'fract':lambda:a[0]-np.floor(a[0]),
                'sin':lambda:np.sin(a[0]), 'cos':lambda:np.cos(a[0]), 'sqrt':lambda:np.sqrt(a[0]),
                'log2':lambda:np.log2(a[0]), 'exp2':lambda:np.exp2(a[0]),
                'rsq':lambda:1/np.sqrt(a[0]), 'rcp':lambda:1/a[0], 'and':lambda:a[0]&a[1],
                'or':lambda:a[0]|a[1], 'shl':lambda:a[0]<<(a[1]&31),
                'lt':lambda:np.where(a[0]<a[1], 0xffffffff, 0), 'ge':lambda:np.where(a[0]>=a[1], 0xffffffff, 0),
                'eq':lambda:np.where(a[0]==a[1], 0xffffffff, 0), 'ne':lambda:np.where(a[0]!=a[1], 0xffffffff, 0)}
            value = functions[op]()
        if node.type in types: value = np.asarray(value, dtype=types[node.type])
        cache[node] = value; return value
    return {name:np.stack([evaluate(node) for node in nodes], axis=1) for name,nodes in sliced.outputs.items()}
