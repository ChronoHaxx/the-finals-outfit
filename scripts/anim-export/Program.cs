using CUE4Parse;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;
using System.Security.Cryptography;

// Offline, read-only animation export for the showcase prototype (5 Nov 2026). Mounts the installed game's
// containers exactly like scripts/shader-probe (same mapping and key handling), never writes near them,
// and never touches the running game.
if (args.Length > 0 && args[0] == "api") return Api.Run(args[1..]);
if (args.Length is < 6 or > 7 || args[0] is not ("export" or "list" or "json" or "texture" or "mesh"))
{
    Console.Error.WriteLine("Usage: AnimExport export <paks> <usmap> <oodle.dll> <empty-output-directory> <requests.json> [FModel-AppSettings.json]");
    Console.Error.WriteLine("       AnimExport list <paks> <usmap> <oodle.dll> <regex> <FModel-AppSettings.json>  (prints matching package paths)");
    Console.Error.WriteLine("       AnimExport json <paks> <usmap> <oodle.dll> <empty-output-directory> <@paths.txt|regex> <FModel-AppSettings.json>");
    Console.Error.WriteLine("            (each package's exports as property JSON, like FModel's Save Properties, at most 2000 packages)");
    Console.Error.WriteLine("       AnimExport mesh <paks> <usmap> <oodle.dll> <empty-output-directory> <@paths.txt|regex> <FModel-AppSettings.json>");
    Console.Error.WriteLine("            (highest LOD of each static/skeletal mesh as raw UE data: .mesh.json + .mesh.bin)");
    Console.Error.WriteLine("       AnimExport texture <paks> <usmap> <oodle.dll> <empty-output-directory> <@paths.txt|regex> <FModel-AppSettings.json>");
    Console.Error.WriteLine("            (each package's first Texture2D decoded to PNG, at most 2000 packages)");
    Console.Error.WriteLine("       AnimExport api <Type|find:Method>...");
    return 2;
}
bool listOnly = args[0] == "list", jsonOnly = args[0] == "json", textureOnly = args[0] == "texture", meshOnly = args[0] == "mesh";
args = args[1..];
if (listOnly) args = [args[0], args[1], args[2], Path.Combine(Path.GetTempPath(), "anim-export-list-" + Guid.NewGuid().ToString("N")), args[3], args[4]];
var input = Path.GetFullPath(args[0]).TrimEnd(Path.DirectorySeparatorChar);
var output = Path.GetFullPath(args[3]);
if (output.StartsWith(input + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || output.Equals(input, StringComparison.OrdinalIgnoreCase))
    throw new ArgumentException("Output must be separate from the game containers");
if (Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
    throw new ArgumentException("Output directory must be empty; keep each export run separately");
Directory.CreateDirectory(output);
Log.Logger = new LoggerConfiguration().MinimumLevel.Warning().WriteTo.Console().CreateLogger();
CUE4ParseLog.UseLogger(Log.Logger);
OodleHelper.Initialize(Path.GetFullPath(args[2]));
// BC7 textures (most UI icons) decode through Detex, which FModel keeps next to its Oodle DLL.
var detex = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[2]))!, "Detex.dll");
if (textureOnly && File.Exists(detex)) CUE4Parse_Conversion.Textures.BC.DetexHelper.Initialize(detex);
using var provider = new DefaultFileProvider(args[0], SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_TheFinals), StringComparer.OrdinalIgnoreCase);
provider.ReadShaderMaps = false;
provider.SkipReferencedTextures = true;
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(Path.GetFullPath(args[1]));
provider.Initialize();
if (args.Length == 6)
{
    // Only the archive key for this game directory is used; it is never printed or copied into outputs.
    var settings = JObject.Parse(File.ReadAllText(args[5]));
    var gameSettings = ((JObject?)settings["PerDirectory"])?.Properties().FirstOrDefault(p =>
        input.StartsWith(Path.GetFullPath(p.Name).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase))?.Value;
    var key = (string?)gameSettings?["AesKeys"]?["mainKey"];
    if (key is not null && System.Text.RegularExpressions.Regex.IsMatch(key, "^0x[0-9A-Fa-f]{64}$"))
        provider.SubmitKey(new FGuid(), new FAesKey(key));
}
provider.Mount();
provider.PostMount();
Console.WriteLine($"Mounted {provider.MountedVfs.Count} containers; {provider.Files.Count} files.");
if (listOnly)
{
    var pattern = new System.Text.RegularExpressions.Regex(args[4], System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    foreach (var key in provider.Files.Keys.Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase) && pattern.IsMatch(k)).Order())
        Console.WriteLine(key);
    Directory.Delete(output); // the empty placeholder directory created above; nothing was written into it
    return 0;
}
if (jsonOnly || textureOnly || meshOnly)
{
    var selector = args[4];
    IEnumerable<string> paths = selector.StartsWith('@')
        ? File.ReadAllLines(selector[1..]).Select(l => l.Trim()).Where(l => l.Length > 0)
        : provider.Files.Keys.Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
            && System.Text.RegularExpressions.Regex.IsMatch(k, selector, System.Text.RegularExpressions.RegexOptions.IgnoreCase)).Order();
    int written = 0, failed = 0;
    foreach (var path in paths.Take(2000))
    {
        var target = Path.Combine(output, Path.ChangeExtension(path, textureOnly ? ".png" : meshOnly ? null : ".json").Replace('/', Path.DirectorySeparatorChar));
        try
        {
            var package = provider.LoadPackage(path);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            if (meshOnly) MeshDump.Write(provider, path, target);
            else if (textureOnly)
            {
                // UI icons: the full-size top mip, decoded on the CPU (BC7/BC3 -> RGBA) and written losslessly. Resizing
                // and web encoding happen in node (sharp), where the app's other icon thumbnails are made.
                var texture = package.GetExports().OfType<CUE4Parse.UE4.Assets.Exports.Texture.UTexture2D>().First();
                var bitmap = CUE4Parse_Conversion.Textures.TextureDecoder.Decode(texture, CUE4Parse.UE4.Assets.Exports.Texture.ETexturePlatform.DesktopMobile)
                    ?? throw new InvalidDataException("texture did not decode");
                var ext = "png";
                File.WriteAllBytes(target, CUE4Parse_Conversion.Textures.TextureEncoder.Encode(bitmap, CUE4Parse_Conversion.Options.ETextureFormat.Png, false, out ext, 100));
            }
            else File.WriteAllText(target, JsonConvert.SerializeObject(package.GetExports(), Formatting.Indented));
            written++;
        }
        catch (Exception e)
        {
            failed++;
            Console.Error.WriteLine($"{path}: {e.GetType().Name}: {e.Message.Split('\n')[0]}");
        }
    }
    Console.WriteLine($"Wrote {written} {(textureOnly ? "PNG" : meshOnly ? "mesh" : "package JSON")} files ({failed} failed) to {output}");
    return 0;
}
File.WriteAllText(Path.Combine(output, "source-run.json"), JsonConvert.SerializeObject(new
{
    formatVersion = 1, tool = "scripts/anim-export", generatedAt = DateTimeOffset.UtcNow,
    mappingSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[1]))),
    parserVersion = typeof(DefaultFileProvider).Assembly.GetName().Version?.ToString(),
    // Size + timestamp identify the installed build cheaply; full container hashes are not needed for animation.
    sourceContainers = Directory.EnumerateFiles(input, "*.utoc").Order().Select(p => new {
        name = Path.GetFileName(p), length = new FileInfo(p).Length, lastWriteTimeUtc = File.GetLastWriteTimeUtc(p) }),
}, Formatting.Indented));
return Export.Run(provider, args[4], output);
