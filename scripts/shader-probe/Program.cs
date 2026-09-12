using CUE4Parse;
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.MappingsProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.IO;
using CUE4Parse.UE4.Readers;
using CUE4Parse.UE4.Shaders;
using CUE4Parse.UE4.Objects.Core.Misc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;
using System.Buffers.Binary;
using System.Security.Cryptography;

bool requestedShaders = args.Length > 0 && args[0] == "shaders";
string mode = args.Length > 0 && args[0] is "shaders" or "textures" or "assets" or "properties" or "materials" or "inventory" ? args[0] : "shaders";
if (mode != "shaders" || requestedShaders) args = args[1..];
int settingsIndex = requestedShaders || mode is "textures" or "assets" or "properties" or "materials" ? 5 : 4;
if (args.Length != settingsIndex && args.Length != settingsIndex + 1)
    throw new ArgumentException("Usage: ShaderProbe [shaders|textures|assets|properties|materials|inventory] <paks> <usmap> <oodle.dll> <empty-output-directory> [requests.json except inventory] [FModel-AppSettings.json]");
var output = Path.GetFullPath(args[3]);
var input = Path.GetFullPath(args[0]).TrimEnd(Path.DirectorySeparatorChar);
if (output.Equals(input, StringComparison.OrdinalIgnoreCase) ||
    output.StartsWith(input + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    throw new ArgumentException("Output must be separate from the game containers");
if (Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
    throw new ArgumentException("Output directory must be empty; preserve each extraction run separately");
Directory.CreateDirectory(output);
Log.Logger = new LoggerConfiguration().MinimumLevel.Warning().WriteTo.Console().CreateLogger();
CUE4ParseLog.UseLogger(Log.Logger);
OodleHelper.Initialize(Path.GetFullPath(args[2]));
using var provider = new DefaultFileProvider(args[0], SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_TheFinals), StringComparer.OrdinalIgnoreCase);
provider.ReadShaderMaps = mode is not "properties" and not "inventory";
provider.SkipReferencedTextures = true;
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(Path.GetFullPath(args[1]));
Console.WriteLine($"Initializing GAME_TheFinals containers; inline shader maps={provider.ReadShaderMaps}...");
provider.Initialize();
// Use only this game's saved archive key. Do not copy or log account/auth fields.
if (args.Length > settingsIndex)
{
    var settings = JObject.Parse(File.ReadAllText(args[settingsIndex]));
    var directories = (JObject?)settings["PerDirectory"];
    var gameSettings = directories?.Properties().FirstOrDefault(p =>
        input.StartsWith(Path.GetFullPath(p.Name).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase))?.Value;
    var key = (string?)gameSettings?["AesKeys"]?["mainKey"];
    if (key is not null && System.Text.RegularExpressions.Regex.IsMatch(key, "^0x[0-9A-Fa-f]{64}$"))
        provider.SubmitKey(new FGuid(), new FAesKey(key));
}
provider.Mount();
provider.PostMount();
Console.WriteLine($"Mounted {provider.MountedVfs.Count} containers; {provider.Files.Count} files.");
File.WriteAllText(Path.Combine(output, "source-run.json"), JsonConvert.SerializeObject(new
{
    formatVersion = 1, mode, generatedAt = DateTimeOffset.UtcNow,
    mappingSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[1]))),
    parserVersion = typeof(DefaultFileProvider).Assembly.GetName().Version?.ToString(),
    sourceContainers = Directory.EnumerateFiles(input, "*.utoc").Order().Select(p => new {
        name = Path.GetFileName(p), length = new FileInfo(p).Length,
        lastWriteTimeUtc = File.GetLastWriteTimeUtc(p), sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))) }),
}, Formatting.Indented));
if (mode == "textures")
{
    TextureExport.Run(provider, args[4], output);
    return 0;
}
if (mode == "assets") return AssetExport.Run(provider, args[4], output);
if (mode == "properties") return AssetExport.Run(provider, args[4], output, meshes: false);
if (mode == "materials") return MaterialInventory.Run(provider, args[4], output);
if (mode == "inventory")
{
    var packages = provider.Files.Keys.Where(p => p.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(p => p, StringComparer.Ordinal).ToArray();
    File.WriteAllText(Path.Combine(output, "packages.json"), JsonConvert.SerializeObject(packages));
    File.WriteAllText(Path.Combine(output, "source.json"), JsonConvert.SerializeObject(new
    {
        formatVersion = 1,
        mappingSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[1]))),
        parserVersion = typeof(DefaultFileProvider).Assembly.GetName().Version?.ToString(),
        containers = provider.MountedVfs.Select(v => v.Name).Order().ToArray(),
        packageCount = packages.Length,
        note = "Mounted package inventory. Package presence does not imply decoded properties or supported rendering.",
    }, Formatting.Indented));
    Console.WriteLine($"INVENTORY {packages.Length} packages");
    return 0;
}

