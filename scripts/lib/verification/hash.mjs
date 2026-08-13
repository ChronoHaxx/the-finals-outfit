// Hashing for verification input sets. A verdict stores the hash of the inputs it was
// made against; when the recomputed hash differs, the verdict is stale.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// A missing file must hash differently from an empty one: "the mask does not exist" and
// "the mask exists and is blank" are different states and must not collide.
const MISSING = "<missing>";

export async function hashFiles(paths) {
  const h = createHash("sha256");
  for (const p of paths) {
    h.update(p);
    try {
      h.update(await readFile(p));
    } catch {
      h.update(MISSING);
    }
  }
  return h.digest("hex");
}

export function hashValues(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
