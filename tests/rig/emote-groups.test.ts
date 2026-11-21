import { test } from "node:test";
import assert from "node:assert/strict";
import { emoteGroups, hasOwnIcon } from "../../src/components/EmotePicker";
import type { ClipInfo } from "../../src/rig/RigAnimator";

const RARITY = ["Mythic", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
const clip = (id: string, label: string, emote: Partial<NonNullable<ClipInfo["emote"]>>, icon?: string) =>
  ({ id, label, kind: "emote", file: `${id}.json`, source: id, duration: 1, icon, emote }) as unknown as ClipInfo;

test("Season 1-2 emotes get their own season sections, newest season first", () => {
  const groups = emoteGroups([
    clip("clap", "Applause Pause", { season: 1, rarity: "Common" }, "icons/T_UI_ICON_InGameEmote_Clap.webp"),
    clip("ace-pilot", "Valkyria's Embrace", { season: 6, rarity: "Legendary" }, "icons/T_UI_ICON_Emote_AcePilot.webp"),
    clip("rage-quit", "Keyed Up", { season: 2, rarity: "Rare" }, "icons/T_UI_ICON_InGameEmote_RageQuit.webp"),
    clip("make-it-rain", "Make It Rain", { season: 1, rarity: "Epic" }, "icons/T_UI_ICON_InGameEmote_MakeItRain.webp"),
  ], RARITY, false);
  assert.deepEqual(groups.map(g => g.title), ["Season 6", "Season 2", "Season 1"]);
  assert.deepEqual(groups[2].clips.map(c => c.id), ["make-it-rain", "clap"], "rarity first (Epic before Common)");
});

test("emotes without their own icon go under Uncategorised, last", () => {
  const generic = "icons/T_UI_Icon_General_Emote.webp";
  assert.equal(hasOwnIcon(clip("a", "A", {}, generic)), false);
  assert.equal(hasOwnIcon(clip("b", "B", {})), false);
  assert.equal(hasOwnIcon(clip("c", "C", {}, "icons/T_UI_ICON_Emote_Cooking.webp")), true);
  const groups = emoteGroups([
    clip("cn-emote-gacha-01", "Gacha_01", {}, generic),
    clip("cn-emote-cooking", "Wok-Flip", {}, "icons/T_UI_ICON_Emote_Cooking.webp"),
    clip("no-icon", "Mystery", {}),
  ], RARITY, true);
  assert.deepEqual(groups.map(g => [g.key, g.title, g.clips.map(c => c.id)]), [
    ["season-0", "Chinals emotes", ["cn-emote-cooking"]],
    ["uncategorised", "Uncategorised", ["cn-emote-gacha-01", "no-icon"]],
  ]);
});
