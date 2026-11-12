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
 * `exports`: the sound package's exports. Returns { kind: "cue" | "wave" | "sync-loop", variants, attack? }.
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
      default:
        throw new Error(`unsupported cue node ${node.Type}`);
    }
  };
  const cueVolume = p.VolumeMultiplier ?? 0.75, cuePitch = p.PitchMultiplier ?? 1;
  if (!p.FirstNode) throw new Error("cue without a first node");
  return { kind: "cue", variants: walk(p.FirstNode, 1, [cueVolume, cueVolume], [cuePitch, cuePitch]) };
}

// The musical emote MetaSound template. Recognised by its node set, never assumed from the class alone.
const SYNC_TEMPLATE = ["UE.Source.OnPlay", "SyncTime", "Get Wave Duration", "FloatModulo", "Wave Player", "ADSR Envelope"];
function metaSoundVariants(root) {
  const graph = root.Properties?.RootMetaSoundDocument?.RootGraph?.PagedGraphs?.[0];
  const names = new Set((graph?.Nodes ?? []).map(n => n.Name));
  const missing = SYNC_TEMPLATE.filter(n => !names.has(n));
  if (missing.length) throw new Error(`MetaSound ${root.Name} is not the musical sync template (missing ${missing.join(", ")})`);
  const waves = (graph.Variables ?? []).flatMap(v => v.Literal?.AsUObject ?? []).map(o => o.ObjectPath).filter(Boolean);
  if (waves.length !== 1) throw new Error(`MetaSound ${root.Name}: expected one wave variable, found ${waves.length}`);
  // The ADSR node's literals: Sustain Level 1 and Attack Time (the only float below 1). Default 0.05 if unreadable.
  const adsr = graph.Nodes.find(n => n.Name === "ADSR Envelope");
  const floats = (adsr?.InputLiterals ?? []).flatMap(l => l.Value?.AsFloat ?? []);
  const attack = floats.find(f => f > 0 && f < 1) ?? 0.05;
  return { kind: "sync-loop", attack, variants: [{ wave: assetName(waves[0]), waveRef: waves[0], weight: 1, volume: [1, 1], pitch: [1, 1], loop: true }] };
}

/** Fold one notify and its sound's variants into a sounds.json cue (waveInfo: wave name -> { volume, pitch, loop }). */
export function buildCue(notify, sound, waveInfo = () => ({})) {
  const variants = sound.variants.map(v => {
    const w = waveInfo(v.wave) ?? {};
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
