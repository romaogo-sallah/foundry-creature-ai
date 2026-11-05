using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml.Linq;

// Read PE metadata and XML documentation; never load or execute the game assembly.
if (args.Length != 2)
{
    Console.Error.WriteLine("Usage: InspectDawnsbury <game folder> <output.json>");
    return 1;
}

var dll = Path.Combine(Path.GetFullPath(args[0]), "Data", "Dawnsbury Days.dll");
var xml = Path.ChangeExtension(dll, ".xml");
using var stream = File.OpenRead(dll);
using var pe = new PEReader(stream);
var reader = pe.GetMetadataReader();
var types = new List<object>();
foreach (var handle in reader.TypeDefinitions)
{
    var type = reader.GetTypeDefinition(handle);
    var ns = reader.GetString(type.Namespace);
    if (!ns.StartsWith("Dawnsbury.Core.Intelligence", StringComparison.Ordinal)) continue;
    // Compiler-generated types contain implementation details, not the reusable API.
    var name = reader.GetString(type.Name);
    if (name.StartsWith('<')) continue;
    var fields = new List<object>();
    foreach (var fieldHandle in type.GetFields())
    {
        var field = reader.GetFieldDefinition(fieldHandle);
        if ((field.Attributes & FieldAttributes.FieldAccessMask) != FieldAttributes.Public) continue;
        object? value = null;
        var constantHandle = field.GetDefaultValue();
        if (!constantHandle.IsNil)
        {
            var constant = reader.GetConstant(constantHandle);
            var blob = reader.GetBlobReader(constant.Value);
            value = constant.TypeCode switch
            {
                ConstantTypeCode.Int32 => blob.ReadInt32(),
                ConstantTypeCode.Single => blob.ReadSingle(),
                ConstantTypeCode.Double => blob.ReadDouble(),
                ConstantTypeCode.Boolean => blob.ReadBoolean(),
                ConstantTypeCode.String => blob.ReadUTF16(blob.Length),
                _ => null
            };
        }
        fields.Add(new { name = reader.GetString(field.Name), constant = value });
    }
    var methods = type.GetMethods().Select(h => reader.GetMethodDefinition(h))
        .Where(m => (m.Attributes & MethodAttributes.MemberAccessMask) == MethodAttributes.Public)
        .Select(m => new {
            name = reader.GetString(m.Name),
            parameters = m.GetParameters().Select(p => reader.GetParameter(p))
                .Where(p => p.SequenceNumber > 0)
                .Select(p => reader.GetString(p.Name)).ToArray()
        }).ToArray();
    types.Add(new { name = $"{ns}.{name}", fields, methods });
}

var documentation = XDocument.Load(xml).Descendants("member")
    .Select(m => new { id = (string?)m.Attribute("name") ?? "", text = m.Value })
    .Where(m => m.id.Contains("Dawnsbury.Core.Intelligence") ||
        m.id.Contains("Goodness") || m.id.Contains("OverriddenDetermineCenterPointByEnemy"))
    // Inventory references only. The report does not redistribute documentation prose.
    .Select(m => m.id).OrderBy(id => id).ToArray();
var report = new {
    assembly = new {
        path = dll,
        version = reader.GetAssemblyDefinition().Version.ToString(),
        sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(dll))).ToLowerInvariant()
    },
    scope = "Public metadata and XML member identifiers only. No method bodies, private fields, default weights, or per-enemy decision routines extracted.",
    types,
    documentedMembers = documentation
};
var output = Path.GetFullPath(args[1]);
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
File.WriteAllText(output, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine($"Recorded {types.Count} Intelligence types and {documentation.Length} documented member references in {output}");
return 0;
