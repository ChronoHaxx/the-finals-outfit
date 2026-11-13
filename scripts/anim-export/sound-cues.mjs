// Emote sound cues (12 Nov 2026): turn an emote's sound notifies into the cue list the viewer schedules
// (src/rig/EmoteSounds.ts). Pure functions over the property JSON AnimExport writes (json mode), so they are testable
// without the game; build-emote-sounds.mjs does the file work and the audio conversion.
//
// How THE FINALS plays an emote's sound. It uses Unreal's built-in audio, not Wwise: no .bnk banks, no .wem media.
//   1. The emote's AnimSequence carries notifies. A notify STATE (AnimNotifyStatePlaySoundAttachedWithCleanup) is a
//      window: NotifyBegin starts its Sound on the character's head and NotifyEnd stops it ("cleanup"), fading over
//      FadeOutDuration. An instant notify (AnimNotify_DiscoveryPlaySound, AnimNotify_EmbarkPlaySound) starts its Sound
//      once and lets it ring out. AnimNotifyVocalization names a gameplay tag (Vocalization.Effort): the character
//      voice picks the line at run time, so there is no asset to resolve and those are skipped.
//   2. The Sound is a SoundBase. A SoundCue is a small node graph cooked into the same package: WavePlayer leaves
//      under Random (weighted pick), Modulator (random volume/pitch range) and the cue's own Volume/PitchMultiplier.
//      A MetaSoundSource is a MetaSound graph; the 17 musical emotes share one template (below).
//   3. Each leaf names a SoundWave, whose cooked bulk data is the compressed audio (Bink Audio, "ABEU" header, in
//      this build).
// Unreal, like Wwise, separates the EVENT (what to play, from the gameplay side: here the notify plus the cue graph)
// from the MEDIA (the encoded waves). The resolver below walks from the event to the media.
//
// Cooked packages store a property only when it differs from the class default, so a missing value is the C++
// default, which the paks do not contain. Defaults used (UE 5 source): SoundCue VolumeMultiplier 0.75 (34 emote
// cues leave it out; 135 store exactly 1, which is what delta serialization against 0.75 looks like), PitchMultiplier
// 1; SoundWave Volume/Pitch 1; Modulator Pitch/Volume 0.95-1.05; Random weights 1. The notify class is Embark's own:
// its VolumeMultiplier/PitchMultiplier are taken as 1, and its FadeOutDuration default is unknown (the values 0.05,
// 0.1, 0.3, 0.5, 1, 1.2, 1.5, 2 and 2.5 are all stored, so it is none of those). sounds.json carries fadeOut only
// where the notify stores one; the player applies its own default elsewhere.
//
// The musical MetaSound template (CPop, Disco, Jester, Mariachi...): Wave Player.Start Time = SyncTime mod the wave's
// duration, Loop on, an ADSR envelope (50 ms attack) on the output. SyncTime is the time since the AudioSyncGroup
// (AudioSyncGroup.MariachiBand) started, so friends doing musical emotes together hear one band in time. For one
// character it is the time since the notify began: the wave loops, positioned by the clock, not by when it started.

export const SOUND_NOTIFIES = {
  AnimNotifyStatePlaySoundAttachedWithCleanup: "window",
  AnimNotify_DiscoveryPlaySound: "once",
  AnimNotify_EmbarkPlaySound: "once",
  AnimNotifyVocalization: "voice",
};

const objectName = ref => ref?.ObjectName?.match(/'([^']+)'/)?.[1] ?? null; // "Class'Outer:Name'" -> Outer:Name
const exportIndex = ref => Number(ref?.ObjectPath?.match(/\.(\d+)$/)?.[1]);
const assetName = path => path?.split("/").at(-1)?.split(".")[0] ?? null;
const round = (v, digits = 4) => +v.toFixed(digits);

