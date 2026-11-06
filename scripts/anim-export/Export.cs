using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.Utils;
using CUE4Parse_Conversion.Animations;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Decode AnimSequences to UE bone-local tracks (centimetres, UE's left-handed Z-up component space), one sample
// per authored frame, plus the skeleton's and the target mesh's reference poses. No retargeting or axis
// conversion happens here: scripts/anim-export/convert-clips.mjs owns that step, against the app's own body.
// A requests file with "skeleton": "*" decodes each sequence against its OWN skeleton (emote props: every prop has its
// own rig) and writes no skeleton.json; each anim record then names its skeleton.
static class Export
{
    record Requests(string Skeleton, string[] Meshes, string[] Anims);

    static double[] T(FVector v) => [R(v.X), R(v.Y), R(v.Z)];
    static double[] Q(FQuat q) => [R(q.X), R(q.Y), R(q.Z), R(q.W)];
    static double R(float v) => Math.Round(v, 6);

    static object? Property(UAnimSequence seq, string name) =>
        seq.Properties.FirstOrDefault(p => p.Name.Text == name)?.Tag?.GenericValue;

    static JObject CurveValues(UAnimSequence seq, int frames)
    {
        var result = new JObject();
        CUE4Parse.UE4.Assets.Exports.Animation.FFloatCurve[]? curves = null;
        try { curves = seq.CompressedCurveData?.FloatCurves; } catch { /* undecodable: no values */ }
        if (curves == null || curves.Length == 0) curves = seq.RawCurveData?.FloatCurves;
        foreach (var curve in curves ?? [])
        {
            var name = curve.CurveName.Text;
            if (name.StartsWith("Face_", StringComparison.OrdinalIgnoreCase) || curve.FloatCurve == null) continue;
            var step = frames > 1 ? seq.SequenceLength / (frames - 1) : 0;
            result[name] = JArray.FromObject(Enumerable.Range(0, frames).Select(f => R(curve.FloatCurve.Eval(f * step, 0))));
        }
        return result;
    }

    public static int Run(IFileProvider provider, string requestsPath, string output)
    {
        var requests = JsonConvert.DeserializeObject<Requests>(File.ReadAllText(requestsPath))!;
        var packages = provider.Files.Keys.Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)).ToList();
        string Resolve(string request)
        {
            var exact = packages.FirstOrDefault(k => k.Equals(request + ".uasset", StringComparison.OrdinalIgnoreCase));
            if (exact != null) return exact;
            var byName = packages.Where(k => Path.GetFileNameWithoutExtension(k).Equals(request, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (byName.Length != 1) throw new InvalidDataException($"'{request}': expected one package, found {byName.Length}");
            return byName[0];
        }
        Console.WriteLine($"ACL natives available: {CUE4ParseNatives.IsFeatureAvailable("ACL")}");

        var perSequence = requests.Skeleton == "*";
        var skeletonPath = perSequence ? null : Resolve(requests.Skeleton);
        var skeleton = perSequence ? null : provider.LoadPackage(skeletonPath!).GetExports().OfType<USkeleton>().Single();
        var refSkel = skeleton?.ReferenceSkeleton;
        if (skeleton != null && refSkel != null) File.WriteAllText(Path.Combine(output, "skeleton.json"), JsonConvert.SerializeObject(new
        {
            path = skeletonPath,
            bones = refSkel.FinalRefBoneInfo.Select((b, i) => new
            {
                name = b.Name.Text, parent = b.ParentIndex,
                mode = i < skeleton.BoneTree.Length ? skeleton.BoneTree[i].ToString() : null,
                t = T(refSkel.FinalRefBonePose[i].Translation), r = Q(refSkel.FinalRefBonePose[i].Rotation),
                s = T(refSkel.FinalRefBonePose[i].Scale3D),
            }),
        }));

        foreach (var request in requests.Meshes ?? [])
        {
            var path = Resolve(request);
            var mesh = provider.LoadPackage(path).GetExports().OfType<USkeletalMesh>().Single();
            var meshSkel = mesh.ReferenceSkeleton;
            File.WriteAllText(Path.Combine(output, $"mesh-{Path.GetFileNameWithoutExtension(path)}.json"), JsonConvert.SerializeObject(new
            {
                path,
                bones = meshSkel.FinalRefBoneInfo.Select((b, i) => new
                {
                    name = b.Name.Text, parent = b.ParentIndex,
                    t = T(meshSkel.FinalRefBonePose[i].Translation), r = Q(meshSkel.FinalRefBonePose[i].Rotation),
                    s = T(meshSkel.FinalRefBonePose[i].Scale3D),
                }),
            }));
        }

        Directory.CreateDirectory(Path.Combine(output, "anims"));
        var index = new JArray();
        int failures = 0;
        foreach (var request in requests.Anims.Distinct())
        {
            try
            {
                var path = Resolve(request);
                var name = Path.GetFileNameWithoutExtension(path);
                var seq = provider.LoadPackage(path).GetExports().OfType<UAnimSequence>().Single();
                var seqSkeleton = skeleton ?? seq.Skeleton.Load<USkeleton>() ?? throw new InvalidDataException("sequence has no skeleton");
                var seqRef = seqSkeleton.ReferenceSkeleton;
                var set = AnimConverter.ConvertAnims(seqSkeleton, seq);
                var anim = set.Sequences.Single();
                int frames = anim.NumFrames;
                var bones = new JArray();
                for (int b = 0; b < anim.Tracks.Count && b < seqRef.FinalRefBoneInfo.Length; b++)
                {
                    var track = anim.Tracks[b];
                    if (track == null || !track.HasKeys()) continue;
                    var tr = new List<double>(); var rot = new List<double>(); var sc = new List<double>();
                    for (int f = 0; f < frames; f++)
                    {
                        var q = new FQuat(float.NaN, 0, 0, 0); var p = new FVector(float.NaN, 0, 0); var s = new FVector(float.NaN, 0, 0);
                        track.GetBoneTransform(f, frames, ref q, ref p, ref s);
                        if (!float.IsNaN(q.X)) rot.AddRange(Q(q));
                        if (!float.IsNaN(p.X)) tr.AddRange(T(p));
                        if (!float.IsNaN(s.X)) sc.AddRange(T(s));
                    }
                    bones.Add(new JObject
                    {
                        ["name"] = seqRef.FinalRefBoneInfo[b].Name.Text,
                        ["r"] = rot.Count > 0 ? JArray.FromObject(rot) : null,
                        ["t"] = tr.Count > 0 ? JArray.FromObject(tr) : null,
                        ["s"] = sc.Count > 0 ? JArray.FromObject(sc) : null,
                    });
                }
                var record = new JObject
                {
                    ["name"] = name, ["path"] = path, ["skeleton"] = seqSkeleton.GetPathName(), ["frames"] = frames, ["fps"] = anim.FramesPerSecond,
                    ["length"] = seq.SequenceLength, ["rateScale"] = seq.RateScale, ["loop"] = seq.bLoop,
                    ["additive"] = seq.AdditiveAnimType.ToString(), ["interpolation"] = seq.Interpolation.ToString(),
                    ["trackCount"] = seq.GetNumTracks(),
                    ["curves"] = JArray.FromObject((seq.CompressedCurveNames ?? []).Select(c => c.DisplayName.Text)),
                    // Gameplay float curves sampled once per frame (facial Face_* curves left out: many, and unused). The
                    // emotes' PropAnimSequenceTime is the explicit time their props' AnimBlueprints evaluate at.
                    ["curveValues"] = CurveValues(seq, frames),
                    // Root motion: when enabled, UE extracts the root bone's motion and LOCKS the root in the evaluated
                    // pose (RootMotionRootLock: RefPose by default, AnimFirstFrame or Zero), whoever plays it.
                    ["rootMotion"] = Property(seq, "bEnableRootMotion") is true,
                    ["rootLock"] = Property(seq, "RootMotionRootLock")?.ToString() ?? "ERootMotionRootLock::RefPose",
                    ["notifies"] = JArray.FromObject((seq.Notifies ?? []).Select(n => new
                    {
                        name = n.NotifyName?.Text, cls = n.Notify?.Name ?? n.NotifyStateClass?.Name,
                        time = n.TriggerTimeOffset, duration = n.Duration,
                    })),
                    ["bones"] = bones,
                };
                File.WriteAllText(Path.Combine(output, "anims", name + ".json"), record.ToString(Formatting.None));
                index.Add(new JObject { ["name"] = name, ["path"] = path, ["frames"] = frames, ["fps"] = anim.FramesPerSecond, ["animatedBones"] = bones.Count });
                Console.WriteLine($"{name}: {frames} frames @ {anim.FramesPerSecond} fps, {bones.Count} animated bones");
            }
            catch (Exception e)
            {
                failures++;
                index.Add(new JObject { ["request"] = request, ["error"] = e.GetType().Name + ": " + e.Message });
                Console.Error.WriteLine($"{request}: {e.GetType().Name}: {e.Message}");
            }
        }
        File.WriteAllText(Path.Combine(output, "anims-index.json"), index.ToString(Formatting.Indented));
        return failures == 0 ? 0 : 1;
    }
}
