---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

XML is still what you meet in SOAP services, Office formats, configuration files,
feeds and plenty of legacy integrations. .NET gives you two ways in: serializers
that map objects to XML (`XmlSerializer`, `DataContractSerializer`) and LINQ to XML
(`XDocument`, `XElement`), a query-and-edit API for XML you do not want to map. This
concept covers what each serializer includes and silently skips, the namespace and
encoding surprises, how to query and modify with LINQ to XML (including a loop that
quietly skips elements), when to stream with `XmlReader`, and the parser settings that
decide whether a hostile document can read a local file or exhaust memory.

## Use Cases

- Reading or producing an XML contract (a feed, an invoice format, a SOAP-era endpoint).
- Pulling a few values out of a large XML file without writing classes for it.
- Editing a configuration file while keeping everything you did not touch.
- Accepting an XML upload from outside your trust boundary.

## Deep Dive

### XmlSerializer: public shape, attributes, defaults

`XmlSerializer` maps public read/write properties and public fields to elements. All
output below is from .NET 10.0.0 (SDK 10.0.100). With `[XmlRoot]`, `[XmlAttribute]`,
`[XmlElement]`, `[XmlIgnore]` and `[XmlArray]`/`[XmlArrayItem]` on an `Order`:

```xml
<?xml version="1.0" encoding="utf-16"?>
<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" id="7">
  <customer>Ana &amp; Co</customer>
  <Created>2024-01-02T03:04:05Z</Created>
  <Status>Shipped</Status>
  <lines><line sku="A"><Qty>2</Qty></line><line sku="B"><Qty>1</Qty></line></lines>
</order>
```

(Indentation shortened.) Things that are easy to miss:

- Two namespace declarations (`xsi`, `xsd`) are added by default. Passing an
  `XmlSerializerNamespaces` containing `("", "")` removes them. Writing with an
  `XmlWriter` and `OmitXmlDeclaration = true` gave `<order id="7"><customer>...</order>`.
- `encoding="utf-16"` appears because I serialized into a `StringWriter`, whose
  encoding is UTF-16. The declaration follows the writer, not your intention;
  `XDocument.Save(StringWriter)` did the same. Write to a stream with
  `XmlWriterSettings.Encoding` when the file must be UTF-8.
- A `null` string (`Note`) was simply omitted, the `[XmlIgnore]` property was omitted
  and came back as `''`, and an enum was written by name (`Shipped`).
- Only public members: for a class with a public property, an internal one, a private
  one and a public field, the output held `Field` and `Pub` only.
- A type with no parameterless constructor fails when you construct the serializer:
  `InvalidOperationException: NoCtor cannot be serialized because it does not have a
  parameterless constructor.` That is the fast failure; it is not deferred to the
  first `Serialize`.
- Polymorphism needs declaring: a `List<Animal>` with `Cat` and `Dog` items worked
  once I listed `[XmlElement("Cat", typeof(Cat)), XmlElement("Dog", typeof(Dog))]`.

Reading is lenient and loud in different places. For `<Line sku='Z' extra='1'>` with
an unknown `<Bogus>` element, deserialization succeeded and silently dropped both; the
`UnknownElement` event (and `UnknownAttribute`) is the hook if you want to know. A bad
value, `<Qty>abc</Qty>`, threw `InvalidOperationException: There is an error in XML
document (1, 31)` with a `FormatException` inside, and a wrong root element gave
`<Other xmlns=''> was not expected`. Always read the inner exception and the line and
position.

### DataContractSerializer: opt-in members

`DataContractSerializer` is the WCF-era alternative with the opposite default: only
members marked `[DataMember]` are written, and a property without the attribute is
skipped. For `[DataContract] class Dc { [DataMember] A; [DataMember(Order = 2)] B;
int NotMember }` the output was
`<Dc xmlns="http://schemas.datacontract.org/2004/07/" xmlns:i="..."><A>1</A><B>x</B></Dc>`.
Note the namespace derived from the CLR namespace. The security guide warns about a different class, `NetDataContractSerializer`, which does
unrestricted polymorphic deserialization: do not confuse the two.

### LINQ to XML: query without classes

`XDocument` and `XElement` are an in-memory tree. The docs describe it as the option
to use for new code. The one concept to learn is namespaces: a name is `XNamespace +
local name`, and a query without the namespace finds nothing.

```csharp
XNamespace s = "urn:shop";
var q = doc.Root!.Elements(s + "order").Select(o => new {
    Id = (int)o.Attribute("id")!,
    Customer = (string)o.Element(s + "customer")!,
    Total = o.Elements(s + "line").Sum(x => (int)x.Attribute("qty")! * (decimal)x.Attribute("price")!) });
// order 1 Ana total 22.0     order 2 Bo total 47.5
```

