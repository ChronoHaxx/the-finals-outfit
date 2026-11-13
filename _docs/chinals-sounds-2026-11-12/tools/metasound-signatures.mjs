#!/usr/bin/env node
// Chinals emote sounds (12 Nov 2026): is every MetaSound the global musical template? Each graph is reduced to a
// signature that ignores IDs and the wave: its interfaces, its nodes (name + class), every edge written as
// "Node.output -> Node.input", every input literal written as "Node.input = value", and its variables (name + type).
// Two graphs with the same signature compute the same thing up to the wave they play.
//
// Usage: node metasound-signatures.mjs <json-sound dir> [<another json-sound dir>...]  (writes nothing; prints groups)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const literal = v => {
  if (!v) return "?";
  for (const [k, x] of Object.entries(v)) if (k.startsWith("As") && k !== "AsNumDefault" && Array.isArray(x) && x.length)
    return k === "AsUObject" ? `<${x.map(o => o.ObjectName?.split("'")[0]).join(",")}>` : `${k}${JSON.stringify(x)}`;
  return "none";
};
export function signature(root) {
  const doc = root.Properties.RootMetaSoundDocument;
  // UE 5.3 keeps the graph at RootGraph.Graph; 5.5+ pages it (RootGraph.PagedGraphs[0], the default page).
  const graph = doc.RootGraph.Graph ?? doc.RootGraph.PagedGraphs?.[0];
  const classes = new Map((doc.Dependencies ?? []).map(d => [d.ID, `${d.MetaData.ClassName.Namespace ?? ""}:${d.MetaData.ClassName.Name}:${d.MetaData.ClassName.Variant ?? ""}@${d.MetaData.Version?.Major}.${d.MetaData.Version?.Minor}`]));
  const nodes = new Map(graph.Nodes.map(n => [n.ID, n]));
  const vertex = (node, id, side) => node.Interface[side].find(v => v.VertexID === id)?.Name ?? `?${id}`;
  const lines = [];
  lines.push(...(doc.Interfaces ?? []).map(i => `interface ${i.Name} ${i.Number?.Major}.${i.Number?.Minor}`).sort());
  lines.push(...graph.Nodes.map(n => `node ${n.Name} = ${classes.get(n.ClassID) ?? n.ClassID}`).sort());
  lines.push(...graph.Edges.map(e => {
    const from = nodes.get(e.FromNodeID), to = nodes.get(e.ToNodeID);
    return `edge ${from.Name}.${vertex(from, e.FromVertexID, "Outputs")} -> ${to.Name}.${vertex(to, e.ToVertexID, "Inputs")}`;
  }).sort());
  lines.push(...graph.Nodes.flatMap(n => (n.InputLiterals ?? []).map(l => `literal ${n.Name}.${vertex(n, l.VertexID, "Inputs")} = ${literal(l.Value)}`)).sort());
  lines.push(...(graph.Variables ?? []).map(v => `variable ${v.Name}: ${v.TypeName} = ${literal(v.Literal)}`).sort());
  return lines;
}

if (process.argv[1]?.endsWith("metasound-signatures.mjs")) {
  const groups = new Map();
  for (const dir of process.argv.slice(2)) for (const file of walk(dir).filter(f => f.endsWith(".json"))) {
    const root = JSON.parse(readFileSync(file, "utf8")).find(e => e.Type === "MetaSoundSource");
    if (!root) continue;
    const key = signature(root).join("\n");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${dir.includes("chinals") ? "CN" : "GL"} ${root.Name}`);
  }
  let i = 0;
  for (const [key, names] of groups) {
    console.log(`\n=== signature ${++i}: ${names.length} MetaSounds\n  ${names.join("\n  ")}\n--- ${key.split("\n").length} lines:`);
    console.log(key.split("\n").map(l => `    ${l}`).join("\n"));
  }
}
