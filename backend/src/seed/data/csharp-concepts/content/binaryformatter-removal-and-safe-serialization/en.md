---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`BinaryFormatter` was the .NET default for "save this object graph to bytes" for
two decades, and it is the textbook case of unsafe deserialization: the payload
says which types to create. Starting with .NET 9 the runtime no longer ships a
working implementation. This concept explains what that means in code (what
throws, what the compiler says), why the format is unsafe by design and not by bug,
what to move to, and how to read old payloads once, safely, with `NrbfDecoder`
instead of reviving the formatter. It also shows the mechanism behind the problem
with a harmless class so you can recognize it in other serializers.

## Use Cases

- Upgrading an app to .NET 9 or later that used `BinaryFormatter` for files, caches or the clipboard.
- Reading a user's old save files or cached state once and rewriting them in a new format.
- Reviewing a pull request that adds a serializer to a trust boundary (a queue, a file upload, a cookie).
- Choosing a replacement format for internal messages.

## Deep Dive

### What the runtime does now

The migration guide states it plainly: starting with .NET 9 the runtime no longer
includes an implementation of `BinaryFormatter`. The APIs are still present, but
they always throw `PlatformNotSupportedException`, regardless of project type, and
the old backwards-compatibility flag no longer helps. I confirmed it in .NET 10.0.0
(SDK 10.0.100):

```csharp
var bf = new BinaryFormatter();
bf.Serialize(ms, new Person { Name = "Ana", Age = 3 });
// PlatformNotSupportedException: BinaryFormatter serialization and deserialization
// have been removed. See https://aka.ms/binaryformatter for more information.
```

`Deserialize` threw the same exception. Before it even runs, the compiler stops you:
the same file failed to build with `error SYSLIB0011: 'BinaryFormatter' is
obsolete`, an error and not a warning in this SDK. The guide's escape hatch is the
unsupported `System.Runtime.Serialization.Formatters` NuGet package, which the
guide says contains "the functioning implementation of BinaryFormatter, including its
vulnerabilities and risks". With version 10.0.0 of that package and
`<EnableUnsafeBinaryFormatterSerialization>true</...>` (and `NoWarn` for
`SYSLIB0011`), a `[Serializable]` class round-tripped: 159 bytes written for a
person with a name, an age and two tags, read back intact. Treat that as a
stop-gap to unblock an upgrade, not a design: the docs label it unsupported and
recommend migrating.

### Why the format is the problem

The security guide calls `BinaryFormatter` dangerous, says it "can't be made
secure", and that applications should stop using it "even if they believe the data
they're processing to be trustworthy". The weakness class is CWE-502, deserialization
of untrusted data: any deserializer that lets the input say which objects to create
is a problem waiting to happen. Look at what is inside the 159 bytes of my payload,
printed as text (abridged):

```
...Version=1.0.0.0, Culture=neutral, PublicKeyToken=null......Person.....Name.Age.Tags....Ana....a......b.
```

The payload carries the type name and member names. On deserialize, the formatter
loads that type and fills its members. The docs say two things that stop people
from "fixing" it with configuration: the denial-of-service attack surface "cannot be
mitigated with a `SerializationBinder` or any other `BinaryFormatter` configuration
switch" (they call it by design), and for other attack categories a binder "might be
insufficient". The same page says `SoapFormatter`, `LosFormatter`,
`NetDataContractSerializer` and `ObjectStateFormatter` do unrestricted polymorphic
deserialization and are dangerous too. "Trusted input" is also a trap the guide
spends a section on: a desktop client talking to your server, a save file mailed
between users, or a cloud-synced file are all trust boundaries.

### The mechanism, with a harmless class

You can see "the payload picks the type" without any exploit. A class whose property
setter just prints a line stands in for what an attacker would use. Feeding
Newtonsoft.Json 13.0.4 an `object` target with `TypeNameHandling.Auto` and a
`$type` naming that class:

```csharp
class Gadget { public string Cmd { set => Console.WriteLine($"setter ran with '{value}'"); get => ""; } }
JsonConvert.DeserializeObject<object>(
    """{"$type":"Gadget, MyAssembly","Cmd":"hello"}""",
    new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Auto });
// setter ran with 'hello'   (the JSON chose the type, and its code ran)
```

