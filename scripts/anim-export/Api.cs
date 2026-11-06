using System.Reflection;

// `api <TypeName>...`: print the public surface of CUE4Parse types, so the exporter is written against
// the exact library build it links (no source for this build is vendored).
static class Api
{
    public static int Run(string[] names)
    {
        var assemblies = AppDomain.CurrentDomain.GetAssemblies().ToList();
        foreach (var file in new[] { "CUE4Parse.dll", "CUE4Parse-Conversion.dll" })
            assemblies.Add(Assembly.LoadFrom(Path.Combine(AppContext.BaseDirectory, file)));
        var types = assemblies.SelectMany(a => { try { return a.GetTypes(); } catch (ReflectionTypeLoadException e) { return e.Types.OfType<Type>(); } }).ToList();
        // `api find:<Method>` lists the types declaring a method of that name (extension-method hosts).
        foreach (var name in names.Where(n => n.StartsWith("find:")))
            foreach (var type in types.Where(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly).Any(m => m.Name == name[5..])))
                Console.WriteLine($"{name[5..]} declared on {type.FullName}");
        // `api ns:<Namespace>` lists the public types in that namespace.
        foreach (var name in names.Where(n => n.StartsWith("ns:")))
            foreach (var type in types.Where(t => t.IsPublic && t.Namespace == name[3..]).DistinctBy(t => t.FullName).OrderBy(t => t.Name))
                Console.WriteLine($"{type.FullName} : {type.BaseType?.Name}");
        foreach (var name in names)
            foreach (var type in types.Where(t => t.Name == name || t.FullName == name).DistinctBy(t => t.FullName))
            {
                Console.WriteLine($"== {type.FullName} : {type.BaseType?.Name}");
                const BindingFlags flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
                foreach (var c in type.GetConstructors())
                    Console.WriteLine($"  new({string.Join(", ", c.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
                foreach (var f in type.GetFields(flags)) Console.WriteLine($"  field {f.FieldType.Name} {f.Name}");
                foreach (var p in type.GetProperties(flags)) Console.WriteLine($"  prop  {p.PropertyType.Name} {p.Name}");
                foreach (var m in type.GetMethods(flags).Where(m => !m.IsSpecialName))
                    Console.WriteLine($"  {(m.IsStatic ? "static " : "")}{m.ReturnType.Name} {m.Name}({string.Join(", ", m.GetParameters().Select(p => $"{(p.ParameterType.IsByRef ? "ref " : "")}{p.ParameterType.Name.TrimEnd('&')} {p.Name}"))})");
            }
        return 0;
    }
}
