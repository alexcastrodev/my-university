---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Roslyn runs your code inside the compiler. An analyzer reports a diagnostic for a pattern you want to ban, a code fix rewrites it, and an incremental source generator adds the boilerplate you would otherwise write by hand. This concept builds one of each from scratch and measures what goes wrong: a rule that flags `DateTime.Now` and `DateTimeOffset.UtcNow` (use a `TimeProvider`, see [Controlling Time in Tests with TimeProvider and FakeTimeProvider](/dotnet-testing-concepts/controlling-time-with-timeprovider)), its code fix, tests with `Microsoft.CodeAnalysis.Testing`, the NuGet package that delivers them, and an `[EnumExtensions]` generator whose pipeline is checked with a `GeneratorDriver`. The concept [Source Generators and AOT-Friendly Code](/dotnet-concepts/source-generators-and-aot-friendly-code) already shows a small `[AutoToString]` generator and states the rule "never keep symbols in the model". Here the generator is the secondary part: this concept measures that rule instead of repeating the walkthrough, and the analyzer, the fix, the tests and the packaging are the part nothing else covers.

Versions: .NET SDK 10.0.100 (compiler 5.0.0), host TFM `net10.0`, analyzer projects `netstandard2.0`, `Microsoft.CodeAnalysis.CSharp` 4.14.0, `Microsoft.CodeAnalysis.CSharp.Workspaces` 4.14.0, `Microsoft.CodeAnalysis.Analyzers` 5.9.0, `Microsoft.CodeAnalysis.CSharp.{Analyzer,CodeFix,SourceGenerators}.Testing` 1.1.4, MSTest 4.5.3, macOS arm64.

## Use Cases

- A team rule the built-in analyzers do not know ("no `DateTime.Now`", "no `new HttpClient()`"), enforced in the build instead of in code review.
- A code fix so that `dotnet format` migrates the existing violations in one command.
- A generator for repetitive code that depends on your types (enum helpers, mappers, registration lists).
- Shipping all of it to other repositories as one NuGet package.

## Deep Dive

### The project, and why the versions look old

The attribute concept ([Attributes: Custom and Compiler-Read](/csharp-concepts/attributes-custom-and-compiler-read)) covers the marker attribute side. An analyzer assembly is loaded by the compiler, so it targets `netstandard2.0` and references only the Roslyn packages (`PrivateAssets="all"`, so nothing leaks to consumers). Its Roslyn version must not be newer than the compiler that loads it. I packed the same analyzer against 5.12.0, the latest on NuGet, and built a consumer with SDK 10.0.100:

```text
CSC : warning CS9057: Analyzer assembly '.../analyzers/dotnet/cs/TimeRules.dll' cannot be used
because it references version '5.12.0.0' of the compiler, which is newer than the currently
running version '5.0.0.0'.
```

The build succeeded and the rule was silently absent, only a warning. With 4.14.0 it loaded fine, so pick the oldest Roslyn that has the APIs you use. The same project contains the generator, and `record` needs one polyfill on `netstandard2.0`: `namespace System.Runtime.CompilerServices { internal static class IsExternalInit { } }`.

`EnforceExtendedAnalyzerRules` plus `Microsoft.CodeAnalysis.Analyzers` make the compiler check your analyzer. Measured: `Console.WriteLine` and `File.ReadAllText` inside an action gave `error RS1035: The symbol 'File' is banned for use by analyzers: Do not do file IO in analyzers` (and the same for `Console`); with the property false, no message. Omitting `ConfigureGeneratedCodeAnalysis` and `EnableConcurrentExecution` gave `warning RS1025` and `RS1026`, and the first build of my rule gave `RS2008` until I added `AnalyzerReleases.Shipped.md` and `AnalyzerReleases.Unshipped.md` (a table of rule id, category and severity).

