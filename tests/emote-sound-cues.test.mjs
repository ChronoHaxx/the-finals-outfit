import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCue, packagePath, sequenceSoundNotifies, soundVariants } from "../scripts/anim-export/sound-cues.mjs";

// Emote sound cues (12 Nov 2026): the notify -> SoundCue / MetaSound -> SoundWave walk, on property JSON shaped like
// AnimExport's json mode output of the Season 12 game files (values from real assets, trimmed to what is read).

const ref = (cls, outer, name, index) => ({ ObjectName: `${cls}'${outer}:${name}'`, ObjectPath: `/Game/X/${outer}.${index}` });
const SEQ = "HM_FrontEnd_Emotes_A_Test_00";
const notifyLink = (cls, name, index, start, duration) => ({
  NotifyStateClass: duration ? ref(cls, SEQ, name, index) : null, Notify: duration ? null : ref(cls, SEQ, name, index),
  LinkValue: start, Duration: duration,
});
const sequence = [
  { Type: "AnimSequence", Name: SEQ, Properties: { SequenceLength: 7.33, Notifies: [
    notifyLink("AnimNotifyStateHideWeapon", "AnimNotifyStateHideWeapon_0", 1, 0.0001, 7.33),
    notifyLink("AnimNotifyStatePlaySoundAttachedWithCleanup", "AnimNotifyStatePlaySoundAttachedWithCleanup_1", 3, 2.43, 0.39),
    notifyLink("AnimNotifyStatePlaySoundAttachedWithCleanup", "AnimNotifyStatePlaySoundAttachedWithCleanup_0", 2, 0.2484, 6.3966),
    notifyLink("AnimNotify_EmbarkPlaySound", "AnimNotify_EmbarkPlaySound_0", 4, 0.443, 0),
    notifyLink("AnimNotifyVocalization", "AnimNotifyVocalization_0", 5, 1.38, 0),
  ] } },
  { Type: "AnimNotifyStateHideWeapon", Name: "AnimNotifyStateHideWeapon_0", Properties: {} },
  { Type: "AnimNotifyStatePlaySoundAttachedWithCleanup", Name: "AnimNotifyStatePlaySoundAttachedWithCleanup_0",
    Properties: { Sound: { ObjectName: "SoundCue'Emotes_FrontEnd_AcePilot_Cue'", ObjectPath: "/Game/Discovery/Audio/Character/Emotes/Frontend/AcePilot/Emotes_FrontEnd_AcePilot_Cue.0" }, AttachName: "head" } },
  { Type: "AnimNotifyStatePlaySoundAttachedWithCleanup", Name: "AnimNotifyStatePlaySoundAttachedWithCleanup_1",
    Properties: { Sound: { ObjectName: "SoundCue'BrushCloth_Cue'", ObjectPath: "/Game/X/BrushCloth_Cue.0" }, PitchMultiplier: 0.8, FadeOutDuration: 0.1, VolumeMultiplier: 1.2 } },
  { Type: "AnimNotify_EmbarkPlaySound", Name: "AnimNotify_EmbarkPlaySound_0",
    Properties: { Sound: { ObjectName: "SoundCue'FacePalm_Cue'", ObjectPath: "/Game/X/FacePalm_Cue.0" }, bFollow: true } },
  { Type: "AnimNotifyVocalization", Name: "AnimNotifyVocalization_0", Properties: { Vocalization: { TagName: "Vocalization.EffortShort" } } },
];

test("sound notifies come out in timeline order with their kind; HideWeapon and other notifies are ignored", () => {
  const notifies = sequenceSoundNotifies(sequence);
  assert.deepEqual(notifies.map(n => [n.kind, n.start]), [["window", 0.2484], ["once", 0.443], ["voice", 1.38], ["window", 2.43]]);
  assert.equal(notifies[0].fadeOut, null, "no stored FadeOutDuration: unknown default, left to the player");
  assert.deepEqual([notifies[3].volume, notifies[3].pitch, notifies[3].fadeOut], [1.2, 0.8, 0.1]);
  assert.equal(notifies[2].vocalization, "Vocalization.EffortShort");
});

test("package paths map /Game to the Discovery content root and drop the object suffix", () => {
  assert.equal(packagePath("/Game/Discovery/Audio/A/Cue.0"), "Discovery/Content/Discovery/Audio/A/Cue");
  assert.equal(packagePath("/Game/Discovery/Audio/A/Wave.Wave"), "Discovery/Content/Discovery/Audio/A/Wave");
});

test("a plain cue: one wave at the cue's volume; a missing VolumeMultiplier is the engine default 0.75", () => {
  const cue = (volume) => [
    { Type: "SoundCue", Name: "C", Properties: { FirstNode: ref("SoundNodeWavePlayer", "C", "SoundNodeWavePlayer_1", 1), ...(volume === undefined ? {} : { VolumeMultiplier: volume }) } },
    { Type: "SoundNodeWavePlayer", Name: "SoundNodeWavePlayer_1", Properties: { SoundWaveAssetPtr: { AssetPathName: "/Game/X/AcePilot.AcePilot" } } },
  ];
  assert.deepEqual(soundVariants(cue(1)), { kind: "cue", variants: [{ wave: "AcePilot", waveRef: "/Game/X/AcePilot.AcePilot", weight: 1, volume: [1, 1], pitch: [1, 1] }] });
  assert.deepEqual(soundVariants(cue(undefined)).variants[0].volume, [0.75, 0.75]);
});

