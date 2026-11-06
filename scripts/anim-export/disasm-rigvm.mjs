#!/usr/bin/env node
// RigVM disassembler (showcase animation, 5 Nov 2026): prints a cooked Control Rig's bytecode as readable lines, from
// the rig package's property JSON (AnimExport json mode). Used to read THE FINALS' character deformation rig
// (SK_CharacterMeshMergeTarget_CtrlRig), which drives the *_vpj twist/volume joints every frame, so its rules can be
// ported instead of guessed.
//
// Memory model (UE RigVM): each operand is {MemoryType, RegisterIndex, RegisterOffset}. MemoryType 0 = work memory
// (per-instance values; register i = the i-th property of the RigVMMemory_Work class), 1 = literal memory (constants;
// values on Default__RigVMMemory_Literal), 2 = external variables (the rig's own variables). RegisterOffset 65535 =
// the whole register, otherwise an index into that memory's PropertyPathDescriptions (a sub-field such as
// Transform.Rotation). Opcodes seen: 101 Execute (call FunctionNamesStorage[FunctionIndex] with the arguments in the
// unit struct's member order), 68 Copy, 65 Zero (reset a branch register), 100 JumpToBranch, 75 JumpBackward
// (InstructionIndex = how far back: a branch block returns to its branch node), 80 Exit.
//
//   node scripts/anim-export/disasm-rigvm.mjs <rig.json> [--from N] [--to N] > out.txt
import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.reduce((pairs, a, i, all) => a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs, []));
const exports = JSON.parse(readFileSync(file, "utf8"));
const vm = exports.find(e => e.Type === "RigVM");
const memClass = name => exports.find(e => e.Type === "RigVMMemoryStorageGeneratorClass" && e.Name === name);
const literal = memClass("RigVMMemory_Literal"), work = memClass("RigVMMemory_Work");
const literalValues = exports.find(e => e.Type === "RigVMMemory_Literal")?.Properties ?? {};
// Register order is the VM's own register table (PropertyDescs), not the generated class's property order.
const memories = {
  0: { props: vm.DefaultWorkMemoryStorage.PropertyDescs, paths: vm.DefaultWorkMemoryStorage.PropertyPathDescriptions ?? [], values: {} },
  1: { props: vm.LiteralMemoryStorage.PropertyDescs, paths: vm.LiteralMemoryStorage.PropertyPathDescriptions ?? [], values: literalValues },
};
void literal; void work;
const short = name => name.replace(/^DeformationRig___DeformationRig_/, "").replace(/^[A-Za-z]+Rig___[A-Za-z]+Rig_/, "");
const fmt = value => {
  if (value === undefined) return "";
  if (value && typeof value === "object") {
    if ("Name" in value && "Type" in value) return value.Name;
    if ("X" in value && "Y" in value && "Z" in value && "W" in value) return `q(${[value.X, value.Y, value.Z, value.W].map(v => +v.toFixed(4)).join(",")})`;
    if ("X" in value && "Y" in value && "Z" in value) return `v(${[value.X, value.Y, value.Z].map(v => +v.toFixed(4)).join(",")})`;
    if ("Pitch" in value) return `rot(p${value.Pitch},y${value.Yaw},r${value.Roll})`;
    if ("Rotation" in value && "Translation" in value) return `T(${fmt(value.Rotation)} ${fmt(value.Translation)} s${fmt(value.Scale3D)})`;
    return JSON.stringify(value).replace(/"/g, "").slice(0, 160);
  }
  return String(value);
};
function operand(a) {
  if (!a) return "?";
  if (a.MemoryType === 2) return `ext[${a.RegisterIndex}]`;
  const mem = memories[a.MemoryType];
  const prop = mem?.props[a.RegisterIndex];
  if (!prop) return `m${a.MemoryType}[${a.RegisterIndex}]`;
  let text = (a.MemoryType === 1 ? "#" : "") + short(prop.Name);
  if (a.RegisterOffset !== 65535) text += "." + (mem.paths[a.RegisterOffset]?.SegmentPath ?? `+${a.RegisterOffset}`);
  if (a.MemoryType === 1 && a.RegisterOffset === 65535) text += `=${fmt(mem.values[prop.Name])}`;
  return text;
}
const I = vm.ByteCodeStorage.Instructions, F = vm.FunctionNamesStorage;
const from = Number(opt.from ?? 0), to = Number(opt.to ?? I.length - 1);
for (let k = from; k <= to; k++) {
  const i = I[k];
  let line;
  if (i.OpCode === 101) line = `${F[i.FunctionIndex].replace(/^F(RigUnit|RigVMFunction)_/, "").replace(/::Execute$/, "")}(${i.Arguments.map(operand).join(", ")})`;
  else if (i.OpCode === 68) line = `copy ${operand(i.Source)} -> ${operand(i.Target)}`;
  else if (i.OpCode === 65) line = `zero ${operand(i.Arg)}`;
  else if (i.OpCode === 100) line = `branch on ${operand(i.Arg)} (blocks from ${i.FirstBranchInfoIndex})`;
  else if (i.OpCode === 75) line = `jump back ${i.InstructionIndex} -> ${k - i.InstructionIndex}`;
  else if (i.OpCode === 80) line = "exit";
  else line = JSON.stringify(i);
  console.log(`${String(k).padStart(3)}  ${line}`);
}