### The analyzer

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class DateTimeNowAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "TP0001";
    private static readonly DiagnosticDescriptor Rule = new(DiagnosticId,
        title: "Use TimeProvider instead of the system clock",
        messageFormat: "'{0}' reads the system clock directly; use a TimeProvider so tests can control time",
        category: "Design", defaultSeverity: DiagnosticSeverity.Warning, isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics { get; } = ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterCompilationStartAction(start =>
        {
            if (start.Compilation.GetTypeByMetadataName("System.TimeProvider") is null) return; // before .NET 8
            start.RegisterOperationAction(AnalyzeProperty, OperationKind.PropertyReference);
        });
    }

    private static void AnalyzeProperty(OperationAnalysisContext context)
    {
        var reference = (IPropertyReferenceOperation)context.Operation;
        var property = reference.Property;
        if (!property.IsStatic || property.Name is not ("Now" or "UtcNow")) return;
        var type = property.ContainingType;
        if (type.ContainingNamespace.ToDisplayString() != "System" || type.Name is not ("DateTime" or "DateTimeOffset")) return;
        context.ReportDiagnostic(Diagnostic.Create(Rule, reference.Syntax.GetLocation(), $"{type.Name}.{property.Name}"));
    }
}
```

The descriptor is the contract (id, default severity, message), and `Initialize` only registers callbacks. Per-compilation state belongs in the compilation start action, not in fields: in the IDE one analyzer instance outlives many compilations (the Roslyn definition of a session). That action runs once per compilation, so it is the place to resolve types and to decide to stay silent.

### Syntax, operation or symbol

Six uses in one sample (`DateTime.Now`, `System.DateTime.UtcNow`, an alias `D.Now`, `using static` plus a bare `Now`, `DateTimeOffset.UtcNow`, and `Mine.DateTime.Now` on a lookalike type), two analyzers:

```text
Syntax-node text match ("...DateTime.Now"): 4 reports: DateTime.Now, System.DateTime.UtcNow,
                                           DateTimeOffset.UtcNow, Mine.DateTime.Now (wrong)
Operation (IPropertyReferenceOperation):    5 reports: the same real ones plus D.Now and Now
```

The text match misses the alias and the bare name, and flags the lookalike. The operation action sees what the code means: it gets the resolved `IPropertySymbol`, whatever the spelling. A probe analyzer on the same sample counted the callbacks: `PropertyReference` 6, `SimpleMemberAccessExpression` 7, `IdentifierName` 20, `NamedType` 2, `Method` 7 (the accessor `get_Now` included). So: use an operation action for behavior inside method bodies, a syntax node action when the rule is about shape (a naming or layout rule, only syntax) and a symbol action for declarations (a method name, a base type, a missing attribute). A symbol action never sees what is inside a body. Per the Roslyn action semantics document, a symbol action runs once per declaration and an operation action once per operation node.

`ConfigureGeneratedCodeAnalysis(None)` matters: with `Analyze | ReportDiagnostics` instead, my test on a `[GeneratedCode]` class failed with `Mismatch between number of diagnostics returned, expected "0" actual "1"`. `EnableConcurrentExecution` lets the compiler run callbacks in parallel, so the callbacks must be thread-safe.

### The code fix

```csharp
[ExportCodeFixProvider(LanguageNames.CSharp, Name = nameof(UseTimeProviderCodeFix)), Shared]
public sealed class UseTimeProviderCodeFix : CodeFixProvider
{
    public override ImmutableArray<string> FixableDiagnosticIds { get; } = ImmutableArray.Create(DateTimeNowAnalyzer.DiagnosticId);
    public override FixAllProvider GetFixAllProvider() => WellKnownFixAllProviders.BatchFixer;