test("Random weights split the pick and a Modulator multiplies its ranges (pitch defaults 0.95-1.05)", () => {
  const exports = [
    { Type: "SoundCue", Name: "C", Properties: { FirstNode: ref("SoundNodeModulator", "C", "SoundNodeModulator_0", 1), VolumeMultiplier: 0.45 } },
    { Type: "SoundNodeModulator", Name: "SoundNodeModulator_0", Properties: { VolumeMin: 0.97, VolumeMax: 1.03, ChildNodes: [ref("SoundNodeRandom", "C", "SoundNodeRandom_0", 2)] } },
    { Type: "SoundNodeRandom", Name: "SoundNodeRandom_0", Properties: { Weights: [3, 1], ChildNodes: [ref("SoundNodeWavePlayer", "C", "W0", 3), ref("SoundNodeWavePlayer", "C", "W1", 4)] } },
    { Type: "SoundNodeWavePlayer", Name: "W0", Properties: { SoundWaveAssetPtr: { AssetPathName: "/Game/X/A.A" } } },
    { Type: "SoundNodeWavePlayer", Name: "W1", Properties: { SoundWaveAssetPtr: { AssetPathName: "/Game/X/B.B" } } },
  ];
  const { variants } = soundVariants(exports);
  assert.deepEqual(variants.map(v => [v.wave, v.weight]), [["A", 0.75], ["B", 0.25]]);
  assert.ok(Math.abs(variants[0].volume[0] - 0.45 * 0.97) < 1e-9 && Math.abs(variants[0].volume[1] - 0.45 * 1.03) < 1e-9);
  assert.deepEqual(variants[0].pitch, [0.95, 1.05]);
});

test("an unknown cue node is an error, never a silent guess", () => {
  assert.throws(() => soundVariants([
    { Type: "SoundCue", Name: "C", Properties: { FirstNode: ref("SoundNodeConcatenator", "C", "N", 1) } },
    { Type: "SoundNodeConcatenator", Name: "N", Properties: {} },
  ]), /unsupported cue node SoundNodeConcatenator/);
});

// The musical template, as in Emotes_Frontend_CPOP_Mix1_MetaSound (nodes trimmed to names and the ADSR literals).
const metaSound = (nodes) => [{ Type: "MetaSoundSource", Name: "M", Properties: { bLooping: true, RootMetaSoundDocument: { RootGraph: { PagedGraphs: [{
  Nodes: nodes.map(Name => ({ Name, ...(Name === "ADSR Envelope" ? { InputLiterals: [{ Value: { AsFloat: [1] } }, { Value: { AsFloat: [0.05] } }] } : {}) })),
  Variables: [{ Name: "Wave", Literal: { AsUObject: [{ ObjectName: "SoundWave'Emotes_FrontEnd_CPop_Mix1'", ObjectPath: "/Game/X/Emotes_FrontEnd_CPop_Mix1.0" }] } }],
}] } } } }];
const TEMPLATE = ["UE.Source.OnPlay", "SyncTime", "Get Wave Duration", "FloatModulo", "Wave Player", "ADSR Envelope", "Multiply"];

test("the musical MetaSound template is a looping wave positioned by the clock, with its ADSR attack", () => {
  assert.deepEqual(soundVariants(metaSound(TEMPLATE)), { kind: "sync-loop", attack: 0.05,
    variants: [{ wave: "Emotes_FrontEnd_CPop_Mix1", waveRef: "/Game/X/Emotes_FrontEnd_CPop_Mix1.0", weight: 1, volume: [1, 1], pitch: [1, 1], loop: true }] });
  assert.throws(() => soundVariants(metaSound(TEMPLATE.filter(n => n !== "FloatModulo"))), /not the musical sync template/);
});

test("a cue folds notify, cue and wave gain/rate together; windows keep their end, instant cues do not", () => {
  const notifies = sequenceSoundNotifies(sequence);
  const window = notifies.find(n => n.start === 2.43), once = notifies.find(n => n.kind === "once");
  const sound = { kind: "cue", variants: [{ wave: "Brush", weight: 1, volume: [0.97, 1.03], pitch: [1, 1] }] };
  assert.deepEqual(buildCue(window, sound, () => ({ volume: 1.5 })), { start: 2.43, kind: "window", duration: 0.39, fadeOut: 0.1,
    sound: "BrushCloth_Cue", variants: [{ wave: "Brush", weight: 1, gain: [1.746, 1.854], rate: 0.8 }] });
  assert.deepEqual(buildCue(once, sound), { start: 0.443, kind: "once", sound: "FacePalm_Cue",
    variants: [{ wave: "Brush", weight: 1, gain: [0.97, 1.03], rate: 1 }] });
  const sync = buildCue({ ...window, fadeOut: null, syncGroup: "AudioSyncGroup.MariachiBand" }, soundVariants(metaSound(TEMPLATE)));
  assert.equal(sync.fadeOut, undefined, "no stored fade: the player's default applies");
  assert.deepEqual([sync.attack, sync.syncGroup, sync.variants[0].loop], [0.05, "AudioSyncGroup.MariachiBand", true]);
});
