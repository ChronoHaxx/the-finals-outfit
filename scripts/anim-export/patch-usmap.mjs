#!/usr/bin/env node
// Patch one property's type in a .usmap type mapping (21 Nov 2026).
//
// Why: cooked packages store their properties "unversioned": no names, no types, just the values in schema order, so a
// reader needs the class layout from a mapping file. The community 12.00 mapping predates the 17 Nov 2026 update, which
// turned CharacterInGameEmoteDataAsset.EmoteAnimSequence from a hard object reference (4 bytes) into a soft one (a
// path). Reading it as a 4-byte reference shifts every later value, so emotes read as null animation, Common rarity,
// DeveloperOnly and no season. The package name maps prove the change: the animation now appears as a name (a soft
// path), not an import. Fixing the one type in a copy of the mapping makes the rest of the class read again; the
// result is checked against the 5 Nov dump of the same items (all-emotes census README).
//
// Usage (worktree root): node scripts/anim-export/patch-usmap.mjs <in.usmap> <out.usmap> [Class.Property=NewType ...]
//   With no patches it prints the classes named by --show=Class1,Class2 and exits.
// Writes an uncompressed v4 mapping; never overwrites its input.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const [input, output, ...rest] = process.argv.slice(2);
const show = (rest.find(a => a.startsWith("--show="))?.slice(7) ?? "").split(",").filter(Boolean);
// Class.Property=Type swaps the property's own type; Class.Property.inner=Type an array/set element's type, and
// Class.Property.value=Type a map value's type.
const patches = rest.filter(a => !a.startsWith("--")).map(p => { const [lhs, type] = p.split("="); const [cls, prop, part] = lhs.split("."); return { cls, prop, part, type }; });
if (!input || !output) throw new Error("usage: patch-usmap.mjs <in.usmap> <out.usmap> [Class.Property[.inner|.value]=Type ...] [--show=Class]");
if (patches.length && existsSync(output)) throw new Error(`${output} exists; choose a new file`);

const TYPES = ["ByteProperty", "BoolProperty", "IntProperty", "FloatProperty", "ObjectProperty", "NameProperty", "DelegateProperty",
  "DoubleProperty", "ArrayProperty", "StructProperty", "StrProperty", "TextProperty", "InterfaceProperty", "MulticastDelegateProperty",
  "WeakObjectProperty", "LazyObjectProperty", "AssetObjectProperty", "SoftObjectProperty", "UInt64Property", "UInt32Property",
  "UInt16Property", "Int64Property", "Int16Property", "Int8Property", "MapProperty", "SetProperty", "EnumProperty", "FieldPathProperty",
  "OptionalProperty", "Utf8StrProperty", "AnsiStrProperty"];

const file = readFileSync(input);
if (file.readUInt16LE(0) !== 0x30c4) throw new Error("not a usmap file");
const version = file[2];
if (version < 2 || version > 4) throw new Error(`usmap version ${version} is not handled (2-4 are)`);
let at = 3;
const hasVersioning = file.readInt32LE(at); at += 4;
if (hasVersioning) throw new Error("versioned usmaps are not handled");
const method = file[at]; at += 1;
const compSize = file.readUInt32LE(at), size = file.readUInt32LE(at + 4); at += 8;
const packed = file.subarray(at, at + compSize);
const data = method === 0 ? Buffer.from(packed) : method === 3 ? zstdDecompressSync(packed) : (() => { throw new Error(`compression ${method} not handled`); })();
if (data.length !== size) throw new Error("size mismatch after decompression");

let p = 0;
const u8 = () => data[p++], u16 = () => { const v = data.readUInt16LE(p); p += 2; return v; };
const i32 = () => { const v = data.readInt32LE(p); p += 4; return v; }, u32 = () => { const v = data.readUInt32LE(p); p += 4; return v; };
const names = [];
for (let n = u32(); n > 0; n--) { const len = u16(); names.push(data.toString("utf8", p, p + len)); p += len; }
const name = i => (i < 0 ? null : names[i]);
for (let n = u32(); n > 0; n--) { i32(); const count = version >= 3 ? u16() : u8(); p += count * (version >= 4 ? 12 : 4); }
function readType() {
  const offset = p, type = TYPES[u8()] ?? "?";
  if (type === "EnumProperty") { const inner = readType(); return { offset, type, inner, enumName: name(i32()) }; }
  if (type === "StructProperty") return { offset, type, structName: name(i32()) };
  if (type === "ArrayProperty" || type === "SetProperty" || type === "OptionalProperty") return { offset, type, inner: readType() };
  if (type === "MapProperty") { const key = readType(); return { offset, type, key, value: readType() }; }
  return { offset, type };
}
const describe = t => t.type + (t.enumName ? `<${t.enumName}>` : "") + (t.structName ? `<${t.structName}>` : "")
  + (t.inner && !t.enumName ? `<${describe(t.inner)}>` : "") + (t.key ? `<${describe(t.key)},${describe(t.value)}>` : "");
const structs = new Map();
for (let n = u32(); n > 0; n--) {
  const structName = name(i32()), superName = name(i32()), propCount = u16(), serializable = u16();
  const props = [];
  for (let k = 0; k < serializable; k++) { const schemaIdx = u16(), arraySize = u8(), propName = name(i32()); props.push({ schemaIdx, arraySize, name: propName, type: readType() }); }
  structs.set(structName, { superName, propCount, props });
}
if (p !== data.length) throw new Error(`parsed ${p} of ${data.length} bytes`);

for (const cls of show) {
  for (let c = cls; c; c = structs.get(c)?.superName) {
    const s = structs.get(c);
    if (!s) { console.log(`${c}: not in the mapping`); break; }
    console.log(`${c} : ${s.superName ?? "-"} (${s.propCount} properties)`);
    for (const prop of s.props) console.log(`  [${prop.schemaIdx}] ${prop.name}: ${describe(prop.type)}`);
  }
}
if (!patches.length) process.exit(0);

for (const { cls, prop, part, type } of patches) {
  const found = structs.get(cls)?.props.find(x => x.name === prop);
  if (!found) throw new Error(`${cls}.${prop} is not in the mapping`);
  const slot = part === "inner" ? found.type.inner : part === "value" ? found.type.value : part ? null : found.type;
  if (!slot) throw new Error(`${cls}.${prop} has no ${part ?? "type"} to patch (${describe(found.type)})`);
  const code = TYPES.indexOf(type);
  // Same-size swaps only (a one-byte type with no payload for another), so no offset after it moves.
  const simple = t => !["EnumProperty", "StructProperty", "ArrayProperty", "SetProperty", "OptionalProperty", "MapProperty"].includes(t);
  if (code < 0 || !simple(type) || !simple(slot.type)) throw new Error(`only simple same-size swaps are handled (${slot.type} -> ${type})`);
  console.log(`${cls}.${prop}${part ? `.${part}` : ""}: ${slot.type} -> ${type}`);
  data[slot.offset] = code;
}
const header = Buffer.alloc(3 + 4 + 1 + 8);
header.writeUInt16LE(0x30c4, 0); header[2] = version; header.writeInt32LE(0, 3); header[7] = 0;
header.writeUInt32LE(data.length, 8); header.writeUInt32LE(data.length, 12);
writeFileSync(output, Buffer.concat([header, data]));
console.log(`Wrote ${output} (uncompressed, ${data.length} bytes)`);
