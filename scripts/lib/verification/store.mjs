// The generated verdict store. Written ONLY by scripts — never hand-edited. A file a human
// can edit starts drifting, and this workspace has already lost a dashboard twice that way.
//
// `stale` is deliberately NOT a stored mark. It is derived by comparing a mark's `inputs`
// against a freshly computed hash, so a re-bake produces no diff at all.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const MARKS = Object.freeze(["pass", "fail", "na", "notCheckable"]);

export async function loadStore(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return { version: 1, marks: parsed.marks ?? {} };
  } catch {
    return { version: 1, marks: {} };
  }
}

export function setMark(store, key, aspect, mark) {
  if (!MARKS.includes(mark.mark)) {
    throw new Error(`invalid mark '${mark.mark}' (expected one of ${MARKS.join(", ")})`);
  }
  (store.marks[key] ??= {})[aspect] = mark;
}

export function getMark(store, key, aspect) {
  return store.marks[key]?.[aspect];
}

export async function saveStore(path, store) {
  const marks = {};
  for (const key of Object.keys(store.marks).sort()) {
    marks[key] = {};
    for (const aspect of Object.keys(store.marks[key]).sort()) marks[key][aspect] = store.marks[key][aspect];
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, marks }, null, 2) + "\n", "utf8");
}
