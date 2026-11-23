using CUE4Parse.FileProvider;
using Newtonsoft.Json;
using System.Security.Cryptography;

// `package-hashes` (23 Nov 2026, S12 item refresh tier 2): the sha256 of each requested package's bytes, read exactly
// as `assets` mode records them (`GameFile.Read()`), but without loading or parsing the package, so the mapping file is
// never consulted. Comparing these with an older `assets` run proves a package unchanged across a game update without a
// mapping for the new build. Companion files of the package (.uexp, .ubulk, .uptnl, .m.ubulk) are hashed too when the
// containers list them, since bulk data lives outside the package bytes.
internal static class PackageHashes
{
    static readonly string[] Companions = [".uexp", ".ubulk", ".uptnl", ".m.ubulk"];

    public static int Run(DefaultFileProvider provider, string requestsPath, string output)
    {
        var requests = JsonConvert.DeserializeObject<string[]>(File.ReadAllText(requestsPath))
            ?? throw new InvalidDataException("Expected package paths");
        var results = new List<object>();
        int failures = 0;
        foreach (var request in requests.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                if (!request.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Expected a .uasset package path");
                if (!provider.Files.TryGetValue(request, out var file)) throw new InvalidDataException("No package at this path");
                var bytes = file.Read();
                var stem = request[..^".uasset".Length];
                var companions = Companions.Where(ext => provider.Files.ContainsKey(stem + ext)).Select(ext =>
                {
                    var data = provider.Files[stem + ext].Read();
                    return new { ext, sha256 = Convert.ToHexString(SHA256.HashData(data)), bytes = data.Length };
                }).ToArray();
                results.Add(new { request, sha256 = Convert.ToHexString(SHA256.HashData(bytes)), bytes = bytes.Length, companions });
            }
            catch (Exception error)
            {
                failures++;
                results.Add(new { request, error = error.Message });
                Console.WriteLine($"FAILED {request}: {error.Message}");
            }
        }
        File.WriteAllText(Path.Combine(output, "package-hashes.json"), JsonConvert.SerializeObject(results, Formatting.Indented));
        Console.WriteLine($"Hashed {results.Count - failures} of {results.Count} packages.");
        return failures == 0 ? 0 : 1;
    }
}
