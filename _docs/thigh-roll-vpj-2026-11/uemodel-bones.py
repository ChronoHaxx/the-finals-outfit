"""Raw check (26 Nov 2026): the leg helper joints' LOCAL reference rotations as FModel exported them (.uemodel, UEFormat,
SKELETON/BONES chunk: name, parent, position, rotation xyzw in UE space), independent of our GLB conversion.
Prints each joint's angle from identity and, for two files, the rotation between them (first -> second).
Read-only.   python -X utf8 -I uemodel-bones.py BODY.uemodel GARMENT.uemodel
"""
import struct, sys, math
def rd_fstr(b, o):
    n = struct.unpack_from('<i', b, o)[0]; o += 4
    return b[o:o+n].decode('utf8', 'replace'), o + n
def bones(path):
    b = open(path, 'rb').read()
    i = b.find(b'\x08\x00\x00\x00SKELETON')
    o = i + 4 + 8
    cnt, size = struct.unpack_from('<ii', b, o); o += 8
    end = o + size
    out = {}
    while o < end:
        name, o = rd_fstr(b, o)
        c, s = struct.unpack_from('<ii', b, o); o += 8
        if name == 'BONES':
            p = o
            for _ in range(c):
                bn, p = rd_fstr(b, p)
                parent = struct.unpack_from('<i', b, p)[0]; p += 4
                pos = struct.unpack_from('<3f', b, p); p += 12
                rot = struct.unpack_from('<4f', b, p); p += 16
                out[bn] = (parent, pos, rot)
            assert p == o + s, (p, o + s)
        o += s
    return out
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
def ang(q):
    return math.degrees(2*math.acos(min(1, abs(q[3]))))
def rel(a, b):  # angle of a^-1 b
    ai = (-a[0], -a[1], -a[2], a[3]); return ang(qmul(ai, b))
paths = sys.argv[1:]
data = [bones(p) for p in paths]
for j in ['thigh_l', 'thigh_roll_vpj_l', 'knee_vpj_l', 'calf_l', 'thigh_r', 'thigh_roll_vpj_r', 'knee_vpj_r', 'thigh_volume_vpj_l', 'thigh_volume_vpj_r', 'thigh_front_vpj_l', 'head', 'spine_01']:
    row = [d.get(j) for d in data]
    s = f'{j:20s}'
    for r in row:
        s += f" | local rot from identity {ang(r[2]):7.3f} pos {tuple(round(v,3) for v in r[1])}" if r else ' | -'
    if all(row):
        s += f" | body->garment {rel(row[0][2], row[1][2]):.3f} deg"
    print(s)
print({p.split('/')[-1]: len(d) for p, d in zip(paths, data)})