On the same document `doc.Root.Elements("order")` counted 0 because the elements are
in `urn:shop`. The explicit casts are the reading API: `(string?)` on a missing
element is `null`, but `(int)` on a missing attribute threw `ArgumentNullException`
and `(int)` on the text `Ana` threw `FormatException`. Cast to `int?` when the value
may be absent. XPath works through `System.Xml.XPath`: `XPathSelectElements` with an
`XmlNamespaceManager` mapping a prefix to `urn:shop` found the open order.

Editing is direct: `SetAttributeValue("status", "shipped")`, `Add(new XElement(...))`,
`Remove()`. The trap is removing while enumerating. On `<r><a/><a/><a/><a/></r>`,
`foreach (var a in root.Elements("a")) a.Remove();` left 3 of 4 elements, because
removing a node disturbs the lazy enumeration. Materialize first,
`foreach (var a in root.Elements("a").ToList()) a.Remove();` left 0, and so did the
extension `root.Elements("a").Remove()`, which does the copying for you.

### Streaming big files with XmlReader

`XDocument` loads everything. For a large file, `XmlReader` plus `XNode.ReadFrom`
gives you one small `XElement` at a time:

```csharp
while (!rd.EOF)
    if (rd.NodeType == XmlNodeType.Element && rd.Name == "item") { var el = (XElement)XNode.ReadFrom(rd); /* use el */ }
    else rd.Read();
// [0:0] [1:1] [2:4] [3:9] [4:16]
```

`ReadFrom` leaves the reader after the element, so the `else Read()` branch must not
skip the next one. That is the standard pattern, and it keeps memory proportional to a
single item.

### Parser settings are a security boundary

An XML document can declare entities, and an entity can point at a file or a URL
(XXE), or expand exponentially. What happens depends on which entry point you use. I
tested a document whose DTD defines `&x;` as `file:///tmp/csf-secret.txt`:

| Entry point | Result |
|---|---|
| `XmlReader.Create` with default settings | `XmlException: For security reasons DTD is prohibited` (default is `DtdProcessing.Prohibit`, per the docs) |
| `XDocument.Parse(string)` and `XmlDocument.LoadXml` | parsed, entity left empty (no resolver, file not read) |
| `XmlSerializer.Deserialize` | `InvalidOperationException` |
| `DtdProcessing.Parse` only | parsed, entity empty |
| `DtdProcessing.Parse` plus `XmlResolver = new XmlUrlResolver()` | read the file: `TOP-SECRET-CONTENT` |

So file disclosure took two deliberate opt-ins in .NET 10. Entity expansion is the
other axis. A small "billion laughs" document (four nested levels of 10 expansions, `10^4` copies of `lol`) expanded to 30000
characters through `XDocument.Parse` without complaint, and the same shape with 8
levels (715 characters in, 300 million out if expanded) threw `XmlException: The input
document has exceeded a limit set by MaxCharactersFromEntities` from both
`XDocument.Parse` and `XmlDocument.LoadXml`. On a fresh `XmlReaderSettings` with `Parse`
the property read 10000000, although the docs give the default as 0, so set it yourself
rather than relying on either. Setting it to 1000 made the 30000-character document
fail. The safe pattern for outside input:

```csharp
var s = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                                MaxCharactersInDocument = 10_000_000 };
var doc = XDocument.Load(XmlReader.Create(stream, s));
```

I did not measure a document-size limit's effect. Whatever the version, keep DTDs
prohibited unless you control the document, and never pass an `XmlUrlResolver` for
untrusted input.

## Trade-offs

- **`XmlSerializer` is convention over contract.** Everything public is included, which
  is convenient and leaks new properties into the wire format.
  ```csharp
  [XmlIgnore] public string Secret { get; set; } = "";   // opt out explicitly
  ```
- **`DataContractSerializer` is explicit and invents a namespace.** Safer defaults for
  members, more ceremony, a namespace you may not want.
- **LINQ to XML is dynamic and unchecked.** No compile-time schema; missing nodes
  become `null` or exceptions depending on the cast.
- **Lazy queries plus mutation is a bug generator.** Materialize before you remove.
- **`XDocument` is memory-bound.** Stream large inputs with `XmlReader` and parse one
  element at a time.
- **Defaults are not a policy.** Set `DtdProcessing`, `XmlResolver` and the entity limit
  explicitly where input crosses a trust boundary.

## Documentation Links

- [XML Processing Options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/xml/xml-processing-options) (doc)
- [XmlSerializer Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.serialization.xmlserializer) (doc)
- [Introduction to XML serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/introducing-xml-serialization) (doc)
- [LINQ to XML overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/linq/linq-xml-overview) (doc)
- [XmlReaderSettings.DtdProcessing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.xmlreadersettings.dtdprocessing) (doc)
- [XmlReaderSettings.MaxCharactersFromEntities, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.xmlreadersettings.maxcharactersfromentities) (doc)
