// Compare every staged file with the hosted deployment (sha256), and check the headers the app needs.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
const [dir, base] = process.argv.slice(2);
const files = [];
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dir);
const sha = b => createHash("sha256").update(b).digest("hex");
let ok = 0, bad = [], headers = null;
const list = files.filter(f => !f.endsWith("_headers"));
for (let i = 0; i < list.length; i += 16) {
  await Promise.all(list.slice(i, i + 16).map(async f => {
    const rel = relative(dir, f).split("\\").join("/");
    const res = await fetch(base + rel, { headers: { Origin: "https://chronohaxx.github.io" } });
    const body = Buffer.from(await res.arrayBuffer());
    if (!headers && rel.endsWith(".glb")) headers = { file: rel, type: res.headers.get("content-type"), cors: res.headers.get("access-control-allow-origin"), cache: res.headers.get("cache-control") };
    if (res.status === 200 && sha(body) === sha(readFileSync(f))) ok++; else bad.push(`${rel} ${res.status}`);
  }));
}
const missing = await fetch(base + "set-5/does-not-exist.json");
const summary = { base, files: list.length, identical: ok, mismatched: bad.slice(0, 10), glbHeaders: headers, missingStatus: missing.status, ok: ok === list.length && headers?.cors === "*" && missing.status === 404 };
writeFileSync(join(dir, "..", "deployment-anim.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
