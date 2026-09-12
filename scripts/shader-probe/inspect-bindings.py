"""Decode the preshader subset in the probed FINALS materials; fail on unknown data.

Inputs and generated results stay local. This does not recreate the material graph.
Opcode reference: WistfulHopes/UEShaderMapExtractor, preshaderToUniformBuffer_UE5.5.py.
Buffer fields and resource layouts come from the fresh CUE4Parse export.
"""

import argparse
import base64
import json
import re
import struct
from pathlib import Path


class Expression:
    def __init__(self, text, width):
        self.text, self.width = text, width


def decode_expression(data, parameters, names=()):
    cursor, stack, parameter_names = 0, [], set()

    def read(fmt):
        nonlocal cursor
        size = struct.calcsize(fmt)
        if cursor + size > len(data):
            raise ValueError("Truncated preshader instruction")
        result = struct.unpack_from(fmt, data, cursor)
        cursor += size
        return result

    binary = {4: "+", 5: "-", 6: "*", 7: "/", 8: "fmod", 9: "modulo",
              10: "min", 11: "max", 19: "atan2", 20: "dot", 21: "cross"}
    unary = {13: "sin", 14: "cos", 15: "tan", 16: "asin", 17: "acos", 18: "atan",
             22: "sqrt", 23: "rcp", 24: "length", 25: "normalize", 26: "saturate",
             27: "abs", 28: "floor", 29: "ceil", 30: "round", 31: "trunc",
             32: "sign", 33: "frac", 34: "fractional", 35: "log2", 36: "log10", 47: "neg"}
    while cursor < len(data):
        opcode, = read("<B")
        if opcode == 3:
            index, = read("<H")
            parameter = parameters[index]
            name = parameter["ParameterInfo"]["Name"]
            width = {"Scalar": 1, "Vector": 4}[parameter["ParameterType"]]
            stack.append(Expression(name, width))
            parameter_names.add(name)
        elif opcode == 2:
            value_type, = read("<B")
            if not 1 <= value_type <= 16:
                raise ValueError(f"Unsupported constant type {value_type}")
            width = (value_type - 1) % 4 + 1
            code = ["f", "d", "i", "?"][(value_type - 1) // 4]
            values = read("<" + code * width)
            text = ", ".join(repr(v) for v in values)
            stack.append(Expression(text if width == 1 else f"float{width}({text})", width))
        elif opcode == 37:
            count, *indices = read("<5B")
            value = stack.pop()
            if not 1 <= count <= 4 or any(i >= value.width for i in indices[:count]):
                raise ValueError("Invalid component swizzle")
            suffix = "".join("xyzw"[i] for i in indices[:count])
            stack.append(Expression(f"({value.text}).{suffix}", count))
        elif opcode == 38:
            right, left = stack.pop(), stack.pop()
            width = left.width + right.width
            if width > 4:
                raise ValueError("AppendVector exceeds four components")
            stack.append(Expression(f"float{width}({left.text}, {right.text})", width))
        elif opcode in (39, 40):
            # TextureSize / TexelSize: the parameter (name index into Names, index, association) and
            # its texture index. The engine reads the bound texture resource; not a numeric parameter.
            name_index, _, association, texture_index = read("<HiBi")
            if name_index >= len(names) or association > 2:
                raise ValueError("Texture size names an unknown texture parameter")
            kind = "TextureSize" if opcode == 39 else "TexelSize"
            stack.append(Expression(f"{kind}({names[name_index]!r}, texture {texture_index})", 3))
        elif opcode in binary:
            right, left = stack.pop(), stack.pop()
            if left.width != right.width and 1 not in (left.width, right.width):
                raise ValueError("Invalid binary operand widths")
            width = 1 if opcode == 20 else max(left.width, right.width)
            op = binary[opcode]
            text = (f"({left.text} {op} {right.text})" if opcode in (4, 5, 6, 7)
                    else f"{op}({left.text}, {right.text})")
            stack.append(Expression(text, width))
        elif opcode in unary:
            value = stack.pop()
            stack.append(Expression(f"{unary[opcode]}({value.text})", 1 if opcode == 24 else value.width))
        else:
            raise ValueError(f"Unsupported preshader opcode {opcode} at byte {cursor - 1}")
    if len(stack) != 1:
        raise ValueError(f"Preshader leaves {len(stack)} stack entries")
    return stack[0], sorted(parameter_names)


def parse_resource_table(raw, uniforms):
    """Read the six resource arrays in the observed UE 5.7 D3D shader header.

    Validate its boundary and the material layout hash before assigning any slots.
    Entries encode uniform-buffer index, resource index and shader binding index.
    """
    cursor = 4
    arrays = {}
    for name in ("srvs", "samplers", "uavs", "layoutHashes", "textures", "collections"):
        count, = struct.unpack_from("<I", raw, cursor)
        cursor += 4
        if count > 65536 or cursor + count * 4 > len(raw):
            raise ValueError("Invalid shader resource table length")
        arrays[name] = list(struct.unpack_from("<" + "I" * count, raw, cursor))
        cursor += count * 4
    if raw[cursor:cursor + 4] != b"DXBC":
        raise ValueError("Resource table does not end at the shader container")
    layout = uniforms["UniformBufferLayoutInitializer"]
    matches = [i for i, h in enumerate(arrays["layoutHashes"]) if h == layout["Hash"]]
    if len(matches) != 1:
        raise ValueError("Material layout hash is missing or ambiguous")
    buffer_index = matches[0]
    bits, = struct.unpack_from("<I", raw)
    if not bits & (1 << buffer_index):
        raise ValueError("Material resource table is not active")
    parameters = [p for group in uniforms["UniformTextureParameters"] for p in group]
    # Each material texture contributes a texture and sampler resource; two shared
    # samplers follow. Other resource families need an explicit parser extension.
    if any(uniforms[k] for k in ("UniformExternalTextureParameters", "UniformTextureCollectionParameters", "VTStacks")):
        raise ValueError("Unsupported material texture resource family")
    if len(layout["Resources"]) != len(parameters) * 2 + 2:
        raise ValueError("Unexpected material resource layout")
    texture_bindings = []
    table = arrays["textures"]
    offset = table[buffer_index]
    if not 0 < offset < len(table):
        raise ValueError("Material texture table is empty or invalid")
    while offset < len(table):
        packed = table[offset]
        offset += 1
        if packed == 0xFFFFFFFF or packed >> 24 != buffer_index:
            break
        resource_index = (packed >> 8) & 0xFFFF
        bind_index = packed & 0xFF
        if resource_index % 2 or resource_index // 2 >= len(parameters):
            raise ValueError("Texture resource index does not match the material layout")
        parameter = parameters[resource_index // 2]
        texture_bindings.append({"slot": f"t{bind_index}", "resourceIndex": resource_index,
                                 "parameter": parameter["ParameterInfo"]["Name"],
                                 "defaultTextureIndex": parameter["TextureIndex"],
                                 "samplerSource": parameter["SamplerSource"]})
    return buffer_index, texture_bindings


def inspect(uniform_path, output):
    uniforms = json.loads(uniform_path.read_text(encoding="utf-8-sig"))
    data = base64.b64decode(uniforms["UniformPreshaderData"]["Data"], validate=True)
    if uniforms["UniformPreshaderData"].get("bPreshader2"):
        raise ValueError("Preshader2 needs a different decoder")
    shader_stem = uniform_path.name.removesuffix(".uniforms.json") + ".basepass-pixel"
    shader_dir = uniform_path.parent / "shaders"
    raw = (shader_dir / (shader_stem + ".ue-shader.bin")).read_bytes()
    buffer_index, textures = parse_resource_table(raw, uniforms)
    fields = uniforms["UniformPreshaderFields"]
    records, occupied, consumed = [], {}, set()
    for preshader in uniforms["UniformPreshaders"]:
        start, size = preshader["OpcodeOffset"], preshader["OpcodeSize"]
        if start + size > len(data) or consumed.intersection(range(start, start + size)):
            raise ValueError("Preshader opcode spans overlap or exceed the data")
        consumed.update(range(start, start + size))
        expression, parameters = decode_expression(data[start:start + size], uniforms["UniformNumericParameters"],
                                                   uniforms["UniformPreshaderData"].get("Names") or ())
        for field_index in range(preshader["FieldIndex"], preshader["FieldIndex"] + preshader["NumFields"]):
            field = fields[field_index]
            if not re.fullmatch(r"Float[1-4]", field["Type"]):
                raise ValueError(f"Unsupported buffer field type {field['Type']}")
            width, first = int(field["Type"][-1]), field["ComponentIndex"]
            if first + width > expression.width:
                raise ValueError("Buffer field exceeds its expression width")
            offset = field["BufferOffset"]
            if offset + width > uniforms["UniformPreshaderBufferSize"] * 4:
                raise ValueError("Buffer field exceeds the uniform buffer")
            if offset % 4 + width > 4:
                raise ValueError("Buffer field straddles registers")
            lanes = "xyzw"[offset % 4:offset % 4 + width]
            register = f"cb{buffer_index}[{offset // 4}].{lanes}"
            text = expression.text
            if first or width != expression.width:
                text = f"({text}).{'xyzw'[first:first + width]}"
            record = {"register": register, "floatOffset": offset, "type": field["Type"],
                      "expression": text, "parameters": parameters,
                      "opcodeOffset": start, "opcodeSize": size}
            records.append(record)
            for component in range(width):
                key = (offset + component) // 4, "xyzw"[(offset + component) % 4]
                if key in occupied:
                    raise ValueError("Uniform buffer fields overlap")
                occupied[key] = record
    if len(consumed) != len(data) or len(records) != len(fields):
        raise ValueError("Not all preshader data and fields were decoded")
    coverage = None
    assembly_path = shader_dir / (shader_stem + ".dxbc.asm")
    if assembly_path.exists():
        assembly = assembly_path.read_text(encoding="utf-8-sig")
        declared = re.search(rf"dcl_constantbuffer CB{buffer_index}\[(\d+)\]", assembly)
        # FXC declares a constant buffer only up to its highest register read, so trailing unread
        # registers may be trimmed. It can never exceed the material layout; every read component
        # must still map to a decoded field below.
        if not declared or not 0 < int(declared[1]) <= uniforms["UniformPreshaderBufferSize"]:
            raise ValueError("Disassembled material buffer size differs from metadata")
        used = {(int(reg), lane) for reg, lanes in re.findall(rf"cb{buffer_index}\[(\d+)\]\.([xyzw]+)", assembly)
                for lane in lanes}
        unknown = sorted(used - occupied.keys())
        coverage = {"referencedComponents": len(used), "mappedComponents": len(used) - len(unknown),
                    "unmappedComponents": unknown}
        if unknown:
            raise ValueError(f"Shader reads unmapped material components: {unknown}")
        comments = ["// Recovered material bindings; expressions use exported parameter names."]
        comments += [f"// {r['register']} = {r['expression']}" for r in records]
        comments += [f"// {t['slot']} = {t['parameter']} (default texture index {t['defaultTextureIndex']})" for t in textures]
        (output / (shader_stem + ".named.asm")).write_text("\n".join(comments) + "\n\n" + assembly, encoding="utf-8")
    result = {"source": uniform_path.name, "materialBufferIndex": buffer_index,
              "layoutHash": uniforms["UniformBufferLayoutInitializer"]["Hash"],
              "preshaderCount": len(uniforms["UniformPreshaders"]), "preshaderBytes": len(data),
              "uniformFields": records, "textureBindings": textures, "sm5Coverage": coverage}
    (output / (shader_stem + ".bindings.json")).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return {"material": shader_stem, "fields": len(records), "textureBindings": len(textures), "sm5Coverage": coverage}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exports", type=Path)
    args = parser.parse_args()
    output = args.exports / "bindings"
    output.mkdir(exist_ok=True)
    results = []
    for path in sorted(args.exports.glob("*.uniforms.json")):
        result = inspect(path, output)
        results.append(result)
        print(json.dumps(result))
    if not results:
        raise ValueError("No uniform exports found")
    (output / "summary.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
