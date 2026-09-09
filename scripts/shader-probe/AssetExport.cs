using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Dto;
using CUE4Parse_Conversion.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Security.Cryptography;

// Export source values before any viewer coordinate conversion, vertex merging,
// material baking or skin-influence reduction. Outputs are local ignored assets.
internal static class AssetExport
{
    public static int Run(DefaultFileProvider provider, string requestsPath, string output, bool meshes = true)
    {
        var requests = JsonConvert.DeserializeObject<string[]>(File.ReadAllText(requestsPath))
            ?? throw new InvalidDataException("Expected asset names or package paths");
        var results = new List<object>();
        var outputNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var packages = provider.Files.Where(p => p.Key.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .DistinctBy(p => p.Key, StringComparer.OrdinalIgnoreCase).ToArray();
        var byName = packages.ToLookup(p => Path.GetFileNameWithoutExtension(p.Key), StringComparer.OrdinalIgnoreCase);
        var byPath = packages.ToDictionary(p => p.Key, p => p, StringComparer.OrdinalIgnoreCase);
        int failures = 0;
        foreach (var request in requests.Distinct())
        {
            try
            {
                var candidates = byPath.TryGetValue(request, out var exact) ? [exact] : byName[request].ToArray();
                if (candidates.Length != 1) throw new InvalidDataException($"Expected one package; found {candidates.Length}");
                var file = candidates[0];
                var name = Path.GetFileNameWithoutExtension(file.Key);
                var stem = byName[name].Count() > 1 ? name + "-" + Convert.ToHexString(
                    SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(file.Key.ToLowerInvariant())))[..12] : name;
                if (!outputNames.Add(stem)) throw new InvalidDataException($"Duplicate output request: {file.Key}");
                var exports = provider.LoadPackage(file.Key).GetExports().ToArray();
                var mesh = exports.OfType<USkeletalMesh>().SingleOrDefault();
                var staticMesh = exports.OfType<UStaticMesh>().SingleOrDefault();
                string? meshFile = null;
                if (meshes && mesh != null)
                {
                    mesh.PopulateMorphTargetVerticesData();
                    using var dto = new SkeletalMeshDto(mesh, EMeshQuality.Highest);
                    meshFile = stem + ".mesh.json";
                    WriteMesh(dto, output, meshFile, file.Key, JArray.FromObject(mesh.SkeletalMaterials));
                }
                else if (meshes && staticMesh != null)
                {
                    using var dto = new StaticMeshDto(staticMesh, EMeshQuality.Highest);
                    meshFile = stem + ".mesh.json";
                    WriteMesh(dto, output, meshFile, file.Key, JArray.FromObject(staticMesh.StaticMaterials));
                }
                // Structured properties expose what the mapping really decoded;
                // no name-token inference is mixed into these records.
                var metadata = exports.Select(o => new
                {
                    type = o.ExportType, o.Name, propertyCount = o.Properties.Count,
                    properties = Properties(o),
                    importedBounds = o is USkeletalMesh sk ? (object)sk.ImportedBounds : null,
                }).ToArray();
                var propertiesFile = stem + ".properties.json";
                File.WriteAllText(Path.Combine(output, propertiesFile), JsonConvert.SerializeObject(metadata, Formatting.Indented));
                var hash = Convert.ToHexString(SHA256.HashData(file.Value.Read()));
                results.Add(new { request, path = file.Key, sha256 = hash, meshFile, propertiesFile, exports = metadata.Select(m => new { m.type, m.Name, m.propertyCount }) });
                Console.WriteLine($"ASSET {name}: {metadata.Sum(m => m.propertyCount)} properties, mesh={meshFile != null}");
            }
            catch (Exception error)
            {
                failures++;
                results.Add(new { request, error = error.ToString() });
                Console.WriteLine($"FAILED {request}: {error.Message}");
            }
        }
        File.WriteAllText(Path.Combine(output, "assets.json"), JsonConvert.SerializeObject(results, Formatting.Indented));
        return failures == 0 ? 0 : 1;
    }

    // Serialize only tagged properties. Serializing the whole material/cloth object
    // first would unnecessarily expand its shader maps and binary mesh payloads.
    internal static JObject Properties(UObject o) => new(o.Properties.Select(p =>
        new JProperty(p.ArrayIndex > 0 ? $"{p.Name.Text}[{p.ArrayIndex}]" : p.Name.Text,
            p.Tag == null ? JValue.CreateNull() : JToken.FromObject(p.Tag))));

    private static float[] V(FVector v) => [v.X, v.Y, v.Z];
    private static float[] V4(FVector4 v) => [v.X, v.Y, v.Z, v.W];

    private static void WriteMesh<T>(MeshDto<T> dto, string output, string file, string path, JArray sourceMaterials) where T : struct, IMeshVertex
    {
        var skeleton = dto as SkeletonDto;
        var skeletal = dto as SkeletalMeshDto;
        var lods = dto.LODs.Select(lod => new
        {
            sourceLod = lod.SourceLodIndex,
            positions = lod.Vertices.Select(v => V(v.Position)),
            normals = lod.Vertices.Select(v => V4(v.Normal)),
            tangents = lod.Vertices.Select(v => V4(v.Tangent)),
            uvs = new[] { lod.Vertices.Select(v => new[] { v.Uv.U, v.Uv.V }).ToArray() }
                .Concat(lod.ExtraUvs.Select(set => set.Select(uv => new[] { uv.U, uv.V }).ToArray())),
            indices = lod.Indices,
            sections = lod.Sections.Select(s => new { s.MaterialIndex, s.FirstIndex, s.NumFaces }),
            colours = lod.VertexColors?.Select(c => new { c.Name, values = c.Colors.Select(v => new int[] { v.R, v.G, v.B, v.A }) }),
            influences = lod.Vertices.Select(v => v is SkinnedMeshVertex skinned
                ? skinned.Influences.Select(i => new { i.Bone, i.Weight }).ToArray() : []),
            morphs = (skeletal?.MorphTargets ?? []).Select(m => m.Load<UMorphTarget>()).Where(m => m?.MorphLODModels != null
                && lod.SourceLodIndex < m.MorphLODModels.Length).Select(m => new
                {
                    name = m!.Name,
                    deltas = m.MorphLODModels[lod.SourceLodIndex].Vertices.Select(d => new
                    {
                        vertex = d.SourceIdx, position = V(d.PositionDelta), normal = V(d.TangentZDelta),
                    }),
                }),
        });
        var record = new
        {
            formatVersion = 1, source = path, coordinates = "Unreal original, centimeters",
            sourceMaterials,
            materials = dto.Materials.Select(m => new { name = m.SlotName, path = m.Material?.ResolvedObject?.GetPathName() }),
            bones = skeleton?.Bones.Select(b => new { name = b.Name, parent = b.ParentIndex,
                translation = V(b.Transform.Translation), rotation = new[] { b.Transform.Rotation.X, b.Transform.Rotation.Y, b.Transform.Rotation.Z, b.Transform.Rotation.W },
                scale = V(b.Transform.Scale3D) }),
            lods,
        };
        File.WriteAllText(Path.Combine(output, file), JsonConvert.SerializeObject(record));
    }
}