string[] requests = requestedShaders ? JsonConvert.DeserializeObject<string[]>(File.ReadAllText(args[4]))!
    : ["M_Character_Layered", "MI_Character_Layered_2",
    "MI_Casual_LongCoat_Leather_Black", "MI_Casual_LongCoat_Leather_Camo", "MI_Casual_LongCoat_Satin"];
if (requests.Length == 0 || requests.Distinct(StringComparer.OrdinalIgnoreCase).Count() != requests.Length ||
    requests.Any(n => !System.Text.RegularExpressions.Regex.IsMatch(n,
        "^(?:[A-Za-z0-9_]+|Discovery/Content/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\\.uasset)$")))
    throw new ArgumentException("Shader requests must contain distinct exact asset names or Discovery/Content package paths");
// Material compilation still keys local exports by basename. Exact paths resolve
// ambiguous source names, but colliding output basenames require separate runs.
string[] names = requests.Select(Path.GetFileNameWithoutExtension).ToArray()!;
if (names.Distinct(StringComparer.OrdinalIgnoreCase).Count() != names.Length)
    throw new ArgumentException("Shader output basenames collide; extract these exact paths in separate runs");
var results = new List<object>();
int exportFailures = 0;
foreach (var request in requests)
{
    var name = Path.GetFileNameWithoutExtension(request);
    var exactPath = request.Contains('/');
    var matches = provider.Files.Where(x => (exactPath ? x.Key.Equals(request, StringComparison.OrdinalIgnoreCase)
        : Path.GetFileNameWithoutExtension(x.Key).Equals(name, StringComparison.OrdinalIgnoreCase))
        && x.Key.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        .DistinctBy(x => x.Key, StringComparer.OrdinalIgnoreCase).ToArray();
    if (matches.Length > 1) throw new InvalidDataException($"Ambiguous shader asset name: {name}");
    var file = matches.FirstOrDefault();
    if (file.Value is null)
    {
        results.Add(new { name, error = "Asset not found" });
        exportFailures++;
        Console.WriteLine($"MISSING {name}");
        continue;
    }
    try
    {
        File.WriteAllBytes(Path.Combine(output, name + ".uasset"), file.Value.Read());
        var package = provider.LoadPackage(file.Key);
        var exports = package.GetExports().ToArray();
        File.WriteAllText(Path.Combine(output, name + ".json"), JsonConvert.SerializeObject(exports, Formatting.Indented));
        var materials = exports.OfType<UMaterialInterface>().ToArray();
        int resources = materials.Sum(m => m.LoadedMaterialResources.Count);
        var exportJson = JArray.Parse(File.ReadAllText(Path.Combine(output, name + ".json")));
        var parent = (string?)exportJson[0]?["Properties"]?["Parent"]?["ObjectPath"];
        results.Add(new { name, path = file.Key, exports = exports.Length, resources, parent });
        Console.WriteLine($"EXPORTED {name}: {resources} shader resources");
    }
    catch (Exception e)
    {
        results.Add(new { name, path = file.Key, error = e.ToString() });
        exportFailures++;
        Console.WriteLine($"FAILED {name}: {e.Message}");
    }
}
var shaderFiles = provider.Files.Where(x => x.Key.Contains("ShaderArchive", StringComparison.OrdinalIgnoreCase))
    .Select(x => x.Key).ToArray();
var shaderRequests = new List<(string Name, string Platform, string Hash, int ResourceIndex)>();
foreach (var name in names)
{
    var path = Path.Combine(output, name + ".json");
    if (!File.Exists(path)) continue;
    var material = JArray.Parse(File.ReadAllText(path))[0];
    foreach (var resource in material["LoadedMaterialResources"] ?? new JArray())
    {
        var map = resource["LoadedShaderMap"]!;
        if ((string?)map["ShaderMapId"]?["QualityLevel"] != "Num") continue;
        var mesh = map["Content"]?["OrderedMeshShaderMaps"]?.FirstOrDefault(m =>
            (string?)m["VertexFactoryTypeName"] == "TGPUSkinVertexFactoryDefault");
        var shader = mesh?["Shaders"]?.FirstOrDefault(s => (string?)s["Type"] == "TBasePassPSFNoLightMapPolicy");
        if (shader is null) continue;
        var platform = (string)map["ShaderPlatform"]!;
        shaderRequests.Add((name, platform, (string)map["ResourceHash"]!, (int)shader["ResourceIndex"]!));
        File.WriteAllText(Path.Combine(output, $"{name}.{platform}.uniforms.json"),
            map["Content"]!["MaterialCompilationOutput"]!["UniformExpressionSet"]!.ToString(Formatting.Indented));
    }
}
var extracted = new List<object>();
var completedShaders = new HashSet<(string, string)>();
var shaderOutput = Path.Combine(output, "shaders");
Directory.CreateDirectory(shaderOutput);
foreach (var archivePath in shaderFiles)
{
    using var archiveReader = new FByteArchive(archivePath, provider.Files[archivePath].Read(), provider.Versions);
    if (new FShaderCodeArchive(archiveReader).SerializedShaders is not FIoStoreShaderCodeArchive archive) continue;
    foreach (var request in shaderRequests)
    {
        if (completedShaders.Contains((request.Name, request.Platform))) continue;
        int mapIndex = Array.FindIndex(archive.ShaderMapHashes, h => h.ToString().Equals(request.Hash, StringComparison.OrdinalIgnoreCase));
        if (mapIndex < 0) continue;
        try
        {
            var mapEntry = archive.ShaderMapEntries[mapIndex];
            if (request.ResourceIndex >= mapEntry.NumShaders) throw new InvalidDataException("Shader resource index outside map");
            var shaderIndex = archive.ShaderIndices[mapEntry.ShaderIndicesOffset + request.ResourceIndex];
            var shaderEntry = archive.ShaderEntries[shaderIndex];
            if (shaderEntry.Frequency.ToString() != "SF_Pixel") throw new InvalidDataException("Selected shader is not a pixel shader");
            var group = archive.ShaderGroupEntries[shaderEntry.ShaderGroupIndex];
            var chunk = archive.ShaderGroupIoHashes[shaderEntry.ShaderGroupIndex];
            var reader = provider.MountedVfs.OfType<IoStoreReader>().FirstOrDefault(r => r.DoesChunkExist(chunk))
                ?? throw new InvalidDataException($"Shader group not found: {chunk}");
            var compressed = reader.Read(chunk);
            var data = compressed;
            if (group.CompressedSize != group.UncompressedSize)
            {
                if (compressed.Length != group.CompressedSize) throw new InvalidDataException("Shader group compressed size mismatch");
                data = new byte[group.UncompressedSize];
                var decoded = OodleHelper.Instance!.Decompress(compressed.AsSpan(), data.AsSpan());
                if (decoded != data.Length) throw new InvalidDataException("Shader group decompressed size mismatch");
            }
            int start = checked((int)shaderEntry.UncompressedOffsetInGroup);
            int end = checked((int)group.UncompressedSize);
            for (uint i = 0; i < group.NumShaders; i++)
            {
                var other = archive.ShaderEntries[archive.ShaderIndices[group.ShaderIndicesOffset + i]];
                if (other.UncompressedOffsetInGroup > start)
                    end = Math.Min(end, checked((int)other.UncompressedOffsetInGroup));
            }
            var raw = data.AsSpan(start, end - start);
            int magicOffset = raw.IndexOf("DXBC"u8);
            if (magicOffset < 0 || magicOffset + 32 > raw.Length) throw new InvalidDataException("No DXBC/DXIL container in shader range");
            int containerLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(raw[(magicOffset + 24)..]));
            var bytecode = raw.Slice(magicOffset, containerLength).ToArray();
            int partCount = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytecode.AsSpan(28)));
            var parts = new List<string>();
            for (int i = 0; i < partCount; i++)
            {
                int partOffset = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytecode.AsSpan(32 + 4 * i)));
                int partLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(bytecode.AsSpan(partOffset + 4)));
                if (partOffset < 32 + 4 * partCount || partLength < 0 || partOffset + 8L + partLength > bytecode.Length)
                    throw new InvalidDataException("Invalid DXBC/DXIL part bounds");
                parts.Add(System.Text.Encoding.ASCII.GetString(bytecode, partOffset, 4));
            }
            var stem = $"{request.Name}.{request.Platform}.basepass-pixel";
            var extension = parts.Contains("DXIL") ? ".dxil" : ".dxbc";
            File.WriteAllBytes(Path.Combine(shaderOutput, stem + extension), bytecode);
            File.WriteAllBytes(Path.Combine(shaderOutput, stem + ".ue-shader.bin"), raw.ToArray());
            extracted.Add(new { request.Name, request.Platform, request.Hash, request.ResourceIndex,
                archivePath, mapIndex, shaderIndex, chunk = chunk.ToString(), container = reader.Name,
                groupCompressedBytes = compressed.Length, groupBytes = data.Length, shaderBytes = raw.Length,
                magicOffset, bytecodeBytes = bytecode.Length, parts,
                sha256 = Convert.ToHexString(SHA256.HashData(bytecode)), file = stem + extension });
            completedShaders.Add((request.Name, request.Platform));
            Console.WriteLine($"SHADER {stem}: {bytecode.Length} bytes, {string.Join(",", parts)}");
        }
        catch (Exception e)
        {
            extracted.Add(new { request.Name, request.Platform, request.Hash, error = e.ToString() });
            Console.WriteLine($"SHADER FAILED {request.Name} {request.Platform}: {e.Message}");
        }
    }
}
File.WriteAllText(Path.Combine(output, "shader-extraction.json"), JsonConvert.SerializeObject(extracted, Formatting.Indented));
File.WriteAllText(Path.Combine(output, "probe-summary.json"), JsonConvert.SerializeObject(new
{
    generatedAt = DateTimeOffset.UtcNow, game = EGame.GAME_TheFinals.ToString(), sourcePaks = input,
    cue4parse = typeof(DefaultFileProvider).Assembly.GetName().Version?.ToString(),
    mappingSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[1]))),
    mountedContainers = provider.MountedVfs.Count, fileCount = provider.Files.Count, results, shaderFiles,
    requestedShaders = shaderRequests.Count, extractedShaders = completedShaders.Count,
    sourceContainers = Directory.EnumerateFiles(input, "*.utoc").Order().Select(p => new {
        name = Path.GetFileName(p), length = new FileInfo(p).Length,
        lastWriteTimeUtc = File.GetLastWriteTimeUtc(p), sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))) })
}, Formatting.Indented));
Console.WriteLine($"Found {shaderFiles.Length} shader archive paths. Summary: {output}");
return exportFailures == 0 && shaderRequests.Count > 0 && completedShaders.Count == shaderRequests.Count ? 0 : 1;