That is the same shape as the problem, in a library you may still have. The
contrast is System.Text.Json with a closed hierarchy: with `[JsonDerivedType]`
listing `circle`, `{"$type":"circle","R":2}` produced a `Circle`, while
`{"$type":"gadget",...}` threw `JsonException: Read unrecognized type discriminator
id 'gadget'`. Targeting plain `object` gave a `JsonElement` and instantiated nothing.
The rule for any format: the set of creatable types must be fixed by your code, never
by the payload.

### Choosing the replacement

The guide recommends four serializers: System.Text.Json (JSON), `DataContractSerializer`
(XML), MessagePack (binary) and protobuf-net (binary) (I ran only protobuf-net), and notes that switching is
usually doable only when you control both producer and consumer. Pick by what the data
is for:

- Interchange, config, logs, APIs: JSON. The same 3-field object was 39 bytes of UTF-8
  JSON, human-readable, schema-less and tolerant of reordering.
- Compact internal messages: a contract-based binary format. With protobuf-net 3.2.52
  and `[ProtoContract]`/`[ProtoMember(n)]` on the type, the object was 13 bytes,
  read back identically, ignored an extra unknown field, and a truncated buffer
  failed with `EndOfStreamException`. The field numbers are the contract, so they
  must never be reused.
- Do not reach for a serializer that writes type names into the data unless you
  control the allowed set.

Remember that fields and properties differ: my first attempt to copy an old
`[Serializable]` class with public fields into JSON produced `{}`, because
System.Text.Json ignores fields by default. Map into a DTO with properties or a
record.

### Reading old payloads once with NrbfDecoder

Persisted data is the hard part, since reading it used to require the formatter.
The migration guide's answer is `NrbfDecoder` (introduced with .NET 9, in the
`System.Formats.Nrbf` NuGet package, which also targets older frameworks). It decodes
the .NET Remoting binary format (NRBF) into records without deserializing: per the
docs it loads no types, does no recursion, and instantiates only primitives and
arrays. It is useful only for a closed set of types you know ahead of time, because
you build the instances yourself. With package 10.0.0:

```csharp
if (NrbfDecoder.StartsWithPayloadHeader(stream))               // true for my file
{
    ClassRecord rec = NrbfDecoder.DecodeClassRecord(stream);
    if (!rec.TypeNameMatches(typeof(Person))) throw new InvalidDataException();
    var tags = (SZArrayRecord<string>)rec.GetArrayRecord("Tags");
    if (tags.Length > 100) throw new InvalidDataException();   // docs: check sizes first
    var dto = new PersonDto(rec.GetString("Name")!, rec.GetInt32("Age"), tags.GetArray()!);
    // {"Name":"Ana","Age":3,"Tags":["a","b"]}  -> write it back in the new format
}
```

`TypeNameMatches(typeof(Other))` returned `false`, `MemberNames` listed `Name, Age,
Tags`, a truncated payload threw `EndOfStreamException`, and a JSON buffer was not
recognized by `StartsWithPayloadHeader`. The docs' pattern for migration is exactly
this: detect the header, decode, write in the new serializer, and overwrite the old
data. They also warn that `NrbfDecoder` is not a reader for deciding whether a
`BinaryFormatter` call would be safe, and that array lengths should be checked before
`GetArray` because the format lets an attacker compress huge null arrays.

## Trade-offs

- **The compatibility package restores the vulnerability along with the feature.** It
  is unsupported and exists to buy time.
  ```xml
  <EnableUnsafeBinaryFormatterSerialization>true</EnableUnsafeBinaryFormatterSerialization>
  ```
- **JSON is safe by construction and bigger.** 39 bytes against 13 for protobuf here,
  and no compile-time schema, in exchange for readability and tolerance.
- **Contract-based binary formats need discipline.** Reusing a field number or changing
  its type corrupts old data silently.
- **`NrbfDecoder` is a migration tool, not a runtime format.** It needs a closed set of
  types and hand-written mapping, which is the point: nothing is created implicitly.
- **Type names in payloads are the risk, in any serializer.** A `$type` property with an
  open set is the same flaw as `BinaryFormatter`, with different syntax.
- **"Trusted" is a claim about a boundary, not a property of data.** Files travel and
  clients get compromised.

## Documentation Links

- [BinaryFormatter migration guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/) (doc)
- [Deserialization risks in use of BinaryFormatter and related types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide) (doc)
- [Read BinaryFormatter (NRBF) payloads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/read-nrbf-payloads) (doc)
- [Using the BinaryFormatter compatibility package, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/compatibility-package) (doc)
- [CWE-502: Deserialization of Untrusted Data, MITRE](https://cwe.mitre.org/data/definitions/502.html) (doc)
