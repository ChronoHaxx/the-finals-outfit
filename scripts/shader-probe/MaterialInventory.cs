using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Readers;
using CUE4Parse.UE4.Shaders;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Security.Cryptography;

// Discover parent chains and compiled base-pass shader identities. This does not
// claim that a material is translated or visually verified merely because it parses.
internal static class MaterialInventory
{
    private static string ShaderName(FHashedName name) => HashedNamesProvider.TryGetEntry(name.Hash, out var text) && text != null ? text : name.ToString();
    private static string Canonical(string path)
    {
        var dot = path.LastIndexOf('.');
        var package = dot < 0 ? path : path[..dot];
        return package + "." + Path.GetFileName(package);
    }

    public static int Run(DefaultFileProvider provider, string requestFile, string output)
    {
        var requestJson = JToken.Parse(File.ReadAllText(requestFile));
        var requests = requestJson is JObject counts ? counts.Properties().Select(p => p.Name).ToArray()
            : requestJson.ToObject<string[]>() ?? throw new InvalidDataException("Expected material paths");
        var queue = new Queue<string>(requests.Select(Canonical));
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var records = new List<JObject>();
        var packages = provider.Files.Where(p => p.Key.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .DistinctBy(p => p.Key, StringComparer.OrdinalIgnoreCase).ToDictionary(p => p.Key, p => p.Value, StringComparer.OrdinalIgnoreCase);
        var errors = new List<object>();
        while (queue.TryDequeue(out var path))
        {
            if (!visited.Add(path)) continue;
            try
            {
                var package = path[..path.LastIndexOf('.')];
                string resolved;
                if (package.StartsWith("/Game/")) resolved = "Discovery/Content/" + package[6..] + ".uasset";
                else if (package.StartsWith("/Engine/")) resolved = "Engine/Content/" + package[8..] + ".uasset";
                else
                {
                    var suffix = package[(package.IndexOf('/', 1) + 1)..] + ".uasset";
                    resolved = packages.Keys.Single(k => k.EndsWith("/" + suffix, StringComparison.OrdinalIgnoreCase));
                }
                var asset = provider.LoadPackage(resolved).GetExports().OfType<UMaterialInterface>().Single();
                var properties = AssetExport.Properties(asset);
                var parent = (string?)properties["Parent"]?["ObjectPath"];
                if (parent != null) { parent = Canonical(parent); queue.Enqueue(parent); }
                var instance = asset as UMaterialInstance;
                var resources = new JArray();
                foreach (var resource in asset.LoadedMaterialResources)
                {
                    var map = resource.LoadedShaderMap;
                    if (map == null) continue;
                    var content = (FMaterialShaderMapContent)map.Content;
                    var shaders = new JArray();
                    foreach (var mesh in content.OrderedMeshShaderMaps)
                        foreach (var shader in mesh.Shaders.Where(s => ShaderName(s.Type).StartsWith("TBasePassPS")))
                            shaders.Add(new JObject { ["vertexFactory"] = ShaderName(mesh.VertexFactoryTypeName),
                                ["type"] = ShaderName(shader.Type), ["resourceIndex"] = shader.ResourceIndex });
                    resources.Add(new JObject { ["platform"] = map.ShaderPlatform.ToString(),
                        ["quality"] = map.ShaderMapId.QualityLevel.ToString(), ["mapHash"] = map.ResourceHash?.ToString(),
                        ["basePassShaders"] = shaders, ["compilationFlags"] = new JArray(
                            content.MaterialCompilationOutput.b1, content.MaterialCompilationOutput.b2) });
                }
                var record = new JObject { ["path"] = path, ["source"] = resolved,
                    ["sha256"] = Convert.ToHexString(SHA256.HashData(packages[resolved].Read())),
                    ["type"] = asset.ExportType, ["parent"] = parent,
                    ["declaresStaticPermutation"] = instance?.bHasStaticPermutationResource,
                    ["resources"] = resources, ["properties"] = properties };
                if (instance?.bHasStaticPermutationResource == true && resources.Count == 0)
                    record["unresolved"] = "Static permutation declared but no shader maps decoded";
                records.Add(record);
                // This run only needs the compact records above. Shader map buffers
                // can otherwise accumulate in cached UObject instances for the batch.
                asset.LoadedMaterialResources.Clear();
                if (records.Count % 100 == 0) Console.WriteLine($"MATERIALS {records.Count}, pending {queue.Count}");
            }
            catch (Exception error)
            {
                errors.Add(new { path, error = error.ToString() });
                Console.WriteLine($"MATERIAL FAILED {path}: {error.Message}");
            }
        }
        var maps = records.SelectMany(r => r["resources"]!).Where(r => r["mapHash"]?.Type == JTokenType.String)
            .GroupBy(r => (string)r["mapHash"]!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToArray(), StringComparer.OrdinalIgnoreCase);
        foreach (var archivePath in provider.Files.Keys.Where(p => p.Contains("ShaderArchive", StringComparison.OrdinalIgnoreCase))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            using var reader = new FByteArchive(archivePath, provider.Files[archivePath].Read(), provider.Versions);
            if (new FShaderCodeArchive(reader).SerializedShaders is not FIoStoreShaderCodeArchive archive) continue;
            for (int mapIndex = 0; mapIndex < archive.ShaderMapHashes.Length; mapIndex++)
            {
                if (!maps.TryGetValue(archive.ShaderMapHashes[mapIndex].ToString(), out var references)) continue;
                var entry = archive.ShaderMapEntries[mapIndex];
                foreach (var map in references) foreach (var shader in map["basePassShaders"]!)
                {
                    var index = (int)shader["resourceIndex"]!;
                    if (index < 0 || index >= entry.NumShaders) throw new InvalidDataException("Shader map resource index out of bounds");
                    var shaderIndex = archive.ShaderIndices[entry.ShaderIndicesOffset + index];
                    if (archive.ShaderEntries[shaderIndex].Frequency.ToString() != "SF_Pixel")
                        throw new InvalidDataException("Base-pass pixel shader resolved to a different shader frequency");
                    shader["outputHash"] = archive.ShaderHashes[shaderIndex].ToString();
                    shader["archive"] = archivePath;
                }
            }
        }
        File.WriteAllText(Path.Combine(output, "materials.json"), JsonConvert.SerializeObject(new
        {
            formatVersion = 1, requested = requests.Length, records, errors,
            note = "Explicit customization material references and recursive parents. Default mesh-slot materials still require mesh inventory.",
        }));
        Console.WriteLine($"MATERIAL INVENTORY {records.Count} records, {errors.Count} errors");
        return errors.Count == 0 ? 0 : 1;
    }
}
