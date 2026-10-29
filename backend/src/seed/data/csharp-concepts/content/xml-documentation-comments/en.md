---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

The compiler parses a `///` comment as XML, checks its parameter names and
`cref` references against the code and, when asked, writes it to an `.xml` file
next to the DLL, read by editors, NuGet, doc generators and the ASP.NET Core
OpenAPI package. This concept, on .NET 10 / C# 14, turns the file on, reads what
the compiler writes (ID strings, `cref`, `inheritdoc`, `include`), provokes the
common warnings with their exact messages, covers records, primary constructors
and `required` members, packs a library, and ends with a low-noise policy.

## Use Cases

- A NuGet library whose consumers need parameter docs in editor tooltips.
- A base class or interface documented once and reused via `<inheritdoc/>`.
- A CI gate that fails when a public member is undocumented or a `<param>` drifts.
- A web API whose XML comments feed OpenAPI, without drowning in CS1591.

## Deep Dive

### Turning the file on

`GenerateDocumentationFile` is `false` in a new `classlib` (`dotnet msbuild
-getProperty` says so); with `true` the build writes `<AssemblyName>.xml` next
to the DLL in `bin/<config>/net10.0`:

```csharp
/// <summary>Creates a circle.</summary>
/// <param name="radius">The radius; must be positive.</param>
/// <exception cref="ArgumentOutOfRangeException"><paramref name="radius"/> is zero or negative.</exception>
public Circle(double radius) { /* ... */ }      // in class Circle, namespace Shapes
```

```text
<doc> <assembly> <name>Shapes</name> </assembly> <members>      (excerpt)
<member name="M:Shapes.Circle.#ctor(System.Double)">
    <summary>Creates a circle.</summary>
    <param name="radius">The radius; must be positive.</param>
    <exception cref="T:System.ArgumentOutOfRangeException"><paramref name="radius"/> is zero or negative.</exception>
</member>
```

Each `name` is an ID string: a prefix (`T:` type, `M:` method or constructor,
`P:` property; the spec adds `F:`, `E:` and more), the full name and parameter
types. Every `cref` is rewritten to that form, which is how tools link the XML
to the DLL (the docs note the file has no type information of its own).

### The tags

| Tag | Purpose |
|---|---|
| `summary`, `remarks` | Short description editors show first; longer explanation |
| `param`, `typeparam` | Describe a parameter or type parameter (names checked) |
| `paramref`, `typeparamref` | Refer to one inside text (names checked) |
| `returns`, `value` | What a method returns, what a property holds |
| `exception` | `cref` of an exception the member throws, plus when |
| `example`, `code`, `c` | Usage sample; code block; inline code |
| `para`, `list` | Paragraph break; bullet, number or table list |
| `see`, `seealso` | Inline link, "See also" entry (`cref`, `href` or `langword`) |
| `inheritdoc`, `include` | Reuse docs from a base, interface or `cref`; from an XML file |

The compiler copies any well-formed XML, custom tags included; it checks only
the names in `param`, `paramref`, `typeparam`, `typeparamref` and every `cref`.

### cref syntax: generics, overloads, nested types

Generic parameters go in braces, because `<` would end the XML attribute:

```csharp
/// <see cref="Bag{T}"/> <see cref="List{T}"/> <see cref="Bag{T}.Map{TOut}(Func{T, TOut})"/>
/// <see cref="Bag{T}.Options"/> <see cref="Circle.Radius"/> <see cref="Circle(double)"/>
/// <see cref="Dictionary{TKey, TValue}.TryGetValue"/> <see cref="T:System.String"/>
/// <see cref="Circle.Scale"/> <see cref="Bag{int}"/> <see langword="null"/>
```

