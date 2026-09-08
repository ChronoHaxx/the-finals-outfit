// Keep test discovery out of the large, gitignored extracted-asset directories.
// tsx's default ** test glob walks the entire working tree before printing TAP.
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return /\.test\.(?:mjs|ts)$/.test(entry.name) ? [path] : [];
  });
}
const files = ["tests", "scripts/lib"].flatMap((directory) => findTests(join(root, directory))).sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files],
  { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
