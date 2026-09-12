"""Recover the effective sampler for the observed native nail shader programs.

The cooked texture's address modes are not necessarily the sampler used by DXBC.
The verified View layout (0xC873DB14) starts with the shared wrap/clamp samplers.
Scope is deliberately limited to this captured layout; other layouts fail closed.
See _docs/native-nails-2026-09-11/sampler-repair.md for the source evidence.
"""
import re
import struct


def effective_nail_sampler(raw, assembly, slot):
    cursor, arrays = 4, {}
    for name in ('srvs', 'samplers', 'uavs', 'layoutHashes', 'textures', 'collections'):
        if cursor + 4 > len(raw): raise ValueError('Truncated nail resource table')
        count, = struct.unpack_from('<I', raw, cursor)
        cursor += 4
        if count > 65536 or cursor + 4 * count > len(raw):
            raise ValueError('Invalid nail resource table')
        arrays[name] = struct.unpack_from('<' + 'I' * count, raw, cursor)
        cursor += 4 * count
    if raw[cursor:cursor + 4] != b'DXBC': raise ValueError('Nail resource table boundary differs')
    if not arrays['layoutHashes'] or arrays['layoutHashes'][0] != 0xC873DB14:
        raise ValueError('Unrecognized nail View sampler layout')
    if not struct.unpack_from('<I', raw)[0] & 1: raise ValueError('Nail View resource table inactive')
    samplers = set()
    for line in assembly.splitlines():
        if re.match(r'\s*sample\w*\b', line):
            match = re.search(r',\s*' + re.escape(slot) + r'\.[xyzw]+,\s*s(\d+)(?:\s|,|$)', line)
            if match: samplers.add(int(match[1]))
    if len(samplers) != 1: raise ValueError(f'{slot}: expected one effective nail sampler')
    sampler, = samplers
    table = arrays['samplers']
    if not table or not 0 < table[0] < len(table): raise ValueError('Nail View sampler table missing')
    bindings = []
    for packed in table[table[0]:]:
        if packed == 0xFFFFFFFF or packed >> 24 != 0: break
        if packed & 255 == sampler: bindings.append((packed >> 8) & 65535)
    if len(bindings) != 1 or bindings[0] not in (0, 1):
        raise ValueError(f's{sampler}: unknown effective nail sampler')
    resource, = bindings
    return {'register': f's{sampler}', 'buffer': 'View', 'resourceIndex': resource,
            'viewLayoutHash': 'C873DB14', 'addressMode': 'TA_Wrap' if resource == 0 else 'TA_Clamp'}


def apply_nail_sampler(entry, sampler):
    """Keep byte-identical manifests when the texture and effective sampler agree."""
    address = sampler['addressMode']
    if entry['wrapS'] == entry['wrapT'] == address: return entry
    return {**entry, 'textureAddressMode': {'wrapS': entry['wrapS'], 'wrapT': entry['wrapT']},
            'wrapS': address, 'wrapT': address, 'effectiveSampler': sampler}