```text
T:Shapes.Bag`1   T:System.Collections.Generic.List`1   M:Shapes.Bag`1.Map``1(System.Func{`0,``0})
T:Shapes.Bag`1.Options   P:Shapes.Circle.Radius   M:Shapes.Circle.#ctor(System.Double)
M:System.Collections.Generic.Dictionary`2.TryGetValue(`0,`1@)   T:System.String
warning CS0419: Ambiguous reference in cref attribute: 'Circle.Scale'. Assuming 'Circle.Scale(double)',
  but could have also matched other overloads including 'Circle.Scale(double, double)'.
warning CS1584: XML comment has syntactically incorrect cref attribute 'Bag{int}'
warning CS1658: Type parameter declaration must be an identifier not a type. See also error CS0081.
```

`` `1 `` is a type's arity and `` `0 `` its first type parameter (a doubled
backtick means the same for a method), and `@` marks a `ref`/`out`. A name
without parameters works only while there is one overload (`TryGetValue`); with
two, CS0419 picks one. Write `Bag{T}`, not `Bag{int}`. A `T:` prefix passes as is.

### What the compiler checks

One file with deliberate mistakes, built twice. Without the property the build
reports no doc diagnostic at all, not even CS1587. With
`-p:GenerateDocumentationFile=true`:

```text
CS1591: Missing XML comment for publicly visible type or member 'Undocumented'
CS1570: XML comment has badly formed XML -- 'End tag 'summary' does not match the start tag 'b'.'
CS1572: XML comment has a param tag for 'denom', but there is no parameter by that name
CS1573: Parameter 'denominator' has no matching param tag in the XML comment for 'Holder.Div(int, int)' (but other parameters do)
CS1571: XML comment has a duplicate param tag for 'a'
CS1574: XML comment has cref attribute 'DoesNotExist' that could not be resolved
CS1711: XML comment has a typeparam tag for 'U', but there is no type parameter by that name
CS1587: XML comment is not placed on a valid language element     (/// above a local)
```

All are warnings. A bad `<paramref>` is CS1734 and an undocumented type
parameter CS1712, both worded like the lines above. CS1573 and CS1712 fire only
when some parameters are documented, so a member with no `<param>` at all is
silent, as is a missing `<returns>`. CS1591 covers `public` and `protected`
members of public types (an undocumented `protected` field and an `override`
both warned), never `internal` ones. A malformed comment is dropped from the
file with `<!-- Badly formed XML comment ignored for member "T:Bad.Malformed"
-->`, and an unresolved cref is kept with a `!:` prefix (`cref="!:DoesNotExist"`).

### inheritdoc and include

```csharp
/// <inheritdoc/>
public sealed class Square : Shape, INamed
{
    /// <inheritdoc/>
    public override double Area() => 1;     // from Shape.Area; XML: <inheritdoc/>
    /// <inheritdoc/>
    public string Name => "square";         // from INamed.Name; XML: <inheritdoc/>
    /// <inheritdoc cref="Shape.Draw(double)" path="/param"/>
    public void Paint(double scale) { }
    // XML: <inheritdoc cref="M:Inh.Shape.Draw(System.Double)" path="/param"/>
    /// <inheritdoc/>
    public void Orphan() { }                // no base member; XML: <inheritdoc/>
    /// <include file="docs/shared.xml" path="docs/members[@name='calc']/Sum/*"/>
    public static int Sum(int a, int b) => a + b;
    // XML: <summary>Adds two numbers (from shared.xml).</summary><param name="a">Left.</param>...
}
```

The compiler does **not** expand `inheritdoc`: it writes the tag as is (cref
turned into an ID) and leaves resolution to editors and doc generators.
`Orphan` got no diagnostic; only a bad `cref` inside the tag gave CS1574. The
tag satisfies CS1591 for its member, but on a type it does not cover new
members (an undocumented `Extra()` still got CS1591). The docs add that Visual
Studio shows inherited docs for undocumented overrides, in the IDE only.

`include` is the opposite: the compiler inlines the XPath result. A missing
file gives `CS1589: Unable to include XML fragment '...' of file
'docs/missing.xml' -- File not found.` and an XML comment in the output; an
XPath matching nothing is silent, leaving only `<!-- No matching elements were
found for the following include tag -->`. `/** */` gave the same XML as `///`.

### Records, primary constructors, required and init

```csharp
/// <summary>A money amount.</summary>
/// <param name="Amount">The numeric value.</param>
/// <param name="Currency">ISO 4217 code.</param>
public record Money(decimal Amount, string Currency);
// T:Rec.Money and M:Rec.Money.#ctor(System.Decimal,System.String): summary + both params
// P:Rec.Money.Amount: <summary>The numeric value.</summary>  (Currency likewise)

/// <summary>A service with a primary constructor.</summary>
/// <param name="clock">Time source.</param>
public class Greeter(TimeProvider clock) { /* ... */ }
// T:Rec.Greeter and M:Rec.Greeter.#ctor(System.TimeProvider): summary + param
```

On a positional record a `<param>` also becomes the property's `<summary>`;
on a class primary constructor it documents only the constructor, since those
parameters are not members. The checks still apply: `<param name="clok">`
gave CS1572 plus CS1573, and a record documenting only `Amount` got CS1573 for
`Currency`. A record with no `<param>` tags got no CS1591 for its public
positional properties, and the XML has no entry for them. `required` and
`init` change nothing: such a property is documented like any other, and an
undocumented `public required int Timeout` got CS1591.

### Packages and the IntelliSense file

With the property on, `dotnet pack -o feed` put the file beside the DLL:

```text
lib/net10.0/Shapes.dll
lib/net10.0/Shapes.xml
```
A console app consuming the package got only `Shapes.dll` in its `bin`; the XML
stays in the package folder next to the DLL editors resolve. With
`-p:CopyDocumentationFilesFromPackages=true` it was copied too. The docs require
the assembly's name and folder for IntelliSense to find it. DocFX and similar
site generators consume the same comments (not installed here); Source Link,
which points debuggers at the source behind a PDB, is a separate feature.

### Turning warnings into a gate

```text
-p:TreatWarningsAsErrors=true                         error CS1591: Missing XML comment ...
.editorconfig  dotnet_diagnostic.CS1591.severity = error   error CS1591, without TWAE
.editorconfig  dotnet_diagnostic.CS1591.severity = none    succeeds, even with TWAE
NoWarn containing CS1591                                   succeeds, XML still written
severity = error, GenerateDocumentationFile off            succeeds: nothing is checked
```

Promoting the whole family has an ordering effect: with CS1570 and CS1584 as
errors the build stopped there, hiding the file's CS1572, CS1574 and CS1591
until the XML was fixed. (The analyzers concept shows IDE0005 needs it too.)

## Trade-offs

- **Libraries yes, apps mostly no.** In a package, docs are API surface and
  CS1591 is a fair gate. An app's public types have no outside consumers; turn
  the file on only if OpenAPI needs it, and silence the noise:
  ```xml
  <GenerateDocumentationFile>true</GenerateDocumentationFile>
  <NoWarn>$(NoWarn);CS1591</NoWarn>
  ```
- **Gate the family, not everything.** `TreatWarningsAsErrors` makes doc fixes
  compete with unrelated warnings. A targeted list fails only on doc drift:
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);CS0419;CS1570;CS1571;CS1572;CS1573;CS1574;CS1584;CS1587;CS1589;CS1591;CS1711;CS1712;CS1734</WarningsAsErrors>
  ```
  Put it in a `Directory.Build.props` for `src`, and relax CS1591 in
  `.editorconfig` for tests or generated folders.
- **inheritdoc is a pointer, not a copy.** It removes duplication, but the
  compiler never checks a base exists, and a tool that does not resolve it
  shows nothing.

## Documentation Links

- [XML documentation comments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/xmldoc/) (doc)
- [Recommended XML tags for C# documentation comments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/xmldoc/recommended-tags) (doc)
- [Documentation comments, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/documentation-comments) (doc)
- [Compiler Warning CS1591, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs1591) (doc)
- [C# compiler options that control output: DocumentationFile, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/output) (doc)
- [MSBuild reference for .NET SDK projects: GenerateDocumentationFile, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props#generatedocumentationfile) (doc)
