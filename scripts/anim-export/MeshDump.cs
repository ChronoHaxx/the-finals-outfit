using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Meshes;
using CUE4Parse_Conversion.Dto;
using CUE4Parse_Conversion.Options;
using Newtonsoft.Json;

// `mesh` mode (showcase animation, props phase, 6 Nov 2026): the highest LOD of each static or skeletal mesh as raw
// UE data, for scripts/anim-export/build-props.mjs to turn into GLB. Nothing is converted here: positions stay in
// centimetres in UE's left-handed Z-up frame, so the one place that owns the UE -> three axis change is the node
// side, next to the clip converter that already applies the same per-bone mirror.
//
// Per mesh: <path>.mesh.json (header: sections, material slots with resolved material paths, the binary layout,
// and for a skeletal mesh its reference skeleton) and <path>.mesh.bin (little-endian arrays, in header order).
static class MeshDump
{
    static double R(float v) => Math.Round(v, 6);
    static double[] T(FVector v) => [R(v.X), R(v.Y), R(v.Z)];
    static double[] Q(FQuat q) => [R(q.X), R(q.Y), R(q.Z), R(q.W)];

    // The mesh's own slot list (section MaterialIndex indexes it); the DTO's copy came back empty in this build.
    static object Slot(string? slot, CUE4Parse.UE4.Objects.UObject.FPackageIndex? index)
    {
        string? path = null, error = null;
        try { path = index is { IsNull: false } ? index.Load()?.GetPathName() : null; }
        catch (Exception e) { error = e.Message.Split('\n')[0]; }
        return new { slot, material = path, error };
    }

    public static void Write(IFileProvider provider, string packagePath, string target)
    {
        var exports = provider.LoadPackage(packagePath).GetExports().ToList();
        var header = new Dictionary<string, object?>();
        var arrays = new List<(string name, string type, int components, byte[] data)>();
        void Add<T>(string name, string type, int components, T[] values) where T : unmanaged =>
            arrays.Add((name, type, components, System.Runtime.InteropServices.MemoryMarshal.AsBytes(values.AsSpan()).ToArray()));

        IMeshVertex[] vertices;
        uint[] indices;
        MeshSectionDto[] sections;
        object[] materials;
        FMeshUVFloat[][] extraUvs;
        MeshVertexColorDto[] colors;
        bool twoSided;
        if (exports.OfType<UStaticMesh>().FirstOrDefault() is { } staticMesh)
        {
            using var dto = new StaticMeshDto(staticMesh, EMeshQuality.Highest, ENaniteMeshFormat.NoNanite, null!);
            var lod = dto.LODs[0];
            vertices = lod.Vertices.Select(v => (IMeshVertex)v).ToArray();
            (indices, sections, extraUvs, colors, twoSided) = (lod.Indices, lod.Sections, lod.ExtraUvs, lod.VertexColors, lod.IsTwoSided);
            materials = (staticMesh.StaticMaterials ?? []).Select(m => Slot(m.MaterialSlotName.Text, m.MaterialInterface)).ToArray();
            header["kind"] = "static";
        }
        else if (exports.OfType<USkeletalMesh>().FirstOrDefault() is { } skeletalMesh)
        {
            using var dto = new SkeletalMeshDto(skeletalMesh, EMeshQuality.Highest, ENaniteMeshFormat.NoNanite, false);
            var lod = dto.LODs[0];
            var skinned = lod.Vertices.ToArray();
            vertices = skinned.Select(v => (IMeshVertex)v).ToArray();
            (indices, sections, extraUvs, colors, twoSided) = (lod.Indices, lod.Sections, lod.ExtraUvs, lod.VertexColors, lod.IsTwoSided);
            materials = (skeletalMesh.SkeletalMaterials ?? []).Select(m => Slot(m.MaterialSlotName.Text, m.Material)).ToArray();
            header["kind"] = "skeletal";
            var skel = skeletalMesh.ReferenceSkeleton;
            header["bones"] = skel.FinalRefBoneInfo.Select((b, i) => new
            {
                name = b.Name.Text, parent = b.ParentIndex,
                t = T(skel.FinalRefBonePose[i].Translation), r = Q(skel.FinalRefBonePose[i].Rotation), s = T(skel.FinalRefBonePose[i].Scale3D),
            }).ToArray();
            header["skeleton"] = skeletalMesh.Skeleton?.ResolvedObject?.GetFullName(true, false);
            // Four strongest influences per vertex, renormalised (three skins with four).
            var joints = new ushort[skinned.Length * 4];
            var weights = new float[skinned.Length * 4];
            int over = 0;
            for (int v = 0; v < skinned.Length; v++)
            {
                var top = (skinned[v].Influences ?? []).Where(i => i.Weight > 0).OrderByDescending(i => i.Weight).ToArray();
                if (top.Length > 4) over++;
                top = top.Take(4).ToArray();
                float sum = top.Sum(i => i.Weight);
                for (int k = 0; k < top.Length; k++) { joints[v * 4 + k] = top[k].Bone; weights[v * 4 + k] = sum > 0 ? top[k].Weight / sum : 0; }
            }
            header["verticesOverFourInfluences"] = over;
            Add("joints", "u16", 4, joints);
            Add("weights", "f32", 4, weights);
        }
        else throw new InvalidDataException("no StaticMesh or SkeletalMesh export");

        Add("position", "f32", 3, vertices.SelectMany(v => new[] { v.Position.X, v.Position.Y, v.Position.Z }).ToArray());
        Add("normal", "f32", 3, vertices.SelectMany(v => new[] { v.Normal.X, v.Normal.Y, v.Normal.Z }).ToArray());
        Add("tangent", "f32", 4, vertices.SelectMany(v => new[] { v.Tangent.X, v.Tangent.Y, v.Tangent.Z, v.Tangent.W }).ToArray());
        Add("uv0", "f32", 2, vertices.SelectMany(v => new[] { v.Uv.U, v.Uv.V }).ToArray());
        for (int c = 0; c < (extraUvs?.Length ?? 0); c++)
            if (extraUvs![c] is { Length: > 0 } uv && uv.Length == vertices.Length)
                Add($"uv{c + 1}", "f32", 2, uv.SelectMany(u => new[] { u.U, u.V }).ToArray());
        foreach (var color in colors ?? [])
            if (color.Colors is { Length: > 0 } cs && cs.Length == vertices.Length)
                Add($"color:{color.Name}", "u8", 4, cs.SelectMany(c => new[] { c.R, c.G, c.B, c.A }).ToArray());
        Add("index", "u32", 1, indices);

        header["path"] = packagePath;
        header["vertexCount"] = vertices.Length;
        header["twoSided"] = twoSided;
        header["materials"] = materials;
        header["sections"] = sections.Select(s => new { material = s.MaterialIndex, firstIndex = s.FirstIndex, faces = s.NumFaces }).ToArray();
        int offset = 0;
        header["arrays"] = arrays.Select(a => { var entry = new { a.name, a.type, a.components, offset, bytes = a.data.Length }; offset += a.data.Length; return entry; }).ToArray();
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.WriteAllText(target + ".mesh.json", JsonConvert.SerializeObject(header, Formatting.Indented));
        using var bin = File.Create(target + ".mesh.bin");
        foreach (var a in arrays) bin.Write(a.data);
    }
}
