// The six outfits of the 26 Nov Light unflag-bar check, recomputed on this revision's catalog (28 Nov 2026):
// the starting outfit, and the same five presets (one per season 12, 10, 8, 5 and 1) put on over it.
// Run: node --import tsx _docs/archetypes-2026-11-22/light-unflag-bar-2026-11-28/outfits.ts > <out>/outfits.json
import { readFileSync } from "node:fs";
import "../../../tests/helpers/load-catalog";
import { presetCoverage, presetPieces, presetSlots, type PresetData } from "../../../src/lib/preset-outfits";
import { startingOutfit } from "../../../src/store/useBuildStore";

const IDS = ["arcadefighter", "medievalbot", "alliancefencer", "cupid", "ftue-01-arenaready"];
const data = JSON.parse(readFileSync(new URL("../../../src/data/preset-outfits.json", import.meta.url), "utf8")) as PresetData;
const start = startingOutfit();
const outfits = [{ id: "starting-outfit", name: "Starting outfit", season: null as number | null, slots: start as object,
  coverage: null as object | null }];
for (const id of IDS) {
  const o = data.outfits.find(x => x.id === id);
  if (!o) throw new Error(`preset ${id} is gone`);
  outfits.push({ id, name: o.name, season: o.season ?? null, slots: presetSlots(o, start), coverage: presetCoverage(presetPieces(o)) });
}
process.stdout.write(JSON.stringify(outfits, null, 1) + "\n");