/** "/Game/A/B/Name.0" or "/Game/A/B/Name.Name" -> "Discovery/Content/A/B/Name" (the package path, no extension). */
export function packagePath(objectPath) {
  return objectPath.replace(/^\/Game\//, "Discovery/Content/").replace(/\.[^./]+$/, "");
}

/** The sound notifies of an AnimSequence package's exports, in timeline order. */
export function sequenceSoundNotifies(exports) {
  const anim = exports.find(e => e.Type === "AnimSequence" || e.Type === "AnimMontage");
  if (!anim) throw new Error("no AnimSequence export");
  const byName = new Map(exports.map(e => [e.Name, e]));
  const out = [];
  for (const n of anim.Properties?.Notifies ?? []) {
    const ex = byName.get(objectName(n.NotifyStateClass ?? n.Notify)?.split(":").at(-1));
    const kind = ex && SOUND_NOTIFIES[ex.Type];
    if (!kind) continue;
    const p = ex.Properties ?? {};
    out.push({
      kind, type: ex.Type, start: n.LinkValue ?? 0, duration: n.Duration ?? 0,
      sound: p.Sound?.ObjectPath ?? null, vocalization: p.Vocalization?.TagName ?? null,
      volume: p.VolumeMultiplier ?? 1, pitch: p.PitchMultiplier ?? 1, fadeOut: p.FadeOutDuration ?? null,
      ...(p.AudioSyncTag?.TagName ? { syncGroup: p.AudioSyncTag.TagName } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A Sound asset's playable variants: one per wave the graph can reach, with its pick weight and the volume/pitch
 * (fixed, or a [min, max] range picked at random on each play) the path to it multiplies in.
 * `exports`: the sound package's exports. Returns { kind: "cue" | "wave" | "sync-loop", variants, attack?, layers? }.
 * `layers` (a cue whose root path is a SoundNodeMixer): the inputs that play AT ONCE, each a list of variants to pick
 * from; `variants` then lists every layer's variants together (the waves to export). One cue per layer reproduces it.
 * Throws on a node or MetaSound graph this player does not reproduce, so a new kind is never silently wrong.
 */
export function soundVariants(exports) {
  const root = exports.find(e => ["SoundCue", "MetaSoundSource", "SoundWave"].includes(e.Type));
  if (!root) throw new Error("no SoundCue, MetaSoundSource or SoundWave export");
  const p = root.Properties ?? {};
  if (root.Type === "SoundWave") return { kind: "wave", variants: [{ wave: root.Name, weight: 1, volume: [1, 1], pitch: [1, 1] }] };
  if (root.Type === "MetaSoundSource") return metaSoundVariants(root);
  // SoundCue: walk the node graph from FirstNode. A node reference is "Class'Cue:NodeName'" (names are unique in the
  // package); the export index in its ObjectPath (".N") is the fallback.
  const nodeAt = ref => {
    const name = objectName(ref)?.split(":").at(-1);
    const node = exports.find(e => e.Name === name) ?? exports[exportIndex(ref)];
    if (!node) throw new Error(`cue node ${ref?.ObjectName} not found`);
    return node;
  };
  const mul = (a, b) => [a[0] * b[0], a[1] * b[1]];
  const walk = (ref, weight, volume, pitch) => {
    const node = nodeAt(ref), np = node.Properties ?? {};
    switch (node.Type) {
      case "SoundNodeWavePlayer": {
        const wave = assetName(np.SoundWaveAssetPtr?.AssetPathName);
        if (!wave) throw new Error("wave player without a wave");
        return [{ wave, waveRef: np.SoundWaveAssetPtr.AssetPathName, weight, volume, pitch, ...(np.bLooping ? { loop: true } : {}) }];
      }
      case "SoundNodeRandom": {
        const children = np.ChildNodes ?? [];
        const weights = children.map((_, i) => np.Weights?.[i] ?? 1);
        const total = weights.reduce((s, w) => s + w, 0) || 1;
        return children.flatMap((child, i) => walk(child, weight * weights[i] / total, volume, pitch));
      }
      case "SoundNodeModulator":
        return (np.ChildNodes ?? []).flatMap(child => walk(child, weight,
          mul(volume, [np.VolumeMin ?? 0.95, np.VolumeMax ?? 1.05]), mul(pitch, [np.PitchMin ?? 0.95, np.PitchMax ?? 1.05])));
      case "SoundNodeMixer": // below a Random or Modulator: one pick or one random gain for all inputs, not reproduced
        throw new Error("SoundNodeMixer below a Random or Modulator node is not reproduced");
      default:
        throw new Error(`unsupported cue node ${node.Type}`);
    }
  };
  // A SoundNodeMixer plays every input at once, each scaled by its InputVolume (default 1): on the cue's root path
  // (the first node, or a mixer under a mixer) each input becomes a layer of its own. The Chinals TakeAway cue mixes a
  // foley track and an ambience (12 Nov 2026).
  const layersFrom = (ref, volume) => {
    const node = nodeAt(ref), np = node.Properties ?? {};
    if (node.Type !== "SoundNodeMixer") return [walk(ref, 1, volume, [cuePitch, cuePitch])];
    return (np.ChildNodes ?? []).flatMap((child, i) => {
      const input = np.InputVolume?.[i] ?? 1;
      return layersFrom(child, mul(volume, [input, input]));
    });
  };
  const cueVolume = p.VolumeMultiplier ?? 0.75, cuePitch = p.PitchMultiplier ?? 1;
  if (!p.FirstNode) throw new Error("cue without a first node");
  const layers = layersFrom(p.FirstNode, [cueVolume, cueVolume]);
  return layers.length === 1 ? { kind: "cue", variants: layers[0] } : { kind: "cue", variants: layers.flat(), layers };
}

// The musical emote MetaSound template, recognised by its WIRING (which output feeds which input), never by the class
// or node names alone. Each graph is reduced to its edges, written "Node.output -> Node.input" (just "Node" for a graph
// input or output, whose vertex has the node's name), and compared with the template's. Read from the exported assets
// (12 Nov 2026): the 16 global MetaSounds (UE 5.7) and the 24 Chinals ones (UE 5.3) are all this graph.
//   SyncTime -> FloatModulo.X, Get Wave Duration -> FloatModulo.Y, FloatModulo -> Wave Player.Start Time, Loop = true:
//   the wave loops, positioned by the clock. Wave Player.On Play -> ADSR Envelope (attack) -> both output channels.
const SYNC_TEMPLATE_EDGES = [
  "ADSR Envelope.Out Envelope -> Multiply.AdditionalOperands",
  "ADSR Envelope.Out Envelope -> Multiply.AdditionalOperands",
  "ConversionFloatToTime.Out -> Wave Player.Start Time",
  "ConversionTimeToFloat.Out -> FloatModulo.Y",
  "FloatModulo.Result -> ConversionFloatToTime.In",
  "Get Wave Duration.Duration -> ConversionTimeToFloat.In",
  "Multiply.Out -> UE.OutputFormat.Stereo.Audio:0",
  "Multiply.Out -> UE.OutputFormat.Stereo.Audio:1",
  "SyncTime -> FloatModulo.X",
  "UE.Source.OnPlay -> Wave Player.Play",
  "Wave Player.On Play -> ADSR Envelope.Trigger Attack",
  "Wave Player.Out Left -> Multiply.PrimaryOperand",
  "Wave Player.Out Right -> Multiply.PrimaryOperand",
  "WaveAsset.Value -> Get Wave Duration.Wave",
  "WaveAsset.Value -> Wave Player.Wave Asset",
  "WaveAsset.Variable -> WaveAsset.Variable",
  "WaveAsset.Variable -> WaveAsset.Variable",
];
// 22 of the Chinals copies also implement UE.Source.OneShot (the source ends when this fires). A looping Wave Player
// never finishes, so with Loop = true (required below) the edge is inert and the graph sounds the same as the template.
const ONE_SHOT_EDGE = "Wave Player.On Finished -> UE.Source.OneShot.OnFinished";
const SYNC_INTERFACES = new Set(["UE.Source", "UE.OutputFormat.Stereo", "UE.Source.OneShot"]);
// The node classes the wiring implies (class name, any version: the Wave Player is 1.0 on UE 5.3, 1.1 on 5.7).
const SYNC_CLASSES = { "Wave Player": "Wave Player", "ADSR Envelope": "ADSR Envelope", Multiply: "Multiply",
  "Get Wave Duration": "Get Wave Duration", ConversionFloatToTime: "ConversionFloatToTime", ConversionTimeToFloat: "ConversionTimeToFloat" };
// FloatModulo is a MetaSound patch asset, so its class is that asset. Only patches whose own graph was read and found
// to compute X mod Y are accepted. Both below were read from the Chinals client (12 Nov 2026) and are the same graph,
// Result = X - float(int32(X / Y)) * Y: a truncating modulo, equal to X mod Y for the X >= 0 a clock gives. The global
// build's /EmbarkScript patch has the same class ID (62D49B56...); its own copy was not read.
export const MODULO_PATCHES = new Set(["/EmbarkScript/Audio/MetaSound/FloatModulo", "/Game/Audio/MetaSound/FloatModulo"]);

/** A MetaSound graph's wiring: edges (sorted lines), node classes, input literals by "Node.Input", interfaces. UE 5.3
 *  keeps the graph at RootGraph.Graph; 5.5+ pages it (RootGraph.PagedGraphs[0], the default page). */
export function metaSoundWiring(root) {
  const doc = root.Properties?.RootMetaSoundDocument;
  const graph = doc?.RootGraph?.Graph ?? doc?.RootGraph?.PagedGraphs?.[0];
  if (!graph?.Nodes) throw new Error(`MetaSound ${root.Name}: no graph`);
  const nodes = new Map(graph.Nodes.map(n => [n.ID, n]));
  const vertex = (node, id, side) => node.Interface?.[side]?.find(v => v.VertexID === id)?.Name ?? `?${id}`;
  const end = (node, name) => name === node.Name ? node.Name : `${node.Name}.${name}`;
  const edges = (graph.Edges ?? []).map(e => {
    const from = nodes.get(e.FromNodeID), to = nodes.get(e.ToNodeID);
    if (!from || !to) throw new Error(`MetaSound ${root.Name}: an edge to a missing node`);
    return `${end(from, vertex(from, e.FromVertexID, "Outputs"))} -> ${end(to, vertex(to, e.ToVertexID, "Inputs"))}`;
  }).sort();
  // A node's class is its dependency's class name; a patch asset's class key maps to the asset (ReferencedAssetClass*).
  const keys = root.Properties.ReferencedAssetClassKeys ?? [], objects = root.Properties.ReferencedAssetClassObjects ?? [];
  const classes = new Map((doc.Dependencies ?? []).map(d => {
    const c = d.MetaData?.ClassName ?? {};
    const at = keys.findIndex(k => k.startsWith(`External_${c.Namespace ?? "None"}.${c.Name}_`));
    const asset = at >= 0 ? (objects[at]?.ObjectPath ?? objects[at]?.AssetPathName ?? null) : null;
    return [d.ID, { name: c.Name ?? null, asset: asset?.replace(/\.[^./]+$/, "") ?? null }];
  }));
  const literals = new Map(graph.Nodes.flatMap(n => (n.InputLiterals ?? []).map(l => [`${n.Name}.${vertex(n, l.VertexID, "Inputs")}`, l.Value])));
  return { graph, edges, literals, interfaces: (doc.Interfaces ?? []).map(i => i.Name),
    classes: graph.Nodes.map(n => ({ node: n.Name, ...(classes.get(n.ClassID) ?? { name: null, asset: null }) })) };
}

function metaSoundVariants(root) {
  const { graph, edges, classes, literals, interfaces } = metaSoundWiring(root);
  const fail = why => { throw new Error(`MetaSound ${root.Name} is not the musical sync template (${why})`); };
  const expected = [...SYNC_TEMPLATE_EDGES, ...(interfaces.includes("UE.Source.OneShot") ? [ONE_SHOT_EDGE] : [])].sort();
  if (edges.join("\n") !== expected.join("\n")) fail("its wiring differs");
  if (!interfaces.includes("UE.Source") || interfaces.some(i => !SYNC_INTERFACES.has(i))) fail(`interfaces ${interfaces.join(", ")}`);
  for (const c of classes) {
    if (SYNC_CLASSES[c.node] && c.name !== SYNC_CLASSES[c.node]) fail(`${c.node} is a ${c.name}`);
    if (c.node === "FloatModulo" && !MODULO_PATCHES.has(c.asset)) fail(`FloatModulo is ${c.asset ?? "an unknown class"}, not a patch read and found to be a modulo`);
  }
  if (literals.get("Wave Player.Loop")?.AsBoolean?.[0] !== true) fail("Wave Player.Loop is not true");
  // Loop is the Wave Player's only literal in every template read: a Pitch Shift or loop region would change the sound.
  const playerInputs = [...literals.keys()].filter(k => k.startsWith("Wave Player.") && k !== "Wave Player.Loop");
  if (playerInputs.length) fail(`Wave Player literals ${playerInputs.join(", ")}`);
  // The source's own Pitch would resample the output against SyncTime: not reproduced. None of the 40 read stores one.
  if ((root.Properties.Pitch ?? 1) !== 1) fail(`its Pitch is ${root.Properties.Pitch}`);
  if (literals.get("ADSR Envelope.Sustain Level")?.AsFloat?.[0] !== 1) fail("ADSR sustain is not 1");
  const attack = literals.get("ADSR Envelope.Attack Time")?.AsFloat?.[0];
  if (!(attack > 0 && attack < 1)) fail("no ADSR attack time");
  const waves = (graph.Variables ?? []).flatMap(v => v.Literal?.AsUObject ?? []).map(o => o.ObjectPath).filter(Boolean);
  if (waves.length !== 1) throw new Error(`MetaSound ${root.Name}: expected one wave variable, found ${waves.length}`);
  // Loudness: UMetaSoundSource is a USoundWave, and its own Volume (class default 1; no MetaSound read stores exactly 1)
  // scales the rendered output. The Wave Player inside only decodes its wave: that SoundWave's Volume and Pitch are not
  // applied (by design, Epic on UE 5.3; same in 5.7), so buildCue leaves them out for "sync-loop" sounds.
  const volume = root.Properties.Volume ?? 1;
  return { kind: "sync-loop", attack, variants: [{ wave: assetName(waves[0]), waveRef: waves[0], weight: 1, volume: [volume, volume], pitch: [1, 1], loop: true }] };
}

/** Fold one notify and its sound's variants into a sounds.json cue (waveInfo: wave name -> { volume, pitch, loop }). A
 *  MetaSound's Wave Player ignores its wave's own Volume, Pitch and looping, so waveInfo is not applied to "sync-loop". */
export function buildCue(notify, sound, waveInfo = () => ({})) {
  const variants = sound.variants.map(v => {
    const w = sound.kind === "sync-loop" ? {} : waveInfo(v.wave) ?? {};
    const gain = [v.volume[0] * (w.volume ?? 1) * notify.volume, v.volume[1] * (w.volume ?? 1) * notify.volume].map(x => round(x));
    const rate = [v.pitch[0] * (w.pitch ?? 1) * notify.pitch, v.pitch[1] * (w.pitch ?? 1) * notify.pitch].map(x => round(x));
    return { wave: v.wave, weight: round(v.weight), gain: gain[0] === gain[1] ? gain[0] : gain, rate: rate[0] === rate[1] ? rate[0] : rate,
      ...(v.loop || w.loop ? { loop: true } : {}) };
  });
  return {
    start: round(notify.start), kind: notify.kind,
    // A window's end, where its sound is stopped (instant cues ring out: no end).
    ...(notify.kind === "window" ? { duration: round(notify.duration) } : {}),
    // Only where the notify stores one: the class default is unknown, so the player owns that guess (EmoteSounds.ts).
    ...(notify.kind === "window" && notify.fadeOut != null ? { fadeOut: round(notify.fadeOut) } : {}),
    ...(sound.attack ? { attack: round(sound.attack) } : {}),
    ...(notify.syncGroup ? { syncGroup: notify.syncGroup } : {}),
    sound: assetName(notify.sound),
    variants,
  };
}
