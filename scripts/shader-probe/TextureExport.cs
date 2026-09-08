using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using Newtonsoft.Json;
using System.Security.Cryptography;
using AssetRipper.TextureDecoder.Bc;
using AssetRipper.TextureDecoder.Rgb.Formats;

// Preserve cooked mip bytes and texture metadata; decoding is a separate, local step.
internal static class TextureExport
{
    public static void Run(DefaultFileProvider provider, string requestsPath, string output)
    {
        var paths = JsonConvert.DeserializeObject<string[]>(File.ReadAllText(requestsPath))
            ?? throw new InvalidDataException("Expected texture object paths");
        var records = new List<object>();
        foreach (var path in paths.Distinct().Order())
        {
            var dot = path.LastIndexOf('.');
            if (!path.StartsWith('/') || dot < 0) throw new InvalidDataException($"Invalid object path: {path}");
            var packagePath = path[..dot];
            // Plugin mount aliases are not always registered by PostMount. Resolve the
            // full content suffix, require uniqueness, and record the actual file.
            var suffix = packagePath[(packagePath.IndexOf('/', 1) + 1)..] + ".uasset";
            var matches = provider.Files.Keys.Where(k => k.EndsWith("/" + suffix,
                StringComparison.OrdinalIgnoreCase)).ToArray();
            if (path.StartsWith("/Game/", StringComparison.Ordinal))
                matches = matches.Where(k => k.Equals("Discovery/Content/" + suffix,
                    StringComparison.OrdinalIgnoreCase)).ToArray();
            matches = matches.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (matches.Length != 1) throw new InvalidDataException($"Expected one package for {path}; found {string.Join(", ", matches)}");
            var resolvedPath = matches[0];
            var package = provider.LoadPackage(resolvedPath);
            var texture = package.GetExports().OfType<UTexture>().Single();
            if (texture is not UTexture2D && texture is not UTexture2DArray && texture is not UTextureCube)
                throw new InvalidDataException($"Unsupported texture class: {texture.GetType().Name}");
            if (texture.PlatformData.VTData != null) throw new InvalidDataException("Virtual texture needs explicit support");
            string id = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(path)))[..16].ToLowerInvariant();
            var mips = new List<object>();
            for (int level = 0; level < texture.PlatformData.Mips.Length; level++)
            {
                var mip = texture.GetMip(level) ?? throw new InvalidDataException($"Missing mip {level}: {path}");
                var data = mip.BulkData?.Data ?? throw new InvalidDataException("Missing texture bulk data");
                var file = $"{id}.{level}.bin";
                File.WriteAllBytes(Path.Combine(output, file), data);
                object? decoded = null;
                if (texture.Format.ToString() == "PF_BC6H")
                {
                    // Preserve unsigned BC6H as half-float RGBA, without an 8-bit
                    // image conversion. Keep the original blocks and both hashes.
                    int slices = texture.PlatformData.GetNumSlices();
                    int blockBytes = Math.Max(1, (mip.SizeX + 3) / 4) * Math.Max(1, (mip.SizeY + 3) / 4) * 16;
                    int imageBytes = mip.SizeX * mip.SizeY * 8;
                    if (data.Length != blockBytes * slices) throw new InvalidDataException("BC6H slice byte count mismatch");
                    var pixels = new byte[imageBytes * slices];
                    for (int slice = 0; slice < slices; slice++)
                    {
                        int consumed = Bc6h.Decompress<ColorRGBA<Half>, Half>(data.AsSpan(slice * blockBytes, blockBytes),
                            mip.SizeX, mip.SizeY, false, pixels.AsSpan(slice * imageBytes, imageBytes));
                        if (consumed != blockBytes) throw new InvalidDataException("BC6H decoder consumption mismatch");
                    }
                    var decodedFile = $"{id}.{level}.rgba16f.bin";
                    File.WriteAllBytes(Path.Combine(output, decodedFile), pixels);
                    decoded = new { file = decodedFile, format = "RGBA16F", bytes = pixels.Length,
                        sha256 = Convert.ToHexString(SHA256.HashData(pixels)), decoder = "AssetRipper.TextureDecoder/2.6.2" };
                }
                mips.Add(new { level, width = mip.SizeX, height = mip.SizeY, depth = mip.SizeZ,
                    file, bytes = data.Length, sha256 = Convert.ToHexString(SHA256.HashData(data)), decoded });
            }
            records.Add(new { path, resolvedPath, id, type = texture.GetType().Name, format = texture.Format.ToString(),
                // CUE4Parse supplies TF_Nearest when no Filter property is present.
                // This field is parser metadata, not proof of the game's sampler.
                srgb = texture.SRGB, normal = texture.IsNormalMap, parserFilter = texture.Filter.ToString(),
                wrapS = texture.GetTextureAddressX().ToString(), wrapT = texture.GetTextureAddressY().ToString(),
                slices = texture.PlatformData.GetNumSlices(), mips });
            Console.WriteLine($"TEXTURE {texture.Name}: {texture.Format}, {mips.Count} mips, {texture.PlatformData.GetNumSlices()} slices");
        }
        File.WriteAllText(Path.Combine(output, "textures.json"), JsonConvert.SerializeObject(records, Formatting.Indented));
    }
}