    public override async Task RegisterCodeFixesAsync(CodeFixContext context)
    {
        var root = await context.Document.GetSyntaxRootAsync(context.CancellationToken);
        var node = root?.FindNode(context.Span, getInnermostNodeForTie: true);
        if (node is null) return;
        context.RegisterCodeFix(
            CodeAction.Create("Use TimeProvider", ct => ReplaceAsync(context.Document, node, ct),
                equivalenceKey: nameof(UseTimeProviderCodeFix)), context.Diagnostics);
    }
}
```

`ReplaceAsync` builds the replacement with the `DocumentEditor`: `GetSymbolInfo` on the node, then `editor.ReplaceNode(node, provider.GetUtcNow()...)`, where `provider` is a `TimeProvider` already visible at that position (a field, parameter or local found with `model.LookupSymbols`) and otherwise `TimeProvider.System`. `DateTime.UtcNow` becomes `.GetUtcNow().UtcDateTime`, `DateTime.Now` becomes `.GetLocalNow().DateTime`, and `DateTimeOffset` needs no suffix. The fix lives in a separate project because it needs `Microsoft.CodeAnalysis.CSharp.Workspaces`, which the compiler does not load.

Two things I measured. First, adding the `Simplifier.Annotation` to the whole replacement expression left `global::System.TimeProvider.System.GetLocalNow()` in the output of the second and third fixes of one file (the test diff showed exactly that); annotating only the `global::System.TimeProvider` type name fixed it, and then it reduces to `TimeProvider` with `using System;` and to `System.TimeProvider` without. Building the type with `SyntaxGenerator.TypeExpression` failed a different way: the harness rejects a `QualifiedName` where an expression was expected. Second, the fix is not free of behavior change (see [Dates, Times and Time Zones](/csharp-concepts/dates-times-and-time-zones) for `DateTimeKind`):

```text
DateTime.Now.Kind: Local                       GetLocalNow().DateTime.Kind: Unspecified
GetUtcNow().LocalDateTime.Kind: Local          DateTime.UtcNow.Kind: Utc, GetUtcNow().UtcDateTime.Kind: Utc
fake provider with a UTC+5 zone: GetLocalNow().DateTime = 17:00, GetUtcNow().LocalDateTime = 12:00 (system zone UTC)
```

`.DateTime` honors the provider's `LocalTimeZone` but loses the `Kind`; `.LocalDateTime` keeps `Local` but uses the machine zone. I chose the first (a fake zone then works in tests) and the rule's message should say so. A fix that changes behavior is a decision to document, not to hide.

`GetFixAllProvider` returns the batch fixer, and without it no "Fix all" appears. It also needs a non-null `equivalenceKey`, because FixAll groups fixes by it (per the Roslyn FixAllProvider document). The batch fixer applies each fix to the original solution snapshot and keeps only the changes whose spans do not overlap, so it is wrong for fixes that overlap or add declarations. Here each fix replaces its own expression. `dotnet format analyzers Consumer.csproj --diagnostics TP0001 --severity warn` ran the package's fix over a project and changed all three occurrences in one pass, and the rebuilt project had 0 warnings:

```text
-Console.WriteLine(D.Now.Year > 2000);                  +Console.WriteLine(TimeProvider.System.GetLocalNow().DateTime.Year > 2000);
-public string Stamp() => DateTimeOffset.UtcNow.ToString("O");   +public string Stamp() => TimeProvider.System.GetUtcNow().ToString("O");
```

### Testing with Microsoft.CodeAnalysis.Testing

The harness compiles a snippet, runs the analyzer, compares the diagnostics with the markup, applies the fix and compares the result. `{|TP0001:...|}` marks the span that must carry that diagnostic:

```csharp
var test = new CSharpCodeFixTest<DateTimeNowAnalyzer, UseTimeProviderCodeFix, DefaultVerifier>
{
    TestCode = source, FixedCode = fixedSource, ReferenceAssemblies = ReferenceAssemblies.Net.Net100,
};
await test.RunAsync();   // source: "DateTime M() => {|TP0001:DateTime.UtcNow|};"
```

Six tests: the three clock forms and their fixes, a fix that prefers an injected `_clock`, alias plus `using static` plus the full name, a lookalike type and `DateTime.Today` that must stay silent (a test without markup asserts "no diagnostics"), and generated code. A snippet with a missing or extra diagnostic fails with a diff. The harness did not notice a missing FixAll: with `GetFixAllProvider` returning `null` all tests stayed green, so the `dotnet format` run above is the real check. The setup had traps. `DefaultVerifier` works with MSTest 4 directly (the xunit and mstest verifier packages stop at 1.1.2 and are not needed). Referencing the analyzer project with `PrivateAssets="all"` did not carry Roslyn to the test project, which restored Roslyn 3.8.0 from the testing package and printed `MSB3277` conflicts until I added an explicit `Microsoft.CodeAnalysis.CSharp.Workspaces` 4.14.0. The testing packages also pulled `System.Security.Cryptography.Pkcs` 9.0.6 and `NU1902`/`NU1903` warnings; a direct reference to 10.0.15 cleared them. On the .NET 10 SDK `dotnet test` needs `{ "test": { "runner": "Microsoft.Testing.Platform" } }` in `global.json` and `dotnet test --project <path>`.

### Packaging as a NuGet package

(Packaging in general is in [Packaging and Publishing a NuGet Library](/dotnet-concepts/packaging-and-publishing-a-nuget-library).) The package contains no `lib/`, only the assemblies in `analyzers/dotnet/cs`:

```xml
<PropertyGroup>
  <PackageId>Contoso.TimeRules</PackageId>
  <IncludeBuildOutput>false</IncludeBuildOutput>
  <SuppressDependenciesWhenPacking>true</SuppressDependenciesWhenPacking>
  <DevelopmentDependency>true</DevelopmentDependency>
  <TargetsForTfmSpecificContentInPackage>$(TargetsForTfmSpecificContentInPackage);AddAnalyzersToPackage</TargetsForTfmSpecificContentInPackage>
