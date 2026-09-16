using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Assets.Exports.Internationalization;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.VirtualFileSystem;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Catalog metadata snapshot. Decodes exact DataAsset/StringTable package requests into
// one JSONL record per request, keeping tagged properties, native StringTable entries,
// per-package provenance and explicit failures. Meshes and textures are out of scope.
internal static class CatalogMetadataExport
{
    private static readonly Regex AllowedPackage =
        new(@"^Discovery/Content/(?:[A-Za-z0-9_\-]+/)*(?:DA|ST)_[A-Za-z0-9_\-]+\.uasset$");

    public static int Run(DefaultFileProvider provider, string requestsPath, string output)
    {
        // Background extraction: keep the desktop responsive; packages are decoded sequentially.
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
        var started = Stopwatch.StartNew();
        var requestBytes = File.ReadAllBytes(requestsPath);
        var requests = JsonConvert.DeserializeObject<string[]>(Encoding.UTF8.GetString(requestBytes))
            ?? throw new InvalidDataException("Expected exact package paths");
        if (requests.Length == 0 || requests.Distinct(StringComparer.OrdinalIgnoreCase).Count() != requests.Length)
            throw new InvalidDataException("Catalog metadata requests must be distinct exact package paths");
        var tables = Path.Combine(output, "string-tables");
        Directory.CreateDirectory(tables);
        var statusCounts = new SortedDictionary<string, int>();
        var exportTypes = new SortedDictionary<string, int>();
        var exportFailures = 0;
        var schemas = new SortedDictionary<string, JToken>();
        var tableFiles = new List<object>();
        using (var records = new StreamWriter(Path.Combine(output, "records.jsonl"), false, new UTF8Encoding(false)))
        {
            for (int index = 0; index < requests.Length; index++)
            {
                var request = requests[index];
                var record = new JObject { ["index"] = index, ["request"] = request };
                string status;
                try
                {
                    if (!AllowedPackage.IsMatch(request))
                    {
                        status = "rejected";
                        record["error"] = "Only exact DA_/ST_ package paths are decoded in the metadata stage";
                    }
                    else if (!provider.Files.TryGetValue(request, out var file))
                    {
                        status = "missing";
                        record["error"] = "Package not mounted";
                    }
                    else
                    {
                        var bytes = file.Read();
                        record["package"] = new JObject
                        {
                            ["path"] = file.Path, ["size"] = bytes.LongLength,
                            ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)),
                            ["container"] = (file as VfsEntry)?.Vfs.Name,
                        };
                        var package = provider.LoadPackage(file);
                        var exports = new JArray();
                        var failed = 0;
                        var lazy = package.ExportsLazy;
                        for (int e = 0; e < lazy.Length; e++)
                        {
                            try
                            {
                                var o = lazy[e].Value;
                                exports.Add(Export(o, request, bytes, tables, tableFiles));
                                exportTypes[o.ExportType] = exportTypes.GetValueOrDefault(o.ExportType) + 1;
                                if (!schemas.ContainsKey(o.ExportType)) schemas[o.ExportType] = Schema(provider, o.ExportType);
                            }
                            catch (Exception error)
                            {
                                failed++;
                                exports.Add(new JObject { ["exportIndex"] = e, ["error"] = error.ToString() });
                            }
                        }
                        record["exports"] = exports;
                        exportFailures += failed;
                        status = failed == 0 ? "ok" : "partial";
                    }
                }
                catch (Exception error)
                {
                    status = "failed";
                    record["error"] = error.ToString();
                }
                record["status"] = status;
                statusCounts[status] = statusCounts.GetValueOrDefault(status) + 1;
                records.WriteLine(record.ToString(Formatting.None));
                if ((index + 1) % 500 == 0 || index + 1 == requests.Length)
                {
                    records.Flush();
                    Console.WriteLine($"CATALOG-METADATA {index + 1}/{requests.Length} {string.Join(", ", statusCounts.Select(s => $"{s.Key}={s.Value}"))} {started.Elapsed.TotalSeconds:F0}s");
                }
            }
        }
        var ok = statusCounts.GetValueOrDefault("ok");
        File.WriteAllText(Path.Combine(output, "summary.json"), JsonConvert.SerializeObject(new
        {
            formatVersion = 1, mode = "catalog-metadata", generatedAt = DateTimeOffset.UtcNow,
            requestsFile = Path.GetFileName(requestsPath),
            requestsSha256 = Convert.ToHexString(SHA256.HashData(requestBytes)),
            requested = requests.Length, statusCounts, exportFailures, exportTypes,
            stringTables = tableFiles, elapsedSeconds = Math.Round(started.Elapsed.TotalSeconds, 1),
            classSchemas = schemas,
            notes = new[]
            {
                "Properties are tagged/unversioned values decoded with the recorded mapping. A mapped property absent from an export was not serialized and keeps its class default, which this stage does not decode.",
                "StringTable entries come from the native UStringTable serializer, not tagged properties.",
                "Package presence, tags and UserFacing availability do not establish release or store availability.",
            },
        }, Formatting.Indented));
        File.Copy(requestsPath, Path.Combine(output, "requests.json"));
        Console.WriteLine($"CATALOG-METADATA done: {JsonConvert.SerializeObject(statusCounts)} exportFailures={exportFailures}");
        return ok == requests.Length && exportFailures == 0 ? 0 : 1;
    }

    private static JObject Export(UObject o, string request, byte[] packageBytes, string tables, List<object> tableFiles)
    {
        if (o is UTexture or USkeletalMesh or UStaticMesh)
            return new JObject { ["type"] = o.ExportType, ["name"] = o.Name, ["skipped"] = "Mesh/texture exports are outside the metadata stage" };
        var export = new JObject
        {
            ["type"] = o.ExportType, ["name"] = o.Name, ["outer"] = o.Outer?.Name.Text,
            ["class"] = o.Class?.GetPathName(), ["flags"] = o.Flags.ToString(),
            ["parserType"] = o.GetType().FullName, ["propertyCount"] = o.Properties.Count,
            ["properties"] = AssetExport.Properties(o),
        };
        if (o is UStringTable table)
        {
            // Native payload: namespace, key->source string and per-key metadata.
            var native = JObject.FromObject(table.StringTable);
            var entries = native["KeysToEntries"] as JObject ?? throw new InvalidDataException("StringTable has no KeysToEntries");
            var file = $"{o.Name}.json";
            if (File.Exists(Path.Combine(tables, file)))
                file = $"{o.Name}-{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.ToLowerInvariant())))[..12]}.json";
            File.WriteAllText(Path.Combine(tables, file), JsonConvert.SerializeObject(new
            {
                formatVersion = 1, package = request, export = o.Name,
                packageSha256 = Convert.ToHexString(SHA256.HashData(packageBytes)),
                tableNamespace = (string?)native["TableNamespace"], entryCount = entries.Count,
                entries, keysToMetaData = native["KeysToMetaData"],
            }, Formatting.Indented));
            export["stringTable"] = new JObject
            {
                ["tableNamespace"] = native["TableNamespace"], ["entryCount"] = entries.Count, ["file"] = "string-tables/" + file,
            };
            tableFiles.Add(new { package = request, export = o.Name, entryCount = entries.Count, file = "string-tables/" + file });
        }
        else if (o is UDataTable dataTable)
        {
            export["rows"] = new JObject(dataTable.RowMap.Select(row =>
                new JProperty(row.Key.Text, new JObject(row.Value.Properties.Select(p =>
                    new JProperty(p.Name.Text, p.Tag == null ? JValue.CreateNull() : JToken.FromObject(p.Tag)))))));
        }
        return export;
    }

    // Mapped property names per class (own + supers). Classes absent from the mapping are
    // usually blueprint-generated; their layout is recorded as unknown rather than guessed.
    private static JToken Schema(DefaultFileProvider provider, string type)
    {
        var types = provider.MappingsForGame?.Types;
        if (types is null || !types.ContainsKey(type)) return new JObject { ["inMapping"] = false };
        var chain = new JArray();
        for (var name = type; name is not null && types.TryGetValue(name, out var s); name = s.SuperType)
        {
            chain.Add(new JObject
            {
                ["name"] = s.Name,
                ["properties"] = new JArray(s.Properties.Values.OrderBy(p => p.Index).Select(p =>
                    new JObject { ["name"] = p.Name, ["type"] = p.MappingType.Type, ["arraySize"] = p.ArraySize })),
            });
            if (chain.Count > 32) break;
        }
        return new JObject { ["inMapping"] = true, ["chain"] = chain };
    }
}