</PropertyGroup>
<Target Name="AddAnalyzersToPackage">
  <ItemGroup>
    <TfmSpecificPackageFile Include="../TimeRules/bin/$(Configuration)/netstandard2.0/TimeRules.dll" PackagePath="analyzers/dotnet/cs" />
    <TfmSpecificPackageFile Include="../TimeRules.CodeFixes/bin/$(Configuration)/netstandard2.0/TimeRules.CodeFixes.dll" PackagePath="analyzers/dotnet/cs" />
  </ItemGroup>
</Target>
```

A separate package project holds this because the analyzer project cannot reference the code fix that references it. `unzip -l` showed `analyzers/dotnet/cs/TimeRules.dll` (16 KB, analyzer plus generator) and `TimeRules.CodeFixes.dll`, and the nuspec had `developmentDependency` true and no dependencies. A console app that references the package from a local feed printed `warning TP0001` for `DateTimeOffset.UtcNow`, `D.Now` and `Now`. The severity is the consumer's choice in `.editorconfig` (see [Analyzers, EditorConfig and Build Quality Gates](/dotnet-concepts/analyzers-editorconfig-and-build-quality-gates) for the mechanism):

```text
dotnet_diagnostic.TP0001.severity = error        3 errors, Build FAILED
dotnet_diagnostic.TP0001.severity = suggestion   build succeeded, 0 warnings
dotnet_diagnostic.TP0001.severity = none         build succeeded, 0 warnings
```

Keep dependencies to a minimum. An analyzer that called `Newtonsoft.Json` without shipping it next to the analyzer gave `warning AD0001: Analyzer 'A' threw an exception of type 'System.IO.FileNotFoundException' ... 'Newtonsoft.Json, Version=13.0.0.0'`. The Roslyn cookbook says generation-time dependencies must be copied into `analyzers/dotnet/cs` by hand (docs only, shipping them was not run here).

### The incremental generator

```csharp
[Generator(LanguageNames.CSharp)]
public sealed class EnumExtensionsGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(c => c.AddSource("EnumExtensionsAttribute.g.cs", AttributeSource));

        var models = context.SyntaxProvider.ForAttributeWithMetadataName(
                "Contoso.EnumExtensionsAttribute",
                predicate: static (node, _) => node is EnumDeclarationSyntax,       // cheap, syntax only
                transform: static (ctx, _) => ToModel((INamedTypeSymbol)ctx.TargetSymbol))
            .WithTrackingName("EnumModel")
            .Where(static m => m is not null);

        context.RegisterSourceOutput(models, static (spc, m) => spc.AddSource($"{m!.Name}Extensions.g.cs", Render(m)));
    }
}
internal sealed record EnumModel(string? Namespace, string Name, EquatableArray<string> Members);
```

`ForAttributeWithMetadataName` is the entry point: the cookbook says it is at least 99 times more efficient than `CreateSyntaxProvider`, and the attribute lets users opt in. `ToModel` copies strings out of the symbol and returns a record, and the marker attribute ships inside the generator through the post-initialization output. A consumer with `[EnumExtensions] enum Color { Red, Green = 5, Blue }` printed `Green` and `42` for `((Color)42).ToStringFast()`, and `EmitCompilerGeneratedFiles` wrote `ColorExtensions.g.cs` under `obj/generated` (inside `obj`, so the next build does not compile it twice).

Incrementality is the part that decides editor performance. The driver test runs the same generator over four compilations (first run, edit another file, edit the enum's own file outside the enum, add a member) with `trackIncrementalGeneratorSteps: true`, and reads the reason of the tracked step:

```text
model holds INamedTypeSymbol:           New, Modified,  Modified,  Modified    source output ran 4 times
record with ImmutableArray<string>:     New, Modified,  Modified,  Modified    source output ran 4 times
record with EquatableArray<string>:     New, Unchanged, Unchanged, Modified    source output ran 2 times
the real generator (same model):        New, Unchanged, Unchanged, Modified
```

A symbol is a new object every compilation, and `ImmutableArray<T>` compares by reference, so the first two models are never equal and the output (and every step after it) reruns on every keystroke; the third compares by value, so the pipeline stops there. The cookbook lists the same rules, and adds that symbols can keep old compilations alive in memory. The real test asserts `New, Unchanged, Unchanged, Modified`, and a second test uses `CSharpSourceGeneratorTest` to compare the generated files with expected text.

### Debugging

I could not attach a debugger in this run (docs only). The Roslyn tutorial says the Visual Studio analyzer template starts a second, experimental Visual Studio instance on F5, and also that unit tests are much faster than testing interactively. In practice the loop here was the test harness, `GetRunResult()` on the driver for generators and `EmitCompilerGeneratedFiles` to read what a generator emitted.

### Book vs today

Older tutorials build generators on `ISourceGenerator`, the v1 API; the Roslyn documentation says incremental generators replace it. They also use per-framework verifier packages (`...Testing.XUnit`, last release 1.1.2) and a VSIX project for debugging. Today: `IIncrementalGenerator` with `ForAttributeWithMetadataName`, `DefaultVerifier` with any test framework, and the NuGet package as the delivery. A tutorial that scans every node with `CreateSyntaxProvider` and takes the symbol into the model works, and is the slow, memory-hungry shape measured above.

## Trade-offs

- **Roslyn version.** An old Roslyn reference runs on more SDKs but lacks newer APIs; a new one gives `CS9057` and a silently dead rule on an older SDK (5.12.0 against compiler 5.0.0).
- **Operation versus syntax.** Operations resolve aliases and `using static` (all 5 real uses found, against 3 found and 1 false report for the text match), but they only exist inside executable code; a rule about declarations or layout is cheaper as a symbol or syntax action.
- **A fix is a promise.** `.GetLocalNow().DateTime` changes `Kind` from `Local` to `Unspecified`; offer the safe fix and document the difference, and keep the diagnostic even when no automatic fix is possible.
- **One assembly or two.** Analyzer and generator in one DLL means one package, but every consumer loads both, and the fix needs the Workspaces assembly that the compiler does not have.
- **Generated code is shipped surface.** A generator runs on every keystroke in the IDE: a symbol in the model or a collection with reference equality makes it re-emit all the time (4 of 4 runs against 2 of 4).
- **No dependencies.** Anything the analyzer calls must be packed beside it, or the user sees `AD0001`.

## Documentation Links

- [The .NET Compiler Platform SDK (Roslyn APIs), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/) (doc)
- [Tutorial: Write your first analyzer and code fix, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/tutorials/how-to-write-csharp-analyzer-code-fix) (doc)
- [Source generators overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview) (doc)
- [Incremental generators cookbook, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.cookbook.md) (doc)
- [Incremental generators design, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md) (doc)
- [Analyzer actions semantics, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/analyzers/Analyzer%20Actions%20Semantics.md) (doc)
- [FixAllProvider, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/analyzers/FixAllProvider.md) (doc)
- [Roslyn analyzer rules for analyzer authors (RS rules), dotnet/roslyn-analyzers](https://github.com/dotnet/roslyn-analyzers/blob/main/src/Microsoft.CodeAnalysis.Analyzers/Microsoft.CodeAnalysis.Analyzers.md) (doc)
- [Analyzer NuGet conventions, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/guides/analyzers-conventions) (doc)
- [TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
- [dotnet format, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format) (doc)
